'use client'

import React from 'react'
import type { Money } from '@/core/money'
import { format } from '@/core/money'

export interface FxSectorSummary {
  readonly currency: string
  readonly netWorth: Money
  readonly accountCount: number
}

interface FxExposureCardProps {
  readonly sectors: readonly FxSectorSummary[]
}

/**
 * Personal Finance Super-User Control Feature #2:
 * Cross-Border FX Exposure & Allocation Bar.
 * Displays percentage allocation of net worth between USD and INR without crossing currencies.
 */
export function FxExposureCard({ sectors }: FxExposureCardProps) {
  if (sectors.length === 0) return null

  // Calculate proportional share based on normalized relative weight (1 USD ~= 86 INR reference weight for visual allocation bar only)
  const weights = sectors.map((s) => {
    const rawVal = Math.max(s.netWorth.minor, 0)
    const normalized = s.currency === 'INR' ? rawVal / 86 : rawVal
    return {
      sector: s,
      normalized,
    }
  })

  const totalNorm = weights.reduce((acc, w) => acc + w.normalized, 0)
  const percentages = weights.map((w) => ({
    ...w,
    pct: totalNorm > 0 ? Math.round((w.normalized / totalNorm) * 100) : 50,
  }))

  return (
    <div className="card" style={{ marginBottom: 'var(--sp-6)' }}>
      <div className="section-head">
        <h2 className="section-title">Cross-Border Currency Exposure</h2>
        <span className="hint">Strictly segregated currency pools</span>
      </div>

      {/* Visual FX Allocation Bar */}
      <div
        style={{
          width: '100%',
          height: '14px',
          background: 'rgba(255,255,255,0.05)',
          borderRadius: 'var(--r-full)',
          overflow: 'hidden',
          display: 'flex',
          border: '1px solid var(--glass-border)',
          marginBottom: '16px',
        }}
      >
        {percentages.map((item, index) => (
          <div
            key={item.sector.currency}
            style={{
              width: `${Math.max(item.pct, 10)}%`,
              height: '100%',
              background:
                item.sector.currency === 'USD'
                  ? 'linear-gradient(90deg, #38bdf8 0%, #0284c7 100%)'
                  : 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)',
              boxShadow: 'none',
            }}
            title={`${item.sector.currency}: ${format(item.sector.netWorth)} (${item.pct}%)`}
          />
        ))}
      </div>

      {/* Sector Breakdown Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        {percentages.map((item) => (
          <div
            key={item.sector.currency}
            style={{
              padding: '12px',
              borderRadius: '8px',
              background: 'rgba(0,0,0,0.4)',
              border:
                '1px solid ' +
                (item.sector.currency === 'USD' ? 'var(--border-cyan)' : 'var(--border-gold)'),
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className={item.sector.currency === 'USD' ? 'badge badge-usd' : 'badge badge-inr'}>
                {item.sector.currency} Sector
              </span>
              <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{item.pct}% Share</span>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--mono)', marginTop: '8px' }}>
              {format(item.sector.netWorth)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'var(--mono)' }}>
              {item.sector.accountCount} active accounts tracked
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
