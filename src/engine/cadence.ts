/**
 * Calendar-space cadences — design spec §9.3.
 *
 * The central claim of §9.3 is that periodicity must be tested in calendar space,
 * not as a day gap. A monthly charge lands 28-31 days apart; a day-gap model with a
 * tolerance wide enough to hold February together is also wide enough to merge a
 * 4-weekly stream into it, and one narrow enough to separate them splits January
 * from February. There is no tolerance that works. The fix is to stop modelling
 * "roughly 30 days" and start modelling "the 5th of the month", which is what the
 * biller is actually doing.
 *
 * A cadence is therefore a rule, and a `Recurrence` is that rule bound to an anchor
 * date. Occurrence `k` is always computed from the anchor, never by iterating from
 * the previous occurrence — see the note on `addMonths` in `@/core/date` for why
 * iteration silently destroys end-of-month cadences.
 */

import {
  addDays,
  addMonths,
  compareIsoDates,
  dayOfWeek,
  daysInMonth,
  diffDays,
  lastBusinessDayOfMonth,
  parseIsoDate,
  toIsoDate,
  type IsoDate,
} from '@/core/date'

export class InvalidCadenceError extends Error {
  constructor(reason: string) {
    super(`Invalid cadence: ${reason}`)
    this.name = 'InvalidCadenceError'
  }
}

export class CadenceRangeError extends Error {
  constructor(reason: string) {
    super(`Cadence expansion refused: ${reason}`)
    this.name = 'CadenceRangeError'
  }
}

export type Cadence =
  /** Same day-of-month every `intervalMonths`. Day is clamped to short months. */
  | { readonly kind: 'monthly'; readonly intervalMonths: number }
  /** Last Mon-Fri of every `intervalMonths` — payroll and many loan EMIs. */
  | { readonly kind: 'last_business_day'; readonly intervalMonths: number }
  /** Same weekday, every `intervalWeeks`. Covers 4-weekly, which is NOT monthly. */
  | { readonly kind: 'weekly'; readonly intervalWeeks: number }
  /** Twice a month: the anchor's day, then `secondDay`. US semi-monthly payroll. */
  | { readonly kind: 'semi_monthly'; readonly secondDay: number | 'last_business_day' }

export interface Recurrence {
  readonly cadence: Cadence
  /** The first occurrence. All other occurrences are computed relative to this. */
  readonly anchor: IsoDate
}

/**
 * Hard ceiling on how many occurrences a single expansion may produce.
 *
 * Without it, a weekly cadence over a ten-year horizon is a silent memory sink, and
 * a caller that passes a reversed range gets an unbounded loop instead of an error.
 */
const MAX_OCCURRENCES = 4000

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export function validateCadence(c: Cadence): void {
  switch (c.kind) {
    case 'monthly':
    case 'last_business_day':
      if (!Number.isInteger(c.intervalMonths) || c.intervalMonths < 1 || c.intervalMonths > 60) {
        throw new InvalidCadenceError(`intervalMonths must be an integer in 1..60, got ${c.intervalMonths}`)
      }
      return
    case 'weekly':
      if (!Number.isInteger(c.intervalWeeks) || c.intervalWeeks < 1 || c.intervalWeeks > 52) {
        throw new InvalidCadenceError(`intervalWeeks must be an integer in 1..52, got ${c.intervalWeeks}`)
      }
      return
    case 'semi_monthly':
      if (c.secondDay !== 'last_business_day') {
        if (!Number.isInteger(c.secondDay) || c.secondDay < 1 || c.secondDay > 31) {
          throw new InvalidCadenceError(`secondDay must be an integer in 1..31, got ${c.secondDay}`)
        }
      }
      return
  }
}

export function validateRecurrence(r: Recurrence): void {
  validateCadence(r.cadence)
  const anchor = parseIsoDate(r.anchor)
  if (r.cadence.kind === 'semi_monthly' && typeof r.cadence.secondDay === 'number') {
    if (r.cadence.secondDay <= anchor.day) {
      throw new InvalidCadenceError(
        `semi-monthly secondDay (${r.cadence.secondDay}) must fall after the anchor day (${anchor.day}); ` +
          `otherwise the two slots swap order and occurrence indices stop being monotonic`,
      )
    }
  }
}

function firstOfMonth(iso: IsoDate): IsoDate {
  const { year, month } = parseIsoDate(iso)
  return toIsoDate(year, month, 1)
}

/**
 * The `k`th occurrence, where `k = 0` is the anchor. Negative `k` walks backwards.
 *
 * Always derived from the anchor in one step, so `occurrence(r, 12)` of a Jan-31
 * monthly stream is Jan 31 again, not Feb 28 dragged forward twelve times.
 */
export function occurrence(r: Recurrence, k: number): IsoDate {
  validateRecurrence(r)
  if (!Number.isInteger(k)) throw new InvalidCadenceError(`occurrence index must be an integer, got ${k}`)
  const c = r.cadence

  switch (c.kind) {
    case 'monthly':
      return addMonths(r.anchor, k * c.intervalMonths)

    case 'weekly':
      return addDays(r.anchor, k * 7 * c.intervalWeeks)

    case 'last_business_day': {
      const base = addMonths(firstOfMonth(r.anchor), k * c.intervalMonths)
      const { year, month } = parseIsoDate(base)
      return lastBusinessDayOfMonth(year, month)
    }

    case 'semi_monthly': {
      // Two slots per month; index k alternates between them. Math.floor and the
      // double-modulo keep the mapping correct for negative k.
      const monthOffset = Math.floor(k / 2)
      const slot = ((k % 2) + 2) % 2
      const base = addMonths(firstOfMonth(r.anchor), monthOffset)
      const { year, month } = parseIsoDate(base)
      if (slot === 0) {
        const day = parseIsoDate(r.anchor).day
        return toIsoDate(year, month, Math.min(day, daysInMonth(year, month)))
      }
      if (c.secondDay === 'last_business_day') return lastBusinessDayOfMonth(year, month)
      return toIsoDate(year, month, Math.min(c.secondDay, daysInMonth(year, month)))
    }
  }
}

/**
 * Nominal spacing in days. Used only to bound the search when expanding a range —
 * never to decide whether two dates belong to the same stream.
 */
export function approximatePeriodDays(c: Cadence): number {
  validateCadence(c)
  switch (c.kind) {
    case 'monthly':
      return 30.436875 * c.intervalMonths
    case 'last_business_day':
      return 30.436875 * c.intervalMonths
    case 'weekly':
      return 7 * c.intervalWeeks
    case 'semi_monthly':
      return 30.436875 / 2
  }
}

/**
 * How many times a year this cadence fires. Fractional on purpose: annualising a
 * weekly price step at 52 understates it, because a year holds 52.18 weeks.
 */
export function occurrencesPerYear(c: Cadence): number {
  validateCadence(c)
  switch (c.kind) {
    case 'monthly':
    case 'last_business_day':
      return 12 / c.intervalMonths
    case 'weekly':
      return 365.25 / (7 * c.intervalWeeks)
    case 'semi_monthly':
      return 24
  }
}

/** Every occurrence in `[from, to]`, inclusive, ascending, deduplicated. */
export function occurrencesBetween(r: Recurrence, from: IsoDate, to: IsoDate): IsoDate[] {
  validateRecurrence(r)
  const span = diffDays(from, to)
  if (span < 0) {
    throw new CadenceRangeError(`range end ${to} precedes range start ${from}`)
  }

  const period = approximatePeriodDays(r.cadence)
  // Two extra steps of slack on each side absorb month-length variation and the
  // last-business-day walk-back, neither of which is exactly `period` days.
  const startK = Math.floor(diffDays(r.anchor, from) / period) - 2
  const endK = Math.ceil(diffDays(r.anchor, to) / period) + 2

  if (endK - startK + 1 > MAX_OCCURRENCES) {
    throw new CadenceRangeError(
      `${endK - startK + 1} occurrences over ${from}..${to} exceeds the ${MAX_OCCURRENCES} cap`,
    )
  }

  const seen = new Set<IsoDate>()
  for (let k = startK; k <= endK; k++) {
    const d = occurrence(r, k)
    if (compareIsoDates(d, from) >= 0 && compareIsoDates(d, to) <= 0) seen.add(d)
  }
  return [...seen].sort(compareIsoDates)
}

/** First occurrence on or after `date`. */
export function nextOccurrenceOnOrAfter(r: Recurrence, date: IsoDate): IsoDate {
  validateRecurrence(r)
  const period = approximatePeriodDays(r.cadence)
  let k = Math.floor(diffDays(r.anchor, date) / period) - 2
  const limit = k + MAX_OCCURRENCES
  for (; k <= limit; k++) {
    if (compareIsoDates(occurrence(r, k), date) >= 0) return occurrence(r, k)
  }
  throw new CadenceRangeError(`no occurrence found on or after ${date} within ${MAX_OCCURRENCES} steps`)
}

/**
 * Default date slack when matching observations to a cadence.
 *
 * Monthly billers shift off weekends and holidays by a day or three; weekly ones
 * rarely move at all, and a wide weekly window would start swallowing neighbouring
 * slots (7-day spacing leaves no room for +/-3).
 */
export function defaultDateToleranceDays(c: Cadence): number {
  validateCadence(c)
  switch (c.kind) {
    case 'monthly':
    case 'last_business_day':
      return 3
    case 'semi_monthly':
      return 2
    case 'weekly':
      return c.intervalWeeks === 1 ? 1 : 2
  }
}

export function describeCadence(c: Cadence): string {
  validateCadence(c)
  switch (c.kind) {
    case 'monthly':
      return c.intervalMonths === 1 ? 'monthly' : `every ${c.intervalMonths} months`
    case 'last_business_day':
      return c.intervalMonths === 1
        ? 'last business day of each month'
        : `last business day every ${c.intervalMonths} months`
    case 'weekly':
      return c.intervalWeeks === 1 ? 'weekly' : `every ${c.intervalWeeks} weeks`
    case 'semi_monthly':
      return 'twice monthly'
  }
}

export function describeRecurrence(r: Recurrence): string {
  validateRecurrence(r)
  const c = r.cadence
  const anchor = parseIsoDate(r.anchor)
  switch (c.kind) {
    case 'monthly':
      return `${describeCadence(c)} on day ${anchor.day}`
    case 'weekly':
      return `${describeCadence(c)} on ${WEEKDAY_NAMES[dayOfWeek(r.anchor)] ?? 'an unknown weekday'}`
    case 'last_business_day':
      return describeCadence(c)
    case 'semi_monthly':
      return `twice monthly on day ${anchor.day} and ${
        c.secondDay === 'last_business_day' ? 'the last business day' : `day ${c.secondDay}`
      }`
  }
}

/**
 * Cadences tried by stream detection, in tie-break priority order.
 *
 * Order matters and is part of the contract: when two cadences fit an observation
 * set equally well (common with only two or three points), the earlier one wins, so
 * detection output is stable across runs. Tight cadences come first because they
 * make the stronger claim and are the easier one to falsify with one more month of
 * data.
 */
export const DEFAULT_CANDIDATE_CADENCES: readonly Cadence[] = Object.freeze([
  { kind: 'weekly', intervalWeeks: 1 },
  { kind: 'weekly', intervalWeeks: 2 },
  { kind: 'semi_monthly', secondDay: 'last_business_day' },
  { kind: 'weekly', intervalWeeks: 4 },
  { kind: 'monthly', intervalMonths: 1 },
  { kind: 'last_business_day', intervalMonths: 1 },
  { kind: 'monthly', intervalMonths: 2 },
  { kind: 'monthly', intervalMonths: 3 },
  { kind: 'monthly', intervalMonths: 6 },
  { kind: 'monthly', intervalMonths: 12 },
])
