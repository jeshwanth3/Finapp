import type { Database } from '../sqlite'
import { AccountsRepository } from './accounts'
import { TransactionsRepository } from './transactions'
import { StatementsRepository } from './statements'
import { InsightsRepository } from './insights'

export * from './support'
export * from './accounts'
export * from './transactions'
export * from './statements'
export * from './insights'

/** Every repository bound to one connection. */
export interface Repositories {
  readonly accounts: AccountsRepository
  readonly transactions: TransactionsRepository
  readonly statements: StatementsRepository
  readonly insights: InsightsRepository
}

/**
 * Build the repository set for a connection.
 *
 * Repositories cache prepared statements per connection, so this should be called once
 * per connection and the result reused — not per request.
 */
export function createRepositories(db: Database): Repositories {
  return {
    accounts: new AccountsRepository(db),
    transactions: new TransactionsRepository(db),
    statements: new StatementsRepository(db),
    insights: new InsightsRepository(db),
  }
}
