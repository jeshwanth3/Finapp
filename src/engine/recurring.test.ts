import { describe, expect, it } from 'vitest'
import { merchantKey } from '@/core/descriptor'
import { fromDecimalString, toDecimalString } from '@/core/money'
import type { IsoDate } from '@/core/date'
import {
  RecurringInputError,
  amountSeries,
  detectRecurringStreams,
  type EngineTransaction,
} from './recurring'
import { MissingToleranceFloorError, medianMoney } from './tolerance'

const usd = (s: string) => fromDecimalString(s, 'USD')
const inr = (s: string) => fromDecimalString(s, 'INR')

let counter = 0
function tx(
  date: IsoDate,
  amount: string,
  descriptor = 'NETFLIX.COM',
  overrides: Partial<EngineTransaction> = {},
): EngineTransaction {
  counter += 1
  return {
    id: `t${String(counter).padStart(4, '0')}`,
    accountId: 'chk-1',
    postedAt: date,
    // Negative: money leaving the account. Direction is carried by the sign.
    amount: fromDecimalString(`-${amount}`, 'USD'),
    descriptorRaw: descriptor,
    ...overrides,
  }
}

function detect(transactions: readonly EngineTransaction[], today: IsoDate) {
  return detectRecurringStreams(transactions, {
    today,
    floorByAccount: { 'chk-1': usd('1.00') },
  })
}

describe('cadence detection in calendar space', () => {
  it('detects a same-day-of-month monthly stream', () => {
    const dates: IsoDate[] = [
      '2026-01-05',
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
      '2026-05-05',
      '2026-06-05',
    ]
    const result = detect(
      dates.map((d) => tx(d, '15.49')),
      '2026-06-10',
    )
    expect(result.streams).toHaveLength(1)
    const s = result.streams[0]
    expect(s?.cadence).toEqual({ kind: 'monthly', intervalMonths: 1 })
    expect(s?.status).toBe('mature')
    expect(s?.occurrences).toHaveLength(6)
    expect(toDecimalString(s?.expectedAmount as never)).toBe('15.49')
    expect(s?.nextExpected).toBe('2026-07-05')
    expect(s?.direction).toBe('outflow')
    expect(s?.confidence).toBe('high')
  })

  it('detects a last-business-day stream that a day-gap model would shred', () => {
    // Gaps here are 28, 32, 30, 29, 32 days. No day-gap tolerance separates that
    // from a 4-weekly stream without also merging the two.
    const dates: IsoDate[] = [
      '2026-01-30',
      '2026-02-27',
      '2026-03-31',
      '2026-04-30',
      '2026-05-29',
      '2026-06-30',
    ]
    const result = detect(
      dates.map((d) => tx(d, '45.00', 'ACME GYM')),
      '2026-07-02',
    )
    expect(result.streams).toHaveLength(1)
    expect(result.streams[0]?.cadence).toEqual({ kind: 'last_business_day', intervalMonths: 1 })
    expect(result.streams[0]?.missedDates).toEqual([])
  })

  it('detects a weekly stream', () => {
    const dates: IsoDate[] = [
      '2026-01-06',
      '2026-01-13',
      '2026-01-20',
      '2026-01-27',
      '2026-02-03',
      '2026-02-10',
    ]
    const result = detect(
      dates.map((d) => tx(d, '12.00', 'CITY TRANSIT')),
      '2026-02-12',
    )
    expect(result.streams[0]?.cadence).toEqual({ kind: 'weekly', intervalWeeks: 1 })
  })

  it('separates a 4-weekly stream from a monthly one', () => {
    const dates: IsoDate[] = [
      '2026-01-06',
      '2026-02-03',
      '2026-03-03',
      '2026-03-31',
      '2026-04-28',
      '2026-05-26',
    ]
    const result = detect(
      dates.map((d) => tx(d, '30.00', 'BOX SUBSCRIPTION')),
      '2026-05-28',
    )
    expect(result.streams[0]?.cadence).toEqual({ kind: 'weekly', intervalWeeks: 4 })
  })

  it('detects a semi-monthly payroll on the 15th and the last business day', () => {
    const dates: IsoDate[] = [
      '2026-01-15',
      '2026-01-30',
      '2026-02-15',
      '2026-02-27',
      '2026-03-15',
      '2026-03-31',
    ]
    const result = detectRecurringStreams(
      dates.map((d, i) => ({
        id: `p${i}`,
        accountId: 'chk-1',
        postedAt: d,
        amount: usd('2400.00'),
        descriptorRaw: 'ACME CORP PAYROLL',
        kind: 'deposit' as const,
      })),
      { today: '2026-04-02', floorByAccount: { 'chk-1': usd('1.00') } },
    )
    expect(result.streams).toHaveLength(1)
    expect(result.streams[0]?.cadence.kind).toBe('semi_monthly')
    expect(result.streams[0]?.direction).toBe('inflow')
  })

  it('keeps an end-of-month monthly stream together across February', () => {
    const dates: IsoDate[] = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']
    const result = detect(
      dates.map((d) => tx(d, '9.99', 'CLOUD STORAGE')),
      '2026-05-02',
    )
    expect(result.streams).toHaveLength(1)
    expect(result.streams[0]?.occurrences).toHaveLength(4)
  })
})

describe('the status ladder', () => {
  it('calls two occurrences a candidate and three mature', () => {
    const two = detect([tx('2026-01-05', '15.49'), tx('2026-02-05', '15.49')], '2026-02-10')
    expect(two.streams[0]?.status).toBe('candidate')
    expect(two.streams[0]?.confidence).toBe('low')

    const three = detect(
      [tx('2026-01-05', '15.49'), tx('2026-02-05', '15.49'), tx('2026-03-05', '15.49')],
      '2026-03-10',
    )
    expect(three.streams[0]?.status).toBe('mature')
  })

  it('goes dormant after two missed expected charges', () => {
    const result = detect(
      [tx('2026-01-05', '15.49'), tx('2026-02-05', '15.49'), tx('2026-03-05', '15.49')],
      '2026-06-10',
    )
    const s = result.streams[0]
    expect(s?.consecutiveMissedSinceLastSeen).toBe(3)
    expect(s?.status).toBe('dormant')
    expect(s?.assumptions.some((a) => a.includes('may have been cancelled'))).toBe(true)
  })

  it('does not go dormant on the morning of its own due date', () => {
    const result = detect(
      [tx('2026-01-05', '15.49'), tx('2026-02-05', '15.49'), tx('2026-03-05', '15.49')],
      '2026-04-05',
    )
    expect(result.streams[0]?.consecutiveMissedSinceLastSeen).toBe(0)
    expect(result.streams[0]?.status).toBe('mature')
  })

  it('lets a confirmed cancellation outrank an inference from silence', () => {
    const transactions = [
      tx('2026-01-05', '15.49', 'SPOTIFY USA'),
      tx('2026-02-05', '15.49', 'SPOTIFY USA'),
      tx('2026-03-05', '15.49', 'SPOTIFY USA'),
    ]
    const result = detectRecurringStreams(transactions, {
      today: '2026-06-10',
      floorByAccount: { 'chk-1': usd('1.00') },
      cancellations: [
        {
          accountId: 'chk-1',
          merchantKey: merchantKey('SPOTIFY USA'),
          confirmedOn: '2026-03-20',
          sourceRef: 'msg-991',
        },
      ],
    })
    expect(result.streams[0]?.status).toBe('cancelled')
    expect(result.streams[0]?.cancelledOn).toBe('2026-03-20')
    expect(result.streams[0]?.nextExpected).toBeUndefined()
  })

  it('survives a skipped month without splitting or going dormant', () => {
    const result = detect(
      [
        tx('2026-01-05', '15.49'),
        tx('2026-02-05', '15.49'),
        // March skipped — a failed charge, retried the following cycle.
        tx('2026-04-05', '15.49'),
        tx('2026-05-05', '15.49'),
        tx('2026-06-05', '15.49'),
      ],
      '2026-06-10',
    )
    expect(result.streams).toHaveLength(1)
    const s = result.streams[0]
    expect(s?.status).toBe('mature')
    expect(s?.missedDates).toEqual(['2026-03-05'])
    expect(s?.occurrences).toHaveLength(5)
    expect(s?.confidence).toBe('medium')
  })
})

describe('amount tolerance', () => {
  it('absorbs drift inside max(2%, floor)', () => {
    const result = detect(
      [
        tx('2026-01-05', '12.99'),
        tx('2026-02-05', '13.10'),
        tx('2026-03-05', '13.25'),
        tx('2026-04-05', '13.40'),
      ],
      '2026-04-10',
    )
    expect(result.streams).toHaveLength(1)
    expect(result.streams[0]?.amountCoherence).toBe(1)
    // Median of an even-length series takes the lower middle rather than inventing
    // an amount that was never charged.
    expect(toDecimalString(result.streams[0]?.expectedAmount as never)).toBe('13.10')
  })

  it('keeps a price step inside one stream and marks the breach', () => {
    const result = detect(
      [
        tx('2026-01-05', '15.49'),
        tx('2026-02-05', '15.49'),
        tx('2026-03-05', '15.49'),
        tx('2026-04-05', '17.99'),
        tx('2026-05-05', '17.99'),
        tx('2026-06-05', '17.99'),
      ],
      '2026-06-10',
    )
    expect(result.streams).toHaveLength(1)
    const s = result.streams[0]
    if (!s) throw new Error('expected a stream')
    expect(s.occurrences.filter((o) => o.amountToleranceBreach)).toHaveLength(1)
    expect(s.occurrences.find((o) => o.amountToleranceBreach)?.date).toBe('2026-04-05')
    expect(amountSeries(s)).toHaveLength(6)
    expect(s.assumptions.some((a) => a.includes('price-step detection'))).toBe(true)
  })

  it('separates two concurrent subscriptions to the same merchant', () => {
    const result = detect(
      [
        tx('2026-01-05', '9.99'),
        tx('2026-01-05', '79.99'),
        tx('2026-02-05', '9.99'),
        tx('2026-02-05', '79.99'),
        tx('2026-03-05', '9.99'),
        tx('2026-03-05', '79.99'),
        tx('2026-04-05', '9.99'),
        tx('2026-04-05', '79.99'),
      ],
      '2026-04-10',
    )
    expect(result.streams).toHaveLength(2)
    const amounts = result.streams.map((s) => toDecimalString(s.expectedAmount)).sort()
    expect(amounts).toEqual(['79.99', '9.99'])
    for (const s of result.streams) {
      expect(s.occurrences).toHaveLength(4)
      expect(s.amountCoherence).toBe(1)
      expect(s.status).toBe('mature')
    }
    expect(new Set(result.streams.map((s) => s.streamKey)).size).toBe(2)
  })

  it('rejects habitual spend that fits a cadence but not an amount', () => {
    const result = detect(
      [
        tx('2026-01-05', '4.25', 'CORNER COFFEE'),
        tx('2026-01-07', '5.75', 'CORNER COFFEE'),
        tx('2026-01-09', '3.95', 'CORNER COFFEE'),
        tx('2026-01-12', '6.50', 'CORNER COFFEE'),
        tx('2026-01-14', '4.10', 'CORNER COFFEE'),
        tx('2026-01-16', '5.25', 'CORNER COFFEE'),
      ],
      '2026-01-20',
    )
    expect(result.streams).toHaveLength(0)
    expect(result.unassignedTransactionIds).toHaveLength(6)
  })

  it('uses the account currency floor, not a shared scalar', () => {
    const inrTx = (date: IsoDate, amount: string, id: string): EngineTransaction => ({
      id,
      accountId: 'hdfc-1',
      postedAt: date,
      amount: fromDecimalString(`-${amount}`, 'INR'),
      descriptorRaw: 'UPI/SWIGGY/9284712',
      region: 'IN',
    })
    const result = detectRecurringStreams(
      [
        inrTx('2026-01-05', '499.00', 'i1'),
        inrTx('2026-02-05', '504.00', 'i2'),
        inrTx('2026-03-05', '495.00', 'i3'),
      ],
      { today: '2026-03-10', floorByAccount: { 'hdfc-1': inr('10.00') } },
    )
    // 2% of Rs.499 is Rs.9.98, so the Rs.10 floor is what holds this together.
    expect(result.streams).toHaveLength(1)
    expect(result.streams[0]?.amountCoherence).toBe(1)
    expect(result.streams[0]?.currency).toBe('INR')
  })

  it('refuses to guess a floor for an unknown currency', () => {
    expect(() =>
      detectRecurringStreams(
        [
          {
            id: 'x1',
            accountId: 'zar-1',
            postedAt: '2026-01-05',
            amount: fromDecimalString('-100.00', 'ZAR'),
            descriptorRaw: 'SOME MERCHANT',
          },
          {
            id: 'x2',
            accountId: 'zar-1',
            postedAt: '2026-02-05',
            amount: fromDecimalString('-100.00', 'ZAR'),
            descriptorRaw: 'SOME MERCHANT',
          },
        ],
        { today: '2026-02-10' },
      ),
    ).toThrow(MissingToleranceFloorError)
  })
})

describe('exclusions', () => {
  it('excludes internal transfers and card payments by declared kind', () => {
    const result = detect(
      [
        tx('2026-01-05', '500.00', 'TRANSFER', { kind: 'internal_transfer' }),
        tx('2026-02-05', '500.00', 'TRANSFER', { kind: 'internal_transfer' }),
        tx('2026-01-20', '250.00', 'CHASE CARD', { kind: 'card_payment' }),
        tx('2026-02-20', '250.00', 'CHASE CARD', { kind: 'card_payment' }),
      ],
      '2026-03-01',
    )
    expect(result.streams).toHaveLength(0)
    expect(result.excluded.map((e) => e.reason).sort()).toEqual([
      'card_payment',
      'card_payment',
      'internal_transfer',
      'internal_transfer',
    ])
  })

  it('falls back to a narrow descriptor heuristic when kind is absent', () => {
    const result = detect(
      [
        tx('2026-01-05', '500.00', 'CHASE CREDIT CARD AUTOPAY'),
        tx('2026-02-05', '500.00', 'CHASE CREDIT CARD AUTOPAY'),
      ],
      '2026-03-01',
    )
    expect(result.streams).toHaveLength(0)
    expect(result.excluded[0]?.reason).toBe('descriptor_heuristic')
  })

  it('can be told to trust declared kinds only', () => {
    const result = detectRecurringStreams(
      [
        tx('2026-01-05', '500.00', 'CHASE CREDIT CARD AUTOPAY'),
        tx('2026-02-05', '500.00', 'CHASE CREDIT CARD AUTOPAY'),
        tx('2026-03-05', '500.00', 'CHASE CREDIT CARD AUTOPAY'),
      ],
      {
        today: '2026-03-10',
        floorByAccount: { 'chk-1': usd('1.00') },
        useDescriptorExclusionHeuristic: false,
      },
    )
    expect(result.streams).toHaveLength(1)
    expect(result.excluded).toHaveLength(0)
  })

  it('excludes zero-amount rows, which have no direction', () => {
    const result = detect(
      [
        { ...tx('2026-01-05', '0.00'), amount: usd('0.00') },
        tx('2026-02-05', '15.49'),
      ],
      '2026-03-01',
    )
    expect(result.excluded[0]?.reason).toBe('zero_amount')
  })
})

describe('no function ever returns a cross-currency sum', () => {
  it('refuses a merchant group whose rows span currencies', () => {
    expect(() =>
      detectRecurringStreams(
        [
          {
            id: 'm1',
            accountId: 'chk-1',
            postedAt: '2026-01-05',
            amount: usd('-15.49'),
            descriptorRaw: 'NETFLIX.COM',
          },
          {
            id: 'm2',
            accountId: 'chk-1',
            postedAt: '2026-02-05',
            amount: inr('-1299.00'),
            descriptorRaw: 'NETFLIX.COM',
          },
        ],
        { today: '2026-03-01', floorByAccount: { 'chk-1': usd('1.00') } },
      ),
    ).toThrow(RecurringInputError)
  })

  it('refuses to take a median across currencies', () => {
    expect(() => medianMoney([usd('1.00'), inr('1.00')])).toThrow()
  })

  it('reports every stream amount in the stream currency', () => {
    const result = detect(
      [tx('2026-01-05', '15.49'), tx('2026-02-05', '15.49'), tx('2026-03-05', '15.49')],
      '2026-03-10',
    )
    for (const s of result.streams) {
      expect(s.expectedAmount.currency).toBe(s.currency)
      expect(s.amountTolerance.currency).toBe(s.currency)
      for (const o of s.occurrences) expect(o.amount.currency).toBe(s.currency)
    }
  })
})

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    const build = () => [
      tx('2026-03-05', '15.49'),
      tx('2026-01-05', '15.49'),
      tx('2026-02-05', '15.49'),
    ]
    const a = detectRecurringStreams(
      build().map((t, i) => ({ ...t, id: `fixed-${i}` })),
      { today: '2026-03-10', floorByAccount: { 'chk-1': usd('1.00') } },
    )
    const b = detectRecurringStreams(
      build().map((t, i) => ({ ...t, id: `fixed-${i}` })),
      { today: '2026-03-10', floorByAccount: { 'chk-1': usd('1.00') } },
    )
    expect(a).toEqual(b)
  })
})
