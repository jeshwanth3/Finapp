/**
 * Money — integer minor units plus an ISO-4217 code. Always. No exceptions.
 *
 * Design spec §7.1. Every monetary value in this system is a `Money`. There are
 * no bare numbers representing amounts, and no floats anywhere in the money path.
 *
 * Two rules this module enforces mechanically, because both are silent-corruption
 * bugs rather than crashes:
 *   1. Minor units are integers. A float that slips in produces amounts that look
 *      right in testing and drift in production.
 *   2. Arithmetic never crosses currencies. USD + INR has no meaning without a
 *      dated rate, so it throws rather than returning a plausible wrong number.
 *      Conversion is a display-time concern (see `fx.ts`), never a storage one.
 */

export interface Money {
  /** Integer count of the currency's smallest unit — cents, paise, yen. */
  readonly minor: number
  /** ISO-4217 alphabetic code, uppercase. */
  readonly currency: string
}

export class NotAnIntegerError extends Error {
  constructor(value: number) {
    super(
      `Money.minor must be an integer number of minor units, received ${value}. ` +
        `A fractional minor unit means a float entered the money path.`,
    )
    this.name = 'NotAnIntegerError'
  }
}

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(
      `Refusing to combine ${a} and ${b}. Cross-currency arithmetic requires an ` +
        `explicit dated exchange rate — see fx.ts. Storage never converts.`,
    )
    this.name = 'CurrencyMismatchError'
  }
}

export class InvalidCurrencyError extends Error {
  constructor(code: string) {
    super(`Invalid ISO-4217 currency code: ${JSON.stringify(code)}. Expected three letters.`)
    this.name = 'InvalidCurrencyError'
  }
}

export class MoneyParseError extends Error {
  constructor(input: string, currency: string, reason: string) {
    super(`Cannot parse ${JSON.stringify(input)} as ${currency}: ${reason}`)
    this.name = 'MoneyParseError'
  }
}

/**
 * Minor-unit exponents that differ from the default of 2.
 * Only currencies this app plausibly touches are listed; the default covers the rest.
 */
const EXPONENTS: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  IDR: 0,
  CLP: 0,
  ISK: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
}

const DEFAULT_EXPONENT = 2
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/

export function exponentOf(currency: string): number {
  return EXPONENTS[normaliseCurrency(currency)] ?? DEFAULT_EXPONENT
}

function normaliseCurrency(code: string): string {
  if (typeof code !== 'string' || !CURRENCY_PATTERN.test(code)) {
    throw new InvalidCurrencyError(code)
  }
  return code.toUpperCase()
}

/** Construct a Money from an integer count of minor units. */
export function money(minor: number, currency: string): Money {
  const code = normaliseCurrency(currency)
  if (!Number.isInteger(minor)) throw new NotAnIntegerError(minor)
  // Normalise -0 to 0. Negative zero survives arithmetic, serialises as "-0" in
  // JSON, and makes Object.is comparisons fail — none of which is ever wanted here.
  return Object.freeze({ minor: minor === 0 ? 0 : minor, currency: code })
}

export function zero(currency: string): Money {
  return money(0, currency)
}

/**
 * Parse a human/email-formatted amount into Money.
 *
 * Deliberately tolerant of what real institution emails contain — currency symbols,
 * thousands separators (including the Indian lakh/crore grouping), and accounting
 * negatives — but strict about precision: more decimal places than the currency has
 * is an error, not something to round away silently.
 */
export function fromDecimalString(input: string, currency: string): Money {
  const code = normaliseCurrency(currency)
  if (typeof input !== 'string') throw new MoneyParseError(String(input), code, 'not a string')

  let s = input.trim()
  if (s === '') throw new MoneyParseError(input, code, 'empty')

  // Accounting negative: (45.23)
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1).trim()
  }

  // Strip currency symbols, codes and prefixes seen in real statement emails.
  s = s.replace(/(?:Rs\.?|INR|USD|AUD|SGD|EUR|GBP|₹|\$|€|£|¥)/gi, '').trim()

  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1).trim()
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim()
  }

  // Remove grouping separators. Handles both 1,234,567.89 and 1,08,244.50.
  s = s.replace(/,/g, '')
  s = s.replace(/\s/g, '')

  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') {
    throw new MoneyParseError(input, code, 'not a decimal number')
  }

  const parts = s.split('.')
  if (parts.length > 2) throw new MoneyParseError(input, code, 'multiple decimal points')

  const whole = parts[0] === '' ? '0' : (parts[0] as string)
  const frac = parts.length === 2 ? (parts[1] as string) : ''
  const exponent = exponentOf(code)

  if (frac.length > exponent) {
    throw new MoneyParseError(
      input,
      code,
      `${frac.length} decimal places but ${code} has ${exponent}. ` +
        `Refusing to round — this usually means the wrong currency was assumed.`,
    )
  }

  const paddedFrac = frac.padEnd(exponent, '0')
  const digits = `${whole}${paddedFrac}`

  const minor = Number(digits)
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyParseError(input, code, 'amount exceeds safe integer range')
  }

  return money(negative ? -minor : minor, code)
}

/** Render Money as a plain decimal string — the inverse of `fromDecimalString`. */
export function toDecimalString(m: Money): string {
  const exponent = exponentOf(m.currency)
  const sign = m.minor < 0 ? '-' : ''
  const abs = Math.abs(m.minor).toString()

  if (exponent === 0) return `${sign}${abs}`

  const padded = abs.padStart(exponent + 1, '0')
  const whole = padded.slice(0, padded.length - exponent)
  const frac = padded.slice(padded.length - exponent)
  return `${sign}${whole}.${frac}`
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency)
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.minor + b.minor, a.currency)
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.minor - b.minor, a.currency)
}

export function negate(m: Money): Money {
  return money(-m.minor, m.currency)
}

/**
 * Multiply by a scalar, rounding half away from zero.
 *
 * Used by the attribution bridge (volume/price effects) and budget projections.
 * The result is always an integer minor unit — a scaled Money is still Money.
 */
export function scale(m: Money, factor: number): Money {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`scale factor must be finite, received ${factor}`)
  }
  const raw = m.minor * factor
  const rounded = raw < 0 ? -Math.round(-raw) : Math.round(raw)
  return money(rounded, m.currency)
}

export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b)
  return a.minor === b.minor ? 0 : a.minor < b.minor ? -1 : 1
}

export function isZero(m: Money): boolean {
  return m.minor === 0
}

export function isNegative(m: Money): boolean {
  return m.minor < 0
}

export function abs(m: Money): Money {
  return money(Math.abs(m.minor), m.currency)
}

/**
 * Sum a list of same-currency amounts.
 *
 * An empty list requires an explicit currency: "zero" is meaningless without
 * knowing zero of what, and defaulting would silently mislabel an empty total.
 */
export function sum(amounts: readonly Money[], currency?: string): Money {
  if (amounts.length === 0) {
    if (!currency) {
      throw new Error('sum([]) requires an explicit currency — zero of which currency?')
    }
    return zero(currency)
  }
  const first = amounts[0] as Money
  const code = currency ? normaliseCurrency(currency) : first.currency
  let total = 0
  for (const m of amounts) {
    if (m.currency !== code) throw new CurrencyMismatchError(code, m.currency)
    total += m.minor
  }
  return money(total, code)
}

/** Locale-aware display string. Always carries the currency — screens are cross-currency. */
export function format(m: Money, locale?: string): string {
  const exponent = exponentOf(m.currency)
  const resolvedLocale = locale ?? (m.currency === 'INR' ? 'en-IN' : 'en-US')
  try {
    return new Intl.NumberFormat(resolvedLocale, {
      style: 'currency',
      currency: m.currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(m.minor / 10 ** exponent)
  } catch {
    // Unknown code — fall back to an unambiguous plain rendering.
    return `${toDecimalString(m)} ${m.currency}`
  }
}
