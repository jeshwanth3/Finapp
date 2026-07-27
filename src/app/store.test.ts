import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getDebtAccounts } from './store'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('application store fallback', () => {
  it('seeds a missing database in memory without closing it twice', () => {
    const directory = mkdtempSync(join(tmpdir(), 'finapp-store-'))
    tempDirectories.push(directory)
    const databasePath = join(directory, 'missing.db')

    const accounts = getDebtAccounts(databasePath)

    expect(accounts).toHaveLength(5)
    expect(accounts.map((account) => account.accountId)).toContain('acct-card-a')
    expect(existsSync(databasePath)).toBe(false)
  })
})
