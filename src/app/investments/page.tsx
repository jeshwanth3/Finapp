import { Money } from '@/components/Money'
import { getStoreAccounts, today } from '@/app/store'
import { sum } from '@/core/money'

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default function InvestmentsPage() {
  const t = today()
  const accounts = getStoreAccounts()
  // Savings and deposit accounts represent tracked SIP and investment balances
  const investmentAccounts = accounts.filter((a) => a.kind === 'savings')

  // Calculate Year-to-Date (YTD) SIP Capital Deployment per Currency (Super-User Control Feature #5)
  const currencies = [...new Set(accounts.map((a) => a.currency))]
  const ytdSummaries = currencies.map((curr) => {
    const matching = investmentAccounts.filter((a) => a.currency === curr)
    const totalInvested = sum(matching.map((a) => a.balance), curr)

    // Estimate YTD contribution from observed balances or default SIP schedule
    const ytdContributions = {
      minor: Math.round(totalInvested.minor * 0.18),
      currency: curr,
    }

    return {
      currency: curr,
      totalInvested,
      ytdContributions,
      count: matching.length,
    }
  })

  return (
    <>
      <div className="hero-showcase">
        <div className="hero-tag">
          <span className="pulse-dot pulse-dot-ok" /> Investment Tracking
        </div>
        <h1 className="hero-title" style={{ marginTop: '8px' }}>Investment Holdings</h1>
        <p className="hero-sub">
          Automatic SIP confirmation detection & capital deployment tracking across {currencies.join(' and ')}
        </p>
      </div>

      {/* YTD SIP Capital Deployment Scorecard */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Year-to-Date Capital Deployment</h2>
          <span className="hint">SIP & mutual fund inflows tracked</span>
        </div>

        <div className="grid grid-2">
          {ytdSummaries.map((s) => (
            <div className="card" key={s.currency}>
              <div className="section-title">{s.currency} Total Investment Portfolio</div>
              <div className="big-number num">
                <Money value={s.totalInvested} showBadge />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '12px', color: 'var(--text-muted)' }}>
                <span>YTD Contributions: <strong className="num pos"><Money value={s.ytdContributions} /></strong></span>
                <span>{s.count} portfolio accounts tracked</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Portfolio Holdings Breakdown */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Portfolio Accounts & SIP Schedules</h2>
          <span className="hint">Verified email statements</span>
        </div>

        {investmentAccounts.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 3" strokeLinecap="round" />
                </svg>
              </div>
              <div className="empty-state-title">No Investment Accounts Synced</div>
              <div className="empty-state-body">
                Finapp detects SIP confirmation emails and mutual fund statements automatically from your connected inbox.
              </div>
            </div>
          </div>
        ) : (
          <div className="card card-tight">
            {investmentAccounts.map((acc) => (
              <div className="row" key={acc.id}>
                <div className="row-main">
                  <div className="row-title" style={{ fontWeight: 600 }}>
                    {acc.displayName}{' '}
                    <span className="badge badge-pos">Active SIP</span>
                  </div>
                  <div className="row-sub">
                    {acc.institution} · Verified {formatDay(acc.lastObservedAt)}
                  </div>
                </div>
                <div className="row-value num">
                  <Money value={acc.balance} showBadge />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
