/**
 * POST /api/sync — trigger a Gmail IMAP sync pass.
 *
 * Connects to Gmail, fetches new messages since the last cursor, runs them
 * through the parser registry, and writes results to SQLite. Returns a
 * summary of what happened.
 *
 * This is a server-only route (Next.js App Router Route Handler). It never
 * exposes credentials to the client — the IMAP connection happens entirely
 * server-side.
 */

import { NextResponse } from 'next/server'
import { openDatabase, closeDatabase } from '@/db/db'
import { migrate } from '@/db/migrate'
import { createRepositories } from '@/db/repositories'
import { defaultRegistry } from '@/ingest/parsers'
import { createGmailSource } from '@/ingest/gmail'
import { createFactSink } from '@/ingest/fact-sink'
import { syncUntilCaughtUp, type SyncCursor, type CursorStore, type SyncState } from '@/ingest/sync'

/**
 * SQLite-backed cursor store. Reads and writes the sync_cursors table.
 */
function sqliteCursorStore(db: import('@/db/sqlite').Database): CursorStore {
  return {
    read(): SyncCursor | null {
      ensureSyncTables(db)
      const row = db.prepare('SELECT uid_validity, last_uid FROM sync_cursors WHERE id = ?').get('default') as
        | { uid_validity: number; last_uid: number }
        | undefined
      if (!row) return null
      return { uidValidity: row.uid_validity, lastUid: row.last_uid }
    },
    write(cursor: SyncCursor): void {
      ensureSyncTables(db)
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO sync_cursors (id, uid_validity, last_uid, updated_at)
         VALUES ('default', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET uid_validity = excluded.uid_validity, last_uid = excluded.last_uid, updated_at = excluded.updated_at`,
      ).run(cursor.uidValidity, cursor.lastUid, now)
    },
  }
}

function ensureSyncTables(db: import('@/db/sqlite').Database): void {
  // Create sync tables if they don't exist (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_cursors (
      id TEXT PRIMARY KEY DEFAULT 'default',
      mailbox TEXT NOT NULL DEFAULT 'INBOX',
      uid_validity INTEGER NOT NULL,
      last_uid INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sync_state (
      id TEXT PRIMARY KEY DEFAULT 'default',
      last_attempt_at TEXT,
      last_success_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      quarantine_depth INTEGER NOT NULL DEFAULT 0,
      total_parsed INTEGER NOT NULL DEFAULT 0,
      total_ignored INTEGER NOT NULL DEFAULT 0
    ) STRICT;
  `)
}

function readSyncState(db: import('@/db/sqlite').Database): SyncState {
  ensureSyncTables(db)
  const row = db.prepare('SELECT * FROM sync_state WHERE id = ?').get('default') as {
    last_attempt_at: string | null
    last_success_at: string | null
    consecutive_failures: number
    quarantine_depth: number
  } | undefined

  if (!row) {
    return {
      lastAttemptAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      quarantineDepth: 0,
    }
  }
  return {
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    consecutiveFailures: row.consecutive_failures,
    quarantineDepth: row.quarantine_depth,
  }
}

function writeSyncState(db: import('@/db/sqlite').Database, state: SyncState): void {
  ensureSyncTables(db)
  db.prepare(
    `INSERT INTO sync_state (id, last_attempt_at, last_success_at, consecutive_failures, quarantine_depth)
     VALUES ('default', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = excluded.last_success_at,
       consecutive_failures = excluded.consecutive_failures,
       quarantine_depth = excluded.quarantine_depth`,
  ).run(state.lastAttemptAt, state.lastSuccessAt, state.consecutiveFailures, state.quarantineDepth)
}

export async function POST() {
  const dbPath = './finapp.db'

  // Validate credentials are present
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return NextResponse.json(
      { error: 'Gmail credentials not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env.local' },
      { status: 500 },
    )
  }

  const db = openDatabase({ path: dbPath, createDirectory: true })
  let gmailSource: import('@/ingest/gmail').GmailImapSource | null = null

  try {
    migrate(db)
    const repos = createRepositories(db)
    const registry = defaultRegistry()
    const cursorStore = sqliteCursorStore(db)
    const sink = createFactSink(db, repos)
    const prevState = readSyncState(db)

    // Connect to Gmail
    gmailSource = createGmailSource()
    await gmailSource.connect()

    const now = new Date().toISOString()
    const result = await syncUntilCaughtUp({
      source: gmailSource,
      registry,
      cursors: cursorStore,
      sink,
      now,
      state: prevState,
      batchSize: 100,
      maxPasses: 20,
      // Disable authenticity checking for the initial sync — many forwarded
      // emails lack proper DKIM headers and would be quarantined unnecessarily.
      authenticity: false,
    })

    // Persist sync state
    writeSyncState(db, result.state)

    return NextResponse.json({
      ok: result.ok,
      fetched: result.fetched,
      parsed: result.parsed,
      ignored: result.ignored,
      quarantined: result.quarantined,
      factCount: result.factCount,
      hasMore: result.hasMore,
      resetOccurred: result.resetOccurred,
      lastUid: result.cursor.lastUid,
      error: result.error ?? null,
    })
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: detail }, { status: 500 })
  } finally {
    if (gmailSource) {
      try {
        await gmailSource.disconnect()
      } catch {
        // Connection cleanup — non-fatal
      }
    }
    closeDatabase(db)
  }
}

/**
 * GET /api/sync — return current sync state (for the UI freshness indicator).
 */
export async function GET() {
  const dbPath = './finapp.db'
  const db = openDatabase({ path: dbPath, createDirectory: true })

  try {
    migrate(db)
    const state = readSyncState(db)
    const cursorStore = sqliteCursorStore(db)
    const cursor = cursorStore.read()

    return NextResponse.json({
      state,
      cursor,
      hasCredentials: Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
    })
  } finally {
    closeDatabase(db)
  }
}
