/**
 * Message fixtures modelled on real institution mail.
 *
 * These are shaped after actual emails — the phrasing, the field order, the HTML
 * table layout and the marketing subdomains are all as observed. Account numbers,
 * message ids and merchant names are the only things altered.
 *
 * They live outside the test files because both the parser tests and the registry
 * tests need them, and because a fixture that drifts from the real template is the
 * single easiest way for this layer to pass its tests and fail in production.
 */

import { type RawMessage } from './types'

function msg(m: Partial<RawMessage> & Pick<RawMessage, 'id' | 'from' | 'subject'>): RawMessage {
  return {
    receivedAt: '2026-07-18T09:00:00Z',
    text: null,
    html: null,
    ...m,
  }
}

/** U.S. Bank alert: an amount and four digits, and nothing else at all. */
export const usBankAlert: RawMessage = msg({
  id: '<usb-2026-07-14-0001@notifications.usbank.com>',
  from: 'U.S. Bank <usbank@notifications.usbank.com>',
  subject: 'U.S. Bank transaction alert',
  receivedAt: '2026-07-14T18:42:11Z',
  text: [
    'U.S. Bank',
    '',
    'Your transaction of $2500.00 is complete.',
    '',
    'This alert applies to your account ending in 1729.',
    '',
    'If you did not authorize this transaction, call the number on the back of your card.',
    'Please do not reply to this email.',
  ].join('\n'),
})

/** Chase statement notification, as an HTML table — label and value in separate cells. */
export const chaseStatement: RawMessage = msg({
  id: '<chase-stmt-2026-07-26@chase.com>',
  from: 'Chase <no.reply.alerts@chase.com>',
  subject: 'Your credit card statement is ready',
  receivedAt: '2026-07-26T11:05:00Z',
  html: [
    '<html><head><style>.amt{font-weight:700;font-size:18px}</style></head><body>',
    '<p>Your account ending in 4417 statement is ready to view.</p>',
    '<table>',
    '<tr><td>Due date</td><td class="amt">08/22/2026</td></tr>',
    '<tr><td>Minimum payment due</td><td class="amt">$108.85</td></tr>',
    '<tr><td>Statement balance</td><td class="amt">$2,709.80</td></tr>',
    '</table>',
    '<p>Pay from the Chase Mobile&reg; app.</p>',
    '</body></html>',
  ].join(''),
})

/**
 * SBI Card, INR charge, dated 12/07/26 — 12 July 2026.
 *
 * This exact date is the fixture on purpose: read as MM/DD it is 7 December 2026,
 * also a real date, five months away, and wrong.
 */
export const sbiCardInrAlert: RawMessage = msg({
  id: '<sbi-2026-07-12-6286@sbicard.com>',
  from: 'SBI Card <onlinesbicard@sbicard.com>',
  subject: 'Transaction alert on your SBI Card',
  receivedAt: '2026-07-12T14:33:02Z',
  text:
    'Dear Cardholder, Rs.35882.00 spent on your SBI Credit Card ending 6286 at ' +
    'RAZDREAMPLUGPAYTECHSOL on 12/07/26. Trxn. not done by you? Report immediately.',
})

/** Same card, USD charge — amount currency differs from the INR billing currency. */
export const sbiCardUsdAlert: RawMessage = msg({
  id: '<sbi-2026-07-03-6286@sbicard.com>',
  from: 'SBI Card <onlinesbicard@sbicard.com>',
  subject: 'Transaction alert on your SBI Card',
  receivedAt: '2026-07-03T08:12:40Z',
  text:
    'Dear Cardholder, USD41.30 spent on your SBI Credit Card ending 6286 at ' +
    'ANTHROPIC PBC on 03/07/26. Trxn. not done by you? Report immediately.',
})

/** Same card, AUD charge, dated 28/06/26 — impossible to read as MM/DD, so it proves the order. */
export const sbiCardAudAlert: RawMessage = msg({
  id: '<sbi-2026-06-28-6286@sbicard.com>',
  from: 'SBI Card <onlinesbicard@sbicard.com>',
  subject: 'Transaction alert on your SBI Card',
  receivedAt: '2026-06-28T21:04:00Z',
  text:
    'Dear Cardholder, AUD707.43 spent on your SBI Credit Card ending 6286 at ' +
    'QANTAS AIRWAYS on 28/06/26. Trxn. not done by you? Report immediately.',
})

export const zolveStatement: RawMessage = msg({
  id: '<zolve-stmt-2026-07-18@zolve.com>',
  from: 'Zolve <noreply@zolve.com>',
  subject: 'Your Zolve Card statement is ready',
  receivedAt: '2026-07-18T06:30:00Z',
  text: [
    'Hi,',
    '',
    'Here is your statement for the credit card ending in 7058, covering transactions',
    'from 06/18/2026 to 07/17/2026.',
    '',
    'Total Due $1549.10',
    'Min Due $25',
    '',
    'You can pay from the Zolve app.',
  ].join('\n'),
})

/**
 * Marketing mail. Every one of these carries a large dollar figure, and every one
 * comes from a subdomain that is NOT the institution's transactional one.
 */
export const marketingMessages: readonly RawMessage[] = [
  msg({
    id: '<mktg-chase-1@mcmap.chase.com>',
    from: 'Chase <chase@mcmap.chase.com>',
    subject: 'Transfer a balance of up to $15,000',
    text: 'Statement balance transfers with 0% intro APR. Due date 08/22/2026 does not apply.',
  }),
  msg({
    id: '<mktg-amex-1@member.americanexpress.com>',
    from: 'American Express <americanexpress@member.americanexpress.com>',
    subject: 'You are pre-qualified for a $500 welcome bonus',
    text: 'Your transaction of $500.00 is complete once you spend $6,000 in six months.',
  }),
  msg({
    id: '<mktg-sbi-1@offers.sbicard.com>',
    from: 'SBI Card Offers <offers@offers.sbicard.com>',
    subject: 'Flat Rs.2000 off this weekend',
    text: 'Rs.2000.00 spent on your SBI Credit Card ending 6286 at ANYSTORE on 01/08/26 gets cashback.',
  }),
  msg({
    id: '<mktg-usb-1@email.usbank.com>',
    from: 'U.S. Bank <1800USBanks@email.usbank.com>',
    subject: 'A card with no annual fee',
    text: 'Your transaction of $2500.00 is complete — imagine the rewards on your account ending in 0000.',
  }),
]

/** Allowlisted sender, template this build has never seen. Must quarantine, not vanish. */
export const unknownTemplate: RawMessage = msg({
  id: '<disc-2026-07-20@services.discover.com>',
  from: 'Discover Card <discover@services.discover.com>',
  subject: 'Your Discover cashback match summary',
  text: 'You earned 5% cashback this quarter. Log in to see details.',
})
