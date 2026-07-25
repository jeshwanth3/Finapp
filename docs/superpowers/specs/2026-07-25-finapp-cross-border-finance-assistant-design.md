# Finapp — Cross-Border Debt & Cash-Flow Assistant

**Design spec — 2026-07-25**

---

## 1. Summary

A personal finance assistant that reads your email to build a complete picture of your money across
two countries and two currencies — what you owe, what you own, what you're spending, and what your
investments have done. It tells you when payments will collide with your balance, and finds
recurring costs that are quietly growing.

No bank linking. No aggregator. It runs on data already sitting in your inbox.

**One sentence:** *It knows what you owe, when it's due, what happens to your checking balance if
you pay in the order you're planning, which subscriptions are repricing, and where you stand
overall — in both currencies, on your phone.*

**Running cost: $99/yr**, entirely the Apple Developer Program fee for the native iOS app (§3.1).
Every other component — data, storage, compute, the model, notifications, price feeds — is $0.
Drop the native app and the whole system runs free.

---

## 2. Problem and evidence

This design is grounded in a read-only survey of the owner's Gmail (last 90 days, plus targeted
history probes) conducted 2026-07-25. Findings, genericized:

**Financial surface.** Six credit accounts and one checking account across two countries:
four US card issuers, one US checking account, one US-issued cross-border card, and one Indian
credit card. Plus an Indian brokerage running monthly SIPs.

**The actual pain is timing, not overspending.** In July alone the inbox shows:

- Checking balance fell below the owner's own low-balance alert threshold twice.
- A ~$940 bill payment failed twice for insufficient funds, then succeeded on a third attempt.
- A $2,500 card payment cleared three days before one of those shortfalls.
- A ~$2,000 balance transfer was initiated mid-month.

That is a payment-sequencing problem against a thin buffer, not a discretionary-spending problem.
No existing product addresses it, and none of them span USD and INR.

**Email coverage is asymmetric.** Measured, not assumed:

| Source | Content | History | Merchant names |
|---|---|---|---|
| Indian card | Per-transaction alerts **+ monthly PDF statements** | Dec 2022 → now | Yes |
| Cross-border card | Monthly statement summaries + one multi-year PDF | Jul 2023 → now | In the PDF |
| US checking | Transaction alerts, Zelle w/ payee, e-statements | ~Sep 2025 → now | **No** |
| US cards (×4) | Statement balance, min due, due date, payments | ~10 months | **No** |

Two consequences drive the whole design:

1. **The India side has a complete merchant-level ledger going back 3.5 years**, which defeats
   every cold-start gate on day one.
2. **The US side has no merchant names** as currently configured — but it *does* have balances,
   due dates, minimum payments, payment amounts, and checking balance. Which is everything the
   debt-and-timing product needs.

**Retail receipts are negligible** — 12 order confirmations in 120 days, zero Amazon. Item-level
receipt enrichment is not a pillar of this product.

**Prerequisite task (owner):** enable per-transaction alerts at each US issuer with the threshold
at its minimum. This does not backfill history, but it starts the US merchant-level feed
accumulating immediately. Everything in Phase 3 depends on it.

---

## 3. Scope

**Who it's for:** the owner, on their own accounts. Single user.

**Built to scale, not built multi-user.** Auth, multi-tenancy, and per-user isolation are out of
scope for v1, but no design decision may make them unreachable. Concretely: every table carries a
nullable `account_owner_id` from day one, and no logic assumes a single owner.

**In v1** (expanded by owner decision, 2026-07-25): everything in §4, plus a **native mobile app**,
**net worth tracking**, **investment performance**, and **budgets**.

**Not in v1:** credit score, live bank linking (Plaid/aggregators), cancellation-on-your-behalf,
bill negotiation.

**Credit score is excluded on the merits, not deferred for effort.** Bureau access is a partnership
problem, and the Credit Repair Organizations Act prohibits charging in advance for services
represented to improve a consumer's credit — structurally incompatible with a subscription. Cutting
the score deletes an entire regulatory regime. If this ever goes multi-user, it stays cut. *This is
the one item the owner's "etc." was not taken to include; flag if that reading is wrong.*

### 3.1 Cost consequence of the mobile decision

The owner's stated constraint was zero recurring cost (D4). A **native iOS app breaks that**:

| Item | Cost | Avoidable? |
|---|---|---|
| Apple Developer Program | **$99/yr** | No — required to install on a physical iPhone beyond 7-day sideload |
| Google Play Console | $25 one-time | Yes, if Android isn't needed |
| EAS Build (cloud builds from Windows) | $0 on the free tier | Free tier is queue-limited, not feature-limited |

Everything else in this design remains $0. **The honest position: v1 now costs $99/yr, entirely
because of iOS.** Three ways to respond, owner's call:

1. **Pay the $99.** Real app, real push, home-screen presence.
2. **Android only** ($25 once) — but the owner carries an iPhone, so this is academic.
3. **Ship the installable PWA first, add the native shell when the intelligence is proven.**
   iOS 16.4+ gives an installed PWA real web push, which covers most of the gap at zero cost.

**This spec assumes (1)** — the owner asked for a mobile app in v1 and that is the deliverable.
The build order is nonetheless sequenced so that **the PWA works end-to-end before the native shell
is built** (§15), which keeps option 3 live at no extra cost if the $99 turns out not to be worth it.

---

## 4. Goals and non-goals

**Goals**

1. Never be surprised by a payment that overdraws the account.
2. Know the total owed, per account and in total, in both currencies, without opening six apps.
3. Catch subscription price increases and forgotten recurring charges.
4. Explain *why* a month changed, decomposed — not just that it did.
5. Track whether acting on a recommendation actually saved money.
6. **See net worth in one place** — assets minus liabilities, across both countries, with honest
   coverage gaps rather than a confident wrong number.
7. **Track investment performance** — units held, current value, invested cost, and return,
   for holdings the app can actually price.
8. **Budget by category**, with progress against the month and a projection of where the month lands.
9. **Reach the owner on their phone** — native app, real push notifications.

**Non-goals**

- Being a complete ledger. Email coverage is partial by nature; the app must be honest about gaps
  rather than pretending to completeness it doesn't have.
- **Investment advice of any kind.** Tracking performance is not advising on it. The app reports
  what holdings did; it never recommends buying, selling, holding, or reallocating, and it never
  projects future returns. This line is legal, not stylistic — crossing it moves the product into
  the Investment Advisers Act's perimeter.
- Beating Monarch or Copilot at generic spend dashboards.

---

## 5. Decision log

| # | Decision | Rationale |
|---|---|---|
| D1 | Personal-first, architected to scale | Real data is the only way to test insight quality; multi-tenant compliance is the least-evidenced part of the plan |
| D2 | Email as the primary rail | Only realtime channel available; sees trials, price hikes, and cancellation proof that bank data structurally cannot |
| D3 | File/PDF import as the historical spine | Defeats all cold-start gates; SBI PDFs give 3.5 years free |
| D4 | Zero recurring cost | Owner constraint. Costs little — the differentiator is arithmetic, not AI |
| D5 | Local-first, local model | Free and private converge on the same architecture |
| D6 | ~~PWA only~~ → **PWA first, then native app via Expo** *(revised 2026-07-25)* | Owner asked for a mobile app in v1. PWA still ships first so the intelligence is proven before $99/yr is spent |
| D7 | Dual-currency as a first-class concept | Not a flag. The owner's financial life is genuinely in two currencies |
| D8 | Statements are authoritative; alerts are provisional | Reconciliation rule that makes the two-source model coherent |
| D9 | No credit score, ever | See §3 |
| D10 | Net worth = **known** assets − **known** liabilities, with a visible coverage ratio | Email cannot see every asset. A confident wrong net worth is worse than an honest partial one |
| D11 | Investment valuation from free public NAV/price feeds | AMFI publishes daily NAV for every Indian mutual fund at no cost — the India side prices exactly, for free |
| D12 | Holdings reconstructed from transaction history, not scraped | SIP allocation emails carry scheme + units; accumulating them yields the position without a broker integration |
| D13 | Budgets are advisory, not blocking | Budget-shaming is the single best-documented cause of PFM abandonment. Budgets inform the projection; they never gate or nag |

**Reversal note.** D6 changed after the owner expanded scope. The original rationale — that the
unproven part of this project is insight quality, not app delivery — still holds, which is why the
native shell is sequenced last (§15) rather than first.

---

## 6. Architecture

Four layers, strictly ordered. Nothing above the canonical model knows where data came from;
nothing below it knows what the data means.

```
┌─ INGESTION ────────────────────────────────────────────────┐
│  IMAP poller → parser registry → raw_message store          │
│  PDF extractor (statements, incl. password-protected)       │
│  CSV/OFX importer (manual, when available)                  │
│  price feeds: AMFI NAV (daily, free) · FX rates (daily)      │
└──────────────────────────┬─────────────────────────────────┘
                           │  normalize at the edge, once
┌─ CANONICAL LEDGER ───────▼─────────────────────────────────┐
│  accounts · transactions · statements · balances             │
│  instruments · holdings · lots · valuations                  │
│  integer minor units + ISO-4217 · dedupe_key · provenance    │
└──────────────────────────┬─────────────────────────────────┘
                           │  deterministic arithmetic only
┌─ INSIGHT ENGINE ─────────▼─────────────────────────────────┐
│  debt map · due-date calendar · cash-flow simulator          │
│  recurring streams · price-step detection · fee ledger       │
│  MoM attribution bridge · commitments & realized savings     │
│  net worth (+ coverage ratio) · portfolio performance        │
│  budgets & month-end projection                              │
└──────────────────────────┬─────────────────────────────────┘
                           │  facts, never re-derived
┌─ DELIVERY ───────────────▼─────────────────────────────────┐
│  weekly digest (email) · PWA · native app (Expo) · push      │
│  Q&A (v1.1)                                                  │
└────────────────────────────────────────────────────────────┘
```

**One API, two clients.** The PWA and the native app are both thin clients over the same HTTP API.
No business logic lives in either. This is what makes the native shell a re-skin rather than a
rewrite — and what keeps option 3 in §3.1 available at zero cost.

### 6.1 Region portability

The canonical model is region-blind. Region-specific concerns sit behind adapters:

- **Ingestion adapters** — one parser module per (institution, message-template, version)
- **Merchant normalization dictionaries** — separate tables per region
- **Category taxonomy overlay** — shared core, regional extensions
- **Currency and locale** — per-account, never global

**Hard rule: no institution-specific field may exist above the ingestion boundary.** If a parser
wants to pass through something the canonical model doesn't have, either the model gains a
general-purpose field or the parser drops it.

### 6.2 Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 22+, TypeScript | One language across ingest, engine, and UI |
| App | Next.js (App Router) | PWA, API routes, and server jobs in one deploy |
| Database | SQLite via better-sqlite3, Drizzle ORM | Single-user, local, zero-config, trivially backed up |
| Email | `imapflow` + Gmail App Password | No OAuth verification, no 7-day token expiry |
| PDF | `pdfjs-dist` with password support | Indian statements are commonly password-protected |
| Jobs | `node-cron` in-process | Single machine, no queue needed |
| Local model | Ollama, 8–14B quantized | RTX 5070 Ti Laptop (12GB) handles this comfortably |
| **Mobile** | **Expo (React Native) + EAS Build** | Cloud builds work from Windows — no Mac, no Xcode. One codebase, both platforms |
| Phone access | Tailscale | Both clients reach the laptop anywhere, no port forwarding, no public exposure |
| **Price data** | **AMFI daily NAV file (free, public)**; FX from a free daily rates source | Prices every Indian mutual fund exactly, at zero cost |
| Digest delivery | Gmail SMTP to self | Free, reliable |
| Push (web) | Self-hosted VAPID web push | Free; iOS 16.4+ supports it for installed PWAs |
| Push (native) | Expo Push Service → APNs / FCM | Free; more reliable than iOS web push |

**Deferred alternative:** if laptop-uptime dependence becomes annoying, the always-on path is
Cloudflare Workers + D1 + Cron Triggers, with merchant adjudication batched to whenever the laptop
is awake. Not built in v1.

---

## 7. Data model

### 7.1 Money

**Money is `{ amount_minor: integer, currency: string }`. Always. No exceptions.**

- Integer minor units (cents, paise). Never floats. Never a bare number.
- ISO-4217 currency code on every monetary value.
- **Currency is never converted for storage.** Conversion happens at display time only, and every
  converted figure carries the rate and the rate's date.
- Totals across currencies are **not** summed by default. The UI shows per-currency subtotals; a
  combined figure requires an explicit, dated conversion the user can see.

### 7.2 Core entities

```
account
  id, owner_id (nullable), institution, kind, currency, region,
  display_name, last4_hint, is_active

transaction
  id, account_id, posted_at, amount_minor, currency,
  merchant_raw, merchant_id (nullable), category_id (nullable),
  direction (debit|credit), source, confidence, dedupe_key,
  superseded_by (nullable), categorization_version

statement
  id, account_id, period_start, period_end, statement_balance_minor,
  minimum_due_minor, due_date, currency, source_message_id,
  pdf_path (nullable), is_parsed

balance_observation
  id, account_id, observed_at, balance_minor, currency, source

merchant
  id, region, canonical_name, aliases[], category_id

recurring_stream
  id, account_id, merchant_id, cadence, expected_amount_minor,
  currency, first_seen, last_seen, status (candidate|mature|dormant|cancelled),
  confidence

price_change_event
  id, stream_id, effective_at, old_amount_minor, new_amount_minor,
  annualized_delta_minor, detected_from (statement|alert|announcement_email)

insight
  id, kind, generated_at, severity, title, body,
  evidence_transaction_ids[], evidence_message_ids[], is_dismissed

commitment
  id, insight_id, created_at, target_monthly_saving_minor, currency,
  status (open|kept|broken|expired), verified_at, actual_saving_minor
```

### 7.2.1 Assets, holdings, and valuation

```
asset_account
  id, owner_id (nullable), institution, kind (brokerage|checking|savings|
  retirement|manual), currency, region, display_name, is_active

instrument
  id, kind (mutual_fund|equity|etf|cash|manual_asset),
  region, currency, display_name,
  external_id, external_id_scheme (amfi_scheme_code|isin|ticker|null)

holding_lot
  id, asset_account_id, instrument_id, acquired_at,
  units, cost_minor, currency, source, source_message_id, confidence
    -- one row per purchase event. SIPs produce many small lots.

valuation
  id, instrument_id, as_of_date, price_minor, currency, source
    -- daily NAV / close price. Never overwritten; history is the point.

manual_asset
  id, owner_id (nullable), display_name, value_minor, currency,
  as_of_date, note
    -- anything email cannot see: property, cash, foreign accounts.
    -- Explicitly user-entered and clearly labelled as such in the UI.

budget
  id, owner_id (nullable), category_id, period (month),
  limit_minor, currency, is_rollover
```

**Holdings are reconstructed, not scraped.** SIP allocation emails carry scheme name, units
allocated, and date — accumulate them and the position falls out. No broker integration, no
credentials, no scraping.

**Instrument identity is the hard part.** Mapping a broker's display name (e.g. an email saying
"HDFC Large Cap Fund Direct") to an AMFI scheme code is a fuzzy-match problem with real consequences
— match the wrong scheme and the valuation is silently wrong. Rules:

- Matches are cached once resolved, and every cached match is user-confirmable.
- A low-confidence match **is not auto-applied**; the holding shows as unpriced until confirmed.
- An unpriced holding contributes its **cost basis** to net worth, never a guessed market value,
  and is flagged in the coverage ratio.

### 7.3 Provenance and reconciliation

Every transaction carries `source` ∈ `{alert, statement_pdf, csv_import, manual}` and a
`confidence` score.

**Statements are authoritative. Alerts are provisional.** When a statement covering period
[start, end] is parsed, every alert-sourced transaction in that window is matched against the
statement's line items:

- Matched → the alert row is marked `superseded_by` the statement row.
- Unmatched alert → flagged for review, not silently deleted. (It may be a pending charge that
  didn't post, or a parser bug.)
- Unmatched statement line → inserted as new.

This gives the best of both: alerts provide speed, statements provide truth, and the reconciliation
is explicit rather than a silent overwrite.

### 7.4 `dedupe_key`

`dedupe_key = hash(account_id, posted_date_bucket, amount_minor, currency, normalized_merchant)`

`posted_date_bucket` is a ±3-day window, because an alert fires at swipe time and a statement
records the posting date. Collisions inside the window are candidates for merge, not automatic
merges — the reconciliation rule above decides.

**This is the single highest-risk piece of the data layer.** Get it wrong and every number in the
app is inflated in a way that looks plausible during testing. It gets dedicated tests before
anything is built on top of it (§14).

---

## 8. Email ingestion

### 8.1 Connection

IMAP over TLS with a Google App Password. Poll every 10 minutes; use IMAP IDLE where the server
supports it for near-realtime.

Gmail API + Pub/Sub push is the faster path but requires an OAuth app in Testing mode with 7-day
refresh-token expiry. Not worth the friction at n=1. **Revisit if this goes multi-user** — at that
point OAuth with a CASA assessment becomes mandatory anyway.

### 8.2 Sender allowlist

Transactional and marketing mail come from **different subdomains** at every institution surveyed.
Allowlisting transactional subdomains eliminates roughly 70% of volume before parsing.

The allowlist lives in config, not code, and unknown senders that match financial heuristics are
logged to a review queue rather than dropped.

### 8.3 Parser registry

```
parser = {
  id, institution, region,
  match: (from, subject, body) => boolean,
  version: integer,
  extract: (message) => ParsedFact[]
}
```

`ParsedFact` is a discriminated union: `TransactionFact | StatementFact | BalanceFact |
PaymentFact | BillDueFact | SubscriptionFact | PriceChangeFact | CancellationFact`.

Rules:

- **Every raw message is stored** before parsing (`raw_message` table). Parsers can be re-run
  against history when a bug is fixed or a new fact type is added.
- **Parsers are versioned.** A template change produces parse failures, not silent wrong data.
- **Unparsed messages go to a quarantine queue**, surfaced in the UI. Never silently dropped.
- A parser that starts failing raises an alert in the digest — template drift must be visible.

### 8.4 PDF statements

Statement PDFs are the historical spine. The extractor:

1. Detects password protection; prompts once per institution and stores the password in the
   OS keychain (not in the database, not in config).
2. Extracts the transaction table plus the summary block (statement balance, minimum due,
   due date, period).
3. Emits `StatementFact` + a set of `TransactionFact` with `source = statement_pdf`.

**Verification gate:** for each institution, the sum of extracted line items must reconcile against
the statement's own stated total. A mismatch fails the import loudly rather than importing partial
data.

### 8.5 What email cannot do

Stated plainly because the UI must reflect it:

- Coverage is only what an institution chose to send, only if alerts are enabled, only as far back
  as they've been on.
- No balance visibility between statements except where an alert reports one.
- US merchant names are unavailable until per-transaction alerts are enabled (§2).

**The app displays a per-account coverage indicator** — what it knows, from when, and via which
source. Silent partial data is worse than visible gaps.

---

## 9. Insight engine

Every capability below is deterministic arithmetic over the canonical ledger. **No LLM is involved
in producing any number.**

### 9.1 Debt map and due-date calendar

Current balance, statement balance, minimum due, due date, and APR (where known) per account.
Rendered as a calendar, not a table — the question is "what's coming and when," not "what's the
list."

### 9.2 Cash-flow timing simulator — the core differentiator

Given known upcoming obligations (due dates + amounts), known recurring inflows (detected from
deposit alerts), and current checking balance, project the checking balance forward day by day.

Flag any projected point below a user-set floor. For each collision, compute the minimal change
that avoids it: move payment X from day N to day M, or pay the minimum on Y this cycle.

This is the feature that would have caught July's failed bill. It requires no merchant names, no
categorization, and no AI — just dated arithmetic.

**Honesty constraint:** projections are only as good as the inflow detection. Every projection
states its assumptions and flags low-confidence inputs inline.

### 9.3 Recurring-stream detection

Group by `(merchant_id, account_id)`. Two charges belong to the same stream if the amounts differ by
no more than `max(2% of the expected amount, the currency's per-account absolute floor)` — where the
floor is configured per account in that account's own currency (e.g. $1.00, ₹10). A single
cross-currency tolerance would be either uselessly loose in INR or uselessly tight in USD.

Test periods in **calendar space**, not day-gaps: same-day-of-month, same-weekday, last-business-day,
every-N-weeks. Day-gap models are where false negatives come from — a monthly charge lands 28–31
days apart and a naive gap model splits it into two streams.

Status ladder: `candidate` (2 occurrences) → `mature` (≥3) → `dormant` (missed 2 expected) →
`cancelled` (confirmed by a cancellation email).

Explicitly excluded: internal transfers, card payments, and habitual-but-not-recurring spend
(coffee three times a week is a habit, not a subscription).

### 9.4 Price-step detection

Step-change detection on each mature stream's amount series. On a confirmed step, emit a
`price_change_event` with the annualized delta.

Two sources, both used: the amount actually changing, and an announcement email arriving *before*
the change. The second is strictly better — it's a warning rather than a report.

### 9.5 Fee and interest leakage ledger

Trailing-12-month total of overdraft, NSF, returned-payment, ATM, foreign-transaction, and late
fees, plus revolving interest where APR is known. Itemized, with evidence transaction IDs.

Typically the single most persuasive number in an app like this, and it's pure SQL.

### 9.6 Month-over-month attribution bridge

Decompose the change in a category's spend:

```
Δtotal = Σ Δmerchant
Δmerchant = volume_effect + price_effect
  volume_effect = (n − n_prev) × avg_prev
  price_effect  = (avg − avg_prev) × n
plus: new merchants, lapsed merchants, calendar effect
```

Calendar effect covers five-Friday months and three-paycheck biweekly months — a real and
frequently-misattributed source of month-over-month noise.

Available on the India side immediately (merchant data exists). Available on the US side once
per-transaction alerts have accumulated.

### 9.7 Commitments and the realized-savings ledger

When an insight proposes an action, the user can accept it as a commitment with a target monthly
saving. The following month, the engine checks whether spend in the relevant scope actually fell,
and records the realized amount.

**Hard and soft savings are tracked separately and never summed into one headline.** Cancelling a
$12/mo subscription is contractual; capping food delivery is behavioral. Merging them produces a
number that reads as dishonest the moment anyone checks it.

Cancellation confirmation emails, where present, upgrade a realized saving from *inferred* to
*verified*.

### 9.8 Net worth

```
net_worth = Σ known assets − Σ known liabilities     (per currency)
```

**Liabilities are already solved** — that's the debt map (§9.1), and email coverage there is good.
**Assets are the weak side**, and the design's job is to be honest about it rather than to guess.

Asset sources, in descending confidence:

| Source | Confidence | Notes |
|---|---|---|
| Balance observed in a statement | High | Dated, authoritative |
| Balance from a low-balance / transaction alert | Medium | Point-in-time, may be stale |
| Priced holding (NAV × units) | High | Exact, where the instrument mapped |
| Unpriced holding | Low | Contributes cost basis only |
| Manual asset | User-asserted | Clearly labelled as such |

**The coverage ratio is a first-class output, displayed next to the number.** It states what fraction
of known accounts have a balance observation newer than N days, and lists what's stale or missing.

**Hard rule: net worth is never shown as a bare figure.** It always appears with its as-of date and
coverage ratio. A net worth that silently omits a stale account is the single easiest way for this
app to be confidently wrong, and confidently wrong is worse than visibly incomplete.

Net worth is tracked over time (one snapshot per day), because the trend is more useful than the
level — and the trend is robust to coverage gaps in a way the level is not.

### 9.9 Investment performance

Per instrument and per portfolio, all deterministic:

```
units          = Σ lot.units
cost_basis     = Σ lot.cost_minor
market_value   = units × latest_valuation.price_minor
absolute_return = market_value − cost_basis
simple_return   = absolute_return / cost_basis
```

Because SIPs are irregular contributions over time, a simple return is misleading on its own.
The engine also computes **XIRR** (money-weighted return) over the lot cash-flow series, which is
the correct measure for a contribution schedule and is what Indian brokerages themselves report.

Presentation rules:

- **Report, never advise.** No buy/sell/hold language, no "consider rebalancing", no projections
  of future return. See §4 non-goals — this is a legal boundary, not a stylistic one.
- Returns are reported **in the instrument's own currency**. A cross-currency portfolio return is
  shown only with an explicit, dated FX basis, because currency movement will otherwise dominate
  and silently misattribute the result.
- Every figure drills through to the contributing lots.

**US-side coverage is currently zero** — the inbox survey found no US brokerage or retirement
correspondence. Either those accounts don't exist or their mail goes elsewhere. See §18.

### 9.10 Budgets

Per category, per month, in the account's currency. Optional rollover of unused amounts.

The useful output is not "you have spent 68% of dining" — it's the **projection**: given elapsed
days, observed run-rate, and known recurring charges still to land, where does this category
finish the month? That is the number that permits action while action is still possible.

**Budgets are advisory (D13).** They inform the projection and the digest. They never block, never
nag, and never appear as a red failure state. Budget-shaming is among the best-documented causes of
PFM abandonment, and this app's whole thesis is that it stays useful past week two.

---

## 10. Multi-currency

- Every account has one currency. Every transaction inherits it.
- Cross-currency transactions on a single card (the Indian card charges in USD and AUD as well as
  INR) store the **billed** amount and currency, plus the original amount/currency where the alert
  provides both.
- Rates are fetched daily from a free source, stored dated, and never back-applied. A figure
  converted last month keeps last month's rate.
- The default view is **per-currency**. A combined view exists but is explicitly labelled with the
  rate and date used.

---

## 11. Categorization

Ordered pipeline, cheapest first:

1. **Deterministic descriptor scrub** — strip processor prefixes, store numbers, trailing digits.
2. **Curated prefix table** (~200 rows, region-specific) — `SQ *`, `TST*`, `PY *`, `UPI/`,
   `PAY*`, `RAZ`, etc.
3. **Alias cache** — a descriptor resolved once is never resolved again.
4. **Local model adjudication** — the long tail only. Result written back to the alias cache.
5. **User correction** — always wins, always persisted, always retroactive to matching descriptors.

**Before building anything downstream: hand-label 300 descriptors and measure accuracy.** Every
feature that keys on `merchant_id` inherits this layer's error rate, and without a labelled set
there is no way to know what it is.

---

## 12. The assistant layer

### 12.1 What the model is allowed to do

Exactly three things:

1. Adjudicate ambiguous merchant identity on the long tail.
2. Narrate facts the engine has already computed.
3. (v1.1) Map a natural-language question to a typed call against a fixed metrics API.

**What it is never allowed to do: produce a number.** Every figure in every message originates from
the deterministic engine.

### 12.2 Numeric guardrail

Before any generated prose is rendered, extract every currency figure and percentage via regex and
assert set-membership against the computed fact pack that was passed in. A mismatch is an internal
error and the message is not sent.

~40 lines. Converts a shipped wrong number into a caught bug.

### 12.3 Model choice

**v1: local only.** Ollama, an 8–14B quantized model. Merchant adjudication is an easy task and
narration from a structured fact pack is well within range. Zero cost, nothing leaves the machine.

**v1.1 (optional):** open-ended conversational Q&A is the one place a frontier model would earn a
few dollars a month. If that's ever wanted, the current Claude API options are:

| Model | ID | Input / Output per MTok |
|---|---|---|
| Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 |
| Sonnet 5 | `claude-sonnet-5` | $3 / $15 (introductory $2 / $10 through 2026-08-31) |
| Opus 5 | `claude-opus-5` | $5 / $25 |

At personal scale — a weekly digest plus occasional questions over pre-computed fact packs — this
would be low single-digit dollars per month. **It is explicitly not in v1**, and the free build
must never depend on it.

---

## 13. Delivery

### 13.1 Weekly digest — the primary surface

Email, sent to self via SMTP. Structure:

1. **What's coming** — next 14 days of obligations against projected balance. Collisions first.
2. **What changed** — attribution bridge, top three movers only.
3. **What's leaking** — new recurring charges, price increases, fees incurred.
4. **Where you stand** — net worth with its as-of date and coverage ratio; movement since last week.
5. **Budgets on track to miss** — projection-based, only categories heading over. Silent otherwise.
6. **How last month's commitments went** — kept, broken, or verified.

Investment performance is **not** in the weekly digest. Portfolio value is noisy week to week, and
surfacing it weekly invites exactly the reactive behavior §4 rules out. It lives in the app, and
appears in a monthly summary.

**Notification budget is the scarcest resource in this product.** Every push must clear the bar:
*did this tell me something I didn't know, that I can act on?* Failing that bar twice gets the app
muted forever. Three correct notifications a week beat daily noise.

### 13.2 Clients

Both clients are thin views over the same HTTP API (§6). Screens: **Today** (obligations + safe-to-spend),
**Debt**, **Net worth**, **Investments**, **Budgets**, **Insights**.

- **PWA** — installable, offline-capable read view, Tailscale-reachable. Ships first (§15).
- **Native app (Expo)** — same screens, real push, home-screen presence, biometric unlock.
  Built from the same API once the PWA has proven the intelligence.

**Every insight drills through to its evidence transactions or lots — if the UI can't drill in, the
insight doesn't ship.** This applies equally to net worth (which accounts, observed when) and to
returns (which lots, priced at what NAV).

### 13.3 Push

Web push (VAPID) for the PWA; Expo Push Service → APNs for the native app.

Reserved for genuine time-sensitivity: a projected shortfall inside 72 hours, a failed payment, a
free trial converting, a detected price increase.

**Portfolio movement never triggers a push.** Not at any threshold. A notification about a
falling balance is actionable; one about a falling NAV is an invitation to do something unwise, and
this app does not give investment advice — including by implication, through what it chooses to
interrupt you about.

---

## 14. Testing

Test-driven throughout. Priority order reflects risk, not convenience:

1. **`dedupe_key` and reconciliation** — the highest-risk logic in the system. Golden fixtures
   covering: alert→statement match, alert with no statement match, statement with no alert,
   same-amount-same-day distinct charges, pending→posted amount drift.
2. **Parsers** — one fixture per (institution, template, version), built from real emails with
   identifiers redacted. A parser without a fixture doesn't ship.
3. **PDF extraction** — reconciliation against the statement's own stated total is the assertion.
4. **Recurring detection** — synthetic streams for each cadence, plus adversarial cases:
   amount drift, skipped month, merchant rename, two subscriptions to the same merchant.
5. **Cash-flow projection** — replay July 2026 from real data and assert the app flags the
   collision that actually happened.
6. **Numeric guardrail** — property test: generated prose containing a figure not in the fact pack
   must always be rejected.
7. **Currency** — no test may pass if any monetary value is stored as a float or summed across
   currencies without an explicit dated rate.
8. **Net worth honesty** — property test: for any dataset with a stale or missing balance, the
   rendered output must carry a coverage ratio below 1.0 and name what's missing. A bare figure is
   a test failure.
9. **Investment math** — XIRR verified against known cash-flow series with published answers;
   units reconstructed from SIP emails asserted equal to a real broker statement; an unpriced
   instrument must contribute cost basis and never a guessed market value.
10. **Budget projection** — replay closed months and assert the projection beats naive linear
    extrapolation, particularly on months containing known recurring charges yet to land.

Test data uses redacted fixtures committed to the repo. **Real account identifiers and balances
never enter version control.**

---

## 15. Build order

| Phase | Deliverable | Gate |
|---|---|---|
| **0** | Enable per-transaction alerts at all US issuers *(owner task, do first)* | Merchant feed starts accumulating |
| **1** | Canonical schema, money type, `dedupe_key`, reconciliation, test harness | Golden fixtures green |
| **2** | IMAP poller, raw store, parser registry, parsers for all 7 institutions, quarantine queue | Every surveyed message type parses or is visibly quarantined |
| **3** | PDF statement extraction (India + cross-border), historical backfill | Line items reconcile to stated totals; 3.5 years loaded |
| **4** | Debt map + due-date calendar + **cash-flow timing simulator** | Replays July 2026 and flags the real collision |
| **5** | Recurring streams, price-step detection, fee ledger | Finds the known subscriptions without being told |
| **6** | Weekly digest email + PWA read view with drill-through | Digest sends; every insight drills to evidence |
| **7** | **Net worth** — balance observations, manual assets, coverage ratio, daily snapshot | Number never renders without as-of date + coverage |
| **8** | Attribution bridge (India first), commitments, realized-savings ledger | Bridge reconciles: Σ effects = Δtotal, exactly |
| **9** | **Investments** — Groww SIP parser, instrument mapping, AMFI NAV feed, lots, XIRR | Reconstructed units match a broker statement exactly |
| **10** | **Budgets** — limits, run-rate projection, digest integration | Projection beats naive linear extrapolation on replayed months |
| **11** | Local-model merchant adjudication + narration + numeric guardrail | Guardrail rejects every injected bad figure |
| **12** | **Native app (Expo)** — same API, real push, biometric unlock | Ships to the owner's iPhone via TestFlight |

**Phase 4 is the earliest point the app is genuinely useful.** Everything before it is foundation;
everything after compounds.

**Phase 12 is deliberately last.** The $99/yr (§3.1) is committed only after the PWA has proven the
insights are worth carrying in a pocket. If phases 4–11 don't clear the kill test (§16), the native
app would be a well-built shell around something not worth opening — and the money is unspent.

---

## 16. Success criteria

**Kill test — write it down before starting.** Within 14 days of running against the full
historical import, the app must surface **either**:

- ≥ $300/yr of recurring cost, price increases, or fees the owner did not already know about, **or**
- ≥ 1 payment-timing collision it would have prevented.

If it clears neither, the premise is wrong for a financially attentive user, and the product is for
someone less attentive — which changes the design.

**Sustained success (90 days):** the weekly digest is opened most weeks, and at least one
commitment has been recorded as kept with a verified saving.

---

## 17. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Email template drift breaks a parser silently | **High** | Versioned parsers; parse-failure alerts in the digest; raw messages retained for re-parse |
| `dedupe_key` over- or under-merges | **High** | Dedicated golden fixtures before anything is built on top; statement reconciliation as the correction mechanism |
| US merchant data never accumulates (alerts not enabled) | **Medium** | Phase 0 gates the build; attribution degrades gracefully to India-only |
| PDF passwords or format defeat extraction | **Medium** | Verify one statement opens before Phase 3; CSV import as the fallback path |
| Cash-flow projection is wrong because inflow detection is weak | **Medium** | Projections state assumptions inline; low-confidence inputs flagged; manual override for known income |
| Laptop-uptime dependence makes sync unreliable | **Low** | Cloudflare Workers + D1 path documented in §6.2 |
| Local model too weak for merchant adjudication | **Low** | Deterministic table handles the bulk; adjudication is the tail only; user correction always wins |
| **Net worth is confidently wrong** because an asset is stale or invisible | **High** | Coverage ratio mandatory and rendered inline; trend emphasised over level; manual assets explicitly labelled |
| **Instrument mis-mapping** silently misprices a holding | **High** | Low-confidence matches never auto-applied; unpriced holdings show cost basis only and are flagged |
| Scope expansion delays the useful core past the point of interest | **Medium** | Phases 1–6 unchanged and still deliver the differentiator; everything new is sequenced after |
| $99/yr Apple fee spent on an app that isn't worth opening | **Medium** | Native shell is Phase 12, after the kill test; PWA path stays viable at $0 |
| Groww email format changes and holdings stop accumulating | **Medium** | Same versioned-parser + quarantine discipline as every other parser (§8.3) |
| AMFI feed format changes or moves | **Low** | Single well-known public file; failure is loud (no NAV → unpriced → flagged), never a wrong price |

---

## 18. Open questions

1. **Are the Indian statement PDFs password-protected, and does the owner have the password?**
   Phase 3 depends on it. Unverified as of this writing.
2. **Is there any usable US transaction history before ~Sep 2025?** If a CSV export becomes
   available later, the importer should accept it — the schema already supports it.
3. **Does the owner hold any US investments or retirement accounts?** The inbox survey found no US
   brokerage or retirement correspondence at all. If they exist, either the mail goes elsewhere or
   e-delivery is off — Phase 9's US coverage depends on the answer.
4. **Which assets does email genuinely never see?** Property, cash, foreign accounts, employer
   equity. These need the manual-asset path (§7.2.1); the owner should enumerate them once so the
   coverage ratio is meaningful from day one.
5. **Is the $99/yr Apple Developer fee accepted?** §3.1. This spec proceeds as though it is, but the
   build order defers the commitment to Phase 12 so the decision can be made late.
6. **Does "etc." include the credit score?** This spec reads it as *not* including it, for the CROA
   reason in §3. Confirm or overturn.
7. **Should the digest be weekly or twice-weekly?** Start weekly; let observed usage decide.
