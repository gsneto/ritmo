import { describe, expect, it } from 'vitest'
import { toLocalDateValue } from './date'

describe('toLocalDateValue', () => {
  it('formats the calendar date using local components', () => {
    const localLateNight = new Date(2026, 6, 29, 23, 45)

    expect(toLocalDateValue(localLateNight)).toBe('2026-07-29')
  })

  it('pads single-digit months and days', () => {
    expect(toLocalDateValue(new Date(2026, 0, 5, 8))).toBe('2026-01-05')
  })
})
