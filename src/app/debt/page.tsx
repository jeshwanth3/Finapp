import { Money } from '@/components/Money'
import { getDebtAccounts, today } from '@/app/store'
import { buildDebtMap, buildDueDateCalendar, formatApr } from '@/engine/debt-map'

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
        <header className="page-header">
          <h1 className="page-title">Debt</h1>
          <p className="page-sub">No credit accounts found yet</p>
        </header>
        <section className="section">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
                  <rect x="2.5" y="6" width="19" height="12.5" rx="2.5" />
                  <path d="M2.5 10.5h19" strokeLinecap="round" />
                </svg>
              </div>
              <div className="empty-state-title">No credit accounts detected</div>
              <div className="empty-state-body">
                Sync your Gmail to import credit card statements and alert emails. Finapp will automatically detect your accounts and balances.
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
      <header className="page-header">
        <h1 className="page-title">Debt</h1>
        <p className="page-sub">
          {accounts.length} credit account{accounts.length !== 1 ? 's' : ''} · Observed as of {formatDay(debtMap.asOf)}
        </p>
      </header>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Totals by currency</h2>
          <span className="hint">Strictly per-currency</span>
        </div>
        <div className="grid grid-2">
          {debtMap.totalsByCurrency.map((total) => (
            <div className="card" key={total.currency}>
              <div className="section-title">{total.currency} Total Owed</div>
              <div className="big-number num">
                <Money value={total.totalOwed} />
              </div>
              <div className="hint">
                Minimum due: <Money value={total.totalMinimumDue} /> · Coverage: {Math.round(total.coverageRatio * 100)}% ({total.observedAccounts} of {total.totalAccounts} accounts)
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Due-date calendar</h2>
          <span className="hint">Next 30 days</span>
        </div>
        <div className="card card-tight">
          {calendar.days.length === 0 ? (
            <div className="row">
              <div className="row-main">
                <div className="row-title">No obligations due in this window</div>
              </div>
            </div>
          ) : (
            calendar.days.map((day) =>
              day.entries.map((entry) => {
                const days = daysUntil(day.date, t)
                return (
                  <div className="row" key={`${day.date}-${entry.accountId}`}>
                    <div className="row-main">
                      <div className="row-title">{entry.label}</div>
                      <div className="row-sub">
                        {formatDay(day.date)} · <span className={days <= 12 ? 'neg' : 'muted'}>in {days}d</span>
                        {entry.minimumDue && (
                          <> · min due <Money value={entry.minimumDue} /></>
                        )}
                      </div>
                    </div>
                    <div className="row-value num">
                      {entry.amountDue ? <Money value={entry.amountDue} /> : '—'}
                    </div>
                  </div>
                )
              })
            )
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Credit accounts</h2>
          <span className="hint">Evidence & APR breakdown</span>
        </div>
        <div className="card card-tight">
          {debtMap.positions.map((pos) => {
            const days = pos.dueOn ? daysUntil(pos.dueOn, t) : undefined
            return (
              <div className="row" key={pos.accountId}>
                <div className="row-main">
                  <div className="row-title" style={{ fontWeight: 600 }}>{pos.label}</div>
                  <div className="row-sub">
                    {pos.institution} · {pos.dueOn ? `Due ${formatDay(pos.dueOn)} (${days}d)` : 'No due date observed'}
                    {pos.aprBasisPoints !== undefined && ` · APR ${formatApr(pos.aprBasisPoints)}`}
                    {pos.asOf && ` · as of ${formatDay(pos.asOf)}`}
                  </div>
                </div>
                <div className="row-value num">
                  {pos.owed ? <Money value={pos.owed} /> : '—'}
                </div>
              </div>
            )
          })}
        </div>
        <p className="hint" style={{ marginTop: 'var(--sp-2)' }}>
          All totals grouped strictly by currency. No cross-currency sums — that requires a dated FX rate.
        </p>
      </section>
    </>
  )
}
