/**
 * Date parsing for institution email — the highest-yield silent-corruption risk in
 * the whole ingest layer.
 *
 * `12/07/26` is 12 July at SBI Card and 7 December at Chase. Both are valid dates,
 * both look right in a spot check, and a wrong one lands a transaction five months
 * away from where it belongs — which quietly breaks statement reconciliation, the
 * cash-flow simulator, and every month-over-month figure downstream.
 *
 * Two rules make that impossible to get wrong by accident:
 *
 *   1. **Field order is never inferred.** `parseSlashDate` demands an explicit
 *      `'MDY' | 'DMY'`, supplied as a per-parser constant. There is no "guess from
 *      the numbers" path, because guessing is right about 70% of the time — often
 *      enough to pass a casual test and fail in production.
 *
 *   2. **`Date` is never used for parsing.** `new Date('13/07/26')` and friends are
 *      implementation-defined, silently roll over out-of-range components, and read
 *      the host timezone. Components are validated against the real calendar here,
 *      and an impossible date throws.
 *
 * Calendar arithmetic itself is NOT redefined here. `daysInMonth`, ISO assembly and
 * ISO validation all come from `@/core/date`; this module only owns the part that is
 * genuinely ingest-specific — turning institution-formatted text into an `IsoDate`.
 */

import {
  daysInMonth,
  parseIsoDate,
  toIsoDate as coreToIsoDate,
  type IsoDate,
} from '@/core/date'

export { type IsoDate }

export class DateParseError extends Error {
  readonly raw: string
  constructor(raw: string, reason: string) {
    super(`Cannot parse ${JSON.stringify(raw)} as a date: ${reason}`)
    this.name = 'DateParseError'
    this.raw = raw
  }
}

/** Explicit field order of a slash/dash date. Supplied by the parser, never inferred. */
export type SlashDateOrder = 'MDY' | 'DMY'

const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/

/**
 * Two-digit years in transactional mail are always current-era: an alert about a
 * 1998 charge does not exist. Mapping to 19xx would put statements 100 years in the
 * past, which is worse than being wrong about a hypothetical antique.
 */
const TWO_DIGIT_YEAR_BASE = 2000

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** True only for a syntactically valid AND calendar-real `YYYY-MM-DD`. */
export function isValidIsoDate(value: string): boolean {
  try {
    parseIsoDate(value)
    return true
  } catch {
    // parseIsoDate throws InvalidDateError for anything not a real calendar date.
    // This predicate exists to answer that question, so the throw IS the answer —
    // it is not a swallowed failure.
    return false
  }
}

/**
 * Assemble a validated ISO date from numeric components.
 *
 * Wraps `@/core/date`'s assembler with range checks that report the ORIGINAL raw text,
 * because "13/07/26" is the thing a human has to look at, not "month 13".
 */
export function fromComponents(year: number, month: number, day: number, raw: string): IsoDate {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new DateParseError(raw, `year ${year} is implausible for a financial message`)
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new DateParseError(raw, `month ${month} is out of range 1-12`)
  }
  const limit = daysInMonth(year, month)
  if (!Number.isInteger(day) || day < 1 || day > limit) {
    throw new DateParseError(raw, `day ${day} is out of range 1-${limit} for month ${month}`)
  }
  return coreToIsoDate(year, month, day)
}

/**
 * Parse `MM/DD/YYYY`, `DD/MM/YY` and their dash/dot variants into `YYYY-MM-DD`.
 *
 * Throws rather than swapping fields when the stated order is impossible — `13/07/26`
 * read as MDY is a template change or a mislabelled parser, and both need a human.
 */
export function parseSlashDate(raw: string, order: SlashDateOrder): IsoDate {
  const trimmed = raw.trim()
  const m = SLASH_DATE.exec(trimmed)
  if (!m) throw new DateParseError(raw, 'expected a two- or three-part numeric date')

  const first = Number(m[1])
  const second = Number(m[2])
  const yearRaw = m[3] as string

  const year = yearRaw.length === 2 ? TWO_DIGIT_YEAR_BASE + Number(yearRaw) : Number(yearRaw)
  const month = order === 'MDY' ? first : second
  const day = order === 'MDY' ? second : first

  return fromComponents(year, month, day, trimmed)
}

/**
 * The UTC calendar date of an ISO-8601 instant.
 *
 * Used only as a labelled fallback when a message states no date of its own. The UTC
 * choice is arbitrary but must be *consistent*: a per-run local timezone would make
 * the same mailbox import differently on two machines.
 */
export function isoDateOfInstant(instant: string): IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(instant)) {
    throw new DateParseError(instant, 'expected an ISO-8601 instant (YYYY-MM-DDThh:mm...)')
  }
  const ms = Date.parse(instant)
  if (Number.isNaN(ms)) throw new DateParseError(instant, 'not a valid ISO-8601 instant')
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}
