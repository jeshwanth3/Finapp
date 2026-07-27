import { describe, expect, it } from 'vitest'
import { fromDecimalString, money, toDecimalString } from '@/core/money'
import { openDatabase } from './db'
import { migrate } from './migrate'
import { createRepositories } from './repositories'
import { mapTransactionRow } from './repositories/transactions'
import type { SqlRow } from './repositories/support'

/** Every table spec §7 requires, plus the join tables the arrays normalise into. */
const REQUIRED_TABLES = [
  'accounts',
  'transactions',
  'statements',
  'balance_observations',
  'merchants',
  'merchant_aliases',
  'recurring_streams',
  'price_change_events',
  'insights',
  'insight_evidence',
  'commitments',
  'asset_accounts',
  'instruments',
  'holding_lots',
  'valuations',
  'manual_assets',
  'budgets',
  'categories',
  'raw_messages',
  'parse_failures',
] as const

function freshDb() {
  const db = openDatabase(':memory:')
  migrate(db)
  return db
}

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all()
    .map((row) => String((row as SqlRow)['name']))
}

function seedAccount(db: ReturnType<typeof openDatabase>, currency = 'USD', region = 'US') {
  const repos = createRepositories(db)
  return repos.accounts.insert({
    id: 'acct-1',
    institution: 'Test Bank',
    kind: 'credit_card',
    currency,
    region: region === 'IN' ? 'IN' : 'US',
    displayName: 'Test Card',
    last4Hint: '4242',
  })
}

describe('schema.sql', () => {
  it('applies cleanly to an empty database', () => {
    const db = freshDb()
    const names = tableNames(db)
    for (const table of REQUIRED_TABLES) {
      expect(names, `missing table ${table}`).toContain(table)
    }
    db.close()
  })

  it('passes an integrity check after applying', () => {
    const db = freshDb()
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })

  it('declares every table STRICT so a float cannot land in a minor-unit column', () => {
    const db = freshDb()
    const definitions = db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL`)
      .all()
    for (const row of definitions) {
      const name = String((row as SqlRow)['name'])
      if (name.startsWith('sqlite_')) continue
      expect(String((row as SqlRow)['sql']), `${name} is not STRICT`).toMatch(/STRICT\s*$/)
    }
    db.close()
  })

  it('gives every table a nullable owner_id', () => {
    const db = freshDb()
    for (const table of REQUIRED_TABLES) {
      // PRAGMA does not accept bound parameters; `table` is a literal from the list above.
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as SqlRow[]
      const ownerId = columns.find((column) => column['name'] === 'owner_id')
      expect(ownerId, `${table} has no owner_id`).toBeDefined()
      expect(ownerId?.['notnull'], `${table}.owner_id is NOT NULL`).toBe(0)
    }
    db.close()
  })

  it('has no REAL column holding money', () => {
    const db = freshDb()
    for (const table of REQUIRED_TABLES) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as SqlRow[]
      for (const column of columns) {
        const name = String(column['name'])
        if (!/_minor(_e\d)?$/.test(name)) continue
        expect(String(column['type']), `${table}.${name}`).toBe('INTEGER')
      }
    }
    db.close()
  })

  it('indexes the read paths the app depends on', () => {
    const db = freshDb()
    const indexed = (table: string) =>
      (db.prepare(`PRAGMA index_list(${table})`).all() as SqlRow[]).map((row) => {
        const name = String(row['name'])
        const columns = (db.prepare(`PRAGMA index_info(${name})`).all() as SqlRow[]).map((info) =>
          String(info['name']),
        )
        return { name, unique: row['unique'], columns }
      })

    const transactionIndexes = indexed('transactions')
    expect(
      transactionIndexes.some(
        (index) => index.columns[0] === 'account_id' && index.columns[1] === 'posted_at',
      ),
    ).toBe(true)
    expect(
      transactionIndexes.some((index) => index.unique === 1 && index.columns.includes('dedupe_key')),
    ).toBe(true)

    expect(
      indexed('recurring_streams').some(
        (index) => index.columns[0] === 'merchant_id' && index.columns[1] === 'account_id',
      ),
    ).toBe(true)

    expect(
      indexed('statements').some(
        (index) => index.columns[0] === 'account_id' && index.columns[1] === 'period_end',
      ),
    ).toBe(true)

    db.close()
  })

  it('enforces dedupe_key uniqueness in the DATABASE, not in application code', () => {
    const db = freshDb()
    seedAccount(db)

    // Deliberately raw SQL: this asserts the constraint exists in SQLite, independent of
    // any check the repository might do.
    const insert = db.prepare(
      `INSERT INTO transactions
         (id, account_id, posted_at, amount_minor, currency, merchant_raw,
          direction, source, source_ref, ordinal, confidence, dedupe_key)
       VALUES (?, 'acct-1', '2026-07-01', -1299, 'USD', 'NETFLIX.COM',
               'debit', 'alert', 'msg-1', 0, 0.9, 'dk-shared')`,
    )

    insert.run('txn-a')
    expect(() => insert.run('txn-b')).toThrowError(/UNIQUE constraint failed/)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get()).toEqual({ n: 1 })
    db.close()
  })

  it('rejects a direction that disagrees with the sign of the amount', () => {
    const db = freshDb()
    seedAccount(db)
    expect(() =>
      db
        .prepare(
          `INSERT INTO transactions
             (id, account_id, posted_at, amount_minor, currency, merchant_raw,
              direction, source, source_ref, ordinal, confidence, dedupe_key)
           VALUES ('txn-bad', 'acct-1', '2026-07-01', -500, 'USD', 'X',
                   'credit', 'alert', 'msg-2', 0, 1.0, 'dk-bad')`,
        )
        .run(),
    ).toThrowError(/CHECK constraint failed/)
    db.close()
  })

  it('rejects a float written into a minor-unit column (STRICT)', () => {
    const db = freshDb()
    seedAccount(db)
    expect(() =>
      db
        .prepare(
          `INSERT INTO transactions
             (id, account_id, posted_at, amount_minor, currency, merchant_raw,
              direction, source, source_ref, ordinal, confidence, dedupe_key)
           VALUES ('txn-f', 'acct-1', '2026-07-01', -12.99, 'USD', 'X',
                   'debit', 'alert', 'msg-3', 0, 1.0, 'dk-f')`,
        )
        .run(),
    ).toThrowError(/cannot store REAL value in INTEGER column/i)
    db.close()
  })

  it('rejects a transaction against an account that does not exist', () => {
    const db = freshDb()
    expect(() =>
      db
        .prepare(
          `INSERT INTO transactions
             (id, account_id, posted_at, amount_minor, currency, merchant_raw,
              direction, source, source_ref, ordinal, confidence, dedupe_key)
           VALUES ('txn-o', 'nope', '2026-07-01', -1, 'USD', 'X',
                   'debit', 'alert', 'msg-4', 0, 1.0, 'dk-o')`,
        )
        .run(),
    ).toThrowError(/FOREIGN KEY constraint failed/)
    db.close()
  })

  it('lets an expired commitment exist without a verification instant', () => {
    const db = freshDb()
    // The original CHECK required verified_at for anything that was not 'open', which made
    // the 'expired' status — a deadline that passed unverified — impossible to record.
    db.prepare(
      `INSERT INTO commitments
         (id, target_monthly_saving_minor, currency, status)
       VALUES ('c-1', 250000, 'USD', 'expired')`,
    ).run()
    expect(db.prepare(`SELECT status FROM commitments WHERE id = 'c-1'`).get()).toEqual({
      status: 'expired',
    })
    expect(() =>
      db
        .prepare(
          `INSERT INTO commitments (id, target_monthly_saving_minor, currency, status)
           VALUES ('c-2', 250000, 'USD', 'kept')`,
        )
        .run(),
    ).toThrowError(/CHECK constraint failed/)
    db.close()
  })
})

describe('money round-trips through SQLite', () => {
  it('preserves USD cents exactly', () => {
    const db = freshDb()
    const repos = createRepositories(db)
    seedAccount(db)

    const amount = fromDecimalString('$2,709.80', 'USD')
    expect(amount.minor).toBe(270980)

    const written = repos.transactions.insert({
      accountId: 'acct-1',
      postedAt: '2026-07-01',
      amount: money(-amount.minor, 'USD'),
      merchantRaw: 'AMAZON MKTPL',
      source: 'alert',
      sourceRef: 'msg-usd',
      confidence: 0.9,
    })

    const read = repos.transactions.getById(written.id)
    expect(read.amount).toEqual({ minor: -270980, currency: 'USD' })
    expect(toDecimalString(read.amount)).toBe('-2709.80')
    db.close()
  })

  it('survives a large INR amount (Rs.87,423.00 = 8742300 paise)', () => {
    const db = freshDb()
    const repos = createRepositories(db)
    repos.accounts.insert({
      id: 'acct-in',
      institution: 'HDFC',
      kind: 'credit_card',
      currency: 'INR',
      region: 'IN',
      displayName: 'HDFC Card',
    })

    const parsed = fromDecimalString('Rs.87,423.00', 'INR')
    expect(parsed.minor).toBe(8742300)

    const written = repos.transactions.insert({
      accountId: 'acct-in',
      postedAt: '2026-07-04',
      amount: money(-parsed.minor, 'INR'),
      merchantRaw: 'SWIGGY BANGALORE',
      source: 'statement_pdf',
      sourceRef: 'stmt-1',
      ordinal: 12,
      statementId: null,
      confidence: 1,
      region: 'IN',
    })

    const read = repos.transactions.getById(written.id)
    expect(read.amount.minor).toBe(-8742300)
    expect(read.amount.currency).toBe('INR')
    expect(toDecimalString(read.amount)).toBe('-87423.00')

    // And through the raw row, to prove the pair — not a formatted string — is what is stored.
    const row = db
      .prepare(`SELECT amount_minor, currency FROM transactions WHERE id = ?`)
      .get(written.id)
    expect(row).toEqual({ amount_minor: -8742300, currency: 'INR' })
    db.close()
  })

  it('preserves the largest JavaScript-safe minor value', () => {
    const db = freshDb()
    seedAccount(db)
    const extreme = Number.MAX_SAFE_INTEGER
    db.prepare(
      `INSERT INTO transactions
         (id, account_id, posted_at, amount_minor, currency, merchant_raw,
          direction, source, source_ref, ordinal, confidence, dedupe_key)
       VALUES ('txn-max', 'acct-1', '2026-07-01', ?, 'USD', 'X',
               'credit', 'manual', 'msg-max', 0, 1.0, 'dk-max')`,
    ).run(extreme)

    const row = db.prepare(`SELECT * FROM transactions WHERE id = 'txn-max'`).get()
    expect(row).toBeDefined()
    const decoded = mapTransactionRow(row as SqlRow)
    expect(decoded.amount.minor).toBe(extreme)

    // One past the safe range must be refused rather than rounded on read.
    expect(() =>
      db
        .prepare(
          `INSERT INTO transactions
             (id, account_id, posted_at, amount_minor, currency, merchant_raw,
              direction, source, source_ref, ordinal, confidence, dedupe_key)
           VALUES ('txn-over', 'acct-1', '2026-07-01', 9007199254740992, 'USD', 'X',
                   'credit', 'manual', 'msg-over', 0, 1.0, 'dk-over')`,
        )
        .run(),
    ).toThrowError(/CHECK constraint failed/)
    db.close()
  })
})
