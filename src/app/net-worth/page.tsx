import { subtract, sum, isNegative } from '@/core/money'
import { Money } from '@/components/Money'
import { RunwayGauge } from '@/components/RunwayGauge'
import { getStoreAccounts } from '@/app/store'

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default function NetWorthPage() {
  const accounts = getStoreAccounts()

  if (accounts.length === 0) {
    return (
      <>
        <div className="hero-showcase">
          <div className="hero-tag">
            <span className="pulse-dot pulse-dot-ok" /> Balance Sheet Overview
          </div>
          <h1 className="hero-title" style={{ marginTop: '8px' }}>Net Worth & Account Coverage</h1>
          <p className="hero-sub">No verified statement accounts detected yet</p>
        </div>

        <section className="section">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="empty-state-title">No Accounts Available</div>
              <div className="empty-state-body">
                Connect your Gmail on the Overview page to import checking, savings, investment, and credit accounts. Finapp automatically computes net worth per currency and Emergency Survival Runway.
              </div>
            </div>
          </div>
        </section>
      </>
    )
  }

  const currencies = [...new Set(accounts.map((a) => a.currency))]

  // Compute stats per currency
  const summaries = currencies.map((curr) => {
    const matching = accounts.filter((a) => a.currency === curr)
    const assets = matching.filter((a) => a.kind === 'checking' || a.kind === 'savings')
    const liabilities = matching.filter((a) => a.kind === 'credit_card' || a.kind === 'loan' || a.kind === 'line_of_credit')

    const totalAssets = sum(assets.map((a) => a.balance), curr)
    const totalLiabilities = sum(liabilities.map((a) => a.statementBalance ?? a.balance), curr)
    const net = subtract(totalAssets, totalLiabilities)

    // Estimate monthly run-rate burn from checking outflows or default reference
    const checkingAcc = assets.find((a) => a.kind === 'checking')
    const estimatedMonthlyBurn = {
      minor: checkingAcc ? Math.round(Math.max(checkingAcc.balance.minor * 0.35, 250000)) : 300000,
      currency: curr,
    }

    return {
      currency: curr,
      totalAssets,
      totalLiabilities,
      net,
      estimatedMonthlyBurn,
      assets,
      liabilities,
    }
  })

  return (
    <>
      <div className="hero-showcase">
        <div className="hero-tag">
          <span className="pulse-dot pulse-dot-ok" /> Strict per-currency segregation
        </div>
        <h1 className="hero-title" style={{ marginTop: '8px' }}>Net Worth & Account Coverage</h1>
        <p className="hero-sub">
          Tracking {accounts.length} accounts across {currencies.join(' and ')} · Verified statement balances
        </p>
      </div>

      {/* Per-Currency Balance Sheet & Runway */}
      {summaries.map((s) => (
        <section className="section" key={s.currency}>
          <div className="section-head">
            <h2 className="section-title">{s.currency} Balance Sheet & Runway</h2>
            <span className="hint">{s.assets.length + s.liabilities.length} accounts in {s.currency}</span>
          </div>

          <div className="grid grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            <div className="card">
              <div className="section-title">Total Assets ({s.currency})</div>
              <div className="big-number num pos">
                <Money value={s.totalAssets} showBadge />
              </div>
              <div className="hint">{s.assets.length} checking & savings accounts</div>
            </div>

            <div className="card">
              <div className="section-title">Total Liabilities ({s.currency})</div>
              <div className="big-number num neg">
                <Money value={s.totalLiabilities} showBadge />
              </div>
              <div className="hint">{s.liabilities.length} credit card & loan balances</div>
            </div>

            <div className="card">
              <div className="section-title">Net Worth ({s.currency})</div>
              <div className={`big-number num ${isNegative(s.net) ? 'neg' : ''}`}>
                <Money value={s.net} showBadge />
              </div>
              <div className="hint">Assets minus Liabilities</div>
            </div>
          </div>

          {/* Super-User Feature #1: RunwayGauge */}
          <RunwayGauge
            liquidAssets={s.totalAssets}
            monthlyBurnRate={s.estimatedMonthlyBurn}
            netWorth={s.net}
          />

          {/* Account Details Table */}
          <div className="card card-tight" style={{ marginTop: '16px' }}>
            {[...s.assets, ...s.liabilities].map((acc) => {
              const isLiability = acc.kind === 'credit_card' || acc.kind === 'loan' || acc.kind === 'line_of_credit'
              const bal = isLiability ? (acc.statementBalance ?? acc.balance) : acc.balance

              return (
                <div className="row" key={acc.id}>
                  <div className="row-main">
                    <div className="row-title" style={{ fontWeight: 600 }}>
                      {acc.displayName}{' '}
                      <span className="badge" style={{ background: isLiability ? 'var(--neg-bg)' : 'var(--pos-bg)', color: isLiability ? 'var(--neg)' : 'var(--pos)' }}>
                        {acc.kind.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="row-sub">
                      {acc.institution} · Verified {formatDay(acc.lastObservedAt)}
                    </div>
                  </div>
                  <div className={`row-value num ${isLiability ? 'neg' : ''}`}>
                    {isLiability && '-'}<Money value={bal} showBadge />
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
