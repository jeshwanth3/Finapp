import { describe, expect, it } from 'vitest'
import { fromDecimalString, toDecimalString } from '@/core/money'
import {
  CashFlowCurrencyError,
  CashFlowInputError,
  balanceOn,
  projectCashFlow,
  totalInflows,
  totalOutflows,
  type CashFlowRequest,
  type Obligation,
} from './cash-flow'

const usd = (s: string) => fromDecimalString(s, 'USD')
const inr = (s: string) => fromDecimalString(s, 'INR')

/**
 * The scenario the whole module exists for: July's failed bill, replayed in August.
 *
 * A $1,500 card payment clears on the 5th and leaves $293. A $941.17 bill lands on
 * the 7th, eight days before payroll. Nothing here is a forecast — every figure is
 * known in advance, which is exactly why the miss was avoidable.
 */
function augustScenario(overrides: Partial<CashFlowRequest> = {}): CashFlowRequest {
  const cardPayment: Obligation = {
    id: 'card-payment-aug',
    label: 'Chase card payment',
    dueOn: '2026-08-05',
    amount: usd('1500.00'),
    movable: true,
    latestMoveTo: '2026-08-20',
    confidence: 'high',
  }
  const bill: Obligation = {
    id: 'utility-bill-aug',
    label: 'City Power bill',
    dueOn: '2026-08-07',
    amount: usd('941.17'),
    movable: true,
    latestMoveTo: '2026-08-25',
    confidence: 'high',
  }
  return {
    today: '2026-08-01',
    horizonDays: 30,
    openingBalance: usd('1793.00'),
    floor: usd('100.00'),
    obligations: [cardPayment, bill],
    inflows: [
      {
        id: 'payroll-aug-15',
        label: 'Payroll',
        expectedOn: '2026-08-15',
        amount: usd('2800.00'),
        confidence: 'high',
      },
    ],
    ...overrides,
  }
}

describe('projectCashFlow — the August collision', () => {
  it('leaves exactly $293 after the card payment clears on the 5th', () => {
    const p = projectCashFlow(augustScenario())
    expect(toDecimalString(balanceOn(p, '2026-08-05') as never)).toBe('293.00')
    expect(toDecimalString(balanceOn(p, '2026-08-06') as never)).toBe('293.00')
  })

  it('flags the collision when the $941.17 bill lands before payroll', () => {
    const p = projectCashFlow(augustScenario())

    expect(p.collisions).toHaveLength(1)
    const c = p.collisions[0]
    if (!c) throw new Error('expected a collision')

    expect(c.from).toBe('2026-08-07')
    expect(c.worstDate).toBe('2026-08-07')
    expect(toDecimalString(c.worstBalance)).toBe('-648.17')
    // Floor is $100, so clearing the deepest point needs $748.17 more.
    expect(toDecimalString(c.shortfall)).toBe('748.17')
    expect(c.obligationIds).toContain('utility-bill-aug')
    // The breach persists right up to the payday itself, because a debit is assumed
    // to clear before that day's credit posts.
    expect(c.to).toBe('2026-08-15')
  })

  it('proposes the minimal remedy, and that remedy actually clears the collision', () => {
    const request = augustScenario()
    const p = projectCashFlow(request)
    const c = p.collisions[0]
    if (!c) throw new Error('expected a collision')

    const remedy = c.bestRemedy
    if (!remedy) throw new Error('expected a remedy')

    expect(remedy.kind).toBe('move_payment')
    expect(remedy.obligationId).toBe('utility-bill-aug')
    expect(remedy.fromDate).toBe('2026-08-07')
    // The 15th does not work: the bill would be debited before payroll posts.
    expect(remedy.toDate).toBe('2026-08-16')
    expect(remedy.displacementDays).toBe(9)
    expect(remedy.clearsAllBreaches).toBe(true)

    // The assertion that matters: apply the remedy and re-project from scratch.
    const applied = projectCashFlow({
      ...request,
      obligations: (request.obligations ?? []).map((o) =>
        o.id === remedy.obligationId ? { ...o, dueOn: remedy.toDate as string } : o,
      ),
    })
    expect(applied.collisions).toHaveLength(0)
    expect(applied.days.some((d) => d.belowFloor)).toBe(false)
    expect(toDecimalString(applied.lowestBalance)).toBe('293.00')
  })

  it('prefers the smaller displacement when several obligations could move', () => {
    const p = projectCashFlow(augustScenario())
    const c = p.collisions[0]
    if (!c) throw new Error('expected a collision')

    // Moving the card payment also works, but costs eleven days instead of nine.
    const cardRemedy = c.remedies.find((r) => r.obligationId === 'card-payment-aug')
    expect(cardRemedy?.toDate).toBe('2026-08-16')
    expect(cardRemedy?.displacementDays).toBe(11)
    expect(c.remedies[0]?.obligationId).toBe('utility-bill-aug')
  })

  it('offers pay-the-minimum when the obligation carries a minimum due', () => {
    const request = augustScenario({
      obligations: [
        {
          id: 'card-payment-aug',
          label: 'Chase card payment',
          dueOn: '2026-08-05',
          amount: usd('1500.00'),
          minimumDue: usd('45.00'),
          movable: false,
        },
        {
          id: 'utility-bill-aug',
          label: 'City Power bill',
          dueOn: '2026-08-07',
          amount: usd('941.17'),
          movable: false,
        },
      ],
    })
    const p = projectCashFlow(request)
    const c = p.collisions[0]
    if (!c) throw new Error('expected a collision')

    const remedy = c.bestRemedy
    expect(remedy?.kind).toBe('pay_minimum')
    expect(remedy?.obligationId).toBe('card-payment-aug')
    expect(toDecimalString(remedy?.reducedAmount as never)).toBe('45.00')
    expect(toDecimalString(remedy?.deferredAmount as never)).toBe('1455.00')

    const applied = projectCashFlow({
      ...request,
      obligations: (request.obligations ?? []).map((o) =>
        o.id === 'card-payment-aug' ? { ...o, amount: usd('45.00') } : o,
      ),
    })
    expect(applied.collisions).toHaveLength(0)
  })

  it('returns no remedy rather than a wrong one when nothing single-step works', () => {
    // The scenario has to genuinely collide, or this asserts nothing.
    // Opening 1793.00, floor 100.00:
    //   Aug 5  -1500.00 -> 293.00   (above floor)
    //   Aug 7   -941.17 -> -648.17  (breach)
    //   Aug 15 +2800.00 -> 2151.83
    // The card payment cannot move and carries no minimum, so it offers nothing.
    // The bill can only move as far as Aug 10 — still before payroll — so every
    // legal target date is equally underwater. No single step clears it.
    const p = projectCashFlow(
      augustScenario({
        obligations: [
          {
            id: 'card-payment-aug',
            label: 'Chase card payment',
            dueOn: '2026-08-05',
            amount: usd('1500.00'),
            movable: false,
          },
          {
            id: 'utility-bill-aug',
            label: 'City Power bill',
            dueOn: '2026-08-07',
            amount: usd('941.17'),
            movable: true,
            latestMoveTo: '2026-08-10',
          },
        ],
      }),
    )
    const c = p.collisions[0]
    if (!c) throw new Error('expected a collision')
    expect(c.remedies).toHaveLength(0)
    expect(c.bestRemedy).toBeUndefined()
  })
})

describe('projectCashFlow — determinism and honesty', () => {
  it('is a pure function of its inputs', () => {
    expect(projectCashFlow(augustScenario())).toEqual(projectCashFlow(augustScenario()))
  })

  it('always states the same-day ordering assumption', () => {
    const p = projectCashFlow(augustScenario())
    expect(p.assumptions.some((a) => a.includes('clear before credits'))).toBe(true)
  })

  it('carries a confidence level, downgraded by its weakest input', () => {
    const high = projectCashFlow(augustScenario())
    expect(high.confidence).toBe('high')

    const inferred = projectCashFlow(
      augustScenario({
        inflows: [
          {
            id: 'payroll-aug-15',
            label: 'Payroll (detected)',
            expectedOn: '2026-08-15',
            amount: usd('2800.00'),
            confidence: 'low',
          },
        ],
      }),
    )
    expect(inferred.confidence).toBe('low')
    expect(inferred.lowConfidenceInputs.map((i) => i.id)).toContain('payroll-aug-15')
  })

  it('flags a projection with no inflows at all as low confidence', () => {
    const p = projectCashFlow(augustScenario({ inflows: [] }))
    expect(p.confidence).toBe('low')
    expect(p.assumptions.some((a) => a.includes('pure drawdown'))).toBe(true)
  })

  it('reports obligations outside the horizon instead of dropping them silently', () => {
    const p = projectCashFlow(
      augustScenario({
        obligations: [
          {
            id: 'next-year',
            label: 'Annual insurance',
            dueOn: '2027-03-01',
            amount: usd('1200.00'),
          },
        ],
      }),
    )
    expect(p.outOfHorizonObligationIds).toEqual(['next-year'])
    expect(p.assumptions.some((a) => a.includes('next-year'))).toBe(true)
  })

  it('expands recurring inflows in calendar space', () => {
    const p = projectCashFlow({
      today: '2026-08-01',
      horizonDays: 60,
      openingBalance: usd('500.00'),
      floor: usd('0.00'),
      recurringInflows: [
        {
          id: 'salary',
          label: 'Salary',
          amount: usd('3000.00'),
          recurrence: { cadence: { kind: 'last_business_day', intervalMonths: 1 }, anchor: '2026-08-31' },
          confidence: 'medium',
        },
      ],
    })
    // 31 Aug 2026 is a Monday and 30 Sep a Wednesday — both are business days.
    expect(toDecimalString(totalInflows(p))).toBe('6000.00')
    expect(toDecimalString(totalOutflows(p))).toBe('0.00')
    expect(p.confidence).toBe('medium')
  })
})

describe('projectCashFlow — input rejection', () => {
  it('refuses a cross-currency obligation rather than converting it', () => {
    expect(() =>
      projectCashFlow(
        augustScenario({
          obligations: [
            { id: 'india-emi', label: 'HDFC EMI', dueOn: '2026-08-09', amount: inr('35882.00') },
          ],
        }),
      ),
    ).toThrow(CashFlowCurrencyError)
  })

  it('refuses a cross-currency floor', () => {
    expect(() => projectCashFlow(augustScenario({ floor: inr('1000.00') }))).toThrow(
      CashFlowCurrencyError,
    )
  })

  it('refuses a negative obligation amount', () => {
    expect(() =>
      projectCashFlow(
        augustScenario({
          obligations: [
            { id: 'weird', label: 'Refund?', dueOn: '2026-08-09', amount: usd('-40.00') },
          ],
        }),
      ),
    ).toThrow(CashFlowInputError)
  })

  it('refuses a minimum due larger than the amount owed', () => {
    expect(() =>
      projectCashFlow(
        augustScenario({
          obligations: [
            {
              id: 'bad-minimum',
              label: 'Card',
              dueOn: '2026-08-09',
              amount: usd('40.00'),
              minimumDue: usd('50.00'),
            },
          ],
        }),
      ),
    ).toThrow(CashFlowInputError)
  })

  it('refuses an out-of-range horizon', () => {
    expect(() => projectCashFlow(augustScenario({ horizonDays: 0 }))).toThrow(CashFlowInputError)
    expect(() => projectCashFlow(augustScenario({ horizonDays: 10_000 }))).toThrow(CashFlowInputError)
  })

  it('never produces a cross-currency total', () => {
    const p = projectCashFlow(augustScenario())
    expect(totalOutflows(p).currency).toBe('USD')
    expect(totalInflows(p).currency).toBe('USD')
    // And the underlying primitive still refuses to be tricked.
    expect(() => projectCashFlow({ ...augustScenario(), openingBalance: inr('100.00') })).toThrow(
      CashFlowCurrencyError,
    )
  })
})
