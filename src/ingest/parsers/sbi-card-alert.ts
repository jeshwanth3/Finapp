/**
 * SBI Card spend alert.
 *
 *   From: onlinesbicard@sbicard.com
 *   "Rs.35882.00 spent on your SBI Credit Card ending 6286 at RAZDREAMPLUGPAYTECHSOL on 12/07/26"
 *   "USD41.30 spent on your SBI Credit Card ending 6286 at ANTHROPIC on 03/07/26"
 *   "AUD707.43 spent on your SBI Credit Card ending 6286 at QANTAS on 28/06/26"
 *
 * Two things here are silent-corruption traps, and both are handled explicitly.
 *
 * 1. **Dates are DD/MM/YY.** `12/07/26` is 12 July 2026, not 7 December. Read as
 *    MDY it lands five months away, which does not crash anything: it quietly
 *    misplaces the charge into the wrong statement period, breaks reconciliation
 *    against the PDF, and skews every month-over-month number. The order is pinned
 *    to `'DMY'` here and tested against a date where the two readings disagree.
 *
 * 2. **The amount currency is not the account currency.** This card bills in INR
 *    but alerts on foreign charges in the transaction currency. The currency is
 *    read from the string — never assumed from the region — so a USD41.30 charge
 *    produces `amount` in USD against an INR account. Assuming INR would record
 *    ₹41.30 for a ~₹3,400 charge, an eighty-fold understatement that looks
 *    entirely plausible in a list.
 *
 * The INR-billed amount for a foreign charge is not in this message at all; it
 * arrives with the statement. `originalAmount` stays null because the message
 * states exactly one amount, and the currency inequality is itself the signal that
 * a billed amount is still outstanding.
 */

import { fromDecimalString } from '@/core/money'
import { parseSlashDate } from '../dates'
import { SBI_CARD, senderIsFrom } from '../senders'
import { messageText } from '../text'
import { type EmailParser } from '../registry'
import {
  FieldNotFoundError,
  type ParsedFact,
  type RawMessage,
  type TransactionFact,
} from '../types'
import { findLast4, optionalField, requireField } from './support'

const ID = 'sbi-card-alert'
const DOMAIN = 'sbicard.com'

/** The account's billing currency. Static per institution, not per message. */
const BILLING_CURRENCY = 'INR'

/**
 * Currency token as printed, mapped to ISO-4217.
 *
 * Only tokens actually observed on this card are listed. An unrecognised token
 * throws rather than defaulting to INR — see the module note on why a wrong
 * currency is worse than a failed parse.
 */
const CURRENCY_TOKENS: Readonly<Record<string, string>> = {
  'rs.': 'INR',
  rs: 'INR',
  '₹': 'INR',
  inr: 'INR',
  usd: 'USD',
  '$': 'USD',
  aud: 'AUD',
  sgd: 'SGD',
  gbp: 'GBP',
  eur: 'EUR',
  aed: 'AED',
}

const AMOUNT_WITH_CURRENCY =
  /(?:^|[\s>])(Rs\.?|INR|USD|AUD|SGD|GBP|EUR|AED|₹|\$)\s?([\d,]+(?:\.\d{1,2})?)\s+spent\b/i
const SPENT_PHRASE = /\bspent on your SBI\b/i
/**
 * Date and merchant are both anchored AFTER the "spent on your SBI" phrase.
 * Unanchored, a date or the word "at" in the subject line would win the match and
 * hand the fact somebody else's field.
 */
const TXN_DATE = /spent on your SBI[\s\S]*?\bon (\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4}))\b/i
/** Merchant sits between "at" and the trailing "on <date>". Non-greedy so it stops at the first date. */
const MERCHANT = /spent on your SBI[\s\S]*?\bat\s+(.+?)\s+on \d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})\b/i

/** Amount, currency, merchant and date are all stated verbatim. */
const CONFIDENCE = 0.95

export class UnknownCurrencyTokenError extends Error {
  constructor(token: string) {
    super(
      `[${ID}] unrecognised currency token ${JSON.stringify(token)}. Refusing to assume ` +
        `${BILLING_CURRENCY} — a wrong currency silently mis-sizes the charge.`,
    )
    this.name = 'UnknownCurrencyTokenError'
  }
}

function currencyOf(token: string): string {
  const code = CURRENCY_TOKENS[token.toLowerCase()]
  if (code === undefined) throw new UnknownCurrencyTokenError(token)
  return code
}

export const sbiCardAlertParser: EmailParser = {
  id: ID,
  institution: SBI_CARD,
  region: 'IN',
  version: 1,

  match(msg: RawMessage): boolean {
    if (!senderIsFrom(msg.from, DOMAIN)) return false
    const text = messageText(msg)
    return SPENT_PHRASE.test(text) && AMOUNT_WITH_CURRENCY.test(text)
  },

  extract(msg: RawMessage): ParsedFact[] {
    const text = messageText(msg)

    const m = AMOUNT_WITH_CURRENCY.exec(text)
    const token = m?.[1]
    const amountRaw = m?.[2]
    if (token === undefined || amountRaw === undefined) {
      throw new FieldNotFoundError(
        ID,
        'amount',
        'expected "<CUR><amount> spent on your SBI Credit Card", e.g. "Rs.35882.00 spent"',
      )
    }
    const currency = currencyOf(token.trim())

    const dateRaw = requireField(ID, 'postedAt', TXN_DATE, text, 'expected "on DD/MM/YY"')
    const merchant = optionalField(MERCHANT, text)

    const fact: TransactionFact = {
      kind: 'transaction',
      messageId: msg.id,
      parserId: ID,
      parserVersion: 1,
      account: {
        institution: SBI_CARD,
        region: 'IN',
        kind: 'credit_card',
        currency: BILLING_CURRENCY,
        last4: findLast4(text),
      },
      confidence: CONFIDENCE,
      // DD/MM/YY. Asserted from the institution, never inferred from the digits.
      postedAt: parseSlashDate(dateRaw, 'DMY'),
      postedAtSource: 'message',
      amount: fromDecimalString(amountRaw.trim(), currency),
      direction: 'debit',
      descriptorRaw: merchant,
      originalAmount: null,
    }

    return [fact]
  },
}
