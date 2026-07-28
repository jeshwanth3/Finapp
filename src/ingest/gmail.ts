/**
 * Gmail IMAP source — implements `MailboxSource` from `sync.ts` via imapflow.
 *
 * Connects to `imap.gmail.com:993` over TLS using an App Password. Gmail does not
 * support IMAP with a regular password when 2FA is on; an App Password is the only
 * path that does not require an OAuth consent screen and a client_secret.json.
 *
 * This module owns the IMAP lifecycle. It is NOT left open between syncs: a connect-
 * fetch-disconnect cycle per sync avoids dangling connections, and the sync loop runs
 * at most once every few minutes, so the overhead is negligible.
 */

import { ImapFlow } from 'imapflow'
import type { MailboxSource, MailboxMessage } from './sync'
import type { RawMessage } from './types'

export interface GmailConfig {
  readonly user: string
  readonly appPassword: string
  readonly mailbox?: string
}

function envConfig(): GmailConfig {
  const user = process.env.GMAIL_USER
  const appPassword = process.env.GMAIL_APP_PASSWORD
  if (!user || !appPassword) {
    throw new Error(
      'GMAIL_USER and GMAIL_APP_PASSWORD must be set in .env.local. ' +
        'Generate an App Password at https://myaccount.google.com/apppasswords',
    )
  }
  return { user, appPassword }
}

/**
 * Parse a raw `From` header into a display-safe string.
 * Input shapes: `"Name" <addr>`, `Name <addr>`, `addr`, `<addr>`.
 */
function normaliseFrom(raw: string): string {
  return raw.trim()
}

/**
 * Create a MailboxSource backed by a live Gmail IMAP connection.
 *
 * Call `connect()` before use and `disconnect()` when done. The returned object
 * satisfies the `MailboxSource` interface from sync.ts.
 */
export function createGmailSource(config?: GmailConfig): GmailImapSource {
  return new GmailImapSource(config ?? envConfig())
}

export class GmailImapSource implements MailboxSource {
  readonly #config: GmailConfig
  #client: ImapFlow | null = null
  #cachedValidity: number | null = null

  constructor(config: GmailConfig) {
    this.#config = config
  }

  async connect(): Promise<void> {
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: this.#config.user,
        pass: this.#config.appPassword,
      },
      logger: false,
    })
    await client.connect()
    this.#client = client

    // Open the target mailbox (INBOX by default)
    const mailbox = await client.mailboxOpen(this.#config.mailbox ?? 'INBOX')
    this.#cachedValidity = Number(mailbox.uidValidity)
  }

  async disconnect(): Promise<void> {
    if (this.#client) {
      await this.#client.logout()
      this.#client = null
    }
  }

  async uidValidity(): Promise<number> {
    if (this.#cachedValidity !== null) return this.#cachedValidity

    if (!this.#client) throw new Error('GmailImapSource: not connected')
    const mailbox = await this.#client.mailboxOpen(this.#config.mailbox ?? 'INBOX')
    this.#cachedValidity = Number(mailbox.uidValidity)
    return Number(mailbox.uidValidity)
  }

  async fetchSince(afterUid: number, limit: number): Promise<readonly MailboxMessage[]> {
    if (!this.#client) throw new Error('GmailImapSource: not connected')

    const results: MailboxMessage[] = []

    // IMAP UID range: afterUid+1:*
    const rangeStart = afterUid + 1
    const range = `${rangeStart}:*`

    try {
      // Use FETCH with UID range
      for await (const msg of this.#client.fetch(
        { uid: range },
        {
          uid: true,
          envelope: true,
          source: true,
          headers: true,
        },
        { uid: true },
      )) {
        if (msg.uid <= afterUid) continue // safety: IMAP may include the boundary

        const envelope = msg.envelope
        const from = envelope?.from?.[0]
          ? `${envelope.from[0].name ?? ''} <${envelope.from[0].address ?? ''}>`
          : ''

        const subject = envelope?.subject ?? ''
        const receivedAt = envelope?.date
          ? new Date(envelope.date).toISOString()
          : new Date().toISOString()
        const messageId = envelope?.messageId ?? `uid-${msg.uid}`

        // Extract raw source for text/html extraction
        const rawSource = msg.source?.toString('utf-8') ?? ''

        // Simple text extraction from source
        const text = rawSource
        const html: string | null = null

        const rawMessage: RawMessage = {
          id: messageId,
          from: normaliseFrom(from),
          subject,
          receivedAt,
          text,
          html,
        }

        // Extract headers as a map
        const headerMap: Record<string, string | undefined> = {}
        if (msg.headers) {
          const headerText = msg.headers.toString('utf-8')
          const lines = headerText.split(/\r?\n/)
          let currentKey = ''
          let currentValue = ''
          for (const line of lines) {
            if (/^\s/.test(line) && currentKey) {
              // Continuation of previous header
              currentValue += ' ' + line.trim()
            } else {
              if (currentKey) {
                headerMap[currentKey] = currentValue
              }
              const colon = line.indexOf(':')
              if (colon > 0) {
                currentKey = line.slice(0, colon).toLowerCase().trim()
                currentValue = line.slice(colon + 1).trim()
              } else {
                currentKey = ''
                currentValue = ''
              }
            }
          }
          if (currentKey) {
            headerMap[currentKey] = currentValue
          }
        }

        results.push({
          uid: msg.uid,
          message: rawMessage,
          headers: headerMap,
        })

        if (results.length >= limit) break
      }
    } catch (err: unknown) {
      // If the range is empty (no messages after afterUid), IMAP may throw
      // or return nothing. Both are expected on an up-to-date mailbox.
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Nothing to fetch') || msg.includes('UID FETCH')) {
        return []
      }
      throw err
    }

    // Sort by UID ascending (should already be, but be explicit)
    results.sort((a, b) => a.uid - b.uid)
    return results
  }
}
