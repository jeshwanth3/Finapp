/**
 * Connection factory for the Finapp store.
 *
 * Built directly on `node:sqlite` (Node >= 22.5). No ORM: the schema is the contract and
 * every query in `repositories/` is hand-written and parameterised. No better-sqlite3
 * either — it needs a C++ toolchain that the target machine does not have.
 */

import { DatabaseSync, type Database } from './sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** The special SQLite path meaning "hold this database in RAM and discard it on close". */
export const IN_MEMORY = ':memory:'

export interface OpenDatabaseOptions {
  /** File path, or `':memory:'`. Defaults to `':memory:'`. */
  readonly path?: string
  /**
   * How long a writer will wait for a competing lock before giving up. The digest job and
   * the Next.js request handlers write concurrently; without this they race to
   * SQLITE_BUSY on the first overlap.
   */
  readonly busyTimeoutMs?: number
  /** Open read-only. The file must already exist. */
  readonly readOnly?: boolean
  /**
   * Create the parent directory if missing. Off by default: silently creating
   * directories hides a mistyped path until the data is somewhere nobody looks.
   */
  readonly createDirectory?: boolean
}

/** Thrown when a connection cannot be established or configured. */
export class DatabaseOpenError extends Error {
  override readonly name = 'DatabaseOpenError'
  constructor(
    readonly path: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`cannot open database at ${path}: ${detail}`, options)
  }
}

/** Thrown when a PRAGMA that the store depends on did not take effect. */
export class PragmaError extends Error {
  override readonly name = 'PragmaError'
  constructor(
    readonly pragma: string,
    readonly expected: string,
    readonly actual: unknown,
  ) {
    super(`PRAGMA ${pragma} is ${JSON.stringify(actual)}, expected ${expected}`)
  }
}

const DEFAULT_BUSY_TIMEOUT_MS = 5_000

function isMemoryPath(path: string): boolean {
  // ':memory:' and any 'file:...mode=memory' URI form.
  return path === IN_MEMORY || path.includes('mode=memory')
}

function scalar(db: Database, sql: string): unknown {
  const row = db.prepare(sql).get()
  if (row === undefined) return undefined
  const values = Object.values(row)
  return values.length > 0 ? values[0] : undefined
}

/**
 * Open a configured connection.
 *
 * Accepts a bare path for the common case (`openDatabase('./finapp.db')`) or an options
 * object. Always returns a connection with foreign keys enforced and a busy timeout set;
 * file-backed databases additionally run in WAL mode.
 */
export function openDatabase(pathOrOptions: string | OpenDatabaseOptions = {}): Database {
  const options: OpenDatabaseOptions =
    typeof pathOrOptions === 'string' ? { path: pathOrOptions } : pathOrOptions
  const path = options.path ?? IN_MEMORY
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS

  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new DatabaseOpenError(path, `busyTimeoutMs must be a non-negative integer`)
  }

  if (options.createDirectory && !isMemoryPath(path)) {
    mkdirSync(dirname(path), { recursive: true })
  }

  let db: Database
  try {
    db = new DatabaseSync(path, {
      open: true,
      enableForeignKeyConstraints: true,
      // Double-quoted string literals turn a typo'd column name into a silent string
      // literal. In a ledger that is a wrong number, not a syntax error.
      enableDoubleQuotedStringLiterals: false,
      readOnly: options.readOnly ?? false,
    })
  } catch (cause) {
    throw new DatabaseOpenError(path, 'connection failed', { cause })
  }

  try {
    configureConnection(db, { path, busyTimeoutMs, readOnly: options.readOnly ?? false })
  } catch (error) {
    db.close()
    throw error
  }

  return db
}

function configureConnection(
  db: Database,
  opts: { path: string; busyTimeoutMs: number; readOnly: boolean },
): void {
  // Interpolated rather than bound: SQLite does not accept parameters in PRAGMA
  // statements. The value is a validated integer, never caller-supplied text.
  db.exec(`PRAGMA busy_timeout = ${opts.busyTimeoutMs}`)

  // enableForeignKeyConstraints should already have done this; verify rather than trust,
  // because a silently-off foreign_keys pragma lets orphan rows accumulate for months.
  const foreignKeys = scalar(db, 'PRAGMA foreign_keys')
  if (foreignKeys !== 1) {
    throw new PragmaError('foreign_keys', '1', foreignKeys)
  }

  if (isMemoryPath(opts.path)) {
    // An in-memory database has no rollback journal to speak of; SQLite refuses WAL and
    // reports back 'memory'. Asking for it anyway would fail the verification below.
    return
  }

  if (!opts.readOnly) {
    const journalMode = scalar(db, 'PRAGMA journal_mode = WAL')
    if (typeof journalMode !== 'string' || journalMode.toLowerCase() !== 'wal') {
      throw new PragmaError('journal_mode', 'wal', journalMode)
    }
    // NORMAL is the documented companion to WAL: durable across process crashes, and only
    // at risk of losing the last transactions on a power cut. FULL costs an fsync per
    // commit, which the email-ingest loop would pay thousands of times per backfill.
    db.exec('PRAGMA synchronous = NORMAL')
  }
}

/**
 * Run `fn` inside a transaction, committing on return and rolling back on throw.
 *
 * IMMEDIATE, not DEFERRED: a deferred transaction takes its write lock at the first
 * write, so two concurrent read-then-write flows can both start, both read, and then one
 * fails at commit time having already made decisions on stale data.
 */
export function withTransaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  let result: T
  try {
    result = fn()
  } catch (error) {
    // If the rollback itself fails the connection is unusable; the original error is the
    // one worth reporting, so it is rethrown with the rollback failure attached.
    try {
      db.exec('ROLLBACK')
    } catch (rollbackError) {
      throw new Error('transaction failed and rollback failed', {
        cause: { error, rollbackError },
      })
    }
    throw error
  }
  db.exec('COMMIT')
  return result
}

/**
 * Close a connection.
 *
 * `db.close()` already checkpoints and removes the `-wal` / `-shm` sidecars for the last
 * connection to a file, so there is nothing to do here beyond closing — this wrapper
 * exists so callers never reach for the raw handle.
 */
export function closeDatabase(db: Database): void {
  db.close()
}
