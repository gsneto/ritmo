import { describe, expect, it } from 'vitest'
import {
  HOME_DUMBBELL_PLAN,
  formatTimer,
  parseWeight,
} from './WorkoutsPanel'

describe('guided home workout helpers', () => {
  it('formats elapsed and rest timers', () => {
    expect(formatTimer(0)).toBe('00:00')
    expect(formatTimer(75)).toBe('01:15')
    expect(formatTimer(3_661)).toBe('01:01:01')
  })

  it('accepts Brazilian decimal weights and rejects unsafe values', () => {
    expect(parseWeight('8,5')).toBe('8.50')
    expect(parseWeight(' 12 ')).toBe('12.00')
    expect(parseWeight('-1')).toBeNull()
    expect(parseWeight('8,555')).toBeNull()
    expect(parseWeight('501')).toBeNull()
  })

  it('ships a seven-day plan that only needs dumbbells and home support', () => {
    expect(HOME_DUMBBELL_PLAN).toHaveLength(7)
    expect(HOME_DUMBBELL_PLAN.map(workout => workout.day)).toEqual([
      'Seg',
      'Ter',
      'Qua',
      'Qui',
      'Sex',
      'Sáb',
      'Dom',
    ])

    const planText = JSON.stringify(HOME_DUMBBELL_PLAN).toLocaleLowerCase('pt-BR')
    for (const gymOnlyTerm of ['leg press', 'puxada frontal', 'máquina', 'academia']) {
      expect(planText).not.toContain(gymOnlyTerm)
    }
  })
})
