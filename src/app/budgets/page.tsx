import { Money } from '@/components/Money'
import { getCashFlowRequest, today } from '@/app/store'
import { sum, money } from '@/core/money'
import type { Obligation } from '@/engine/cash-flow'

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default function BudgetsPage() {
  const t = today()
  const request = getCashFlowRequest(t)
  const recurring: readonly Obligation[] = request.obligations ?? []

  // Calculate annualized subscription costs per currency (Super-User Control Feature #3)
  const currencies = [...new Set(recurring.map((b: Obligation) => b.amount.currency))]
  const subscriptionSummaries = currencies.map((curr: string) => {
    const matching = recurring.filter((b: Obligation) => b.amount.currency === curr)
    const monthlyTotal = sum(matching.map((b: Obligation) => b.amount), curr)
    const annualTotal = money(monthlyTotal.minor * 12, curr)

    return {
      currency: curr,
      monthlyTotal,
      annualTotal,
      count: matching.length,
      items: matching,
    }
  })

  return (
    <>
      <div className="hero-showcase">
        <div className="hero-tag">
          <span className="pulse-dot pulse-dot-ok" /> Subscription Leakage Patrol
        </div>
        <h1 className="hero-title" style={{ marginTop: '8px' }}>Budgets & Recurring Expenses</h1>
        <p className="hero-sub">
          Automatic recurring charge detection, annualized cost projection, and subscription audit
        </p>
      </div>

      {/* Annualized Subscription Scorecards */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Annualized Subscription Run-Rate</h2>
          <span className="hint">Monthly × 12 annualized projection</span>
        </div>

        {subscriptionSummaries.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                  <rect x="4" y="4" width="16" height="16" rx="3" />
                  <path d="M8 12h8M12 8v8" strokeLinecap="round" />
                </svg>
              </div>
              <div className="empty-state-title">No Recurring Bills Detected</div>
              <div className="empty-state-body">
                Finapp analyzes connected Gmail statements to detect recurring monthly subscriptions, streaming services, and utilities automatically.
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-2">
            {subscriptionSummaries.map((s) => (
              <div className="card" key={s.currency}>
                <div className="section-title">{s.currency} Annual Subscription Run-Rate</div>
                <div className="big-number num neg">
                  <Money value={s.annualTotal} showBadge />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '12px', color: 'var(--text-muted)' }}>
                  <span>Monthly Spend: <strong className="num"><Money value={s.monthlyTotal} /></strong>/mo</span>
                  <span>{s.count} recurring subscriptions</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Subscription Leakage Patrol Audit List */}
      {subscriptionSummaries.map((s) => (
        <section className="section" key={s.currency}>
          <div className="section-head">
            <h2 className="section-title">{s.currency} Detected Subscriptions</h2>
            <span className="hint">Annualized leakage breakdown</span>
          </div>

          <div className="card card-tight">
            {s.items.map((item: Obligation) => {
              const annualized = money(item.amount.minor * 12, s.currency)

              return (
                <div className="row" key={item.id}>
                  <div className="row-main">
                    <div className="row-title" style={{ fontWeight: 600 }}>
                      {item.label}{' '}
                      <span className="badge" style={{ background: 'rgba(255, 184, 0, 0.15)', color: '#ffb800', border: '1px solid rgba(255, 184, 0, 0.3)' }}>
                        Monthly Recurring
                      </span>
                    </div>
                    <div className="row-sub">
                      Due around {formatDay(item.dueOn)} · Annualized cost:{' '}
                      <strong className="num"><Money value={annualized} />/yr</strong>
                    </div>
                  </div>
                  <div className="row-value num neg">
                    <Money value={item.amount} showBadge />
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>/ month</div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}
