-- Migration 002: sync_cursors table for IMAP cursor persistence.
--
-- The sync loop stores its position here so it can resume after a restart.
-- UIDVALIDITY is tracked per-mailbox: when Gmail reassigns UIDs (rare but
-- possible after a mailbox restructure), the cursor resets to zero and the
-- mailbox is rescanned. Re-processing is idempotent, so this is safe.

CREATE TABLE IF NOT EXISTS sync_cursors (
  id              TEXT PRIMARY KEY DEFAULT 'default',
  mailbox         TEXT NOT NULL DEFAULT 'INBOX',
  uid_validity    INTEGER NOT NULL,
  last_uid        INTEGER NOT NULL DEFAULT 0 CHECK (last_uid >= 0),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                  CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

-- Sync state tracking for freshness display in the UI.
CREATE TABLE IF NOT EXISTS sync_state (
  id                      TEXT PRIMARY KEY DEFAULT 'default',
  last_attempt_at         TEXT
                          CHECK (last_attempt_at IS NULL OR
                                 last_attempt_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  last_success_at         TEXT
                          CHECK (last_success_at IS NULL OR
                                 last_success_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  consecutive_failures    INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  quarantine_depth        INTEGER NOT NULL DEFAULT 0 CHECK (quarantine_depth >= 0),
  total_parsed            INTEGER NOT NULL DEFAULT 0 CHECK (total_parsed >= 0),
  total_ignored           INTEGER NOT NULL DEFAULT 0 CHECK (total_ignored >= 0)
) STRICT;
