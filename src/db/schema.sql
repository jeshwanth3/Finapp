-- Finapp canonical schema — design spec §7.
--
-- This file is migration version 1 (the baseline). It is applied by migrate.ts and
-- must never be edited once it has run anywhere: later changes go in migrations/NNN_*.sql.
--
-- Conventions enforced here rather than in application code, because a constraint that
-- lives only in TypeScript is a constraint that a future ingestion script will bypass:
--
--   MONEY IS A COLUMN PAIR. Every monetary value is (<name>_minor INTEGER, currency TEXT).
--   There is no single "amount" column anywhere in this file, and no REAL column holds
--   money. All tables are STRICT, so SQLite itself rejects a float written into an
--   INTEGER minor-unit column instead of silently storing 4.5 cents.
--
--   MINOR UNITS STAY JS-SAFE. Every *_minor column carries a range CHECK against
--   ±(2^53 - 1). SQLite integers are 64-bit but JavaScript numbers are not, so a value
--   outside that range would round on read. Failing the write is the only honest option.
--
--   SIGN CONVENTION. amount_minor is negative when money leaves the owner (a purchase,
--   a fee, an outgoing transfer) and positive when it arrives (a payment, a refund, a
--   deposit) — for EVERY account kind, including credit cards. A card's outstanding
--   balance is therefore derived, not stored with a flipped sign. The direction column
--   restates this classification and a CHECK keeps the two from disagreeing.
--
--   DATES. Calendar dates are TEXT 'YYYY-MM-DD'. Instants are TEXT ISO-8601 UTC ending
--   in 'Z'. Both are GLOB-checked; SQLite has no date type and unvalidated text dates
--   sort wrongly the first time an import writes 'DD/MM/YYYY'.
--
--   owner_id IS NULLABLE AND PRESENT EVERYWHERE FROM DAY ONE (spec §7.2). Single-user
--   today; retrofitting a tenant key across a populated ledger later is a migration
--   nobody wants to write.

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
-- SPEC GAP: §7.2 gives merchant, transaction and budget a category_id but never
-- defines the table it points at. Declared here so the foreign keys have a target.
CREATE TABLE categories (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT,
  parent_id     TEXT REFERENCES categories(id) ON DELETE SET NULL,
  slug          TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  -- NULL means the category applies to every region (spec §6.1: shared core taxonomy
  -- with regional extensions).
  region        TEXT CHECK (region IS NULL OR region IN ('US', 'IN')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  CHECK (parent_id IS NULL OR parent_id <> id)
) STRICT;

-- COALESCE, not a plain UNIQUE: SQLite treats NULLs as distinct, so a bare
-- UNIQUE(owner_id, slug) would allow unlimited duplicates while owner_id is NULL —
-- which is exactly the state the app ships in.
CREATE UNIQUE INDEX ux_categories_owner_slug ON categories (COALESCE(owner_id, ''), slug);

-- ---------------------------------------------------------------------------
-- Accounts (spec §7.2)
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT,
  institution   TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'credit_card', 'checking', 'savings', 'loan', 'line_of_credit'
                )),
  currency      TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  region        TEXT NOT NULL CHECK (region IN ('US', 'IN')),
  display_name  TEXT NOT NULL,
  -- Last four digits as shown in the email. Never the full number: spec §14 forbids
  -- real account identifiers in the repo and the same rule applies to the store.
  last4_hint    TEXT CHECK (last4_hint IS NULL OR last4_hint GLOB '[0-9][0-9][0-9][0-9]'),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE INDEX ix_accounts_owner_active ON accounts (COALESCE(owner_id, ''), is_active);

-- ---------------------------------------------------------------------------
-- Merchants (spec §7.2)
-- ---------------------------------------------------------------------------
CREATE TABLE merchants (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT,
  region          TEXT NOT NULL CHECK (region IN ('US', 'IN')),
  canonical_name  TEXT NOT NULL,
  -- Output of core/descriptor.ts merchantKey(). Stored rather than recomputed so a
  -- change to the normaliser is a visible migration, not a silent re-partitioning of
  -- every historical transaction.
  merchant_key    TEXT NOT NULL,
  category_id     TEXT REFERENCES categories(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                  CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE UNIQUE INDEX ux_merchants_region_key
  ON merchants (COALESCE(owner_id, ''), region, merchant_key);

-- §7.2 writes merchant.aliases[]. SQLite has no array type and a JSON blob would be
-- unindexable, so the list is normalised into its own table.
CREATE TABLE merchant_aliases (
  merchant_id  TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  owner_id     TEXT,
  alias        TEXT NOT NULL,
  -- Where the alias came from: a deterministic normalisation, a user confirmation, or
  -- the local model's adjudication (spec §11). Needed to re-run adjudication safely.
  origin       TEXT NOT NULL CHECK (origin IN ('normalizer', 'user', 'model', 'import')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
               CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  PRIMARY KEY (merchant_id, alias)
) STRICT;

CREATE INDEX ix_merchant_aliases_alias ON merchant_aliases (alias);

-- ---------------------------------------------------------------------------
-- Statements (spec §7.2) — authoritative source, per §7.3
-- ---------------------------------------------------------------------------
CREATE TABLE statements (
  id                       TEXT PRIMARY KEY,
  owner_id                 TEXT,
  account_id               TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period_start             TEXT NOT NULL
                           CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_end               TEXT NOT NULL
                           CHECK (period_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  statement_balance_minor  INTEGER NOT NULL
                           CHECK (statement_balance_minor BETWEEN -9007199254740991 AND 9007199254740991),
  minimum_due_minor        INTEGER
                           CHECK (minimum_due_minor IS NULL OR
                                  minimum_due_minor BETWEEN -9007199254740991 AND 9007199254740991),
  due_date                 TEXT
                           CHECK (due_date IS NULL OR
                                  due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  currency                 TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  source_message_id        TEXT NOT NULL,
  pdf_path                 TEXT,
  is_parsed                INTEGER NOT NULL DEFAULT 0 CHECK (is_parsed IN (0, 1)),
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                           CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  CHECK (period_start <= period_end)
) STRICT;

-- One statement per account per period. Re-parsing the same PDF must not create a
-- second period that then double-counts in the debt map.
CREATE UNIQUE INDEX ux_statements_account_period
  ON statements (account_id, period_start, period_end);

-- Debt map and due-date calendar (spec §9.1) read by account, newest period first.
CREATE INDEX ix_statements_account_period_end ON statements (account_id, period_end DESC);
CREATE INDEX ix_statements_due_date ON statements (due_date) WHERE due_date IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Transactions (spec §7.2, §7.3, §7.4)
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
  id                      TEXT PRIMARY KEY,
  owner_id                TEXT,
  account_id              TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  posted_at               TEXT NOT NULL
                          CHECK (posted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_minor            INTEGER NOT NULL
                          CHECK (amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
  currency                TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  merchant_raw            TEXT NOT NULL,
  merchant_id             TEXT REFERENCES merchants(id) ON DELETE SET NULL,
  category_id             TEXT REFERENCES categories(id) ON DELETE SET NULL,
  direction               TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  source                  TEXT NOT NULL
                          CHECK (source IN ('alert', 'statement_pdf', 'csv_import', 'manual')),
  -- Provenance half of the dedupe key (core/reconcile.ts): the message or statement
  -- this row was read out of, plus the line number within it.
  source_ref              TEXT NOT NULL,
  ordinal                 INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  -- The statement whose PDF produced this row, when source = 'statement_pdf'.
  statement_id            TEXT REFERENCES statements(id) ON DELETE SET NULL,
  confidence              REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  dedupe_key              TEXT NOT NULL,
  -- Set when an authoritative statement row supersedes this provisional alert row
  -- (spec §7.3). The superseded row is retained: reconciliation is explicit, never a
  -- silent overwrite.
  superseded_by           TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  categorization_version  INTEGER NOT NULL DEFAULT 0 CHECK (categorization_version >= 0),
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                          CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  CHECK (superseded_by IS NULL OR superseded_by <> id),
  CHECK (
    (direction = 'debit'  AND amount_minor <= 0) OR
    (direction = 'credit' AND amount_minor >= 0)
  ),
  -- Only statement-sourced rows may point at a statement; an alert claiming statement
  -- provenance would win reconciliation it should have lost.
  CHECK (statement_id IS NULL OR source = 'statement_pdf')
) STRICT;

-- The single most important constraint in the schema (spec §7.4). Import idempotency
-- depends on the DATABASE rejecting a repeat, not on the importer remembering to check.
CREATE UNIQUE INDEX ux_transactions_dedupe_key ON transactions (dedupe_key);

-- Primary read path: one account's ledger over a date range.
CREATE INDEX ix_transactions_account_posted ON transactions (account_id, posted_at);

-- Most queries want only live rows. A partial index keeps superseded history out of
-- the hot path without a second table.
CREATE INDEX ix_transactions_live_account_posted
  ON transactions (account_id, posted_at) WHERE superseded_by IS NULL;

-- Recurring-stream detection (spec §9.3) scans by merchant over time.
CREATE INDEX ix_transactions_merchant_posted
  ON transactions (merchant_id, posted_at) WHERE merchant_id IS NOT NULL;

CREATE INDEX ix_transactions_superseded_by
  ON transactions (superseded_by) WHERE superseded_by IS NOT NULL;

CREATE INDEX ix_transactions_statement ON transactions (statement_id)
  WHERE statement_id IS NOT NULL;

-- Re-categorisation sweeps select rows below the current version.
CREATE INDEX ix_transactions_categorization_version ON transactions (categorization_version);

-- ---------------------------------------------------------------------------
-- Balance observations (spec §7.2)
-- ---------------------------------------------------------------------------
CREATE TABLE balance_observations (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  observed_at    TEXT NOT NULL
                 CHECK (observed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  balance_minor  INTEGER NOT NULL
                 CHECK (balance_minor BETWEEN -9007199254740991 AND 9007199254740991),
  currency       TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  source         TEXT NOT NULL
                 CHECK (source IN ('alert', 'statement_pdf', 'csv_import', 'manual')),
  source_ref     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

-- Re-reading the same alert email must not add a second observation of the same instant.
CREATE UNIQUE INDEX ux_balance_observations_provenance
  ON balance_observations (account_id, source, source_ref, observed_at);

-- Net worth and the cash-flow simulator both want "latest balance for this account".
CREATE INDEX ix_balance_observations_account_observed
  ON balance_observations (account_id, observed_at DESC);

-- ---------------------------------------------------------------------------
-- Recurring streams and price steps (spec §7.2, §9.3, §9.4)
-- ---------------------------------------------------------------------------
CREATE TABLE recurring_streams (
  id                     TEXT PRIMARY KEY,
  owner_id               TEXT,
  account_id             TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  merchant_id            TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  cadence                TEXT NOT NULL CHECK (cadence IN (
                           'weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual'
                         )),
  expected_amount_minor  INTEGER NOT NULL
                         CHECK (expected_amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
  currency               TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  first_seen             TEXT NOT NULL
                         CHECK (first_seen GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  last_seen              TEXT NOT NULL
                         CHECK (last_seen GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status                 TEXT NOT NULL CHECK (status IN (
                           'candidate', 'mature', 'dormant', 'cancelled'
                         )),
  confidence             REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                         CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                         CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  CHECK (first_seen <= last_seen)
) STRICT;

-- Deliberately NOT unique: spec §14 case 4 requires supporting two distinct
-- subscriptions to the same merchant on the same account.
CREATE INDEX ix_recurring_streams_merchant_account
  ON recurring_streams (merchant_id, account_id);
CREATE INDEX ix_recurring_streams_status ON recurring_streams (status, last_seen DESC);

CREATE TABLE price_change_events (
  id                      TEXT PRIMARY KEY,
  owner_id                TEXT,
  stream_id               TEXT NOT NULL REFERENCES recurring_streams(id) ON DELETE CASCADE,
  effective_at            TEXT NOT NULL
                          CHECK (effective_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  old_amount_minor        INTEGER NOT NULL
                          CHECK (old_amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
  new_amount_minor        INTEGER NOT NULL
                          CHECK (new_amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
  annualized_delta_minor  INTEGER NOT NULL
                          CHECK (annualized_delta_minor BETWEEN -9007199254740991 AND 9007199254740991),
  -- SPEC GAP: §7.2 lists three minor-unit fields on this entity and no currency. Money
  -- is a pair (§7.1), so one currency column covers all three — they are by definition
  -- the same currency as the stream.
  currency                TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  detected_from           TEXT NOT NULL CHECK (detected_from IN (
                            'statement', 'alert', 'announcement_email'
                          )),
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                          CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE INDEX ix_price_change_events_stream ON price_change_events (stream_id, effective_at DESC);

-- ---------------------------------------------------------------------------
-- Insights and commitments (spec §7.2, §9.7)
-- ---------------------------------------------------------------------------
CREATE TABLE insights (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT,
  kind          TEXT NOT NULL,
  generated_at  TEXT NOT NULL
                CHECK (generated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  severity      TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  is_dismissed  INTEGER NOT NULL DEFAULT 0 CHECK (is_dismissed IN (0, 1)),
  dismissed_at  TEXT
                CHECK (dismissed_at IS NULL OR
                       dismissed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  CHECK ((is_dismissed = 1) = (dismissed_at IS NOT NULL))
) STRICT;

CREATE INDEX ix_insights_kind_generated ON insights (kind, generated_at DESC);
CREATE INDEX ix_insights_live ON insights (generated_at DESC) WHERE is_dismissed = 0;

-- §7.2 writes evidence_transaction_ids[] and evidence_message_ids[]. Same array problem
-- as merchant aliases, plus every insight in §9 must drill through to its evidence
-- (§15 phase 6) — so evidence is a queryable table, not a serialised list.
--
-- No foreign key: evidence points at several tables (transactions, raw_messages,
-- statements, recurring_streams) and SQLite cannot express a polymorphic reference.
-- Referential integrity for evidence is checked by the repository read, which drops
-- nothing silently — a dangling reference surfaces as a missing-evidence flag.
CREATE TABLE insight_evidence (
  insight_id     TEXT NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
  owner_id       TEXT,
  evidence_kind  TEXT NOT NULL CHECK (evidence_kind IN (
                   'transaction', 'message', 'statement', 'recurring_stream',
                   'balance_observation', 'holding_lot'
                 )),
  evidence_id    TEXT NOT NULL,
  ordinal        INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  PRIMARY KEY (insight_id, evidence_kind, evidence_id)
) STRICT;

CREATE INDEX ix_insight_evidence_target ON insight_evidence (evidence_kind, evidence_id);

CREATE TABLE commitments (
  id                          TEXT PRIMARY KEY,
  owner_id                    TEXT,
  insight_id                  TEXT REFERENCES insights(id) ON DELETE SET NULL,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  target_monthly_saving_minor INTEGER NOT NULL
                              CHECK (target_monthly_saving_minor BETWEEN -9007199254740991 AND 9007199254740991),
  -- Covers both the target and the realised amount: a commitment cannot change currency
  -- mid-flight without becoming a different commitment.
  currency                    TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  status                      TEXT NOT NULL CHECK (status IN ('open', 'kept', 'broken', 'expired')),
  verified_at                 TEXT
                              CHECK (verified_at IS NULL OR
                                     verified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  actual_saving_minor         INTEGER
                              CHECK (actual_saving_minor IS NULL OR
                                     actual_saving_minor BETWEEN -9007199254740991 AND 9007199254740991),
  -- CORRECTION (was: `status = 'open' OR verified_at IS NOT NULL`). That form made an
  -- 'expired' commitment unrecordable: expiry is precisely the case where the deadline
  -- passed and nobody verified anything. Verification is required only for the two
  -- statuses that assert an observed outcome.
  CHECK (status NOT IN ('kept', 'broken') OR verified_at IS NOT NULL),
  -- A realised figure without a verification instant is a number with no provenance.
  CHECK (actual_saving_minor IS NULL OR verified_at IS NOT NULL)
) STRICT;

CREATE INDEX ix_commitments_status ON commitments (status, created_at DESC);
CREATE INDEX ix_commitments_insight ON commitments (insight_id) WHERE insight_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Assets, holdings, valuation (spec §7.2.1)
-- ---------------------------------------------------------------------------
CREATE TABLE asset_accounts (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT,
  institution   TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'brokerage', 'checking', 'savings', 'retirement', 'manual'
                )),
  currency      TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  region        TEXT NOT NULL CHECK (region IN ('US', 'IN')),
  display_name  TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE INDEX ix_asset_accounts_owner_active ON asset_accounts (COALESCE(owner_id, ''), is_active);

CREATE TABLE instruments (
  id                  TEXT PRIMARY KEY,
  owner_id            TEXT,
  kind                TEXT NOT NULL CHECK (kind IN (
                        'mutual_fund', 'equity', 'etf', 'cash', 'manual_asset'
                      )),
  region              TEXT NOT NULL CHECK (region IN ('US', 'IN')),
  currency            TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  display_name        TEXT NOT NULL,
  external_id         TEXT,
  external_id_scheme  TEXT CHECK (external_id_scheme IS NULL OR external_id_scheme IN (
                        'amfi_scheme_code', 'isin', 'ticker'
                      )),
  -- Identity resolution is fuzzy and consequential (§7.2.1): a low-confidence match is
  -- not auto-applied, and an unconfirmed instrument must price at cost basis only.
  match_confidence    REAL CHECK (match_confidence IS NULL OR
                                  (match_confidence >= 0.0 AND match_confidence <= 1.0)),
  is_user_confirmed   INTEGER NOT NULL DEFAULT 0 CHECK (is_user_confirmed IN (0, 1)),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                      CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  CHECK ((external_id IS NULL) = (external_id_scheme IS NULL))
) STRICT;

CREATE UNIQUE INDEX ux_instruments_external
  ON instruments (external_id_scheme, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE holding_lots (
  id                 TEXT PRIMARY KEY,
  owner_id           TEXT,
  asset_account_id   TEXT NOT NULL REFERENCES asset_accounts(id) ON DELETE CASCADE,
  instrument_id      TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
  acquired_at        TEXT NOT NULL
                     CHECK (acquired_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- SPEC GAP: §7.2.1 says `units` with no type. Mutual-fund units are fractional, and a
  -- REAL column would put a float directly upstream of a money calculation
  -- (units × NAV = value). Stored as a scaled integer instead: units × 1e6, giving six
  -- decimal places (AMFI publishes three) and a ~9.0e9 unit ceiling within JS-safe range.
  units_micro        INTEGER NOT NULL
                     CHECK (units_micro BETWEEN -9007199254740991 AND 9007199254740991),
  cost_minor         INTEGER NOT NULL
                     CHECK (cost_minor BETWEEN -9007199254740991 AND 9007199254740991),
  currency           TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  source             TEXT NOT NULL
                     CHECK (source IN ('alert', 'statement_pdf', 'csv_import', 'manual')),
  source_message_id  TEXT,
  confidence         REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  dedupe_key         TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                     CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

-- SIP allocation emails get re-read on every backfill; without this, units double.
CREATE UNIQUE INDEX ux_holding_lots_dedupe_key ON holding_lots (dedupe_key);
CREATE INDEX ix_holding_lots_account_instrument
  ON holding_lots (asset_account_id, instrument_id, acquired_at);
CREATE INDEX ix_holding_lots_instrument ON holding_lots (instrument_id, acquired_at);

CREATE TABLE valuations (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT,
  instrument_id  TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  as_of_date     TEXT NOT NULL
                 CHECK (as_of_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- SPEC GAP: §7.2.1 says price_minor. AMFI publishes NAV to four decimal places, so a
  -- price held at the currency's own exponent would truncate 123.4567 to 123.45 and
  -- misvalue every holding by up to a paisa per unit — which compounds across thousands
  -- of units. Stored as minor units × 1e4 (see PRICE_SCALE in types.ts).
  price_minor_e4 INTEGER NOT NULL
                 CHECK (price_minor_e4 BETWEEN -9007199254740991 AND 9007199254740991),
  currency       TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  source         TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

-- "Never overwritten; history is the point" (§7.2.1) — one price per instrument per day
-- per source, and a re-fetch of the same day is rejected rather than silently replacing.
CREATE UNIQUE INDEX ux_valuations_instrument_date_source
  ON valuations (instrument_id, as_of_date, source);
CREATE INDEX ix_valuations_instrument_date ON valuations (instrument_id, as_of_date DESC);

CREATE TABLE manual_assets (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT,
  display_name  TEXT NOT NULL,
  value_minor   INTEGER NOT NULL
                CHECK (value_minor BETWEEN -9007199254740991 AND 9007199254740991),
  currency      TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  as_of_date    TEXT NOT NULL
                CHECK (as_of_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE INDEX ix_manual_assets_owner ON manual_assets (COALESCE(owner_id, ''), as_of_date DESC);

-- ---------------------------------------------------------------------------
-- Budgets (spec §7.2.1, §9.10)
-- ---------------------------------------------------------------------------
CREATE TABLE budgets (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT,
  category_id   TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  -- §7.2.1 writes `period (month)`: monthly is the only granularity in v1, so the
  -- period is identified by the month itself rather than a granularity enum.
  period_month  TEXT NOT NULL CHECK (period_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  limit_minor   INTEGER NOT NULL
                CHECK (limit_minor BETWEEN -9007199254740991 AND 9007199254740991),
  currency      TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  is_rollover   INTEGER NOT NULL DEFAULT 0 CHECK (is_rollover IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE UNIQUE INDEX ux_budgets_owner_category_period
  ON budgets (COALESCE(owner_id, ''), category_id, period_month);

-- ---------------------------------------------------------------------------
-- Ingestion: raw store and quarantine (spec §8.3)
-- ---------------------------------------------------------------------------
-- "Every raw message is stored before parsing." Parsers can then be re-run over history
-- when a bug is fixed or a new fact type is added, without re-fetching the mailbox.
CREATE TABLE raw_messages (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT,
  -- RFC 5322 Message-ID. Unique: the poller will see the same message again on any
  -- overlapping UID range, and re-storing it would re-emit every fact it carries.
  message_id      TEXT NOT NULL,
  mailbox         TEXT NOT NULL,
  imap_uid        INTEGER CHECK (imap_uid IS NULL OR imap_uid >= 0),
  from_address    TEXT NOT NULL,
  subject         TEXT NOT NULL,
  received_at     TEXT NOT NULL
                  CHECK (received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  raw             BLOB NOT NULL,
  byte_size       INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'parsed', 'quarantined', 'ignored')),
  parser_id       TEXT,
  parser_version  INTEGER CHECK (parser_version IS NULL OR parser_version >= 0),
  parsed_at       TEXT
                  CHECK (parsed_at IS NULL OR
                         parsed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                  CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE UNIQUE INDEX ux_raw_messages_message_id ON raw_messages (message_id);
CREATE INDEX ix_raw_messages_status_received ON raw_messages (status, received_at DESC);
CREATE INDEX ix_raw_messages_from ON raw_messages (from_address, received_at DESC);

-- Quarantine queue. A message that fails to parse is surfaced in the UI, never dropped
-- (§8.3), and template drift must stay visible in the digest.
CREATE TABLE parse_failures (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT,
  raw_message_id  TEXT NOT NULL REFERENCES raw_messages(id) ON DELETE CASCADE,
  parser_id       TEXT,
  parser_version  INTEGER CHECK (parser_version IS NULL OR parser_version >= 0),
  failed_at       TEXT NOT NULL
                  CHECK (failed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  reason          TEXT NOT NULL CHECK (reason IN (
                    'no_parser_matched', 'extract_threw', 'validation_failed',
                    'total_mismatch', 'password_required', 'unsupported_format'
                  )),
  detail          TEXT NOT NULL,
  resolved_at     TEXT
                  CHECK (resolved_at IS NULL OR
                         resolved_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                  CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE INDEX ix_parse_failures_open ON parse_failures (failed_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX ix_parse_failures_parser ON parse_failures (parser_id, failed_at DESC);
CREATE INDEX ix_parse_failures_message ON parse_failures (raw_message_id);
