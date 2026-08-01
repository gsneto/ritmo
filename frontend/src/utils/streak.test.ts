import { describe, expect, it } from 'vitest'
import { getHabitStreak, getStreakBadge } from './streak'

describe('getStreakBadge', () => {
  it.each([
    [0, null],
    [6, null],
    [7, 'Em ritmo'],
    [30, 'Constância'],
    [100, 'Imparável'],
    [365, 'Um ano de ritmo'],
    [500, 'Um ano de ritmo'],
  ])('maps %i days to the expected milestone', (days, label) => {
    expect(getStreakBadge(days)?.label ?? null).toBe(label)
  })
})

describe('getHabitStreak', () => {
  it('keeps the previous streak while today is still unfinished', () => {
    const today = new Date(2026, 7, 1)
    const checkIns = [
      '2026-07-31',
      '2026-07-30',
      '2026-07-29',
      '2026-07-28',
      '2026-07-27',
      '2026-07-26',
      '2026-07-25',
    ]

    expect(getHabitStreak(checkIns, [0, 1, 2, 3, 4, 5, 6], today)).toBe(7)
  })

  it('ignores unscheduled days when calculating continuity', () => {
    const today = new Date(2026, 7, 3)
    const checkIns = ['2026-08-03', '2026-07-31', '2026-07-30']

    expect(getHabitStreak(checkIns, [0, 1, 2, 3, 4], today)).toBe(3)
  })
})
