/**
 * Row types and domain types for the Finapp store.
 *
 * The two layers are deliberately separate:
 *
 *   Row types  mirror the SQLite columns exactly — snake_case, `0 | 1` for booleans,
 *              `amount_minor` + `currency` as two independent scalars.
 *   Domain     types are what the rest of the app is allowed to touch — camelCase,
 *              real booleans, and a single `Money` where the row had a column pair.
 *
 * Nothing outside `src/db` should ever see a row type. The moment a bare
 * `amount_minor: number` escapes the repository layer, someone adds it to a number from
 * a different currency and the bug is invisible.
 */

import type { Money } from '@/core/money'
import { money } from '@/core/money'
import type { IsoDate } from '@/core/date'
import type { Region } from '@/core/descriptor'
import type { SourceType } from '@/core/reconcile'

export type { Money, IsoDate, Region, SourceType }

/** ISO-8601 UTC instant, e.g. `2026-07-26T14:03:11.482Z`. Matches the schema's GLOB check. */
export type IsoInstant = string

/** `YYYY-MM` — the granularity of a budget period (schema: `budgets.period_month`). */
export type MonthKey = string

/**
 * Largest magnitude a `*_minor` column may hold. SQLite stores 64-bit integers but
 * JavaScript numbers lose precision past 2^53-1, so the schema CHECKs this range and the
 * repositories re-check before writing — a value that would round on read is rejected at
 * the boundary rather than silently corrupted.
 */
export const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER

/**
 * Holding units are stored as integers scaled by 1e6 (`holding_lots.units_micro`).
 * AMFI publishes fund units to three decimals; six gives headroom without putting a
 * float upstream of a money calculation.
 */
export const UNITS_SCALE = 1_000_000

/**
 * Instrument prices are stored as minor units scaled by 1e4 (`valuations.price_minor_e4`).
 * A NAV of ₹123.4567 truncated to paise misvalues every unit of the holding.
 */
export const PRICE_SCALE = 10_000

// ---------------------------------------------------------------------------
// Enumerations — kept in lockstep with the CHECK constraints in schema.sql
// ---------------------------------------------------------------------------

export type AccountKind = 'credit_card' | 'checking' | 'savings' | 'loan' | 'line_of_credit'
export type TransactionDirection = 'debit' | 'credit'
export type StreamCadence =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'
export type StreamStatus = 'candidate' | 'mature' | 'dormant' | 'cancelled'
export type InsightSeverity = 'info' | 'warning' | 'critical'
export type EvidenceKind =
  | 'transaction'
  | 'message'
  | 'statement'
  | 'recurring_stream'
  | 'balance_observation'
  | 'holding_lot'
export type CommitmentStatus = 'open' | 'kept' | 'broken' | 'expired'
export type RawMessageStatus = 'pending' | 'parsed' | 'quarantined' | 'ignored'
export type ParseFailureReason =
  | 'no_parser_matched'
  | 'extract_threw'
  | 'validation_failed'
  | 'total_mismatch'
  | 'password_required'
  | 'unsupported_format'

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

/** SQLite has no boolean; STRICT columns store `0` or `1` and CHECK the domain. */
export type SqliteBool = 0 | 1

export interface AccountRow {
  readonly id: string
  readonly owner_id: string | null
  readonly institution: string
  readonly kind: string
  readonly currency: string
  readonly region: string
  readonly display_name: string
  readonly last4_hint: string | null
  readonly is_active: number
  readonly created_at: string
}

export interface TransactionRow {
  readonly id: string
  readonly owner_id: string | null
  readonly account_id: string
  readonly posted_at: string
  readonly amount_minor: number
  readonly currency: string
  readonly merchant_raw: string
  readonly merchant_id: string | null
  readonly category_id: string | null
  readonly direction: string
  readonly source: string
  readonly source_ref: string
  readonly ordinal: number
  readonly statement_id: string | null
  readonly confidence: number
  readonly dedupe_key: string
  readonly superseded_by: string | null
  readonly categorization_version: number
  readonly created_at: string
}

export interface StatementRow {
  readonly id: string
  readonly owner_id: string | null
  readonly account_id: string
  readonly period_start: string
  readonly period_end: string
  readonly statement_balance_minor: number
  readonly minimum_due_minor: number | null
  readonly due_date: string | null
  readonly currency: string
  readonly source_message_id: string
  readonly pdf_path: string | null
  readonly is_parsed: number
  readonly created_at: string
}

export interface InsightRow {
  readonly id: string
  readonly owner_id: string | null
  readonly kind: string
  readonly generated_at: string
  readonly severity: string
  readonly title: string
  readonly body: string
  readonly is_dismissed: number
  readonly dismissed_at: string | null
  readonly created_at: string
}

export interface InsightEvidenceRow {
  readonly insight_id: string
  readonly owner_id: string | null
  readonly evidence_kind: string
  readonly evidence_id: string
  readonly ordinal: number
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface Account {
  readonly id: string
  readonly ownerId: string | null
  readonly institution: string
  readonly kind: AccountKind
  readonly currency: string
  readonly region: Region
  readonly displayName: string
  readonly last4Hint: string | null
  readonly isActive: boolean
  readonly createdAt: IsoInstant
}

export interface Transaction {
  readonly id: string
  readonly ownerId: string | null
  readonly accountId: string
  readonly postedAt: IsoDate
  readonly amount: Money
  readonly merchantRaw: string
  readonly merchantId: string | null
  readonly categoryId: string | null
  readonly direction: TransactionDirection
  readonly source: SourceType
  readonly sourceRef: string
  readonly ordinal: number
  readonly statementId: string | null
  readonly confidence: number
  readonly dedupeKey: string
  /** Non-null when an authoritative statement row replaced this provisional one (§7.3). */
  readonly supersededBy: string | null
  readonly categorizationVersion: number
  readonly createdAt: IsoInstant
}

export interface Statement {
  readonly id: string
  readonly ownerId: string | null
  readonly accountId: string
  readonly periodStart: IsoDate
  readonly periodEnd: IsoDate
  readonly statementBalance: Money
  readonly minimumDue: Money | null
  readonly dueDate: IsoDate | null
  readonly sourceMessageId: string
  readonly pdfPath: string | null
  readonly isParsed: boolean
  readonly createdAt: IsoInstant
}

export interface InsightEvidence {
  readonly kind: EvidenceKind
  readonly id: string
}

export interface Insight {
  readonly id: string
  readonly ownerId: string | null
  readonly kind: string
  readonly generatedAt: IsoInstant
  readonly severity: InsightSeverity
  readonly title: string
  readonly body: string
  readonly isDismissed: boolean
  readonly dismissedAt: IsoInstant | null
  readonly evidence: readonly InsightEvidence[]
  readonly createdAt: IsoInstant
}

// ---------------------------------------------------------------------------
// Row <-> domain helpers
// ---------------------------------------------------------------------------

/** Thrown when a stored row cannot be turned into a valid domain object. */
export class RowDecodeError extends Error {
  override readonly name = 'RowDecodeError'
  constructor(
    readonly table: string,
    readonly column: string,
    readonly value: unknown,
    detail: string,
  ) {
    super(`${table}.${column}: ${detail} (got ${JSON.stringify(value)})`)
  }
}

/** Thrown when a domain value cannot be represented in a column without losing information. */
export class ValueOutOfRangeError extends Error {
  override readonly name = 'ValueOutOfRangeError'
  constructor(
    readonly column: string,
    readonly value: number,
  ) {
    super(
      `${column} = ${value} is outside the JavaScript-safe integer range; ` +
        `storing it would round the value on read`,
    )
  }
}

/**
 * Rebuild a `Money` from its column pair.
 *
 * This is the only sanctioned way a minor-unit column leaves the database, so the
 * currency can never be dropped on the way out.
 */
export function moneyFromColumns(
  table: string,
  column: string,
  minor: unknown,
  currency: unknown,
): Money {
  if (typeof minor !== 'number' || !Number.isInteger(minor)) {
    throw new RowDecodeError(table, column, minor, 'expected an integer minor-unit value')
  }
  if (!Number.isSafeInteger(minor)) {
    throw new RowDecodeError(table, column, minor, 'minor-unit value is not a safe integer')
  }
  if (typeof currency !== 'string') {
    throw new RowDecodeError(table, `${column}/currency`, currency, 'expected a currency code')
  }
  return money(minor, currency)
}

/** Same as {@link moneyFromColumns} but tolerates a NULL amount (an absent, not zero, value). */
export function optionalMoneyFromColumns(
  table: string,
  column: string,
  minor: unknown,
  currency: unknown,
): Money | null {
  if (minor === null || minor === undefined) return null
  return moneyFromColumns(table, column, minor, currency)
}

/**
 * Guard a minor-unit value on the way in. The schema CHECKs the same range, but failing
 * here produces an error naming the column instead of an opaque SQLITE_CONSTRAINT.
 */
export function assertStorableMinor(column: string, minor: number): number {
  if (!Number.isInteger(minor) || Math.abs(minor) > MAX_SAFE_MINOR) {
    throw new ValueOutOfRangeError(column, minor)
  }
  return minor
}

export function toSqliteBool(value: boolean): SqliteBool {
  return value ? 1 : 0
}

export function fromSqliteBool(table: string, column: string, value: unknown): boolean {
  if (value === 0) return false
  if (value === 1) return true
  throw new RowDecodeError(table, column, value, 'expected 0 or 1')
}

/**
 * Narrow a stored string to a known enum member.
 *
 * The schema already CHECKs these, so a failure here means the database was written by
 * something other than this code — worth an error rather than a cast.
 */
export function decodeEnum<T extends string>(
  table: string,
  column: string,
  allowed: readonly T[],
  value: unknown,
): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T
  }
  throw new RowDecodeError(table, column, value, `expected one of ${allowed.join(', ')}`)
}

export const ACCOUNT_KINDS: readonly AccountKind[] = [
  'credit_card',
  'checking',
  'savings',
  'loan',
  'line_of_credit',
]
export const REGIONS: readonly Region[] = ['US', 'IN']
export const TRANSACTION_DIRECTIONS: readonly TransactionDirection[] = ['debit', 'credit']
export const SOURCE_TYPES: readonly SourceType[] = [
  'alert',
  'statement_pdf',
  'csv_import',
  'manual',
]
export const INSIGHT_SEVERITIES: readonly InsightSeverity[] = ['info', 'warning', 'critical']
export const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  'transaction',
  'message',
  'statement',
  'recurring_stream',
  'balance_observation',
  'holding_lot',
]
