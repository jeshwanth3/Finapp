import { describe, it, expect } from 'vitest'
import { money } from '@/core/money'
import { ParserRegistry, type EmailParser, type IngestOutcome } from './registry'
import type { RawMessage } from './types'
import {
  runSync,
  syncUntilCaughtUp,
  memoryCursorStore,
  describeFreshness,
  INITIAL_SYNC_STATE,
  type MailboxMessage,
  type MailboxSource,
  type SyncState,
} from './sync'

/* -------------------------------------------------------------------------- */
/* Test doubles                                                                */
/* -------------------------------------------------------------------------- */

/** An allowlisted transactional sender, so the registry does not ignore it. */
const GOOD_FROM = 'usbank@notifications.usbank.com'
const MARKETING_FROM = '1800USBanks@email.usbank.com'

function msg(id: string, from = GOOD_FROM, text = 'Your transaction of $12.00 is complete.'): RawMessage {
  return {
    id,
    from,
    subject: 'Your transaction is complete.',
    receivedAt: '2026-07-26T10:00:00.000Z',
    text,
    html: null,
  }
}

/** Parses anything from the good sender; throws on a message flagged POISON. */
const testParser: EmailParser = {
  id: 'test-parser',
  institution: 'US Bank',
  region: 'US',
  version: 1,
  match: (m) => m.from === GOOD_FROM,
  extract: (m) => {
    if (m.text?.includes('POISON')) throw new Error('cannot parse this one')
    return [
      {
        kind: 'transaction',
        messageId: m.id,
        parserId: 'test-parser',
        parserVersion: 1,
        confidence: 1,
        postedAt: '2026-07-26',
        postedAtSource: 'message',
        // Non-negative; `direction` carries the sign. Two sign conventions
        // fighting is how a balance ends up wrong.
        amount: money(1200, 'USD'),
        direction: 'debit',
        descriptorRaw: 'TEST MERCHANT',
        originalAmount: null,
        account: {
          institution: 'US Bank',
          region: 'US',
          kind: 'checking',
          currency: 'USD',
          last4: '1729',
        },
      },
    ]
  },
}

function registry(): ParserRegistry {
  return new ParserRegistry([testParser])
}

/** A mailbox holding a fixed list of messages. */
function fakeSource(messages: readonly MailboxMessage[], validity = 1): MailboxSource & {
  calls: { afterUid: number; limit: number }[]
} {
  const calls: { afterUid: number; limit: number }[] = []
  return {
    calls,
    uidValidity: async () => validity,
    fetchSince: async (afterUid, limit) => {
      calls.push({ afterUid, limit })
      return messages.filter((m) => m.uid > afterUid).slice(0, limit)
    },
  }
}

function mail(uid: number, from = GOOD_FROM, text?: string): MailboxMessage {
  return { uid, message: msg(`msg-${uid}`, from, text) }
}

function collectingSink() {
  const accepted: { uid: number; status: IngestOutcome['status'] }[] = []
  return {
    accepted,
    accept(outcome: IngestOutcome, m: MailboxMessage) {
      accepted.push({ uid: m.uid, status: outcome.status })
    },
  }
}

const NOW = '2026-07-26T12:00:00.000Z'

/* -------------------------------------------------------------------------- */

describe('cursor: first run and resume', () => {
  it('starts from zero when there is no stored cursor', async () => {
    const source = fakeSource([mail(1), mail(2), mail(3)])
    const sink = collectingSink()
    const result = await runSync({
      source, registry: registry(), cursors: memoryCursorStore(), sink, now: NOW,
    })

    expect(source.calls[0]?.afterUid).toBe(0)
    expect(result.fetched).toBe(3)
    expect(result.cursor.lastUid).toBe(3)
  })

  it('resumes above the stored cursor rather than re-reading the mailbox', async () => {
    const source = fakeSource([mail(1), mail(2), mail(3), mail(4)])
    const cursors = memoryCursorStore({ uidValidity: 1, lastUid: 2 })
    const sink = collectingSink()

    const result = await runSync({ source, registry: registry(), cursors, sink, now: NOW })

    expect(source.calls[0]?.afterUid).toBe(2)
    expect(sink.accepted.map((a) => a.uid)).toEqual([3, 4])
    expect(result.cursor.lastUid).toBe(4)
  })

  it('CATCHES UP after a long gap — the sleeping-laptop case', async () => {
    // Cursor left at 2 on Friday; 40 messages arrived over the weekend.
    const all = Array.from({ length: 42 }, (_, i) => mail(i + 1))
    const source = fakeSource(all)
    const cursors = memoryCursorStore({ uidValidity: 1, lastUid: 2 })

    const result = await syncUntilCaughtUp({
      source, registry: registry(), cursors, sink: collectingSink(), now: NOW, batchSize: 10,
    })

    expect(result.cursor.lastUid).toBe(42)
    expect(result.hasMore).toBe(false)
  })

  it('is a no-op when nothing new has arrived', async () => {
    const source = fakeSource([mail(1), mail(2)])
    const cursors = memoryCursorStore({ uidValidity: 1, lastUid: 2 })
    const sink = collectingSink()

    const result = await runSync({ source, registry: registry(), cursors, sink, now: NOW })

    expect(result.fetched).toBe(0)
    expect(sink.accepted).toHaveLength(0)
    expect(result.cursor.lastUid).toBe(2)
    expect(result.ok).toBe(true)
  })
})

describe('re-processing is safe — the property the whole design leans on', () => {
  it('presents the same messages again without error when the cursor is rewound', async () => {
    const source = fakeSource([mail(1), mail(2), mail(3)])
    const shared = registry()

    const first = await runSync({
      source, registry: shared, cursors: memoryCursorStore(), sink: collectingSink(), now: NOW,
    })

    // Simulate a lost cursor (restored backup, migration, manual reset).
    const second = await runSync({
      source, registry: shared, cursors: memoryCursorStore(), sink: collectingSink(), now: NOW,
    })

    expect(second.fetched).toBe(first.fetched)
    expect(second.factCount).toBe(first.factCount)
    expect(second.ok).toBe(true)
  })
})

describe('poison pills do not strand the mailbox', () => {
  it('ADVANCES PAST a message no parser can read', async () => {
    const source = fakeSource([mail(1), mail(2, GOOD_FROM, 'POISON'), mail(3)])
    const sink = collectingSink()

    const result = await runSync({
      source, registry: registry(), cursors: memoryCursorStore(), sink, now: NOW,
    })

    expect(result.quarantined).toBe(1)
    expect(result.parsed).toBe(2)
    // The critical assertion: uid 3 was reached, not stranded behind uid 2.
    expect(result.cursor.lastUid).toBe(3)
    expect(sink.accepted.map((a) => a.uid)).toEqual([1, 2, 3])
  })

  it('counts quarantined messages so the depth can be surfaced', async () => {
    const source = fakeSource([mail(1, GOOD_FROM, 'POISON'), mail(2, GOOD_FROM, 'POISON')])
    const result = await runSync({
      source, registry: registry(), cursors: memoryCursorStore(), sink: collectingSink(), now: NOW,
    })
    expect(result.state.quarantineDepth).toBe(2)
  })

  it('ignores non-transactional senders without quarantining them', async () => {
    const source = fakeSource([mail(1, MARKETING_FROM), mail(2)])
    const result = await runSync({
      source, registry: registry(), cursors: memoryCursorStore(), sink: collectingSink(), now: NOW,
    })

    expect(result.ignored).toBe(1)
    expect(result.quarantined).toBe(0)
    expect(result.cursor.lastUid).toBe(2)
  })
})

describe('storage failure must not create a hole in the ledger', () => {
  it('STOPS at the failing message and leaves the cursor below it', async () => {
    const source = fakeSource([mail(1), mail(2), mail(3)])
    const cursors = memoryCursorStore()
    const sink = {
      accept(_o: IngestOutcome, m: MailboxMessage) {
        if (m.uid === 2) throw new Error('disk full')
      },
    }

    const result = await runSync({ source, registry: registry(), cursors, sink, now: NOW })

    expect(result.ok).toBe(false)
    expect(result.error?.uid).toBe(2)
    // uid 1 is durably stored, so the cursor keeps it; uid 2 is retried next run.
    expect(result.cursor.lastUid).toBe(1)
  })

  it('retries exactly the failed message on the next run', async () => {
    const source = fakeSource([mail(1), mail(2), mail(3)])
    const cursors = memoryCursorStore()
    let failOnce = true
    const seen: number[] = []
    const sink = {
      accept(_o: IngestOutcome, m: MailboxMessage) {
        if (m.uid === 2 && failOnce) {
          failOnce = false
          throw new Error('transient')
        }
        seen.push(m.uid)
      },
    }

    await runSync({ source, registry: registry(), cursors, sink, now: NOW })
    const second = await runSync({ source, registry: registry(), cursors, sink, now: NOW })

    expect(seen).toEqual([1, 2, 3])
    expect(second.ok).toBe(true)
    expect(second.cursor.lastUid).toBe(3)
  })

  it('increments consecutive failures and preserves the last success time', async () => {
    const source = fakeSource([mail(1)])
    const sink = { accept() { throw new Error('nope') } }
    const prior: SyncState = {
      lastAttemptAt: '2026-07-26T11:00:00.000Z',
      lastSuccessAt: '2026-07-26T11:00:00.000Z',
      consecutiveFailures: 2,
      quarantineDepth: 0,
    }

    const result = await runSync({
      source, registry: registry(), cursors: memoryCursorStore(), sink, now: NOW, state: prior,
    })

    expect(result.state.consecutiveFailures).toBe(3)
    expect(result.state.lastSuccessAt).toBe('2026-07-26T11:00:00.000Z')
    expect(result.state.lastAttemptAt).toBe(NOW)
  })
})

describe('UIDVALIDITY reset', () => {
  it('RESCANS FROM ZERO when the mailbox generation changes', async () => {
    // Stored cursor belongs to generation 1; the server now reports 2, so every
    // previously issued UID is meaningless.
    const source = fakeSource([mail(1), mail(2), mail(3)], 2)
    const cursors = memoryCursorStore({ uidValidity: 1, lastUid: 2 })

    const result = await runSync({
      source, registry: registry(), cursors, sink: collectingSink(), now: NOW,
    })

    expect(result.resetOccurred).toBe(true)
    expect(source.calls[0]?.afterUid).toBe(0)
    expect(result.fetched).toBe(3)
    expect(result.cursor.uidValidity).toBe(2)
  })

  it('does not reset when the generation is unchanged', async () => {
    const source = fakeSource([mail(1), mail(2)], 1)
    const cursors = memoryCursorStore({ uidValidity: 1, lastUid: 1 })
    const result = await runSync({
      source, registry: registry(), cursors, sink: collectingSink(), now: NOW,
    })
    expect(result.resetOccurred).toBe(false)
  })
})

describe('batching', () => {
  it('reports hasMore when the batch limit is reached', async () => {
    const source = fakeSource(Array.from({ length: 25 }, (_, i) => mail(i + 1)))
    const result = await runSync({
      source, registry: registry(), cursors: memoryCursorStore(), sink: collectingSink(),
      now: NOW, batchSize: 10,
    })
    expect(result.fetched).toBe(10)
    expect(result.hasMore).toBe(true)
    expect(result.cursor.lastUid).toBe(10)
  })

  it('does not report hasMore on a short batch', async () => {
    const source = fakeSource([mail(1), mail(2)])
    const result = await runSync({
      source, registry: registry(), cursors: memoryCursorStore(), sink: collectingSink(),
      now: NOW, batchSize: 10,
    })
    expect(result.hasMore).toBe(false)
  })
})

describe('freshness — a stale sync must look stale', () => {
  it('reports never-synced as stale rather than as fine', () => {
    const f = describeFreshness(INITIAL_SYNC_STATE, NOW)
    expect(f.neverSynced).toBe(true)
    expect(f.isStale).toBe(true)
    expect(f.label).toBe('Never synced')
  })

  it('is fresh just after a successful sync', () => {
    const f = describeFreshness(
      { ...INITIAL_SYNC_STATE, lastSuccessAt: NOW, lastAttemptAt: NOW }, NOW,
    )
    expect(f.isStale).toBe(false)
    expect(f.minutesSince).toBe(0)
  })

  it('goes stale past the window', () => {
    const f = describeFreshness(
      { ...INITIAL_SYNC_STATE, lastSuccessAt: '2026-07-26T10:00:00.000Z' }, NOW,
    )
    expect(f.minutesSince).toBe(120)
    expect(f.isStale).toBe(true)
    expect(f.label).toContain('2h ago')
  })

  it('is STALE WHENEVER SYNC IS FAILING, however recent the last success', () => {
    // The dangerous case: synced a minute ago, but every attempt since has failed.
    const f = describeFreshness(
      { lastSuccessAt: NOW, lastAttemptAt: NOW, consecutiveFailures: 3, quarantineDepth: 0 },
      NOW,
    )
    expect(f.failing).toBe(true)
    expect(f.isStale).toBe(true)
    expect(f.label).toContain('failing')
  })

  it('renders day-scale gaps readably', () => {
    const f = describeFreshness(
      { ...INITIAL_SYNC_STATE, lastSuccessAt: '2026-07-23T12:00:00.000Z' }, NOW,
    )
    expect(f.label).toContain('3d ago')
  })
})
