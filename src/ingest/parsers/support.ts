/**
 * Shared parser plumbing.
 *
 * The one rule encoded here: a field a parser needs is either found or it throws.
 * There is no `?? 0`, no `?? ''`, and no default amount anywhere in this layer. A
 * missing field means the template changed, and the correct response to a changed
 * template is a quarantined message, not a fact built out of fallbacks.
 */

import { FieldNotFoundError } from '../types'

/**
 * First capture group of `pattern` in `text`, or `FieldNotFoundError`.
 *
 * `hint` is written for whoever opens the quarantine queue a year from now, so it
 * says what the parser expected to see rather than restating the regex.
 */
export function requireField(
  parserId: string,
  field: string,
  pattern: RegExp,
  text: string,
  hint: string,
): string {
  const value = optionalField(pattern, text)
  if (value === null) throw new FieldNotFoundError(parserId, field, hint)
  return value
}

/** First capture group of `pattern` in `text`, or null when absent. */
export function optionalField(pattern: RegExp, text: string): string | null {
  const m = pattern.exec(text)
  if (!m) return null
  const captured = m[1]
  return captured === undefined ? null : captured.trim()
}

/**
 * Last-four digits, in the several phrasings issuers actually use.
 *
 * Returns null rather than throwing: some templates genuinely omit it, and the
 * persistence layer can still resolve the account from institution plus context.
 */
const LAST4_PATTERNS: readonly RegExp[] = [
  /\bending (?:in|with) (\d{4})\b/i,
  /\bending (\d{4})\b/i,
  /\bx{2,}[-\s]?(\d{4})\b/i,
  /\(\.{3}(\d{4})\)/,
]

export function findLast4(text: string): string | null {
  for (const pattern of LAST4_PATTERNS) {
    const found = optionalField(pattern, text)
    if (found !== null) return found
  }
  return null
}
