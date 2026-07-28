import { format, type Money as MoneyValue } from '@/core/money'

/**
 * Renders a Money value with tabular formatting and clean currency badges.
 *
 * Optional showBadge renders a professional pill badge (USD or INR).
 */
export function Money({
  value,
  locale,
  showBadge = false,
}: {
  value: MoneyValue
  locale?: string
  showBadge?: boolean
}) {
  const badgeClass = value.currency === 'USD' ? 'badge badge-usd' : 'badge badge-inr'
  return (
    <span className="num" data-currency={value.currency} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <span>{format(value, locale)}</span>
      {showBadge && <span className={badgeClass}>{value.currency}</span>}
    </span>
  )
}
