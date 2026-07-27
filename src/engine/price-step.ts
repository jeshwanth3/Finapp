/**
 * Price-step detection — design spec §9.4.
 *
 * Segment a mature stream's amount series into stable levels, and emit a step event
 * with the annualised delta wherever the level changes.
 *
 * The distinction that matters is step versus spike. A subscription that goes
 * 15.49, 15.49, 17.99, 15.49 has not raised its price — something one-off happened,
 * and reporting a $30/yr increase followed by a $30/yr decrease is noise dressed as
 * insight. So a new level is only opened once it has been *confirmed* by a following
 * observation. A single deviation at the tail of the series cannot be confirmed yet;
 * it is reported separately as pending rather than promoted or dropped, because
 * dropping it hides the most recent and most actionable thing in the series.
 *
 * §9.4 also notes that an announcement email arriving before the change is strictly
 * better than observing it afterwards — a warning rather than a report. Announcements
 * are therefore accepted as an input: they upgrade a detected step's confidence, and
 * an announcement with no observation yet is emitted as a forecast so the warning
 * survives to the UI.
 */

import { compareIsoDates, diffDays, parseIsoDate, type IsoDate } from '@/core/date'
import { scale, subtract, sum, toDecimalString, type Money } from '@/core/money'
import { describeCadence, occurrencesPerYear, validateCadence, type Cadence } from './cadence'
import { type Confidence } from './confidence'
import { amountTolerance, resolveRelativeTolerance, withinTolerance, medianMoney } from './tolerance'

export class PriceStepInputError extends Error {
  constructor(reason: string) {
    super(`Price-step input rejected: ${reason}`)
    this.name = 'PriceStepInputError'
  }
}

export interface AmountObservation {
  readonly date: IsoDate
  readonly amount: Money
  readonly transactionId?: string
}

export interface PriceAnnouncement {
  readonly id: string
  /** When the notice arrived. Lead time is measured from here. */
  readonly announcedOn: IsoDate
  /** When the new amount takes effect, per the notice. */
  readonly effectiveFrom: IsoDate
  readonly newAmount: Money
  readonly sourceRef?: string
}

export type PriceStepSource = 'observed' | 'announced' | 'observed+announced'

export interface PriceLevel {
  readonly amount: Money
  readonly from: IsoDate
  readonly to: IsoDate
  readonly observationCount: number
  readonly transactionIds: readonly string[]
}

export interface PriceStepEvent {
  readonly effectiveFrom: IsoDate
  readonly direction: 'increase' | 'decrease'
  readonly previousAmount: Money
  readonly newAmount: Money
  readonly delta: Money
  /** `delta x occurrences per year` — the figure worth acting on. */
  readonly annualisedDelta: Money
  readonly occurrencesPerYear: number
  /** Fractional change, e.g. 0.1582 for +15.82%. Not Money — it is a ratio. */
  readonly relativeChange: number
  readonly source: PriceStepSource
  readonly confidence: Confidence
  readonly evidenceTransactionIds: readonly string[]
  readonly announcementId?: string
  readonly announcementLeadDays?: number
  readonly explanation: string
}

export interface PendingPriceStep {
  readonly observedOn: IsoDate
  readonly previousAmount: Money
  readonly observedAmount: Money
  readonly delta: Money
  readonly transactionId?: string
  readonly reason: string
}

export interface PriceStepReport {
  readonly currency: string
  readonly cadence: Cadence
  readonly levels: readonly PriceLevel[]
  readonly steps: readonly PriceStepEvent[]
  readonly pending: readonly PendingPriceStep[]
  /** Deviations judged one-off, kept visible so nothing silently vanishes. */
  readonly outlierTransactionIds: readonly string[]
  readonly assumptions: readonly string[]
}

export interface PriceStepOptions {
  readonly cadence: Cadence
  /** Per-account absolute tolerance floor, in the series' currency. */
  readonly absoluteFloor: Money
  readonly relative?: number
  /** Observations at the new level required before a step is confirmed. Min 2. */
  readonly minRunLength?: number
  readonly announcements?: readonly PriceAnnouncement[]
  /** How far an announcement's effective date may sit from the observed step. */
  readonly announcementMatchDays?: number
}

const DEFAULT_MIN_RUN_LENGTH = 2
const DEFAULT_ANNOUNCEMENT_MATCH_DAYS = 10

interface Run {
  amounts: Money[]
  dates: IsoDate[]
  ids: string[]
  level: Money
}

function newRun(o: AmountObservation): Run {
  return {
    amounts: [o.amount],
    dates: [o.date],
    ids: o.transactionId === undefined ? [] : [o.transactionId],
    level: o.amount,
  }
}

function toLevel(run: Run): PriceLevel {
  const from = run.dates[0]
  const to = run.dates[run.dates.length - 1]
  if (from === undefined || to === undefined) {
    throw new PriceStepInputError('internal: a run closed with no dates')
  }
  return {
    amount: run.level,
    from,
    to,
    observationCount: run.amounts.length,
    transactionIds: run.ids,
  }
}

function confidenceFor(prev: PriceLevel, next: PriceLevel): Confidence {
  if (prev.observationCount >= 3 && next.observationCount >= 3) return 'high'
  if (prev.observationCount >= 2 && next.observationCount >= 2) return 'medium'
  return 'low'
}

export function detectPriceSteps(
  series: readonly AmountObservation[],
  options: PriceStepOptions,
): PriceStepReport {
  validateCadence(options.cadence)
  const relative = resolveRelativeTolerance({ relative: options.relative })
  const minRunLength = options.minRunLength ?? DEFAULT_MIN_RUN_LENGTH
  if (!Number.isInteger(minRunLength) || minRunLength < 2) {
    throw new PriceStepInputError(
      `minRunLength must be an integer >= 2; a "level" confirmed by one observation is a spike`,
    )
  }
  const matchDays = options.announcementMatchDays ?? DEFAULT_ANNOUNCEMENT_MATCH_DAYS

  const first = series[0]
  if (first === undefined) throw new PriceStepInputError('series is empty')
  const currency = first.amount.currency
  if (options.absoluteFloor.currency !== currency) {
    throw new PriceStepInputError(
      `tolerance floor is in ${options.absoluteFloor.currency} but the series is in ${currency}`,
    )
  }

  const observations = [...series].sort((a, b) => {
    const byDate = compareIsoDates(a.date, b.date)
    if (byDate !== 0) return byDate
    return (a.transactionId ?? '').localeCompare(b.transactionId ?? '')
  })
  for (const o of observations) {
    parseIsoDate(o.date)
    if (o.amount.currency !== currency) {
      throw new PriceStepInputError(
        `series mixes currencies (${currency} and ${o.amount.currency}); a price step is a change ` +
          `within one currency, never across two`,
      )
    }
    if (o.amount.minor < 0) {
      throw new PriceStepInputError(
        `observation on ${o.date} is ${toDecimalString(o.amount)}; supply positive magnitudes so a ` +
          `sign convention cannot invert the direction of a step`,
      )
    }
  }

  const runs: Run[] = []
  const outliers: string[] = []
  const pending: PendingPriceStep[] = []
  let current = newRun(observations[0] as AmountObservation)

  for (let i = 1; i < observations.length; i++) {
    const o = observations[i] as AmountObservation
    const tol = amountTolerance(current.level, options.absoluteFloor, relative)

    if (withinTolerance(o.amount, current.level, tol)) {
      current.amounts.push(o.amount)
      current.dates.push(o.date)
      if (o.transactionId !== undefined) current.ids.push(o.transactionId)
      current.level = medianMoney(current.amounts)
      continue
    }

    const needed = minRunLength - 1
    const lookahead = observations.slice(i + 1, i + 1 + needed)
    const newTol = amountTolerance(o.amount, options.absoluteFloor, relative)
    const confirmed =
      lookahead.length === needed && lookahead.every((x) => withinTolerance(x.amount, o.amount, newTol))

    if (confirmed) {
      runs.push(current)
      current = newRun(o)
      continue
    }

    if (i === observations.length - 1) {
      pending.push({
        observedOn: o.date,
        previousAmount: current.level,
        observedAmount: o.amount,
        delta: subtract(o.amount, current.level),
        ...(o.transactionId === undefined ? {} : { transactionId: o.transactionId }),
        reason:
          'the latest charge departs from the established level but no later charge exists yet to ' +
          'confirm it as a step rather than a one-off',
      })
      continue
    }

    // Deviates, but the following charges return to the current level: a spike.
    if (o.transactionId !== undefined) outliers.push(o.transactionId)
  }
  runs.push(current)

  const levels = runs.map(toLevel)
  const perYear = occurrencesPerYear(options.cadence)
  const announcements = [...(options.announcements ?? [])].sort((a, b) =>
    compareIsoDates(a.effectiveFrom, b.effectiveFrom),
  )
  const usedAnnouncements = new Set<string>()

  const steps: PriceStepEvent[] = []
  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1]
    const next = levels[i]
    if (!prev || !next) continue

    const delta = subtract(next.amount, prev.amount)
    const annualisedDelta = scale(delta, perYear)

    const match = announcements.find(
      (a) =>
        !usedAnnouncements.has(a.id) &&
        a.newAmount.currency === currency &&
        Math.abs(diffDays(a.effectiveFrom, next.from)) <= matchDays &&
        withinTolerance(a.newAmount, next.amount, amountTolerance(next.amount, options.absoluteFloor, relative)),
    )
    if (match) usedAnnouncements.add(match.id)

    const baseConfidence = confidenceFor(prev, next)
    steps.push({
      effectiveFrom: next.from,
      direction: delta.minor >= 0 ? 'increase' : 'decrease',
      previousAmount: prev.amount,
      newAmount: next.amount,
      delta,
      annualisedDelta,
      occurrencesPerYear: perYear,
      relativeChange: prev.amount.minor === 0 ? Number.POSITIVE_INFINITY : delta.minor / prev.amount.minor,
      source: match ? 'observed+announced' : 'observed',
      // A change that was announced in writing and then observed is as certain as
      // this engine gets, regardless of how many charges sit at each level.
      confidence: match ? 'high' : baseConfidence,
      evidenceTransactionIds: [...prev.transactionIds, ...next.transactionIds],
      ...(match === undefined ? {} : { announcementId: match.id }),
      ...(match === undefined
        ? {}
        : { announcementLeadDays: diffDays(match.announcedOn, match.effectiveFrom) }),
      explanation:
        `${delta.minor >= 0 ? 'Increase' : 'Decrease'} from ${toDecimalString(prev.amount)} to ` +
        `${toDecimalString(next.amount)} ${currency} effective ${next.from}, ` +
        `${describeCadence(options.cadence)} — ${toDecimalString(annualisedDelta)} ${currency} per year.`,
    })
  }

  // Announcements that have not happened yet: a warning, not a report.
  const lastLevel = levels[levels.length - 1]
  if (lastLevel) {
    for (const a of announcements) {
      if (usedAnnouncements.has(a.id)) continue
      if (a.newAmount.currency !== currency) continue
      if (compareIsoDates(a.effectiveFrom, lastLevel.to) <= 0) continue
      const delta = subtract(a.newAmount, lastLevel.amount)
      if (delta.minor === 0) continue
      steps.push({
        effectiveFrom: a.effectiveFrom,
        direction: delta.minor >= 0 ? 'increase' : 'decrease',
        previousAmount: lastLevel.amount,
        newAmount: a.newAmount,
        delta,
        annualisedDelta: scale(delta, perYear),
        occurrencesPerYear: perYear,
        relativeChange:
          lastLevel.amount.minor === 0 ? Number.POSITIVE_INFINITY : delta.minor / lastLevel.amount.minor,
        source: 'announced',
        confidence: 'high',
        evidenceTransactionIds: lastLevel.transactionIds,
        announcementId: a.id,
        announcementLeadDays: diffDays(a.announcedOn, a.effectiveFrom),
        explanation:
          `Announced ${delta.minor >= 0 ? 'increase' : 'decrease'} from ` +
          `${toDecimalString(lastLevel.amount)} to ${toDecimalString(a.newAmount)} ${currency} ` +
          `effective ${a.effectiveFrom}, not yet observed — ${toDecimalString(scale(delta, perYear))} ` +
          `${currency} per year.`,
      })
    }
  }

  steps.sort((x, y) => compareIsoDates(x.effectiveFrom, y.effectiveFrom))

  return {
    currency,
    cadence: options.cadence,
    levels,
    steps,
    pending,
    outlierTransactionIds: outliers,
    assumptions: [
      `A level change is confirmed only after ${minRunLength} observations sit at the new amount; ` +
        `a single deviation is treated as a one-off, not a step.`,
      `Annualisation multiplies the per-charge delta by ${perYear.toFixed(4)} occurrences per year, ` +
        `derived from the stream's cadence (${describeCadence(options.cadence)}).`,
      'Announced-but-unobserved changes are emitted as forecasts and marked as such.',
    ],
  }
}

/**
 * Total annualised impact of every confirmed step, in the series' currency.
 *
 * `sum` is given the currency explicitly so an empty step list returns zero *of
 * something* rather than throwing or, worse, returning a currency-less number.
 */
export function totalAnnualisedImpact(report: PriceStepReport): Money {
  return sum(
    report.steps.map((s) => s.annualisedDelta),
    report.currency,
  )
}
