import { describe, expect, it } from 'vitest'

import { classifySender, isAllowlistedSender, parseFromHeader, SENDER_RULES } from './senders'
import { marketingMessages } from './fixtures'

/** The real transactional addresses this project ingests from. */
const TRANSACTIONAL: readonly string[] = [
  'no.reply.alerts@chase.com',
  'AmericanExpress@welcome.americanexpress.com',
  'discover@services.discover.com',
  'usbank@notifications.usbank.com',
  'onlinesbicard@sbicard.com',
  'Statements@sbicard.com',
  'noreply@zolve.com',
  'capitalone@notification.capitalone.com',
]

/** The real marketing addresses. Each one shares a registrable domain with a real alert sender. */
const MARKETING: readonly string[] = [
  'chase@mcmap.chase.com',
  'americanexpress@member.americanexpress.com',
  'offers@offers.sbicard.com',
  '1800USBanks@email.usbank.com',
]

describe('parseFromHeader', () => {
  it('reads a bare address', () => {
    expect(parseFromHeader('noreply@zolve.com')).toBe('noreply@zolve.com')
  })

  it('reads an angle-bracketed address and lowercases it', () => {
    expect(parseFromHeader('SBI Card <OnlineSBICard@sbicard.com>')).toBe('onlinesbicard@sbicard.com')
  })

  it('takes the real address when the display name contains a decoy', () => {
    expect(parseFromHeader('"no.reply.alerts@chase.com" <attacker@evil.example>')).toBe(
      'attacker@evil.example',
    )
  })

  it('returns null rather than guessing at an unreadable header', () => {
    expect(parseFromHeader('')).toBeNull()
    expect(parseFromHeader('   ')).toBeNull()
    expect(parseFromHeader('not-an-address')).toBeNull()
    expect(parseFromHeader('@chase.com')).toBeNull()
    expect(parseFromHeader('alerts@')).toBeNull()
    expect(parseFromHeader('alerts@localhost')).toBeNull()
  })
})

describe('transactional allowlist', () => {
  it.each(TRANSACTIONAL)('accepts %s', (address) => {
    const verdict = classifySender(`Bank <${address}>`)
    expect(verdict.allowed).toBe(true)
  })

  it('accepts regardless of header casing', () => {
    expect(isAllowlistedSender('AmericanExpress@welcome.americanexpress.com')).toBe(true)
  })

  it('attaches the institution and region to an accepted sender', () => {
    const verdict = classifySender('onlinesbicard@sbicard.com')
    expect(verdict.allowed).toBe(true)
    if (!verdict.allowed) return
    expect(verdict.rule.institution).toBe('SBI Card')
    expect(verdict.rule.region).toBe('IN')
  })
})

describe('marketing subdomains', () => {
  it.each(MARKETING)('rejects %s', (address) => {
    const verdict = classifySender(`Offers <${address}>`)
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.reason).toBe('domain_not_allowlisted')
  })

  it('rejects every marketing fixture', () => {
    for (const m of marketingMessages) {
      expect(isAllowlistedSender(m.from)).toBe(false)
    }
  })

  it('rejects an unknown localpart on a shared apex domain', () => {
    // chase.com carries both alerts and other mail, so the localpart is pinned.
    const verdict = classifySender('promotions@chase.com')
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.reason).toBe('localpart_not_allowlisted')
  })

  it('never suffix-matches — the bug this module exists to prevent', () => {
    // Any of these would pass an `endsWith` check against an allowlisted domain.
    for (const address of [
      'alerts@evil-chase.com',
      'alerts@chase.com.attacker.example',
      'alerts@notifications.usbank.com.evil.example',
      'alerts@sbicard.com.in',
    ]) {
      expect(isAllowlistedSender(address)).toBe(false)
    }
  })
})

describe('rule table', () => {
  it('stores every domain lowercase, so exact matching can never fail on casing', () => {
    for (const rule of SENDER_RULES) {
      expect(rule.domain).toBe(rule.domain.toLowerCase())
      if (rule.localparts !== 'any') {
        for (const local of rule.localparts) expect(local).toBe(local.toLowerCase())
      }
    }
  })
})
