/**
 * Confidence is a first-class output of every engine computation.
 *
 * Design spec §9.2 makes this a hard requirement rather than a nicety: "projections
 * are only as good as the inflow detection. Every projection states its assumptions
 * and flags low-confidence inputs inline." A number without its provenance is the
 * failure mode this whole app exists to avoid.
 *
 * The scale is deliberately three-valued. A numeric score invites arithmetic on it
 * ("average confidence 0.72"), which is meaningless — combining a high-confidence
 * statement balance with a low-confidence inferred payroll does not produce a
 * medium-confidence result, it produces a result that is only as good as its worst
 * input. Hence `weakest`, never `average`.
 */

export type Confidence = 'high' | 'medium' | 'low'

const RANK: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 }

export function confidenceRank(c: Confidence): number {
  return RANK[c]
}

/** The confidence of a derived figure is the confidence of its weakest input. */
export function weakestConfidence(values: readonly Confidence[]): Confidence {
  let worst: Confidence = 'high'
  for (const v of values) {
    if (RANK[v] < RANK[worst]) worst = v
  }
  return worst
}

/** Deterministic ordering helper: sorts low first. */
export function compareConfidence(a: Confidence, b: Confidence): number {
  return RANK[a] - RANK[b]
}
