/**
 * Recurring-stream detection — design spec §9.3.
 *
 * Group by (merchant, account, direction), fit a calendar cadence, and walk the
 * status ladder candidate -> mature -> dormant -> cancelled.
 *
 * SPEC CORRECTION, recorded here rather than quietly worked around.
 *
 * §9.3 says two charges belong to the same stream when their amounts differ by no
 * more than `max(2%, floor)`. §9.4 then asks for step-change detection on a mature
 * stream's amount series. Taken literally these cannot both hold: a price step is by
 * definition a change larger than the tolerance, so a hard amount gate splits the
 * series at exactly the moment §9.4 wants to describe, and no mature stream ever
 * contains a step to detect.
 *
 * The resolution is that amount tolerance is a *contention* rule, not a membership
 * rule. Two distinct subscriptions at one merchant overlap in time and therefore
 * compete for the same cadence slot; a price step does not overlap itself. So:
 *
 *   - Cadence decides membership. One observation per expected slot.
 *   - When several observations contend for one slot, amount tolerance against the
 *     level currently in force picks the winner. The losers fall through to a second
 *     detection pass and become their own stream — which is how two subscriptions to
 *     the same merchant are separated.
 *   - A slot filled by an out-of-tolerance amount is recorded as a tolerance breach
 *     rather than a split. That list is precisely the price-step signal (§9.4).
 *   - A stream whose breaches outnumber `minAmountCoherence` is rejected outright.
 *     This is what keeps §9.3's "habitual-but-not-recurring" spend out: coffee three
 *     times a week fits a weekly cadence perfectly and fails amount coherence badly.
 *
 * Everything is deterministic. Ties break on cadence priority, then date, then id.
 */

import {
  addDays,
  compareIsoDates,
  diffDays,
  parseIsoDate,
  type IsoDate,
} from '@/core/date'
import { merchantKey, normalizeDescriptor, type Region } from '@/core/descriptor'
import { abs, compare, subtract, type Money } from '@/core/money'
import {
  DEFAULT_CANDIDATE_CADENCES,
  defaultDateToleranceDays,
  describeRecurrence,
  occurrencesBetween,
  type Cadence,
  type Recurrence,
} from './cadence'
import { type Confidence } from './confidence'
import {
  amountTolerance,
  medianMoney,
  resolveAbsoluteFloor,
  resolveRelativeTolerance,
  withinTolerance,
  type ToleranceConfig,
} from './tolerance'

export class RecurringInputError extends Error {
  constructor(reason: string) {
    super(`Recurring detection input rejected: ${reason}`)
    this.name = 'RecurringInputError'
  }
}

export type TransactionKind =
  | 'purchase'
  | 'deposit'
  | 'internal_transfer'
  | 'card_payment'
  | 'fee'
  | 'interest'
  | 'refund'

export interface EngineTransaction {
  readonly id: string
  readonly accountId: string
  readonly postedAt: IsoDate
  /** Signed: negative leaves the account, positive arrives. Zero is rejected. */
  readonly amount: Money
  readonly descriptorRaw: string
  readonly region?: Region
  readonly kind?: TransactionKind
}

export type StreamDirection = 'inflow' | 'outflow'
export type StreamStatus = 'candidate' | 'mature' | 'dormant' | 'cancelled'

export interface CancellationSignal {
  readonly accountId: string
  /** Must be the `merchantKey` of the cancelled merchant, not the raw descriptor. */
  readonly merchantKey: string
  readonly confirmedOn: IsoDate
  readonly sourceRef?: string
}

export interface StreamOccurrence {
  readonly transactionId: string
  readonly date: IsoDate
  readonly amount: Money
  /** Observed date minus expected date, in days. Signed. */
  readonly dateDeviationDays: number
  /** True when this amount fell outside tolerance of the level then in force. */
  readonly amountToleranceBreach: boolean
}

export interface RecurringStream {
  readonly streamKey: string
  readonly accountId: string
  readonly merchantKey: string
  readonly displayDescriptor: string
  readonly direction: StreamDirection
  readonly currency: string
  readonly cadence: Cadence
  readonly anchor: IsoDate
  readonly cadenceDescription: string
  readonly status: StreamStatus
  readonly occurrences: readonly StreamOccurrence[]
  /** Median observed amount, as a positive magnitude. */
  readonly expectedAmount: Money
  readonly amountTolerance: Money
  /** Expected slots inside the observed span with no matching charge. */
  readonly missedDates: readonly IsoDate[]
  readonly firstSeen: IsoDate
  readonly lastSeen: IsoDate
  readonly nextExpected?: IsoDate
  /** Expected slots between `lastSeen` and today that never arrived. */
  readonly consecutiveMissedSinceLastSeen: number
  readonly cancelledOn?: IsoDate
  readonly amountCoherence: number
  readonly confidence: Confidence
  readonly assumptions: readonly string[]
}

export type ExclusionReason =
  | 'internal_transfer'
  | 'card_payment'
  | 'zero_amount'
  | 'descriptor_heuristic'

export interface ExcludedTransaction {
  readonly transactionId: string
  readonly reason: ExclusionReason
  readonly detail: string
}

export interface RecurringDetectionResult {
  readonly today: IsoDate
  readonly streams: readonly RecurringStream[]
  readonly excluded: readonly ExcludedTransaction[]
  /** Transactions that reached grouping but fit no stream. Visible, not discarded. */
  readonly unassignedTransactionIds: readonly string[]
  readonly assumptions: readonly string[]
}

export interface RecurringDetectionOptions extends ToleranceConfig {
  readonly today: IsoDate
  readonly candidateCadences?: readonly Cadence[]
  /** Override the per-cadence default date slack. */
  readonly dateToleranceDays?: number
  readonly defaultRegion?: Region
  /** Minimum fraction of occurrences whose amount sat inside tolerance. */
  readonly minAmountCoherence?: number
  readonly cancellations?: readonly CancellationSignal[]
  /** Set false to rely solely on `kind` for transfer/payment exclusion. */
  readonly useDescriptorExclusionHeuristic?: boolean
}

const DEFAULT_MIN_AMOUNT_COHERENCE = 0.75

/**
 * Descriptor patterns that mark a row as an internal money movement.
 *
 * Kept deliberately narrow. A false exclusion silently hides a real subscription,
 * which is a worse failure than a false inclusion that the user can see and dismiss.
 * Matched against `normalizeDescriptor` output, which is `[a-z0-9 ]` only.
 */
const TRANSFER_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bautopay\b/,
  /\bpayment thank you\b/,
  /\bonline payment\b/,
  /\bcard payment\b/,
  /\bcredit card payment\b/,
  /\binternal transfer\b/,
  /\bfunds transfer\b/,
  /\btransfer to\b/,
  /\btransfer from\b/,
  /\bach transfer\b/,
  /\bzelle\b/,
  /\bneft\b/,
  /\brtgs\b/,
  /\bimps\b/,
])

interface Member {
  readonly tx: EngineTransaction
  readonly date: IsoDate
  /** Positive magnitude. */
  readonly amount: Money
}

interface Fit {
  readonly cadence: Cadence
  readonly cadenceIndex: number
  readonly anchor: IsoDate
  readonly matched: readonly { member: Member; expected: IsoDate; deviation: number; breach: boolean }[]
  readonly missed: readonly IsoDate[]
  readonly remainder: readonly Member[]
  readonly totalDeviation: number
  readonly breaches: number
}

function compareMembers(a: Member, b: Member): number {
  const byDate = compareIsoDates(a.date, b.date)
  if (byDate !== 0) return byDate
  return a.tx.id < b.tx.id ? -1 : a.tx.id > b.tx.id ? 1 : 0
}

function excludeReasonFor(
  tx: EngineTransaction,
  normalized: string,
  useHeuristic: boolean,
): ExcludedTransaction | undefined {
  if (tx.amount.minor === 0) {
    return {
      transactionId: tx.id,
      reason: 'zero_amount',
      detail: 'a zero-amount row has no direction and cannot anchor a stream',
    }
  }
  if (tx.kind === 'internal_transfer') {
    return { transactionId: tx.id, reason: 'internal_transfer', detail: 'declared kind' }
  }
  if (tx.kind === 'card_payment') {
    return { transactionId: tx.id, reason: 'card_payment', detail: 'declared kind' }
  }
  if (useHeuristic && tx.kind === undefined) {
    for (const p of TRANSFER_PATTERNS) {
      if (p.test(normalized)) {
        return {
          transactionId: tx.id,
          reason: 'descriptor_heuristic',
          detail: `descriptor "${normalized}" matched ${p.source}`,
        }
      }
    }
  }
  return undefined
}

/**
 * Fit one cadence to a date series anchored at its first member.
 *
 * Returns null when fewer than two observations land on expected slots — two is the
 * spec's minimum for a `candidate`, and one point is not a pattern.
 */
function fitCadence(
  members: readonly Member[],
  cadence: Cadence,
  cadenceIndex: number,
  tolDays: number,
  floor: Money,
  relative: number,
): Fit | null {
  const first = members[0]
  const last = members[members.length - 1]
  if (!first || !last) return null

  const recurrence: Recurrence = { cadence, anchor: first.date }
  let expectedDates: IsoDate[]
  try {
    expectedDates = occurrencesBetween(recurrence, first.date, last.date)
  } catch {
    // An anchor a cadence cannot legally take (semi-monthly anchored past its second
    // slot, say) simply means this cadence does not apply here.
    return null
  }

  const available = new Set<number>(members.map((_, i) => i))
  const matched: { member: Member; expected: IsoDate; deviation: number; breach: boolean }[] = []
  const missed: IsoDate[] = []
  let level: Money | undefined
  let totalDeviation = 0
  let breaches = 0

  for (const expected of expectedDates) {
    const candidates = [...available]
      .map((i) => ({ i, m: members[i] as Member }))
      .filter(({ m }) => Math.abs(diffDays(expected, m.date)) <= tolDays)

    if (candidates.length === 0) {
      missed.push(expected)
      continue
    }

    const tol = level === undefined ? undefined : amountTolerance(level, floor, relative)
    const inTolerance =
      tol === undefined || level === undefined
        ? []
        : candidates.filter(({ m }) => withinTolerance(m.amount, level as Money, tol))

    const pool = inTolerance.length > 0 ? inTolerance : candidates
    const chosen = pool
      .slice()
      .sort((x, y) => {
        const dx = Math.abs(diffDays(expected, x.m.date))
        const dy = Math.abs(diffDays(expected, y.m.date))
        if (dx !== dy) return dx - dy
        // With no level yet, prefer the smaller amount so the first stream extracted
        // from a contended merchant is a coherent one rather than an arbitrary mix.
        const byAmount = compare(x.m.amount, y.m.amount)
        if (byAmount !== 0) return byAmount
        return x.m.tx.id < y.m.tx.id ? -1 : 1
      })[0]

    if (!chosen) {
      missed.push(expected)
      continue
    }

    const breach = inTolerance.length === 0 && level !== undefined
    if (breach) breaches += 1
    const deviation = diffDays(expected, chosen.m.date)
    totalDeviation += Math.abs(deviation)
    matched.push({ member: chosen.m, expected, deviation, breach })
    available.delete(chosen.i)
    level = chosen.m.amount
  }

  if (matched.length < 2) return null

  return {
    cadence,
    cadenceIndex,
    anchor: first.date,
    matched,
    missed,
    remainder: [...available].sort((a, b) => a - b).map((i) => members[i] as Member),
    totalDeviation,
    breaches,
  }
}

/**
 * Rank two candidate fits. Coverage first, then how many expected slots went
 * unfilled, then amount coherence, then how far the dates had to stretch. The final
 * tie-break on cadence index is what makes detection reproducible when two cadences
 * genuinely fit equally well — common with only two or three observations.
 */
function compareFits(a: Fit, b: Fit): number {
  if (a.matched.length !== b.matched.length) return b.matched.length - a.matched.length
  if (a.missed.length !== b.missed.length) return a.missed.length - b.missed.length
  if (a.breaches !== b.breaches) return a.breaches - b.breaches
  if (a.totalDeviation !== b.totalDeviation) return a.totalDeviation - b.totalDeviation
  return a.cadenceIndex - b.cadenceIndex
}

function statusFor(
  occurrenceCount: number,
  consecutiveMissed: number,
  cancelledOn: IsoDate | undefined,
): StreamStatus {
  // Cancellation is an observed fact and outranks anything inferred from silence.
  if (cancelledOn) return 'cancelled'
  if (consecutiveMissed >= 2) return 'dormant'
  return occurrenceCount >= 3 ? 'mature' : 'candidate'
}

export function detectRecurringStreams(
  transactions: readonly EngineTransaction[],
  options: RecurringDetectionOptions,
): RecurringDetectionResult {
  parseIsoDate(options.today)
  const relative = resolveRelativeTolerance(options)
  const candidates = options.candidateCadences ?? DEFAULT_CANDIDATE_CADENCES
  if (candidates.length === 0) throw new RecurringInputError('candidateCadences must not be empty')
  const minCoherence = options.minAmountCoherence ?? DEFAULT_MIN_AMOUNT_COHERENCE
  if (!Number.isFinite(minCoherence) || minCoherence < 0 || minCoherence > 1) {
    throw new RecurringInputError(`minAmountCoherence must be in 0..1, got ${minCoherence}`)
  }
  const useHeuristic = options.useDescriptorExclusionHeuristic ?? true

  const excluded: ExcludedTransaction[] = []
  const groups = new Map<string, Member[]>()
  const groupMeta = new Map<
    string,
    { accountId: string; merchantKey: string; direction: StreamDirection; descriptor: string }
  >()

  const seenIds = new Set<string>()
  for (const tx of transactions) {
    if (seenIds.has(tx.id)) throw new RecurringInputError(`duplicate transaction id ${JSON.stringify(tx.id)}`)
    seenIds.add(tx.id)
    parseIsoDate(tx.postedAt)

    const region: Region = tx.region ?? options.defaultRegion ?? 'US'
    const normalized = normalizeDescriptor(tx.descriptorRaw, region)
    const exclusion = excludeReasonFor(tx, normalized, useHeuristic)
    if (exclusion) {
      excluded.push(exclusion)
      continue
    }

    const direction: StreamDirection = tx.amount.minor < 0 ? 'outflow' : 'inflow'
    const key = `${tx.accountId}\u0000${merchantKey(tx.descriptorRaw, region)}\u0000${direction}`
    const member: Member = { tx, date: tx.postedAt, amount: abs(tx.amount) }
    const bucket = groups.get(key)
    if (bucket) bucket.push(member)
    else {
      groups.set(key, [member])
      groupMeta.set(key, {
        accountId: tx.accountId,
        merchantKey: merchantKey(tx.descriptorRaw, region),
        direction,
        descriptor: normalized,
      })
    }
  }

  const streams: RecurringStream[] = []
  const unassigned: string[] = []

  for (const key of [...groups.keys()].sort()) {
    const meta = groupMeta.get(key)
    const all = groups.get(key)
    if (!meta || !all) continue

    const currencies = new Set(all.map((m) => m.amount.currency))
    if (currencies.size > 1) {
      throw new RecurringInputError(
        `account ${JSON.stringify(meta.accountId)} mixes currencies (${[...currencies].sort().join(', ')}) ` +
          `for merchant ${JSON.stringify(meta.merchantKey)}; one account holds one currency`,
      )
    }
    const currency = all[0]?.amount.currency
    if (currency === undefined) continue
    const floor = resolveAbsoluteFloor(meta.accountId, currency, options)

    let pool = all.slice().sort(compareMembers)
    let ordinal = 0

    while (pool.length >= 2) {
      const fits: Fit[] = []
      for (let i = 0; i < candidates.length; i++) {
        const cadence = candidates[i]
        if (!cadence) continue
        const tolDays = options.dateToleranceDays ?? defaultDateToleranceDays(cadence)
        const fit = fitCadence(pool, cadence, i, tolDays, floor, relative)
        if (fit) fits.push(fit)
      }
      fits.sort(compareFits)

      // Take the best-ranked fit whose amounts actually hang together. A fit whose
      // dates line up but whose amounts do not is habitual spend, not a subscription
      // — coffee three times a week fits a weekly cadence perfectly.
      const best = fits.find((f) => 1 - f.breaches / f.matched.length >= minCoherence)
      if (!best) break

      const stream = buildStream(best, meta, currency, floor, relative, options.today, ordinal, options.cancellations ?? [])
      streams.push(stream)
      ordinal += 1
      pool = best.remainder.slice().sort(compareMembers)
    }

    for (const m of pool) unassigned.push(m.tx.id)
  }

  return {
    today: options.today,
    streams: streams.sort((a, b) => (a.streamKey < b.streamKey ? -1 : a.streamKey > b.streamKey ? 1 : 0)),
    excluded: excluded.sort((a, b) => (a.transactionId < b.transactionId ? -1 : 1)),
    unassignedTransactionIds: unassigned.sort(),
    assumptions: [
      'Periodicity is tested in calendar space (day-of-month, weekday, last business day, ' +
        'every-N-weeks), never as a day gap.',
      'Amount tolerance resolves which charge occupies a contended slot; it does not split a ' +
        'stream, so a price step stays inside one stream and is reported by price-step detection.',
      `A stream is rejected when fewer than ${Math.round(minCoherence * 100)}% of its occurrences ` +
        `sat inside amount tolerance, which is what keeps habitual spend out.`,
      'Internal transfers and card payments are excluded; where a transaction carries no declared ' +
        'kind, a narrow descriptor heuristic is used and every exclusion is reported.',
    ],
  }
}

function buildStream(
  fit: Fit,
  meta: { accountId: string; merchantKey: string; direction: StreamDirection; descriptor: string },
  currency: string,
  floor: Money,
  relative: number,
  today: IsoDate,
  ordinal: number,
  cancellations: readonly CancellationSignal[],
): RecurringStream {
  const occurrences: StreamOccurrence[] = fit.matched.map((m) => ({
    transactionId: m.member.tx.id,
    date: m.member.date,
    amount: m.member.amount,
    dateDeviationDays: m.deviation,
    amountToleranceBreach: m.breach,
  }))

  const firstOcc = occurrences[0] as StreamOccurrence
  const lastOcc = occurrences[occurrences.length - 1] as StreamOccurrence
  const expectedAmount = medianMoney(occurrences.map((o) => o.amount))
  const tol = amountTolerance(expectedAmount, floor, relative)

  const recurrence: Recurrence = { cadence: fit.cadence, anchor: fit.anchor }
  const tolDays = defaultDateToleranceDays(fit.cadence)

  // An occurrence still inside its date tolerance today is not yet missed. Pulling
  // the window back by the tolerance is what stops a stream flickering to dormant on
  // the morning of its own due date.
  const missWindowEnd = addDays(today, -tolDays)
  const consecutiveMissed =
    compareIsoDates(missWindowEnd, addDays(lastOcc.date, 1)) < 0
      ? 0
      : occurrencesBetween(recurrence, addDays(lastOcc.date, 1), missWindowEnd).length

  const cancellation = cancellations.find(
    (c) =>
      c.accountId === meta.accountId &&
      c.merchantKey === meta.merchantKey &&
      compareIsoDates(c.confirmedOn, firstOcc.date) >= 0,
  )

  const status = statusFor(occurrences.length, consecutiveMissed, cancellation?.confirmedOn)

  let nextExpected: IsoDate | undefined
  if (status !== 'cancelled') {
    const lookahead = occurrencesBetween(
      recurrence,
      addDays(lastOcc.date, 1),
      addDays(today, 400),
    )
    nextExpected = lookahead.find((d) => compareIsoDates(d, today) >= 0) ?? lookahead[lookahead.length - 1]
  }

  const amountCoherence = 1 - fit.breaches / fit.matched.length
  const confidence: Confidence =
    status === 'candidate'
      ? 'low'
      : fit.missed.length === 0 && fit.breaches === 0 && occurrences.length >= 3
        ? 'high'
        : 'medium'

  const assumptions: string[] = [
    `Cadence inferred from ${occurrences.length} observation(s): ${describeRecurrence(recurrence)}.`,
  ]
  if (fit.missed.length > 0) {
    assumptions.push(
      `${fit.missed.length} expected charge(s) inside the observed span never appeared ` +
        `(${fit.missed.join(', ')}); the stream is treated as continuing.`,
    )
  }
  if (fit.breaches > 0) {
    assumptions.push(
      `${fit.breaches} occurrence(s) fell outside the amount tolerance of ${tol.minor} minor units; ` +
        `run price-step detection on this stream before quoting an expected amount.`,
    )
  }
  if (status === 'candidate') {
    assumptions.push('Only two occurrences seen — the cadence is a guess until a third arrives.')
  }
  if (status === 'dormant') {
    assumptions.push(
      `${consecutiveMissed} expected charge(s) have been missed since ${lastOcc.date}; the stream ` +
        `may have been cancelled without a confirmation email.`,
    )
  }

  const stream: RecurringStream = {
    streamKey: `${meta.accountId}|${meta.merchantKey}|${meta.direction}|${ordinal}`,
    accountId: meta.accountId,
    merchantKey: meta.merchantKey,
    displayDescriptor: meta.descriptor,
    direction: meta.direction,
    currency,
    cadence: fit.cadence,
    anchor: fit.anchor,
    cadenceDescription: describeRecurrence(recurrence),
    status,
    occurrences,
    expectedAmount,
    amountTolerance: tol,
    missedDates: fit.missed,
    firstSeen: firstOcc.date,
    lastSeen: lastOcc.date,
    consecutiveMissedSinceLastSeen: consecutiveMissed,
    amountCoherence,
    confidence,
    assumptions,
    ...(nextExpected === undefined ? {} : { nextExpected }),
    ...(cancellation === undefined ? {} : { cancelledOn: cancellation.confirmedOn }),
  }
  return stream
}

/** The dated amount series of a stream, ready for `detectPriceSteps`. */
export function amountSeries(
  stream: RecurringStream,
): { date: IsoDate; amount: Money; transactionId: string }[] {
  return stream.occurrences.map((o) => ({
    date: o.date,
    amount: o.amount,
    transactionId: o.transactionId,
  }))
}

/** Largest absolute amount gap inside a stream — a cheap "is a step likely here" probe. */
export function amountSpread(stream: RecurringStream): Money {
  const amounts = stream.occurrences.map((o) => o.amount)
  const sorted = [...amounts].sort((a, b) => compare(a, b))
  const lo = sorted[0]
  const hi = sorted[sorted.length - 1]
  if (!lo || !hi) throw new RecurringInputError('stream has no occurrences')
  return subtract(hi, lo)
}
