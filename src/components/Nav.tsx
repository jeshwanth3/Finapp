'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Bottom tab bar on phones, top tab strip on desktop — one component, driven by CSS.
 * Order matches the spec's screen list (§13.2), with Today first because the
 * question the app exists to answer is "what's about to go wrong".
 */
const TABS = [
  { href: '/demo', label: 'Demo', icon: TodayIcon },
  { href: '/debt', label: 'Debt', icon: DebtIcon },
  { href: '/net-worth', label: 'Net worth', icon: NetWorthIcon },
  { href: '/investments', label: 'Investments', icon: InvestIcon },
  { href: '/budgets', label: 'Budgets', icon: BudgetIcon },
] as const

export function Nav() {
  const pathname = usePathname()

  // The marketing home has its own navigation; the financial workspace keeps
  // this contextual tab bar on every other route.
  if (pathname === '/') return null

  return (
    <nav className="nav" aria-label="Primary">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className="nav-item"
            data-active={active}
            aria-current={active ? 'page' : undefined}
          >
            <Icon />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

/* Inline SVGs — no icon dependency, no network request, themeable via currentColor. */

function TodayIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M8 3v3M16 3v3" strokeLinecap="round" />
    </svg>
  )
}

function DebtIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="12.5" rx="2.5" />
      <path d="M2.5 10.5h19" strokeLinecap="round" />
    </svg>
  )
}

function NetWorthIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 18.5V13M9.5 18.5V7M15 18.5v-8M20.5 18.5V4" strokeLinecap="round" />
    </svg>
  )
}

function InvestIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3.5 15.5l5-5 3.5 3.5 8-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 6h4.5v4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BudgetIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v8.5l6 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
