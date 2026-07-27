import { describe, expect, it } from 'vitest'
import { cx } from './cx'

describe('cx', () => {
  it('joins truthy strings with single spaces', () => {
    expect(cx('card', 'card-tight')).toBe('card card-tight')
  })

  it('drops falsy and blank entries rather than emitting stray spaces', () => {
    expect(cx('row', false, undefined, null, '', '   ', 'row-link')).toBe('row row-link')
  })

  it('returns an empty string when nothing survives', () => {
    expect(cx(undefined, false)).toBe('')
  })

  it('trims each part so template holes cannot leak whitespace', () => {
    expect(cx('  pill  ', ' pill-warn ')).toBe('pill pill-warn')
  })
})
