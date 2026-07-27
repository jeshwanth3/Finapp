import { describe, expect, it } from 'vitest'

import { money } from '@/core/money'

import {
  chaseStatement,
  marketingMessages,
  sbiCardInrAlert,
  unknownTemplate,
  usBankAlert,
  zolveStatement,
} from './fixtures'
import { defaultRegistry } from './parsers/index'
import { DuplicateParserError, ParserRegistry, type EmailParser } from './registry'
import { ParseError, type ParsedFact, type RawMessage, type TransactionFact } from './types'

const ALL_FIXTURES: readonly RawMessage[] = [
  usBankAlert,
  chaseStatement,
  sbiCardInrAlert,
  zolveStatement,
  unknownTemplate,
  ...marketingMessages,
]

function alwaysMatch(overrides: Partial<EmailParser> & Pick<EmailParser, 'id'>): EmailParser {
  return {
    institution: 'Test Bank',
    region: 'US',
    version: 1,
    match: () => true,
    extract: () => [],
    ...overrides,
  }
}

function goodTransaction(msg: RawMessage, parserId: string): TransactionFact {
  return {
    kind: 'transaction',
    messageId: msg.id,
    parserId,
    parserVersion: 1,
    account: {
      institution: 'Test Bank',
      region: 'US',
      kind: 'credit_card',
      currency: 'USD',
      last4: '1729',
    },
    confidence: 0.9,
    postedAt: '2026-07-14',
    postedAtSource: 'message',
    amount: money(1234, 'USD'),
    direction: 'debit',
    descriptorRaw: 'TEST MERCHANT',
    originalAmount: null,
  }
}

describe('no message is ever silently dropped', () => {
  it('returns exactly one outcome per message, for every message', () => {
    const outcomes = defaultRegistry().ingestAll(ALL_FIXTURES)
    expect(outcomes).toHaveLength(ALL_FIXTURES.length)
    expect(outcomes.map((o) => o.messageId)).toEqual(ALL_FIXTURES.map((m) => m.id))
    for (const o of outcomes) {
      expect(['parsed', 'ignored', 'quarantined']).toContain(o.status)
    }
  })

  it('records marketing mail as ignored, with the reason, rather than discarding it', () => {
    const outcomes = defaultRegistry().ingestAll(marketingMessages)
    for (const o of outcomes) {
      expect(o.status).toBe('ignored')
      if (o.status !== 'ignored') continue
      expect(o.reason).toBe('domain_not_allowlisted')
      expect(o.detail).toMatch(/not an allowlisted transactional sender/)
    }
  })

  it('quarantines an allowlisted sender whose template no parser recognises', () => {
    const outcome = defaultRegistry().ingest(unknownTemplate)
    expect(outcome.status).toBe('quarantined')
    if (outcome.status !== 'quarantined') return
    expect(outcome.reason).toBe('no_parser_matched')
    expect(outcome.parserId).toBeNull()
    expect(outcome.detail).toMatch(/Discover/)
  })

  it('ignores a message whose From header cannot be read at all', () => {
    const outcome = defaultRegistry().ingest({ ...usBankAlert, from: 'garbage' })
    expect(outcome.status).toBe('ignored')
    if (outcome.status !== 'ignored') return
    expect(outcome.reason).toBe('unparseable_from_header')
  })
})

describe('a throwing parser is quarantined, not fatal', () => {
  it('quarantines when extract() throws, and keeps the cause', () => {
    const boom = new ParseError('exploding', 'statement template changed')
    const registry = new ParserRegistry([
      alwaysMatch({
        id: 'exploding',
        extract: () => {
          throw boom
        },
      }),
    ])

    const outcome = registry.ingest(usBankAlert)
    expect(outcome.status).toBe('quarantined')
    if (outcome.status !== 'quarantined') return
    expect(outcome.reason).toBe('parser_extract_threw')
    expect(outcome.parserId).toBe('exploding')
    expect(outcome.cause).toBe(boom)
    expect(outcome.detail).toMatch(/statement template changed/)
  })

  it('quarantines when match() throws', () => {
    const registry = new ParserRegistry([
      alwaysMatch({
        id: 'exploding-predicate',
        match: () => {
          throw new TypeError('cannot read properties of null')
        },
      }),
    ])

    const outcome = registry.ingest(usBankAlert)
    expect(outcome.status).toBe('quarantined')
    if (outcome.status !== 'quarantined') return
    expect(outcome.reason).toBe('parser_match_threw')
    expect(outcome.detail).toMatch(/TypeError/)
  })

  it('survives a non-Error throw', () => {
    const registry = new ParserRegistry([
      alwaysMatch({
        id: 'throws-a-string',
        extract: () => {
          throw 'nope'
        },
      }),
    ])
    const outcome = registry.ingest(usBankAlert)
    expect(outcome.status).toBe('quarantined')
    if (outcome.status !== 'quarantined') return
    expect(outcome.detail).toMatch(/non-Error thrown/)
  })

  it('keeps processing the rest of the batch after one message blows up', () => {
    const registry = defaultRegistry()
    registry.register(
      alwaysMatch({
        id: 'only-explodes-on-discover',
        match: (m) => m.id === unknownTemplate.id,
        extract: () => {
          throw new ParseError('only-explodes-on-discover', 'boom')
        },
      }),
    )

    const outcomes = registry.ingestAll([unknownTemplate, chaseStatement, zolveStatement])
    expect(outcomes.map((o) => o.status)).toEqual(['quarantined', 'parsed', 'parsed'])
  })
})

describe('ambiguity and empty results are failures, not defaults', () => {
  it('quarantines when two parsers claim the same message', () => {
    const registry = defaultRegistry()
    registry.register(
      alwaysMatch({
        id: 'greedy',
        match: () => true,
        extract: (m) => [goodTransaction(m, 'greedy')],
      }),
    )

    const outcome = registry.ingest(usBankAlert)
    expect(outcome.status).toBe('quarantined')
    if (outcome.status !== 'quarantined') return
    expect(outcome.reason).toBe('multiple_parsers_matched')
    expect(outcome.detail).toMatch(/us-bank-alert/)
    expect(outcome.detail).toMatch(/greedy/)
  })

  it('quarantines a parser that claims a message and extracts nothing', () => {
    const registry = new ParserRegistry([alwaysMatch({ id: 'silent', extract: () => [] })])
    const outcome = registry.ingest(usBankAlert)
    expect(outcome.status).toBe('quarantined')
    if (outcome.status !== 'quarantined') return
    expect(outcome.reason).toBe('parser_produced_no_facts')
  })

  it('refuses duplicate parser ids', () => {
    const registry = new ParserRegistry([alwaysMatch({ id: 'dup' })])
    expect(() => registry.register(alwaysMatch({ id: 'dup' }))).toThrow(DuplicateParserError)
  })
})

describe('fact validation catches parser bugs before they reach storage', () => {
  function ingestWith(fact: ParsedFact): ReturnType<ParserRegistry['ingest']> {
    return new ParserRegistry([alwaysMatch({ id: 'buggy', extract: () => [fact] })]).ingest(usBankAlert)
  }

  it('rejects a negative transaction amount', () => {
    const bad: TransactionFact = { ...goodTransaction(usBankAlert, 'buggy'), amount: money(-500, 'USD') }
    const outcome = ingestWith(bad)
    expect(outcome.status).toBe('quarantined')
    if (outcome.status !== 'quarantined') return
    expect(outcome.reason).toBe('invalid_fact')
    expect(outcome.detail).toMatch(/use direction instead/)
  })

  it("rejects descriptorRaw === '' — the ambiguous middle state", () => {
    const outcome = ingestWith({ ...goodTransaction(usBankAlert, 'buggy'), descriptorRaw: '' })
    expect(outcome.status).toBe('quarantined')
    if (outcome.status !== 'quarantined') return
    expect(outcome.detail).toMatch(/descriptorRaw/)
  })

  it('rejects a fact attributed to a different message', () => {
    const outcome = ingestWith({ ...goodTransaction(usBankAlert, 'buggy'), messageId: 'somewhere-else' })
    expect(outcome.status).toBe('quarantined')
    if (outcome.status !== 'quarantined') return
    expect(outcome.detail).toMatch(/does not match the source message/)
  })

  it('rejects an impossible date', () => {
    const outcome = ingestWith({ ...goodTransaction(usBankAlert, 'buggy'), postedAt: '2026-02-30' })
    expect(outcome.status).toBe('quarantined')
    if (outcome.status !== 'quarantined') return
    expect(outcome.detail).toMatch(/not a real YYYY-MM-DD date/)
  })

  it('rejects a confidence outside 0..1', () => {
    const outcome = ingestWith({ ...goodTransaction(usBankAlert, 'buggy'), confidence: 1.5 })
    expect(outcome.status).toBe('quarantined')
    if (outcome.status !== 'quarantined') return
    expect(outcome.detail).toMatch(/confidence/)
  })

  it('accepts a well-formed fact', () => {
    const outcome = ingestWith(goodTransaction(usBankAlert, 'buggy'))
    expect(outcome.status).toBe('parsed')
  })
})
