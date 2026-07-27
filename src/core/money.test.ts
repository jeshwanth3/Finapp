import { describe, it, expect } from 'vitest'
import {
  money,
  fromDecimalString,
  toDecimalString,
  add,
  subtract,
  negate,
  scale,
  compare,
  isZero,
  sum,
  format,
  CurrencyMismatchError,
  NotAnIntegerError,
} from './money'

describe('money construction', () => {
  it('holds integer minor units and an ISO-4217 code', () => {
    const m = money(123456, 'USD')
    expect(m.minor).toBe(123456)
    expect(m.currency).toBe('USD')
  })

  it('rejects non-integer minor units — floats are the bug this type exists to prevent', () => {
    expect(() => money(10.5, 'USD')).toThrow(NotAnIntegerError)
    expect(() => money(NaN, 'USD')).toThrow(NotAnIntegerError)
    expect(() => money(Infinity, 'USD')).toThrow(NotAnIntegerError)
  })

  it('normalises the currency code to uppercase', () => {
    expect(money(1, 'usd').currency).toBe('USD')
  })

  it('rejects malformed currency codes', () => {
    expect(() => money(1, 'US')).toThrow()
    expect(() => money(1, 'DOLLAR')).toThrow()
    expect(() => money(1, '')).toThrow()
  })
})

describe('decimal parsing — the boundary where floats would sneak in', () => {
  it('parses a plain 2-decimal amount', () => {
    expect(fromDecimalString('1234.56', 'USD')).toEqual(money(123456, 'USD'))
  })

  it('parses amounts with no decimal part', () => {
    expect(fromDecimalString('2500', 'USD')).toEqual(money(250000, 'USD'))
  })

  it('parses a single decimal place as tenths, not hundredths', () => {
    expect(fromDecimalString('12.5', 'USD')).toEqual(money(1250, 'USD'))
  })

  it('handles thousands separators and currency symbols found in emails', () => {
    expect(fromDecimalString('$2,709.80', 'USD')).toEqual(money(270980, 'USD'))
    expect(fromDecimalString('Rs.35,882.00', 'INR')).toEqual(money(3588200, 'INR'))
    expect(fromDecimalString('₹1,08,244.50', 'INR')).toEqual(money(10824450, 'INR'))
  })

  it('handles negatives in both notations', () => {
    expect(fromDecimalString('-45.23', 'USD')).toEqual(money(-4523, 'USD'))
    expect(fromDecimalString('(45.23)', 'USD')).toEqual(money(-4523, 'USD'))
  })

  it('respects currencies with a zero exponent', () => {
    expect(fromDecimalString('1200', 'JPY')).toEqual(money(1200, 'JPY'))
  })

  it('rejects more precision than the currency has', () => {
    expect(() => fromDecimalString('1.234', 'USD')).toThrow()
  })

  it('rejects unparseable input rather than guessing', () => {
    expect(() => fromDecimalString('', 'USD')).toThrow()
    expect(() => fromDecimalString('abc', 'USD')).toThrow()
    expect(() => fromDecimalString('1.2.3', 'USD')).toThrow()
  })

  it('round-trips through toDecimalString', () => {
    for (const s of ['0.00', '1234.56', '-45.23', '0.07', '999999.99']) {
      expect(toDecimalString(fromDecimalString(s, 'USD'))).toBe(s)
    }
  })

  it('pads minor units correctly when formatting back', () => {
    expect(toDecimalString(money(7, 'USD'))).toBe('0.07')
    expect(toDecimalString(money(-7, 'USD'))).toBe('-0.07')
    expect(toDecimalString(money(1200, 'JPY'))).toBe('1200')
  })
})

describe('arithmetic refuses to mix currencies', () => {
  it('adds within a currency', () => {
    expect(add(money(100, 'USD'), money(250, 'USD'))).toEqual(money(350, 'USD'))
  })

  it('subtracts within a currency', () => {
    expect(subtract(money(100, 'USD'), money(250, 'USD'))).toEqual(money(-150, 'USD'))
  })

  it('throws on USD + INR rather than producing a meaningless number', () => {
    expect(() => add(money(100, 'USD'), money(100, 'INR'))).toThrow(CurrencyMismatchError)
    expect(() => subtract(money(100, 'USD'), money(100, 'INR'))).toThrow(CurrencyMismatchError)
    expect(() => compare(money(100, 'USD'), money(100, 'INR'))).toThrow(CurrencyMismatchError)
  })

  it('negates', () => {
    expect(negate(money(100, 'USD'))).toEqual(money(-100, 'USD'))
    expect(negate(money(0, 'USD'))).toEqual(money(0, 'USD'))
  })
})

describe('scaling always yields an integer', () => {
  it('scales and rounds half away from zero', () => {
    expect(scale(money(100, 'USD'), 0.5)).toEqual(money(50, 'USD'))
    expect(scale(money(101, 'USD'), 0.5)).toEqual(money(51, 'USD'))
    expect(scale(money(-101, 'USD'), 0.5)).toEqual(money(-51, 'USD'))
  })

  it('never leaks a fractional minor unit', () => {
    for (const factor of [0.333333, 1 / 3, 0.1, 2.5, 1.005]) {
      const r = scale(money(12345, 'USD'), factor)
      expect(Number.isInteger(r.minor)).toBe(true)
    }
  })
})

describe('sum', () => {
  it('sums a same-currency list', () => {
    expect(sum([money(100, 'USD'), money(250, 'USD'), money(-50, 'USD')])).toEqual(
      money(300, 'USD'),
    )
  })

  it('requires an explicit currency for an empty list — zero of what?', () => {
    expect(() => sum([])).toThrow()
    expect(sum([], 'USD')).toEqual(money(0, 'USD'))
  })

  it('refuses a mixed-currency list', () => {
    expect(() => sum([money(100, 'USD'), money(100, 'INR')])).toThrow(CurrencyMismatchError)
  })
})

describe('comparison', () => {
  it('orders correctly', () => {
    expect(compare(money(100, 'USD'), money(250, 'USD'))).toBeLessThan(0)
    expect(compare(money(250, 'USD'), money(100, 'USD'))).toBeGreaterThan(0)
    expect(compare(money(100, 'USD'), money(100, 'USD'))).toBe(0)
  })

  it('detects zero', () => {
    expect(isZero(money(0, 'USD'))).toBe(true)
    expect(isZero(money(1, 'USD'))).toBe(false)
  })
})

describe('display formatting', () => {
  it('formats USD and INR with their own conventions', () => {
    expect(format(money(270980, 'USD'))).toContain('2,709.80')
    expect(format(money(3588200, 'INR'))).toContain('35,882.00')
  })

  it('shows the currency so a cross-currency screen is never ambiguous', () => {
    expect(format(money(100, 'USD'))).toMatch(/\$|USD/)
    expect(format(money(100, 'INR'))).toMatch(/₹|INR/)
  })
})
