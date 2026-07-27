/**
 * Email ingestion types — design spec §8.3.
 *
 * A parser's job is to turn one institution email into zero or more *facts*. A fact
 * is a claim about the world sourced from exactly one message, carrying enough
 * provenance to be re-derived, superseded, or thrown away when a parser is fixed.
 *
 * Two deliberate shapes here:
 *
 *   1. Facts never carry an `accountId`. The ingest layer has no database and must
 *      not invent one. It reports what the message said — institution, account kind,
 *      last four digits — and the persistence layer resolves that to a row. A parser
 *      that guessed at account identity would produce data that silently reattaches
 *      to the wrong account when the user opens a second card at the same bank.
 *
 *   2. `descriptorRaw` is `string | null`, not `''`. Several US issuers send
 *      transaction alerts with no merchant at all (spec §8.5). `null` records
 *      "the institution does not tell us"; `''` would read as "the merchant was
 *      blank", and the coverage indicator needs to tell those apart.
 */

import { type Money } from '@/core/money'
import { type Region } from '@/core/descriptor'

export { type Region }

/** One message as it arrived, before any parsing. Mirrors the `raw_messages` table. */
export interface RawMessage {
  /** Stable per-message identifier — the RFC-822 Message-ID or the IMAP UID. */
  readonly id: string
  /** Raw From header, display name and angle brackets included. */
  readonly from: string
  readonly subject: string
  /** ISO-8601 instant, offset-carrying. The calendar date is derived in UTC. */
  readonly receivedAt: string
  readonly text: string | null
  readonly html: string | null
}

export type AccountKind = 'credit_card' | 'checking' | 'savings' | 'loan' | 'brokerage'

/**
 * What the message says about which account it concerns.
 *
 * `currency` is the account's *billing* currency, which the parser knows statically
 * from the institution. It is not necessarily the currency of the amount: an INR card
 * that charges USD produces `amount.currency === 'USD'` against `currency === 'INR'`,
 * and that inequality is exactly how downstream code recognises a foreign charge
 * whose billed amount will only arrive with the statement (spec §10).
 *
 * `kind` is nullable for the same reason `last4` is. A U.S. Bank alert says only
 * "account ending in 1729" — the identical template covers a checking account and a
 * credit card, and the difference flips the sign convention of everything downstream.
 * A parser that guessed would be right most of the time, which is the worst possible
 * failure rate. The persistence layer resolves institution + last4 to a stored
 * account, and that stored row is where `kind` is actually known.
 */
export interface AccountRef {
  readonly institution: string
  readonly region: Region
  /** Null when the message does not say. Never guessed — see the note above. */
  readonly kind: AccountKind | null
  readonly currency: string
  /** Last four digits as stated in the message, or null when it never says. */
  readonly last4: string | null
}

/** Where a fact's date came from. A fallback date is weaker evidence and is labelled. */
export type DateSource = 'message' | 'received_at'

interface FactBase {
  /** The `RawMessage.id` this fact was derived from. Every fact is traceable to one email. */
  readonly messageId: string
  readonly parserId: string
  readonly parserVersion: number
  readonly account: AccountRef
  /** 0..1. Reduced when a field was inferred rather than stated. */
  readonly confidence: number
}

export interface TransactionFact extends FactBase {
  readonly kind: 'transaction'
  /** YYYY-MM-DD. */
  readonly postedAt: string
  readonly postedAtSource: DateSource
  /** Always non-negative — `direction` carries the sign. */
  readonly amount: Money
  readonly direction: 'debit' | 'credit'
  /** Merchant string as printed. `null` when the institution sends none. */
  readonly descriptorRaw: string | null
  /** The pre-conversion amount, when the message states both. */
  readonly originalAmount: Money | null
}

export interface StatementFact extends FactBase {
  readonly kind: 'statement'
  /** YYYY-MM-DD, or null when the message states only a balance and a due date. */
  readonly periodStart: string | null
  readonly periodEnd: string | null
  readonly statementBalance: Money | null
  readonly minimumDue: Money | null
  readonly dueDate: string | null
}

export interface BalanceFact extends FactBase {
  readonly kind: 'balance'
  readonly observedAt: string
  readonly observedAtSource: DateSource
  readonly balance: Money
  /** Banks quote several balances and they differ. Which one is not a detail. */
  readonly balanceType: 'available' | 'current' | 'statement'
}

export interface PaymentFact extends FactBase {
  readonly kind: 'payment'
  readonly occurredAt: string
  readonly occurredAtSource: DateSource
  readonly amount: Money
  /** `inbound` = money reaching this account (a card payment posting). */
  readonly direction: 'inbound' | 'outbound'
  readonly status: 'posted' | 'scheduled' | 'failed'
  readonly counterpartyRaw: string | null
}

export interface BillDueFact extends FactBase {
  readonly kind: 'bill_due'
  readonly billerRaw: string
  readonly amountDue: Money | null
  readonly dueDate: string
  /** null when the message does not say whether autopay will cover it. */
  readonly autopay: boolean | null
}

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'unknown'

export interface SubscriptionFact extends FactBase {
  readonly kind: 'subscription'
  readonly merchantRaw: string
  readonly amount: Money | null
  readonly cadence: Cadence
  readonly nextChargeAt: string | null
  readonly event: 'started' | 'renewed' | 'trial_started'
}

export interface PriceChangeFact extends FactBase {
  readonly kind: 'price_change'
  readonly merchantRaw: string
  readonly oldAmount: Money | null
  readonly newAmount: Money
  readonly cadence: Cadence
  readonly effectiveAt: string | null
}

export interface CancellationFact extends FactBase {
  readonly kind: 'cancellation'
  readonly merchantRaw: string
  readonly effectiveAt: string | null
  readonly refund: Money | null
}

export type ParsedFact =
  | TransactionFact
  | StatementFact
  | BalanceFact
  | PaymentFact
  | BillDueFact
  | SubscriptionFact
  | PriceChangeFact
  | CancellationFact

export type FactKind = ParsedFact['kind']

/**
 * Raised by a parser that matched a message and then could not read a field it
 * requires. This is the loud failure the spec asks for: a template change must
 * produce a quarantined message, never a fact with a plausible wrong value.
 */
export class ParseError extends Error {
  readonly parserId: string
  constructor(parserId: string, message: string) {
    super(`[${parserId}] ${message}`)
    this.name = 'ParseError'
    this.parserId = parserId
  }
}

export class FieldNotFoundError extends ParseError {
  readonly field: string
  constructor(parserId: string, field: string, hint: string) {
    super(parserId, `required field ${JSON.stringify(field)} not found — ${hint}`)
    this.name = 'FieldNotFoundError'
    this.field = field
  }
}

/** A fact that violates a structural invariant. Always a bug in the parser, never in the email. */
export class FactValidationError extends Error {
  readonly problem: string
  constructor(kind: string, parserId: string, problem: string) {
    super(`[${parserId}] produced an invalid ${kind} fact: ${problem}`)
    this.name = 'FactValidationError'
    this.problem = problem
  }
}
