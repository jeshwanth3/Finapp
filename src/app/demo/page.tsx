import { isNegative, subtract, sum } from '@/core/money'
import { INSIGHTS } from '@/fixtures/demo'
import { Money } from '@/components/Money'
import { DemoBanner } from '@/components/DemoBanner'
import { getStoreAccounts, getCashFlowRequest } from '@/app/store'
import { projectCashFlow } from '@/engine/cash-flow'

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

export default function DemoPage() {
  const today = '2026-07-26'
  const accounts = getStoreAccounts()
  const checking = accounts.find((account) => account.kind === 'checking' && account.currency === 'USD')!

  // Wire into deterministic insight engine
  const req = getCashFlowRequest(today)
  const projection = projectCashFlow(req)

  // Find lowest point in projection
  const troughDay = projection.days.reduce((lowest, day) =>
    day.closing.minor < lowest.closing.minor ? day : lowest,
    projection.days[0]!
  )

  const next21 = (req.obligations ?? []).filter((obligation) => {
    const days = daysUntil(obligation.dueOn, today)
    return days >= 0 && days <= 21
  }).sort((a, b) => a.dueOn.localeCompare(b.dueOn))

  const dueSoon = sum(next21.map((obligation) => obligation.amount), 'USD')
  const headroom = subtract(checking.balance, dueSoon)

  // Highlight points for the projection table: days with events or every 7th day
  const displayDays = projection.days.filter((day, i) => day.events.length > 0 || i === 0 || i % 7 === 0).slice(0, 10)

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Today</h1>
        <p className="page-sub">Sample workspace · Saturday, 26 July 2026</p>
      </header>

      <DemoBanner />

      <section className="section">
        <div className="alert alert-neg">
          <div className="alert-title"><span aria-hidden="true">▲</span> Projected shortfall on {formatDay(troughDay.date)}</div>
          <div className="alert-body">
            Checking is projected to reach <strong><Money value={troughDay.closing} /></strong> in {daysUntil(troughDay.date, today)} days
            because {troughDay.events[0]?.label ?? 'upcoming bills'} lands before payroll.
          </div>
        </div>
      </section>

      <section className="section">
        <div className="grid grid-2">
          <div className="card">
            <div className="section-title">Checking</div>
            <div className="big-number num"><Money value={checking.balance} /></div>
            <div className="hint">{checking.institution} · observed {formatDay(checking.lastObservedAt)}</div>
          </div>
          <div className="card">
            <div className="section-title">After the next 21 days</div>
            <div className={`big-number num ${isNegative(headroom) ? 'neg' : ''}`}><Money value={headroom} /></div>
            <div className="hint">{next21.length} obligations totalling <Money value={dueSoon} /></div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">Needs a decision</h2></div>
        {INSIGHTS.filter((insight) => insight.severity === 'critical').map((insight) => (
          <article key={insight.id} className="card">
            <div className="inline" style={{ marginBottom: 'var(--sp-2)' }}>
              <span className="pill pill-neg">Critical</span>
              <span className="faint" style={{ fontSize: 12 }}>{insight.evidenceCount} supporting transactions</span>
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 640 }}>{insight.title}</h3>
            <p style={{ margin: 'var(--sp-2) 0 0', fontSize: 14, color: 'var(--text-muted)' }}>{insight.body}</p>
          </article>
        ))}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">Coming up</h2><span className="hint">next 21 days</span></div>
        <div className="card card-tight">
          {next21.map((obligation) => {
            const days = daysUntil(obligation.dueOn, today)
            return (
              <div className="row" key={obligation.id}>
                <div className="row-main">
                  <div className="row-title">{obligation.label}</div>
                  <div className="row-sub">
                    {formatDay(obligation.dueOn)} · <span className={days <= 12 ? 'neg' : 'muted'}>in {days}d</span>
                  </div>
                </div>
                <div className="row-value num"><Money value={obligation.amount} /></div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">Projected balance</h2></div>
        <div className="card card-tight">
          {displayDays.map((point) => (
            <div className="row" key={point.date}>
              <div className="row-main">
                <div className="row-title" style={{ fontWeight: 500 }}>{formatDay(point.date)}</div>
                {point.events.length > 0 && (
                  <div className="row-sub">{point.events.map((e) => e.label).join(' · ')}</div>
                )}
              </div>
              <div className={`row-value num ${isNegative(point.closing) ? 'neg' : ''}`}>
                <Money value={point.closing} />
              </div>
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 'var(--sp-2)' }}>
          Projection computed deterministically via <code>src/engine/cash-flow.ts</code>. Assumes payroll on the 1st and 15th. Inflow detection is low-confidence until three consistent deposits are observed.
        </p>
      </section>
    </>
  )
}
