# Conventions

Rules that apply to every file in `src/`. Where a rule exists because of a specific
failure mode in *this* product, the failure mode is stated — a rule without a reason
gets negotiated away in review.

---

## 1. Naming

### Files

- **Modules:** `kebab-case.ts` — `money.ts`, `cash-flow.ts`, `us-chase-txn-alert.v1.ts`.
- **React components:** `PascalCase.tsx`, one component per file, named the same as
  the file — `Money.tsx` exports `Money`, `Nav.tsx` exports `Nav`.
- **Tests:** `<source>.test.ts`, sitting next to the source. `money.ts` /
  `money.test.ts`. Never a parallel `__tests__/` tree — a test that is not adjacent to
  its subject is a test that gets forgotten when the subject moves.
- **Parsers:** `<region>-<institution>-<template>.v<n>.ts`, all lowercase, e.g.
  `in-sbi-card-txn-alert.v2.ts`. The version is in the filename because both versions
  coexist forever (see ARCHITECTURE.md §2).
- **Fixtures:** `src/ingest/parsers/__fixtures__/<parser-id>/<case>.eml` and
  `<case>.expected.json`.

### Exports

- **Named exports only.** No `export default`, including in `src/core`, `src/db`,
  `src/engine`, `src/ingest`. (Next.js route and page files are the sole exception —
  the framework requires a default export from `src/app/**/page.tsx` and `layout.tsx`.)
  Named exports are greppable, and greppable is how the dependency rule gets audited.
- **No barrel re-export files** except the two registries that exist to be extended:
  `src/ingest/parsers/index.ts` and `src/engine/insights/index.ts`.

### Identifiers

| Kind | Style | Example |
|---|---|---|
| Function, variable | `camelCase` | `fromDecimalString`, `unmatchedAlerts` |
| Type, interface, class | `PascalCase` | `Observation`, `ReconcilePlan`, `CurrencyMismatchError` |
| Module-level constant | `SCREAMING_SNAKE` | `PROCESSOR_PREFIXES`, `MS_PER_DAY`, `DEFAULT_EXPONENT` |
| Database column | `snake_case` | `posted_at`, `amount_minor`, `superseded_by` |
| Parser / insight id | `dot.kebab.v<n>` | `in.sbi-card.txn-alert.v2`, `cash-flow-collision` |

- **No abbreviations that aren't already domain terms.** `NAV`, `XIRR`, `APR`, `SIP`,
  `UPI`, `FX`, `IMAP` are fine — they are what the domain calls these things.
  `txn` is fine in parser ids only. `amt`, `bal`, `acc`, `msg` are not.
- **No `I`-prefixed interfaces, no `T`-prefixed types.**
- **Booleans read as assertions:** `isActive`, `isDismissed`, `isParsed`, `hasEvidence`.
  Not `active`, not `dismissedFlag`.
- **Dates in variables and columns are ISO strings** (`YYYY-MM-DD` for dates,
  RFC 3339 UTC for instants), never `Date` objects in the ledger and never epoch
  numbers. `Observation.postedAt` is `'2026-07-26'`. A `Date` carries a timezone the
  ledger does not have and does not want.

---

## 2. Money

**The rule: money is never a bare number.** Spec §7.1. This is the single convention
that, if broken, produces numbers that look right for months.

```ts
import { money, fromDecimalString, add, sum, type Money } from '@/core/money'
```

- **Every monetary value is a `Money`** — `{ minor: integer, currency: string }`.
  Function parameters, return types, `ParsedFact` fields, engine outputs, component
  props. `Money.tsx` deliberately has no prop for rendering a bare number.
- **In the database, money is a column *pair*:** `amount_minor INTEGER NOT NULL` plus
  `amount_currency TEXT NOT NULL`. Never one column. A single `amount` column is how a
  USD figure ends up displayed as INR eighteen months later with nothing in the schema
  to catch it. The naming convention is `<name>_minor` / `<name>_currency`:
  `statement_balance_minor` / `statement_balance_currency`, `limit_minor` /
  `limit_currency`.
- **Never convert for storage.** Conversion is display-time only, and every converted
  figure carries its rate and the rate's date (spec §7.1, §10). A figure converted last
  month keeps last month's rate — rates are never back-applied.
- **Never sum across currencies.** `add`, `subtract`, `compare`, and `sum` throw
  `CurrencyMismatchError` by design. Do not catch it to "handle" mixed currencies;
  the correct handling is per-currency subtotals, which is what the UI shows.
- **Parse with `fromDecimalString`, not `parseFloat`.** It handles what real
  institution emails actually contain — `$2,709.80`, `Rs.35,882.00`, `(45.23)`,
  Indian lakh grouping `1,08,244.50` — and it **throws** when there are more decimal
  places than the currency has, rather than rounding. That throw is a wrong-currency
  detector. Do not suppress it.
- **Scale with `scale(m, factor)`.** The attribution bridge (spec §9.6) and budget
  projections (§9.10) multiply money by ratios. `scale` rounds half-away-from-zero and
  returns integer minor units. `m.minor * 0.02` returns a float and is a bug.

### The no-floats rule

**No floating-point value may exist in the money path — construction, storage,
arithmetic, or transport.**

- `money()` throws `NotAnIntegerError` on a fractional minor unit. Do not work around
  it with `Math.round()` at the call site; find where the float came from.
- SQLite columns holding money are `INTEGER`. A `REAL` column in a migration is a
  review blocker.
- JSON on the wire carries `{ "minor": 270980, "currency": "USD" }`, never `2709.80`.
- Floats are legitimate in exactly three places, none of which are amounts:
  **ratios** (`amountDriftRatio`, `coverageRatio`, `confidence`), **rates**
  (`aprPercent`, FX rates — stored with their own precision discipline), and
  **XIRR's root-finding** (spec §9.9), whose *output* is a rate, not an amount.
  Everything XIRR consumes and every amount derived from a rate is `Money`.

---

## 3. Error handling

### Named error classes

Every failure mode that a caller might reasonably distinguish gets its own class,
with a message that says what to do. The pattern is established in `src/core/money.ts`:

```ts
export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(
      `Refusing to combine ${a} and ${b}. Cross-currency arithmetic requires an ` +
        `explicit dated exchange rate — see fx.ts. Storage never converts.`,
    )
    this.name = 'CurrencyMismatchError'
  }
}
```

Requirements:

- `extends Error`, exported from the module that throws it.
- `this.name` set explicitly — subclass names do not survive minification otherwise,
  and the digest's parse-failure report is read as text.
- The message states **the offending value and the correct action**, not just the
  category. `NotAnIntegerError` says "a float entered the money path"; that sentence is
  the debugging session.
- Never `throw new Error('...')` for a condition a caller could branch on. Never throw
  a string, a number, or an object literal.

Existing classes, for reference and reuse:
`NotAnIntegerError`, `CurrencyMismatchError`, `InvalidCurrencyError`, `MoneyParseError`.

### No silent catch

**A `catch` block that neither rethrows, nor returns a value the caller can detect,
nor records the failure somewhere a human sees, is prohibited.** This includes
`catch {}`, `catch (e) { /* ignore */ }`, and `catch (e) { console.error(e) }` in a
path whose caller then proceeds as if nothing happened.

This matters more here than in most codebases because of spec §17's top risk: *email
template drift breaks a parser silently*. The whole quarantine design (spec §8.3 —
unparsed messages go to a review queue, never dropped; a failing parser raises an
alert in the digest) is defeated by one swallowed exception in the ingestion loop.

Legitimate patterns:

```ts
// 1. Rethrow as a domain error with context added.
try {
  return fromDecimalString(raw, currency)
} catch (cause) {
  throw new ParserFieldError(parserId, 'amount', raw, { cause })
}

// 2. Record to quarantine and continue the batch — the failure is durable and visible.
const result = tryParse(msg)
if (!result.ok) {
  await parseFailures.record({ messageId: msg.id, parserId, reason: result.reason })
  continue
}

// 3. A genuine, documented fallback. There is exactly one in the codebase today:
//    money.ts format() falls back to a plain rendering for an unknown ISO code,
//    because the fallback still shows the correct amount and the correct currency.
//    Note that it is annotated with WHY, and that nothing is lost.
```

Anything else is a review blocker. If you cannot state what the caller does with the
failure, you have not handled it.

### `noUncheckedIndexedAccess`

`tsconfig.json` sets `strict: true` **and** `noUncheckedIndexedAccess: true`. Array and
record indexing returns `T | undefined`. Handle it honestly:

```ts
// Preferred — iterate, don't index.
for (const m of amounts) { total += m.minor }

// Preferred — check.
const first = parts[0]
if (first === undefined) throw new MoneyParseError(input, code, 'empty')

// Acceptable where a loop bound or a prior regex match makes it provably present.
// reconcile.ts uses this form inside `for (let ai = 0; ai < alerts.length; ai++)`.
const a = alerts[ai] as Observation
```

**Never use `!` (non-null assertion) or `as any` to silence it.** `as T` on a
provably-present index is tolerated in tight loops; `!` is not, because it is
invisible in review.

### Banned constructs

- `any` — including `as any`, `catch (e: any)`, and `Record<string, any>`. Use
  `unknown` and narrow. `catch (cause)` is already `unknown` under `strict`.
- `@ts-ignore` / `@ts-expect-error` outside a test that is deliberately asserting a
  type error.
- `TODO`, `FIXME`, `XXX`. If it needs doing, it is an issue or it is done. A `TODO`
  in a money path is a defect with a comment on it.
- `console.log` in `src/core`, `src/db`, `src/engine`, `src/ingest`. Logging goes
  through the app-layer logger, which enforces the redaction rules in
  [SECURITY.md](./SECURITY.md) §3.
- `process.env` reads outside `src/app`. Config is passed in; a pure layer that reads
  the environment is no longer pure and no longer testable.

---

## 4. Testing conventions

Full strategy in [TESTING.md](./TESTING.md). The conventions:

- **Vitest, `*.test.ts`, adjacent to the source.** `vitest.config.ts` globs
  `src/**/*.test.ts` in the `node` environment.
- **No globals** — import `describe`, `it`, `expect` from `vitest` explicitly.
  `vitest.config.ts` does not enable `globals`.
- **Test names are sentences that state the rule, not the mechanism.**
  `it('keeps two identical charges on the same day distinct')`, not `it('dedupeKey works')`.
  When a test fails at 2am the name is the whole bug report.
- **Assert on `Money` values, not on formatted strings.**
  `expect(total).toEqual(money(270980, 'USD'))`. A string assertion passes when the
  currency is wrong and the locale happens to match.
- **Every error path gets a test.** If a named error class exists, something throws it
  in a test. An untested throw is a throw that gets softened into a `catch {}` later.
- **No network, no filesystem writes, no clock reads in unit tests.** Pass the as-of
  date in. `src/app/page.tsx` already takes this shape (`daysUntil(iso, from = '2026-07-26')`).
- **Fixtures are data files, not inline blobs**, once they exceed a few lines — see
  TESTING.md §2 for the shape and the redaction requirement.

---

## 5. Comments

**Comments explain WHY. Never WHAT.** The code says what it does; if it doesn't, fix
the code rather than annotating it.

Write a comment when:

- **A decision could plausibly have gone the other way**, and someone will want to
  "simplify" it. `money.ts`: *"Normalise -0 to 0. Negative zero survives arithmetic,
  serialises as `-0` in JSON, and makes `Object.is` comparisons fail."*
- **The code deviates from the spec.** `reconcile.ts` opens with a `SPEC CORRECTION`
  block explaining why §7.4's ±3-day hash cannot work. Deviations are documented at
  the point of deviation *and* in ARCHITECTURE.md §4.
- **A constraint is non-obvious and load-bearing.** `descriptor.ts`: *"Deliberately
  lossy and deliberately deterministic: the same input always yields the same output,
  because this value is a component of transaction identity."*
- **A regex or a table needs an example.** `descriptor.ts` heads its module with four
  worked input→output examples. That block is worth more than the function bodies.

Do not write:

```ts
// Add a and b                      <- says WHAT
// Loop over the accounts           <- says WHAT
// TODO: handle INR                 <- banned
// eslint-disable-next-line         <- there is no linter; this is noise
```

Module-level doc comments are expected on every file in `src/core`, `src/db`,
`src/engine`, and every parser: what this module is responsible for, which spec
section governs it, and any non-obvious invariant it maintains. Reference spec
sections by number (`spec §9.8`) — they are stable and greppable.

---

## 6. Database conventions

- **Migrations are numbered SQL files applied in order**, never edited after they are
  applied: `src/db/migrations/0001-initial.sql`. There is no ORM and no migration
  generator (see ARCHITECTURE.md §4.2), so the file *is* the schema history.
- **Every table has nullable `owner_id TEXT NULL`** from day one (spec §3). No query
  may assume a single owner, and none may filter on `owner_id` yet.
- **Money is a column pair** (§2 above). `INTEGER` + `TEXT`. Never `REAL`.
- **Dates are `TEXT` in ISO form**, so lexicographic ordering is chronological
  ordering. No integer epochs, no SQLite date functions in application queries.
- **`dedupe_key TEXT NOT NULL UNIQUE`** on `transactions`. The UNIQUE constraint is
  the last line of defence behind `reconcile.ts`; do not drop it to make an import
  "work".
- **Nullable columns are nullable for a stated reason.** `merchant_id`, `category_id`,
  `superseded_by`, and `pdf_path` are nullable because the spec says the data may
  genuinely be absent. Nothing else gets to be nullable by default.
- **Repositories return domain types, not rows.** A repository in `src/db` maps
  `amount_minor` + `amount_currency` into a `Money` at the boundary. No caller outside
  `src/db` ever sees a `_minor` field.
