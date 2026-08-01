import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('html-to-image', () => ({
  toPng: vi.fn(),
}))

vi.mock('../services/workoutSessionApi', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/workoutSessionApi')>()
  return {
    ...actual,
    workoutSessionApi: {
      getWorkouts: vi.fn(),
      replaceWorkouts: vi.fn(),
      getActiveSession: vi.fn(),
      startSession: vi.fn(),
      setSetState: vi.fn(),
      finishSession: vi.fn(),
      discardSession: vi.fn(),
      getHistory: vi.fn(),
      updateExercisePreference: vi.fn(),
    },
  }
})

import {
  HOME_DUMBBELL_PLAN,
  findNextIncompleteSet,
  formatTimer,
  parseWeight,
  sessionInputDefaults,
} from './WorkoutsPanel'
import WorkoutsPanel from './WorkoutsPanel'
import {
  workoutSessionApi,
  type WorkoutHistory,
  type WorkoutSession,
  type WorkoutTemplate,
} from '../services/workoutSessionApi'
import { getExerciseVideo } from '../utils/exerciseVideos'
import { toPng } from 'html-to-image'

const workout: WorkoutTemplate = {
  id: 2,
  user_id: 1,
  day: 'Seg',
  title: 'Treino em casa',
  note: 'Treino simples',
  exercises: [
    {
      id: 4,
      name: 'Supino no chão com halteres',
      sets: '2',
      reps: '10',
    },
  ],
}

function sessionWithCompletedSets(
  completedSets: number,
  startedAt = new Date().toISOString(),
): WorkoutSession {
  return {
    id: 20,
    user_id: 1,
    workout_id: 2,
    workout_title: 'Treino em casa',
    workout_day: 'Seg',
    status: 'active',
    rest_seconds: 60,
    started_at: startedAt,
    completed_at: null,
    duration_seconds: null,
    total_sets: 2,
    completed_sets: completedSets,
    max_weight_kg: completedSets ? '8.50' : '0.00',
    total_volume_kg: completedSets ? '85.00' : '0.00',
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
            weight_kg: completedSets ? '8.50' : null,
            reps_completed: completedSets ? 10 : null,
            completed_at: completedSets ? new Date().toISOString() : null,
          },
          {
            id: 41,
            set_number: 2,
            weight_kg: null,
            reps_completed: null,
            completed_at: null,
          },
        ],
        progress: null,
      },
    ],
  }
}

const emptyHistory: WorkoutHistory = {
  total_sessions: 0,
  total_minutes: 0,
  completed_sets: 0,
  total_volume_kg: '0.00',
  sessions: [],
  exercise_progress: [],
}

describe('guided home workout helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(workoutSessionApi.getWorkouts).mockResolvedValue([workout])
    vi.mocked(workoutSessionApi.getActiveSession).mockResolvedValue(null)
    vi.mocked(workoutSessionApi.getHistory).mockResolvedValue(emptyHistory)
    vi.mocked(workoutSessionApi.startSession).mockResolvedValue(
      sessionWithCompletedSets(0),
    )
    vi.mocked(workoutSessionApi.setSetState).mockResolvedValue(
      sessionWithCompletedSets(1),
    )
    vi.mocked(workoutSessionApi.discardSession).mockResolvedValue(undefined)
    vi.mocked(toPng).mockResolvedValue('data:image/png;base64,ritmo')
  })

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

  it('provides a local execution clip for every exercise in the home plan', () => {
    const exercises = HOME_DUMBBELL_PLAN.flatMap(item => item.exercises)

    expect(exercises.length).toBeGreaterThan(0)
    for (const exercise of exercises) {
      expect(getExerciseVideo(exercise.name)?.src).toMatch(/^\/exercise-videos\/.+\.mp4$/)
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

  it('finds the next unfinished set in workout order', () => {
    const session = sessionWithCompletedSets(1)

    expect(findNextIncompleteSet(session)).toMatchObject({
      exerciseIndex: 0,
      set: { id: 41, set_number: 2 },
    })
  })

  it('starts API and timers only after weight and explicit confirmation', async () => {
    render(
      <WorkoutsPanel
        userId={1}
        isOpen
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar treino' }))

    expect(screen.getByRole('heading', { name: 'Qual peso você vai usar?' })).toBeTruthy()
    expect(workoutSessionApi.startSession).not.toHaveBeenCalled()
    expect(workoutSessionApi.setSetState).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Peso que vou usar'), {
      target: { value: '8,5' },
    })
    fireEvent.change(screen.getByLabelText('Repetições que vou fazer'), {
      target: { value: '10' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }))

    expect(screen.getByRole('heading', { name: 'Podemos iniciar a série?' })).toBeTruthy()
    expect(workoutSessionApi.startSession).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Sim, iniciar série' }))

    await waitFor(() => {
      expect(workoutSessionApi.startSession).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByRole('heading', { name: 'Série em andamento' })).toBeTruthy()
    expect(screen.getByRole('timer').textContent).toBe('00:00')
    expect(workoutSessionApi.setSetState).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Sim, terminei a série' }))

    await waitFor(() => {
      expect(workoutSessionApi.setSetState).toHaveBeenCalledWith(40, {
        completed: true,
        weight_kg: '8.50',
        reps_completed: 10,
      })
    })
    expect(await screen.findByRole('heading', { name: 'Hora do descanso' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Já descansei' }))

    expect(screen.getByRole('heading', { name: 'Qual peso você vai usar?' })).toBeTruthy()
    expect(screen.getByText('Série 2 de 2', { exact: false })).toBeTruthy()
    expect(workoutSessionApi.startSession).toHaveBeenCalledTimes(1)
  })

  it('previews the exercise video in preparation without starting a session or timer', async () => {
    const { container } = render(<WorkoutsPanel userId={1} isOpen />)

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar treino' }))
    expect(screen.getByRole('heading', { name: 'Qual peso voc\u00ea vai usar?' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Ver execu\u00e7\u00e3o' }))

    const closeButton = await screen.findByRole('button', { name: 'Fechar execu\u00e7\u00e3o' })
    const video = container.querySelector('video')
    const videoSource = video?.getAttribute('src')
      ?? video?.querySelector('source')?.getAttribute('src')

    expect(video).not.toBeNull()
    expect(video?.muted).toBe(true)
    expect(video?.loop).toBe(true)
    expect(videoSource).toBeTruthy()
    expect(workoutSessionApi.startSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('timer')).toBeNull()

    fireEvent.click(closeButton)

    await waitFor(() => {
      expect(container.querySelector('video')).toBeNull()
    })
    expect(screen.getByRole('heading', { name: 'Qual peso voc\u00ea vai usar?' })).toBeTruthy()
    expect(workoutSessionApi.startSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('timer')).toBeNull()
  })

  it('recovers an old empty session without showing an inflated workout timer', async () => {
    const staleSession = sessionWithCompletedSets(
      0,
      new Date(Date.now() - (5 * 60 * 60 * 1000)).toISOString(),
    )
    vi.mocked(workoutSessionApi.getActiveSession).mockResolvedValueOnce(staleSession)

    render(<WorkoutsPanel userId={1} isOpen />)

    expect(await screen.findByText('Seu treino ficou aberto por muito tempo.')).toBeTruthy()
    expect(screen.getByText('Pausado')).toBeTruthy()
    expect(screen.queryByText('05:00:00')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Descartar treino' }))
    expect(screen.getByRole('dialog', { name: 'Descartar este treino?' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Sim, descartar' }))

    await waitFor(() => {
      expect(workoutSessionApi.discardSession).toHaveBeenCalledWith(staleSession.id)
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Seus treinos com halteres' })).toBeTruthy()
    })
  })

  it('downloads a PNG with the selected workout history', async () => {
    const completedSession: WorkoutSession = {
      ...sessionWithCompletedSets(1, '2026-07-29T10:00:00-03:00'),
      status: 'completed',
      completed_at: '2026-07-29T10:30:00-03:00',
      duration_seconds: 1_800,
    }
    vi.mocked(workoutSessionApi.getHistory).mockResolvedValueOnce({
      total_sessions: 1,
      total_minutes: 30,
      completed_sets: 1,
      total_volume_kg: '85.00',
      sessions: [completedSession],
      exercise_progress: [],
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<WorkoutsPanel userId={1} isOpen />)

    fireEvent.click(await screen.findByRole('button', { name: 'Baixar resumo em PNG' }))

    await waitFor(() => expect(toPng).toHaveBeenCalledOnce())
    expect(click).toHaveBeenCalledOnce()
    expect(screen.getByRole('status').textContent).toContain('Imagem do progresso baixada')
    click.mockRestore()
  })
})
