/**
 * U.S. Bank transaction alert.
 *
 *   From: usbank@notifications.usbank.com
 *   "Your transaction of $2500.00 is complete. ... account ending in 1729"
 *
 * This template is the reason `descriptorRaw` and `AccountRef.kind` are nullable.
 * U.S. Bank's alert states an amount and four digits and NOTHING else — no merchant,
 * no transaction date, no indication whether the account is a card or a checking
 * account. Three fields a parser could plausibly invent:
 *
 *   merchant  — there is no honest guess. `descriptorRaw: null`, and the coverage
 *               indicator downstream shows this transaction as merchant-unknown
 *               rather than silently bucketing it into "Uncategorised" as if the
 *               user had shopped somewhere called nothing.
 *   date      — falls back to the message receipt date, LABELLED `'received_at'`.
 *               An alert lands within minutes of the swipe, so it is a good
 *               approximation, but reconciliation must know it is an approximation.
 *   kind      — null. Guessing "credit_card" would flip the sign convention on
 *               every checking-account alert.
 *
 * Confidence is scored accordingly: the amount is exact, everything else is not.
 */

import { fromDecimalString } from '@/core/money'
import { isoDateOfInstant } from '../dates'
import { senderIsFrom, US_BANK } from '../senders'
import { messageText } from '../text'
import { type EmailParser } from '../registry'
import { type ParsedFact, type RawMessage, type TransactionFact } from '../types'
import { findLast4, requireField } from './support'

const ID = 'us-bank-alert'
const DOMAIN = 'notifications.usbank.com'

/** The alert's own sentence. Anchored on "transaction of" so a promo "$0 fees" cannot match. */
const COMPLETE_SENTENCE = /\btransaction of \$\s?([\d,]+(?:\.\d{2})?)\b/i

/**
 * Amount exact, date inferred from receipt, merchant absent, account kind unknown.
 * Deliberately below the 0.9 that a fully-stated statement fact earns.
 */
const CONFIDENCE = 0.6

export const usBankAlertParser: EmailParser = {
  id: ID,
  institution: US_BANK,
  region: 'US',
  version: 1,

  match(msg: RawMessage): boolean {
    if (!senderIsFrom(msg.from, DOMAIN)) return false
    const text = messageText(msg)
    return COMPLETE_SENTENCE.test(text) && /\bis complete\b/i.test(text)
  },

  extract(msg: RawMessage): ParsedFact[] {
    const text = messageText(msg)

    const amountRaw = requireField(
      ID,
      'amount',
      COMPLETE_SENTENCE,
      text,
      'expected "Your transaction of $N is complete."',
    )

    const fact: TransactionFact = {
      kind: 'transaction',
      messageId: msg.id,
      parserId: ID,
      parserVersion: 1,
      account: {
        institution: US_BANK,
        region: 'US',
        // The template never says. See the module note — guessing flips signs.
        kind: null,
        currency: 'USD',
        last4: findLast4(text),
      },
      confidence: CONFIDENCE,
      postedAt: isoDateOfInstant(msg.receivedAt),
      postedAtSource: 'received_at',
      amount: fromDecimalString(amountRaw, 'USD'),
      direction: 'debit',
      // Not '' — the institution sent no merchant at all, which is a different
      // claim from "the merchant field was empty". Inventing one is forbidden.
      descriptorRaw: null,
      originalAmount: null,
    }

    return [fact]
  },
}
