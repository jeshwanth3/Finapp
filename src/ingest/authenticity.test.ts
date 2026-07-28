import { describe, it, expect } from 'vitest'
import {
  parseAuthenticationResults,
  assessAuthenticity,
  DEFAULT_TRUSTED_AUTHSERV,
} from './authenticity'

/**
 * These are attacks, not happy paths.
 *
 * The allowlist in senders.ts checks a `From:` header, which anyone can write.
 * This module is the thing that makes the allowlist mean something, so the tests
 * that matter are the ones where someone is lying.
 */

/** A genuine Gmail stamp, of the shape Google actually emits. */
const GMAIL_PASS =
  'mx.google.com; dkim=pass header.i=@sbicard.com header.s=s1 header.b=Ab12Cd3e; ' +
  'spf=pass (google.com: domain of bounce@sbicard.com designates 203.0.113.9 as ' +
  'permitted sender) smtp.mailfrom=bounce@sbicard.com; ' +
  'dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=sbicard.com'

const GMAIL_DMARC_FAIL =
  'mx.google.com; dkim=none; spf=softfail (google.com: domain of transitioning ' +
  'x@chase.com does not designate 198.51.100.4 as permitted sender); ' +
  'dmarc=fail (p=REJECT sp=REJECT dis=REJECT) header.from=chase.com'

describe('parsing the header', () => {
  it('reads the authserv-id and each mechanism verdict', () => {
    const r = parseAuthenticationResults(GMAIL_PASS)
    expect(r.authservId).toBe('mx.google.com')
    expect(r.spf).toBe('pass')
    expect(r.dkim).toBe('pass')
    expect(r.dmarc).toBe('pass')
  })

  it('extracts the DKIM signing domain', () => {
    expect(parseAuthenticationResults(GMAIL_PASS).dkimDomain).toBe('sbicard.com')
  })

  it('is not confused by the parenthetical comments providers interleave', () => {
    const r = parseAuthenticationResults(GMAIL_DMARC_FAIL)
    expect(r.dmarc).toBe('fail')
    expect(r.spf).toBe('softfail')
  })

  it('reports absent mechanisms as null rather than guessing', () => {
    const r = parseAuthenticationResults('mx.google.com; spf=pass')
    expect(r.dkim).toBeNull()
    expect(r.dmarc).toBeNull()
  })
})

describe('THE SPOOFING ATTACK — the reason this module exists', () => {
  const chaseFrom = 'no.reply.alerts@chase.com'

  it('REJECTS a message with a forged From and no authentication at all', () => {
    // Anyone who knows the owner's address can send this. Without an auth check
    // the allowlist admits it and an attacker sets the statement balance.
    const decision = assessAuthenticity({}, chaseFrom)
    expect(decision.trusted).toBe(false)
    if (decision.trusted) throw new Error('unreachable')
    expect(decision.reason).toBe('no_auth_header')
  })

  it('REJECTS an attacker-written Authentication-Results header', () => {
    // The attacker knows we read this header, so they write their own saying pass.
    // It fails because the authserv-id is not an authority we trust — only the
    // receiving boundary server's stamp counts.
    const decision = assessAuthenticity(
      { 'authentication-results': 'attacker-controlled.example; dmarc=pass; spf=pass; dkim=pass' },
      chaseFrom,
    )
    expect(decision.trusted).toBe(false)
    if (decision.trusted) throw new Error('unreachable')
    expect(decision.reason).toBe('untrusted_authserv')
  })

  it('REJECTS when the real authority says dmarc=fail', () => {
    const decision = assessAuthenticity(
      { 'authentication-results': GMAIL_DMARC_FAIL },
      chaseFrom,
    )
    expect(decision.trusted).toBe(false)
    if (decision.trusted) throw new Error('unreachable')
    expect(decision.reason).toBe('dmarc_failed')
  })

  it('REJECTS a valid signature from an unrelated domain', () => {
    // Signing proves the signer signed it. It does not prove Chase sent it.
    const header =
      'mx.google.com; dkim=pass header.i=@evil-mailer.example header.s=k1; ' +
      'spf=pass smtp.mailfrom=bounce@evil-mailer.example'
    const decision = assessAuthenticity({ 'authentication-results': header }, chaseFrom)
    expect(decision.trusted).toBe(false)
    if (decision.trusted) throw new Error('unreachable')
    expect(decision.reason).toBe('dkim_domain_mismatch')
  })

  it('REJECTS when nothing passed', () => {
    const decision = assessAuthenticity(
      { 'authentication-results': 'mx.google.com; dkim=none; spf=none' },
      chaseFrom,
    )
    expect(decision.trusted).toBe(false)
    if (decision.trusted) throw new Error('unreachable')
    expect(decision.reason).toBe('no_passing_mechanism')
  })
})

describe('genuine messages are accepted', () => {
  it('accepts a real Gmail dmarc=pass stamp', () => {
    const decision = assessAuthenticity(
      { 'authentication-results': GMAIL_PASS },
      'onlinesbicard@sbicard.com',
    )
    expect(decision.trusted).toBe(true)
    if (!decision.trusted) throw new Error(decision.detail)
    expect(decision.reason).toBe('dmarc_pass')
  })

  it('accepts aligned SPF plus DKIM when the provider published no DMARC verdict', () => {
    const header =
      'mx.google.com; dkim=pass header.i=@zolve.com header.s=s1; ' +
      'spf=pass smtp.mailfrom=bounce@zolve.com'
    const decision = assessAuthenticity({ 'authentication-results': header }, 'noreply@zolve.com')
    expect(decision.trusted).toBe(true)
    if (!decision.trusted) throw new Error(decision.detail)
    expect(decision.reason).toBe('spf_and_dkim_pass')
  })

  it('treats a subdomain signature as aligned', () => {
    const header =
      'mx.google.com; dkim=pass header.i=@notifications.usbank.com header.s=s1; spf=pass'
    const decision = assessAuthenticity(
      { 'authentication-results': header },
      'usbank@notifications.usbank.com',
    )
    expect(decision.trusted).toBe(true)
  })

  it('is case-insensitive about the header name', () => {
    const decision = assessAuthenticity(
      { 'Authentication-Results': GMAIL_PASS },
      'onlinesbicard@sbicard.com',
    )
    expect(decision.trusted).toBe(true)
  })
})

describe('the offline escape hatch is narrow and explicit', () => {
  it('allows unauthenticated messages ONLY when asked', () => {
    const withFlag = assessAuthenticity({}, 'x@chase.com', { allowUnauthenticated: true })
    expect(withFlag.trusted).toBe(true)

    const withoutFlag = assessAuthenticity({}, 'x@chase.com')
    expect(withoutFlag.trusted).toBe(false)
  })

  it('does not let the flag override an explicit DMARC failure', () => {
    // The flag exists so offline fixtures need not carry auth headers. It must
    // not become a way to accept a message the authority actively rejected.
    const decision = assessAuthenticity(
      { 'authentication-results': GMAIL_DMARC_FAIL },
      'x@chase.com',
      { allowUnauthenticated: true },
    )
    expect(decision.trusted).toBe(false)
  })
})

describe('trusted authorities are configurable', () => {
  it('defaults to the Gmail boundary MX', () => {
    expect(DEFAULT_TRUSTED_AUTHSERV).toContain('mx.google.com')
  })

  it('accepts a different authority when configured', () => {
    const header = 'mx.fastmail.com; dmarc=pass header.from=chase.com'
    const decision = assessAuthenticity(
      { 'authentication-results': header },
      'no.reply.alerts@chase.com',
      { trustedAuthserv: ['mx.fastmail.com'] },
    )
    expect(decision.trusted).toBe(true)
  })

  it('still rejects an authority outside the configured list', () => {
    const header = 'mx.google.com; dmarc=pass'
    const decision = assessAuthenticity({ 'authentication-results': header }, 'x@chase.com', {
      trustedAuthserv: ['mx.fastmail.com'],
    })
    expect(decision.trusted).toBe(false)
  })
})
