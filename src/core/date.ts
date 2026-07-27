/**
 * Calendar arithmetic for the insight engine.
 *
 * Everything here operates on ISO `YYYY-MM-DD` strings in a fixed, timezone-free
 * calendar. There is no `Date.now()` anywhere in the engine: "today" is always an
 * argument, so every projection is reproducible and every test is deterministic.
 *
 * The reason this module exists at all rather than reaching for day-gap arithmetic
 * is design spec §9.3: a monthly charge lands 28-31 days apart, so any model built
 * on day gaps splits one stream into two. Cadence must be tested in calendar space.
 *
 * KNOWN LIMITATION, stated rather than hidden: "business day" here means
 * Monday-Friday. There is no public-holiday calendar, because holidays are
 * region- and institution-specific and a wrong one is worse than a documented
 * absent one. `lastBusinessDayOfMonth` can therefore be one or two days late
 * relative to a real settlement calendar; cadence matching absorbs that through
 * its date tolerance.
 */

export type IsoDate = string

export class InvalidDateError extends Error {
  constructor(value: unknown, reason: string) {
    super(`Invalid calendar date ${JSON.stringify(value)}: ${reason}. Expected YYYY-MM-DD.`)
    this.name = 'InvalidDateError'
  }
}

export interface CalendarDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

/** Days in a month. `month` is 1-based. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new InvalidDateError(`${year}-${month}`, 'month out of range')
  }
  // Day 0 of the following month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function parseIsoDate(iso: string): CalendarDate {
  if (typeof iso !== 'string') throw new InvalidDateError(iso, 'not a string')
  const m = ISO_PATTERN.exec(iso)
  if (!m) throw new InvalidDateError(iso, 'does not match YYYY-MM-DD')
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12) throw new InvalidDateError(iso, 'month out of range')
  if (day < 1 || day > daysInMonth(year, month)) throw new InvalidDateError(iso, 'day out of range')
  return { year, month, day }
}

export function toIsoDate(year: number, month: number, day: number): IsoDate {
  const yyyy = String(year).padStart(4, '0')
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toUtcMillis(iso: IsoDate): number {
  const { year, month, day } = parseIsoDate(iso)
  return Date.UTC(year, month - 1, day)
}

function fromUtcMillis(ms: number): IsoDate {
  const d = new Date(ms)
  return toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new InvalidDateError(days, 'day offset must be an integer')
  return fromUtcMillis(toUtcMillis(iso) + days * MS_PER_DAY)
}

/**
 * Add calendar months, clamping the day to the target month's length.
 *
 * Clamping is always measured from the ORIGINAL day, never from a previously
 * clamped result. Stepping Jan 31 forward one month at a time through a naive
 * implementation yields Jan 31 -> Feb 28 -> Mar 28, which silently loses the
 * end-of-month cadence. Callers projecting a series must always compute
 * `addMonths(anchor, k)` from the anchor, not iterate.
 */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  if (!Number.isInteger(months)) throw new InvalidDateError(months, 'month offset must be an integer')
  const { year, month, day } = parseIsoDate(iso)
  const totalMonths = year * 12 + (month - 1) + months
  const targetYear = Math.floor(totalMonths / 12)
  const targetMonth = totalMonths - targetYear * 12 + 1
  return toIsoDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)))
}

/** Signed difference in whole days: `to - from`. */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return (toUtcMillis(to) - toUtcMillis(from)) / MS_PER_DAY
}

/** ISO dates sort lexicographically, which is the whole point of the format. */
export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  parseIsoDate(a)
  parseIsoDate(b)
  return a === b ? 0 : a < b ? -1 : 1
}

export function minIsoDate(a: IsoDate, b: IsoDate): IsoDate {
  return compareIsoDates(a, b) <= 0 ? a : b
}

export function maxIsoDate(a: IsoDate, b: IsoDate): IsoDate {
  return compareIsoDates(a, b) >= 0 ? a : b
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(iso: IsoDate): number {
  return new Date(toUtcMillis(iso)).getUTCDay()
}

export function isWeekend(iso: IsoDate): boolean {
  const d = dayOfWeek(iso)
  return d === 0 || d === 6
}

/** Monday-Friday only — see the module note about holidays. */
export function lastBusinessDayOfMonth(year: number, month: number): IsoDate {
  let day = daysInMonth(year, month)
  let candidate = toIsoDate(year, month, day)
  while (isWeekend(candidate)) {
    day -= 1
    candidate = toIsoDate(year, month, day)
  }
  return candidate
}

export function isLastBusinessDayOfMonth(iso: IsoDate): boolean {
  const { year, month } = parseIsoDate(iso)
  return lastBusinessDayOfMonth(year, month) === iso
}

/** Inclusive on both ends. Throws rather than returning [] when the range is inverted. */
export function datesInRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const span = diffDays(from, to)
  if (span < 0) throw new InvalidDateError(`${from}..${to}`, 'range end precedes range start')
  const out: IsoDate[] = []
  for (let i = 0; i <= span; i++) out.push(addDays(from, i))
  return out
}

/** `YYYY-MM` — the grouping key for anything monthly. */
export function monthKey(iso: IsoDate): string {
  const { year, month } = parseIsoDate(iso)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

export function isWithin(iso: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return compareIsoDates(iso, from) >= 0 && compareIsoDates(iso, to) <= 0
}
