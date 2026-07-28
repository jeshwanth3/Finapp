/**
 * Parser registry — the router that guarantees no message is ever silently dropped.
 *
 * Every message put in produces exactly one `IngestOutcome` out. There is no code
 * path that returns nothing, and no `catch {}` that swallows a parser bug. The three
 * terminal states are:
 *
 *   parsed       the message matched exactly one parser and yielded valid facts
 *   ignored      the sender is not on the transactional allowlist (spec §8.2) —
 *                a *recorded* non-event, not a disappearance
 *   quarantined  something went wrong: no parser matched, two matched, a parser
 *                threw, or a parser produced a structurally invalid fact
 *
 * Quarantine is the important one. A bank changes a template roughly once a year,
 * and when it does the correct behaviour is a loud pile of unparsed messages that a
 * human can look at — never a fact with a plausible wrong number in it. Everything
 * in this file is arranged so that the failure mode is quarantine.
 *
 * Two deliberate choices worth defending:
 *
 *   - **Two matching parsers is a quarantine, not a race.** Overlapping `match()`
 *     predicates mean one of them is wrong. Picking the first registered would hide
 *     the bug and attach the message to whichever parser happened to load earlier.
 *
 *   - **Zero facts from a matching parser is a quarantine.** A parser that claims a
 *     message and then extracts nothing has silently lost data, which is exactly the
 *     outcome this module exists to prevent.
 */

import { classifySender, type SenderRejection } from './senders'
import {
  FactValidationError,
  type ParsedFact,
  type RawMessage,
  type Region,
} from './types'
import { isValidIsoDate } from './dates'

export interface EmailParser {
  /** Stable, unique, kebab-case. Persisted on every fact it produces. */
  readonly id: string
  readonly institution: string
  readonly region: Region
  /**
   * Bumped whenever extraction semantics change. Facts carry it so a re-parse can
   * find and supersede everything produced by an older, wronger version.
   */
  readonly version: number
  /** Cheap, side-effect free, and must not throw. A throwing `match` quarantines. */
  match(msg: RawMessage): boolean
  /** Throws (see `ParseError`) rather than returning a fact it is unsure of. */
  extract(msg: RawMessage): ParsedFact[]
}

export type QuarantineReason =
  | 'no_parser_matched'
  | 'multiple_parsers_matched'
  | 'parser_match_threw'
  | 'parser_extract_threw'
  | 'parser_produced_no_facts'
  | 'invalid_fact'
  /**
   * The From address is allowlisted but the message failed SPF/DKIM/DMARC, so
   * the claimed sender is unverified. Quarantined rather than dropped: a genuine
   * message can fail authentication through a misconfigured forwarder, and that
   * is a case for a human to look at, not for silent deletion. See authenticity.ts.
   */
  | 'failed_authenticity'

export interface IngestParsed {
  readonly status: 'parsed'
  readonly messageId: string
  readonly parserId: string
  readonly parserVersion: number
  readonly facts: readonly ParsedFact[]
}

export interface IngestIgnored {
  readonly status: 'ignored'
  readonly messageId: string
  readonly reason: SenderRejection
  readonly detail: string
}

export interface IngestQuarantined {
  readonly status: 'quarantined'
  readonly messageId: string
  readonly reason: QuarantineReason
  readonly detail: string
  /** The parser implicated, when one is. Null for `no_parser_matched`. */
  readonly parserId: string | null
  /** The original throw, preserved so a human sees the real stack. */
  readonly cause: unknown
}

export type IngestOutcome = IngestParsed | IngestIgnored | IngestQuarantined

export class DuplicateParserError extends Error {
  constructor(id: string) {
    super(
      `A parser with id ${JSON.stringify(id)} is already registered. Parser ids are ` +
        `persisted on every fact and used to supersede stale ones, so they must be unique.`,
    )
    this.name = 'DuplicateParserError'
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return `non-Error thrown: ${JSON.stringify(error)}`
}

/**
 * Structural checks every fact must survive before it leaves the ingest layer.
 *
 * These catch parser bugs, not email problems: a negative transaction amount means
 * the parser put the sign in the wrong place, and letting it through would flip a
 * charge into a refund three layers downstream where nobody can trace it back.
 */
export function validateFact(fact: ParsedFact, msg: RawMessage): void {
  const fail = (problem: string): never => {
    throw new FactValidationError(fact.kind, fact.parserId, problem)
  }

  if (fact.messageId !== msg.id) {
    fail(`messageId ${JSON.stringify(fact.messageId)} does not match the source message ${JSON.stringify(msg.id)}`)
  }
  if (!(fact.confidence >= 0 && fact.confidence <= 1)) {
    fail(`confidence ${fact.confidence} is outside 0..1`)
  }
  if (fact.account.last4 !== null && !/^\d{4}$/.test(fact.account.last4)) {
    fail(`last4 ${JSON.stringify(fact.account.last4)} is not four digits`)
  }

  const requireDate = (label: string, value: string | null, optional: boolean): void => {
    if (value === null) {
      if (!optional) fail(`${label} is required but null`)
      return
    }
    if (!isValidIsoDate(value)) fail(`${label} ${JSON.stringify(value)} is not a real YYYY-MM-DD date`)
  }

  switch (fact.kind) {
    case 'transaction':
      requireDate('postedAt', fact.postedAt, false)
      // Sign lives in `direction`. A negative amount means two sign conventions are
      // fighting, and the loser is always the user's balance.
      if (fact.amount.minor < 0) fail(`amount ${fact.amount.minor} is negative — use direction instead`)
      if (fact.originalAmount !== null && fact.originalAmount.minor < 0) {
        fail(`originalAmount ${fact.originalAmount.minor} is negative`)
      }
      if (fact.descriptorRaw === '') {
        fail("descriptorRaw is '' — use null for \"the institution sent no merchant\"")
      }
      break
    case 'statement':
      requireDate('periodStart', fact.periodStart, true)
      requireDate('periodEnd', fact.periodEnd, true)
      requireDate('dueDate', fact.dueDate, true)
      if (fact.periodStart !== null && fact.periodEnd !== null && fact.periodStart > fact.periodEnd) {
        fail(`periodStart ${fact.periodStart} is after periodEnd ${fact.periodEnd}`)
      }
      if (fact.statementBalance === null && fact.minimumDue === null && fact.dueDate === null) {
        fail('carries no balance, no minimum and no due date — nothing was actually extracted')
      }
      break
    case 'balance':
      requireDate('observedAt', fact.observedAt, false)
      break
    case 'payment':
      requireDate('occurredAt', fact.occurredAt, false)
      if (fact.amount.minor < 0) fail(`amount ${fact.amount.minor} is negative — use direction instead`)
      break
    case 'bill_due':
      requireDate('dueDate', fact.dueDate, false)
      break
    case 'subscription':
      requireDate('nextChargeAt', fact.nextChargeAt, true)
      break
    case 'price_change':
      requireDate('effectiveAt', fact.effectiveAt, true)
      break
    case 'cancellation':
      requireDate('effectiveAt', fact.effectiveAt, true)
      break
  }
}

export class ParserRegistry {
  readonly #parsers: EmailParser[] = []

  constructor(parsers: readonly EmailParser[] = []) {
    for (const p of parsers) this.register(p)
  }

  register(parser: EmailParser): this {
    if (this.#parsers.some((p) => p.id === parser.id)) throw new DuplicateParserError(parser.id)
    this.#parsers.push(parser)
    return this
  }

  get parsers(): readonly EmailParser[] {
    return [...this.#parsers]
  }

  /**
   * Route one message. Always returns; never throws.
   *
   * A throw here would abort a mailbox sync partway through, which loses every
   * message after the bad one — the exact silent data loss quarantine prevents.
   */
  ingest(msg: RawMessage): IngestOutcome {
    const verdict = classifySender(msg.from)
    if (!verdict.allowed) {
      return {
        status: 'ignored',
        messageId: msg.id,
        reason: verdict.reason,
        detail:
          `From ${JSON.stringify(msg.from)} resolved to ${verdict.address ?? 'no address'} ` +
          `which is not an allowlisted transactional sender`,
      }
    }

    const matched: EmailParser[] = []
    for (const parser of this.#parsers) {
      let isMatch: boolean
      try {
        isMatch = parser.match(msg)
      } catch (error) {
        // A predicate is not allowed to throw. If one does, the registry is in an
        // unknown state for this message and must not let another parser claim it.
        return {
          status: 'quarantined',
          messageId: msg.id,
          reason: 'parser_match_threw',
          detail: `${parser.id}.match() threw — ${describe(error)}`,
          parserId: parser.id,
          cause: error,
        }
      }
      if (isMatch) matched.push(parser)
    }

    if (matched.length === 0) {
      return {
        status: 'quarantined',
        messageId: msg.id,
        reason: 'no_parser_matched',
        detail:
          `${verdict.rule.institution} sender ${verdict.address} is allowlisted but no parser ` +
          `recognised subject ${JSON.stringify(msg.subject)} — likely a new or changed template`,
        parserId: null,
        cause: null,
      }
    }

    if (matched.length > 1) {
      return {
        status: 'quarantined',
        messageId: msg.id,
        reason: 'multiple_parsers_matched',
        detail:
          `ambiguous: ${matched.map((p) => p.id).join(', ')} all matched. Overlapping match() ` +
          `predicates mean one is wrong; choosing arbitrarily would hide that.`,
        parserId: null,
        cause: null,
      }
    }

    const parser = matched[0] as EmailParser

    let facts: ParsedFact[]
    try {
      facts = parser.extract(msg)
    } catch (error) {
      return {
        status: 'quarantined',
        messageId: msg.id,
        reason: 'parser_extract_threw',
        detail: `${parser.id}.extract() threw — ${describe(error)}`,
        parserId: parser.id,
        cause: error,
      }
    }

    if (facts.length === 0) {
      return {
        status: 'quarantined',
        messageId: msg.id,
        reason: 'parser_produced_no_facts',
        detail: `${parser.id} claimed the message and then extracted nothing from it`,
        parserId: parser.id,
        cause: null,
      }
    }

    for (const fact of facts) {
      try {
        validateFact(fact, msg)
      } catch (error) {
        return {
          status: 'quarantined',
          messageId: msg.id,
          reason: 'invalid_fact',
          detail: describe(error),
          parserId: parser.id,
          cause: error,
        }
      }
    }

    return {
      status: 'parsed',
      messageId: msg.id,
      parserId: parser.id,
      parserVersion: parser.version,
      facts,
    }
  }

  ingestAll(messages: readonly RawMessage[]): IngestOutcome[] {
    return messages.map((m) => this.ingest(m))
  }
}

/** Convenience accessor — every outcome carries a status, so narrow before using facts. */
export function factsOf(outcome: IngestOutcome): readonly ParsedFact[] {
  return outcome.status === 'parsed' ? outcome.facts : []
}
