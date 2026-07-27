import { Money } from '@/components/Money'
import { getDebtAccounts } from '@/app/store'
import { buildDebtMap, buildDueDateCalendar, formatApr } from '@/engine/debt-map'

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function daysUntil(iso: string, from = '2026-07-26'): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export default function DebtPage() {
  const today = '2026-07-26'
  const accounts = getDebtAccounts()
  const debtMap = buildDebtMap(accounts, { today })
  const calendar = buildDueDateCalendar(accounts, { from: today, to: '2026-08-25' })

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Debt</h1>
        <p className="page-sub">
          {accounts.length} credit accounts across US and India · Observed as of {formatDay(debtMap.asOf)}
        </p>
      </header>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Totals by currency</h2>
          <span className="hint">Strictly per-currency (spec §7.1 & §9.1)</span>
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
                const days = daysUntil(day.date, today)
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
            const days = pos.dueOn ? daysUntil(pos.dueOn, today) : undefined
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
          All totals are grouped strictly by currency. Converting and summing across currencies would require a dated FX rate and create a number that goes silently wrong when rates move.
        </p>
      </section>
    </>
  )
}
