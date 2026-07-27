/**
 * Application data store bridge.
 *
 * Connects Next.js routes (`src/app/**`) to the canonical SQLite store (`src/db`)
 * and deterministic insight engine (`src/engine`).
 *
 * Automatically seeds an in-memory fallback if `./finapp.db` has not been seeded on disk,
 * guaranteeing zero-config reliability in local development and serverless previews.
 */

import { existsSync } from 'node:fs'
import { openDatabase, closeDatabase, IN_MEMORY } from '@/db/db'
import { migrate } from '@/db/migrate'
import { createRepositories, type Repositories } from '@/db/repositories'
import { money, type Money } from '@/core/money'
import type { DebtAccount } from '@/engine/debt-map'
import type { CashFlowRequest, Obligation } from '@/engine/cash-flow'
import { seedOpenDatabase } from '@/db/seed'

/**
 * Returns an opened database and its repository set.
 * Caller is responsible for closing the db when done if not in-memory cache,
 * but for Next.js App Router server rendering, a pooled or short-lived reader is safe.
 */
export function withStore<T>(fn: (repos: Repositories) => T, dbPath = './finapp.db'): T {
  const isFilePresent = existsSync(dbPath)
  const path = isFilePresent ? dbPath : IN_MEMORY
  const db = openDatabase({ path, readOnly: false, createDirectory: true })

  try {
    migrate(db)
    let repos = createRepositories(db)
    // If empty (e.g. fresh memory DB), seed it
    const accounts = repos.accounts.list()
    if (accounts.length === 0) {
      seedOpenDatabase(db)
      repos = createRepositories(db)
    }
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
 * Loads all accounts with their latest statement balances formatted for UI components.
 */
export function getStoreAccounts(dbPath = './finapp.db'): StoreAccountView[] {
  return withStore((repos) => {
    const accounts = repos.accounts.list()
    return accounts.map((acct) => {
      const stmts = repos.statements.listByAccount(acct.id, 1)
      const latestStmt = stmts[0]
      const isChecking = acct.kind === 'checking'

      let balance = money(0, acct.currency)
      let statementBalance: Money | undefined
      let minimumDue: Money | undefined
      let dueDate: string | undefined

      if (latestStmt) {
        balance = latestStmt.statementBalance
        statementBalance = latestStmt.statementBalance
        minimumDue = latestStmt.minimumDue ?? undefined
        dueDate = latestStmt.dueDate ?? undefined
      } else if (isChecking) {
        balance = acct.currency === 'INR' ? money(14500000, 'INR') : money(48210, 'USD')
      }

      // APR mapping (demo/reference basis points for credit cards)
      const aprMap: Record<string, number> = {
        'acct-card-a': 24.49,
        'acct-card-b': 22.99,
        'acct-card-c': 26.24,
        'acct-card-d': 27.99,
        'acct-card-in': 42.0,
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
        aprPercent: aprMap[acct.id],
        lastObservedAt: latestStmt ? latestStmt.periodEnd : '2026-07-25',
      }
    }, dbPath)
  })
}

/**
 * Builds DebtAccount[] array required by `buildDebtMap()` from `src/engine/debt-map.ts`.
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
 * Builds CashFlowRequest required by `projectCashFlow()` from `src/engine/cash-flow.ts`.
 */
export function getCashFlowRequest(today = '2026-07-26', dbPath = './finapp.db'): CashFlowRequest {
  const views = getStoreAccounts(dbPath)
  const checking = views.find((v) => v.kind === 'checking' && v.currency === 'USD')
  const openingBalance = checking ? checking.balance : money(48210, 'USD') // $482.10

  // The canonical Finapp cross-border obligations and bills scheduled for the month
  const obligations: Obligation[] = [
    {
      id: 'ob-rent',
      label: 'Avalon Residential Rent',
      amount: money(150000, 'USD'), // $1,500.00
      dueOn: '2026-08-03',
      movable: false,
      confidence: 'high',
    },
    {
      id: 'ob-card-pay',
      label: 'Chase Card Payment',
      amount: money(150000, 'USD'), // $1,500.00
      dueOn: '2026-08-05',
      movable: true,
      latestMoveTo: '2026-08-16',
      confidence: 'high',
    },
    {
      id: 'ob-zolve-bill',
      label: 'Zolve Bill (Cross-border card)',
      amount: money(94117, 'USD'), // $941.17
      dueOn: '2026-08-07',
      minimumDue: money(2500, 'USD'),
      movable: true,
      latestMoveTo: '2026-08-16',
      confidence: 'high',
    },
    {
      id: 'ob-discover-min',
      label: 'Discover Minimum Payment',
      amount: money(3500, 'USD'), // $35.00
      dueOn: '2026-08-09',
      movable: false,
      confidence: 'high',
    },
    {
      id: 'ob-zolve-min',
      label: 'Zolve Minimum Payment',
      amount: money(2500, 'USD'), // $25.00
      dueOn: '2026-08-10',
      movable: false,
      confidence: 'high',
    },
    {
      id: 'ob-amex-min',
      label: 'Amex Minimum Payment',
      amount: money(4000, 'USD'), // $40.00
      dueOn: '2026-08-14',
      movable: false,
      confidence: 'high',
    },
    {
      id: 'ob-chase-min',
      label: 'Chase Minimum Payment',
      amount: money(10885, 'USD'), // $108.85
      dueOn: '2026-08-22',
      movable: false,
      confidence: 'high',
    },
  ]

  const inflows = [
    {
      id: 'in-payroll-1',
      label: 'Gusto Payroll Deposit',
      expectedOn: '2026-08-01',
      amount: money(281100, 'USD'), // +$2,811.00
      confidence: 'medium' as const,
      assumptions: ['Assumes payroll clears on the 1st'],
    },
    {
      id: 'in-payroll-2',
      label: 'Gusto Payroll Deposit',
      expectedOn: '2026-08-15',
      amount: money(281100, 'USD'), // +$2,811.00
      confidence: 'medium' as const,
      assumptions: ['Assumes payroll clears on the 15th'],
    },
  ]

  return {
    today,
    horizonDays: 45,
    openingBalance,
    floor: money(5000, 'USD'), // $50.00 buffer floor
    obligations,
    inflows,
  }
}
