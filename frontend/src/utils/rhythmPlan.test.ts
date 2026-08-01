import { describe, expect, it } from 'vitest'
import type { Task } from '../services/api'
import type { WorkoutSession, WorkoutTemplate } from '../services/workoutSessionApi'
import { buildRhythmPlan } from './rhythmPlan'

type RhythmPlanInput = Parameters<typeof buildRhythmPlan>[0]
type TodayHabit = RhythmPlanInput['habits'][number]

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  user_id: 1,
  name: 'Organizar o dia',
  date: '2026-08-01',
  time: '10:00',
  completed_at: null,
  recurrence: 'none',
  recurrence_interval: 1,
  recurrence_parent_id: null,
  created_at: '2026-08-01T08:00:00Z',
  ...overrides,
})

const habit = (overrides: Partial<TodayHabit> = {}): TodayHabit => ({
  id: 1,
  name: 'Beber agua',
  time: '08:00',
  done: false,
  ...overrides,
})

const workout = (overrides: Partial<WorkoutTemplate> = {}): WorkoutTemplate => ({
  id: 1,
  user_id: 1,
  day: 'Segunda',
  title: 'Treino em casa',
  note: '',
  exercises: [{ id: 1, name: 'Agachamento', sets: '3', reps: '12' }],
  ...overrides,
})

const activeWorkout = (overrides: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: 12,
  user_id: 1,
  workout_id: 1,
  workout_title: 'Treino em casa',
  workout_day: 'Segunda',
  status: 'active',
  rest_seconds: 60,
  started_at: '2026-08-01T09:00:00Z',
  completed_at: null,
  duration_seconds: null,
  total_sets: 6,
  completed_sets: 2,
  max_weight_kg: 10,
  total_volume_kg: 120,
  exercises: [],
  ...overrides,
})

const input = (overrides: Partial<RhythmPlanInput> = {}): RhythmPlanInput => ({
  currentDate: '2026-08-01',
  currentTime: '10:00',
  habits: [],
  pendingTasks: [],
  shoppingLists: [],
  activeBook: null,
  todayWorkout: null,
  activeWorkout: null,
  workoutCompletedToday: false,
  ...overrides,
})

describe('buildRhythmPlan', () => {
  it('puts an active workout before every other suggestion', () => {
    const actions = buildRhythmPlan(input({
      activeWorkout: activeWorkout(),
      pendingTasks: [task({ id: 3, name: 'Responder mensagem', time: '09:00' })],
      habits: [habit()],
    }))

    expect(actions[0]).toMatchObject({
      id: 'workout-session-12',
      kind: 'workout',
      label: 'Retomar treino',
    })
  })

  it('prioritizes a task overdue from a previous day over current and future tasks', () => {
    const actions = buildRhythmPlan(input({
      pendingTasks: [
        task({ id: 1, name: 'Tarefa de ontem', date: '2026-07-31', time: '20:00' }),
        task({ id: 2, name: 'Tarefa de agora', date: '2026-08-01', time: '09:00' }),
        task({ id: 3, name: 'Tarefa futura', date: '2026-08-01', time: '14:00' }),
      ],
    }))

    expect(actions[0]).toMatchObject({
      id: 'task-1',
      eyebrow: 'Tarefa atrasada',
      title: 'Tarefa de ontem',
    })
  })

  it('gives a pending habit a direct check-in action when its time has arrived', () => {
    const actions = buildRhythmPlan(input({
      habits: [habit({ id: 7, name: 'Leitura', time: '09:30' })],
    }))

    expect(actions[0]).toMatchObject({
      id: 'habit-7',
      kind: 'habit',
      label: 'Marcar agora',
      habitId: 7,
    })
  })

  it('caps the plan at three distinct actions even when source data repeats an id', () => {
    const actions = buildRhythmPlan(input({
      pendingTasks: [
        task({ id: 5, name: 'Pendente de ontem', date: '2026-07-31', time: '18:00' }),
        task({ id: 5, name: 'Duplicada mais tarde', date: '2026-08-01', time: '14:00' }),
      ],
      habits: [
        habit({ id: 1, name: 'Agua', time: '08:00' }),
        habit({ id: 2, name: 'Caminhada', time: '18:00' }),
      ],
      todayWorkout: workout({ id: 9 }),
    }))

    expect(actions).toHaveLength(3)
    expect(actions.map(action => action.id)).toEqual([
      'task-5',
      'habit-1',
      'habit-2',
    ])
    expect(new Set(actions.map(action => action.id)).size).toBe(actions.length)
  })

  it('returns a gentle fallback plan when there is nothing pending', () => {
    expect(buildRhythmPlan(input())).toEqual([{
      id: 'plan-day',
      kind: 'plan',
      eyebrow: 'Dia organizado',
      title: 'Voc\u00ea est\u00e1 em dia',
      detail: 'Use este espa\u00e7o para escolher uma pr\u00f3xima a\u00e7\u00e3o leve.',
      to: '/tasks?create=1',
      label: 'Planejar algo',
    }])
  })

  it('does not suggest the planned workout after a workout was completed today', () => {
    const actions = buildRhythmPlan(input({
      todayWorkout: workout(),
      workoutCompletedToday: true,
    }))

    expect(actions.some(action => action.id.startsWith('workout-plan-'))).toBe(false)
    expect(actions[0]).toMatchObject({
      id: 'plan-day',
      eyebrow: 'Dia organizado',
    })
  })
})
