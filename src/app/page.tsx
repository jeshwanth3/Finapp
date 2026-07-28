import Link from 'next/link'
import { isNegative, subtract, sum } from '@/core/money'
import { Money } from '@/components/Money'
import { SyncStatus } from '@/components/SyncStatus'
import { AstroGlobe3D } from '@/components/AstroGlobe3D'
import { CashFlow3DChart } from '@/components/CashFlow3DChart'
import { FxExposureCard } from '@/components/FxExposureCard'
import { getStoreAccounts, getCashFlowRequest, getSyncState, today } from '@/app/store'
import { projectCashFlow } from '@/engine/cash-flow'

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function daysUntil(iso: string, from: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export default function HomePage() {
  const t = today()
  const accounts = getStoreAccounts()
  const syncState = getSyncState()
  const hasCredentials = Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)

  const displayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // Empty state when no accounts are synced yet
  if (accounts.length === 0) {
    return (
      <>
        <div className="hero-showcase">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <div className="hero-tag">
                <span className="pulse-dot pulse-dot-ok" /> Live Financial Telemetry
              </div>
              <h1 className="hero-title" style={{ marginTop: '8px' }}>Financial Overview</h1>
              <p className="hero-sub">
                Autonomous cross-border cash-flow & net-worth intelligence. Connect Gmail to reconstruct checking balances, credit cards, and investments automatically.
              </p>
            </div>
            <div style={{ width: '180px' }}>
              <AstroGlobe3D />
            </div>
          </div>
        </div>

        <SyncStatus
          lastSuccessAt={syncState.lastSuccessAt}
          consecutiveFailures={syncState.consecutiveFailures}
          hasCredentials={hasCredentials}
        />

        <section className="section">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 3v18M3 12h18" strokeLinecap="round" />
                </svg>
              </div>
              <div className="empty-state-title">Connect Your Inbox to Begin</div>
              <div className="empty-state-body">
                Finapp parses statement and alert emails locally to reconstruct your financial accounts, credit balances, and recurring bills.
                <br /><br />
                Add your <strong>GMAIL_USER</strong> and <strong>GMAIL_APP_PASSWORD</strong> to your <code>.env.local</code> configuration, then click <strong>"↻ Sync Now"</strong> above.
              </div>
            </div>
          </div>
        </section>
      </>
    )
  }

  const checking = accounts.find((a) => a.kind === 'checking' && a.currency === 'USD')

  // Cash-flow projection (USD)
  const req = getCashFlowRequest(t)
  const obligations = req.obligations ?? []
  const hasObligations = obligations.length > 0

  type ProjectedDay = ReturnType<typeof projectCashFlow>['days'][number]
  let troughDay: ProjectedDay | null = null
  let displayDays: readonly ProjectedDay[] = []
  let projection: ReturnType<typeof projectCashFlow> | null = null

  if (hasObligations && checking) {
    projection = projectCashFlow(req)
    troughDay = projection.days.reduce((lowest, day) =>
      day.closing.minor < lowest.closing.minor ? day : lowest,
      projection.days[0]!
    )
    displayDays = projection.days.slice(0, 12)
  }

  const next21 = obligations.filter((ob) => {
    const days = daysUntil(ob.dueOn, t)
    return days >= 0 && days <= 21
  }).sort((a, b) => a.dueOn.localeCompare(b.dueOn))

  const hasDueSoon = next21.length > 0 && checking
  const dueSoon = hasDueSoon ? sum(next21.map((ob) => ob.amount), 'USD') : null
  const headroom = hasDueSoon ? subtract(checking!.balance, dueSoon!) : null

  const creditAccounts = accounts.filter((a) => a.kind === 'credit_card' || a.kind === 'loan')
  const currencies = [...new Set(accounts.map((a) => a.currency))]

  // Prepare FX Sector Summaries for <FxExposureCard />
  const fxSectors = currencies.map((curr) => {
    const matching = accounts.filter((a) => a.currency === curr)
    const assets = matching.filter((a) => a.kind === 'checking' || a.kind === 'savings')
    const liabilities = matching.filter((a) => a.kind === 'credit_card' || a.kind === 'loan' || a.kind === 'line_of_credit')
    const totalAssets = sum(assets.map((a) => a.balance), curr)
    const totalLiabilities = sum(liabilities.map((a) => a.statementBalance ?? a.balance), curr)
    return {
      currency: curr,
      netWorth: subtract(totalAssets, totalLiabilities),
      accountCount: matching.length,
    }
  })

  return (
    <>
      {/* 3D Motion Hero Showcase */}
      <div className="hero-showcase">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ flex: '1 1 340px' }}>
            <div className="hero-tag">
              <span className="pulse-dot pulse-dot-ok" /> Cross-Border Control · {currencies.join(' + ')}
            </div>
            <h1 className="hero-title" style={{ marginTop: '8px' }}>Financial Overview</h1>
            <p className="hero-sub">{displayDate} · Live email sync & cash-flow intelligence</p>
          </div>
          <div style={{ width: '170px', flexShrink: 0 }}>
            <AstroGlobe3D />
          </div>
        </div>
      </div>

      <SyncStatus
        lastSuccessAt={syncState.lastSuccessAt}
        consecutiveFailures={syncState.consecutiveFailures}
        hasCredentials={hasCredentials}
      />

      {/* Cross-Border FX Exposure & Allocation Bar */}
      <FxExposureCard sectors={fxSectors} />

      {/* Cash-Flow Shortfall Alert */}
      {troughDay && isNegative(troughDay.closing) && (
        <section className="section">
          <div className="alert alert-neg">
            <div className="alert-title">
              <span className="badge badge-alert">Shortfall Warning</span>
              <span>Projected checking deficit on {formatDay(troughDay.date)}</span>
            </div>
            <div className="alert-body">
              Your checking account balance is projected to reach <strong><Money value={troughDay.closing} showBadge /></strong> in {daysUntil(troughDay.date, t)} days
              after {troughDay.events[0]?.label ?? 'upcoming bills'}.
            </div>
          </div>
        </section>
      )}

      {/* Financial Pulse Stat Cards (Pure Black 3D Glass) */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Key Indicators</h2>
          <span className="hint">Strict per-currency calculation</span>
        </div>
        <div className="grid grid-4">
          {checking && (
            <div className="card">
              <div className="section-title">USD Checking Balance</div>
              <div className="big-number num"><Money value={checking.balance} showBadge /></div>
              <div className="hint">{checking.institution} · Observed {formatDay(checking.lastObservedAt)}</div>
            </div>
          )}
          {headroom && (
            <div className="card">
              <div className="section-title">21-Day Available Headroom</div>
              <div className={`big-number num ${isNegative(headroom) ? 'neg' : ''}`}><Money value={headroom} showBadge /></div>
              <div className="hint">{next21.length} upcoming bills · <Money value={dueSoon!} /> total due</div>
            </div>
          )}
          {creditAccounts.length > 0 && (
            <div className="card">
              <div className="section-title">Active Credit Cards & Loans</div>
              <div className="big-number num">{creditAccounts.length}</div>
              <div className="hint">Tracking balances & APR severity</div>
            </div>
          )}
          <div className="card">
            <div className="section-title">Total Connected Accounts</div>
            <div className="big-number num">{accounts.length}</div>
            <div className="hint">Across {currencies.join(' and ')} currencies</div>
          </div>
        </div>
      </section>

      {/* 3D Perspective Cash-Flow Chart + What-If Stress Tester */}
      {displayDays.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">10-Day Cash Flow Projection (3D Perspective)</h2>
            <span className="hint">Simulate extra payments with What-If sandbox below</span>
          </div>
          <div className="card">
            <CashFlow3DChart days={displayDays} currency="USD" />
          </div>
        </section>
      )}

      {/* Executive Feature Launchpads */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Personal Finance Control Modules</h2>
          <span className="hint">Select module for full breakdown</span>
        </div>
        <div className="launchpad-grid">
          <Link href="/debt" className="launchpad-card">
            <div className="launchpad-top">
              <div>
                <div className="launchpad-title">Debt & Credit Analysis</div>
                <div className="launchpad-desc">APR severity, statement balances & 30-day due calendar</div>
              </div>
              <div className="launchpad-icon">💳</div>
            </div>
            <div className="launchpad-stat">
              <span className="launchpad-stat-label">CREDIT CARDS & LOANS</span>
              <span className="launchpad-stat-val">{creditAccounts.length}</span>
            </div>
          </Link>

          <Link href="/net-worth" className="launchpad-card">
            <div className="launchpad-top">
              <div>
                <div className="launchpad-title">Net Worth & Runway</div>
                <div className="launchpad-desc">Emergency fund survival runway (months) & FI target meter</div>
              </div>
              <div className="launchpad-icon">🛡️</div>
            </div>
            <div className="launchpad-stat">
              <span className="launchpad-stat-label">CURRENCIES</span>
              <span className="launchpad-stat-val">{currencies.join(' / ')}</span>
            </div>
          </Link>

          <Link href="/investments" className="launchpad-card">
            <div className="launchpad-top">
              <div>
                <div className="launchpad-title">Investment Holdings</div>
                <div className="launchpad-desc">SIP confirmation tracking & Year-to-Date capital summary</div>
              </div>
              <div className="launchpad-icon">📈</div>
            </div>
            <div className="launchpad-stat">
              <span className="launchpad-stat-label">AUTO TRACKING</span>
              <span className="launchpad-stat-val" style={{ fontSize: '14px', color: 'var(--pos)' }}>● Active</span>
            </div>
          </Link>

          <Link href="/budgets" className="launchpad-card">
            <div className="launchpad-top">
              <div>
                <div className="launchpad-title">Budgets & Subscription Patrol</div>
                <div className="launchpad-desc">Automatic subscription annualizer ($19.99/mo → $239.88/yr)</div>
              </div>
              <div className="launchpad-icon">🔍</div>
            </div>
            <div className="launchpad-stat">
              <span className="launchpad-stat-label">DETECTION</span>
              <span className="launchpad-stat-val" style={{ fontSize: '14px' }}>Automatic</span>
            </div>
          </Link>
        </div>
      </section>

      {/* Upcoming Bills in Next 21 Days */}
      {next21.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Upcoming Bills (Next 21 Days)</h2>
            <span className="hint">{next21.length} bills scheduled</span>
          </div>
          <div className="card card-tight">
            {next21.map((ob) => {
              const days = daysUntil(ob.dueOn, t)
              return (
                <div className="row" key={ob.id}>
                  <div className="row-main">
                    <div className="row-title" style={{ fontWeight: 600 }}>
                      {ob.label}{' '}
                      {days <= 3 ? (
                        <span className="badge badge-alert">Due in {days}d</span>
                      ) : days <= 7 ? (
                        <span className="badge" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>Due in {days}d</span>
                      ) : null}
                    </div>
                    <div className="row-sub">
                      {formatDay(ob.dueOn)} · <span className={days <= 7 ? 'neg' : 'muted'}>in {days} days</span>
                    </div>
                  </div>
                  <div className="row-value num"><Money value={ob.amount} showBadge /></div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </>
  )
}
