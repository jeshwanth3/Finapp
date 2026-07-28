'use client'

import React from 'react'
import type { Money } from '@/core/money'
import { format } from '@/core/money'

interface NetWorthBarProps {
  readonly totalAssets: Money
  readonly totalLiabilities: Money
  readonly currency: string
}

/**
 * Visual Assets vs Liabilities stacked bar gauge.
 * Displays percentage share and coverage ratio for a specific currency.
 */
export function NetWorthBar({ totalAssets, totalLiabilities, currency }: NetWorthBarProps) {
  const assetsVal = Math.max(totalAssets.minor, 0)
  const liabVal = Math.max(totalLiabilities.minor, 0)
  const total = assetsVal + liabVal

  const assetPct = total > 0 ? Math.round((assetsVal / total) * 100) : 50
  const liabPct = total > 0 ? 100 - assetPct : 50

  return (
    <div style={{ marginTop: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px', fontWeight: 600 }}>
        <span className="pos">ASSETS {assetPct}%</span>
        <span className="neg">LIABILITIES {liabPct}%</span>
      </div>

      {/* Track */}
      <div
        style={{
          width: '100%',
          height: '10px',
          background: 'var(--surface-2)',
          borderRadius: 'var(--r-full)',
          overflow: 'hidden',
          display: 'flex',
          border: '1px solid var(--glass-border)',
        }}
      >
        {/* Assets segment */}
        <div
          style={{
            width: `${assetPct}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)',
            transition: 'width 400ms ease',
          }}
          title={`Assets: ${format(totalAssets)}`}
        />
        {/* Liabilities segment */}
        <div
          style={{
            width: `${liabPct}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #f87171 0%, #ef4444 100%)',
            transition: 'width 400ms ease',
          }}
          title={`Liabilities: ${format(totalLiabilities)}`}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '6px', color: 'var(--text-muted)' }}>
        <span className="num">{format(totalAssets)}</span>
        <span className="num">{format(totalLiabilities)}</span>
      </div>
    </div>
  )
}
