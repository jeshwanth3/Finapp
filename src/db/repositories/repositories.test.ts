import { beforeEach, describe, expect, it } from 'vitest'
import { CurrencyMismatchError, fromDecimalString, money, toDecimalString } from '@/core/money'
import { dedupeKey } from '@/core/reconcile'
import { openDatabase } from '../db'
import { migrate } from '../migrate'
import { createRepositories, type Repositories } from './index'
import { DuplicateAccountError } from './accounts'
import { DuplicateTransactionError, InvalidSupersedeError } from './transactions'
import { DuplicateStatementError } from './statements'
import { InvalidArgumentError, RecordNotFoundError } from './support'
import type { Database } from '../sqlite'

let db: Database
let repos: Repositories

beforeEach(() => {
  db = openDatabase(':memory:')
  migrate(db)
  repos = createRepositories(db)
})

function usdCard(id = 'acct-us') {
  return repos.accounts.insert({
    id,
    institution: 'Chase',
    kind: 'credit_card',
    currency: 'USD',
    region: 'US',
    displayName: 'Sapphire',
    last4Hint: '1234',
  })
}

function inrCard(id = 'acct-in') {
  return repos.accounts.insert({
    id,
    institution: 'HDFC',
    kind: 'credit_card',
    currency: 'INR',
    region: 'IN',
    displayName: 'HDFC Millennia',
  })
}

describe('AccountsRepository', () => {
  it('round-trips an account', () => {
    const created = usdCard()
    expect(repos.accounts.getById(created.id)).toEqual(created)
    expect(created.ownerId).toBeNull()
    expect(created.isActive).toBe(true)
  })

  it('rejects an unknown currency using the money module’s own validator', () => {
    expect(() =>
      repos.accounts.insert({
        institution: 'X',
        kind: 'checking',
        currency: 'DOLLARS',
        region: 'US',
        displayName: 'X',
      }),
    ).toThrowError(/Invalid ISO-4217 currency code/)
  })

  it('rejects a last4 hint that is not four digits', () => {
    expect(() =>
      repos.accounts.insert({
        institution: 'X',
        kind: 'checking',
        currency: 'USD',
        region: 'US',
        displayName: 'X',
        last4Hint: '12345678',
      }),
    ).toThrowError(InvalidArgumentError)
  })

  it('names the duplicate rather than leaking a SQLITE_CONSTRAINT', () => {
    usdCard()
    expect(() => usdCard()).toThrowError(DuplicateAccountError)
  })

  it('lists active accounts and hides deactivated ones by default', () => {
    usdCard()
    inrCard()
    expect(repos.accounts.list().map((a) => a.id)).toEqual(['acct-in', 'acct-us'])

    repos.accounts.setActive('acct-in', false)
    expect(repos.accounts.list().map((a) => a.id)).toEqual(['acct-us'])
    expect(repos.accounts.list(null, { includeInactive: true })).toHaveLength(2)
  })

  it('throws a named error for a missing account', () => {
    expect(() => repos.accounts.getById('nope')).toThrowError(RecordNotFoundError)
    expect(repos.accounts.findById('nope')).toBeNull()
  })
})

describe('TransactionsRepository', () => {
  it('derives direction from the sign of the amount', () => {
    usdCard()
    const debit = repos.transactions.insert({
      accountId: 'acct-us',
      postedAt: '2026-07-02',
      amount: money(-1299, 'USD'),
      merchantRaw: 'NETFLIX.COM',
      source: 'alert',
      sourceRef: 'msg-1',
      confidence: 0.9,
    })
    const credit = repos.transactions.insert({
      accountId: 'acct-us',
      postedAt: '2026-07-03',
      amount: money(1299, 'USD'),
      merchantRaw: 'NETFLIX.COM REFUND',
      source: 'alert',
      sourceRef: 'msg-2',
      confidence: 0.9,
    })
    expect(debit.direction).toBe('debit')
    expect(credit.direction).toBe('credit')
  })

  it('derives dedupe_key from provenance via @/core/reconcile', () => {
    usdCard()
    const written = repos.transactions.insert({
      accountId: 'acct-us',
      postedAt: '2026-07-02',
      amount: money(-1299, 'USD'),
      merchantRaw: 'NETFLIX.COM',
      source: 'alert',
      sourceRef: 'msg-1',
      ordinal: 3,
      confidence: 0.9,
    })
    expect(written.dedupeKey).toBe(
      dedupeKey({
        sourceType: 'alert',
        sourceRef: 'msg-1',
        ordinal: 3,
        accountId: 'acct-us',
        postedAt: '2026-07-02',
        amount: money(-1299, 'USD'),
        descriptorRaw: 'NETFLIX.COM',
      }),
    )
  })

  it('refuses a second insert with the same dedupe_key', () => {
    usdCard()
    const input = {
      accountId: 'acct-us',
      postedAt: '2026-07-02',
      amount: money(-1299, 'USD'),
      merchantRaw: 'NETFLIX.COM',
      source: 'alert' as const,
      sourceRef: 'msg-1',
      confidence: 0.9,
    }
    repos.transactions.insert(input)
    expect(() => repos.transactions.insert(input)).toThrowError(DuplicateTransactionError)
    expect(repos.transactions.countLive('acct-us')).toBe(1)
  })

  it('refuses a statement reference on a non-statement row', () => {
    usdCard()
    expect(() =>
      repos.transactions.insert({
        accountId: 'acct-us',
        postedAt: '2026-07-02',
        amount: money(-100, 'USD'),
        merchantRaw: 'X',
        source: 'alert',
        sourceRef: 'msg-9',
        statementId: 'stmt-1',
        confidence: 1,
      }),
    ).toThrowError(/only a statement_pdf row/)
  })

  it('rejects a confidence outside [0, 1] and a malformed date', () => {
    usdCard()
    const base = {
      accountId: 'acct-us',
      postedAt: '2026-07-02',
      amount: money(-100, 'USD'),
      merchantRaw: 'X',
      source: 'alert' as const,
      sourceRef: 'msg-a',
      confidence: 0.5,
    }
    expect(() => repos.transactions.insert({ ...base, confidence: 1.5 })).toThrowError(
      InvalidArgumentError,
    )
    expect(() => repos.transactions.insert({ ...base, postedAt: '02/07/2026' })).toThrowError(
      InvalidArgumentError,
    )
  })

  it('filters a ledger by date and excludes superseded rows by default', () => {
    usdCard()
    const insert = (day: string, ref: string) =>
      repos.transactions.insert({
        accountId: 'acct-us',
        postedAt: day,
        amount: money(-500, 'USD'),
        merchantRaw: 'STARBUCKS',
        source: 'alert',
        sourceRef: ref,
        confidence: 0.8,
      })

    const june = insert('2026-06-30', 'm-1')
    const julyEarly = insert('2026-07-01', 'm-2')
    insert('2026-07-15', 'm-3')

    expect(repos.transactions.listByAccount('acct-us').map((t) => t.postedAt)).toEqual([
      '2026-07-15',
      '2026-07-01',
      '2026-06-30',
    ])
    expect(
      repos.transactions
        .listByAccount('acct-us', { from: '2026-07-01', to: '2026-07-31' })
        .map((t) => t.postedAt),
    ).toEqual(['2026-07-15', '2026-07-01'])

    expect(() =>
      repos.transactions.listByAccount('acct-us', { from: '2026-08-01', to: '2026-07-01' }),
    ).toThrowError(InvalidArgumentError)

    // Supersede the June alert with the July authoritative row.
    repos.transactions.markSuperseded(june.id, julyEarly.id)
    expect(repos.transactions.listByAccount('acct-us')).toHaveLength(2)
    expect(repos.transactions.listByAccount('acct-us', { includeSuperseded: true })).toHaveLength(3)
  })

  it('keeps superseded rows queryable, with both directions of the link', () => {
    usdCard()
    const stmt = repos.statements.insert({
      id: 'stmt-1',
      accountId: 'acct-us',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      statementBalance: money(-125000, 'USD'),
      minimumDue: money(-3500, 'USD'),
      dueDate: '2026-07-21',
      sourceMessageId: 'msg-stmt-1',
    })

    const alert = repos.transactions.insert({
      accountId: 'acct-us',
      postedAt: '2026-06-14',
      amount: money(-4599, 'USD'),
      merchantRaw: 'WHOLEFDS MKT 123',
      source: 'alert',
      sourceRef: 'msg-alert-1',
      confidence: 0.7,
    })
    const authoritative = repos.transactions.insert({
      accountId: 'acct-us',
      postedAt: '2026-06-16',
      amount: money(-4599, 'USD'),
      merchantRaw: 'WHOLE FOODS MARKET #123',
      source: 'statement_pdf',
      sourceRef: stmt.id,
      ordinal: 7,
      statementId: stmt.id,
      confidence: 1,
    })

    const updated = repos.transactions.markSuperseded(alert.id, authoritative.id)
    expect(updated.supersededBy).toBe(authoritative.id)

    expect(repos.transactions.listSuperseded('acct-us').map((t) => t.id)).toEqual([alert.id])
    expect(repos.transactions.listSupersededBy(authoritative.id).map((t) => t.id)).toEqual([
      alert.id,
    ])
    // The superseded row keeps its own money, unmodified.
    expect(repos.transactions.getById(alert.id).amount).toEqual({ minor: -4599, currency: 'USD' })
    expect(repos.transactions.countLive('acct-us')).toBe(1)
  })

  it('refuses nonsensical supersedes', () => {
    usdCard()
    const a = repos.transactions.insert({
      accountId: 'acct-us',
      postedAt: '2026-07-02',
      amount: money(-100, 'USD'),
      merchantRaw: 'A',
      source: 'alert',
      sourceRef: 'r-a',
      confidence: 1,
    })
    const b = repos.transactions.insert({
      accountId: 'acct-us',
      postedAt: '2026-07-02',
      amount: money(-100, 'USD'),
      merchantRaw: 'B',
      source: 'alert',
      sourceRef: 'r-b',
      confidence: 1,
    })

    expect(() => repos.transactions.markSuperseded(a.id, a.id)).toThrowError(InvalidSupersedeError)
    expect(() => repos.transactions.markSuperseded(a.id, 'ghost')).toThrowError(
      InvalidSupersedeError,
    )
    expect(() => repos.transactions.markSuperseded('ghost', b.id)).toThrowError(RecordNotFoundError)

    repos.transactions.markSuperseded(a.id, b.id)
    expect(() => repos.transactions.markSuperseded(a.id, b.id)).toThrowError(InvalidSupersedeError)
  })

  it('carries INR paise across the boundary without loss', () => {
    inrCard()
    const parsed = fromDecimalString('₹1,08,244.50', 'INR')
    expect(parsed.minor).toBe(10824450)

    const written = repos.transactions.insert({
      accountId: 'acct-in',
      postedAt: '2026-07-09',
      amount: money(-parsed.minor, 'INR'),
      merchantRaw: 'AMAZON PAY INDIA',
      source: 'alert',
      sourceRef: 'msg-in-1',
      confidence: 0.9,
      region: 'IN',
    })

    const read = repos.transactions.getById(written.id)
    expect(read.amount).toEqual({ minor: -10824450, currency: 'INR' })
    expect(toDecimalString(read.amount)).toBe('-108244.50')
  })
})

describe('StatementsRepository', () => {
  it('round-trips a statement with both money values', () => {
    usdCard()
    const created = repos.statements.insert({
      accountId: 'acct-us',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      statementBalance: money(-270980, 'USD'),
      minimumDue: money(-3500, 'USD'),
      dueDate: '2026-07-21',
      sourceMessageId: 'msg-stmt',
      pdfPath: '/vault/2026-06.pdf',
    })
    const read = repos.statements.getById(created.id)
    expect(read.statementBalance).toEqual({ minor: -270980, currency: 'USD' })
    expect(read.minimumDue).toEqual({ minor: -3500, currency: 'USD' })
    expect(read.isParsed).toBe(false)
    expect(repos.statements.markParsed(created.id).isParsed).toBe(true)
  })

  it('keeps a null minimum due null rather than turning it into zero', () => {
    usdCard()
    const created = repos.statements.insert({
      accountId: 'acct-us',
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      statementBalance: money(0, 'USD'),
      sourceMessageId: 'msg-null',
    })
    expect(repos.statements.getById(created.id).minimumDue).toBeNull()
  })

  it('refuses a statement whose two amounts disagree on currency', () => {
    usdCard()
    expect(() =>
      repos.statements.insert({
        accountId: 'acct-us',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        statementBalance: money(-270980, 'USD'),
        minimumDue: money(-3500, 'INR'),
        sourceMessageId: 'msg-mixed',
      }),
    ).toThrowError(CurrencyMismatchError)
  })

  it('refuses an inverted period and a duplicate period', () => {
    usdCard()
    expect(() =>
      repos.statements.insert({
        accountId: 'acct-us',
        periodStart: '2026-06-30',
        periodEnd: '2026-06-01',
        statementBalance: money(0, 'USD'),
        sourceMessageId: 'msg-x',
      }),
    ).toThrowError(InvalidArgumentError)

    const input = {
      accountId: 'acct-us',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      statementBalance: money(0, 'USD'),
      sourceMessageId: 'msg-y',
    }
    repos.statements.insert(input)
    expect(() => repos.statements.insert({ ...input, id: 'other' })).toThrowError(
      DuplicateStatementError,
    )
  })

  it('lists newest first and finds statements due in a window', () => {
    usdCard()
    for (const [start, end, due] of [
      ['2026-04-01', '2026-04-30', '2026-05-21'],
      ['2026-05-01', '2026-05-31', '2026-06-21'],
      ['2026-06-01', '2026-06-30', '2026-07-21'],
    ] as const) {
      repos.statements.insert({
        accountId: 'acct-us',
        periodStart: start,
        periodEnd: end,
        statementBalance: money(-100000, 'USD'),
        dueDate: due,
        sourceMessageId: `msg-${start}`,
      })
    }

    expect(repos.statements.listByAccount('acct-us').map((s) => s.periodEnd)).toEqual([
      '2026-06-30',
      '2026-05-31',
      '2026-04-30',
    ])
    expect(repos.statements.latestForAccount('acct-us')?.periodEnd).toBe('2026-06-30')
    expect(repos.statements.dueBetween('2026-06-01', '2026-07-31').map((s) => s.dueDate)).toEqual([
      '2026-06-21',
      '2026-07-21',
    ])
    expect(repos.statements.findByPeriod('acct-us', '2026-05-01', '2026-05-31')).not.toBeNull()
    expect(repos.statements.findByPeriod('acct-us', '2026-05-01', '2026-05-30')).toBeNull()
  })
})

describe('InsightsRepository', () => {
  it('writes an insight with its evidence atomically', () => {
    usdCard()
    const txn = repos.transactions.insert({
      accountId: 'acct-us',
      postedAt: '2026-07-02',
      amount: money(-1899, 'USD'),
      merchantRaw: 'NETFLIX.COM',
      source: 'alert',
      sourceRef: 'msg-1',
      confidence: 0.9,
    })

    const insight = repos.insights.insert({
      kind: 'price_increase',
      severity: 'warning',
      title: 'Netflix went up $6.00/mo',
      body: 'Charged $18.99, up from $12.99.',
      evidence: [
        { kind: 'transaction', id: txn.id },
        { kind: 'transaction', id: txn.id },
        { kind: 'message', id: 'msg-1' },
      ],
    })

    // The duplicate citation is collapsed rather than failing the write.
    expect(insight.evidence).toEqual([
      { kind: 'transaction', id: txn.id },
      { kind: 'message', id: 'msg-1' },
    ])
    expect(repos.insights.getById(insight.id).evidence).toEqual(insight.evidence)
    expect(repos.insights.listCiting('transaction', txn.id).map((i) => i.id)).toEqual([insight.id])
  })

  it('leaves nothing behind when the evidence write fails', () => {
    expect(() =>
      repos.insights.insert({
        id: 'i-bad',
        kind: 'test',
        severity: 'info',
        title: 'T',
        body: 'B',
        // 'not_a_kind' violates the CHECK on insight_evidence.evidence_kind.
        evidence: [{ kind: 'not_a_kind' as 'transaction', id: 'x' }],
      }),
    ).toThrowError(/CHECK constraint failed/)

    expect(repos.insights.findById('i-bad')).toBeNull()
    expect(repos.insights.countLive()).toBe(0)
  })

  it('lists live insights and dismisses idempotently', () => {
    const a = repos.insights.insert({
      kind: 'price_increase',
      severity: 'warning',
      title: 'A',
      body: '',
      generatedAt: '2026-07-01T00:00:00.000Z',
    })
    const b = repos.insights.insert({
      kind: 'due_date_risk',
      severity: 'critical',
      title: 'B',
      body: '',
      generatedAt: '2026-07-05T00:00:00.000Z',
    })

    expect(repos.insights.listLive().map((i) => i.id)).toEqual([b.id, a.id])
    expect(repos.insights.listLive({ kind: 'due_date_risk' }).map((i) => i.id)).toEqual([b.id])

    const dismissed = repos.insights.dismiss(b.id, '2026-07-06T09:00:00.000Z')
    expect(dismissed.isDismissed).toBe(true)
    expect(dismissed.dismissedAt).toBe('2026-07-06T09:00:00.000Z')

    // Dismissing again keeps the first timestamp instead of overwriting it.
    expect(repos.insights.dismiss(b.id, '2026-07-07T09:00:00.000Z').dismissedAt).toBe(
      '2026-07-06T09:00:00.000Z',
    )
    expect(repos.insights.listLive().map((i) => i.id)).toEqual([a.id])
    expect(repos.insights.countLive()).toBe(1)
    expect(() => repos.insights.dismiss('ghost')).toThrowError(RecordNotFoundError)
  })
})
