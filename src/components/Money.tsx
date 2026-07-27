import { format, type Money as MoneyValue } from '@/core/money'

/**
 * Renders a Money value.
 *
 * Always tabular-figured so columns align, and always carries its currency, because
 * every screen in this app is potentially cross-currency (spec §10). There is no
 * prop to render a bare number — that would be the ambiguity this type exists to
 * prevent.
 */
export function Money({ value, locale }: { value: MoneyValue; locale?: string }) {
  return (
    <span className="num" data-currency={value.currency}>
      {format(value, locale)}
    </span>
  )
}
