import { describe, expect, it } from 'vitest'
import {
  HOME_DUMBBELL_PLAN,
  formatTimer,
  parseWeight,
  sessionInputDefaults,
} from './WorkoutsPanel'
import type { WorkoutSession } from '../services/workoutSessionApi'

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

  it('prefills a new session with each set from the previous performance', () => {
    const session: WorkoutSession = {
      id: 20,
      user_id: 1,
      workout_id: 2,
      workout_title: 'Treino em casa',
      workout_day: 'Seg',
      status: 'active',
      rest_seconds: 60,
      started_at: '2026-07-29T10:00:00-03:00',
      completed_at: null,
      duration_seconds: null,
      total_sets: 2,
      completed_sets: 0,
      max_weight_kg: '0.00',
      total_volume_kg: '0.00',
      exercises: [
        {
          id: 30,
          exercise_id: 4,
          name: 'Supino no chão com halteres',
          target_sets: 2,
          planned_reps: '10',
          sort_order: 0,
          sets: [
            {
              id: 40,
              set_number: 1,
              weight_kg: null,
              reps_completed: null,
              completed_at: null,
            },
            {
              id: 41,
              set_number: 2,
              weight_kg: null,
              reps_completed: null,
              completed_at: null,
            },
          ],
          progress: {
            exercise_name: 'Supino no chão com halteres',
            last_session_at: '2026-07-27T10:00:00-03:00',
            last_weight_kg: '8.00',
            last_reps_completed: 10,
            last_completed_sets: 2,
            last_target_sets: 2,
            last_sets: [
              { set_number: 1, weight_kg: '7.50', reps_completed: 10 },
              { set_number: 2, weight_kg: '8.00', reps_completed: 9 },
            ],
            personal_record_weight_kg: '8.00',
            personal_record_reps: 10,
            personal_record_volume_kg: '147.00',
            suggested_weight_kg: '8.00',
            suggestion_action: 'maintain',
            suggestion_text: 'Mantenha a carga.',
            rest_seconds: 90,
            increment_kg: '0.50',
            evolution: [],
          },
        },
      ],
    }

    expect(sessionInputDefaults(session)).toEqual({
      weights: { 40: '7.5', 41: '8' },
      reps: { 40: '10', 41: '9' },
    })
  })
})
