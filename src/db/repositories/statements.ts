/**
 * Statements — the authoritative record (spec §7.3).
 *
 * A statement row carries two monetary values (balance and minimum due) against a single
 * `currency` column, because a statement cannot state its balance in one currency and its
 * minimum due in another. The repository refuses a mismatched pair rather than picking
 * one of the two codes and storing a number that reads plausibly and is wrong.
 */

import type { Money } from '@/core/money'
import { CurrencyMismatchError } from '@/core/money'
import type { IsoDate } from '@/core/date'
import { compareIsoDates } from '@/core/date'
import {
  assertStorableMinor,
  fromSqliteBool,
  moneyFromColumns,
  optionalMoneyFromColumns,
  toSqliteBool,
  type Statement,
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
  readString,
  type Param,
  type SqlRow,
} from './support'

export interface NewStatement {
  readonly id?: string
  readonly ownerId?: string | null
  readonly accountId: string
  readonly periodStart: IsoDate
  readonly periodEnd: IsoDate
  readonly statementBalance: Money
  readonly minimumDue?: Money | null
  readonly dueDate?: IsoDate | null
  readonly sourceMessageId: string
  readonly pdfPath?: string | null
  /** False while the PDF is downloaded but not yet extracted. */
  readonly isParsed?: boolean
}

/** Thrown when the same account/period is imported twice. */
export class DuplicateStatementError extends UniqueConstraintError {
  override readonly name = 'DuplicateStatementError'
  constructor(
    readonly accountId: string,
    readonly periodStart: IsoDate,
    readonly periodEnd: IsoDate,
    options?: { cause?: unknown },
  ) {
    super(
      `a statement for account ${accountId} covering ${periodStart}..${periodEnd} already exists`,
      options,
    )
  }
}

const SELECT_COLUMNS = `
  id, owner_id, account_id, period_start, period_end,
  statement_balance_minor, minimum_due_minor, due_date, currency,
  source_message_id, pdf_path, is_parsed, created_at
`

export function mapStatementRow(row: SqlRow): Statement {
  return {
    id: readString(row, 'id'),
    ownerId: readNullableString(row, 'owner_id'),
    accountId: readString(row, 'account_id'),
    periodStart: readString(row, 'period_start'),
    periodEnd: readString(row, 'period_end'),
    statementBalance: moneyFromColumns(
      'statements',
      'statement_balance_minor',
      row['statement_balance_minor'],
      row['currency'],
    ),
    minimumDue: optionalMoneyFromColumns(
      'statements',
      'minimum_due_minor',
      row['minimum_due_minor'],
      row['currency'],
    ),
    dueDate: readNullableString(row, 'due_date'),
    sourceMessageId: readString(row, 'source_message_id'),
    pdfPath: readNullableString(row, 'pdf_path'),
    isParsed: fromSqliteBool('statements', 'is_parsed', row['is_parsed']),
    createdAt: readString(row, 'created_at'),
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export class StatementsRepository extends Repository {
  insert(input: NewStatement): Statement {
    for (const [name, value] of [
      ['periodStart', input.periodStart],
      ['periodEnd', input.periodEnd],
    ] as const) {
      if (!ISO_DATE.test(value)) {
        throw new InvalidArgumentError(name, 'must be an ISO calendar date (YYYY-MM-DD)')
      }
    }
    if (compareIsoDates(input.periodStart, input.periodEnd) > 0) {
      throw new InvalidArgumentError(
        'periodStart/periodEnd',
        `${input.periodStart} is after ${input.periodEnd}`,
      )
    }

    const minimumDue = input.minimumDue ?? null
    if (minimumDue !== null && minimumDue.currency !== input.statementBalance.currency) {
      throw new CurrencyMismatchError(input.statementBalance.currency, minimumDue.currency)
    }

    const dueDate = input.dueDate ?? null
    if (dueDate !== null && !ISO_DATE.test(dueDate)) {
      throw new InvalidArgumentError('dueDate', 'must be an ISO calendar date (YYYY-MM-DD)')
    }

    assertStorableMinor('statements.statement_balance_minor', input.statementBalance.minor)
    if (minimumDue !== null) assertStorableMinor('statements.minimum_due_minor', minimumDue.minor)

    const statement: Statement = {
      id: input.id ?? newId(),
      ownerId: input.ownerId ?? null,
      accountId: input.accountId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      statementBalance: input.statementBalance,
      minimumDue,
      dueDate,
      sourceMessageId: input.sourceMessageId,
      pdfPath: input.pdfPath ?? null,
      isParsed: input.isParsed ?? false,
      createdAt: nowInstant(),
    }

    try {
      this.stmt(
        `INSERT INTO statements
           (id, owner_id, account_id, period_start, period_end,
            statement_balance_minor, minimum_due_minor, due_date, currency,
            source_message_id, pdf_path, is_parsed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        statement.id,
        statement.ownerId,
        statement.accountId,
        statement.periodStart,
        statement.periodEnd,
        statement.statementBalance.minor,
        statement.minimumDue === null ? null : statement.minimumDue.minor,
        statement.dueDate,
        statement.statementBalance.currency,
        statement.sourceMessageId,
        statement.pdfPath,
        toSqliteBool(statement.isParsed),
        statement.createdAt,
      )
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        throw new DuplicateStatementError(
          statement.accountId,
          statement.periodStart,
          statement.periodEnd,
          { cause },
        )
      }
      throw cause
    }

    return statement
  }

  findById(id: string): Statement | null {
    const row = this.stmt(`SELECT ${SELECT_COLUMNS} FROM statements WHERE id = ?`).get(id)
    return row === undefined ? null : mapStatementRow(row)
  }

  getById(id: string): Statement {
    const found = this.findById(id)
    if (found === null) throw new RecordNotFoundError('statement', id)
    return found
  }

  findByPeriod(accountId: string, periodStart: IsoDate, periodEnd: IsoDate): Statement | null {
    const row = this.stmt(
      `SELECT ${SELECT_COLUMNS} FROM statements
        WHERE account_id = ? AND period_start = ? AND period_end = ?`,
    ).get(accountId, periodStart, periodEnd)
    return row === undefined ? null : mapStatementRow(row)
  }

  /** Newest period first — the order the debt map reads them in. */
  listByAccount(accountId: string, limit?: number): Statement[] {
    const params: Param[] = [accountId]
    let sql = `SELECT ${SELECT_COLUMNS} FROM statements WHERE account_id = ? ORDER BY period_end DESC`
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new InvalidArgumentError('limit', 'must be a positive integer')
      }
      sql += ' LIMIT ?'
      params.push(limit)
    }
    return this.stmt(sql).all(...params).map(mapStatementRow)
  }

  latestForAccount(accountId: string): Statement | null {
    const [latest] = this.listByAccount(accountId, 1)
    return latest ?? null
  }

  /** Statements due within a window — the due-date calendar (spec §9.1). */
  dueBetween(from: IsoDate, to: IsoDate): Statement[] {
    if (compareIsoDates(from, to) > 0) {
      throw new InvalidArgumentError('from/to', `${from} is after ${to}`)
    }
    return this.stmt(
      `SELECT ${SELECT_COLUMNS} FROM statements
        WHERE due_date IS NOT NULL AND due_date >= ? AND due_date <= ?
        ORDER BY due_date, account_id`,
    )
      .all(from, to)
      .map(mapStatementRow)
  }

  /** Flip `is_parsed` once the line items have been extracted and reconciled. */
  markParsed(id: string): Statement {
    const changes = this.stmt(`UPDATE statements SET is_parsed = 1 WHERE id = ?`).run(id)
    if (changes.changes === 0) throw new RecordNotFoundError('statement', id)
    return this.getById(id)
  }
}
