# Architecture

How the code is laid out, what may import what, and how to extend it without
editing anything that already works.

Design spec: [`docs/superpowers/specs/2026-07-25-finapp-cross-border-finance-assistant-design.md`](../superpowers/specs/2026-07-25-finapp-cross-border-finance-assistant-design.md)
(§6 Architecture, §7 Data model, §8 Ingestion, §9 Insight engine). The spec is the
source of truth for *what* is built. This document is the source of truth for *where
it goes*.

---

## 1. The module map

Spec §6 defines four layers. They map to directories under `src/`:

| Directory | Layer | What lives here | May import |
|---|---|---|---|
| `src/core/` | Canonical primitives | `money.ts`, `descriptor.ts`, `reconcile.ts` — value types and pure arithmetic | Node built-ins only (`node:crypto`) |
| `src/db/` | Canonical ledger | schema DDL, migrations, repositories, `reset.ts`, `seed.ts` | `core`, `node:sqlite` |
| `src/ingest/` | Ingestion | IMAP client, parser registry, PDF extraction, AMFI/FX feeds | `core` only |
| `src/engine/` | Insight engine | debt map, cash-flow simulator, recurring detection, net worth, XIRR, budgets | `core`, `db` |
| `src/app/` | Delivery | Next.js routes, API handlers, server jobs — **and the composition root** | everything below |
| `src/components/` | Delivery | React components | `core`, and types from `engine` |
| `src/fixtures/` | Test/demo data | `demo.ts` today; golden fixtures later | `core` only |

### The dependency rule

```
core  <-  db  <-  engine  <-  app
  ^                            |
  |                            |
ingest ----------(wired by)----+

nothing imports app.
```

Read the arrows as "is imported by". Concretely:

- **`core` imports nothing but Node built-ins.** `reconcile.ts` imports `node:crypto`,
  `./money`, `./descriptor`. That is the whole import list and it stays that way.
- **`ingest` imports `core` only — never `db`.** A parser is a pure function
  `(message) => ParsedFact[]`. It does not open a database, does not know a database
  exists, and can therefore be tested with nothing but a `.eml` file and an expected
  JSON blob.
- **`engine` imports `core` and `db`.** It reads the ledger and computes facts. It
  never parses email and never renders.
- **`app` imports everything and is the only place ingest and db meet.** A route
  handler or scheduled job calls `ingest` to get `ParsedFact[]`, then calls a `db`
  repository to persist them. That wiring is app-layer code.
- **Nothing imports `app`.** If `engine` needs a type that currently lives in a route
  file, the type belongs in `engine` and the route imports it.

### Why this rule, specifically here

It is not architectural taste. Three concrete payoffs:

1. **The highest-risk logic in the system stays testable in isolation.** Spec §17 names
   `dedupe_key` over/under-merging as a High severity risk, and §14 puts it first in
   the test order. `reconcile()` is a pure function over `Observation[]`. If it could
   reach a database, its golden fixtures would need one, and the test that protects
   every number in the app becomes slow and flaky.

2. **Parsers are re-runnable against history.** Spec §8.3 requires that every raw
   message is stored *before* parsing so parsers can be re-run when a bug is fixed.
   That only works if a parser is a pure transform. A parser that writes to the
   database as a side effect cannot be replayed without duplicating rows.

3. **Region portability (spec §6.1) has a mechanical boundary.** The hard rule —
   "no institution-specific field may exist above the ingestion boundary" — is
   enforceable exactly because `ingest` cannot import `db`. A parser physically cannot
   sneak a `sbi_reward_points` column into the schema; it can only emit a `ParsedFact`,
   and adding a field to `ParsedFact` is a visible change to a shared type.

### How to verify the rule

These commands must each print nothing. Run them before opening a PR
(also listed in [RUNBOOK.md](./RUNBOOK.md)):

```sh
git grep -n "from '@/db"         -- src/core src/ingest
git grep -n "from '@/engine"     -- src/core src/db src/ingest
git grep -n "from '@/app"        -- src
git grep -n "from '@/components" -- src/core src/db src/engine src/ingest
git grep -n "from 'next"         -- src/core src/db src/engine src/ingest
```

The last one matters more than it looks: a stray `import { NextResponse } from 'next/server'`
in `engine` is how a pure computation layer quietly becomes un-runnable from a cron
job or a test.

---

## 2. Adding a new institution parser

The goal: a new parser is **one new directory of files plus one line in one existing
file**. No existing parser changes, no core change, no schema change, no engine change.

### Layout

```
src/ingest/parsers/
  types.ts                    # Parser, ParsedFact — the shared contract
  index.ts                    # the ONE existing file you edit: an import + an array entry
  us-chase-txn-alert.v1.ts
  in-sbi-card-txn-alert.v2.ts
  in-groww-sip-allocation.v1.ts
  __fixtures__/
    in-sbi-card-txn-alert.v2/
      purchase-inr.eml
      purchase-inr.expected.json
      purchase-usd-billed-inr.eml
      purchase-usd-billed-inr.expected.json
```

### The contract (spec §8.3)

```ts
export interface Parser {
  /** Stable, versioned, greppable: "in.sbi-card.txn-alert.v2" */
  readonly id: string
  readonly institution: string
  readonly region: Region
  readonly version: number
  match(msg: RawMessage): boolean
  extract(msg: RawMessage): ParsedFact[]
}
```

`ParsedFact` is the discriminated union from spec §8.3: `TransactionFact | StatementFact |
BalanceFact | PaymentFact | BillDueFact | SubscriptionFact | PriceChangeFact |
CancellationFact`. Every monetary field on every variant is a `Money` from
`@/core/money` — see [CONVENTIONS.md](./CONVENTIONS.md).

### Steps

1. **Capture the message.** Save the real `.eml` under `__fixtures__/<parser-id>/`,
   then redact it per [SECURITY.md](./SECURITY.md) §5 *before the first `git add`*.
   Redaction is not a cleanup pass; a real account number that reaches the index is
   in the history forever.
2. **Write the expected output** as `<name>.expected.json` — the exact `ParsedFact[]`,
   with money as `{ "minor": 270980, "currency": "USD" }`.
3. **Write the test first** (`us-chase-txn-alert.v1.test.ts`, next to the source).
   It reads the fixture pair and asserts deep equality. Spec §14.2: *a parser without
   a fixture doesn't ship*.
4. **Write the parser.** `match()` should key on the From subdomain plus a subject or
   body invariant — spec §8.2 notes transactional and marketing mail come from
   different subdomains at every institution surveyed, so the subdomain does most of
   the work.
5. **Register it:** one import and one array entry in `parsers/index.ts`.
6. **Never mutate a shipped parser's behaviour.** If the institution changes its
   template, add `...v3.ts` with its own fixtures and register it alongside v2. The
   old parser stays because spec §8.3 requires re-parsing history, and history still
   contains v2-shaped messages. This is the entire reason `version` is in the id.

### What a parser must never do

- Emit a bare number for an amount. Use `fromDecimalString(raw, currency)`, which
  throws on a precision mismatch rather than rounding — that throw is a wrong-currency
  detector, not an inconvenience.
- Guess a currency. If the message does not state it, the account's currency is the
  only legitimate source, and that is an app-layer lookup, not a parser default.
- Swallow a failure. A message it cannot parse goes to `parse_failures` (spec §8.3
  quarantine), which is a return value or a thrown named error — never a `catch {}`.
- Invent a field. If `ParsedFact` has nowhere to put something, either the union
  gains a general-purpose field or the parser drops it (spec §6.1 hard rule).

---

## 3. Adding a new insight

Same shape, same promise: one new file plus one line.

```
src/engine/insights/
  types.ts       # InsightDetector, InsightContext
  index.ts       # the ONE existing file you edit
  cash-flow-collision.ts
  price-step.ts
  fee-leakage.ts
  zombie-subscription.ts
```

```ts
export interface InsightDetector {
  readonly kind: string              // matches insight.kind in the schema
  readonly severity: 'critical' | 'warn' | 'info'
  detect(ctx: InsightContext): DetectedInsight[]
}
```

`InsightContext` is a read-only view of the ledger — repositories from `db`, plus the
as-of date. A detector returns `DetectedInsight`, which **must** carry
`evidenceTransactionIds` and/or `evidenceMessageIds`. Spec §13.2 is categorical:
*if the UI can't drill in, the insight doesn't ship*. Make that structural — a
detector that cannot name its evidence cannot construct its return value.

Three rules that are not negotiable:

- **Every number is computed here, in TypeScript, deterministically.** Spec §9 and
  §12.1: no LLM produces a figure, ever. The model narrates a fact pack the engine
  already computed, and §12.2's numeric guardrail asserts set-membership of every
  figure in the prose against that pack.
- **A detector is a pure function of its context.** No writes, no email sending, no
  push. Persisting the insight and deciding whether it clears the notification bar
  (spec §13.1) are app-layer concerns.
- **Money stays `Money`.** A detector that needs a cross-currency total must carry
  an explicit dated rate; it may not sum across currencies (spec §7.1, §14.7).

---

## 4. Recorded deviations from the spec

These are places the implementation deliberately differs from the written spec.
They are recorded here rather than silently absorbed.

### 4.1 `dedupe_key` is split into two mechanisms

Spec §7.4 defines `dedupe_key = hash(account_id, posted_date_bucket, amount_minor,
currency, normalized_merchant)` with a "±3-day `posted_date_bucket`". **That cannot
work.** A hash is exact-equality; two dates three days apart produce different inputs
and therefore different hashes regardless of the window. Fuzzy matching is not
expressible as a hash.

`src/core/reconcile.ts` splits the conflated concerns:

- `dedupeKey(o)` — exact identity of an *observation*, keyed on provenance
  `(sourceType, sourceRef, ordinal)`. Re-importing the same email is idempotent, and
  two genuinely distinct purchases that are identical in content (same merchant,
  amount, day) stay distinct because they came from different messages. Content
  hashing would have merged them and understated spend in a way that looks correct.
- `reconcile(opts)` — the fuzzy alert↔statement match over a date window and an
  amount-drift allowance, returning a plan and mutating nothing.

`contentFingerprint(o)` retains the spec's content hash, but for diagnostics and
suspected-duplicate detection across sources only. **It is never identity.**

This deviation is already implemented and tested. Build on the module, not on §7.4.

### 4.2 The stack is Node built-ins, not the libraries in spec §6.2

Spec §6.2 names `better-sqlite3` + Drizzle, `imapflow`, `pdfjs-dist`, and `node-cron`.
The build constraint for this repo is **zero new npm dependencies**. Substitutions:

| Spec §6.2 | Actually used | Notes |
|---|---|---|
| better-sqlite3 + Drizzle | `node:sqlite` (`DatabaseSync`) | Verified working unflagged on the installed Node v26.5.0. Hand-written DDL and repositories replace the ORM. No migration-generation tooling — migrations are numbered SQL files applied in order. |
| imapflow | `node:tls` | IMAP is a line-oriented protocol over TLS; the subset needed (LOGIN, SELECT, SEARCH, FETCH, IDLE) is implementable directly. More work, no new dependency. |
| node-cron | `setTimeout` loop in the app process | Single machine, one schedule. A cron expression parser is not needed for "every 10 minutes". |
| pdfjs-dist | **unresolved — see below** | |

**PDF extraction is where this constraint genuinely bites.** Spec §6.2 requires
password-protected PDF support and §8.4 makes statement PDFs the historical spine for
Phase 3 (3.5 years of Indian card data). There is no Node built-in that decrypts and
text-extracts a PDF, and writing one is not a reasonable scope. When Phase 3 starts,
this needs an explicit decision from the owner: allow `pdfjs-dist`, or fall back to
spec §17's documented mitigation (CSV import as the fallback path). **Do not let this
be discovered in the middle of Phase 3.** Phases 1, 2, 4, 5, 6 are unaffected.

### 4.3 Owner-id column naming

Spec §3 says every table carries a nullable `account_owner_id`; spec §7.2 shows
`owner_id` on the entity listing. **Canonical is `owner_id`** — it is the name used in
the data model section, it is not account-scoped (a `manual_asset` has an owner but no
account), and `account_owner_id` on a table named `account` reads as a foreign key to
something else. Every table gets nullable `owner_id`.

### 4.4 `raw_messages` needs a `parsed_by` column

Spec §7 lists `raw_messages` but does not give its columns. Spec §8.3 requires
versioned parsers and re-parsing of history, which is only auditable if each row
records which parser version last touched it. `raw_messages` therefore carries
`parsed_by TEXT NULL` (the parser id, e.g. `in.sbi-card.txn-alert.v2`) and
`parsed_at TEXT NULL`. Re-parse selects on `parsed_by IS NULL OR parsed_by != <current>`.
