import { format, isNegative, money, subtract, sum } from '@/core/money'
import { ACCOUNTS, INSIGHTS, OBLIGATIONS, PROJECTION } from '@/fixtures/demo'
import { Money } from '@/components/Money'
import { DemoBanner } from '@/components/DemoBanner'

function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function daysUntil(iso: string, from = '2026-07-26'): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${iso}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

export default function TodayPage() {
  const checking = ACCOUNTS.find((a) => a.kind === 'checking')!
  const trough = PROJECTION.reduce((lo, p) => (p.balance.minor < lo.balance.minor ? p : lo))
  const willGoNegative = isNegative(trough.balance)

  const next14 = OBLIGATIONS.filter((o) => {
    const d = daysUntil(o.dueDate)
    return d >= 0 && d <= 21
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  const dueSoonTotal = sum(next14.map((o) => o.amount), 'USD')
  const headroom = subtract(checking.balance, dueSoonTotal)

  const critical = INSIGHTS.filter((i) => i.severity === 'critical')

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Today</h1>
        <p className="page-sub">Saturday, 26 July 2026</p>
      </header>

      <DemoBanner />

      {willGoNegative && (
        <section className="section">
          <div className="alert alert-neg">
            <div className="alert-title">
              <span aria-hidden="true">▲</span>
              Projected shortfall on {formatDay(trough.date)}
            </div>
            <div className="alert-body">
              Checking is projected to reach{' '}
              <strong>
                <Money value={trough.balance} />
              </strong>{' '}
              — {Math.abs(daysUntil(trough.date))} days from now — because{' '}
              {trough.events[0] ?? 'a scheduled payment'} lands before payroll.
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="grid grid-2">
          <div className="card">
            <div className="section-title">Checking</div>
            <div className="big-number num">
              <Money value={checking.balance} />
            </div>
            <div className="hint">
              {checking.institution} · observed {formatDay(checking.lastObservedAt)}
            </div>
          </div>

          <div className="card">
            <div className="section-title">After the next 21 days</div>
            <div className={`big-number num ${isNegative(headroom) ? 'neg' : ''}`}>
              <Money value={headroom} />
            </div>
            <div className="hint">
              {next14.length} obligations totalling <Money value={dueSoonTotal} />
            </div>
          </div>
        </div>
      </section>

      {critical.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Needs a decision</h2>
          </div>
          {critical.map((i) => (
            <article key={i.id} className="card">
              <div className="inline" style={{ marginBottom: 'var(--sp-2)' }}>
                <span className="pill pill-neg">Critical</span>
                <span className="faint" style={{ fontSize: 12 }}>
                  {i.evidenceCount} supporting transactions
                </span>
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 640 }}>{i.title}</h3>
              <p style={{ margin: 'var(--sp-2) 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
                {i.body}
              </p>
            </article>
          ))}
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Coming up</h2>
          <span className="hint">next 21 days</span>
        </div>
        <div className="card card-tight">
          {next14.map((o) => {
            const acct = ACCOUNTS.find((a) => a.id === o.accountId)
            const d = daysUntil(o.dueDate)
            return (
              <div className="row" key={o.id}>
                <div className="row-main">
                  <div className="row-title">{o.label}</div>
                  <div className="row-sub">
                    {acct?.institution} · {formatDay(o.dueDate)}
                    {d <= 14 && (
                      <>
                        {' · '}
                        <span className={d <= 12 ? 'neg' : 'muted'}>in {d}d</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="row-value num">
                  <Money value={o.amount} />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Projected balance</h2>
        </div>
        <div className="card card-tight">
          {PROJECTION.map((p) => (
            <div className="row" key={p.date}>
              <div className="row-main">
                <div className="row-title" style={{ fontWeight: 500 }}>
                  {formatDay(p.date)}
                </div>
                {p.events.length > 0 && <div className="row-sub">{p.events.join(' · ')}</div>}
              </div>
              <div className={`row-value num ${isNegative(p.balance) ? 'neg' : ''}`}>
                <Money value={p.balance} />
              </div>
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 'var(--sp-2)' }}>
          Projection assumes payroll on the 1st and 15th. Inflow detection is
          low-confidence until three consistent deposits are observed.
        </p>
      </section>
    </>
  )
}
