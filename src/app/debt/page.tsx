import { Money } from '@/components/Money'
import { AprGauge } from '@/components/AprGauge'
import { getDebtAccounts, today } from '@/app/store'
import { buildDebtMap, buildDueDateCalendar } from '@/engine/debt-map'

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function daysUntil(iso: string, from: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export default function DebtPage() {
  const t = today()
  const accounts = getDebtAccounts()

  if (accounts.length === 0) {
    return (
      <>
        <div className="hero-showcase">
          <div className="hero-tag">
            <span className="pulse-dot pulse-dot-ok" /> Debt & Credit Overview
          </div>
          <h1 className="hero-title" style={{ marginTop: '8px' }}>Debt & Credit Analysis</h1>
          <p className="hero-sub">No credit card or loan balances detected yet</p>
        </div>

        <section className="section">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                  <rect x="3" y="6" width="18" height="13" rx="2.5" />
                  <path d="M3 10.5h18" strokeLinecap="round" />
                </svg>
              </div>
              <div className="empty-state-title">No Credit Accounts Synced</div>
              <div className="empty-state-body">
                Connect your Gmail on the Overview page to import credit card statements and alert emails. Finapp automatically calculates statement balances, minimum payments, and APR severity.
              </div>
            </div>
          </div>
        </section>
      </>
    )
  }

  const debtMap = buildDebtMap(accounts, { today: t })
  const endDate = new Date(Date.parse(`${t}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10)
  const calendar = buildDueDateCalendar(accounts, { from: t, to: endDate })

  return (
    <>
      <div className="hero-showcase">
        <div className="hero-tag">
          <span className="pulse-dot pulse-dot-ok" /> Strict per-currency segregation
        </div>
        <h1 className="hero-title" style={{ marginTop: '8px' }}>Debt & Credit Analysis</h1>
        <p className="hero-sub">
          {accounts.length} active credit accounts · Updated {formatDay(debtMap.asOf)}
        </p>
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Total Balances by Currency</h2>
          <span className="hint">No cross-currency summing</span>
        </div>
        <div className="grid grid-2">
          {debtMap.totalsByCurrency.map((total) => (
            <div className="card" key={total.currency}>
              <div className="section-title">{total.currency} Total Credit Owed</div>
              <div className="big-number num">
                <Money value={total.totalOwed} showBadge />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '12px', color: 'var(--text-muted)' }}>
                <span>Minimum Payment Due: <strong className="num pos"><Money value={total.totalMinimumDue} /></strong></span>
                <span>{total.observedAccounts} of {total.totalAccounts} accounts verified</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Credit Accounts & APR Severity</h2>
          <span className="hint">Statement evidence & minimum due breakdown</span>
        </div>
        <div className="card card-tight">
          {debtMap.positions.map((pos) => {
            const days = pos.dueOn ? daysUntil(pos.dueOn, t) : undefined
            return (
              <div className="row" key={pos.accountId}>
                <div className="row-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span className="row-title" style={{ fontWeight: 600 }}>{pos.label}</span>
                    <AprGauge aprBasisPoints={pos.aprBasisPoints} isOverdue={days !== undefined && days < 0} />
                  </div>
                  <div className="row-sub">
                    {pos.institution} · {pos.dueOn ? `Due on ${formatDay(pos.dueOn)} (${days} days)` : 'No due date observed'}
                    {pos.asOf && ` · As of ${formatDay(pos.asOf)}`}
                  </div>
                </div>
                <div className="row-value num">
                  {pos.owed ? <Money value={pos.owed} showBadge /> : '—'}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">30-Day Due Date Calendar</h2>
          <span className="hint">Upcoming payment schedule</span>
        </div>
        <div className="card card-tight">
          {calendar.days.length === 0 ? (
            <div className="row">
              <div className="row-main">
                <div className="row-title">No upcoming due dates in the next 30 days</div>
              </div>
            </div>
          ) : (
            calendar.days.map((day) =>
              day.entries.map((entry) => {
                const days = daysUntil(day.date, t)
                return (
                  <div className="row" key={`${day.date}-${entry.accountId}`}>
                    <div className="row-main">
                      <div className="row-title" style={{ fontWeight: 600 }}>
                        {entry.label}{' '}
                        {days <= 5 && <span className="badge badge-alert">Due in {days}d</span>}
                      </div>
                      <div className="row-sub">
                        {formatDay(day.date)} · <span className={days <= 7 ? 'neg' : 'muted'}>in {days} days</span>
                        {entry.minimumDue && (
                          <> · Minimum payment: <Money value={entry.minimumDue} /></>
                        )}
                      </div>
                    </div>
                    <div className="row-value num">
                      {entry.amountDue ? <Money value={entry.amountDue} showBadge /> : '—'}
                    </div>
                  </div>
                )
              })
            )
          )}
        </div>
      </section>
    </>
  )
}
