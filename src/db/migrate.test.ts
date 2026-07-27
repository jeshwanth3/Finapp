import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from './db'
import {
  DuplicateMigrationVersionError,
  MigrationApplyError,
  MigrationChecksumError,
  MigrationMissingError,
  MigrationOutOfOrderError,
  appliedMigrations,
  currentVersion,
  loadBaseline,
  loadMigrations,
  migrate,
  type Migration,
} from './migrate'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'finapp-migrate-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

const baseline = loadBaseline()

function withExtra(...extra: Migration[]): Migration[] {
  return [baseline, ...extra]
}

describe('migrate', () => {
  it('applies the baseline to an empty database and reports it', () => {
    const db = openDatabase(':memory:')
    expect(currentVersion(db)).toBe(0)

    const result = migrate(db)
    expect(result.applied).toEqual([1])
    expect(result.currentVersion).toBe(1)
    expect(currentVersion(db)).toBe(1)
    db.close()
  })

  it('is idempotent — a second run applies nothing and changes nothing', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    const firstApplied = appliedMigrations(db)

    const second = migrate(db)
    expect(second.applied).toEqual([])
    expect(second.currentVersion).toBe(1)

    const third = migrate(db)
    expect(third.applied).toEqual([])

    expect(appliedMigrations(db)).toEqual(firstApplied)
    db.close()
  })

  it('records name, checksum and timestamp for each applied version', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    const [record] = appliedMigrations(db)
    expect(record?.version).toBe(1)
    expect(record?.name).toBe('baseline_schema')
    expect(record?.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(record?.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    db.close()
  })

  it('applies a later migration on top of an existing database', () => {
    const db = openDatabase(':memory:')
    migrate(db)

    const extra: Migration = {
      version: 2,
      name: 'add_tags',
      sql: `CREATE TABLE tags (id TEXT PRIMARY KEY, owner_id TEXT, label TEXT NOT NULL) STRICT;`,
    }
    const result = migrate(db, { migrations: withExtra(extra) })
    expect(result.applied).toEqual([2])
    expect(currentVersion(db)).toBe(2)

    // ...and running the same set again is a no-op.
    expect(migrate(db, { migrations: withExtra(extra) }).applied).toEqual([])
    db.close()
  })

  it('stops at targetVersion', () => {
    const db = openDatabase(':memory:')
    const extra: Migration = {
      version: 2,
      name: 'add_tags',
      sql: `CREATE TABLE tags (id TEXT PRIMARY KEY) STRICT;`,
    }
    const result = migrate(db, { migrations: withExtra(extra), targetVersion: 1 })
    expect(result.applied).toEqual([1])
    expect(currentVersion(db)).toBe(1)
    db.close()
  })

  it('refuses a migration whose contents changed after it was applied', () => {
    const db = openDatabase(':memory:')
    const original: Migration = {
      version: 2,
      name: 'add_tags',
      sql: `CREATE TABLE tags (id TEXT PRIMARY KEY) STRICT;`,
    }
    migrate(db, { migrations: withExtra(original) })

    const edited: Migration = { ...original, sql: `CREATE TABLE tags (id TEXT PRIMARY KEY, x TEXT) STRICT;` }
    expect(() => migrate(db, { migrations: withExtra(edited) })).toThrowError(
      MigrationChecksumError,
    )
    db.close()
  })

  it('refuses to run when the database knows a version the code does not', () => {
    const db = openDatabase(':memory:')
    migrate(db, {
      migrations: withExtra({
        version: 2,
        name: 'add_tags',
        sql: `CREATE TABLE tags (id TEXT PRIMARY KEY) STRICT;`,
      }),
    })
    expect(() => migrate(db, { migrations: [baseline] })).toThrowError(MigrationMissingError)
    db.close()
  })

  it('refuses a migration slipped in below one already applied', () => {
    const db = openDatabase(':memory:')
    const three: Migration = {
      version: 3,
      name: 'later',
      sql: `CREATE TABLE later (id TEXT PRIMARY KEY) STRICT;`,
    }
    migrate(db, { migrations: withExtra(three) })

    const two: Migration = {
      version: 2,
      name: 'sneaked_in',
      sql: `CREATE TABLE sneaked (id TEXT PRIMARY KEY) STRICT;`,
    }
    expect(() => migrate(db, { migrations: withExtra(two, three) })).toThrowError(
      MigrationOutOfOrderError,
    )
    db.close()
  })

  it('refuses two migrations claiming the same version', () => {
    expect(() =>
      migrate(openDatabase(':memory:'), {
        migrations: [
          baseline,
          { version: 2, name: 'a', sql: 'CREATE TABLE a (id TEXT PRIMARY KEY) STRICT;' },
          { version: 2, name: 'b', sql: 'CREATE TABLE b (id TEXT PRIMARY KEY) STRICT;' },
        ],
      }),
    ).toThrowError(DuplicateMigrationVersionError)
  })

  it('rolls back a failing migration and leaves the version untouched', () => {
    const db = openDatabase(':memory:')
    migrate(db)

    const broken: Migration = {
      version: 2,
      name: 'broken',
      sql: `CREATE TABLE ok_so_far (id TEXT PRIMARY KEY) STRICT;
            CREATE TABLE ok_so_far (id TEXT PRIMARY KEY) STRICT;`,
    }
    expect(() => migrate(db, { migrations: withExtra(broken) })).toThrowError(MigrationApplyError)

    expect(currentVersion(db)).toBe(1)
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ok_so_far'`)
      .all()
    expect(tables).toEqual([])
    db.close()
  })

  it('survives a real file-backed database being reopened and re-migrated', () => {
    const dir = tempDir()
    const path = join(dir, 'finapp.db')

    const first = openDatabase(path)
    expect(migrate(first).applied).toEqual([1])
    // A file-backed database runs in WAL mode; an in-memory one cannot.
    expect(first.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    first.close()

    const second = openDatabase(path)
    expect(migrate(second).applied).toEqual([])
    expect(currentVersion(second)).toBe(1)
    second.close()
  })
})

describe('loadMigrations', () => {
  it('returns just the baseline when there is no migrations directory', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'schema.sql'), 'CREATE TABLE t (id TEXT PRIMARY KEY) STRICT;')
    const migrations = loadMigrations(dir)
    expect(migrations.map((m) => m.version)).toEqual([1])
  })

  it('loads numbered files in order and rejects a malformed name', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'schema.sql'), 'CREATE TABLE t (id TEXT PRIMARY KEY) STRICT;')
    const migrationsDir = join(dir, 'migrations')
    mkdirSync(migrationsDir, { recursive: true })
    writeFileSync(join(migrationsDir, '010_later.sql'), 'SELECT 1;')
    writeFileSync(join(migrationsDir, '002_earlier.sql'), 'SELECT 1;')

    expect(loadMigrations(dir).map((m) => m.version)).toEqual([1, 2, 10])

    writeFileSync(join(migrationsDir, 'oops.sql'), 'SELECT 1;')
    expect(() => loadMigrations(dir)).toThrowError(/NNN_description\.sql/)
  })

  it('reserves version 1 for schema.sql', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'schema.sql'), 'CREATE TABLE t (id TEXT PRIMARY KEY) STRICT;')
    const migrationsDir = join(dir, 'migrations')
    mkdirSync(migrationsDir, { recursive: true })
    writeFileSync(join(migrationsDir, '001_conflict.sql'), 'SELECT 1;')
    expect(() => loadMigrations(dir)).toThrowError(/reserved for schema\.sql/)
  })
})
