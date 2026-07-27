/**
 * Debt map and due-date calendar — design spec §9.1.
 *
 * "Rendered as a calendar, not a table — the question is 'what's coming and when,'
 * not 'what's the list.'"
 *
 * The one rule this module will not bend on: **totals are grouped by currency and
 * never summed across them.** A single "total debt" figure spanning a US card and an
 * Indian loan requires a dated FX rate, and the moment such a number exists someone
 * will screenshot it, the rate will move, and the app will have been confidently
 * wrong. `DebtMap` has no field that could hold a grand total, which is deliberate —
 * the type system, not a code review, is what keeps it out.
 *
 * Coverage is reported alongside every total for the same reason §9.8 requires it
 * for net worth: a total that silently omits the account with no recent balance
 * reads as complete and is not.
 */

import { addDays, compareIsoDates, diffDays, isWithin, parseIsoDate, type IsoDate } from '@/core/date'
import { sum, zero, type Money } from '@/core/money'
import { weakestConfidence, type Confidence } from './confidence'

export class DebtMapError extends Error {
  constructor(reason: string) {
    super(`Debt map input rejected: ${reason}`)
    this.name = 'DebtMapError'
  }
}

export type DebtAccountKind = 'credit_card' | 'loan' | 'line_of_credit' | 'bnpl' | 'other'

export interface DebtAccount {
  readonly accountId: string
  readonly label: string
  readonly institution?: string
  /** ISO-4217. Every Money on this account must match it. */
  readonly currency: string
  readonly kind: DebtAccountKind
  /** Amount currently owed, as a positive magnitude. Absent when never observed. */
  readonly currentBalance?: Money
  readonly statementBalance?: Money
  readonly minimumDue?: Money
  readonly dueOn?: IsoDate
  /** APR in basis points — 2499 is 24.99%. Integer, because floats drift. */
  readonly aprBasisPoints?: number
  /** When the balance figures were observed. Absent means never. */
  readonly asOf?: IsoDate
  readonly confidence?: Confidence
  readonly assumptions?: readonly string[]
}

export interface DebtPosition {
  readonly accountId: string
  readonly label: string
  readonly institution?: string
  readonly currency: string
  readonly kind: DebtAccountKind
  readonly owed?: Money
  readonly statementBalance?: Money
  readonly minimumDue?: Money
  readonly dueOn?: IsoDate
  readonly daysUntilDue?: number
  readonly overdue: boolean
  readonly aprBasisPoints?: number
  readonly asOf?: IsoDate
  readonly observationAgeDays?: number
  readonly stale: boolean
  readonly confidence: Confidence
  readonly assumptions: readonly string[]
}

export interface CurrencyTotal {
  readonly currency: string
  /** Sum of observed balances only. Never spans currencies. */
  readonly totalOwed: Money
  readonly totalMinimumDue: Money
  readonly accountIds: readonly string[]
  /** Accounts contributing a balance / accounts in this currency. */
  readonly observedAccounts: number
  readonly totalAccounts: number
  readonly coverageRatio: number
  readonly missingBalanceAccountIds: readonly string[]
  readonly staleAccountIds: readonly string[]
  readonly confidence: Confidence
}

export interface DebtMap {
  readonly asOf: IsoDate
  readonly positions: readonly DebtPosition[]
  /** One entry per currency present. There is deliberately no cross-currency total. */
  readonly totalsByCurrency: readonly CurrencyTotal[]
  readonly assumptions: readonly string[]
}

export interface DueCalendarEntry {
  readonly accountId: string
  readonly label: string
  readonly kind: DebtAccountKind
  readonly currency: string
  readonly amountDue?: Money
  readonly minimumDue?: Money
  readonly confidence: Confidence
}

export interface DueCalendarDay {
  readonly date: IsoDate
  readonly entries: readonly DueCalendarEntry[]
  /** Per-currency totals for this day. Again, never one number. */
  readonly totalsByCurrency: readonly { readonly currency: string; readonly total: Money }[]
}

export interface DueDateCalendar {
  readonly from: IsoDate
  readonly to: IsoDate
  /** Only days that actually have something due. Empty days are not carried. */
  readonly days: readonly DueCalendarDay[]
  readonly overdueAccountIds: readonly string[]
  readonly undatedAccountIds: readonly string[]
}

/** Beyond this, a balance observation is old enough that it should be labelled. */
export const DEFAULT_STALENESS_DAYS = 35

export interface DebtMapOptions {
  readonly today: IsoDate
  readonly stalenessDays?: number
}

function checkCurrency(accountId: string, field: string, amount: Money, expected: string): void {
  if (amount.currency !== expected) {
    throw new DebtMapError(
      `account ${JSON.stringify(accountId)} is denominated in ${expected} but its ${field} is in ` +
        `${amount.currency}`,
    )
  }
}

function checkNonNegative(accountId: string, field: string, amount: Money): void {
  if (amount.minor < 0) {
    throw new DebtMapError(
      `account ${JSON.stringify(accountId)} has a negative ${field}; balances owed are carried as ` +
        `positive magnitudes so that a credit balance cannot masquerade as debt`,
    )
  }
}

function validate(a: DebtAccount): void {
  if (a.currentBalance) {
    checkCurrency(a.accountId, 'currentBalance', a.currentBalance, a.currency)
    checkNonNegative(a.accountId, 'currentBalance', a.currentBalance)
  }
  if (a.statementBalance) {
    checkCurrency(a.accountId, 'statementBalance', a.statementBalance, a.currency)
    checkNonNegative(a.accountId, 'statementBalance', a.statementBalance)
  }
  if (a.minimumDue) {
    checkCurrency(a.accountId, 'minimumDue', a.minimumDue, a.currency)
    checkNonNegative(a.accountId, 'minimumDue', a.minimumDue)
  }
  if (a.dueOn) parseIsoDate(a.dueOn)
  if (a.asOf) parseIsoDate(a.asOf)
  if (a.aprBasisPoints !== undefined) {
    if (!Number.isInteger(a.aprBasisPoints) || a.aprBasisPoints < 0 || a.aprBasisPoints > 100_000) {
      throw new DebtMapError(
        `account ${JSON.stringify(a.accountId)} has aprBasisPoints ${a.aprBasisPoints}; expected an ` +
          `integer count of basis points in 0..100000`,
      )
    }
  }
}

function positionFor(a: DebtAccount, today: IsoDate, stalenessDays: number): DebtPosition {
  validate(a)

  const assumptions: string[] = [...(a.assumptions ?? [])]
  const observationAgeDays = a.asOf === undefined ? undefined : diffDays(a.asOf, today)
  const stale = observationAgeDays === undefined || observationAgeDays > stalenessDays

  if (a.currentBalance === undefined) {
    assumptions.push(
      `No balance has been observed for ${a.label}; it contributes nothing to the total and is ` +
        `counted against coverage.`,
    )
  } else if (stale) {
    assumptions.push(
      `Balance for ${a.label} is ${
        observationAgeDays === undefined ? 'undated' : `${observationAgeDays} days old`
      } and may not reflect activity since.`,
    )
  }

  const daysUntilDue = a.dueOn === undefined ? undefined : diffDays(today, a.dueOn)

  // A stale or absent observation cannot support a high-confidence position, whatever
  // the caller asserted — this is the §9.8 honesty rule applied to the liability side.
  const declared: Confidence = a.confidence ?? (a.currentBalance ? 'high' : 'low')
  const confidence: Confidence = a.currentBalance === undefined
    ? 'low'
    : stale
      ? weakestConfidence([declared, 'medium'])
      : declared

  const base = {
    accountId: a.accountId,
    label: a.label,
    currency: a.currency,
    kind: a.kind,
    overdue: daysUntilDue !== undefined && daysUntilDue < 0,
    stale,
    confidence,
    assumptions,
  }

  return {
    ...base,
    ...(a.institution === undefined ? {} : { institution: a.institution }),
    ...(a.currentBalance === undefined ? {} : { owed: a.currentBalance }),
    ...(a.statementBalance === undefined ? {} : { statementBalance: a.statementBalance }),
    ...(a.minimumDue === undefined ? {} : { minimumDue: a.minimumDue }),
    ...(a.dueOn === undefined ? {} : { dueOn: a.dueOn }),
    ...(daysUntilDue === undefined ? {} : { daysUntilDue }),
    ...(a.aprBasisPoints === undefined ? {} : { aprBasisPoints: a.aprBasisPoints }),
    ...(a.asOf === undefined ? {} : { asOf: a.asOf }),
    ...(observationAgeDays === undefined ? {} : { observationAgeDays }),
  }
}

export function buildDebtMap(accounts: readonly DebtAccount[], options: DebtMapOptions): DebtMap {
  parseIsoDate(options.today)
  const stalenessDays = options.stalenessDays ?? DEFAULT_STALENESS_DAYS
  if (!Number.isInteger(stalenessDays) || stalenessDays < 0) {
    throw new DebtMapError(`stalenessDays must be a non-negative integer, got ${stalenessDays}`)
  }

  const seen = new Set<string>()
  for (const a of accounts) {
    if (seen.has(a.accountId)) {
      throw new DebtMapError(`duplicate accountId ${JSON.stringify(a.accountId)}`)
    }
    seen.add(a.accountId)
  }

  const positions = accounts
    .map((a) => positionFor(a, options.today, stalenessDays))
    .sort((x, y) => {
      // Soonest due first; undated accounts sink to the bottom rather than
      // pretending to be due today.
      const dx = x.dueOn
      const dy = y.dueOn
      if (dx && dy && dx !== dy) return compareIsoDates(dx, dy)
      if (dx && !dy) return -1
      if (!dx && dy) return 1
      return x.accountId < y.accountId ? -1 : x.accountId > y.accountId ? 1 : 0
    })

  const currencies = [...new Set(positions.map((p) => p.currency))].sort()
  const totalsByCurrency: CurrencyTotal[] = currencies.map((currency) => {
    const group = positions.filter((p) => p.currency === currency)
    const owed = group.flatMap((p) => (p.owed ? [p.owed] : []))
    const minimums = group.flatMap((p) => (p.minimumDue ? [p.minimumDue] : []))
    const missing = group.filter((p) => p.owed === undefined).map((p) => p.accountId)
    const staleIds = group.filter((p) => p.owed !== undefined && p.stale).map((p) => p.accountId)

    return {
      currency,
      // `sum` itself throws on a mixed-currency list, so this is belt and braces.
      totalOwed: sum(owed, currency),
      totalMinimumDue: sum(minimums, currency),
      accountIds: group.map((p) => p.accountId),
      observedAccounts: owed.length,
      totalAccounts: group.length,
      coverageRatio: group.length === 0 ? 0 : owed.length / group.length,
      missingBalanceAccountIds: missing,
      staleAccountIds: staleIds,
      confidence: weakestConfidence(group.map((p) => p.confidence)),
    }
  })

  const assumptions = new Set<string>([
    'Totals are reported per currency. No cross-currency total is produced, because that ' +
      'requires a dated FX rate and would go stale silently.',
    `A balance observation older than ${stalenessDays} days is marked stale and downgrades its ` +
      `account confidence.`,
  ])
  for (const p of positions) for (const a of p.assumptions) assumptions.add(a)

  return { asOf: options.today, positions, totalsByCurrency, assumptions: [...assumptions] }
}

export interface DueCalendarOptions {
  readonly from: IsoDate
  /** Inclusive end. Supply either this or `horizonDays`. */
  readonly to?: IsoDate
  readonly horizonDays?: number
}

export function buildDueDateCalendar(
  accounts: readonly DebtAccount[],
  options: DueCalendarOptions,
): DueDateCalendar {
  parseIsoDate(options.from)
  if ((options.to === undefined) === (options.horizonDays === undefined)) {
    throw new DebtMapError('supply exactly one of `to` or `horizonDays`')
  }
  let to: IsoDate
  if (options.to !== undefined) {
    parseIsoDate(options.to)
    to = options.to
  } else {
    const h = options.horizonDays as number
    if (!Number.isInteger(h) || h < 0) {
      throw new DebtMapError(`horizonDays must be a non-negative integer, got ${h}`)
    }
    to = addDays(options.from, h)
  }
  if (compareIsoDates(to, options.from) < 0) {
    throw new DebtMapError(`calendar end ${to} precedes start ${options.from}`)
  }

  const byDate = new Map<IsoDate, DueCalendarEntry[]>()
  const overdue: string[] = []
  const undated: string[] = []

  for (const a of accounts) {
    validate(a)
    if (a.dueOn === undefined) {
      undated.push(a.accountId)
      continue
    }
    if (compareIsoDates(a.dueOn, options.from) < 0) {
      overdue.push(a.accountId)
      continue
    }
    if (!isWithin(a.dueOn, options.from, to)) continue

    const entry: DueCalendarEntry = {
      accountId: a.accountId,
      label: a.label,
      kind: a.kind,
      currency: a.currency,
      confidence: a.confidence ?? (a.statementBalance ?? a.currentBalance ? 'high' : 'low'),
      ...(a.statementBalance ?? a.currentBalance
        ? { amountDue: (a.statementBalance ?? a.currentBalance) as Money }
        : {}),
      ...(a.minimumDue === undefined ? {} : { minimumDue: a.minimumDue }),
    }
    const bucket = byDate.get(a.dueOn)
    if (bucket) bucket.push(entry)
    else byDate.set(a.dueOn, [entry])
  }

  const days: DueCalendarDay[] = [...byDate.entries()]
    .sort((a, b) => compareIsoDates(a[0], b[0]))
    .map(([date, entriesRaw]) => {
      const entries = entriesRaw
        .slice()
        .sort((x, y) => (x.accountId < y.accountId ? -1 : x.accountId > y.accountId ? 1 : 0))
      const currencies = [...new Set(entries.map((e) => e.currency))].sort()
      return {
        date,
        entries,
        totalsByCurrency: currencies.map((currency) => ({
          currency,
          total: sum(
            entries.flatMap((e) => (e.currency === currency && e.amountDue ? [e.amountDue] : [])),
            currency,
          ),
        })),
      }
    })

  return {
    from: options.from,
    to,
    days,
    overdueAccountIds: overdue.slice().sort(),
    undatedAccountIds: undated.slice().sort(),
  }
}

/** "24.99%" from 2499. Presentation-only; APR never enters an amount calculation here. */
export function formatApr(basisPoints: number): string {
  if (!Number.isInteger(basisPoints)) {
    throw new DebtMapError(`aprBasisPoints must be an integer, got ${basisPoints}`)
  }
  const whole = Math.trunc(basisPoints / 100)
  const frac = Math.abs(basisPoints % 100)
  return `${whole}.${String(frac).padStart(2, '0')}%`
}

/** Zero owed in a given currency — for rendering an account with no observation yet. */
export function zeroOwed(currency: string): Money {
  return zero(currency)
}
