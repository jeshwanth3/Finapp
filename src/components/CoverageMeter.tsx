/**
 * Coverage meter — design spec §9.8, CLAUDE.md design rule 5.
 *
 * A net-worth figure may never render without this. Email cannot see every
 * asset, so the number is always partial; the question is only whether the
 * screen admits it. A confidently wrong net worth is worse than a visibly
 * incomplete one, because the first is acted on and the second is questioned.
 *
 * Deliberately not dismissible and deliberately adjacent to the figure rather
 * than in a footnote. A disclosure the reader has to go looking for is not one.
 */

export interface Coverage {
  /** 0..1. Share of known accounts with a recent observation. */
  ratio: number
  /** ISO date of the most recent observation feeding the figure. */
  asOf: string
  /** Accounts observed recently enough to trust. */
  observed: number
  /** Accounts known to exist, including stale and missing ones. */
  total: number
  /** Assets the app knows it cannot see. Named, so the gap is legible. */
  missing: readonly string[]
  /** Accounts whose last observation is older than the freshness window. */
  stale: readonly string[]
}

const FRESHNESS_DAYS = 10

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

/**
 * Compute coverage from the accounts actually feeding a figure.
 *
 * The ratio counts declared-missing assets against the denominator: an app that
 * knows about an asset it cannot price is less complete than one with nothing
 * missing, and the number should say so rather than quietly scoring 100%.
 */
export function computeCoverage(
  accounts: readonly { displayName: string; lastObservedAt: string }[],
  today: string,
  missing: readonly string[] = [],
): Coverage {
  const stale = accounts
    .filter((a) => daysBetween(a.lastObservedAt, today) > FRESHNESS_DAYS)
    .map((a) => a.displayName)

  const observed = accounts.length - stale.length
  const total = accounts.length + missing.length
  const asOf = accounts.reduce(
    (latest, a) => (a.lastObservedAt > latest ? a.lastObservedAt : latest),
    accounts[0]?.lastObservedAt ?? today,
  )

  return {
    ratio: total === 0 ? 0 : observed / total,
    asOf,
    observed,
    total,
    missing,
    stale,
  }
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function CoverageMeter({ coverage }: { coverage: Coverage }) {
  const pct = Math.round(coverage.ratio * 100)
  const complete = coverage.missing.length === 0 && coverage.stale.length === 0

  return (
    <div>
      <div className="coverage">
        <span className="coverage-track" role="img" aria-label={`Coverage ${pct} percent`}>
          <span className="coverage-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="num">
          {pct}% covered
        </span>
        <span className="faint">as of {formatDay(coverage.asOf)}</span>
      </div>

      <p className="hint" style={{ marginTop: 'var(--sp-2)' }}>
        {complete ? (
          <>Every known account has a recent observation.</>
        ) : (
          <>
            Based on {coverage.observed} of {coverage.total} known accounts.
            {coverage.missing.length > 0 && (
              <> Not included: {coverage.missing.join('; ')}.</>
            )}
            {coverage.stale.length > 0 && (
              <> Last seen over {FRESHNESS_DAYS} days ago: {coverage.stale.join('; ')}.</>
            )}
          </>
        )}
      </p>
    </div>
  )
}
