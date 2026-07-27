/**
 * The one place `node:sqlite` is loaded.
 *
 * WHY THIS EXISTS: Vite (and therefore Vitest) decides what to externalise by checking
 * `module.builtinModules`. Node lists this module as the prefixed string `'node:sqlite'`,
 * not as `'sqlite'` like every other builtin — so Vite strips the prefix, fails to find
 * `sqlite` in the list, and tries to resolve it from `node_modules`:
 *
 *     Error: Failed to load url sqlite (resolved id: sqlite). Does the file exist?
 *
 * A `createRequire` call is opaque to the bundler's static analysis, so the module is
 * loaded by Node itself at runtime. The type import above it is erased at compile time
 * and never reaches Vite, which keeps full typing with no `any` anywhere.
 *
 * Delete this shim once Vite handles prefix-only builtins; nothing else needs to change,
 * because every other file in `src/db` imports SQLite from here.
 */

import { createRequire } from 'node:module'
import type {
  DatabaseSync as DatabaseSyncInstance,
  DatabaseSyncOptions,
  SQLInputValue,
  StatementSync,
} from 'node:sqlite'

export type Database = DatabaseSyncInstance
export type PreparedStatement = StatementSync
export type { SQLInputValue }

interface DatabaseSyncConstructor {
  new (path: string, options?: DatabaseSyncOptions): DatabaseSyncInstance
}

interface SqliteModule {
  readonly DatabaseSync: DatabaseSyncConstructor
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as SqliteModule

export { DatabaseSync }
