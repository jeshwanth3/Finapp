/**
 * FactSink implementation — bridges the sync loop to the SQLite repositories.
 *
 * This is where parsed facts become persistent ledger rows. The critical contract:
 *
 *   1. IDEMPOTENT. The `dedupe_key` UNIQUE constraint on `transactions` and the
 *      `message_id` UNIQUE on `raw_messages` are the safety net. Re-processing
 *      the same email twice is a no-op, not a double count.
 *
 *   2. ACCOUNT RESOLUTION. A fact carries an `AccountRef` (institution + last4),
 *      not an `accountId`. This module resolves that to a stored Account row,
 *      creating a new account if none matches. A new account appearing is better
 *      than silently dropping a transaction.
 *
 *   3. THROWING MEANS "NOT STORED". The sync loop stops the batch when the sink
 *      throws, and the cursor does not advance past the failure. This is correct:
 *      continuing past a storage failure is how ledgers develop holes.
 */

import { createHash } from 'node:crypto'
import type { FactSink, MailboxMessage } from './sync'
import type { IngestOutcome } from './registry'
import type { Repositories } from '@/db/repositories'
import type { Database } from '@/db/sqlite'
import { withTransaction } from '@/db/db'
import { money } from '@/core/money'
import type { ParsedFact, TransactionFact, StatementFact, BalanceFact, PaymentFact } from './types'

/**
 * Create a FactSink that writes to the given repositories within transactions.
 */
export function createFactSink(db: Database, repos: Repositories): FactSink {
  return {
    accept(outcome: IngestOutcome, msg: MailboxMessage): void {
      withTransaction(db, () => {
        // Always store the raw message first (idempotent via message_id UNIQUE)
        storeRawMessage(db, outcome, msg)

        if (outcome.status === 'parsed') {
          for (const fact of outcome.facts) {
            processFact(db, repos, fact)
          }
        } else if (outcome.status === 'quarantined') {
          storeParseFailure(db, outcome, msg)
        }
        // 'ignored' — recorded in raw_messages but no further action needed
      })
    },
  }
}

function storeRawMessage(db: Database, outcome: IngestOutcome, msg: MailboxMessage): void {
  const rawBytes = Buffer.from(msg.message.text ?? msg.message.html ?? '', 'utf-8')
  const sha256 = createHash('sha256').update(rawBytes).digest('hex')
  const id = `raw-${msg.uid}-${Date.now()}`
  const fromAddress = extractAddress(msg.message.from)

  const status =
    outcome.status === 'parsed'
      ? 'parsed'
      : outcome.status === 'quarantined'
        ? 'quarantined'
        : 'ignored'

  try {
    db.prepare(
      `INSERT INTO raw_messages (id, message_id, mailbox, imap_uid, from_address, subject, received_at, raw, byte_size, sha256, status, parser_id, parser_version, parsed_at)
       VALUES (?, ?, 'INBOX', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      msg.message.id,
      msg.uid,
      fromAddress,
      msg.message.subject,
      msg.message.receivedAt,
      rawBytes,
      rawBytes.length,
      sha256,
      status,
      outcome.status === 'parsed' ? outcome.parserId : null,
      outcome.status === 'parsed' ? outcome.parserVersion : null,
      outcome.status === 'parsed' ? new Date().toISOString() : null,
    )
  } catch (err: unknown) {
    // UNIQUE constraint on message_id → already stored, skip silently
    const msg2 = err instanceof Error ? err.message : String(err)
    if (msg2.includes('UNIQUE constraint failed')) return
    throw err
  }
}

function storeParseFailure(db: Database, outcome: IngestOutcome & { status: 'quarantined' }, msg: MailboxMessage): void {
  const id = `pf-${msg.uid}-${Date.now()}`
  // Find the raw_message id we just stored
  const row = db.prepare('SELECT id FROM raw_messages WHERE message_id = ?').get(msg.message.id) as { id: string } | undefined
  if (!row) return

  // Map quarantine reason to schema-valid reason
  const reasonMap: Record<string, string> = {
    no_parser_matched: 'no_parser_matched',
    multiple_parsers_matched: 'no_parser_matched',
    parser_match_threw: 'extract_threw',
    parser_extract_threw: 'extract_threw',
    parser_produced_no_facts: 'extract_threw',
    invalid_fact: 'validation_failed',
    failed_authenticity: 'extract_threw',
  }
  const reason = reasonMap[outcome.reason] ?? 'extract_threw'

  try {
    db.prepare(
      `INSERT INTO parse_failures (id, raw_message_id, parser_id, failed_at, reason, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, row.id, outcome.parserId, new Date().toISOString(), reason, outcome.detail)
  } catch {
    // Non-critical — the raw message is already stored
  }
}

function processFact(db: Database, repos: Repositories, fact: ParsedFact): void {
  // Resolve the account
  const accountId = resolveAccount(repos, fact)

  switch (fact.kind) {
    case 'transaction':
      processTransaction(repos, fact, accountId)
      break
    case 'statement':
      processStatement(repos, fact, accountId)
      break
    case 'balance':
      // Balance observations update the account's latest known state
      // For now, store as a transaction-like record for evidence
      processBalance(repos, fact, accountId)
      break
    case 'payment':
      processPayment(repos, fact, accountId)
      break
    // bill_due, subscription, price_change, cancellation — stored as insights
    // when the engine processes them. For now, the raw_message is the evidence.
    default:
      break
  }
}

function mapAccountKind(kind: import('./types').AccountKind | null): import('@/db/types').AccountKind {
  if (kind === 'brokerage') return 'savings'
  return kind ?? 'credit_card'
}

/**
 * Resolve an AccountRef to an existing Account id, creating one if needed.
 */
function resolveAccount(repos: Repositories, fact: ParsedFact): string {
  const ref = fact.account
  const existing = repos.accounts.list()

  // Match by institution + last4 (strongest signal)
  if (ref.last4) {
    const match = existing.find(
      (a) =>
        a.institution === ref.institution &&
        a.last4Hint === ref.last4 &&
        a.currency === ref.currency,
    )
    if (match) return match.id
  }

  // Match by institution + kind + currency (weaker but acceptable for single-card issuers)
  if (ref.kind) {
    const match = existing.find(
      (a) =>
        a.institution === ref.institution &&
        a.kind === ref.kind &&
        a.currency === ref.currency,
    )
    if (match) return match.id
  }

  // Match by institution + currency alone (weakest)
  const match = existing.find(
    (a) => a.institution === ref.institution && a.currency === ref.currency,
  )
  if (match) return match.id

  // No match — create a new account
  const id = `acct-${ref.institution.toLowerCase().replace(/\s+/g, '-')}-${ref.last4 ?? Date.now()}`
  repos.accounts.insert({
    id,
    institution: ref.institution,
    kind: mapAccountKind(ref.kind),
    currency: ref.currency,
    region: ref.region,
    displayName: `${ref.institution} ${ref.kind ?? 'account'}${ref.last4 ? ` ···${ref.last4}` : ''}`,
    last4Hint: ref.last4,
    isActive: true,
  })
  return id
}

function processTransaction(repos: Repositories, fact: TransactionFact, accountId: string): void {
  const amount = fact.direction === 'debit'
    ? money(-fact.amount.minor, fact.amount.currency)
    : fact.amount

  try {
    repos.transactions.insert({
      accountId,
      postedAt: fact.postedAt,
      amount,
      merchantRaw: fact.descriptorRaw ?? 'Unknown',
      source: 'alert',
      sourceRef: fact.messageId,
      confidence: fact.confidence,
    })
  } catch (err: unknown) {
    // Dedupe key collision — already stored
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE constraint failed')) return
    throw err
  }
}

function processStatement(repos: Repositories, fact: StatementFact, accountId: string): void {
  if (!fact.statementBalance && !fact.minimumDue && !fact.dueDate) return

  const id = `stmt-${accountId}-${fact.periodEnd ?? fact.messageId}`

  try {
    repos.statements.insert({
      id,
      accountId,
      periodStart: fact.periodStart ?? fact.periodEnd ?? new Date().toISOString().slice(0, 10),
      periodEnd: fact.periodEnd ?? new Date().toISOString().slice(0, 10),
      statementBalance: fact.statementBalance ?? money(0, fact.account.currency),
      minimumDue: fact.minimumDue ?? null,
      dueDate: fact.dueDate ?? null,
      sourceMessageId: fact.messageId,
      isParsed: true,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE constraint failed')) return
    throw err
  }
}

function processBalance(_repos: Repositories, _fact: BalanceFact, _accountId: string): void {
  // Balance observations are informational — the latest statement is authoritative.
  // In a future phase, balance_observations table would hold these.
}

function processPayment(repos: Repositories, fact: PaymentFact, accountId: string): void {
  const amount = fact.direction === 'inbound'
    ? fact.amount
    : money(-fact.amount.minor, fact.amount.currency)

  try {
    repos.transactions.insert({
      accountId,
      postedAt: fact.occurredAt,
      amount,
      merchantRaw: fact.counterpartyRaw ?? 'Payment',
      source: 'alert',
      sourceRef: fact.messageId,
      confidence: fact.confidence,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE constraint failed')) return
    throw err
  }
}

/**
 * Extract bare email address from a From header.
 * "John Doe" <john@example.com> → john@example.com
 */
function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/)
  if (match) return match[1]!.toLowerCase()
  // Bare address
  return from.trim().toLowerCase()
}
