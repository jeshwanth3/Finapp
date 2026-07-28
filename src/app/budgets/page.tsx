import { Money } from '@/components/Money'
import { getStoreAccounts, getRecentTransactions, today } from '@/app/store'
import { money, sum } from '@/core/money'

export default function BudgetsPage() {
  const accounts = getStoreAccounts()
  const transactions = getRecentTransactions(50)

  // Detect recurring patterns from transactions
  const merchantCounts = new Map<string, { count: number; total: number; currency: string; lastDate: string }>()
  for (const tx of transactions) {
    const key = tx.merchantRaw.toUpperCase()
    const existing = merchantCounts.get(key)
    if (existing) {
      existing.count++
      existing.total += Math.abs(tx.amount.minor)
      if (tx.postedAt > existing.lastDate) existing.lastDate = tx.postedAt
    } else {
      merchantCounts.set(key, {
        count: 1,
        total: Math.abs(tx.amount.minor),
        currency: tx.amount.currency,
        lastDate: tx.postedAt,
      })
    }
  }

  // Filter for likely recurring (2+ occurrences)
  const recurring = [...merchantCounts.entries()]
    .filter(([, v]) => v.count >= 2)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Budgets & Run-Rate</h1>
        <p className="page-sub">
          Email-detected recurring streams · Advisory only
        </p>
      </header>

      {transactions.length === 0 ? (
        <section className="section">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 3.5v8.5l6 3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="empty-state-title">No transactions yet</div>
              <div className="empty-state-body">
                Sync your Gmail to import transactions. Finapp will automatically detect recurring charges and subscription patterns from your email receipts.
              </div>
            </div>
          </div>
        </section>
      ) : (
        <>
          {recurring.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">Detected recurring merchants</h2>
                <span className="hint">Based on transaction frequency</span>
              </div>
              <div className="card card-tight">
                {recurring.map(([merchant, data]) => (
                  <div className="row" key={merchant}>
                    <div className="row-main">
                      <div className="row-title" style={{ fontWeight: 600 }}>{merchant}</div>
                      <div className="row-sub">
                        {data.count} transactions · last on {formatDay(data.lastDate)}
                      </div>
                    </div>
                    <div className="row-value num">
                      <Money value={money(data.total, data.currency)} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Recent transactions</h2>
              <span className="hint">{transactions.length} most recent</span>
            </div>
            <div className="card card-tight">
              {transactions.slice(0, 20).map((tx) => (
                <div className="row" key={tx.id}>
                  <div className="row-main">
                    <div className="row-title">{tx.merchantRaw}</div>
                    <div className="row-sub">
                      {formatDay(tx.postedAt)} · {tx.amount.currency}
                    </div>
                  </div>
                  <div className={`row-value num ${tx.amount.minor < 0 ? 'neg' : 'pos'}`}>
                    <Money value={tx.amount} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
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
