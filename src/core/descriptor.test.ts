import { describe, it, expect } from 'vitest'
import { normalizeDescriptor, merchantKey } from './descriptor'

describe('US card descriptors', () => {
  it('strips processor prefixes', () => {
    expect(normalizeDescriptor('SQ *COFFEE BAR')).toBe('coffee bar')
    expect(normalizeDescriptor('TST* PIZZERIA')).toBe('pizzeria')
    expect(normalizeDescriptor('PY *LOCAL SHOP')).toBe('local shop')
  })

  it('strips store and reference numbers', () => {
    expect(normalizeDescriptor('SQ *COFFEE BAR 4821')).toBe('coffee bar')
    expect(normalizeDescriptor('AMZN Mktp US*RT4G9K2L1')).toBe('amazon marketplace')
  })

  it('applies canonical aliases', () => {
    expect(normalizeDescriptor('AMZN Mktp US')).toBe('amazon marketplace')
    expect(normalizeDescriptor('WHOLEFDS MKT')).toBe('whole foods mkt')
  })

  it('drops corporate suffixes that vary without changing the merchant', () => {
    expect(normalizeDescriptor('ACME WIDGETS LLC')).toBe('acme widgets')
  })

  it('is idempotent — normalising twice changes nothing', () => {
    const once = normalizeDescriptor('SQ *COFFEE BAR 4821')
    expect(normalizeDescriptor(once)).toBe(once)
  })

  it('is deterministic — identity depends on it', () => {
    const a = normalizeDescriptor('SQ *COFFEE BAR 4821')
    const b = normalizeDescriptor('SQ *COFFEE BAR 4821')
    expect(a).toBe(b)
  })
})

describe('Indian descriptors', () => {
  it('extracts the merchant from UPI rails', () => {
    expect(normalizeDescriptor('UPI/SWIGGY/9284712', 'IN')).toBe('swiggy')
  })

  it('splits concatenated processor strings', () => {
    expect(normalizeDescriptor('RAZDreamplugPaytechSol', 'IN')).toBe('cred')
  })

  it('handles real SBI Card alert descriptors', () => {
    expect(normalizeDescriptor('BIG BASKET', 'IN')).toBe('big basket')
    expect(normalizeDescriptor('IKEA INDIA PVT LTD', 'IN')).toBe('ikea india')
    expect(normalizeDescriptor('AMAZON PAY INDIA PRIVATE', 'IN')).toBe('amazon pay india')
  })
})

describe('merchantKey never returns empty', () => {
  it('falls back to a marked raw form rather than collapsing distinct rows', () => {
    expect(merchantKey('')).not.toBe('')
    expect(merchantKey('12345')).not.toBe('')
    expect(merchantKey('***')).not.toBe('')
  })

  it('keeps genuinely different unparseable descriptors distinct', () => {
    expect(merchantKey('***')).not.toBe(merchantKey('###'))
  })
})
