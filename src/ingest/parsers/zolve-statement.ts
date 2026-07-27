/**
 * Zolve credit-card statement notification.
 *
 *   From: noreply@zolve.com
 *   "...statement for the credit card ending in 7058, covering transactions from
 *    06/18/2026 to 07/17/2026 ... Total Due $1549.10 Min Due $25"
 *
 * Zolve is a US-issued, USD-billed card marketed to Indian immigrants, so it is a
 * `region: 'US'` account even though the cardholder's other accounts are Indian.
 * That distinction matters to descriptor normalisation, which parses US card
 * descriptors and Indian UPI descriptors differently.
 *
 * Dates are US MM/DD/YYYY, pinned as a constant next to the institution. Note the
 * contrast with `sbi-card-alert`, which is DMY: these two parsers sit in the same
 * mailbox and disagreeing about field order is the whole reason `parseSlashDate`
 * refuses to infer.
 *
 * "Min Due $25" carries no decimals. `fromDecimalString` scales it to 2500 minor
 * units rather than 25 — the same code path that would reject "$25.001" for having
 * more precision than USD has.
 */

import { fromDecimalString } from '@/core/money'
import { parseSlashDate } from '../dates'
import { senderIsFrom, ZOLVE } from '../senders'
import { messageText } from '../text'
import { type EmailParser } from '../registry'
import { type ParsedFact, type RawMessage, type StatementFact } from '../types'
import { findLast4, optionalField, requireField } from './support'

const ID = 'zolve-statement'
const DOMAIN = 'zolve.com'

const PERIOD =
  /covering transactions from\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+to\s+(\d{1,2}\/\d{1,2}\/\d{4})/i
const TOTAL_DUE = /\btotal due\b\s*:?\s*\$?\s?([\d,]+(?:\.\d{2})?)/i
/** Anchored on a word boundary so "Total Due" can never satisfy the minimum. */
const MIN_DUE = /\bmin(?:imum)? due\b\s*:?\s*\$?\s?([\d,]+(?:\.\d{2})?)/i
const STATEMENT_PHRASE = /statement for the credit card/i

/** Period, balance and minimum are all stated; only the due date is absent. */
const CONFIDENCE = 0.95

export const zolveStatementParser: EmailParser = {
  id: ID,
  institution: ZOLVE,
  region: 'US',
  version: 1,

  match(msg: RawMessage): boolean {
    if (!senderIsFrom(msg.from, DOMAIN)) return false
    const text = messageText(msg)
    return STATEMENT_PHRASE.test(text) && TOTAL_DUE.test(text)
  },

  extract(msg: RawMessage): ParsedFact[] {
    const text = messageText(msg)

    const totalRaw = requireField(ID, 'statementBalance', TOTAL_DUE, text, 'expected "Total Due $N"')

    const periodMatch = PERIOD.exec(text)
    const startRaw = periodMatch?.[1]
    const endRaw = periodMatch?.[2]

    const minRaw = optionalField(MIN_DUE, text)

    const fact: StatementFact = {
      kind: 'statement',
      messageId: msg.id,
      parserId: ID,
      parserVersion: 1,
      account: {
        institution: ZOLVE,
        region: 'US',
        kind: 'credit_card',
        currency: 'USD',
        last4: findLast4(text),
      },
      confidence: CONFIDENCE,
      periodStart: startRaw === undefined ? null : parseSlashDate(startRaw, 'MDY'),
      periodEnd: endRaw === undefined ? null : parseSlashDate(endRaw, 'MDY'),
      statementBalance: fromDecimalString(totalRaw, 'USD'),
      minimumDue: minRaw === null ? null : fromDecimalString(minRaw, 'USD'),
      // Zolve's statement mail states a period, not a payment due date. Deriving one
      // from "period end + 21 days" would invent a deadline the issuer never gave.
      dueDate: null,
    }

    return [fact]
  },
}
