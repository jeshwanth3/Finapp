'use client'

import { useState, useCallback } from 'react'

/**
 * Sync status bar — shows freshness and provides a "Sync Now" button.
 *
 * Client component because it needs to call the sync API and update state.
 * The freshness label comes from the server via props; the button triggers
 * POST /api/sync and refreshes the page on success.
 */

interface SyncStatusProps {
  lastSuccessAt: string | null
  consecutiveFailures: number
  hasCredentials: boolean
}

function formatAge(isoDate: string): string {
  const ms = Date.now() - Date.parse(isoDate)
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function SyncStatus({ lastSuccessAt, consecutiveFailures, hasCredentials }: SyncStatusProps) {
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const doSync = useCallback(async () => {
    setSyncing(true)
    setLastResult(null)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        setLastResult(`Error: ${data.error}`)
      } else {
        setLastResult(
          `Synced: ${data.parsed} parsed, ${data.ignored} ignored, ${data.quarantined} quarantined`,
        )
        // Reload to show new data
        setTimeout(() => window.location.reload(), 1200)
      }
    } catch (err: unknown) {
      setLastResult(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSyncing(false)
    }
  }, [])

  const neverSynced = lastSuccessAt === null
  const failing = consecutiveFailures > 0

  let dotClass = 'sync-dot sync-dot-ok'
  let label = lastSuccessAt ? `Synced ${formatAge(lastSuccessAt)}` : 'Never synced'

  if (neverSynced) {
    dotClass = 'sync-dot sync-dot-never'
  } else if (failing) {
    dotClass = 'sync-dot sync-dot-fail'
    label = `Sync failing (${consecutiveFailures}×) — last success ${formatAge(lastSuccessAt!)}`
  } else {
    const minutes = Math.round((Date.now() - Date.parse(lastSuccessAt!)) / 60_000)
    if (minutes > 30) {
      dotClass = 'sync-dot sync-dot-stale'
    }
  }

  if (!hasCredentials) {
    return (
      <div className="sync-bar">
        <span className="sync-dot sync-dot-never" />
        <span>Gmail not configured — set GMAIL_USER and GMAIL_APP_PASSWORD in .env.local</span>
      </div>
    )
  }

  return (
    <div className="sync-bar">
      <span className={dotClass} />
      <span>{lastResult ?? label}</span>
      <button className="sync-btn" onClick={doSync} disabled={syncing}>
        {syncing ? (
          <>
            <span className="sync-spinning">↻</span> Syncing…
          </>
        ) : (
          '↻ Sync Now'
        )}
      </button>
    </div>
  )
}
