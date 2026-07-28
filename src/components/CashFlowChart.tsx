'use client'

import React, { useId } from 'react'
import type { Money } from '@/core/money'
import { format } from '@/core/money'

export interface ProjectedDayPoint {
  readonly date: string
  readonly closing: Money
  readonly events: readonly { readonly label: string }[]
}

interface CashFlowChartProps {
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
 * Zero-dependency SVG Line & Area chart for checking balance projections.
 * Placed in the Home Command Center to visually plot trajectory toward trough days.
 */
export function CashFlowChart({ days }: CashFlowChartProps) {
  const gradientId = useId()
  if (days.length === 0) return null

  const width = 640
  const height = 200
  const padX = 40
  const padY = 28

  const values = days.map((d) => d.closing.minor)
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

  // Construct SVG path for line
  const linePoints = days.map((d, i) => `${getX(i)},${getY(d.closing.minor)}`).join(' ')
  // Construct area path
  const areaPoints = `${getX(0)},${zeroY} ${linePoints} ${getX(days.length - 1)},${zeroY}`

  // Find lowest point (trough)
  let troughIndex = 0
  for (let i = 1; i < days.length; i++) {
    if (days[i]!.closing.minor < days[troughIndex]!.closing.minor) {
      troughIndex = i
    }
  }

  return (
    <div className="chart-container">
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} aria-label="Cash flow projection chart">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Zero baseline */}
        <line
          x1={padX}
          y1={zeroY}
          x2={width - padX}
          y2={zeroY}
          stroke="rgba(255,255,255,0.12)"
          strokeDasharray="4 4"
        />

        {/* Area fill under curve */}
        <polygon points={areaPoints} fill={`url(#${gradientId})`} />

        {/* Main projection line */}
        <polyline
          fill="none"
          stroke="#a78bfa"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={linePoints}
        />

        {/* Data points & Event markers */}
        {days.map((d, i) => {
          const x = getX(i)
          const y = getY(d.closing.minor)
          const isTrough = i === troughIndex && days.length > 1
          const isNegative = d.closing.minor < 0
          const color = isNegative ? '#f87171' : isTrough ? '#fbbf24' : '#a78bfa'

          // Show labels for first, last, and trough
          const showLabel = i === 0 || i === days.length - 1 || isTrough

          return (
            <g key={d.date}>
              <circle
                cx={x}
                cy={y}
                r={isTrough ? 5 : 3.5}
                fill={color}
                stroke="#0a0a0f"
                strokeWidth="2"
              />

              {showLabel && (
                <>
                  <text
                    x={x}
                    y={y - 12}
                    textAnchor="middle"
                    fill={color}
                    fontSize="11"
                    fontWeight="600"
                    className="num"
                  >
                    {format(d.closing)}
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
  )
}
