import styles from './landing.module.css'

// Institutions Finapp already has parsers for. Real capability beats invented
// customer logos — this row tells a visitor whether their bank is covered.
const institutions = ['Chase', 'Amex', 'Discover', 'US Bank', 'SBI Card', 'Zolve']

function LogoMark() {
  return (
    <span className={styles.logoMark} aria-hidden="true">
      <svg viewBox="0 0 42 42" fill="none">
        <path d="M9 24c2.8-11.5 7.5 7.2 11.2-5.2 2.6-8.5 5.7 10 12.4-4.3" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function Decorations() {
  return (
    <div className={styles.decorations} aria-hidden="true">
      <svg className={`${styles.shape} ${styles.triangle}`} viewBox="0 0 110 100">
        <path d="M55 8 101 91H9L55 8Z" fill="#ff5b57" stroke="#17140d" strokeWidth="6" strokeLinejoin="round" />
      </svg>
      <svg className={`${styles.shape} ${styles.arc}`} viewBox="0 0 110 110">
        <path d="M8 102V8h94A94 94 0 0 1 8 102Z" fill="#12b3a4" stroke="#17140d" strokeWidth="6" strokeLinejoin="round" />
      </svg>
      <svg className={`${styles.shape} ${styles.dottedCircle}`} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="41" fill="#ffc531" stroke="#17140d" strokeWidth="5" />
        <circle cx="31" cy="31" r="4" fill="#17140d" />
        <circle cx="57" cy="27" r="4" fill="#17140d" />
        <circle cx="70" cy="51" r="4" fill="#17140d" />
        <circle cx="47" cy="72" r="4" fill="#17140d" />
        <circle cx="25" cy="58" r="4" fill="#17140d" />
      </svg>
      <svg className={`${styles.shape} ${styles.plus}`} viewBox="0 0 100 100">
        <path d="M39 7h22v32h32v22H61v32H39V61H7V39h32V7Z" fill="#6b5be6" stroke="#17140d" strokeWidth="6" strokeLinejoin="round" />
      </svg>
      <svg className={`${styles.shape} ${styles.squiggle}`} viewBox="0 0 170 90" fill="none">
        <path d="M8 47c13-46 30 34 45-1 12-27 21-11 31 9 14 28 27-49 45-17 10 17 16 29 33-3" stroke="#17140d" strokeWidth="8" strokeLinecap="round" />
      </svg>
      <svg className={`${styles.shape} ${styles.halfCircle}`} viewBox="0 0 140 75">
        <path d="M6 69a64 64 0 0 1 128 0H6Z" fill="#ffc531" stroke="#17140d" strokeWidth="6" strokeLinejoin="round" />
      </svg>
      <span className={`${styles.shape} ${styles.dot}`} />
      <svg className={`${styles.shape} ${styles.zigzag}`} viewBox="0 0 130 75" fill="none">
        <path d="m5 56 25-37 22 35 24-36 23 36 26-35" stroke="#3aa0ff" strokeWidth="13" strokeLinecap="square" strokeLinejoin="miter" />
        <path d="m5 56 25-37 22 35 24-36 23 36 26-35" stroke="#17140d" strokeWidth="19" strokeLinecap="square" strokeLinejoin="miter" opacity="1" />
        <path d="m5 56 25-37 22 35 24-36 23 36 26-35" stroke="#3aa0ff" strokeWidth="9" strokeLinecap="square" strokeLinejoin="miter" />
      </svg>
      <svg className={`${styles.shape} ${styles.stripedCircle}`} viewBox="0 0 120 120">
        <defs>
          <pattern id="stripes" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
            <rect width="16" height="16" fill="#ff5b57" />
            <rect width="6" height="16" fill="#f5efe2" />
          </pattern>
        </defs>
        <circle cx="60" cy="60" r="52" fill="url(#stripes)" stroke="#17140d" strokeWidth="6" />
      </svg>
    </div>
  )
}

function DashboardMockup() {
  const bars = [44, 62, 52, 82, 70, 96]
  const colors = ['#ffc531', '#ff5b57', '#6b5be6', '#12b3a4', '#3aa0ff', '#ff5b57']
  const checklist = [
    ['Move the Aug 5 card payment', true],
    ['Review your Aug 7 Zolve bill', true],
    ['Share the debt payoff plan', false],
  ]

  return (
    <aside className={styles.dashboard} aria-label="Finapp dashboard preview">
      <div className={styles.browserBar}>
        <span className={styles.browserDots} aria-hidden="true"><i /><i /><i /></span>
        <strong>Demo data · Today</strong>
      </div>
      <div className={styles.dashboardBody}>
        <div className={styles.metricHead}>
          <div>
            <span className={styles.dashboardLabel}>Checking now</span>
            <h2>$482.10</h2>
          </div>
          <span className={styles.upPill}>Risk in 12d</span>
        </div>
        <div className={styles.chart}>
          <div className={styles.chartLabels}><span>6 weeks</span><span>Cash left</span></div>
          <div className={styles.bars}>
            {bars.map((height, index) => <span key={height} style={{ height: `${height}%`, backgroundColor: colors[index] }} />)}
          </div>
        </div>
        <div className={styles.checklist}>
          {checklist.map(([task, isDone]) => (
            <div className={styles.checkRow} key={String(task)}>
              <span className={`${styles.check} ${isDone ? styles.checked : ''}`}>{isDone && '✓'}</span>
              <span>{task}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

function FeatureIcon({ kind }: { kind: 'path' | 'pulse' | 'team' }) {
  const paths = {
    path: <path d="M5 18h7l4-10 5 19 4-9h7" />,
    pulse: <><path d="M7 29V18M17 29V9M27 29V14M37 29V5" /><path d="M4 33h36" /></>,
    team: <><circle cx="16" cy="17" r="5" /><circle cx="30" cy="16" r="4" /><path d="M6 34c.8-6 4.1-9 10-9s9.2 3 10 9M26 25c5.2.2 8.1 3.1 8.8 8" /></>,
  }
  return <svg viewBox="0 0 44 44" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>
}

export default function LandingPage() {
  return (
    <div className={styles.landing}>
      <section className={styles.hero}>
        <Decorations />
        <nav className={styles.topNav} aria-label="Marketing">
          <a className={styles.brand} href="#top" aria-label="Finapp home"><LogoMark /><span>Finapp</span></a>
          <div className={styles.navLinks}>
            <a href="#product">Product</a>
            <a href="#features">Features</a>
            <a href="#plans">Plans</a>
            <a href="#learn">Learn</a>
          </div>
          <a className={`${styles.button} ${styles.navCta}`} href="/demo">View demo <span aria-hidden="true">→</span></a>
        </nav>

        <div className={styles.heroGrid} id="top">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span /> USD + INR · No bank login required</p>
            <h1>Spot the shortfall <span className={`${styles.highlight} ${styles.mustard}`}>before</span> your bank <span className={`${styles.highlight} ${styles.teal}`}>does.</span></h1>
            <p className={styles.lede}>Finapp reads the statement and alert emails you already get, then does the arithmetic you cannot do in your head: seven accounts, two currencies, six due dates, one thin checking balance.</p>
            <div className={styles.actions}>
              <a className={`${styles.button} ${styles.primaryCta}`} href="/demo">Open the demo <span aria-hidden="true">→</span></a>
              <a className={`${styles.button} ${styles.secondaryCta}`} href="#features">How it works <span aria-hidden="true">↗</span></a>
            </div>
            <div className={styles.trustRow}>
              <div className={styles.avatars} aria-hidden="true"><span>$</span><span>₹</span><span>7</span><span>0</span></div>
              <p><strong>Built after a $941 bill bounced twice</strong>, three days after a $2,500 card payment cleared.<br />No aggregator, no bank credentials, no monthly fee.</p>
            </div>
          </div>
          <DashboardMockup />
        </div>
      </section>

      <section className={styles.logoStrip} aria-label="Institutions Finapp can read">
        <span>Reads statements from</span>
        <div>{institutions.map((name) => <b key={name}>{name}</b>)}</div>
      </section>

      <section className={styles.features} id="features">
        <p className={styles.featureEyebrow}>HOW IT WORKS</p>
        <h2>Your inbox already knows.<br />Finapp does the arithmetic.</h2>
        <div className={styles.featureGrid}>
          <article className={`${styles.featureCard} ${styles.coralCard}`}>
            <span className={styles.iconChip}><FeatureIcon kind="path" /></span>
            <h3>Your email, not your login</h3>
            <p>No aggregator, no bank credentials, nothing to breach. Finapp parses the alerts and statements your banks already send you.</p>
          </article>
          <article className={`${styles.featureCard} ${styles.tealCard}`}>
            <span className={styles.iconChip}><FeatureIcon kind="pulse" /></span>
            <h3>The collision, not the category</h3>
            <p>It projects your balance forward day by day, names the date it goes short, then tells you which single payment to move to clear it.</p>
          </article>
          <article className={`${styles.featureCard} ${styles.violetCard}`}>
            <span className={styles.iconChip}><FeatureIcon kind="team" /></span>
            <h3>Two currencies, never blended</h3>
            <p>Dollars and rupees are tracked separately and never silently summed. A total you cannot verify is worse than no total at all.</p>
          </article>
        </div>
      </section>

      <section className={styles.closing} id="plans">
        <div><p>EVERY NUMBER OPENS</p><h2>No figure you cannot trace back to the email it came from.</h2></div>
        <a className={`${styles.button} ${styles.primaryCta}`} href="/demo">Open the demo <span aria-hidden="true">→</span></a>
      </section>
    </div>
  )
}
