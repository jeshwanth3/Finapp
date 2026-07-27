/**
 * Transaction identity and statement reconciliation — design spec §7.3 / §7.4.
 *
 * SPEC CORRECTION (recorded here deliberately). §7.4 describes `dedupe_key` as a
 * hash that includes a "+/-3-day posted_date_bucket". That cannot work: a hash is an
 * exact-equality primitive, and two dates three days apart hash to different buckets
 * regardless of window size. Fuzzy matching cannot be expressed as a hash.
 *
 * The design is therefore split into two mechanisms that were conflated:
 *
 *   1. `dedupeKey` — EXACT identity of an *observation*. Re-importing the same email
 *      or re-parsing the same statement line produces the same key, so imports are
 *      idempotent. Crucially, two genuinely separate purchases that happen to be
 *      identical in content (same merchant, amount, and day) get different keys,
 *      because each came from a different source message. Content-hashing would
 *      silently merge them, understating spend in a way that looks correct.
 *
 *   2. `reconcile` — FUZZY matching between provisional alert rows and authoritative
 *      statement lines, over a date window and an amount-drift allowance. Produces a
 *      plan; it never mutates. Unmatched alerts are flagged for review rather than
 *      deleted, because an unmatched alert may be a real charge the statement parser
 *      missed, not a phantom.
 */

import { createHash } from 'node:crypto'
import { type Money } from './money'
import { merchantKey, type Region } from './descriptor'

export type SourceType = 'alert' | 'statement_pdf' | 'csv_import' | 'manual'

export interface Observation {
  /** Where this row came from. Statements outrank alerts. */
  sourceType: SourceType
  /** Stable reference to the source: an email message id, or a statement id. */
  sourceRef: string
  /** Index within a multi-fact source (statement line number). Defaults to 0. */
  ordinal?: number
  accountId: string
  /** ISO date, YYYY-MM-DD. */
  postedAt: string
  amount: Money
  descriptorRaw: string
  region?: Region
}

/**
 * Hash a list of components unambiguously.
 *
 * Each part is length-prefixed, so no separator can be forged by the data itself:
 * ["ab","c"] and ["a","bc"] yield different digests, where a naive delimiter join
 * would collide. A NUL separator would also work but puts a control character in
 * source files, which breaks tooling that expects text.
 */
function hashParts(parts: readonly string[]): string {
  return createHash('sha256')
    .update(parts.map((p) => `${p.length}:${p}`).join('|'))
    .digest('hex')
}

/**
 * Exact identity of an observation.
 *
 * Keyed on provenance — (sourceType, sourceRef, ordinal) — not on content. This is
 * what makes re-import idempotent while keeping identical-but-distinct purchases apart.
 */
export function dedupeKey(o: Observation): string {
  return hashParts([o.sourceType, o.sourceRef, String(o.ordinal ?? 0)])
}

/**
 * Content fingerprint — used for diagnostics and for spotting suspected duplicates
 * across *different* sources. Never used as identity.
 */
export function contentFingerprint(o: Observation): string {
  return hashParts([
    o.accountId,
    o.postedAt,
    String(o.amount.minor),
    o.amount.currency,
    merchantKey(o.descriptorRaw, o.region ?? 'US'),
  ])
}

const MS_PER_DAY = 86_400_000

function parseDate(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) throw new RangeError(`Expected ISO date YYYY-MM-DD, received ${JSON.stringify(iso)}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(parseDate(a) - parseDate(b)) / MS_PER_DAY
}

export interface Match {
  alert: Observation
  statementLine: Observation
  /** Lower is better. */
  score: number
  dateDeltaDays: number
  amountDeltaMinor: number
}

export interface ReconcilePlan {
  /** Alert rows confirmed by a statement line. The alert becomes superseded. */
  matched: Match[]
  /** dedupeKeys of the alerts in `matched`, for the UPDATE ... SET superseded_by. */
  supersededAlertKeys: string[]
  /** Alerts with no statement line. Flagged for review — never dropped. */
  unmatchedAlerts: Observation[]
  /** Statement lines no alert saw. Inserted as new authoritative rows. */
  unmatchedStatementLines: Observation[]
}

export interface ReconcileOptions {
  alerts: readonly Observation[]
  statementLines: readonly Observation[]
  /** Maximum posting delay to consider a match. Default 4 days. */
  windowDays?: number
  /**
   * Fraction of the alert amount by which the posted amount may differ.
   * Covers restaurant tips and fuel holds. Default 0 (exact match only).
   */
  amountDriftRatio?: number
}

interface Candidate {
  alertIndex: number
  lineIndex: number
  score: number
  dateDeltaDays: number
  amountDeltaMinor: number
}

/**
 * Build a reconciliation plan. Pure — computes, never mutates or persists.
 *
 * Matching is a stable greedy assignment over candidates ranked by (amount delta,
 * date delta, merchant agreement). Each alert claims at most one statement line and
 * each statement line is claimed at most once, so counts are conserved: every input
 * observation appears exactly once in the output.
 */
export function reconcile(opts: ReconcileOptions): ReconcilePlan {
  const { alerts, statementLines } = opts
  const windowDays = opts.windowDays ?? 4
  const driftRatio = opts.amountDriftRatio ?? 0

  const candidates: Candidate[] = []

  for (let ai = 0; ai < alerts.length; ai++) {
    const a = alerts[ai] as Observation
    for (let li = 0; li < statementLines.length; li++) {
      const l = statementLines[li] as Observation

      if (a.accountId !== l.accountId) continue
      if (a.amount.currency !== l.amount.currency) continue

      const dateDeltaDays = daysBetween(a.postedAt, l.postedAt)
      if (dateDeltaDays > windowDays) continue

      const amountDeltaMinor = Math.abs(l.amount.minor - a.amount.minor)
      const allowance = Math.abs(a.amount.minor) * driftRatio
      if (amountDeltaMinor > allowance) continue

      const merchantAgrees =
        merchantKey(a.descriptorRaw, a.region ?? 'US') ===
        merchantKey(l.descriptorRaw, l.region ?? 'US')

      // Lower score wins. Amount agreement dominates, then date proximity,
      // then merchant agreement as the tie-breaker.
      const score = amountDeltaMinor * 1000 + dateDeltaDays * 10 + (merchantAgrees ? 0 : 1)

      candidates.push({ alertIndex: ai, lineIndex: li, score, dateDeltaDays, amountDeltaMinor })
    }
  }

  // Deterministic ordering: score, then input order on both sides.
  candidates.sort(
    (x, y) => x.score - y.score || x.alertIndex - y.alertIndex || x.lineIndex - y.lineIndex,
  )

  const usedAlerts = new Set<number>()
  const usedLines = new Set<number>()
  const matched: Match[] = []

  for (const c of candidates) {
    if (usedAlerts.has(c.alertIndex) || usedLines.has(c.lineIndex)) continue
    usedAlerts.add(c.alertIndex)
    usedLines.add(c.lineIndex)
    matched.push({
      alert: alerts[c.alertIndex] as Observation,
      statementLine: statementLines[c.lineIndex] as Observation,
      score: c.score,
      dateDeltaDays: c.dateDeltaDays,
      amountDeltaMinor: c.amountDeltaMinor,
    })
  }

  const unmatchedAlerts = alerts.filter((_, i) => !usedAlerts.has(i))
  const unmatchedStatementLines = statementLines.filter((_, i) => !usedLines.has(i))

  return {
    matched,
    supersededAlertKeys: matched.map((m) => dedupeKey(m.alert)),
    unmatchedAlerts: [...unmatchedAlerts],
    unmatchedStatementLines: [...unmatchedStatementLines],
  }
}
