/**
 * Transactions — the ledger.
 *
 * Two invariants live here and nowhere else:
 *
 *   `dedupe_key` is provenance identity (`@/core/reconcile`), and the UNIQUE index on it
 *   is what makes re-running an import a no-op. The repository never checks for an
 *   existing row before inserting; it lets the database refuse and turns the refusal into
 *   a named error. A read-then-write check would race, and every number in the app is
 *   inflated the first time it loses (spec §7.4).
 *
 *   `direction` is derived from the sign of the amount, never accepted from the caller.
 *   The schema CHECKs that the two agree, so an inconsistent pair would be a write error
 *   at some unpredictable later moment; deriving it makes disagreement impossible.
 */

import type { Money } from '@/core/money'
import { isNegative } from '@/core/money'
import type { IsoDate } from '@/core/date'
import { compareIsoDates } from '@/core/date'
import { dedupeKey as computeDedupeKey, type Observation } from '@/core/reconcile'
import {
  SOURCE_TYPES,
  TRANSACTION_DIRECTIONS,
  assertStorableMinor,
  decodeEnum,
  moneyFromColumns,
  type Region,
  type SourceType,
  type Transaction,
} from '../types'
import {
  InvalidArgumentError,
  RecordNotFoundError,
  Repository,
  UniqueConstraintError,
  isUniqueConstraintError,
  newId,
  nowInstant,
  readNullableString,
  readNumber,
  readString,
  type Param,
  type SqlRow,
} from './support'

export interface NewTransaction {
  readonly id?: string
  readonly ownerId?: string | null
  readonly accountId: string
  readonly postedAt: IsoDate
  readonly amount: Money
  /** The descriptor exactly as the source wrote it. Normalisation happens downstream. */
  readonly merchantRaw: string
  readonly merchantId?: string | null
  readonly categoryId?: string | null
  readonly source: SourceType
  /** Message id or statement id this row was read out of. */
  readonly sourceRef: string
  /** Line index within a multi-fact source. Defaults to 0. */
  readonly ordinal?: number
  /** Required when `source` is `statement_pdf`; forbidden otherwise. */
  readonly statementId?: string | null
  /** 0..1. How much the parser trusts this row. */
  readonly confidence: number
  readonly region?: Region
  /** Supply only to reproduce a historical key; otherwise it is derived. */
  readonly dedupeKey?: string
  readonly categorizationVersion?: number
}

/**
 * Thrown when a transaction with the same `dedupe_key` is already stored.
 *
 * Callers re-running an import should treat this as success-by-idempotency, not failure.
 */
export class DuplicateTransactionError extends UniqueConstraintError {
  override readonly name = 'DuplicateTransactionError'
  constructor(
    readonly dedupeKey: string,
    options?: { cause?: unknown },
  ) {
    super(`a transaction with dedupe_key ${dedupeKey} already exists`, options)
  }
}

/** Thrown when a supersede would create a cycle or point at a missing row. */
export class InvalidSupersedeError extends Error {
  override readonly name = 'InvalidSupersedeError'
  constructor(detail: string) {
    super(`invalid supersede: ${detail}`)
  }
}

const SELECT_COLUMNS = `
  id, owner_id, account_id, posted_at, amount_minor, currency,
  merchant_raw, merchant_id, category_id, direction, source, source_ref, ordinal,
  statement_id, confidence, dedupe_key, superseded_by, categorization_version, created_at
`

export function mapTransactionRow(row: SqlRow): Transaction {
  return {
    id: readString(row, 'id'),
    ownerId: readNullableString(row, 'owner_id'),
    accountId: readString(row, 'account_id'),
    postedAt: readString(row, 'posted_at'),
    amount: moneyFromColumns('transactions', 'amount_minor', row['amount_minor'], row['currency']),
    merchantRaw: readString(row, 'merchant_raw'),
    merchantId: readNullableString(row, 'merchant_id'),
    categoryId: readNullableString(row, 'category_id'),
    direction: decodeEnum('transactions', 'direction', TRANSACTION_DIRECTIONS, row['direction']),
    source: decodeEnum('transactions', 'source', SOURCE_TYPES, row['source']),
    sourceRef: readString(row, 'source_ref'),
    ordinal: readNumber(row, 'ordinal'),
    statementId: readNullableString(row, 'statement_id'),
    confidence: readNumber(row, 'confidence'),
    dedupeKey: readString(row, 'dedupe_key'),
    supersededBy: readNullableString(row, 'superseded_by'),
    categorizationVersion: readNumber(row, 'categorization_version'),
    createdAt: readString(row, 'created_at'),
  }
}

export interface ListTransactionsOptions {
  /** Inclusive lower bound on `posted_at`. */
  readonly from?: IsoDate
  /** Inclusive upper bound on `posted_at`. */
  readonly to?: IsoDate
  /**
   * Include rows a statement has superseded. Off by default: including them double-counts
   * every reconciled charge, which is the exact failure the supersede mechanism prevents.
   */
  readonly includeSuperseded?: boolean
  readonly limit?: number
}

export class TransactionsRepository extends Repository {
  insert(input: NewTransaction): Transaction {
    if (input.confidence < 0 || input.confidence > 1 || !Number.isFinite(input.confidence)) {
      throw new InvalidArgumentError('confidence', 'must be a number in [0, 1]')
    }
    if (input.merchantRaw.trim() === '') {
      throw new InvalidArgumentError('merchantRaw', 'must not be blank')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.postedAt)) {
      throw new InvalidArgumentError('postedAt', 'must be an ISO calendar date (YYYY-MM-DD)')
    }

    const ordinal = input.ordinal ?? 0
    if (!Number.isInteger(ordinal) || ordinal < 0) {
      throw new InvalidArgumentError('ordinal', 'must be a non-negative integer')
    }

    const statementId = input.statementId ?? null
    if (statementId !== null && input.source !== 'statement_pdf') {
      throw new InvalidArgumentError(
        'statementId',
        `only a statement_pdf row may reference a statement (source is "${input.source}")`,
      )
    }

    assertStorableMinor('transactions.amount_minor', input.amount.minor)

    const observation: Observation = {
      sourceType: input.source,
      sourceRef: input.sourceRef,
      ordinal,
      accountId: input.accountId,
      postedAt: input.postedAt,
      amount: input.amount,
      descriptorRaw: input.merchantRaw,
      ...(input.region === undefined ? {} : { region: input.region }),
    }

    const transaction: Transaction = {
      id: input.id ?? newId(),
      ownerId: input.ownerId ?? null,
      accountId: input.accountId,
      postedAt: input.postedAt,
      amount: input.amount,
      merchantRaw: input.merchantRaw,
      merchantId: input.merchantId ?? null,
      categoryId: input.categoryId ?? null,
      // Sign is the single source of truth for direction. Zero is classified as a credit:
      // a zero-amount authorisation takes nothing out of the account.
      direction: isNegative(input.amount) ? 'debit' : 'credit',
      source: input.source,
      sourceRef: input.sourceRef,
      ordinal,
      statementId,
      confidence: input.confidence,
      dedupeKey: input.dedupeKey ?? computeDedupeKey(observation),
      supersededBy: null,
      categorizationVersion: input.categorizationVersion ?? 0,
      createdAt: nowInstant(),
    }

    try {
      this.stmt(
        `INSERT INTO transactions
           (id, owner_id, account_id, posted_at, amount_minor, currency,
            merchant_raw, merchant_id, category_id, direction, source, source_ref, ordinal,
            statement_id, confidence, dedupe_key, superseded_by, categorization_version,
            created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        transaction.id,
        transaction.ownerId,
        transaction.accountId,
        transaction.postedAt,
        transaction.amount.minor,
        transaction.amount.currency,
        transaction.merchantRaw,
        transaction.merchantId,
        transaction.categoryId,
        transaction.direction,
        transaction.source,
        transaction.sourceRef,
        transaction.ordinal,
        transaction.statementId,
        transaction.confidence,
        transaction.dedupeKey,
        transaction.supersededBy,
        transaction.categorizationVersion,
        transaction.createdAt,
      )
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        throw new DuplicateTransactionError(transaction.dedupeKey, { cause })
      }
      throw cause
    }

    return transaction
  }

  findById(id: string): Transaction | null {
    const row = this.stmt(`SELECT ${SELECT_COLUMNS} FROM transactions WHERE id = ?`).get(id)
    return row === undefined ? null : mapTransactionRow(row)
  }

  getById(id: string): Transaction {
    const found = this.findById(id)
    if (found === null) throw new RecordNotFoundError('transaction', id)
    return found
  }

  findByDedupeKey(dedupeKey: string): Transaction | null {
    const row = this.stmt(`SELECT ${SELECT_COLUMNS} FROM transactions WHERE dedupe_key = ?`).get(
      dedupeKey,
    )
    return row === undefined ? null : mapTransactionRow(row)
  }

  listByAccount(accountId: string, options: ListTransactionsOptions = {}): Transaction[] {
    if (
      options.from !== undefined &&
      options.to !== undefined &&
      compareIsoDates(options.from, options.to) > 0
    ) {
      throw new InvalidArgumentError('from/to', `${options.from} is after ${options.to}`)
    }

    const params: Param[] = [accountId]
    let sql = `SELECT ${SELECT_COLUMNS} FROM transactions WHERE account_id = ?`

    if (options.includeSuperseded !== true) sql += ' AND superseded_by IS NULL'
    if (options.from !== undefined) {
      sql += ' AND posted_at >= ?'
      params.push(options.from)
    }
    if (options.to !== undefined) {
      sql += ' AND posted_at <= ?'
      params.push(options.to)
    }

    sql += ' ORDER BY posted_at DESC, created_at DESC, id'

    if (options.limit !== undefined) {
      if (!Number.isInteger(options.limit) || options.limit < 1) {
        throw new InvalidArgumentError('limit', 'must be a positive integer')
      }
      sql += ' LIMIT ?'
      params.push(options.limit)
    }

    return this.stmt(sql).all(...params).map(mapTransactionRow)
  }

  /**
   * Rows a statement has replaced. Superseded history is retained, not deleted (§7.3), so
   * the reconciliation that produced a number stays auditable.
   */
  listSuperseded(accountId: string): Transaction[] {
    return this.stmt(
      `SELECT ${SELECT_COLUMNS} FROM transactions
        WHERE account_id = ? AND superseded_by IS NOT NULL
        ORDER BY posted_at DESC, id`,
    )
      .all(accountId)
      .map(mapTransactionRow)
  }

  /** The provisional rows that `authoritativeId` replaced. */
  listSupersededBy(authoritativeId: string): Transaction[] {
    return this.stmt(
      `SELECT ${SELECT_COLUMNS} FROM transactions WHERE superseded_by = ? ORDER BY posted_at, id`,
    )
      .all(authoritativeId)
      .map(mapTransactionRow)
  }

  /**
   * Mark a provisional row as replaced by an authoritative one.
   *
   * Both rows must exist and differ; chaining onto an already-superseded row is refused,
   * because "superseded by something that was itself superseded" has no defined winner.
   */
  markSuperseded(supersededId: string, authoritativeId: string): Transaction {
    if (supersededId === authoritativeId) {
      throw new InvalidSupersedeError('a transaction cannot supersede itself')
    }
    const authoritative = this.findById(authoritativeId)
    if (authoritative === null) {
      throw new InvalidSupersedeError(`authoritative row ${authoritativeId} does not exist`)
    }
    if (authoritative.supersededBy !== null) {
      throw new InvalidSupersedeError(
        `authoritative row ${authoritativeId} is itself superseded by ${authoritative.supersededBy}`,
      )
    }

    const changes = this.stmt(
      `UPDATE transactions SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL`,
    ).run(authoritativeId, supersededId)

    if (changes.changes === 0) {
      if (this.findById(supersededId) === null) {
        throw new RecordNotFoundError('transaction', supersededId)
      }
      throw new InvalidSupersedeError(`transaction ${supersededId} is already superseded`)
    }
    return this.getById(supersededId)
  }

  /** Apply the same supersede to a batch of provisional rows, atomically per row. */
  markManySuperseded(pairs: readonly { supersededId: string; authoritativeId: string }[]): number {
    let count = 0
    for (const pair of pairs) {
      this.markSuperseded(pair.supersededId, pair.authoritativeId)
      count += 1
    }
    return count
  }

  /** Live rows only. Superseded rows are excluded so nothing is counted twice. */
  countLive(accountId: string): number {
    const row = this.stmt(
      `SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND superseded_by IS NULL`,
    ).get(accountId)
    if (row === undefined) return 0
    return readNumber(row, 'n')
  }
}
