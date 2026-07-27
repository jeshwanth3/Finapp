/**
 * Forward-only migrations.
 *
 * There is no `down`. A financial ledger's rollback story is "restore the backup" — a
 * scripted down-migration is a way to lose rows while believing you undid something.
 *
 * Version 1 is `schema.sql` (the baseline). Everything after it is a numbered file in
 * `src/db/migrations/`, named `NNN_snake_case_description.sql`.
 *
 * Applying is idempotent: each version is recorded in `schema_migrations` with a checksum
 * of the SQL that was actually run, and re-running skips what is already there. Editing a
 * migration after it has been applied anywhere is an error, not a silent no-op — that is
 * the failure mode where two machines believe they are on the same schema and are not.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Database } from './sqlite'
import { withTransaction } from './db'

export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

export interface AppliedMigration {
  readonly version: number
  readonly name: string
  readonly checksum: string
  readonly appliedAt: string
}

export interface MigrateResult {
  /** Versions applied by this call. Empty when the database was already up to date. */
  readonly applied: readonly number[]
  /** Highest version present after this call, or 0 for an empty database. */
  readonly currentVersion: number
}

export class MigrationError extends Error {
  override readonly name: string = 'MigrationError'
}

/** A migration file's contents changed after it was applied. */
export class MigrationChecksumError extends MigrationError {
  override readonly name = 'MigrationChecksumError'
  constructor(
    readonly version: number,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `migration ${version} was applied with checksum ${expected} but the file now hashes ` +
        `to ${actual}; migrations are immutable once applied — add a new one instead`,
    )
  }
}

/** The database records a version that no longer exists on disk. */
export class MigrationMissingError extends MigrationError {
  override readonly name = 'MigrationMissingError'
  constructor(readonly version: number) {
    super(
      `migration ${version} is recorded as applied but was not found; the code is older ` +
        `than the database it is pointed at`,
    )
  }
}

/** A new migration was inserted below a version that has already run. */
export class MigrationOutOfOrderError extends MigrationError {
  override readonly name = 'MigrationOutOfOrderError'
  constructor(
    readonly version: number,
    readonly currentVersion: number,
  ) {
    super(
      `migration ${version} is pending but version ${currentVersion} has already been ` +
        `applied; renumber it above ${currentVersion}`,
    )
  }
}

/** Two migrations claim the same version number. */
export class DuplicateMigrationVersionError extends MigrationError {
  override readonly name = 'DuplicateMigrationVersionError'
  constructor(
    readonly version: number,
    readonly first: string,
    readonly second: string,
  ) {
    super(`migrations "${first}" and "${second}" both claim version ${version}`)
  }
}

/** A file in `migrations/` does not follow the `NNN_name.sql` convention. */
export class MalformedMigrationNameError extends MigrationError {
  override readonly name = 'MalformedMigrationNameError'
  constructor(readonly filename: string) {
    super(`migration file "${filename}" must be named NNN_description.sql (e.g. 002_add_tags.sql)`)
  }
}

/** Applying a migration's SQL failed; the transaction was rolled back. */
export class MigrationApplyError extends MigrationError {
  override readonly name = 'MigrationApplyError'
  constructor(
    readonly version: number,
    readonly migrationName: string,
    options?: { cause?: unknown },
  ) {
    super(`migration ${version} (${migrationName}) failed and was rolled back`, options)
  }
}

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY CHECK (version > 0),
  name        TEXT NOT NULL,
  checksum    TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at  TEXT NOT NULL
              CHECK (applied_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;
`

const BASELINE_VERSION = 1
const BASELINE_NAME = 'baseline_schema'
const MIGRATION_FILENAME = /^(\d{3,})_([a-z0-9_]+)\.sql$/

function checksumOf(sql: string): string {
  // Line endings are normalised first: a Windows checkout and a CI Linux box must agree
  // on the hash of a file neither of them changed.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex')
}

function moduleDir(): string {
  return fileURLToPath(new URL('.', import.meta.url))
}

/** Read `schema.sql` — migration 1, the baseline every database starts from. */
export function loadBaseline(dir: string = moduleDir()): Migration {
  return {
    version: BASELINE_VERSION,
    name: BASELINE_NAME,
    sql: readFileSync(join(dir, 'schema.sql'), 'utf8'),
  }
}

function readMigrationsDirectory(dir: string): Migration[] {
  let filenames: string[]
  try {
    filenames = readdirSync(dir)
  } catch (error) {
    // An absent directory means "no migrations beyond the baseline yet", which is the
    // state a fresh repository is in. Any other failure (permissions, a file where a
    // directory should be) is real and must not be mistaken for emptiness.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const migrations: Migration[] = []
  for (const filename of filenames.sort()) {
    if (!filename.endsWith('.sql')) continue
    const match = MIGRATION_FILENAME.exec(filename)
    if (match === null) throw new MalformedMigrationNameError(filename)
    const [, digits, name] = match
    if (digits === undefined || name === undefined) throw new MalformedMigrationNameError(filename)
    const version = Number.parseInt(digits, 10)
    if (version <= BASELINE_VERSION) {
      throw new MigrationError(
        `migration file "${filename}" claims version ${version}, but version ` +
          `${BASELINE_VERSION} is reserved for schema.sql`,
      )
    }
    migrations.push({ version, name, sql: readFileSync(join(dir, filename), 'utf8') })
  }
  return migrations
}

/**
 * Assemble the ordered migration set: the baseline plus everything in `migrations/`.
 *
 * `dir` exists so tests can point at a fixture directory; production always uses the
 * directory this module lives in.
 */
export function loadMigrations(dir: string = moduleDir()): Migration[] {
  return sortAndValidate([loadBaseline(dir), ...readMigrationsDirectory(join(dir, 'migrations'))])
}

/**
 * Order a migration set and reject an incoherent one.
 *
 * Applied to every set, including one passed straight to {@link migrate} — a caller
 * supplying migrations in code is exactly as capable of duplicating a version as a
 * directory listing is, and the consequence (one of the two never runs) is identical.
 */
function sortAndValidate(migrations: readonly Migration[]): Migration[] {
  const sorted = [...migrations].sort((a, b) => a.version - b.version)

  const seen = new Map<number, string>()
  for (const migration of sorted) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new MigrationError(
        `migration "${migration.name}" has version ${migration.version}; versions are ` +
          `positive integers starting at ${BASELINE_VERSION}`,
      )
    }
    const existing = seen.get(migration.version)
    if (existing !== undefined) {
      throw new DuplicateMigrationVersionError(migration.version, existing, migration.name)
    }
    seen.set(migration.version, migration.name)
  }
  return sorted
}

function readApplied(db: Database): AppliedMigration[] {
  const rows = db
    .prepare(
      `SELECT version, name, checksum, applied_at
         FROM schema_migrations
        ORDER BY version`,
    )
    .all()

  return rows.map((row) => {
    const { version, name, checksum, applied_at: appliedAt } = row
    if (
      typeof version !== 'number' ||
      typeof name !== 'string' ||
      typeof checksum !== 'string' ||
      typeof appliedAt !== 'string'
    ) {
      throw new MigrationError(`schema_migrations holds an unreadable row: ${JSON.stringify(row)}`)
    }
    return { version, name, checksum, appliedAt }
  })
}

/** Every migration recorded as applied, oldest first. Creates the tracking table if absent. */
export function appliedMigrations(db: Database): AppliedMigration[] {
  db.exec(SCHEMA_MIGRATIONS_DDL)
  return readApplied(db)
}

/** Highest applied version, or 0 for a database that has never been migrated. */
export function currentVersion(db: Database): number {
  const applied = appliedMigrations(db)
  return applied.length === 0 ? 0 : (applied[applied.length - 1]?.version ?? 0)
}

export interface MigrateOptions {
  /** Override the migration set. Tests use this; production omits it. */
  readonly migrations?: readonly Migration[]
  /** Directory to load migrations from when `migrations` is not given. */
  readonly directory?: string
  /** Stop after this version instead of applying everything. */
  readonly targetVersion?: number
}

/**
 * Bring `db` up to date. Safe to call on every process start — a database that is already
 * current is left untouched and `applied` comes back empty.
 */
export function migrate(db: Database, options: MigrateOptions = {}): MigrateResult {
  const migrations =
    options.migrations === undefined
      ? loadMigrations(options.directory)
      : sortAndValidate(options.migrations)
  const target = options.targetVersion ?? Number.POSITIVE_INFINITY

  db.exec(SCHEMA_MIGRATIONS_DDL)
  const applied = readApplied(db)
  const appliedByVersion = new Map(applied.map((m) => [m.version, m]))
  const knownVersions = new Set(migrations.map((m) => m.version))

  for (const record of applied) {
    if (!knownVersions.has(record.version)) throw new MigrationMissingError(record.version)
  }

  let highestApplied = applied.length === 0 ? 0 : (applied[applied.length - 1]?.version ?? 0)
  const appliedNow: number[] = []

  const insert = db.prepare(
    `INSERT INTO schema_migrations (version, name, checksum, applied_at)
     VALUES (?, ?, ?, ?)`,
  )

  for (const migration of migrations) {
    const checksum = checksumOf(migration.sql)
    const record = appliedByVersion.get(migration.version)

    if (record !== undefined) {
      // Already applied — the only question is whether the file still matches.
      if (record.checksum !== checksum) {
        throw new MigrationChecksumError(migration.version, record.checksum, checksum)
      }
      continue
    }

    if (migration.version > target) break
    if (migration.version < highestApplied) {
      throw new MigrationOutOfOrderError(migration.version, highestApplied)
    }

    try {
      withTransaction(db, () => {
        db.exec(migration.sql)
        insert.run(migration.version, migration.name, checksum, new Date().toISOString())
      })
    } catch (cause) {
      throw new MigrationApplyError(migration.version, migration.name, { cause })
    }

    appliedNow.push(migration.version)
    highestApplied = migration.version
  }

  return { applied: appliedNow, currentVersion: highestApplied }
}
