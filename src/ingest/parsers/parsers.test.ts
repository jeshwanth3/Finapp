import { describe, expect, it } from 'vitest'

import { toDecimalString } from '@/core/money'

import {
  chaseStatement,
  marketingMessages,
  sbiCardAudAlert,
  sbiCardInrAlert,
  sbiCardUsdAlert,
  usBankAlert,
  zolveStatement,
} from '../fixtures'
import { defaultRegistry } from './index'
import { chaseStatementParser } from './chase-statement'
import { sbiCardAlertParser } from './sbi-card-alert'
import { usBankAlertParser } from './us-bank-alert'
import { zolveStatementParser } from './zolve-statement'
import {
  type ParsedFact,
  type RawMessage,
  type StatementFact,
  type TransactionFact,
} from '../types'

function onlyFact(msg: RawMessage): ParsedFact {
  const outcome = defaultRegistry().ingest(msg)
  if (outcome.status !== 'parsed') {
    throw new Error(`expected parsed, got ${outcome.status}: ${JSON.stringify(outcome)}`)
  }
  expect(outcome.facts).toHaveLength(1)
  return outcome.facts[0] as ParsedFact
}

function transaction(msg: RawMessage): TransactionFact {
  const fact = onlyFact(msg)
  if (fact.kind !== 'transaction') throw new Error(`expected a transaction fact, got ${fact.kind}`)
  return fact
}

function statement(msg: RawMessage): StatementFact {
  const fact = onlyFact(msg)
  if (fact.kind !== 'statement') throw new Error(`expected a statement fact, got ${fact.kind}`)
  return fact
}

describe('us-bank-alert', () => {
  it('extracts the amount and the last four digits', () => {
    const fact = transaction(usBankAlert)
    expect(fact.parserId).toBe('us-bank-alert')
    expect(fact.amount).toEqual({ minor: 250000, currency: 'USD' })
    expect(fact.direction).toBe('debit')
    expect(fact.account.last4).toBe('1729')
    expect(fact.account.institution).toBe('U.S. Bank')
  })

  it('carries NO merchant — the alert contains none and inventing one is forbidden', () => {
    const fact = transaction(usBankAlert)
    expect(fact.descriptorRaw).toBeNull()
    // Explicitly not '': null means "the institution never told us", which the
    // coverage indicator has to be able to distinguish from an empty merchant.
    expect(fact.descriptorRaw).not.toBe('')
  })

  it('does not guess the account kind from an "account ending in" template', () => {
    expect(transaction(usBankAlert).account.kind).toBeNull()
  })

  it('labels the fallback date as coming from the receipt time, not the message', () => {
    const fact = transaction(usBankAlert)
    expect(fact.postedAt).toBe('2026-07-14')
    expect(fact.postedAtSource).toBe('received_at')
    // Inferred date plus absent merchant must not score like a fully-stated fact.
    expect(fact.confidence).toBeLessThan(0.9)
  })
})

describe('chase-statement', () => {
  it('reads due date, minimum and balance out of an HTML table', () => {
    const fact = statement(chaseStatement)
    expect(fact.parserId).toBe('chase-statement')
    expect(fact.dueDate).toBe('2026-08-22')
    expect(fact.minimumDue).toEqual({ minor: 10885, currency: 'USD' })
    expect(fact.statementBalance).toEqual({ minor: 270980, currency: 'USD' })
    expect(fact.account.last4).toBe('4417')
    expect(fact.account.kind).toBe('credit_card')
  })

  it('reads 08/22/2026 as MM/DD/YYYY', () => {
    expect(statement(chaseStatement).dueDate).toBe('2026-08-22')
  })

  it('leaves the statement period null rather than back-computing it from the due date', () => {
    const fact = statement(chaseStatement)
    expect(fact.periodStart).toBeNull()
    expect(fact.periodEnd).toBeNull()
  })
})

describe('sbi-card-alert', () => {
  it('reads 12/07/26 as 12 July — DD/MM/YY, where the two field orders disagree', () => {
    const fact = transaction(sbiCardInrAlert)
    expect(fact.postedAt).toBe('2026-07-12')
    // The MDY misreading is a real date five months away. Assert it is NOT that.
    expect(fact.postedAt).not.toBe('2026-12-07')
    expect(fact.postedAtSource).toBe('message')
  })

  it('extracts an INR charge with its merchant', () => {
    const fact = transaction(sbiCardInrAlert)
    expect(fact.amount).toEqual({ minor: 3588200, currency: 'INR' })
    expect(toDecimalString(fact.amount)).toBe('35882.00')
    expect(fact.descriptorRaw).toBe('RAZDREAMPLUGPAYTECHSOL')
    expect(fact.account.last4).toBe('6286')
    expect(fact.account.currency).toBe('INR')
  })

  it('detects USD from the string instead of assuming the billing currency', () => {
    const fact = transaction(sbiCardUsdAlert)
    expect(fact.amount).toEqual({ minor: 4130, currency: 'USD' })
    // The inequality below is the signal that an INR-billed amount is still pending.
    expect(fact.account.currency).toBe('INR')
    expect(fact.amount.currency).not.toBe(fact.account.currency)
    expect(fact.postedAt).toBe('2026-07-03')
    expect(fact.descriptorRaw).toBe('ANTHROPIC PBC')
  })

  it('detects AUD, and 28/06/26 proves the order is DMY', () => {
    const fact = transaction(sbiCardAudAlert)
    expect(fact.amount).toEqual({ minor: 70743, currency: 'AUD' })
    expect(fact.postedAt).toBe('2026-06-28')
    expect(fact.descriptorRaw).toBe('QANTAS AIRWAYS')
  })

  it('refuses an unrecognised currency token rather than defaulting to INR', () => {
    const weird: RawMessage = {
      ...sbiCardInrAlert,
      id: '<sbi-weird@sbicard.com>',
      text: sbiCardInrAlert.text?.replace('Rs.35882.00', 'XYZ35882.00') ?? null,
    }
    const outcome = defaultRegistry().ingest(weird)
    // No parser recognises the amount phrase any more, so it quarantines rather
    // than producing ₹35,882 for a charge in an unknown currency.
    expect(outcome.status).toBe('quarantined')
  })
})

describe('zolve-statement', () => {
  it('reads the period as MM/DD/YYYY and both amounts', () => {
    const fact = statement(zolveStatement)
    expect(fact.parserId).toBe('zolve-statement')
    expect(fact.periodStart).toBe('2026-06-18')
    expect(fact.periodEnd).toBe('2026-07-17')
    expect(fact.statementBalance).toEqual({ minor: 154910, currency: 'USD' })
    expect(fact.account.last4).toBe('7058')
  })

  it('scales a decimal-less "Min Due $25" to 2500 minor units', () => {
    const fact = statement(zolveStatement)
    expect(fact.minimumDue).toEqual({ minor: 2500, currency: 'USD' })
    expect(toDecimalString(fact.minimumDue as { minor: number; currency: string })).toBe('25.00')
  })

  it('leaves dueDate null — the template states a period, not a deadline', () => {
    expect(statement(zolveStatement).dueDate).toBeNull()
  })
})

describe('cross-parser isolation', () => {
  const parsers = [usBankAlertParser, chaseStatementParser, sbiCardAlertParser, zolveStatementParser]
  const fixtures = [usBankAlert, chaseStatement, sbiCardInrAlert, sbiCardUsdAlert, sbiCardAudAlert, zolveStatement]

  it('never lets two parsers claim the same message', () => {
    for (const fixture of fixtures) {
      const matches = parsers.filter((p) => p.match(fixture)).map((p) => p.id)
      expect(matches).toHaveLength(1)
    }
  })

  it('no parser matches any marketing message, even one carrying its own phrasing', () => {
    for (const m of marketingMessages) {
      // The Amex and U.S. Bank promos literally contain "Your transaction of
      // $2500.00 is complete"; the sender gate is what stops them.
      expect(parsers.filter((p) => p.match(m))).toHaveLength(0)
    }
  })
})
