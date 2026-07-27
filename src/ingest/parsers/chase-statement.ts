/**
 * Chase credit-card statement notification.
 *
 *   From: no.reply.alerts@chase.com
 *   "Due date 08/22/2026 Minimum payment due $108.85 Statement balance $2709.80"
 *
 * Dates are US MM/DD/YYYY. That is asserted, not detected: `parseSlashDate` takes
 * the order as an argument precisely so this constant sits next to the institution
 * it belongs to, where a reviewer can check it against a real email.
 *
 * The statement period is NOT in this template — Chase's alert states a closing
 * balance and a due date only. `periodStart`/`periodEnd` are therefore null rather
 * than back-computed from the due date, because "due date minus 25 days" is a
 * guess that would silently disagree with the PDF statement when it arrives and
 * make reconciliation produce a phantom mismatch.
 */

import { fromDecimalString } from '@/core/money'
import { parseSlashDate } from '../dates'
import { CHASE, senderIsFrom } from '../senders'
import { messageText } from '../text'
import { type EmailParser } from '../registry'
import { type ParsedFact, type RawMessage, type StatementFact } from '../types'
import { findLast4, optionalField, requireField } from './support'

const ID = 'chase-statement'
const DOMAIN = 'chase.com'

const DUE_DATE = /\bdue date\b\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i
const MINIMUM_DUE = /\bminimum payment due\b\s*:?\s*\$?\s?([\d,]+(?:\.\d{2})?)/i
const STATEMENT_BALANCE = /\bstatement balance\b\s*:?\s*\$?\s?([\d,]+(?:\.\d{2})?)/i

/** Every field is stated verbatim by the issuer; nothing is inferred. */
const CONFIDENCE = 0.98

export const chaseStatementParser: EmailParser = {
  id: ID,
  institution: CHASE,
  region: 'US',
  version: 1,

  match(msg: RawMessage): boolean {
    if (!senderIsFrom(msg.from, DOMAIN)) return false
    const text = messageText(msg)
    return STATEMENT_BALANCE.test(text) && DUE_DATE.test(text)
  },

  extract(msg: RawMessage): ParsedFact[] {
    const text = messageText(msg)

    const dueRaw = requireField(ID, 'dueDate', DUE_DATE, text, 'expected "Due date MM/DD/YYYY"')
    const balanceRaw = requireField(
      ID,
      'statementBalance',
      STATEMENT_BALANCE,
      text,
      'expected "Statement balance $N"',
    )
    // Chase omits the minimum on a zero-balance statement, so this one is optional.
    const minimumRaw = optionalField(MINIMUM_DUE, text)

    const fact: StatementFact = {
      kind: 'statement',
      messageId: msg.id,
      parserId: ID,
      parserVersion: 1,
      account: {
        institution: CHASE,
        region: 'US',
        kind: 'credit_card',
        currency: 'USD',
        last4: findLast4(text),
      },
      confidence: CONFIDENCE,
      periodStart: null,
      periodEnd: null,
      statementBalance: fromDecimalString(balanceRaw, 'USD'),
      minimumDue: minimumRaw === null ? null : fromDecimalString(minimumRaw, 'USD'),
      dueDate: parseSlashDate(dueRaw, 'MDY'),
    }

    return [fact]
  },
}
