/**
 * Shared plumbing for the repositories.
 *
 * Two rules this module exists to enforce:
 *
 *   1. SQL is never assembled from data. Every value reaches SQLite through a bound
 *      parameter; the only text a query varies at runtime is its own clause structure.
 *   2. Nothing read out of SQLite is trusted to have the type the column claims. The
 *      readers below convert or throw; they never cast.
 */

import { randomUUID } from 'node:crypto'
import type { Database, PreparedStatement, SQLInputValue } from '../sqlite'

/** A row as `node:sqlite` hands it back: a null-prototype object of scalar values. */
export type SqlRow = Record<string, unknown>

/** Thrown when a lookup that must succeed found nothing. */
export class RecordNotFoundError extends Error {
  override readonly name = 'RecordNotFoundError'
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`${entity} ${id} not found`)
  }
}

/** Thrown when a write would violate a UNIQUE index — see the subclasses per entity. */
export class UniqueConstraintError extends Error {
  override readonly name: string = 'UniqueConstraintError'
  constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

/** Thrown when a caller passes a value the schema would reject anyway. */
export class InvalidArgumentError extends Error {
  override readonly name = 'InvalidArgumentError'
  constructor(
    readonly argument: string,
    detail: string,
  ) {
    super(`${argument}: ${detail}`)
  }
}

/**
 * True when `error` is SQLite refusing a duplicate on a unique index.
 *
 * `node:sqlite` surfaces the sqlite3 extended result code on `error.errcode`; the string
 * check is a fallback for builds that only populate the message. Matching on the message
 * alone would be fragile, and catching every error as "duplicate" would hide real bugs.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { errcode?: unknown; code?: unknown; message?: unknown }
  // 2067 = SQLITE_CONSTRAINT_UNIQUE, 1555 = SQLITE_CONSTRAINT_PRIMARYKEY.
  if (candidate.errcode === 2067 || candidate.errcode === 1555) return true
  if (candidate.code === 'ERR_SQLITE_ERROR' && typeof candidate.message === 'string') {
    return candidate.message.includes('UNIQUE constraint failed')
  }
  return false
}

/** Fresh identifier for a new row. UUIDv4: no ordering information, no collision risk. */
export function newId(): string {
  return randomUUID()
}

/** Current instant in the exact shape the schema's CHECK constraints expect. */
export function nowInstant(): string {
  return new Date().toISOString()
}

/**
 * Base class holding a per-connection prepared-statement cache.
 *
 * Statements are prepared lazily because a repository is constructed before `migrate()`
 * has necessarily run, and preparing against a table that does not exist yet throws.
 */
export abstract class Repository {
  readonly #statements = new Map<string, PreparedStatement>()

  constructor(protected readonly db: Database) {}

  protected stmt(sql: string): PreparedStatement {
    const cached = this.#statements.get(sql)
    if (cached !== undefined) return cached
    const prepared = this.db.prepare(sql)
    this.#statements.set(sql, prepared)
    return prepared
  }
}

/** Anything bindable as a SQLite parameter. */
export type Param = SQLInputValue

// ---------------------------------------------------------------------------
// Column readers
// ---------------------------------------------------------------------------

export class ColumnTypeError extends Error {
  override readonly name = 'ColumnTypeError'
  constructor(column: string, expected: string, value: unknown) {
    super(`column ${column}: expected ${expected}, got ${JSON.stringify(value)}`)
  }
}

export function readString(row: SqlRow, column: string): string {
  const value = row[column]
  if (typeof value !== 'string') throw new ColumnTypeError(column, 'a string', value)
  return value
}

export function readNullableString(row: SqlRow, column: string): string | null {
  const value = row[column]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new ColumnTypeError(column, 'a string or NULL', value)
  return value
}

export function readNumber(row: SqlRow, column: string): number {
  const value = row[column]
  if (typeof value === 'bigint') {
    // Reachable only if a column outgrew the schema's safe-integer CHECK, which would
    // mean the row was written by something other than this code.
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new ColumnTypeError(column, 'a JavaScript-safe integer', value.toString())
    }
    return Number(value)
  }
  if (typeof value !== 'number') throw new ColumnTypeError(column, 'a number', value)
  return value
}

export function readNullableNumber(row: SqlRow, column: string): number | null {
  const value = row[column]
  if (value === null || value === undefined) return null
  return readNumber(row, column)
}
