/**
 * Date helpers for the presentation layer.
 *
 * Every date crossing this boundary is a calendar day (`YYYY-MM-DD`), never an
 * instant. A checking balance is "as of the 24th" in the account's own calendar;
 * attaching a timezone to it would move the day for anyone east of the account.
 *
 * `daysBetween` is deliberately re-implemented here rather than imported from
 * `@/core/reconcile`: that module pulls in `node:crypto` for `dedupeKey`, and a
 * presentational primitive must stay importable from a client component.
 */

export class InvalidDateError extends Error {
  constructor(value: string, reason: string) {
    super(`Invalid calendar date ${JSON.stringify(value)}: ${reason}. Expected YYYY-MM-DD.`)
    this.name = 'InvalidDateError'
  }
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

export interface CalendarDay {
  readonly year: number
  readonly month: number
  readonly day: number
}

/** Parse and validate a `YYYY-MM-DD` day. Rejects 2026-02-30 and friends. */
export function parseDay(iso: string): CalendarDay {
  if (typeof iso !== 'string') throw new InvalidDateError(String(iso), 'not a string')
  const match = ISO_DAY.exec(iso)
  if (!match) throw new InvalidDateError(iso, 'does not match the YYYY-MM-DD shape')

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  const utc = new Date(Date.UTC(year, month - 1, day))
  // Date.UTC silently rolls 2026-02-30 forward to March 2nd. Round-tripping is the
  // only cheap way to catch that, and a silently-shifted date is exactly the class
  // of bug that makes a due-date calendar wrong by one day.
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new InvalidDateError(iso, 'is not a real calendar day')
  }

  return { year, month, day }
}

function toUtcMillis(iso: string): number {
  const { year, month, day } = parseDay(iso)
  return Date.UTC(year, month - 1, day)
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysApart(from: string, to: string): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / 86_400_000)
}

/** "Jul 24" — the compact form used in rows and chart axes. */
export function formatDay(iso: string, locale = 'en-US'): string {
  return new Date(toUtcMillis(iso)).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** "Jul 24, 2026" — used wherever a year could plausibly be ambiguous. */
export function formatFullDay(iso: string, locale = 'en-US'): string {
  return new Date(toUtcMillis(iso)).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * "today" / "in 3 days" / "5 days ago".
 *
 * Plain words rather than an abbreviation, because this string is frequently the
 * accessible name of a control and "3d" reads as nothing useful in a screen reader.
 */
export function relativeDayLabel(iso: string, today: string): string {
  const delta = daysApart(today, iso)
  if (delta === 0) return 'today'
  if (delta === 1) return 'tomorrow'
  if (delta === -1) return 'yesterday'
  if (delta > 0) return `in ${delta} days`
  return `${Math.abs(delta)} days ago`
}

/**
 * How stale an observation is, phrased for a coverage disclosure.
 * Spec §9.8 requires the as-of date to travel with every figure derived from it.
 */
export function stalenessLabel(observedAt: string, today: string): string {
  const age = daysApart(observedAt, today)
  if (age < 0) return `dated ${formatDay(observedAt)}, in the future`
  if (age === 0) return 'observed today'
  if (age === 1) return 'observed yesterday'
  return `observed ${age} days ago`
}
