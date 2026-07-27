import { Money } from '@/components/Money'
import { money, sum } from '@/core/money'

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

interface Holding {
  readonly id: string
  readonly name: string
  readonly symbol: string
  readonly currency: 'USD' | 'INR'
  readonly units: number
  readonly price: number // minor units
  readonly totalValue: ReturnType<typeof money>
  readonly source: string
  readonly asOf: string
}

export default function InvestmentsPage() {
  const holdings: Holding[] = [
    {
      id: 'h-sbi-bluechip',
      name: 'SBI Bluechip Fund Direct Growth',
      symbol: 'SBIBLUE-DG',
      currency: 'INR',
      units: 1420.5,
      price: 8450, // ₹84.50
      totalValue: money(12003225, 'INR'), // ₹1,20,032.25
      source: 'SIP email confirmation + AMFI NAV',
      asOf: '2026-07-24',
    },
    {
      id: 'h-icici-us-bluechip',
      name: 'ICICI Prudential US Bluechip Equity Direct Plan Growth',
      symbol: 'ICICIUS-DG',
      currency: 'INR',
      units: 850.0,
      price: 6820, // ₹68.20
      totalValue: money(5797000, 'INR'), // ₹57,970.00
      source: 'SIP email confirmation + AMFI NAV',
      asOf: '2026-07-24',
    },
  ]

  const inrHoldings = holdings.filter((h) => h.currency === 'INR')
  const totalInr = sum(inrHoldings.map((h) => h.totalValue), 'INR')

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Investments</h1>
        <p className="page-sub">
          Cross-border portfolio tracking · Holdings reconstructed from SIP email alerts
        </p>
      </header>

      <section className="section">
        <div className="alert">
          <div className="alert-title">No bank login required — email & AMFI NAV driven</div>
          <div className="alert-body">
            Finapp reconstructs your Indian mutual fund holdings purely from SIP confirmation emails in your inbox, pricing them against authoritative AMFI daily NAVs. Employer equity (US RSUs/401k) is listed as unobserved in your Net Worth coverage until email confirmation parsing is enabled.
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Portfolio value by currency</h2>
        </div>
        <div className="grid grid-2">
          <div className="card">
            <div className="section-title">INR Mutual Funds Total</div>
            <div className="big-number num">
              <Money value={totalInr} />
            </div>
            <div className="hint">{inrHoldings.length} Indian SIP holdings · AMFI NAV as of Jul 24</div>
          </div>
          <div className="card">
            <div className="section-title">USD Employer Equity</div>
            <div className="big-number num" style={{ color: 'var(--text-muted)' }}>
              Unobserved
            </div>
            <div className="hint">Listed in missing Net Worth coverage (spec §9.8)</div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Holdings detail</h2>
          <span className="hint">Strictly per-currency</span>
        </div>
        <div className="card card-tight">
          {holdings.map((item) => (
            <div className="row" key={item.id}>
              <div className="row-main">
                <div className="row-title" style={{ fontWeight: 600 }}>
                  {item.name} <span className="faint">({item.symbol})</span>
                </div>
                <div className="row-sub">
                  {item.units.toLocaleString()} units · {item.source} · as of {formatDay(item.asOf)}
                </div>
              </div>
              <div className="row-value num">
                <Money value={item.totalValue} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
