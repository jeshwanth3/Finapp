'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Navigation — 3D Motion Astro Tab Bar with professional financial labels.
 */
const TABS = [
  { href: '/', label: 'Today', icon: OverviewIcon },
  { href: '/debt', label: 'Debt', icon: DebtIcon },
  { href: '/net-worth', label: 'Net worth', icon: NetWorthIcon },
  { href: '/investments', label: 'Investments', icon: InvestIcon },
  { href: '/budgets', label: 'Budgets', icon: BudgetIcon },
] as const

export function Nav() {
  const pathname = usePathname()

  return (
    <nav className="nav" aria-label="Primary Navigation">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
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

/* 3D Motion Inline SVGs */

function OverviewIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2" strokeLinecap="round" />
    </svg>
  )
}

function DebtIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10.5h18" strokeLinecap="round" />
      <circle cx="8" cy="15" r="1.5" fill="currentColor" />
    </svg>
  )
}

function NetWorthIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 7h4v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function InvestIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" strokeLinecap="round" />
    </svg>
  )
}

function BudgetIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 12h8M12 8v8" strokeLinecap="round" />
    </svg>
  )
}
