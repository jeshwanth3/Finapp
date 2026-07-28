'use client'

import React, { useState } from 'react'
import type { Money } from '@/core/money'
import { format, money } from '@/core/money'

export interface ProjectedDayPoint {
  readonly date: string
  readonly closing: Money
  readonly events: readonly { readonly label: string }[]
}

interface CashFlow3DChartProps {
  readonly days: readonly ProjectedDayPoint[]
  readonly currency?: string
}

function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * 3D Perspective Cash-Flow Chart with Interactive "What-If" Stress Tester.
 * Engineered for Pure Void Black (#000000) with clean professional English.
 */
export function CashFlow3DChart({ days, currency = 'USD' }: CashFlow3DChartProps) {
  const [simulatedDelta, setSimulatedDelta] = useState(0)

  if (days.length === 0) return null

  const width = 680
  const height = 240
  const padX = 48
  const padY = 32

  // Apply simulated What-If delta to all projected closing balances
  const adjustedDays = days.map((d, index) => ({
    ...d,
    adjustedMinor: d.closing.minor + simulatedDelta * 100,
  }))

  const values = adjustedDays.map((d) => d.adjustedMinor)
  const minVal = Math.min(...values, 0)
  const maxVal = Math.max(...values, 100)
  const range = Math.max(maxVal - minVal, 1)

  const getX = (index: number) => {
    if (days.length === 1) return width / 2
    return padX + (index / (days.length - 1)) * (width - padX * 2)
  }

  const getY = (val: number) => {
    return height - padY - ((val - minVal) / range) * (height - padY * 2)
  }

  const zeroY = getY(0)
  const linePoints = adjustedDays.map((d, i) => `${getX(i)},${getY(d.adjustedMinor)}`).join(' ')
  const areaPoints = `${getX(0)},${zeroY} ${linePoints} ${getX(days.length - 1)},${zeroY}`

  let troughIndex = 0
  for (let i = 1; i < adjustedDays.length; i++) {
    if (adjustedDays[i]!.adjustedMinor < adjustedDays[troughIndex]!.adjustedMinor) {
      troughIndex = i
    }
  }

  return (
    <div>
      {/* What-If Interactive Cash-Flow Sandbox Controls */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '12px 16px',
          background: 'rgba(18, 18, 18, 0.9)',
          borderRadius: 'var(--r-2)',
          border: '1px solid var(--border-cyan)',
          marginBottom: '16px',
        }}
      >
        <div style={{ fontSize: '13px', fontWeight: 600 }}>
          <span className="badge badge-usd" style={{ marginRight: '8px' }}>What-If Sandbox</span>
          Simulate one-time payment or expense:
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {[
            { label: '-$1,000 expense', delta: -1000 },
            { label: '-$500', delta: -500 },
            { label: 'Baseline ($0)', delta: 0 },
            { label: '+$500 deposit', delta: 500 },
            { label: '+$1,000', delta: 1000 },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={() => setSimulatedDelta(opt.delta)}
              style={{
                background: simulatedDelta === opt.delta ? 'rgba(0, 240, 255, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                color: simulatedDelta === opt.delta ? '#00f0ff' : '#f8f9fa',
                border: '1px solid ' + (simulatedDelta === opt.delta ? '#00f0ff' : 'rgba(255, 255, 255, 0.15)'),
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                fontFamily: 'var(--mono)',
                cursor: 'pointer',
                transition: 'all 180ms ease',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3D Perspective Canvas Container */}
      <div
        className="chart-container"
        style={{
          perspective: '1000px',
          overflow: 'visible',
        }}
      >
        <svg
          className="chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          style={{
            transform: 'rotateX(15deg)',
            transformOrigin: 'bottom center',
          }}
          aria-label="3D Cash-Flow Trajectory Projection"
        >
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((ratio) => {
            const y = padY + ratio * (height - padY * 2)
            return (
              <line
                key={ratio}
                x1={padX}
                y1={y}
                x2={width - padX}
                y2={y}
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            )
          })}

          {/* Zero baseline ($0 threshold) */}
          <line
            x1={padX}
            y1={zeroY}
            x2={width - padX}
            y2={zeroY}
            stroke="rgba(244, 63, 94, 0.5)"
            strokeWidth="1.5"
            strokeDasharray="6 3"
          />
          <text
            x={padX + 6}
            y={zeroY - 6}
            fill="rgba(244, 63, 94, 0.85)"
            fontSize="11"
            fontFamily="var(--mono)"
            fontWeight="600"
          >
            $0 Shortfall Threshold
          </text>

          {/* Area Fill */}
          <polygon points={areaPoints} fill="rgba(0, 240, 255, 0.15)" />

          {/* 3D Main Projection Trajectory */}
          <polyline
            fill="none"
            stroke="#00f0ff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={linePoints}
            style={{ filter: 'drop-shadow(0 0 10px rgba(0, 240, 255, 0.7))' }}
          />

          {/* Daily 3D Pillar Markers */}
          {adjustedDays.map((d, i) => {
            const x = getX(i)
            const y = getY(d.adjustedMinor)
            const isTrough = i === troughIndex && adjustedDays.length > 1
            const isNegative = d.adjustedMinor < 0
            const hasEvent = d.events.length > 0

            const color = isNegative ? '#f43f5e' : isTrough ? '#ffb800' : '#00f0ff'
            const showLabel = i === 0 || i === adjustedDays.length - 1 || isTrough || hasEvent

            return (
              <g key={d.date}>
                {/* Vertical Depth Line */}
                <line
                  x1={x}
                  y1={y}
                  x2={x}
                  y2={zeroY}
                  stroke={color}
                  strokeWidth="1"
                  strokeOpacity="0.3"
                  strokeDasharray="2 2"
                />

                {/* 3D Pillar Node Core */}
                <circle
                  cx={x}
                  cy={y}
                  r={isTrough ? 6 : hasEvent ? 5 : 4}
                  fill={color}
                  stroke="#000000"
                  strokeWidth="2"
                  style={{ filter: `drop-shadow(0 0 6px ${color})` }}
                />

                {/* Balance & Date Readout */}
                {showLabel && (
                  <>
                    <text
                      x={x}
                      y={y - 12}
                      textAnchor="middle"
                      fill={color}
                      fontSize="11"
                      fontFamily="var(--mono)"
                      fontWeight="700"
                      className="num"
                    >
                      {format(money(d.adjustedMinor, currency))}
                    </text>

                    <text
                      x={x}
                      y={height - 6}
                      textAnchor="middle"
                      className="chart-axis-text"
                    >
                      {formatShortDate(d.date)}
                    </text>
                  </>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '10px',
          fontSize: '11px',
          fontFamily: 'var(--mono)',
          color: 'var(--text-muted)',
        }}
      >
        <span>● CYAN: CHECKING BALANCE TRAJECTORY</span>
        <span>● GOLD: LOWEST PROJECTED BALANCE (TROUGH)</span>
        <span>● RED: $0 SHORTFALL LINE</span>
      </div>
    </div>
  )
}
