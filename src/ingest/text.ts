/**
 * Message body flattening.
 *
 * Institution mail arrives as an HTML table with the amount in one `<td>` and its
 * label in another, and as a plaintext alternative where the same sentence is hard
 * wrapped at 72 columns. Both break naive regexes in the same way — the phrase the
 * parser is looking for is split across whitespace it did not expect.
 *
 * So every parser works against ONE flattened, single-spaced string. Tags become
 * spaces rather than vanishing, otherwise `<td>Due date</td><td>08/22/2026</td>`
 * flattens to "Due date08/22/2026" and the field silently disappears.
 */

import { type RawMessage } from './types'

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  // Real statement mail uses these around amounts and date ranges.
  ndash: '-',
  mdash: '-',
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      // Drop non-content elements wholesale — a <style> block is full of digits.
      .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
}

/**
 * Every run of whitespace, plus the zero-width family.
 *
 * The `\s` class already covers NBSP. U+200B..U+200D and U+FEFF are listed by escape
 * because HTML mailers sprinkle them inside amounts and the regex engine does not
 * consider them whitespace, so an amount split by one would fail to match.
 */
const INVISIBLE_RUN = new RegExp('[\\s\\u200b\\u200c\\u200d\\ufeff]+', 'g')

/** Collapse every run of whitespace to a single space. */
export function collapseWhitespace(s: string): string {
  return s.replace(INVISIBLE_RUN, ' ').trim()
}

/**
 * The flattened body. Plaintext wins when present: it is what the institution
 * intended to be read, and it has no markup to misparse.
 */
export function messageBody(msg: RawMessage): string {
  if (msg.text !== null && msg.text.trim() !== '') {
    return collapseWhitespace(decodeEntities(msg.text))
  }
  if (msg.html !== null && msg.html.trim() !== '') {
    return collapseWhitespace(stripHtml(msg.html))
  }
  return ''
}

/**
 * Subject plus body, flattened.
 *
 * Several issuers put the whole fact in the subject ("Your statement is ready -
 * $2,709.80 due 08/22") and repeat nothing in the body, so parsers must see both.
 */
export function messageText(msg: RawMessage): string {
  const subject = collapseWhitespace(decodeEntities(msg.subject))
  const body = messageBody(msg)
  if (subject === '') return body
  if (body === '') return subject
  return `${subject} ${body}`
}
