import { describe, it, expect } from 'vitest'
import { ParserRegistry } from '../registry'
import { BUILT_IN_PARSERS } from './index'
import type { RawMessage, TransactionFact } from '../types'

/**
 * Parsers versus the shapes real institutions actually send.
 *
 * The original fixtures were written from descriptions of these formats. These
 * are written from the messages themselves, and they differ in ways that broke
 * things:
 *
 *   - SBI sends NO plaintext part. Body is HTML only, and the sentence carrying
 *     the amount sits inside nested table cells.
 *   - Real amounts carry thousands separators (`Rs.1,234.00`). Gmail's snippet
 *     strips them, so reading a snippet and calling it the body is misleading.
 *   - Marketing furniture in the same message mentions other currency amounts
 *     (`₹200`, `₹2,500` in an EMI offer), so a greedy amount match finds the
 *     wrong number.
 *
 * CONTENT IS REDACTED. This repository is public. Card last4, names, and
 * amounts are altered, and every tracking URL is stripped — those URLs
 * base64-encode the recipient's email address in the path.
 */

const registry = new ParserRegistry(BUILT_IN_PARSERS)

function ingestOne(msg: RawMessage) {
  return registry.ingest(msg)
}

/**
 * Ingest and return the single fact, failing loudly with the quarantine reason.
 * A test that silently reads `undefined` tells you nothing about why a parser
 * stopped matching, which is the thing you need when a template changes.
 */
function onlyFact(msg: RawMessage) {
  const outcome = ingestOne(msg)
  if (outcome.status !== 'parsed') {
    throw new Error(`expected parsed, got ${outcome.status}: ${JSON.stringify(outcome)}`)
  }
  const fact = outcome.facts[0]
  if (!fact) throw new Error('parsed but produced no facts')
  return fact
}

function statementFact(msg: RawMessage) {
  const fact = onlyFact(msg)
  if (fact.kind !== 'statement') throw new Error(`expected a statement fact, got ${fact.kind}`)
  return fact
}

function transactionFact(msg: RawMessage): TransactionFact {
  const fact = onlyFact(msg)
  if (fact.kind !== 'transaction') throw new Error(`expected a transaction fact, got ${fact.kind}`)
  return fact
}

/* -------------------------------------------------------------------------- */
/* SBI Card transaction alert — HTML only, comma amounts, DD/MM/YY            */
/* -------------------------------------------------------------------------- */

const SBI_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">
<html><head><meta https-equiv="Content-Type" content="text/html; charset=iso-8859-1" />
<title>Untitled Document</title></head><body>
<style>table {border-spacing: 0 !important;border-collapse: collapse !important;}</style>
<table width="600" border="0" align="center"><tr><td>
<table width="560" border="0" align="center"><tr><td align="center">
<img src="https://www.sbicard.com/assets/emailer/header.png" alt="SBI Card" border="0"></td></tr>
<tr><td><table width="558" border="0"><tr><td align="center" bgcolor="#fefefe">
<img src="https://www.sbicard.com/assets/emailer/pulse.jpg" alt="Transaction Alert from Pulse SBI Card!" border="0"></td></tr>
<tr><td align="center"><table width="464" border="0">
<tr><td style="font:22px Arial, Helvetica, sans-serif; color:#565656; padding-top:52px">Dear Cardholder,</td></tr>
<tr><td style="font:22px Arial, Helvetica, sans-serif; color:#565656; padding:30px 0 20px 0;">This is to inform you that, Rs.1,234.00 spent on your SBI Credit Card ending 4321 at NYKAA on 25/07/26. Trxn. not done by you? Report at https://sbicard.com/Dispute. If you have not authorized this transaction please contact the SBI Card Helpline..</td></tr>
<tr><td align="left" style="font:22px Arial;">Never share your Card Number, CVV, PIN, OTP, Internet Banking User ID, Password or URN with anyone.</td></tr>
<tr><td><table width="464" border="0"><tr><td align="left" style="font:22px Arial;">
<span style="color:#000000; font-weight:bold;">Exclusive offer*!</span><br>Now convert your purchases of &#8377;200 and above into Flexipay EMIs with SBI Card. Minimum Booking Amount: &#8377;2,500.</td></tr></table></td></tr>
<tr><td style="font:22px Arial;">Warm regards,<br>SBI Card</td></tr>
</table></td></tr></table></td></tr></table></td></tr></table></body></html>`

const sbiAlert: RawMessage = {
  id: 'sbi-real-1',
  from: 'onlinesbicard@sbicard.com',
  subject: 'Transaction Alert from Pulse SBI Card',
  receivedAt: '2026-07-25T18:07:45.000Z',
  text: null, // SBI sends no plaintext part at all
  html: SBI_HTML,
}

describe('SBI Card alert — the real message shape', () => {
  it('parses from an HTML-only body', () => {
    const outcome = ingestOne(sbiAlert)
    expect(outcome.status).toBe('parsed')
  })

  it('reads the amount THROUGH the thousands separator', () => {
    const outcome = ingestOne(sbiAlert)
    if (outcome.status !== 'parsed') throw new Error(`quarantined: ${JSON.stringify(outcome)}`)
    const fact = outcome.facts[0] as TransactionFact
    // Rs.1,234.00 -> 123400 paise. A parser that stops at the comma reads 1.00.
    expect(fact.amount.minor).toBe(123400)
    expect(fact.amount.currency).toBe('INR')
  })

  it('does NOT pick up the marketing amounts in the same message', () => {
    // The EMI offer mentions Rs.200 and Rs.2,500. A greedy match finds those.
    const fact = transactionFact(sbiAlert)
    expect(fact.amount.minor).not.toBe(20000)
    expect(fact.amount.minor).not.toBe(250000)
  })

  it('reads DD/MM/YY as day-first, not month-first', () => {
    const fact = transactionFact(sbiAlert)
    // 25/07/26 is 25 July 2026. Month-first would be invalid (month 25).
    expect(fact.postedAt).toBe('2026-07-25')
  })

  it('captures the merchant and the card', () => {
    const fact = transactionFact(sbiAlert)
    expect(fact.descriptorRaw).toContain('NYKAA')
    expect(fact.account.last4).toBe('4321')
  })

  it('emits exactly one transaction, not one per amount in the email', () => {
    const outcome = ingestOne(sbiAlert)
    if (outcome.status !== 'parsed') throw new Error('expected parsed')
    expect(outcome.facts).toHaveLength(1)
  })
})

/* -------------------------------------------------------------------------- */
/* US Bank alert — amount present, merchant genuinely absent                  */
/* -------------------------------------------------------------------------- */

const usBankAlert: RawMessage = {
  id: 'usbank-real-1',
  from: 'usbank@notifications.usbank.com',
  subject: 'Your transaction is complete.',
  receivedAt: '2026-07-24T12:51:00.000Z',
  text:
    'View details online or with mobile banking.\nUS Bank\nLog in\n' +
    'Your transaction of $2,500.00 is complete. To review this transaction, ' +
    'log in and view your account ending in 8765.\nLog in\nmanage alerts',
  html: null,
}

describe('US Bank alert — the real message shape', () => {
  it('parses', () => {
    expect(ingestOne(usBankAlert).status).toBe('parsed')
  })

  it('reads the amount through the separator', () => {
    const fact = transactionFact(usBankAlert)
    expect(fact.amount.minor).toBe(250000)
    expect(fact.amount.currency).toBe('USD')
  })

  it('REPORTS NO MERCHANT rather than inventing one', () => {
    // US Bank genuinely does not name the merchant. Filling this with the
    // institution, the subject, or a guess would be a fabricated fact.
    const fact = transactionFact(usBankAlert)
    expect(fact.descriptorRaw).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* Chase statement — several amounts, each meaning something different        */
/* -------------------------------------------------------------------------- */

const chaseStatement: RawMessage = {
  id: 'chase-real-1',
  from: 'no.reply.alerts@chase.com',
  subject: 'Your credit card statement is available',
  receivedAt: '2026-07-25T15:13:12.000Z',
  text:
    'Statement ready\nYour credit card statement is available online\n' +
    'Account Chase Credit Card (...4321)\nDue date 08/22/2026\n' +
    'Minimum payment due $95.40\nStatement balance $2,431.55\nVisit our Resource Center',
  html: null,
}

describe('Chase statement — the real message shape', () => {
  it('parses', () => {
    expect(ingestOne(chaseStatement).status).toBe('parsed')
  })

  it('does not confuse the minimum with the balance', () => {
    const fact = statementFact(chaseStatement)
    expect(fact.statementBalance?.minor).toBe(243155)
    expect(fact.minimumDue?.minor).toBe(9540)
  })

  it('reads MM/DD/YYYY as month-first — the opposite of SBI', () => {
    // The same codebase must read 08/22/2026 as August and 25/07/26 as July.
    const fact = statementFact(chaseStatement)
    expect(fact.dueDate).toBe('2026-08-22')
  })
})

/* -------------------------------------------------------------------------- */
/* Zolve statement — a period range plus two amounts                           */
/* -------------------------------------------------------------------------- */

const zolveStatement: RawMessage = {
  id: 'zolve-real-1',
  from: 'noreply@zolve.com',
  subject: 'Your Zolve Credit Card Statement for July 2026 is here!',
  receivedAt: '2026-07-21T06:54:33.000Z',
  text:
    'Hey CARDHOLDER NAME,\nYour statement for the credit card ending in 4321, ' +
    'covering transactions from 06/18/2026 to 07/17/2026, is now available in the Zolve app.\n' +
    'Total Due $1,287.30\nMin Due $25.00\nPay Now',
  html: null,
}

describe('Zolve statement — the real message shape', () => {
  it('parses', () => {
    expect(ingestOne(zolveStatement).status).toBe('parsed')
  })

  it('captures the statement period in the right order', () => {
    const fact = statementFact(zolveStatement)
    expect(fact.periodStart).toBe('2026-06-18')
    expect(fact.periodEnd).toBe('2026-07-17')
  })

  it('reads total due and minimum due separately', () => {
    const fact = statementFact(zolveStatement)
    expect(fact.statementBalance?.minor).toBe(128730)
    expect(fact.minimumDue?.minor).toBe(2500)
  })
})
