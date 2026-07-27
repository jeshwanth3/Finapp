import { describe, it, expect } from 'vitest'
import { money } from './money'
import { dedupeKey, reconcile, type Observation } from './reconcile'

function alert(o: Partial<Observation> & { sourceRef: string }): Observation {
  return {
    sourceType: 'alert',
    accountId: 'acct-usbank-checking',
    postedAt: '2026-07-15',
    amount: money(3600, 'USD'),
    descriptorRaw: 'SQ *COFFEE BAR',
    region: 'US',
    ...o,
  }
}

function line(o: Partial<Observation> & { sourceRef: string }): Observation {
  return {
    sourceType: 'statement_pdf',
    accountId: 'acct-usbank-checking',
    postedAt: '2026-07-17',
    amount: money(3600, 'USD'),
    descriptorRaw: 'SQ *COFFEE BAR 4821',
    region: 'US',
    ...o,
  }
}

describe('dedupeKey identifies an observation, not a transaction', () => {
  it('is stable for the same source re-parsed', () => {
    const a = alert({ sourceRef: 'msg-1' })
    expect(dedupeKey(a)).toBe(dedupeKey({ ...a }))
  })

  it('re-parsing the same email yields the same key — imports are idempotent', () => {
    const first = dedupeKey(alert({ sourceRef: 'msg-abc' }))
    const reparsed = dedupeKey(alert({ sourceRef: 'msg-abc', descriptorRaw: 'SQ *COFFEE BAR' }))
    expect(first).toBe(reparsed)
  })

  it('TWO IDENTICAL PURCHASES STAY TWO — the collapse bug this key exists to prevent', () => {
    // Same merchant, same amount, same day, two separate alert emails.
    const first = alert({ sourceRef: 'msg-1' })
    const second = alert({ sourceRef: 'msg-2' })
    expect(dedupeKey(first)).not.toBe(dedupeKey(second))
  })

  it('distinguishes lines within one statement by ordinal', () => {
    const l1 = line({ sourceRef: 'stmt-jul', ordinal: 0 })
    const l2 = line({ sourceRef: 'stmt-jul', ordinal: 1 })
    expect(dedupeKey(l1)).not.toBe(dedupeKey(l2))
  })

  it('distinguishes an alert from a statement line even with identical content', () => {
    expect(dedupeKey(alert({ sourceRef: 'x' }))).not.toBe(dedupeKey(line({ sourceRef: 'x' })))
  })

  it('is a hex digest, not the raw fields', () => {
    expect(dedupeKey(alert({ sourceRef: 'msg-1' }))).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('reconcile: statements are authoritative, alerts are provisional', () => {
  it('matches an alert to its statement line across a posting delay', () => {
    const plan = reconcile({
      alerts: [alert({ sourceRef: 'msg-1', postedAt: '2026-07-15' })],
      statementLines: [line({ sourceRef: 'stmt', ordinal: 0, postedAt: '2026-07-17' })],
    })
    expect(plan.matched).toHaveLength(1)
    expect(plan.unmatchedAlerts).toHaveLength(0)
    expect(plan.unmatchedStatementLines).toHaveLength(0)
    expect(plan.supersededAlertKeys).toEqual([dedupeKey(alert({ sourceRef: 'msg-1' }))])
  })

  it('flags an unmatched alert for review — never deletes it silently', () => {
    const plan = reconcile({
      alerts: [alert({ sourceRef: 'msg-1', amount: money(9999, 'USD') })],
      statementLines: [line({ sourceRef: 'stmt', ordinal: 0 })],
    })
    expect(plan.unmatchedAlerts).toHaveLength(1)
    expect(plan.unmatchedStatementLines).toHaveLength(1)
    expect(plan.matched).toHaveLength(0)
  })

  it('inserts a statement line the alerts never saw', () => {
    const plan = reconcile({
      alerts: [],
      statementLines: [line({ sourceRef: 'stmt', ordinal: 0 })],
    })
    expect(plan.unmatchedStatementLines).toHaveLength(1)
  })

  it('KEEPS TWO SAME-AMOUNT SAME-DAY CHARGES AS TWO', () => {
    const plan = reconcile({
      alerts: [
        alert({ sourceRef: 'msg-1', postedAt: '2026-07-15' }),
        alert({ sourceRef: 'msg-2', postedAt: '2026-07-15' }),
      ],
      statementLines: [
        line({ sourceRef: 'stmt', ordinal: 0, postedAt: '2026-07-15' }),
        line({ sourceRef: 'stmt', ordinal: 1, postedAt: '2026-07-15' }),
      ],
    })
    expect(plan.matched).toHaveLength(2)
    expect(plan.unmatchedAlerts).toHaveLength(0)
    expect(plan.unmatchedStatementLines).toHaveLength(0)
    // Each statement line is claimed exactly once.
    const claimed = plan.matched.map((m) => dedupeKey(m.statementLine))
    expect(new Set(claimed).size).toBe(2)
  })

  it('never matches one statement line to two alerts', () => {
    const plan = reconcile({
      alerts: [alert({ sourceRef: 'msg-1' }), alert({ sourceRef: 'msg-2' })],
      statementLines: [line({ sourceRef: 'stmt', ordinal: 0 })],
    })
    expect(plan.matched).toHaveLength(1)
    expect(plan.unmatchedAlerts).toHaveLength(1)
  })

  it('tolerates pending-to-posted amount drift within the configured allowance', () => {
    // Restaurant pre-auth $36.00, posts at $43.20 with tip.
    const plan = reconcile({
      alerts: [alert({ sourceRef: 'msg-1', amount: money(3600, 'USD') })],
      statementLines: [line({ sourceRef: 'stmt', ordinal: 0, amount: money(4320, 'USD') })],
      amountDriftRatio: 0.25,
    })
    expect(plan.matched).toHaveLength(1)
    expect(plan.matched[0]!.amountDeltaMinor).toBe(720)
  })

  it('does not tolerate drift beyond the allowance', () => {
    const plan = reconcile({
      alerts: [alert({ sourceRef: 'msg-1', amount: money(3600, 'USD') })],
      statementLines: [line({ sourceRef: 'stmt', ordinal: 0, amount: money(9000, 'USD') })],
      amountDriftRatio: 0.25,
    })
    expect(plan.matched).toHaveLength(0)
  })

  it('respects the date window', () => {
    const near = reconcile({
      alerts: [alert({ sourceRef: 'm', postedAt: '2026-07-15' })],
      statementLines: [line({ sourceRef: 's', ordinal: 0, postedAt: '2026-07-18' })],
      windowDays: 3,
    })
    expect(near.matched).toHaveLength(1)

    const far = reconcile({
      alerts: [alert({ sourceRef: 'm', postedAt: '2026-07-15' })],
      statementLines: [line({ sourceRef: 's', ordinal: 0, postedAt: '2026-07-25' })],
      windowDays: 3,
    })
    expect(far.matched).toHaveLength(0)
  })

  it('never matches across accounts', () => {
    const plan = reconcile({
      alerts: [alert({ sourceRef: 'm', accountId: 'acct-a' })],
      statementLines: [line({ sourceRef: 's', ordinal: 0, accountId: 'acct-b' })],
    })
    expect(plan.matched).toHaveLength(0)
  })

  it('never matches across currencies', () => {
    const plan = reconcile({
      alerts: [alert({ sourceRef: 'm', amount: money(3600, 'USD') })],
      statementLines: [line({ sourceRef: 's', ordinal: 0, amount: money(3600, 'INR') })],
    })
    expect(plan.matched).toHaveLength(0)
  })

  it('prefers the closer date when two candidates tie on amount', () => {
    const plan = reconcile({
      alerts: [alert({ sourceRef: 'm', postedAt: '2026-07-15' })],
      statementLines: [
        line({ sourceRef: 's', ordinal: 0, postedAt: '2026-07-18' }),
        line({ sourceRef: 's', ordinal: 1, postedAt: '2026-07-16' }),
      ],
    })
    expect(plan.matched).toHaveLength(1)
    expect(plan.matched[0]!.statementLine.postedAt).toBe('2026-07-16')
  })

  it('is deterministic — same input, same plan', () => {
    const input = {
      alerts: [alert({ sourceRef: 'm1' }), alert({ sourceRef: 'm2' })],
      statementLines: [
        line({ sourceRef: 's', ordinal: 0 }),
        line({ sourceRef: 's', ordinal: 1 }),
      ],
    }
    const a = reconcile(input)
    const b = reconcile(input)
    expect(a.matched.map((m) => dedupeKey(m.alert))).toEqual(
      b.matched.map((m) => dedupeKey(m.alert)),
    )
  })

  it('conserves observations — nothing is lost or invented', () => {
    const alerts = [alert({ sourceRef: 'm1' }), alert({ sourceRef: 'm2', amount: money(1, 'USD') })]
    const statementLines = [line({ sourceRef: 's', ordinal: 0 })]
    const plan = reconcile({ alerts, statementLines })

    expect(plan.matched.length + plan.unmatchedAlerts.length).toBe(alerts.length)
    expect(plan.matched.length + plan.unmatchedStatementLines.length).toBe(statementLines.length)
  })
})
