import { Money } from '@/components/Money'
import { money, subtract } from '@/core/money'

interface RecurringStream {
  readonly id: string
  readonly label: string
  readonly currency: 'USD' | 'INR'
  readonly amount: ReturnType<typeof money>
  readonly cadence: string
  readonly source: string
  readonly insightFlag?: {
    readonly severity: 'critical' | 'warn' | 'info'
    readonly note: string
  }
}

export default function BudgetsPage() {
  const recurringStreams: RecurringStream[] = [
    {
      id: 'stream-rent',
      label: 'Avalon Residential Rent',
      currency: 'USD',
      amount: money(150000, 'USD'), // $1,500.00
      cadence: 'Monthly on the 3rd',
      source: 'Lease confirmation email',
    },
    {
      id: 'stream-zolve',
      label: 'Zolve Cross-Border Card Bill',
      currency: 'USD',
      amount: money(94117, 'USD'), // $941.17
      cadence: 'Monthly on the 7th',
      source: 'Statement PDF email alert',
      insightFlag: {
        severity: 'critical',
        note: 'Collides with Aug 5 card payment — projected checking shortfall',
      },
    },
    {
      id: 'stream-verve',
      label: 'Verve AI Subscription',
      currency: 'USD',
      amount: money(19754, 'USD'), // $197.54
      cadence: 'Quarterly',
      source: 'Renewal notice email',
      insightFlag: {
        severity: 'warn',
        note: 'Went up 18% in June ($120/yr more going forward)',
      },
    },
    {
      id: 'stream-canva',
      label: 'Canva* Design Team',
      currency: 'USD',
      amount: money(3200, 'USD'), // $32.00
      cadence: 'Monthly',
      source: 'Receipt email alert',
      insightFlag: {
        severity: 'info',
        note: 'Zombie subscription — billed twice since last inbox usage signal',
      },
    },
    {
      id: 'stream-fees',
      label: 'Avoidable Fee Leakage (Returned / FX fees)',
      currency: 'USD',
      amount: money(10400, 'USD'), // $104.00
      cadence: '12-month trailing total',
      source: 'Fee deduction alerts',
      insightFlag: {
        severity: 'warn',
        note: '2 returned payment fees & 3 foreign transaction fees detected',
      },
    },
  ]

  const totalUsdMonthly = money(150000 + 94117 + Math.round(19754 / 3) + 3200, 'USD')

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Budgets & Run-Rate</h1>
        <p className="page-sub">
          Email-detected recurring streams · Advisory only, never blocking
        </p>
      </header>

      <section className="section">
        <div className="alert">
          <div className="alert-title">Advisory run-rate — never nagging</div>
          <div className="alert-body">
            Finapp tracks your recurring obligations and subscription run-rate from email receipts and renewal notices. Below are the authentic recurring streams detected in your inbox survey, including inline pricing and fee leakage alerts.
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Detected Monthly Run-Rate (USD)</h2>
        </div>
        <div className="card">
          <div className="section-title">Fixed & Recurring Monthly Spend</div>
          <div className="big-number num">
            <Money value={totalUsdMonthly} />
          </div>
          <div className="hint">
            Includes rent, cross-border bills, and normalized quarterly subscriptions
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Recurring streams & subscriptions</h2>
          <span className="hint">Parsed from inbox receipts</span>
        </div>
        <div className="card card-tight">
          {recurringStreams.map((s) => (
            <div className="row" key={s.id}>
              <div className="row-main">
                <div className="row-title" style={{ fontWeight: 600 }}>
                  {s.label}
                </div>
                <div className="row-sub">
                  {s.cadence} · {s.source}
                </div>
                {s.insightFlag && (
                  <div style={{ marginTop: 4 }}>
                    <span
                      className={`pill ${
                        s.insightFlag.severity === 'critical'
                          ? 'pill-neg'
                          : s.insightFlag.severity === 'warn'
                          ? 'pill-warn'
                          : 'pill-info'
                      }`}
                      style={{ fontSize: 11, marginRight: 6 }}
                    >
                      {s.insightFlag.severity.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {s.insightFlag.note}
                    </span>
                  </div>
                )}
              </div>
              <div className="row-value num">
                <Money value={s.amount} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
