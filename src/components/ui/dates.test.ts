import { describe, expect, it } from 'vitest'
import {
  InvalidDateError,
  daysApart,
  formatDay,
  formatFullDay,
  parseDay,
  relativeDayLabel,
  stalenessLabel,
} from './dates'

describe('parseDay', () => {
  it('parses a well-formed day', () => {
    expect(parseDay('2026-07-26')).toEqual({ year: 2026, month: 7, day: 26 })
  })

  it('accepts a real leap day', () => {
    expect(parseDay('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 })
  })

  it('rejects a day that Date.UTC would silently roll forward', () => {
    expect(() => parseDay('2026-02-30')).toThrow(InvalidDateError)
    expect(() => parseDay('2026-02-29')).toThrow(InvalidDateError)
    expect(() => parseDay('2026-13-01')).toThrow(InvalidDateError)
  })

  it('rejects malformed shapes rather than guessing', () => {
    expect(() => parseDay('2026-7-26')).toThrow(InvalidDateError)
    expect(() => parseDay('26 July 2026')).toThrow(InvalidDateError)
    expect(() => parseDay('')).toThrow(InvalidDateError)
  })
})

describe('daysApart', () => {
  it('counts forward and backward', () => {
    expect(daysApart('2026-07-26', '2026-07-29')).toBe(3)
    expect(daysApart('2026-07-29', '2026-07-26')).toBe(-3)
    expect(daysApart('2026-07-26', '2026-07-26')).toBe(0)
  })

  it('crosses month and year boundaries', () => {
    expect(daysApart('2026-07-31', '2026-08-01')).toBe(1)
    expect(daysApart('2025-12-31', '2026-01-01')).toBe(1)
  })

  it('is unaffected by daylight-saving transitions', () => {
    // US DST ends 2026-11-01; a naive local-time diff would return 0 or 2 here.
    expect(daysApart('2026-10-31', '2026-11-02')).toBe(2)
  })
})

describe('formatting', () => {
  it('renders the compact and full forms', () => {
    expect(formatDay('2026-07-24')).toBe('Jul 24')
    expect(formatFullDay('2026-07-24')).toBe('Jul 24, 2026')
  })
})

describe('relativeDayLabel', () => {
  it('uses words a screen reader can read', () => {
    expect(relativeDayLabel('2026-07-26', '2026-07-26')).toBe('today')
    expect(relativeDayLabel('2026-07-27', '2026-07-26')).toBe('tomorrow')
    expect(relativeDayLabel('2026-07-25', '2026-07-26')).toBe('yesterday')
    expect(relativeDayLabel('2026-07-30', '2026-07-26')).toBe('in 4 days')
    expect(relativeDayLabel('2026-07-20', '2026-07-26')).toBe('6 days ago')
  })
})

describe('stalenessLabel', () => {
  it('describes the age of an observation', () => {
    expect(stalenessLabel('2026-07-26', '2026-07-26')).toBe('observed today')
    expect(stalenessLabel('2026-07-25', '2026-07-26')).toBe('observed yesterday')
    expect(stalenessLabel('2026-07-12', '2026-07-26')).toBe('observed 14 days ago')
  })

  it('does not pretend a future-dated observation is fresh', () => {
    expect(stalenessLabel('2026-08-01', '2026-07-26')).toBe('dated Aug 1, in the future')
  })
})
