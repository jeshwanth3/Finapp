/**
 * Placeholder for screens whose engine phase has not landed yet.
 * Names the phase so the gap is legible rather than looking broken.
 */
export function ComingSoon({
  title,
  phase,
  summary,
  blockedBy,
}: {
  title: string
  phase: string
  summary: string
  blockedBy?: string
}) {
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">{title}</h1>
        <p className="page-sub">{phase}</p>
      </header>

      <div className="card">
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>{summary}</p>
        {blockedBy && (
          <p className="hint" style={{ marginTop: 'var(--sp-3)', marginBottom: 0 }}>
            <strong>Waiting on:</strong> {blockedBy}
          </p>
        )}
      </div>
    </>
  )
}
