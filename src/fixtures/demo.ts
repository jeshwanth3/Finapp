/**
 * Demo fixture data.
 *
 * Shapes and patterns mirror the real inbox survey (design spec §2) — six credit
 * accounts across two countries, a thin checking buffer, and a payment-timing
 * collision — but every figure here is invented. No real balance, account number,
 * or transaction appears in this repository.
 *
 * This exists so the UI can be built and reviewed before the ingestion pipeline
 * lands. It is replaced by real queries in Phase 4, not extended.
 */

import { money, type Money } from '@/core/money'

export interface DemoAccount {
  id: string
  institution: string
  kind: 'credit_card' | 'checking' | 'brokerage'
  region: 'US' | 'IN'
  currency: string
  displayName: string
  /** Current balance owed (credit) or held (checking). */
  balance: Money
  statementBalance?: Money
  minimumDue?: Money
  dueDate?: string
  aprPercent?: number
  lastObservedAt: string
}

export const ACCOUNTS: DemoAccount[] = [
  {
    id: 'acct-checking',
    institution: 'US Bank',
    kind: 'checking',
    region: 'US',
    currency: 'USD',
    displayName: 'Everyday Checking',
    balance: money(48210, 'USD'),
    lastObservedAt: '2026-07-25',
  },
  {
    id: 'acct-card-a',
    institution: 'Chase',
    kind: 'credit_card',
    region: 'US',
    currency: 'USD',
    displayName: 'Freedom Unlimited',
    balance: money(270980, 'USD'),
    statementBalance: money(270980, 'USD'),
    minimumDue: money(10885, 'USD'),
    dueDate: '2026-08-22',
    aprPercent: 24.49,
    lastObservedAt: '2026-07-25',
  },
  {
    id: 'acct-card-b',
    institution: 'Amex',
    kind: 'credit_card',
    region: 'US',
    currency: 'USD',
    displayName: 'Blue Cash Preferred',
    balance: money(118430, 'USD'),
    statementBalance: money(118430, 'USD'),
    minimumDue: money(4000, 'USD'),
    dueDate: '2026-08-14',
    aprPercent: 22.99,
    lastObservedAt: '2026-07-20',
  },
  {
    id: 'acct-card-c',
    institution: 'Discover',
    kind: 'credit_card',
    region: 'US',
    currency: 'USD',
    displayName: 'Discover it',
    balance: money(62150, 'USD'),
    statementBalance: money(62150, 'USD'),
    minimumDue: money(3500, 'USD'),
    dueDate: '2026-08-09',
    aprPercent: 26.24,
    lastObservedAt: '2026-07-22',
  },
  {
    id: 'acct-card-d',
    institution: 'Zolve',
    kind: 'credit_card',
    region: 'US',
    currency: 'USD',
    displayName: 'Zolve Classic',
    balance: money(154910, 'USD'),
    statementBalance: money(154910, 'USD'),
    minimumDue: money(2500, 'USD'),
    dueDate: '2026-08-10',
    aprPercent: 27.99,
    lastObservedAt: '2026-07-21',
  },
  {
    id: 'acct-card-in',
    institution: 'SBI Card',
    kind: 'credit_card',
    region: 'IN',
    currency: 'INR',
    displayName: 'SBI Card PULSE',
    balance: money(8742300, 'INR'),
    statementBalance: money(8742300, 'INR'),
    minimumDue: money(437100, 'INR'),
    dueDate: '2026-08-18',
    aprPercent: 42.0,
    lastObservedAt: '2026-07-03',
  },
]

export interface Obligation {
  id: string
  accountId: string
  label: string
  amount: Money
  dueDate: string
  kind: 'minimum' | 'statement' | 'bill' | 'recurring'
}

export const OBLIGATIONS: Obligation[] = [
  { id: 'o1', accountId: 'acct-card-d', label: 'Zolve bill', amount: money(94117, 'USD'), dueDate: '2026-08-07', kind: 'bill' },
  { id: 'o2', accountId: 'acct-card-c', label: 'Discover minimum', amount: money(3500, 'USD'), dueDate: '2026-08-09', kind: 'minimum' },
  { id: 'o3', accountId: 'acct-card-d', label: 'Zolve minimum', amount: money(2500, 'USD'), dueDate: '2026-08-10', kind: 'minimum' },
  { id: 'o4', accountId: 'acct-card-b', label: 'Amex minimum', amount: money(4000, 'USD'), dueDate: '2026-08-14', kind: 'minimum' },
  { id: 'o5', accountId: 'acct-card-a', label: 'Chase minimum', amount: money(10885, 'USD'), dueDate: '2026-08-22', kind: 'minimum' },
]

export interface ProjectionPoint {
  date: string
  balance: Money
  events: string[]
}

/**
 * A worked cash-flow projection showing the collision pattern the app exists to
 * catch: a large payment clearing days before a bill, leaving the buffer short.
 */
export const PROJECTION: ProjectionPoint[] = [
  { date: '2026-07-26', balance: money(48210, 'USD'), events: [] },
  { date: '2026-07-31', balance: money(48210, 'USD'), events: [] },
  { date: '2026-08-01', balance: money(329310, 'USD'), events: ['Payroll +$2,811'] },
  { date: '2026-08-03', balance: money(179310, 'USD'), events: ['Rent −$1,500'] },
  { date: '2026-08-05', balance: money(29310, 'USD'), events: ['Card payment −$1,500'] },
  { date: '2026-08-07', balance: money(-64807, 'USD'), events: ['Zolve bill −$941.17'] },
  { date: '2026-08-09', balance: money(-68307, 'USD'), events: ['Discover minimum −$35'] },
  { date: '2026-08-15', balance: money(212603, 'USD'), events: ['Payroll +$2,811'] },
]

export interface Insight {
  id: string
  severity: 'critical' | 'warn' | 'info'
  kind: string
  title: string
  body: string
  evidenceCount: number
  detectedAt: string
}

export const INSIGHTS: Insight[] = [
  {
    id: 'i1',
    severity: 'critical',
    kind: 'cash_flow_collision',
    title: 'Your Zolve bill will bounce on Aug 7',
    body:
      'The $1,500 card payment scheduled for Aug 5 leaves $293 in checking. The Zolve bill of $941.17 lands on Aug 7, two days before payroll. Moving the card payment to Aug 16 clears both.',
    evidenceCount: 4,
    detectedAt: '2026-07-26',
  },
  {
    id: 'i2',
    severity: 'warn',
    kind: 'price_increase',
    title: 'Verve AI went up 18% in June',
    body:
      'Billed quarterly. The last charge was $197.54 against $167.40 previously — $120/yr more going forward. First detected from the renewal email, before the charge posted.',
    evidenceCount: 3,
    detectedAt: '2026-07-19',
  },
  {
    id: 'i3',
    severity: 'warn',
    kind: 'fee_leakage',
    title: '$104 in avoidable fees over 12 months',
    body:
      'Two returned-payment fees and three foreign-transaction fees. The returned payments both followed a card payment clearing within 48 hours of a bill.',
    evidenceCount: 5,
    detectedAt: '2026-07-14',
  },
  {
    id: 'i4',
    severity: 'info',
    kind: 'zombie_subscription',
    title: 'Canva has billed twice since you last opened it',
    body:
      'Two charges totalling $32 since the last usage signal in your inbox. A refund request thread from June was never resolved.',
    evidenceCount: 4,
    detectedAt: '2026-07-11',
  },
]

/** Coverage — how much of net worth the app can actually see (spec §9.8). */
export const NET_WORTH = {
  assets: money(1_284_00, 'USD'),
  liabilities: money(606_470, 'USD'),
  net: money(-478_070, 'USD'),
  asOf: '2026-07-26',
  coverageRatio: 0.72,
  missing: ['Employer equity (never entered)', 'India savings account (no email)'],
}
