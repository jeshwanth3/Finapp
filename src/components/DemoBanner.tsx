/**
 * Every screen shows this until real ingestion lands.
 *
 * Deliberately not dismissible. An app about money that is showing invented numbers
 * must say so on every view — the moment a demo figure is mistaken for a real one,
 * the product has done the exact thing §9.8 forbids.
 */
export function DemoBanner() {
  return (
    <div
      className="card card-tight"
      style={{
        borderStyle: 'dashed',
        marginBottom: 'var(--sp-4)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-2)',
      }}
    >
      <span className="pill pill-neutral">Demo data</span>
      <span className="hint" style={{ flex: 1 }}>
        Invented figures. No account is connected yet.
      </span>
    </div>
  )
}
