/**
 * Cursor-based mailbox sync — the correctness path for ingestion.
 *
 * WHY A CURSOR AND NOT AN EVENT STREAM
 *
 * The obvious design is to listen for new mail (IMAP IDLE, Gmail push) and
 * process each message as it lands. That design has one fatal property: there is
 * no replay. A dropped connection, a sleeping laptop, or a crash mid-batch and
 * those messages are simply never seen again — and a projection built on a
 * silently incomplete ledger says "you're fine" when you are not. That is the
 * failure mode CLAUDE.md rule 2 exists to prevent.
 *
 * So this module never depends on catching anything live. It stores the highest
 * UID it has processed and always asks for `UID > lastUid`. Sleep for three
 * days, wake, and everything missed arrives. Crash mid-batch and the next run
 * resumes. A push notification, if one is ever wired up, is only a hint to run
 * this function sooner — never the thing that carries the data. Never let the
 * fast path be the correctness path.
 *
 * WHY RE-FETCHING IS FREE
 *
 * `dedupeKey` is keyed on provenance — (sourceType, sourceRef, ordinal) — not on
 * content, and the database holds a UNIQUE index on it. Re-processing a message
 * is therefore a no-op rather than a double count. That lets this loop be
 * deliberately aggressive: overlap windows, rescan on any doubt, replay a whole
 * month after fixing a parser. Most ingestion pipelines cannot do that safely.
 * This one can, and the design leans on it.
 */

import type { RawMessage } from './types'
import type { IngestOutcome, ParserRegistry } from './registry'

/** A message as the mailbox presents it: a stable ascending id plus the mail. */
export interface MailboxMessage {
  /** IMAP UID. Ascending within a UIDVALIDITY generation. */
  readonly uid: number
  readonly message: RawMessage
}

/**
 * The transport, abstracted so the loop is testable with no network.
 *
 * An IMAP implementation satisfies this; so does a fake holding an array. Every
 * behaviour that matters — resume, catch-up, poison pills, UIDVALIDITY resets —
 * is exercised against the fake, because those are the paths that only ever run
 * when something has already gone wrong.
 */
export interface MailboxSource {
  /**
   * IMAP's generation counter for the mailbox. If this changes, every previously
   * issued UID is meaningless and the cursor must reset.
   */
  uidValidity(): Promise<number>
  /** Messages with `uid > afterUid`, ascending, at most `limit`. */
  fetchSince(afterUid: number, limit: number): Promise<readonly MailboxMessage[]>
}

export interface SyncCursor {
  readonly uidValidity: number
  readonly lastUid: number
}

export interface CursorStore {
  read(): SyncCursor | null
  write(cursor: SyncCursor): void
}

/** Where parsed facts go. Injected so the loop has no database dependency. */
export interface FactSink {
  /**
   * Persist one message's outcome. Must be idempotent: the loop may present the
   * same message again after a crash, and the UNIQUE index on dedupe_key is what
   * makes that safe.
   *
   * Throwing means "not durably stored" and stops the batch — see `runSync`.
   */
  accept(outcome: IngestOutcome, msg: MailboxMessage): void | Promise<void>
}

export interface SyncState {
  readonly lastAttemptAt: string | null
  readonly lastSuccessAt: string | null
  readonly consecutiveFailures: number
  /** Messages held for review because no parser could read them. */
  readonly quarantineDepth: number
}

export const INITIAL_SYNC_STATE: SyncState = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  quarantineDepth: 0,
}

export interface SyncResult {
  readonly ok: boolean
  readonly fetched: number
  readonly parsed: number
  readonly ignored: number
  readonly quarantined: number
  readonly factCount: number
  readonly cursor: SyncCursor
  readonly state: SyncState
  /** True when the batch limit was hit, so the caller should run again at once. */
  readonly hasMore: boolean
  /** Set when the sink failed. The cursor did not advance past the failure. */
  readonly error?: { readonly uid: number; readonly detail: string }
  /** True when UIDVALIDITY changed and the mailbox was rescanned from the start. */
  readonly resetOccurred: boolean
}

export interface SyncOptions {
  source: MailboxSource
  registry: ParserRegistry
  cursors: CursorStore
  sink: FactSink
  /** ISO timestamp. Passed in, never read from the clock, so runs are reproducible. */
  now: string
  state?: SyncState
  /** Cap per run so a first sync over years of mail does not run unbounded. */
  batchSize?: number
}

export const DEFAULT_BATCH_SIZE = 200

function detailOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/**
 * Run one sync pass. Pure with respect to time — `now` is supplied.
 *
 * Ordering is deliberate: a message is only counted as done once the sink has
 * accepted it, and the cursor advances to the highest UID that reached that
 * point. Commit, then advance. The reverse loses mail on a crash.
 */
export async function runSync(opts: SyncOptions): Promise<SyncResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE
  const prevState = opts.state ?? INITIAL_SYNC_STATE

  const currentValidity = await opts.source.uidValidity()
  const stored = opts.cursors.read()

  // A UIDVALIDITY change invalidates every UID ever issued for this mailbox.
  // Rescanning from zero is the only correct response, and it is cheap here
  // precisely because re-processing is idempotent.
  const resetOccurred = stored !== null && stored.uidValidity !== currentValidity
  const startUid = stored === null || resetOccurred ? 0 : stored.lastUid

  const batch = await opts.source.fetchSince(startUid, batchSize)

  let parsed = 0
  let ignored = 0
  let quarantined = 0
  let factCount = 0
  let highestDone = startUid
  let failure: { uid: number; detail: string } | undefined

  for (const item of batch) {
    const outcome = opts.registry.ingest(item.message)

    try {
      await opts.sink.accept(outcome, item)
    } catch (error) {
      // The sink failing means "not durably stored". Stop here and leave the
      // cursor below this UID so the next run retries it. Continuing past a
      // storage failure is how ledgers develop holes.
      failure = { uid: item.uid, detail: detailOf(error) }
      break
    }

    if (outcome.status === 'parsed') {
      parsed++
      factCount += outcome.facts.length
    } else if (outcome.status === 'ignored') {
      ignored++
    } else {
      quarantined++
    }

    // Advance past quarantined messages too. A message no parser can read is a
    // poison pill: block on it and every later message is stranded behind one
    // unparseable receipt. It is recorded for review, and the raw message is
    // retained, so replaying it after a parser fix costs nothing.
    highestDone = item.uid
  }

  const ok = failure === undefined
  const cursor: SyncCursor = { uidValidity: currentValidity, lastUid: highestDone }

  // Persist the cursor even on partial failure — the messages before the failure
  // really are stored, and re-reading them would be wasted work.
  if (highestDone !== startUid || resetOccurred || stored === null) {
    opts.cursors.write(cursor)
  }

  const state: SyncState = {
    lastAttemptAt: opts.now,
    lastSuccessAt: ok ? opts.now : prevState.lastSuccessAt,
    consecutiveFailures: ok ? 0 : prevState.consecutiveFailures + 1,
    quarantineDepth: prevState.quarantineDepth + quarantined,
  }

  return {
    ok,
    fetched: batch.length,
    parsed,
    ignored,
    quarantined,
    factCount,
    cursor,
    state,
    hasMore: ok && batch.length === batchSize,
    ...(failure ? { error: failure } : {}),
    resetOccurred,
  }
}

/**
 * Drain the mailbox by running passes until it is caught up.
 *
 * Bounded by `maxPasses` so a misbehaving source cannot spin forever.
 */
export async function syncUntilCaughtUp(
  opts: SyncOptions & { maxPasses?: number },
): Promise<SyncResult> {
  const maxPasses = opts.maxPasses ?? 50
  let state = opts.state ?? INITIAL_SYNC_STATE
  let last: SyncResult | null = null

  for (let pass = 0; pass < maxPasses; pass++) {
    last = await runSync({ ...opts, state })
    state = last.state
    if (!last.ok || !last.hasMore) break
  }

  if (last === null) throw new Error('syncUntilCaughtUp requires maxPasses >= 1')
  return last
}

/* -----------------------------------------------------------------------------
   Freshness — the UI half of the contract.

   A stale sync must LOOK stale. Silence is the dangerous state: a screen that
   renders a confident projection from a feed that stopped updating on Tuesday
   is exactly the confidently-wrong-number failure this codebase is built to
   avoid. Same principle as the net-worth coverage meter.
   -------------------------------------------------------------------------- */

export const STALE_AFTER_MINUTES = 30

export interface Freshness {
  readonly minutesSince: number | null
  readonly isStale: boolean
  readonly neverSynced: boolean
  readonly failing: boolean
  /** Short human label for a status line. */
  readonly label: string
}

export function describeFreshness(state: SyncState, now: string): Freshness {
  const failing = state.consecutiveFailures > 0

  if (state.lastSuccessAt === null) {
    return {
      minutesSince: null,
      isStale: true,
      neverSynced: true,
      failing,
      label: 'Never synced',
    }
  }

  const minutesSince = Math.max(
    0,
    Math.round((Date.parse(now) - Date.parse(state.lastSuccessAt)) / 60_000),
  )
  const isStale = minutesSince > STALE_AFTER_MINUTES || failing

  let label: string
  if (failing) {
    label = `Sync failing (${state.consecutiveFailures}x) — last success ${humanGap(minutesSince)}`
  } else if (minutesSince < 1) {
    label = 'Synced just now'
  } else {
    label = `Synced ${humanGap(minutesSince)}`
  }

  return { minutesSince, isStale, neverSynced: false, failing, label }
}

function humanGap(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** In-memory cursor store. Real runs use a database-backed one. */
export function memoryCursorStore(initial: SyncCursor | null = null): CursorStore {
  let current = initial
  return {
    read: () => current,
    write: (c) => {
      current = c
    },
  }
}
