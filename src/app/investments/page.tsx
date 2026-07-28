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
  const accounts = getStoreAccounts()

  // Filter for brokerage/savings accounts that look like investments
  const investmentAccounts = accounts.filter(
    (a) => a.kind === 'savings' || a.institution.toLowerCase().includes('mutual') || a.institution.toLowerCase().includes('fund'),
  )

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Investments</h1>
        <p className="page-sub">
          Cross-border portfolio tracking · Holdings reconstructed from email alerts
        </p>
      </header>

      <section className="section">
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
                <path d="M3.5 15.5l5-5 3.5 3.5 8-8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15.5 6h4.5v4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="empty-state-title">Investment tracking</div>
            <div className="empty-state-body">
              Finapp reconstructs holdings from SIP confirmation emails and prices them against authoritative NAV data. Investment detection is active after Gmail sync — holdings will appear here as confirmation emails are parsed.
            </div>
          </div>
        </div>
      </section>

      {investmentAccounts.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Detected investment accounts</h2>
          </div>
          <div className="card card-tight">
            {investmentAccounts.map((acct) => (
              <div className="row" key={acct.id}>
                <div className="row-main">
                  <div className="row-title" style={{ fontWeight: 600 }}>
                    {acct.displayName} <span className="faint">({acct.currency})</span>
                  </div>
                  <div className="row-sub">
                    {acct.institution} · observed {formatDay(acct.lastObservedAt)}
                  </div>
                </div>
                <div className="row-value num">
                  <Money value={acct.balance} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
