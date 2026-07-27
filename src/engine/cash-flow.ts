/**
 * Cash-flow timing simulator — design spec §9.2, the core differentiator.
 *
 * Project a checking balance forward day by day over a horizon, flag every point
 * below a floor, and for each collision compute the minimal single change that
 * clears it. No merchant names, no categorisation, no model — just dated arithmetic
 * that would have caught July's failed bill.
 *
 * Three properties this module holds to, because a projection that is wrong in an
 * invisible way is worse than no projection at all:
 *
 *   1. **Reproducible.** "Today" is a parameter. `Date.now()` appears nowhere. The
 *      same inputs always produce the same output, including tie-breaks, which is
 *      why every ordering here has an explicit final tie-break on id.
 *
 *   2. **A remedy is verified, not proposed.** Every remedy returned has been
 *      re-simulated end to end and shown to clear its collision without opening a
 *      new one. Suggesting "move this to the 16th" without checking is how you tell
 *      someone to bounce a different payment instead.
 *
 *   3. **Conservative within the day.** Debits are applied before credits on the
 *      same date. A bill and a paycheque landing on the same day is exactly the
 *      situation where optimism costs an overdraft fee, and no bank guarantees
 *      ordering. This is stated as an assumption on every projection rather than
 *      buried here.
 */

import {
  addDays,
  compareIsoDates,
  diffDays,
  isWithin,
  parseIsoDate,
  type IsoDate,
} from '@/core/date'
import { add, compare, money, subtract, sum, toDecimalString, zero, type Money } from '@/core/money'
import { occurrencesBetween, validateRecurrence, type Recurrence } from './cadence'
import { weakestConfidence, type Confidence } from './confidence'

export class CashFlowInputError extends Error {
  constructor(reason: string) {
    super(`Cash-flow input rejected: ${reason}`)
    this.name = 'CashFlowInputError'
  }
}

export class CashFlowCurrencyError extends Error {
  constructor(itemId: string, expected: string, actual: string) {
    super(
      `Cash-flow item ${JSON.stringify(itemId)} is denominated in ${actual} but the projected ` +
        `account is in ${expected}. A single balance cannot span currencies — run one ` +
        `projection per currency.`,
    )
    this.name = 'CashFlowCurrencyError'
  }
}

export type EventDirection = 'inflow' | 'outflow'

export interface Obligation {
  readonly id: string
  readonly label: string
  readonly dueOn: IsoDate
  /** Positive magnitude of money leaving the account. */
  readonly amount: Money
  readonly accountId?: string
  /** Whether the due date can be shifted at all. Non-movable obligations are fixed. */
  readonly movable?: boolean
  /** Latest date it can move to without penalty — a grace-period end, typically. */
  readonly latestMoveTo?: IsoDate
  /** Paying this instead of the full amount is permitted (a card's minimum due). */
  readonly minimumDue?: Money
  readonly confidence?: Confidence
  readonly assumptions?: readonly string[]
}

export interface DatedInflow {
  readonly id: string
  readonly label: string
  readonly expectedOn: IsoDate
  readonly amount: Money
  readonly confidence?: Confidence
  readonly assumptions?: readonly string[]
}

export interface RecurringInflow {
  readonly id: string
  readonly label: string
  readonly recurrence: Recurrence
  readonly amount: Money
  readonly confidence?: Confidence
  readonly assumptions?: readonly string[]
  /** Stop projecting after this date (a fixed-term contract, a maturing deposit). */
  readonly endsOn?: IsoDate
}

export interface CashFlowRequest {
  readonly today: IsoDate
  readonly horizonDays: number
  readonly openingBalance: Money
  /** Projected balance must stay at or above this. May be zero or negative. */
  readonly floor: Money
  readonly obligations?: readonly Obligation[]
  readonly inflows?: readonly DatedInflow[]
  readonly recurringInflows?: readonly RecurringInflow[]
  /** How far past its due date a payment may be pushed when searching for a remedy. */
  readonly maxDeferralDays?: number
}

export interface ProjectedEvent {
  readonly id: string
  readonly label: string
  readonly direction: EventDirection
  readonly amount: Money
  readonly confidence: Confidence
  /** Set when the event came from an obligation, so remedies can point back at it. */
  readonly obligationId?: string
}

export interface ProjectedDay {
  readonly date: IsoDate
  readonly opening: Money
  readonly outflows: Money
  readonly inflows: Money
  /** Balance after the day's debits but before its credits — the exposed point. */
  readonly intradayLow: Money
  readonly closing: Money
  readonly belowFloor: boolean
  /** `floor - intradayLow` when below, otherwise zero. */
  readonly shortfall: Money
  readonly events: readonly ProjectedEvent[]
}

export interface Collision {
  readonly from: IsoDate
  readonly to: IsoDate
  readonly worstDate: IsoDate
  readonly worstBalance: Money
  /** How much extra money at `worstDate` would clear the whole collision. */
  readonly shortfall: Money
  readonly obligationIds: readonly string[]
  readonly triggeringEventIds: readonly string[]
}

export type RemedyKind = 'move_payment' | 'pay_minimum'

export interface Remedy {
  readonly kind: RemedyKind
  readonly obligationId: string
  readonly label: string
  readonly fromDate: IsoDate
  /** Present for `move_payment`. */
  readonly toDate?: IsoDate
  readonly originalAmount: Money
  /** Present for `pay_minimum`: what is paid now. */
  readonly reducedAmount?: Money
  /** Present for `pay_minimum`: what is left owing. */
  readonly deferredAmount?: Money
  readonly displacementDays: number
  /** Always true — an unverified remedy is never returned. */
  readonly clearsCollision: true
  /** True when the horizon has no breach at all after the change. */
  readonly clearsAllBreaches: boolean
  readonly resultingWorstBalance: Money
  readonly explanation: string
}

export interface CollisionWithRemedies extends Collision {
  readonly remedies: readonly Remedy[]
  /** The minimal verified change, or undefined when no single change suffices. */
  readonly bestRemedy?: Remedy
}

export interface FlaggedInput {
  readonly id: string
  readonly label: string
  readonly confidence: Confidence
  readonly reason: string
}

export interface CashFlowProjection {
  readonly today: IsoDate
  readonly from: IsoDate
  readonly to: IsoDate
  readonly horizonDays: number
  readonly currency: string
  readonly openingBalance: Money
  readonly floor: Money
  readonly days: readonly ProjectedDay[]
  readonly collisions: readonly CollisionWithRemedies[]
  readonly lowestBalance: Money
  readonly lowestBalanceOn: IsoDate
  readonly closingBalance: Money
  readonly confidence: Confidence
  readonly assumptions: readonly string[]
  readonly lowConfidenceInputs: readonly FlaggedInput[]
  /** Obligations dated outside the horizon, so their absence is visible, not silent. */
  readonly outOfHorizonObligationIds: readonly string[]
}

const MAX_HORIZON_DAYS = 1095
const DEFAULT_MAX_DEFERRAL_DAYS = 90

const BASE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Debits are assumed to clear before credits post on the same calendar day, so a payment ' +
    'landing on a payday is not covered by that payday deposit.',
  'Interest, fees, and unplanned discretionary spending are not modelled; the projection ' +
    'covers only the obligations and inflows supplied.',
  'Amounts already in flight but not yet reflected in the opening balance are not included.',
])

interface SimEvent {
  readonly date: IsoDate
  readonly event: ProjectedEvent
}

interface SimResult {
  readonly days: ProjectedDay[]
  readonly lowest: Money
  readonly lowestOn: IsoDate
  readonly closing: Money
  readonly breachDates: ReadonlySet<IsoDate>
}

function assertCurrency(itemId: string, amount: Money, expected: string): void {
  if (amount.currency !== expected) {
    throw new CashFlowCurrencyError(itemId, expected, amount.currency)
  }
}

function assertNonNegative(itemId: string, amount: Money): void {
  if (amount.minor < 0) {
    throw new CashFlowInputError(
      `${JSON.stringify(itemId)} has amount ${toDecimalString(amount)}; obligations and inflows ` +
        `are magnitudes, and direction is carried by which list they are in`,
    )
  }
}

/**
 * Order events within a day.
 *
 * Outflows first (see the conservatism note at the top), then by id so that two
 * runs over the same data produce byte-identical output.
 */
function compareEvents(a: ProjectedEvent, b: ProjectedEvent): number {
  if (a.direction !== b.direction) return a.direction === 'outflow' ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function simulate(
  from: IsoDate,
  to: IsoDate,
  opening: Money,
  floor: Money,
  events: readonly SimEvent[],
): SimResult {
  const currency = opening.currency
  const byDate = new Map<IsoDate, ProjectedEvent[]>()
  for (const e of events) {
    const bucket = byDate.get(e.date)
    if (bucket) bucket.push(e.event)
    else byDate.set(e.date, [e.event])
  }

  const days: ProjectedDay[] = []
  const breachDates = new Set<IsoDate>()
  let balance = opening
  let lowest = opening
  let lowestOn = from

  const span = diffDays(from, to)
  for (let i = 0; i <= span; i++) {
    const date = addDays(from, i)
    const dayEvents = (byDate.get(date) ?? []).slice().sort(compareEvents)

    const outflowAmounts = dayEvents.filter((e) => e.direction === 'outflow').map((e) => e.amount)
    const inflowAmounts = dayEvents.filter((e) => e.direction === 'inflow').map((e) => e.amount)
    const outflows = sum(outflowAmounts, currency)
    const inflows = sum(inflowAmounts, currency)

    const dayOpening = balance
    const intradayLow = subtract(dayOpening, outflows)
    const closing = add(intradayLow, inflows)

    const belowFloor = compare(intradayLow, floor) < 0
    if (belowFloor) breachDates.add(date)

    days.push({
      date,
      opening: dayOpening,
      outflows,
      inflows,
      intradayLow,
      closing,
      belowFloor,
      shortfall: belowFloor ? subtract(floor, intradayLow) : zero(currency),
      events: dayEvents,
    })

    if (compare(intradayLow, lowest) < 0) {
      lowest = intradayLow
      lowestOn = date
    }
    balance = closing
  }

  return { days, lowest, lowestOn, closing: balance, breachDates }
}

function buildBaseEvents(
  req: CashFlowRequest,
  from: IsoDate,
  to: IsoDate,
  currency: string,
): { events: SimEvent[]; outOfHorizon: string[]; flagged: FlaggedInput[] } {
  const events: SimEvent[] = []
  const outOfHorizon: string[] = []
  const flagged: FlaggedInput[] = []

  for (const o of req.obligations ?? []) {
    assertCurrency(o.id, o.amount, currency)
    assertNonNegative(o.id, o.amount)
    parseIsoDate(o.dueOn)
    if (o.minimumDue) {
      assertCurrency(`${o.id}.minimumDue`, o.minimumDue, currency)
      assertNonNegative(`${o.id}.minimumDue`, o.minimumDue)
      if (compare(o.minimumDue, o.amount) > 0) {
        throw new CashFlowInputError(
          `${JSON.stringify(o.id)} has a minimum due (${toDecimalString(o.minimumDue)}) larger ` +
            `than the amount owed (${toDecimalString(o.amount)})`,
        )
      }
    }
    if (!isWithin(o.dueOn, from, to)) {
      outOfHorizon.push(o.id)
      continue
    }
    const confidence = o.confidence ?? 'high'
    if (confidence !== 'high') {
      flagged.push({
        id: o.id,
        label: o.label,
        confidence,
        reason: 'obligation amount or due date is inferred rather than confirmed',
      })
    }
    events.push({
      date: o.dueOn,
      event: {
        id: `obligation:${o.id}`,
        label: o.label,
        direction: 'outflow',
        amount: o.amount,
        confidence,
        obligationId: o.id,
      },
    })
  }

  for (const inflow of req.inflows ?? []) {
    assertCurrency(inflow.id, inflow.amount, currency)
    assertNonNegative(inflow.id, inflow.amount)
    parseIsoDate(inflow.expectedOn)
    if (!isWithin(inflow.expectedOn, from, to)) continue
    const confidence = inflow.confidence ?? 'high'
    if (confidence !== 'high') {
      flagged.push({
        id: inflow.id,
        label: inflow.label,
        confidence,
        reason: 'inflow is expected but not confirmed',
      })
    }
    events.push({
      date: inflow.expectedOn,
      event: {
        id: `inflow:${inflow.id}`,
        label: inflow.label,
        direction: 'inflow',
        amount: inflow.amount,
        confidence,
      },
    })
  }

  for (const r of req.recurringInflows ?? []) {
    assertCurrency(r.id, r.amount, currency)
    assertNonNegative(r.id, r.amount)
    validateRecurrence(r.recurrence)
    const last = r.endsOn && compareIsoDates(r.endsOn, to) < 0 ? r.endsOn : to
    if (compareIsoDates(last, from) < 0) continue
    // A detected stream is an inference by construction, so it is never 'high'
    // unless the caller explicitly vouches for it.
    const confidence = r.confidence ?? 'medium'
    if (confidence !== 'high') {
      flagged.push({
        id: r.id,
        label: r.label,
        confidence,
        reason: 'recurring inflow is projected from detected history, not a confirmed deposit',
      })
    }
    for (const date of occurrencesBetween(r.recurrence, from, last)) {
      events.push({
        date,
        event: {
          id: `recurring:${r.id}:${date}`,
          label: r.label,
          direction: 'inflow',
          amount: r.amount,
          confidence,
        },
      })
    }
  }

  return { events, outOfHorizon, flagged }
}

function findCollisions(days: readonly ProjectedDay[], currency: string): Collision[] {
  const collisions: Collision[] = []
  let runStart: number | null = null

  const close = (startIdx: number, endIdx: number): void => {
    const window = days.slice(startIdx, endIdx + 1)
    const firstDay = window[0]
    const lastDay = window[window.length - 1]
    if (!firstDay || !lastDay) return

    let worst = firstDay
    for (const d of window) {
      if (compare(d.intradayLow, worst.intradayLow) < 0) worst = d
    }

    const obligationIds: string[] = []
    const triggeringEventIds: string[] = []
    for (const d of window) {
      for (const e of d.events) {
        if (e.direction !== 'outflow') continue
        triggeringEventIds.push(e.id)
        if (e.obligationId && !obligationIds.includes(e.obligationId)) obligationIds.push(e.obligationId)
      }
    }

    collisions.push({
      from: firstDay.date,
      to: lastDay.date,
      worstDate: worst.date,
      worstBalance: worst.intradayLow,
      // The deepest point governs: clearing it clears every shallower day in the run.
      shortfall: worst.shortfall.minor === 0 ? zero(currency) : worst.shortfall,
      obligationIds,
      triggeringEventIds,
    })
  }

  for (let i = 0; i < days.length; i++) {
    const d = days[i]
    if (!d) continue
    if (d.belowFloor) {
      if (runStart === null) runStart = i
    } else if (runStart !== null) {
      close(runStart, i - 1)
      runStart = null
    }
  }
  if (runStart !== null) close(runStart, days.length - 1)

  return collisions
}

/** A trial passes only if it clears the target window and opens no new breach day. */
function trialClears(
  trial: SimResult,
  collision: Collision,
  baselineBreaches: ReadonlySet<IsoDate>,
): boolean {
  for (const date of trial.breachDates) {
    if (isWithin(date, collision.from, collision.to)) return false
    if (!baselineBreaches.has(date)) return false
  }
  return true
}

function rankRemedies(a: Remedy, b: Remedy): number {
  if (a.clearsAllBreaches !== b.clearsAllBreaches) return a.clearsAllBreaches ? -1 : 1
  const kindRank = (k: RemedyKind): number => (k === 'move_payment' ? 0 : 1)
  if (kindRank(a.kind) !== kindRank(b.kind)) return kindRank(a.kind) - kindRank(b.kind)
  if (a.displacementDays !== b.displacementDays) return a.displacementDays - b.displacementDays
  if (a.obligationId !== b.obligationId) return a.obligationId < b.obligationId ? -1 : 1
  return (a.toDate ?? '').localeCompare(b.toDate ?? '')
}

function remediesFor(
  collision: Collision,
  req: CashFlowRequest,
  from: IsoDate,
  to: IsoDate,
  baseEvents: readonly SimEvent[],
  baselineBreaches: ReadonlySet<IsoDate>,
): Remedy[] {
  const currency = req.openingBalance.currency
  const maxDeferral = req.maxDeferralDays ?? DEFAULT_MAX_DEFERRAL_DAYS
  const found: Remedy[] = []

  // Only obligations that land on or before the end of the collision can be part of
  // its cause; deferring a later one changes nothing about the window.
  // NOT filtered on `movable` here. Movability gates only the move_payment branch
  // below; paying the contractual minimum keeps the due date and shrinks the debit,
  // so it is available on obligations that cannot be rescheduled at all — which is
  // precisely the case where the user most needs an option.
  const candidates = (req.obligations ?? [])
    .filter((o) => isWithin(o.dueOn, from, to))
    .filter((o) => compareIsoDates(o.dueOn, collision.to) <= 0)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const o of candidates) {
    const others = baseEvents.filter((e) => e.event.obligationId !== o.id)

    // --- move_payment: scan forward for the earliest date that works. ---
    const hardLimit = o.latestMoveTo ?? addDays(o.dueOn, maxDeferral)
    const lastTarget = [addDays(o.dueOn, maxDeferral), hardLimit, to].reduce((acc, d) =>
      compareIsoDates(d, acc) < 0 ? d : acc,
    )

    let moveRemedy: Remedy | undefined
    const scanStart = o.movable === true ? addDays(o.dueOn, 1) : addDays(lastTarget, 1)
    for (let d = scanStart; compareIsoDates(d, lastTarget) <= 0; d = addDays(d, 1)) {
      const trial = simulate(from, to, req.openingBalance, req.floor, [
        ...others,
        {
          date: d,
          event: {
            id: `obligation:${o.id}`,
            label: o.label,
            direction: 'outflow',
            amount: o.amount,
            confidence: o.confidence ?? 'high',
            obligationId: o.id,
          },
        },
      ])
      if (!trialClears(trial, collision, baselineBreaches)) continue
      moveRemedy = {
        kind: 'move_payment',
        obligationId: o.id,
        label: o.label,
        fromDate: o.dueOn,
        toDate: d,
        originalAmount: o.amount,
        displacementDays: diffDays(o.dueOn, d),
        clearsCollision: true,
        clearsAllBreaches: trial.breachDates.size === 0,
        resultingWorstBalance: trial.lowest,
        explanation:
          `Move ${o.label} (${toDecimalString(o.amount)} ${currency}) from ${o.dueOn} to ${d}. ` +
          `Projected low over the horizon becomes ${toDecimalString(trial.lowest)} ${currency}.`,
      }
      break
    }
    if (moveRemedy) found.push(moveRemedy)

    // --- pay_minimum: keep the date, shrink the debit to the contractual minimum. ---
    const minimum = o.minimumDue
    if (minimum && compare(minimum, o.amount) < 0) {
      const trial = simulate(from, to, req.openingBalance, req.floor, [
        ...others,
        {
          date: o.dueOn,
          event: {
            id: `obligation:${o.id}`,
            label: `${o.label} (minimum)`,
            direction: 'outflow',
            amount: minimum,
            confidence: o.confidence ?? 'high',
            obligationId: o.id,
          },
        },
      ])
      if (trialClears(trial, collision, baselineBreaches)) {
        const deferred = subtract(o.amount, minimum)
        found.push({
          kind: 'pay_minimum',
          obligationId: o.id,
          label: o.label,
          fromDate: o.dueOn,
          originalAmount: o.amount,
          reducedAmount: minimum,
          deferredAmount: deferred,
          displacementDays: 0,
          clearsCollision: true,
          clearsAllBreaches: trial.breachDates.size === 0,
          resultingWorstBalance: trial.lowest,
          explanation:
            `Pay the minimum of ${toDecimalString(minimum)} ${currency} on ${o.label} on ${o.dueOn} ` +
            `instead of ${toDecimalString(o.amount)} ${currency}, leaving ${toDecimalString(deferred)} ` +
            `${currency} to revolve. Projected low becomes ${toDecimalString(trial.lowest)} ${currency}.`,
        })
      }
    }
  }

  return found.sort(rankRemedies)
}

/**
 * Project the balance forward and solve every collision it finds.
 *
 * Throws rather than coercing on any input problem: a mixed-currency obligation
 * list or a negative "amount" is a caller bug, and the wrong answer here is one
 * someone would act on.
 */
export function projectCashFlow(req: CashFlowRequest): CashFlowProjection {
  const currency = req.openingBalance.currency
  parseIsoDate(req.today)
  assertCurrency('<floor>', req.floor, currency)

  if (!Number.isInteger(req.horizonDays) || req.horizonDays < 1 || req.horizonDays > MAX_HORIZON_DAYS) {
    throw new CashFlowInputError(
      `horizonDays must be an integer in 1..${MAX_HORIZON_DAYS}, got ${req.horizonDays}`,
    )
  }
  if (req.maxDeferralDays !== undefined) {
    if (!Number.isInteger(req.maxDeferralDays) || req.maxDeferralDays < 1) {
      throw new CashFlowInputError(`maxDeferralDays must be a positive integer, got ${req.maxDeferralDays}`)
    }
  }

  const from = req.today
  const to = addDays(from, req.horizonDays)

  const { events, outOfHorizon, flagged } = buildBaseEvents(req, from, to, currency)
  const base = simulate(from, to, req.openingBalance, req.floor, events)
  const collisions = findCollisions(base.days, currency)

  const withRemedies: CollisionWithRemedies[] = collisions.map((c) => {
    const remedies = remediesFor(c, req, from, to, events, base.breachDates)
    const best = remedies[0]
    return best ? { ...c, remedies, bestRemedy: best } : { ...c, remedies }
  })

  const inputConfidences: Confidence[] = events.map((e) => e.event.confidence)
  const assumptions = new Set<string>(BASE_ASSUMPTIONS)
  for (const o of req.obligations ?? []) for (const a of o.assumptions ?? []) assumptions.add(a)
  for (const i of req.inflows ?? []) for (const a of i.assumptions ?? []) assumptions.add(a)
  for (const r of req.recurringInflows ?? []) for (const a of r.assumptions ?? []) assumptions.add(a)

  if ((req.inflows ?? []).length === 0 && (req.recurringInflows ?? []).length === 0) {
    assumptions.add(
      'No inflows were supplied, so this projection is a pure drawdown and will understate the ' +
        'balance if income is expected during the horizon.',
    )
  }
  if (outOfHorizon.length > 0) {
    assumptions.add(
      `${outOfHorizon.length} obligation(s) fall outside ${from}..${to} and are excluded: ` +
        `${outOfHorizon.slice().sort().join(', ')}.`,
    )
  }

  return {
    today: req.today,
    from,
    to,
    horizonDays: req.horizonDays,
    currency,
    openingBalance: req.openingBalance,
    floor: req.floor,
    days: base.days,
    collisions: withRemedies,
    lowestBalance: base.lowest,
    lowestBalanceOn: base.lowestOn,
    closingBalance: base.closing,
    // An empty horizon has nothing to be uncertain about; anything else inherits its
    // weakest input, and an absent inflow list is itself a low-confidence situation.
    confidence:
      inputConfidences.length === 0
        ? 'high'
        : weakestConfidence(
            (req.inflows ?? []).length === 0 && (req.recurringInflows ?? []).length === 0
              ? [...inputConfidences, 'low']
              : inputConfidences,
          ),
    assumptions: [...assumptions],
    lowConfidenceInputs: flagged,
    outOfHorizonObligationIds: outOfHorizon,
  }
}

/** Convenience for UI copy: the balance on a given date, or undefined outside the horizon. */
export function balanceOn(projection: CashFlowProjection, date: IsoDate): Money | undefined {
  return projection.days.find((d) => d.date === date)?.closing
}

/** Total money leaving the account over the horizon, in the projection's currency. */
export function totalOutflows(projection: CashFlowProjection): Money {
  return sum(
    projection.days.map((d) => d.outflows),
    projection.currency,
  )
}

/** Total money arriving over the horizon, in the projection's currency. */
export function totalInflows(projection: CashFlowProjection): Money {
  return sum(
    projection.days.map((d) => d.inflows),
    projection.currency,
  )
}

/** Exposed for callers that want to build a floor from a plain minor-unit figure. */
export function floorOf(minor: number, currency: string): Money {
  return money(minor, currency)
}
