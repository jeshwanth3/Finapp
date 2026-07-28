import { Money } from '@/components/Money'
import { CoverageMeter, computeCoverage } from '@/components/CoverageMeter'
import { getStoreAccounts, today } from '@/app/store'
import { money, subtract, sum } from '@/core/money'

export default function NetWorthPage() {
  const t = today()
  const accounts = getStoreAccounts()

  if (accounts.length === 0) {
    return (
      <>
        <header className="page-header">
          <h1 className="page-title">Net worth</h1>
          <p className="page-sub">No accounts found yet</p>
        </header>
        <section className="section">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
                  <path d="M4 18.5V13M9.5 18.5V7M15 18.5v-8M20.5 18.5V4" strokeLinecap="round" />
                </svg>
              </div>
              <div className="empty-state-title">No data yet</div>
              <div className="empty-state-body">
                Sync your Gmail to import account data. Net worth is computed from your checking balances (assets) and credit card balances (liabilities).
              </div>
            </div>
          </div>
        </section>
      </>
    )
  }

  const currencies = [...new Set(accounts.map((a) => a.currency))]
  const summaries = currencies.map((curr) => {
    const matching = accounts.filter((a) => a.currency === curr)
    const assets = matching.filter((a) => a.kind === 'checking' || a.kind === 'savings')
    const liabilities = matching.filter((a) => a.kind === 'credit_card' || a.kind === 'loan' || a.kind === 'line_of_credit')

    const totalAssets = sum(assets.map((a) => a.balance), curr)
    const totalLiabilities = sum(liabilities.map((a) => a.statementBalance ?? a.balance), curr)
    const netWorth = subtract(totalAssets, totalLiabilities)

    const coverage = computeCoverage(matching, t, [])

    return {
      currency: curr,
      totalAssets,
      totalLiabilities,
      netWorth,
      accountCount: matching.length,
      coverage,
      accounts: matching,
    }
  })

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Net worth</h1>
        <p className="page-sub">
          Coverage-aware assets minus liabilities · Per-currency segregation
        </p>
      </header>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Net worth by currency</h2>
        </div>
        <div className="grid grid-2">
          {summaries.map((summary) => (
            <div className="card" key={summary.currency}>
              <div className="section-title">{summary.currency} Net Worth</div>
              <div className="big-number num">
                <Money value={summary.netWorth} />
              </div>
              <div className="hint" style={{ marginTop: 'var(--sp-1)' }}>
                Assets <Money value={summary.totalAssets} /> · Liabilities{' '}
                <Money value={summary.totalLiabilities} />
              </div>
              <CoverageMeter coverage={summary.coverage} />
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Account balances</h2>
          <span className="hint">Asset (+) & Liability (-) breakdown</span>
        </div>
        <div className="card card-tight">
          {accounts.map((acct) => {
            const isAsset = acct.kind === 'checking' || acct.kind === 'savings'
            const val = isAsset ? acct.balance : (acct.statementBalance ?? acct.balance)
            return (
              <div className="row" key={acct.id}>
                <div className="row-main">
                  <div className="row-title" style={{ fontWeight: 600 }}>
                    {acct.displayName} <span className="faint">({acct.currency})</span>
                  </div>
                  <div className="row-sub">
                    {acct.institution} · {acct.kind.replace('_', ' ')} · observed {formatDay(acct.lastObservedAt)}
                  </div>
                </div>
                <div className="row-value num">
                  <span className={!isAsset ? 'neg' : ''}>
                    {!isAsset && '−'}<Money value={val} />
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
