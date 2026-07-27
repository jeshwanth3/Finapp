import { describe, expect, it } from 'vitest'

import { DateParseError, fromComponents, isoDateOfInstant, isValidIsoDate, parseSlashDate } from './dates'

describe('parseSlashDate — field order is asserted, never inferred', () => {
  /**
   * The whole point of this module. 12/07/26 is a real date under both readings and
   * they are five months apart, so nothing downstream would ever notice the mistake.
   */
  it('reads 12/07/26 as 12 July under DMY and 7 December under MDY', () => {
    expect(parseSlashDate('12/07/26', 'DMY')).toBe('2026-07-12')
    expect(parseSlashDate('12/07/26', 'MDY')).toBe('2026-12-07')
  })

  it('reads a four-digit year the same way', () => {
    expect(parseSlashDate('08/22/2026', 'MDY')).toBe('2026-08-22')
    expect(parseSlashDate('18/06/2026', 'DMY')).toBe('2026-06-18')
  })

  it('accepts dash and dot separators', () => {
    expect(parseSlashDate('28-06-26', 'DMY')).toBe('2026-06-28')
    expect(parseSlashDate('06.18.2026', 'MDY')).toBe('2026-06-18')
  })

  it('maps two-digit years into the current century', () => {
    expect(parseSlashDate('01/01/99', 'DMY')).toBe('2099-01-01')
  })

  it('throws rather than swapping fields when the stated order is impossible', () => {
    // 28/06 under MDY is month 28. Silently reading it as DMY would mask a
    // mislabelled parser and make every other date from that parser wrong.
    expect(() => parseSlashDate('28/06/26', 'MDY')).toThrow(DateParseError)
    expect(() => parseSlashDate('13/07/26', 'MDY')).toThrow(/month 13 is out of range/)
  })

  it('rejects a day that does not exist in that month', () => {
    expect(() => parseSlashDate('31/02/26', 'DMY')).toThrow(/day 31 is out of range 1-28/)
    // 2024 is a leap year, 2026 is not — the check uses the real calendar.
    expect(parseSlashDate('29/02/24', 'DMY')).toBe('2024-02-29')
    expect(() => parseSlashDate('29/02/26', 'DMY')).toThrow(DateParseError)
  })

  it('rejects text that is not a numeric date at all', () => {
    expect(() => parseSlashDate('July 12, 2026', 'DMY')).toThrow(DateParseError)
    expect(() => parseSlashDate('2026-07-12', 'DMY')).toThrow(DateParseError)
  })

  it('reports the original raw text, which is what a human has to look at', () => {
    expect(() => parseSlashDate(' 13/07/26 ', 'MDY')).toThrow(/"13\/07\/26"/)
  })
})

describe('fromComponents', () => {
  it('assembles and zero-pads', () => {
    expect(fromComponents(2026, 7, 4, 'x')).toBe('2026-07-04')
  })

  it('rejects an implausible year instead of emitting a five-digit ISO string', () => {
    expect(() => fromComponents(26, 7, 4, '07/04/26')).toThrow(DateParseError)
  })
})

describe('isValidIsoDate', () => {
  it('accepts only real calendar dates in YYYY-MM-DD', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true)
    expect(isValidIsoDate('2026-02-29')).toBe(false)
    expect(isValidIsoDate('2026-13-01')).toBe(false)
    expect(isValidIsoDate('2026-7-4')).toBe(false)
    expect(isValidIsoDate('')).toBe(false)
  })
})

describe('isoDateOfInstant', () => {
  it('takes the UTC calendar date, consistently across host timezones', () => {
    expect(isoDateOfInstant('2026-07-14T18:42:11Z')).toBe('2026-07-14')
    // 01:30 in +05:30 is still 20:00 the previous day in UTC.
    expect(isoDateOfInstant('2026-07-14T01:30:00+05:30')).toBe('2026-07-13')
  })

  it('rejects anything that is not an ISO-8601 instant', () => {
    expect(() => isoDateOfInstant('2026-07-14')).toThrow(DateParseError)
    expect(() => isoDateOfInstant('yesterday')).toThrow(DateParseError)
  })
})
