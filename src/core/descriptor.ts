/**
 * Merchant descriptor normalisation — step 1 and 2 of the pipeline in design spec §11.
 *
 * Raw descriptors arrive from card networks mangled by processor prefixes, store
 * numbers, and truncation:
 *
 *   "SQ *COFFEE BAR 4821"       -> "coffee bar"
 *   "AMZN Mktp US*RT4G9K2L1"    -> "amazon marketplace"
 *   "RAZDreamplugPaytechSol"    -> "cred"
 *   "UPI/SWIGGY/9284712"        -> "swiggy"
 *
 * This module is deterministic and cheap. It handles the bulk; the long tail goes
 * to the alias cache and then to a local model (spec §11 steps 3-4), never here.
 *
 * Region matters: US card descriptors and Indian UPI/card descriptors are different
 * parsing problems that happen to share a technique.
 */

export type Region = 'US' | 'IN'

/**
 * Payment-processor prefixes that carry no merchant information.
 * Ordered longest-first at match time so "AMZN Mktp US*" wins over "AMZN".
 */
const PROCESSOR_PREFIXES: Readonly<Record<Region, readonly string[]>> = {
  US: [
    'SQ *', 'SQ*', 'TST* ', 'TST*', 'PY *', 'PY*', 'PAYPAL *', 'PAYPAL*',
    'DD *', 'DD*', 'CLOVER *', 'CLV*', 'TOAST*', 'SP ', 'SP*',
    'IC* ', 'WPY*', 'GUMROAD*', 'STRIPE*', 'SHOPIFY*',
  ],
  IN: [
    'UPI/', 'UPI-', 'POS ', 'ATW ', 'ACH/', 'NEFT/', 'IMPS/', 'RTGS/',
    'RAZ', 'PAY*', 'PAYU*', 'BILLDESK*', 'CCAVENUE*',
  ],
}

/**
 * Exact whole-string expansions, applied before token aliases.
 * Use these where the phrase as a whole means something the tokens don't.
 */
const PHRASE_ALIASES: Readonly<Record<string, string>> = {
  'amzn mktp us': 'amazon marketplace',
  'amzn mktp': 'amazon marketplace',
  'dreamplug paytech sol': 'cred',
  'mcdonald s': 'mcdonalds',
}

/**
 * Token-level expansions, applied to each word.
 * These fire anywhere in the descriptor, so "WHOLEFDS MKT" resolves even though
 * the full phrase has no entry.
 */
const TOKEN_ALIASES: Readonly<Record<string, string>> = {
  wholefds: 'whole foods',
  sbux: 'starbucks',
  amzn: 'amazon',
}

/**
 * Strip a leading processor prefix, if any.
 * Longest match wins so overlapping prefixes resolve deterministically.
 */
function stripProcessorPrefix(input: string, region: Region): string {
  const prefixes = [...PROCESSOR_PREFIXES[region]].sort((a, b) => b.length - a.length)
  const upper = input.toUpperCase()
  for (const p of prefixes) {
    if (upper.startsWith(p.toUpperCase())) {
      return input.slice(p.length)
    }
  }
  return input
}

/**
 * Normalise a raw descriptor to a stable merchant string.
 *
 * Deliberately lossy and deliberately deterministic: the same input always yields
 * the same output, because this value is a component of transaction identity.
 * Output is constrained to [a-z0-9 ] — relied upon by `merchantKey`'s sentinel.
 */
export function normalizeDescriptor(raw: string, region: Region = 'US'): string {
  if (typeof raw !== 'string') return ''

  let s = raw.trim()
  if (s === '') return ''

  s = stripProcessorPrefix(s, region)

  // Indian rails often encode MERCHANT between delimiters: UPI/SWIGGY/9284712
  if (region === 'IN' && s.includes('/')) {
    const segments = s.split('/').filter((x) => x.trim() !== '')
    // Prefer the first segment that is not purely numeric.
    const named = segments.find((x) => !/^\d+$/.test(x.trim()))
    if (named) s = named
  }

  // Split camel/pascal runs that come from concatenated processor strings,
  // e.g. "DreamplugPaytechSol" -> "Dreamplug Paytech Sol".
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2')

  s = s.toLowerCase()

  // Remove trailing reference/store numbers and transaction ids.
  s = s.replace(/[*#]\s*\w*\d\w*\s*$/g, ' ')
  s = s.replace(/\b\d{3,}\b/g, ' ')

  // Drop location noise that varies per store but not per merchant.
  s = s.replace(/\b(?:llc|inc|ltd|pvt|private|limited|corp|co)\b/g, ' ')

  // Collapse punctuation to spaces, then collapse whitespace.
  s = s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()

  if (s === '') return ''

  // Phrase aliases first — they can override what token aliases would produce.
  const phrase = PHRASE_ALIASES[s]
  if (phrase) return phrase

  // Then token aliases, applied word by word.
  return s
    .split(' ')
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .join(' ')
}

/**
 * A merchant key safe to use inside a hash: normalised, or an explicit marker when
 * normalisation yields nothing. Never returns an empty string, because an empty
 * component would silently collapse distinct transactions together.
 *
 * The `~raw:` sentinel cannot collide with a normalised descriptor, because
 * normalisation only ever emits [a-z0-9 ] and never a tilde.
 */
export function merchantKey(raw: string, region: Region = 'US'): string {
  const n = normalizeDescriptor(raw, region)
  return n === '' ? `~raw:${raw.trim().toLowerCase()}` : n
}
