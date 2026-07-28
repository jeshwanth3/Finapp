/**
 * Message authenticity — is this email actually from who it claims?
 *
 * THE HOLE THIS CLOSES
 *
 * `senders.ts` allowlists transactional addresses like `no.reply.alerts@chase.com`.
 * On its own that is not a security control, because the `From:` header is
 * trivially forgeable. Anyone who knows the owner's email address can send a
 * message claiming to be Chase, stating any statement balance they like, and an
 * allowlist alone would admit it into the ledger.
 *
 * For a product whose central promise is "prefer an error over a plausible wrong
 * number", accepting an attacker-supplied balance is the worst available bug: it
 * is silent, it looks correct, and it poisons every downstream projection.
 *
 * THE CONTROL
 *
 * SPF, DKIM and DMARC exist for exactly this, and the receiving provider has
 * already evaluated them. Gmail stamps the verdict into an `Authentication-Results`
 * header on delivery. This module reads that verdict and requires it to pass
 * before a message is trusted, so the allowlist becomes a filter over
 * *authenticated* senders rather than over claimed ones.
 *
 * WHY TRUSTING THE HEADER IS SOUND HERE
 *
 * `Authentication-Results` is itself just a header, and a forged message can
 * contain a forged one. It is trustworthy only when stamped by the boundary
 * server that actually performed the check — for Gmail, `mx.google.com`. So this
 * module requires the authserv-id to match a configured trusted authority and
 * ignores any other Authentication-Results header in the message. A message
 * arriving with an attacker-written header naming a different authserv-id fails,
 * because Gmail's own stamp will be absent or will say `dmarc=fail`.
 *
 * The residual assumption is that mail is fetched from the provider that
 * performed the check. That holds: this app reads the mailbox over IMAP.
 */

export type AuthMethod = 'spf' | 'dkim' | 'dmarc'
export type AuthVerdict = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'policy'

export interface AuthResult {
  /** The server that performed the checks, e.g. `mx.google.com`. */
  readonly authservId: string | null
  readonly spf: AuthVerdict | null
  readonly dkim: AuthVerdict | null
  readonly dmarc: AuthVerdict | null
  /** Domain DKIM signed for, when stated. Compared against the From domain. */
  readonly dkimDomain: string | null
  readonly raw: string
}

export type AuthenticityDecision =
  | { readonly trusted: true; readonly reason: 'dmarc_pass' | 'spf_and_dkim_pass' }
  | { readonly trusted: false; readonly reason: AuthenticityRejection; readonly detail: string }

export type AuthenticityRejection =
  | 'no_auth_header'
  | 'untrusted_authserv'
  | 'dmarc_failed'
  | 'no_passing_mechanism'
  | 'dkim_domain_mismatch'

/** Authorities whose verdicts we accept. Gmail's boundary MX by default. */
export const DEFAULT_TRUSTED_AUTHSERV = ['mx.google.com'] as const

const VERDICTS: readonly string[] = [
  'pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'policy',
]

function normaliseVerdict(token: string | undefined): AuthVerdict | null {
  if (!token) return null
  const lower = token.toLowerCase()
  return (VERDICTS.includes(lower) ? lower : null) as AuthVerdict | null
}

/**
 * Parse one `Authentication-Results` header value.
 *
 * The header is deliberately loose in RFC 8601 — implementations vary in spacing,
 * ordering, quoting and the comments they interleave — so this reads the method
 * results it recognises and ignores everything else rather than trying to be a
 * complete grammar.
 */
export function parseAuthenticationResults(headerValue: string): AuthResult {
  const raw = headerValue.trim()

  // authserv-id is the first token, before the first semicolon.
  const firstSegment = raw.split(';')[0] ?? ''
  const authservId = firstSegment.trim().split(/\s+/)[0]?.toLowerCase() ?? null

  const read = (method: AuthMethod): AuthVerdict | null => {
    // e.g. "dmarc=pass", "spf=pass (google.com: domain of ...)"
    const m = new RegExp(`\\b${method}\\s*=\\s*([a-z]+)`, 'i').exec(raw)
    return normaliseVerdict(m?.[1])
  }

  const dkimDomainMatch = /\bdkim=[a-z]+[^;]*?\bheader\.(?:i|d)=@?([A-Za-z0-9.-]+)/i.exec(raw)

  return {
    authservId: authservId === '' ? null : authservId,
    spf: read('spf'),
    dkim: read('dkim'),
    dmarc: read('dmarc'),
    dkimDomain: dkimDomainMatch?.[1]?.toLowerCase() ?? null,
    raw,
  }
}

function domainOf(address: string): string | null {
  const at = address.lastIndexOf('@')
  if (at < 0) return null
  const domain = address.slice(at + 1).trim().toLowerCase().replace(/[>\s]+$/, '')
  return domain === '' ? null : domain
}

/** True when `child` is `parent` or a subdomain of it. */
function isSameOrSubdomain(child: string, parent: string): boolean {
  return child === parent || child.endsWith(`.${parent}`)
}

export interface AuthenticityOptions {
  /** Authorities we accept verdicts from. */
  trustedAuthserv?: readonly string[]
  /**
   * When true, a message with no Authentication-Results header is accepted.
   * Intended ONLY for offline fixtures. Never enable against a live mailbox:
   * it reduces the allowlist back to "trust the From header", which is the
   * hole this module exists to close.
   */
  allowUnauthenticated?: boolean
}

/**
 * Decide whether a message may be trusted as genuinely from its claimed sender.
 *
 * DMARC pass is the primary signal, because DMARC is the mechanism that ties an
 * authenticated identifier to the visible `From:` domain — which is the thing an
 * attacker forges. SPF or DKIM passing alone is accepted only when they align
 * with the From domain, since SPF authenticates the envelope sender and DKIM
 * authenticates a signing domain, neither of which is necessarily the From.
 */
export function assessAuthenticity(
  headers: Readonly<Record<string, string | undefined>>,
  fromAddress: string,
  options: AuthenticityOptions = {},
): AuthenticityDecision {
  const trusted = options.trustedAuthserv ?? DEFAULT_TRUSTED_AUTHSERV

  const headerValue =
    headers['authentication-results'] ??
    headers['Authentication-Results'] ??
    undefined

  if (!headerValue || headerValue.trim() === '') {
    if (options.allowUnauthenticated) return { trusted: true, reason: 'dmarc_pass' }
    return {
      trusted: false,
      reason: 'no_auth_header',
      detail:
        'No Authentication-Results header. Without one the From address is an ' +
        'unverified claim, and an allowlist over unverified claims is not a control.',
    }
  }

  const result = parseAuthenticationResults(headerValue)

  if (result.authservId === null || !trusted.some((t) => result.authservId === t.toLowerCase())) {
    return {
      trusted: false,
      reason: 'untrusted_authserv',
      detail:
        `Authentication-Results was stamped by ${JSON.stringify(result.authservId)}, which is ` +
        `not a trusted authority (${trusted.join(', ')}). A verdict from an untrusted server ` +
        `is a claim the sender could have written themselves.`,
    }
  }

  // An explicit DMARC failure is decisive: the domain owner published a policy
  // and this message did not satisfy it.
  if (result.dmarc === 'fail') {
    return {
      trusted: false,
      reason: 'dmarc_failed',
      detail: `dmarc=fail from ${result.authservId}. The From domain's own policy rejects this message.`,
    }
  }

  if (result.dmarc === 'pass') {
    return { trusted: true, reason: 'dmarc_pass' }
  }

  // No DMARC verdict. Fall back to SPF and DKIM, but only when the DKIM signing
  // domain aligns with the From domain — an unaligned pass proves someone signed
  // it, not that Chase did.
  const fromDomain = domainOf(fromAddress)
  if (result.spf === 'pass' && result.dkim === 'pass') {
    if (fromDomain && result.dkimDomain && !isSameOrSubdomain(result.dkimDomain, fromDomain)
        && !isSameOrSubdomain(fromDomain, result.dkimDomain)) {
      return {
        trusted: false,
        reason: 'dkim_domain_mismatch',
        detail:
          `DKIM signed for ${result.dkimDomain} but the message claims to be from ` +
          `${fromDomain}. A valid signature by an unrelated domain authenticates the ` +
          `signer, not the sender.`,
      }
    }
    return { trusted: true, reason: 'spf_and_dkim_pass' }
  }

  return {
    trusted: false,
    reason: 'no_passing_mechanism',
    detail:
      `No passing authentication: spf=${result.spf ?? 'absent'}, dkim=${result.dkim ?? 'absent'}, ` +
      `dmarc=${result.dmarc ?? 'absent'}. Treating this as genuine would mean trusting the ` +
      `From header alone.`,
  }
}
