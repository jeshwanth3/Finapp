/**
 * Database reset script.
 *
 * Removes `./finapp.db` and any WAL/SHM sidecars so the database can be re-seeded cleanly.
 */

import { rmSync, existsSync } from 'node:fs'

export function resetDatabase(dbPath = './finapp.db'): void {
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
  for (const file of files) {
    if (existsSync(file)) {
      rmSync(file, { force: true })
      console.log(`Removed ${file}`)
    }
  }
}

if (require.main === module || process.argv[1]?.endsWith('reset.ts')) {
  const targetPath = process.argv[2] ?? './finapp.db'
  console.log(`Resetting database at ${targetPath}...`)
  resetDatabase(targetPath)
  console.log('Database reset successfully.')
}
