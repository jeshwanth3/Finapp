/**
 * Public entry point for the data layer.
 *
 * Nothing outside `src/db` should import `node:sqlite` directly: connections come from
 * {@link openStore}, and every read or write goes through a repository so that money
 * always crosses the boundary as `Money`, never as a bare minor-unit number.
 */

import type { Database } from './sqlite'
import { closeDatabase, openDatabase, type OpenDatabaseOptions } from './db'
import { migrate, type MigrateResult } from './migrate'
import { createRepositories, type Repositories } from './repositories'

export * from './db'
export * from './migrate'
export * from './types'
export * from './repositories'

export interface Store extends Repositories {
  readonly db: Database
  /** What `openStore` had to apply to bring the database up to date. */
  readonly migration: MigrateResult
  close(): void
}

/** Open a connection, migrate it to the current schema, and bind the repositories. */
export function openStore(pathOrOptions: string | OpenDatabaseOptions = {}): Store {
  const db = openDatabase(pathOrOptions)
  let migration: MigrateResult
  try {
    migration = migrate(db)
  } catch (error) {
    closeDatabase(db)
    throw error
  }
  return {
    db,
    migration,
    ...createRepositories(db),
    close: () => closeDatabase(db),
  }
}
