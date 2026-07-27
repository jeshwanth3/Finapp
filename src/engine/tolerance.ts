/**
 * Amount tolerance — design spec §9.3.
 *
 * "Two charges belong to the same stream if the amounts differ by no more than
 * `max(2% of the expected amount, the currency's per-account absolute floor)` —
 * where the floor is configured per account in that account's own currency."
 *
 * The floor is what makes small subscriptions work: 2% of $9.99 is 20 cents, which
 * a sales-tax change alone will breach. The relative term is what makes large ones
 * work: a $1 floor on a ₹45,000 EMI is absurd precision. Neither term is optional.
 *
 * The floor is resolved per account, and its currency must match the account's, or
 * we throw. A floor of "100 minor units" silently applied across USD and INR is a
 * ₹1.00 tolerance on an Indian account — technically a number, and wrong.
 */

import { abs, compare, money, subtract, type Money } from '@/core/money'

export class MissingToleranceFloorError extends Error {
  constructor(accountId: string, currency: string) {
    super(
      `No absolute amount-tolerance floor configured for account ${JSON.stringify(accountId)} ` +
        `in ${currency}, and no built-in default exists for that currency. Configure one — ` +
        `guessing a floor silently changes which charges group into a stream.`,
    )
    this.name = 'MissingToleranceFloorError'
  }
}

export class ToleranceCurrencyMismatchError extends Error {
  constructor(accountId: string, expected: string, actual: string) {
    super(
      `Tolerance floor for account ${JSON.stringify(accountId)} is denominated in ${actual} ` +
        `but the account transacts in ${expected}. A floor is an amount, not a scalar.`,
    )
    this.name = 'ToleranceCurrencyMismatchError'
  }
}

export class EmptySeriesError extends Error {
  constructor(what: string) {
    super(`${what} requires at least one amount; an empty series has no median.`)
    this.name = 'EmptySeriesError'
  }
}

/** Spec §9.3's "2%". */
export const DEFAULT_RELATIVE_TOLERANCE = 0.02

/**
 * Built-in per-currency floors, in minor units. These are defaults of last resort;
 * a real deployment configures them per account. The values are the spec's own
 * examples ($1.00, ₹10) extended to the other currencies this app plausibly sees.
 */
export const DEFAULT_ABSOLUTE_FLOOR_MINOR: Readonly<Record<string, number>> = Object.freeze({
  USD: 100,
  INR: 1000,
  EUR: 100,
  GBP: 100,
  CAD: 100,
  AUD: 100,
  SGD: 100,
})

export interface ToleranceConfig {
  /** Fractional term. Defaults to 0.02. */
  readonly relative?: number
  /** Per-account floors, each in that account's own currency. Highest precedence. */
  readonly floorByAccount?: Readonly<Record<string, Money>>
  /** Fallback floors keyed by ISO-4217 code. */
  readonly floorByCurrency?: Readonly<Record<string, Money>>
}

export function resolveRelativeTolerance(cfg: ToleranceConfig | undefined): number {
  const r = cfg?.relative ?? DEFAULT_RELATIVE_TOLERANCE
  if (!Number.isFinite(r) || r < 0 || r > 1) {
    throw new RangeError(`relative tolerance must be a fraction in 0..1, got ${r}`)
  }
  return r
}

export function resolveAbsoluteFloor(
  accountId: string,
  currency: string,
  cfg: ToleranceConfig | undefined,
): Money {
  const perAccount = cfg?.floorByAccount?.[accountId]
  if (perAccount) {
    if (perAccount.currency !== currency) {
      throw new ToleranceCurrencyMismatchError(accountId, currency, perAccount.currency)
    }
    return perAccount
  }

  const perCurrency = cfg?.floorByCurrency?.[currency]
  if (perCurrency) {
    if (perCurrency.currency !== currency) {
      throw new ToleranceCurrencyMismatchError(accountId, currency, perCurrency.currency)
    }
    return perCurrency
  }

  const builtIn = DEFAULT_ABSOLUTE_FLOOR_MINOR[currency]
  if (builtIn === undefined) throw new MissingToleranceFloorError(accountId, currency)
  return money(builtIn, currency)
}

/** `max(relative x |expected|, floor)`, as Money in the expected amount's currency. */
export function amountTolerance(expected: Money, floor: Money, relative: number): Money {
  if (floor.currency !== expected.currency) {
    throw new ToleranceCurrencyMismatchError('<unknown>', expected.currency, floor.currency)
  }
  if (floor.minor < 0) throw new RangeError(`tolerance floor must not be negative: ${floor.minor}`)
  const relativeMinor = Math.round(Math.abs(expected.minor) * relative)
  return money(Math.max(relativeMinor, floor.minor), expected.currency)
}

/** True when `a` and `b` differ by no more than `tol`. Throws across currencies. */
export function withinTolerance(a: Money, b: Money, tol: Money): boolean {
  return compare(abs(subtract(a, b)), tol) <= 0
}

/**
 * Median of a same-currency series.
 *
 * For an even count this returns the lower of the two middle values rather than
 * their mean. Averaging would invent an amount that was never charged, and the
 * expected amount of a stream is used downstream as the baseline for a price step —
 * a fabricated baseline produces a fabricated delta.
 */
export function medianMoney(amounts: readonly Money[]): Money {
  const first = amounts[0]
  if (first === undefined) throw new EmptySeriesError('medianMoney')
  const sorted = [...amounts].sort((a, b) => compare(a, b))
  const mid = sorted[(sorted.length - 1) >> 1]
  if (mid === undefined) throw new EmptySeriesError('medianMoney')
  return mid
}
