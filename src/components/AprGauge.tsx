'use client'

import React from 'react'

interface AprGaugeProps {
  readonly aprBasisPoints?: number
  readonly isOverdue?: boolean
}

/**
 * Renders a color-coded APR severity pill badge for credit card accounts.
 */
export function AprGauge({ aprBasisPoints, isOverdue }: AprGaugeProps) {
  if (isOverdue) {
    return <span className="badge badge-alert">OVERDUE</span>
  }

  if (aprBasisPoints === undefined) {
    return <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-faint)' }}>APR N/A</span>
  }

  const aprPercent = (aprBasisPoints / 100).toFixed(2)
  let badgeStyle = { background: 'var(--pos-bg)', color: 'var(--pos)', border: '1px solid rgba(52,211,153,0.3)' }

  if (aprBasisPoints > 2000) {
    badgeStyle = { background: 'var(--neg-bg)', color: 'var(--neg)', border: '1px solid rgba(248,113,113,0.3)' }
  } else if (aprBasisPoints > 1500) {
    badgeStyle = { background: 'var(--warn-bg)', color: 'var(--warn)', border: '1px solid rgba(251,191,36,0.3)' }
  }

  return (
    <span className="badge" style={badgeStyle}>
      {aprPercent}% APR
    </span>
  )
}
