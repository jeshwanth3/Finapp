import { isNegative, subtract, sum } from '@/core/money'
import { ACCOUNTS, INSIGHTS, OBLIGATIONS, PROJECTION } from '@/fixtures/demo'
import { Money } from '@/components/Money'
import { DemoBanner } from '@/components/DemoBanner'

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
  const checking = ACCOUNTS.find((account) => account.kind === 'checking')!
  const trough = PROJECTION.reduce((lowest, point) => point.balance.minor < lowest.balance.minor ? point : lowest)
  const next21 = OBLIGATIONS.filter((obligation) => {
    const days = daysUntil(obligation.dueDate)
    return days >= 0 && days <= 21
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const dueSoon = sum(next21.map((obligation) => obligation.amount), 'USD')
  const headroom = subtract(checking.balance, dueSoon)

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Today</h1>
        <p className="page-sub">Sample workspace · Saturday, 26 July 2026</p>
      </header>

      <DemoBanner />

      <section className="section">
        <div className="alert alert-neg">
          <div className="alert-title"><span aria-hidden="true">▲</span> Projected shortfall on {formatDay(trough.date)}</div>
          <div className="alert-body">Checking is projected to reach <strong><Money value={trough.balance} /></strong> in {daysUntil(trough.date)} days because {trough.events[0]} lands before payroll.</div>
        </div>
      </section>

      <section className="section">
        <div className="grid grid-2">
          <div className="card"><div className="section-title">Checking</div><div className="big-number num"><Money value={checking.balance} /></div><div className="hint">{checking.institution} · observed {formatDay(checking.lastObservedAt)}</div></div>
          <div className="card"><div className="section-title">After the next 21 days</div><div className={`big-number num ${isNegative(headroom) ? 'neg' : ''}`}><Money value={headroom} /></div><div className="hint">{next21.length} obligations totalling <Money value={dueSoon} /></div></div>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">Needs a decision</h2></div>
        {INSIGHTS.filter((insight) => insight.severity === 'critical').map((insight) => (
          <article key={insight.id} className="card">
            <div className="inline" style={{ marginBottom: 'var(--sp-2)' }}><span className="pill pill-neg">Critical</span><span className="faint" style={{ fontSize: 12 }}>{insight.evidenceCount} supporting transactions</span></div>
            <h3 style={{ fontSize: 17, fontWeight: 640 }}>{insight.title}</h3>
            <p style={{ margin: 'var(--sp-2) 0 0', fontSize: 14, color: 'var(--text-muted)' }}>{insight.body}</p>
          </article>
        ))}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">Coming up</h2><span className="hint">next 21 days</span></div>
        <div className="card card-tight">
          {next21.map((obligation) => {
            const account = ACCOUNTS.find((item) => item.id === obligation.accountId)
            const days = daysUntil(obligation.dueDate)
            return <div className="row" key={obligation.id}><div className="row-main"><div className="row-title">{obligation.label}</div><div className="row-sub">{account?.institution} · {formatDay(obligation.dueDate)} · <span className={days <= 12 ? 'neg' : 'muted'}>in {days}d</span></div></div><div className="row-value num"><Money value={obligation.amount} /></div></div>
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">Projected balance</h2></div>
        <div className="card card-tight">
          {PROJECTION.map((point) => <div className="row" key={point.date}><div className="row-main"><div className="row-title" style={{ fontWeight: 500 }}>{formatDay(point.date)}</div>{point.events.length > 0 && <div className="row-sub">{point.events.join(' · ')}</div>}</div><div className={`row-value num ${isNegative(point.balance) ? 'neg' : ''}`}><Money value={point.balance} /></div></div>)}
        </div>
        <p className="hint" style={{ marginTop: 'var(--sp-2)' }}>Projection assumes payroll on the 1st and 15th. Inflow detection is low-confidence until three consistent deposits are observed.</p>
      </section>
    </>
  )
}
