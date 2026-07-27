/**
 * The parsers shipped in v1, and a registry pre-loaded with them.
 *
 * `defaultRegistry()` returns a NEW registry each call rather than a shared
 * singleton: a registry is mutable (`register`) and a module-level instance would
 * let one test's extra parser leak into the next, or one caller's experiment leak
 * into a production sync.
 */

import { ParserRegistry, type EmailParser } from '../registry'
import { chaseStatementParser } from './chase-statement'
import { sbiCardAlertParser } from './sbi-card-alert'
import { usBankAlertParser } from './us-bank-alert'
import { zolveStatementParser } from './zolve-statement'

export { chaseStatementParser } from './chase-statement'
export { sbiCardAlertParser, UnknownCurrencyTokenError } from './sbi-card-alert'
export { usBankAlertParser } from './us-bank-alert'
export { zolveStatementParser } from './zolve-statement'

export const BUILT_IN_PARSERS: readonly EmailParser[] = [
  usBankAlertParser,
  chaseStatementParser,
  sbiCardAlertParser,
  zolveStatementParser,
]

export function defaultRegistry(): ParserRegistry {
  return new ParserRegistry(BUILT_IN_PARSERS)
}
