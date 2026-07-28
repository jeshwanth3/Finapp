import { isNegative, subtract, sum } from '@/core/money'
import { Money } from '@/components/Money'
import { SyncStatus } from '@/components/SyncStatus'
import { getStoreAccounts, getCashFlowRequest, getSyncState, today } from '@/app/store'
import { projectCashFlow } from '@/engine/cash-flow'

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function daysUntil(iso: string, from: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export default function TodayPage() {
  const t = today()
  const accounts = getStoreAccounts()
  const syncState = getSyncState()
  const hasCredentials = Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)

  // Format today for display
  const displayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // If no accounts, show onboarding
  if (accounts.length === 0) {
    return (
      <>
        <header className="page-header">
          <h1 className="page-title">Today</h1>
          <p className="page-sub">{displayDate}</p>
        </header>

        <SyncStatus
          lastSuccessAt={syncState.lastSuccessAt}
          consecutiveFailures={syncState.consecutiveFailures}
          hasCredentials={hasCredentials}
        />

        <section className="section">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
                  <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="empty-state-title">Connect your Gmail</div>
              <div className="empty-state-body">
                Finapp reads statement and alert emails to build your financial picture.
                Click &ldquo;Sync Now&rdquo; above to pull emails from your inbox.
              </div>
            </div>
          </div>
        </section>
      </>
    )
  }

  const checking = accounts.find((a) => a.kind === 'checking' && a.currency === 'USD')

  // Wire into the deterministic insight engine
  const req = getCashFlowRequest(t)
  const hasObligations = req.obligations.length > 0

  let troughDay: { date: string; closing: ReturnType<typeof import('@/core/money').money>; events: { label: string }[] } | null = null
  let displayDays: typeof projection.days = []
  let projection: ReturnType<typeof projectCashFlow> | null = null

  if (hasObligations && checking) {
    projection = projectCashFlow(req)
    troughDay = projection.days.reduce((lowest, day) =>
      day.closing.minor < lowest.closing.minor ? day : lowest,
      projection.days[0]!
    )
    displayDays = projection.days
      .filter((day, i) => day.events.length > 0 || i === 0 || i % 7 === 0)
      .slice(0, 10)
  }

  const next21 = (req.obligations ?? []).filter((ob) => {
    const days = daysUntil(ob.dueOn, t)
    return days >= 0 && days <= 21
  }).sort((a, b) => a.dueOn.localeCompare(b.dueOn))

  const hasDueSoon = next21.length > 0 && checking
  const dueSoon = hasDueSoon ? sum(next21.map((ob) => ob.amount), 'USD') : null
  const headroom = hasDueSoon ? subtract(checking!.balance, dueSoon!) : null

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Today</h1>
        <p className="page-sub">{displayDate}</p>
      </header>

      <SyncStatus
        lastSuccessAt={syncState.lastSuccessAt}
        consecutiveFailures={syncState.consecutiveFailures}
        hasCredentials={hasCredentials}
      />

      {/* Shortfall alert */}
      {troughDay && isNegative(troughDay.closing) && (
        <section className="section">
          <div className="alert alert-neg">
            <div className="alert-title">
              <span aria-hidden="true">▲</span> Projected shortfall on {formatDay(troughDay.date)}
            </div>
            <div className="alert-body">
              Checking is projected to reach <strong><Money value={troughDay.closing} /></strong> in {daysUntil(troughDay.date, t)} days
              because {troughDay.events[0]?.label ?? 'upcoming bills'} lands before payroll.
            </div>
          </div>
        </section>
      )}

      {/* Checking + headroom summary */}
      <section className="section">
        <div className="grid grid-2">
          {checking && (
            <div className="card">
              <div className="section-title">Checking</div>
              <div className="big-number num"><Money value={checking.balance} /></div>
              <div className="hint">{checking.institution} · observed {formatDay(checking.lastObservedAt)}</div>
            </div>
          )}
          {headroom && (
            <div className="card">
              <div className="section-title">After the next 21 days</div>
              <div className={`big-number num ${isNegative(headroom) ? 'neg' : ''}`}><Money value={headroom} /></div>
              <div className="hint">{next21.length} obligations totalling <Money value={dueSoon!} /></div>
            </div>
          )}
          {!checking && accounts.length > 0 && (
            <div className="card">
              <div className="section-title">Accounts found</div>
              <div className="big-number num">{accounts.length}</div>
              <div className="hint">No checking account detected yet — sync more emails</div>
            </div>
          )}
        </div>
      </section>

      {/* Coming up */}
      {next21.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="section-title">Coming up</h2><span className="hint">next 21 days</span></div>
          <div className="card card-tight">
            {next21.map((ob) => {
              const days = daysUntil(ob.dueOn, t)
              return (
                <div className="row" key={ob.id}>
                  <div className="row-main">
                    <div className="row-title">{ob.label}</div>
                    <div className="row-sub">
                      {formatDay(ob.dueOn)} · <span className={days <= 12 ? 'neg' : 'muted'}>in {days}d</span>
                    </div>
                  </div>
                  <div className="row-value num"><Money value={ob.amount} /></div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Projected balance */}
      {displayDays.length > 0 && (
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
            Projection computed from your statement due dates and detected recurring obligations.
          </p>
        </section>
      )}

      {/* All accounts overview */}
      {accounts.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="section-title">All accounts</h2><span className="hint">{accounts.length} connected</span></div>
          <div className="card card-tight">
            {accounts.map((acct) => (
              <div className="row" key={acct.id}>
                <div className="row-main">
                  <div className="row-title">{acct.displayName}</div>
                  <div className="row-sub">{acct.institution} · {acct.kind.replace('_', ' ')} · {acct.currency}</div>
                </div>
                <div className="row-value num"><Money value={acct.balance} /></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
