/**
 * Application data store bridge — LIVE DATA.
 *
 * Connects Next.js routes to the canonical SQLite store and deterministic
 * insight engine. All data comes from real email ingestion, not fixtures.
 *
 * Automatically seeds the schema if the database is fresh but does NOT
 * insert demo data — the sync pipeline populates it from Gmail.
 */

import { existsSync } from 'node:fs'
import { openDatabase, closeDatabase, IN_MEMORY } from '@/db/db'
import { migrate } from '@/db/migrate'
import { createRepositories, type Repositories } from '@/db/repositories'
import { money, sum, type Money } from '@/core/money'
import type { DebtAccount } from '@/engine/debt-map'
import type { CashFlowRequest, Obligation } from '@/engine/cash-flow'

/** Today's date as YYYY-MM-DD, derived from the system clock. */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Open the database, run migrations, execute `fn`, then close.
 */
export function withStore<T>(fn: (repos: Repositories) => T, dbPath = './finapp.db'): T {
  const isFilePresent = existsSync(dbPath)
  const path = isFilePresent ? dbPath : IN_MEMORY
  const db = openDatabase({ path, readOnly: false, createDirectory: true })

  try {
    migrate(db)
    const repos = createRepositories(db)
    return fn(repos)
  } finally {
    closeDatabase(db)
  }
}

export interface StoreAccountView {
  id: string
  institution: string
  kind: 'checking' | 'credit_card' | 'savings' | 'loan' | 'line_of_credit'
  region: 'US' | 'IN'
  currency: string
  displayName: string
  balance: Money
  statementBalance?: Money
  minimumDue?: Money
  dueDate?: string
  aprPercent?: number
  lastObservedAt: string
}

/**
 * Load all accounts with their latest statement balances.
 * Pure database read — no hardcoded fallbacks.
 */
export function getStoreAccounts(dbPath = './finapp.db'): StoreAccountView[] {
  return withStore((repos) => {
    const accounts = repos.accounts.list()
    return accounts.map((acct) => {
      const stmts = repos.statements.listByAccount(acct.id, 1)
      const latestStmt = stmts[0]

      let balance = money(0, acct.currency)
      let statementBalance: Money | undefined
      let minimumDue: Money | undefined
      let dueDate: string | undefined

      if (latestStmt) {
        balance = latestStmt.statementBalance
        statementBalance = latestStmt.statementBalance
        minimumDue = latestStmt.minimumDue ?? undefined
        dueDate = latestStmt.dueDate ?? undefined
      }

      return {
        id: acct.id,
        institution: acct.institution,
        kind: acct.kind,
        region: acct.region,
        currency: acct.currency,
        displayName: acct.displayName,
        balance,
        statementBalance,
        minimumDue,
        dueDate,
        lastObservedAt: latestStmt ? latestStmt.periodEnd : today(),
      }
    })
  }, dbPath)
}

/**
 * Builds DebtAccount[] from real data for the debt-map engine.
 */
export function getDebtAccounts(dbPath = './finapp.db'): DebtAccount[] {
  const views = getStoreAccounts(dbPath)
  return views
    .filter((v) => v.kind !== 'checking' && v.kind !== 'savings')
    .map((v) => ({
      accountId: v.id,
      label: v.displayName,
      institution: v.institution,
      currency: v.currency,
      kind: v.kind as 'credit_card' | 'loan' | 'line_of_credit',
      currentBalance: v.balance,
      statementBalance: v.statementBalance,
      minimumDue: v.minimumDue,
      dueOn: v.dueDate,
      aprBasisPoints: v.aprPercent ? Math.round(v.aprPercent * 100) : undefined,
      asOf: v.lastObservedAt,
      confidence: 'high',
    }))
}

/**
 * Builds CashFlowRequest from real data.
 * Obligations are derived from statement due dates and minimums.
 */
export function getCashFlowRequest(todayStr?: string, dbPath = './finapp.db'): CashFlowRequest {
  const t = todayStr ?? today()
  const views = getStoreAccounts(dbPath)
  const checking = views.find((v) => v.kind === 'checking' && v.currency === 'USD')
  const openingBalance = checking ? checking.balance : money(0, 'USD')

  // Build obligations from real statement data — USD only (projection is single-currency)
  const obligations: Obligation[] = views
    .filter((v) => v.dueDate && v.minimumDue && v.currency === 'USD')
    .map((v) => ({
      id: `ob-${v.id}`,
      label: `${v.displayName} Minimum Payment`,
      amount: v.minimumDue!,
      dueOn: v.dueDate!,
      movable: false,
      confidence: 'high' as const,
    }))

  // If we have statement balances with due dates but no minimumDue, add them too
  const fullPayments = views
    .filter((v) => v.dueDate && v.statementBalance && !v.minimumDue && v.kind !== 'checking' && v.currency === 'USD')
    .map((v) => ({
      id: `ob-full-${v.id}`,
      label: `${v.displayName} Statement Balance`,
      amount: v.statementBalance!,
      dueOn: v.dueDate!,
      movable: true,
      confidence: 'medium' as const,
    }))

  return {
    today: t,
    horizonDays: 45,
    openingBalance,
    floor: money(5000, 'USD'), // $50.00 buffer floor
    obligations: [...obligations, ...fullPayments],
    inflows: [],
  }
}

/**
 * Get recent transactions across all accounts.
 */
export function getRecentTransactions(limit = 20, dbPath = './finapp.db') {
  return withStore((repos) => {
    const accounts = repos.accounts.list()
    const all = accounts.flatMap((acct) =>
      repos.transactions.listByAccount(acct.id, { limit: limit * 2 }),
    )
    // Sort by postedAt descending, take the most recent
    all.sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    return all.slice(0, limit)
  }, dbPath)
}

/**
 * Get sync state for the freshness indicator.
 */
export function getSyncState(dbPath = './finapp.db') {
  const isFilePresent = existsSync(dbPath)
  if (!isFilePresent) {
    return {
      lastAttemptAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      quarantineDepth: 0,
    }
  }

  const db = openDatabase({ path: dbPath, readOnly: false, createDirectory: true })
  try {
    migrate(db)
    // Ensure sync tables exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        id TEXT PRIMARY KEY DEFAULT 'default',
        last_attempt_at TEXT,
        last_success_at TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        quarantine_depth INTEGER NOT NULL DEFAULT 0,
        total_parsed INTEGER NOT NULL DEFAULT 0,
        total_ignored INTEGER NOT NULL DEFAULT 0
      ) STRICT;
    `)
    const row = db.prepare('SELECT * FROM sync_state WHERE id = ?').get('default') as {
      last_attempt_at: string | null
      last_success_at: string | null
      consecutive_failures: number
      quarantine_depth: number
    } | undefined

    return {
      lastAttemptAt: row?.last_attempt_at ?? null,
      lastSuccessAt: row?.last_success_at ?? null,
      consecutiveFailures: row?.consecutive_failures ?? 0,
      quarantineDepth: row?.quarantine_depth ?? 0,
    }
  } finally {
    closeDatabase(db)
  }
}
