/**
 * Accounts — the liability side of the ledger (cards, loans, bank accounts).
 *
 * An account owns a currency. Transactions carry their own currency because a foreign
 * charge can post in a different one, but every derived total for the account is
 * per-currency: nothing here ever adds across them.
 */

import { zero } from '@/core/money'
import {
  ACCOUNT_KINDS,
  REGIONS,
  decodeEnum,
  fromSqliteBool,
  toSqliteBool,
  type Account,
  type AccountKind,
  type Region,
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
  type SqlRow,
} from './support'

export interface NewAccount {
  readonly id?: string
  readonly ownerId?: string | null
  readonly institution: string
  readonly kind: AccountKind
  /** ISO-4217 code. Validated through `@/core/money`, so an unknown code fails here. */
  readonly currency: string
  readonly region: Region
  readonly displayName: string
  /** Last four digits as printed in the alert. Never a full account number (spec §14). */
  readonly last4Hint?: string | null
  readonly isActive?: boolean
}

/** Thrown when an account id is reused. */
export class DuplicateAccountError extends UniqueConstraintError {
  override readonly name = 'DuplicateAccountError'
  constructor(
    readonly id: string,
    options?: { cause?: unknown },
  ) {
    super(`account ${id} already exists`, options)
  }
}

const SELECT_COLUMNS = `
  id, owner_id, institution, kind, currency, region,
  display_name, last4_hint, is_active, created_at
`

export function mapAccountRow(row: SqlRow): Account {
  return {
    id: readString(row, 'id'),
    ownerId: readNullableString(row, 'owner_id'),
    institution: readString(row, 'institution'),
    kind: decodeEnum('accounts', 'kind', ACCOUNT_KINDS, row['kind']),
    currency: readString(row, 'currency'),
    region: decodeEnum('accounts', 'region', REGIONS, row['region']),
    displayName: readString(row, 'display_name'),
    last4Hint: readNullableString(row, 'last4_hint'),
    isActive: fromSqliteBool('accounts', 'is_active', row['is_active']),
    createdAt: readString(row, 'created_at'),
  }
}

export class AccountsRepository extends Repository {
  insert(input: NewAccount): Account {
    // Round-trips the code through the money module so an invalid currency is rejected by
    // the same validator the arithmetic uses, rather than by a second copy of the rules.
    zero(input.currency)

    if (input.institution.trim() === '') {
      throw new InvalidArgumentError('institution', 'must not be blank')
    }
    if (input.displayName.trim() === '') {
      throw new InvalidArgumentError('displayName', 'must not be blank')
    }
    const last4 = input.last4Hint ?? null
    if (last4 !== null && !/^\d{4}$/.test(last4)) {
      throw new InvalidArgumentError('last4Hint', 'must be exactly four digits')
    }

    const account: Account = {
      id: input.id ?? newId(),
      ownerId: input.ownerId ?? null,
      institution: input.institution,
      kind: input.kind,
      currency: input.currency,
      region: input.region,
      displayName: input.displayName,
      last4Hint: last4,
      isActive: input.isActive ?? true,
      createdAt: nowInstant(),
    }

    try {
      this.stmt(
        `INSERT INTO accounts
           (id, owner_id, institution, kind, currency, region,
            display_name, last4_hint, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        account.id,
        account.ownerId,
        account.institution,
        account.kind,
        account.currency,
        account.region,
        account.displayName,
        account.last4Hint,
        toSqliteBool(account.isActive),
        account.createdAt,
      )
    } catch (cause) {
      if (isUniqueConstraintError(cause)) throw new DuplicateAccountError(account.id, { cause })
      throw cause
    }

    return account
  }

  findById(id: string): Account | null {
    const row = this.stmt(`SELECT ${SELECT_COLUMNS} FROM accounts WHERE id = ?`).get(id)
    return row === undefined ? null : mapAccountRow(row)
  }

  getById(id: string): Account {
    const account = this.findById(id)
    if (account === null) throw new RecordNotFoundError('account', id)
    return account
  }

  /** All accounts for an owner, active first, then alphabetical. `null` = the single-user case. */
  list(ownerId: string | null = null, options: { includeInactive?: boolean } = {}): Account[] {
    const sql =
      options.includeInactive === true
        ? `SELECT ${SELECT_COLUMNS} FROM accounts
             WHERE COALESCE(owner_id, '') = COALESCE(?, '')
             ORDER BY is_active DESC, display_name`
        : `SELECT ${SELECT_COLUMNS} FROM accounts
             WHERE COALESCE(owner_id, '') = COALESCE(?, '') AND is_active = 1
             ORDER BY display_name`
    return this.stmt(sql).all(ownerId).map(mapAccountRow)
  }

  /**
   * Deactivate rather than delete. `ON DELETE CASCADE` from transactions means deleting an
   * account destroys its history; a closed card still has a payoff story worth keeping.
   */
  setActive(id: string, isActive: boolean): Account {
    const changes = this.stmt(`UPDATE accounts SET is_active = ? WHERE id = ?`).run(
      toSqliteBool(isActive),
      id,
    )
    if (changes.changes === 0) throw new RecordNotFoundError('account', id)
    return this.getById(id)
  }
}
