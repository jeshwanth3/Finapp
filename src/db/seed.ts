/**
 * Seeding script for Finapp database.
 *
 * Populates `./finapp.db` (or custom path) with authentic Finapp US/IN accounts,
 * statement balances, and sample transactions matching the canonical demo fixtures.
 */

import { openDatabase, closeDatabase, withTransaction } from './db'
import type { Database } from './sqlite'
import { migrate } from './migrate'
import { createRepositories } from './repositories'
import { money } from '../core/money'

export function seedOpenDatabase(db: Database): void {
  migrate(db)
  const repos = createRepositories(db)

  withTransaction(db, () => {
      const existing = repos.accounts.findById('acct-checking')
      if (existing) {
        return
      }

      // 1. Insert Authentic Finapp Accounts (from canonical fixtures)
      repos.accounts.insert({
        id: 'acct-checking',
        institution: 'US Bank',
        kind: 'checking',
        currency: 'USD',
        region: 'US',
        displayName: 'Everyday Checking',
        last4Hint: '4821',
        isActive: true,
      })

      repos.accounts.insert({
        id: 'acct-card-a',
        institution: 'Chase',
        kind: 'credit_card',
        currency: 'USD',
        region: 'US',
        displayName: 'Freedom Unlimited',
        last4Hint: '2709',
        isActive: true,
      })

      repos.accounts.insert({
        id: 'acct-card-b',
        institution: 'Amex',
        kind: 'credit_card',
        currency: 'USD',
        region: 'US',
        displayName: 'Blue Cash Preferred',
        last4Hint: '1184',
        isActive: true,
      })

      repos.accounts.insert({
        id: 'acct-card-c',
        institution: 'Discover',
        kind: 'credit_card',
        currency: 'USD',
        region: 'US',
        displayName: 'Discover it',
        last4Hint: '6215',
        isActive: true,
      })

      repos.accounts.insert({
        id: 'acct-card-d',
        institution: 'Zolve',
        kind: 'credit_card',
        currency: 'USD',
        region: 'US',
        displayName: 'Zolve Classic',
        last4Hint: '1549',
        isActive: true,
      })

      repos.accounts.insert({
        id: 'acct-card-in',
        institution: 'SBI Card',
        kind: 'credit_card',
        currency: 'INR',
        region: 'IN',
        displayName: 'SBI Card PULSE',
        last4Hint: '8742',
        isActive: true,
      })

      // 2. Insert Authoritative Statements for Credit Cards
      const stmtChase = repos.statements.insert({
        id: 'stmt-chase-0726',
        accountId: 'acct-card-a',
        periodStart: '2026-06-25',
        periodEnd: '2026-07-25',
        statementBalance: money(270980, 'USD'), // $2,709.80
        minimumDue: money(10885, 'USD'),        // $108.85
        dueDate: '2026-08-22',
        sourceMessageId: 'msg-chase-statement-01',
        isParsed: true,
      })

      const stmtAmex = repos.statements.insert({
        id: 'stmt-amex-0726',
        accountId: 'acct-card-b',
        periodStart: '2026-06-20',
        periodEnd: '2026-07-20',
        statementBalance: money(118430, 'USD'), // $1,184.30
        minimumDue: money(4000, 'USD'),         // $40.00
        dueDate: '2026-08-14',
        sourceMessageId: 'msg-amex-statement-01',
        isParsed: true,
      })

      const stmtDiscover = repos.statements.insert({
        id: 'stmt-discover-0726',
        accountId: 'acct-card-c',
        periodStart: '2026-06-22',
        periodEnd: '2026-07-22',
        statementBalance: money(62150, 'USD'), // $621.50
        minimumDue: money(3500, 'USD'),        // $35.00
        dueDate: '2026-08-09',
        sourceMessageId: 'msg-discover-statement-01',
        isParsed: true,
      })

      const stmtZolve = repos.statements.insert({
        id: 'stmt-zolve-0726',
        accountId: 'acct-card-d',
        periodStart: '2026-06-21',
        periodEnd: '2026-07-21',
        statementBalance: money(154910, 'USD'), // $1,549.10
        minimumDue: money(2500, 'USD'),         // $25.00
        dueDate: '2026-08-10',
        sourceMessageId: 'msg-zolve-statement-01',
        isParsed: true,
      })

      const stmtSbi = repos.statements.insert({
        id: 'stmt-sbi-0726',
        accountId: 'acct-card-in',
        periodStart: '2026-06-03',
        periodEnd: '2026-07-03',
        statementBalance: money(8742300, 'INR'), // ₹87,423.00
        minimumDue: money(437100, 'INR'),        // ₹4,371.00
        dueDate: '2026-08-18',
        sourceMessageId: 'msg-sbi-statement-01',
        isParsed: true,
      })

      // 3. Insert Authentic Sample Transactions
      repos.transactions.insert({
        accountId: 'acct-checking',
        postedAt: '2026-07-01',
        amount: money(281100, 'USD'), // Payroll +$2,811.00
        merchantRaw: 'GUSTO PAYROLL DEPOSIT',
        source: 'manual',
        sourceRef: 'seed-pay-01',
        confidence: 1.0,
      })

      repos.transactions.insert({
        accountId: 'acct-checking',
        postedAt: '2026-07-03',
        amount: money(-150000, 'USD'), // Rent -$1,500.00
        merchantRaw: 'AVALON RESIDENTIAL RENT',
        source: 'manual',
        sourceRef: 'seed-rent-01',
        confidence: 1.0,
      })

      repos.transactions.insert({
        accountId: 'acct-checking',
        postedAt: '2026-07-15',
        amount: money(281100, 'USD'), // Payroll +$2,811.00
        merchantRaw: 'GUSTO PAYROLL DEPOSIT',
        source: 'manual',
        sourceRef: 'seed-pay-02',
        confidence: 1.0,
      })

      repos.transactions.insert({
        accountId: 'acct-card-a',
        postedAt: '2026-07-22',
        amount: money(-19754, 'USD'), // Verve AI quarterly $197.54
        merchantRaw: 'VERVE AI SUBSCRIPTION',
        source: 'statement_pdf',
        sourceRef: 'stmt-chase-0726',
        statementId: stmtChase.id,
        confidence: 1.0,
      })

      repos.transactions.insert({
        accountId: 'acct-card-b',
        postedAt: '2026-07-18',
        amount: money(-3200, 'USD'), // Canva double bill $32.00
        merchantRaw: 'CANVA* DESIGN TEAM',
        source: 'statement_pdf',
        sourceRef: 'stmt-amex-0726',
        statementId: stmtAmex.id,
        confidence: 1.0,
      })

      repos.transactions.insert({
        accountId: 'acct-card-c',
        postedAt: '2026-07-19',
        amount: money(-3500, 'USD'),
        merchantRaw: 'DISCOVER MINIMUM PAYMENT',
        source: 'statement_pdf',
        sourceRef: 'stmt-discover-0726',
        statementId: stmtDiscover.id,
        confidence: 1.0,
      })

      repos.transactions.insert({
        accountId: 'acct-card-d',
        postedAt: '2026-07-20',
        amount: money(-94117, 'USD'), // Zolve bill charge $941.17
        merchantRaw: 'ZOLVE CROSS BORDER PAYMENT',
        source: 'statement_pdf',
        sourceRef: 'stmt-zolve-0726',
        statementId: stmtZolve.id,
        confidence: 1.0,
      })

      repos.transactions.insert({
        accountId: 'acct-card-in',
        postedAt: '2026-07-21',
        amount: money(-8742300, 'INR'), // ₹87,423.00
        merchantRaw: 'SBI CARD PULSE ONLINE CHARGE',
        source: 'statement_pdf',
        sourceRef: 'stmt-sbi-0726',
        statementId: stmtSbi.id,
        confidence: 1.0,
      })
  })
}

export function seedDatabase(dbPath = './finapp.db'): void {
  const db = openDatabase({ path: dbPath, createDirectory: true })

  try {
    seedOpenDatabase(db)
  } finally {
    closeDatabase(db)
  }
}

if (require.main === module || process.argv[1]?.endsWith('seed.ts')) {
  const targetPath = process.argv[2] ?? './finapp.db'
  console.log(`Seeding authentic Finapp database at ${targetPath}...`)
  seedDatabase(targetPath)
  console.log('Database seeded successfully.')
}
