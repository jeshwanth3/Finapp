'use client'

import React, { useState } from 'react'
import type { Money } from '@/core/money'
import { format, money } from '@/core/money'

interface RunwayGaugeProps {
  readonly liquidAssets: Money
  readonly monthlyBurnRate: Money
  readonly netWorth: Money
}

/**
 * Personal Finance Super-User Control Feature #1:
 * Emergency Runway Calculator (Months of Survival) & Financial Independence (FI) Target Meter.
 */
export function RunwayGauge({ liquidAssets, monthlyBurnRate, netWorth }: RunwayGaugeProps) {
  const [annualSpendMultiplier, setAnnualSpendMultiplier] = useState(25)

  const burnMinor = Math.max(Math.abs(monthlyBurnRate.minor), 100)
  const monthsOfRunway = (liquidAssets.minor / burnMinor).toFixed(1)
  const runwayNum = parseFloat(monthsOfRunway)

  const annualSpendMinor = burnMinor * 12
  const fiTargetMinor = annualSpendMinor * annualSpendMultiplier
  const fiProgressPercent = Math.min(Math.round((netWorth.minor / fiTargetMinor) * 100), 100)

  // Runway shield status
  const shieldColor =
    runwayNum >= 6 ? '#10b981' : runwayNum >= 3 ? '#38bdf8' : runwayNum >= 1 ? '#f59e0b' : '#e11d48'
  const shieldLabel =
    runwayNum >= 6
      ? '6+ Month Security Shield'
      : runwayNum >= 3
        ? '3-Month Safe Target'
        : 'Low Runway Alert'

  return (
    <div
      style={{
        background: 'rgba(18, 18, 18, 0.9)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 'var(--r-2)',
        padding: '16px',
        marginTop: '16px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8f9fa' }}>
          Emergency Runway & FI Target ({liquidAssets.currency})
        </span>
        <span
          className="badge"
          style={{
            background: `${shieldColor}20`,
            color: shieldColor,
            border: `1px solid ${shieldColor}60`,
          }}
        >
          {shieldLabel}
        </span>
      </div>

      {/* Runway Scorecard */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '16px' }}>
        <div style={{ background: 'rgba(0,0,0,0.4)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>
            Liquid Survival Runway
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#ffffff', fontFamily: 'var(--mono)', marginTop: '4px' }}>
            {monthsOfRunway} <span style={{ fontSize: '14px', fontWeight: 600 }}>months</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginTop: '4px' }}>
            Based on {format(monthlyBurnRate)}/mo average burn
          </div>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.4)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>
            FI Target Progress ({annualSpendMultiplier}× Spend)
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#10b981', fontFamily: 'var(--mono)', marginTop: '4px' }}>
            {fiProgressPercent}% <span style={{ fontSize: '14px', fontWeight: 600 }}>of target</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginTop: '4px' }}>
            Target: {format(money(fiTargetMinor, netWorth.currency))}
          </div>
        </div>
      </div>

      {/* FI Progress Multiplier Control */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)' }}>
        <span>Adjust FI Multiplier Goal:</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          {[15, 20, 25, 30].map((mult) => (
            <button
              key={mult}
              onClick={() => setAnnualSpendMultiplier(mult)}
              style={{
                background: annualSpendMultiplier === mult ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255,255,255,0.05)',
                color: annualSpendMultiplier === mult ? '#10b981' : '#f8f9fa',
                border: '1px solid ' + (annualSpendMultiplier === mult ? '#10b981' : 'rgba(255,255,255,0.15)'),
                borderRadius: '4px',
                padding: '3px 8px',
                fontSize: '11px',
                fontFamily: 'var(--mono)',
                cursor: 'pointer',
              }}
            >
              {mult}×
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
