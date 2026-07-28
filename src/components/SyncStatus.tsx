'use client'

import { useState, useCallback } from 'react'

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
        setLastResult(`Sync error: ${data.error}`)
      } else {
        setLastResult(
          `Sync complete: ${data.parsed} parsed · ${data.ignored} ignored · ${data.quarantined} quarantined`,
        )
        setTimeout(() => window.location.reload(), 1200)
      }
    } catch (err: unknown) {
      setLastResult(`Sync failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSyncing(false)
    }
  }, [])

  const neverSynced = lastSuccessAt === null
  const failing = consecutiveFailures > 0

  let dotClass = 'pulse-dot pulse-dot-ok'
  let label = lastSuccessAt
    ? `Live inbox connection · Synced ${formatAge(lastSuccessAt)}`
    : 'No email sync data yet'

  if (neverSynced) {
    dotClass = 'sync-dot sync-dot-never'
  } else if (failing) {
    dotClass = 'sync-dot sync-dot-fail'
    label = `Connection degraded (${consecutiveFailures} consecutive errors)`
  } else {
    const minutes = Math.round((Date.now() - Date.parse(lastSuccessAt!)) / 60_000)
    if (minutes > 30) {
      dotClass = 'sync-dot sync-dot-stale'
    }
  }

  if (!hasCredentials) {
    return (
      <div className="sync-bar" style={{ borderColor: 'rgba(255,184,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="sync-dot sync-dot-stale" />
          <span><strong>Gmail not configured</strong> — Add GMAIL_USER & GMAIL_APP_PASSWORD to `.env.local`</span>
        </div>
      </div>
    )
  }

  return (
    <div className="sync-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span className={dotClass} />
        <span>{lastResult ?? label}</span>
      </div>
      <button className="sync-btn" onClick={doSync} disabled={syncing}>
        {syncing ? (
          <>
            <span className="sync-spinning">↻</span> Syncing...
          </>
        ) : (
          '↻ Sync Now'
        )}
      </button>
    </div>
  )
}
