/**
 * Transactional-sender allowlist — the first gate of the ingest pipeline.
 *
 * Banks send two completely different kinds of mail from two completely different
 * places. Alerts and statements come from a dedicated transactional subdomain;
 * card offers, balance-transfer promotions and "you're pre-approved" come from a
 * marketing subdomain, and the marketing mail is *full of dollar amounts*:
 *
 *   no.reply.alerts@chase.com        -> "Your statement balance is $2,709.80"
 *   chase@mcmap.chase.com            -> "Transfer a balance of up to $15,000"
 *
 * A parser handed the second one produces a fifteen-thousand-dollar debt that does
 * not exist. So the allowlist is a hard gate in front of every parser, and its
 * single most important property is:
 *
 *   **Domains are matched by EXACT equality, never by suffix.**
 *
 * Suffix matching is the bug. Allowing "chase.com" as a suffix admits
 * "mcmap.chase.com"; allowing "sbicard.com" admits "offers.sbicard.com". Every
 * marketing address this project has seen would sail through a `endsWith` check and
 * be stopped by an `===` check, so `===` is what this module does.
 *
 * Localparts are additionally pinned on *shared* apex domains (chase.com,
 * sbicard.com, zolve.com), where transactional and marketing mail live side by side.
 * On dedicated transactional subdomains the localpart is left open, because issuers
 * rotate it ("usbank@", "alerts@", "no-reply@") without changing the subdomain, and
 * pinning it there would reject real alerts for no safety gain.
 */

import { type Region } from '@/core/descriptor'

/** A domain the pipeline will accept mail from, and what it means. */
export interface SenderRule {
  /** Institution name as it should appear on facts. */
  readonly institution: string
  readonly region: Region
  /** Exact, lowercase domain. Matched with `===`. Never a suffix. */
  readonly domain: string
  /**
   * Lowercase localparts accepted on this domain, or `'any'` when the whole domain
   * is dedicated to transactional mail.
   */
  readonly localparts: readonly string[] | 'any'
}

export const CHASE = 'Chase'
export const AMEX = 'American Express'
export const DISCOVER = 'Discover'
export const US_BANK = 'U.S. Bank'
export const SBI_CARD = 'SBI Card'
export const ZOLVE = 'Zolve'
export const CAPITAL_ONE = 'Capital One'

export const SENDER_RULES: readonly SenderRule[] = [
  // Apex domain shared with marketing — localpart pinned.
  { institution: CHASE, region: 'US', domain: 'chase.com', localparts: ['no.reply.alerts'] },
  // Dedicated transactional subdomains — localpart open.
  { institution: AMEX, region: 'US', domain: 'welcome.americanexpress.com', localparts: 'any' },
  { institution: DISCOVER, region: 'US', domain: 'services.discover.com', localparts: 'any' },
  { institution: US_BANK, region: 'US', domain: 'notifications.usbank.com', localparts: 'any' },
  { institution: CAPITAL_ONE, region: 'US', domain: 'notification.capitalone.com', localparts: 'any' },
  // Apex domains shared with marketing — localparts pinned.
  { institution: SBI_CARD, region: 'IN', domain: 'sbicard.com', localparts: ['onlinesbicard', 'statements'] },
  { institution: ZOLVE, region: 'US', domain: 'zolve.com', localparts: ['noreply'] },
]

export type SenderRejection =
  | 'unparseable_from_header'
  | 'domain_not_allowlisted'
  | 'localpart_not_allowlisted'

export type SenderVerdict =
  | { readonly allowed: true; readonly address: string; readonly rule: SenderRule }
  | { readonly allowed: false; readonly address: string | null; readonly reason: SenderRejection }

/** Split a lowercased address at its LAST `@` — localparts may legally contain one. */
function splitAddress(address: string): { local: string; domain: string } | null {
  const at = address.lastIndexOf('@')
  if (at <= 0 || at === address.length - 1) return null
  return { local: address.slice(0, at), domain: address.slice(at + 1) }
}

/**
 * Extract the bare address from a From header, lowercased.
 *
 * Returns null rather than a best guess: a header this cannot read is a header
 * whose sender is unknown, and unknown senders must not reach a parser.
 */
export function parseFromHeader(from: string): string | null {
  if (typeof from !== 'string') return null
  const trimmed = from.trim()
  if (trimmed === '') return null

  // `Display Name <addr@host>` — take the last angle-bracket group, since display
  // names themselves sometimes contain a decoy address ("Chase <phish@evil>" style).
  const angled = trimmed.match(/<([^<>]*)>\s*$/)
  const candidate = (angled?.[1] ?? trimmed).trim().toLowerCase()

  if (candidate === '' || /[\s<>,;]/.test(candidate)) return null
  const parts = splitAddress(candidate)
  if (!parts) return null
  if (parts.domain.includes('@') || !parts.domain.includes('.')) return null
  return candidate
}

/** Classify a raw From header against the allowlist. */
export function classifySender(from: string): SenderVerdict {
  const address = parseFromHeader(from)
  if (address === null) {
    return { allowed: false, address: null, reason: 'unparseable_from_header' }
  }

  const parts = splitAddress(address)
  if (!parts) return { allowed: false, address, reason: 'unparseable_from_header' }

  // Exact domain equality. See the module note — a suffix test admits marketing mail.
  const domainRules = SENDER_RULES.filter((r) => r.domain === parts.domain)
  if (domainRules.length === 0) {
    return { allowed: false, address, reason: 'domain_not_allowlisted' }
  }

  for (const rule of domainRules) {
    if (rule.localparts === 'any' || rule.localparts.includes(parts.local)) {
      return { allowed: true, address, rule }
    }
  }
  return { allowed: false, address, reason: 'localpart_not_allowlisted' }
}

export function isAllowlistedSender(from: string): boolean {
  return classifySender(from).allowed
}

/**
 * True when the From header resolves to exactly one of the given domains.
 *
 * Parsers use this so that a Chase template can never claim an SBI Card message,
 * even if a body phrase happens to collide.
 */
export function senderIsFrom(from: string, ...domains: readonly string[]): boolean {
  const verdict = classifySender(from)
  return verdict.allowed && domains.includes(verdict.rule.domain)
}
