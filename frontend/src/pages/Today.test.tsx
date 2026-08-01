import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRoutes } from '../services/api'
import { readingApi } from '../services/readingApi'
import { workoutSessionApi } from '../services/workoutSessionApi'
import { toLocalDateValue } from '../utils/date'
import Today from './Today'

vi.mock('../services/api', () => ({
  apiRoutes: {
    getTodayStats: vi.fn(),
    getMonthStats: vi.fn(),
    getStreak: vi.fn(),
    getTasks: vi.fn(),
    getShoppingLists: vi.fn(),
    removeCheckin: vi.fn(),
    checkinHabit: vi.fn(),
    completeTask: vi.fn(),
    updateTask: vi.fn(),
  },
}))

vi.mock('../services/readingApi', () => ({
  readingApi: {
    getActiveBook: vi.fn(),
  },
}))

vi.mock('../services/workoutSessionApi', () => ({
  workoutSessionApi: {
    getWorkouts: vi.fn(),
    getActiveSession: vi.fn(),
    getHistory: vi.fn(),
  },
}))

vi.mock('../hooks/useNotifications', () => ({
  notify: { checkin: vi.fn() },
}))

vi.mock('../router', () => ({
  AppLink: ({
    to,
    children,
    className,
  }: {
    to: string
    children: ReactNode
    className?: string
  }) => <a href={to} className={className}>{children}</a>,
}))

describe('Today intelligent assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiRoutes.getTodayStats).mockResolvedValue({
      data: {
        today_progress: '0%',
        checked_count: '0 de 1 feitos',
        habits_today: [
          { id: 1, name: 'Beber água', time: '00:00', done: false },
        ],
      },
    } as never)
    vi.mocked(apiRoutes.getMonthStats).mockResolvedValue({
      data: { months: [{ month: 'Jul', score: 72 }] },
    } as never)
    vi.mocked(apiRoutes.getStreak).mockResolvedValue({
      data: { streak: 4 },
    } as never)
    vi.mocked(apiRoutes.getTasks).mockResolvedValue({
      data: [{
        id: 2,
        user_id: 1,
        name: 'Pagar conta',
        date: toLocalDateValue(),
        time: '23:59',
        completed_at: null,
        recurrence: 'none',
        recurrence_interval: 1,
        recurrence_parent_id: null,
        created_at: toLocalDateValue(),
      }],
    } as never)
    vi.mocked(apiRoutes.getShoppingLists).mockResolvedValue({
      data: [{
        id: 3,
        user_id: 1,
        name: 'Compra mensal',
        kind: 'monthly',
        category: 'groceries',
        planned_date: toLocalDateValue(),
        budget_cents: 100_000,
        repeat_enabled: true,
        next_list_id: null,
        completed_on: null,
        completed_at: null,
        total_cents: 0,
        created_at: new Date().toISOString(),
        items: [],
      }],
    } as never)
    vi.mocked(readingApi.getActiveBook).mockResolvedValue({
      data: {
        id: 4,
        user_id: 1,
        title: 'A queda do céu',
        current_page: 120,
        total_pages: 600,
        notes: '',
        status: 'lendo',
        is_active: true,
        progress_percent: 20,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    } as never)
    vi.mocked(workoutSessionApi.getWorkouts).mockResolvedValue([])
    vi.mocked(workoutSessionApi.getActiveSession).mockResolvedValue({
      id: 5,
      user_id: 1,
      workout_id: 1,
      workout_title: 'Pernas com halteres',
      workout_day: 'Ter',
      status: 'active',
      rest_seconds: 60,
      started_at: new Date().toISOString(),
      completed_at: null,
      duration_seconds: null,
      total_sets: 4,
      completed_sets: 2,
      max_weight_kg: '10.00',
      total_volume_kg: '200.00',
      exercises: [],
    })
    vi.mocked(workoutSessionApi.getHistory).mockResolvedValue({
      total_sessions: 0,
      total_minutes: 0,
      completed_sets: 0,
      total_volume_kg: '0.00',
      sessions: [],
      exercise_progress: [],
    })
  })

  it('prioritizes an active workout and unifies the other parts of the day', async () => {
    render(<Today userId={1} />)

    expect(await screen.findByText('Continue Pernas com halteres')).toBeTruthy()
    expect(screen.getByText('2 de 4 séries concluídas.')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Trilha viva do seu dia' })).toBeTruthy()
    expect(screen.getAllByText('Pagar conta')).not.toHaveLength(0)
    expect(
      screen.getByRole('link', { name: /Retomar treino/ }).getAttribute('href'),
    ).toBe('/workouts')
  })

  it('keeps core habits visible if an optional assistant source fails', async () => {
    vi.mocked(readingApi.getActiveBook).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(workoutSessionApi.getActiveSession).mockResolvedValueOnce(null)

    render(<Today userId={1} />)

    expect(await screen.findAllByText('Beber água')).not.toHaveLength(0)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Marcar agora/ })).toBeTruthy()
    })
  })

  it('marks the due habit directly from the live trail', async () => {
    vi.mocked(workoutSessionApi.getActiveSession).mockResolvedValueOnce(null)
    vi.mocked(apiRoutes.checkinHabit).mockResolvedValue({} as never)

    render(<Today userId={1} />)

    fireEvent.click(await screen.findByRole('button', { name: /Marcar agora/ }))

    await waitFor(() => {
      expect(apiRoutes.checkinHabit).toHaveBeenCalledWith(1, toLocalDateValue())
    })
  })

  it('lets an overdue task move to tomorrow without opening the tasks page', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    vi.mocked(workoutSessionApi.getActiveSession).mockResolvedValueOnce(null)
    vi.mocked(apiRoutes.getTodayStats).mockResolvedValueOnce({
      data: {
        today_progress: '100%',
        checked_count: '1 de 1 feitos',
        habits_today: [
          { id: 1, name: 'Beber água', time: '08:00', done: true },
        ],
      },
    } as never)
    vi.mocked(apiRoutes.getTasks).mockResolvedValueOnce({
      data: [{
        id: 2,
        user_id: 1,
        name: 'Pagar conta atrasada',
        date: toLocalDateValue(yesterday),
        time: '10:00',
        completed_at: null,
        recurrence: 'none',
        recurrence_interval: 1,
        recurrence_parent_id: null,
        created_at: yesterday.toISOString(),
      }],
    } as never)
    vi.mocked(apiRoutes.updateTask).mockResolvedValue({} as never)

    render(<Today userId={1} />)

    expect(await screen.findByText('Pagar conta atrasada')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Adiar para amanhã/ }))

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    await waitFor(() => {
      expect(apiRoutes.updateTask).toHaveBeenCalledWith(2, {
        date: toLocalDateValue(tomorrow),
      })
    })
  })

  it('places the habit check-in directly below the rhythm hero', async () => {
    render(<Today userId={1} />)

    await screen.findAllByText('Beber água')
    const checkInSection = screen.getByRole('region', {
      name: 'Check-in de hábitos',
    })

    expect(checkInSection.previousElementSibling?.classList.contains('today-hero')).toBe(true)
    expect(checkInSection.nextElementSibling?.classList.contains('today-assistant')).toBe(true)
  })

  it('does not ask for another workout after one was completed today', async () => {
    const workoutDay = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][new Date().getDay()]
    const completedAt = new Date().toISOString()
    vi.mocked(apiRoutes.getTodayStats).mockResolvedValueOnce({
      data: {
        today_progress: '0%',
        checked_count: '0 de 0 feitos',
        habits_today: [],
      },
    } as never)
    vi.mocked(apiRoutes.getTasks).mockResolvedValueOnce({ data: [] } as never)
    vi.mocked(apiRoutes.getShoppingLists).mockResolvedValueOnce({ data: [] } as never)
    vi.mocked(readingApi.getActiveBook).mockResolvedValueOnce({ data: null } as never)
    vi.mocked(workoutSessionApi.getActiveSession).mockResolvedValueOnce(null)
    vi.mocked(workoutSessionApi.getWorkouts).mockResolvedValueOnce([{
      id: 9,
      user_id: 1,
      day: workoutDay,
      title: 'Treino em casa',
      note: '',
      exercises: [{ id: 1, name: 'Agachamento', sets: '3', reps: '12' }],
    }])
    vi.mocked(workoutSessionApi.getHistory).mockResolvedValueOnce({
      total_sessions: 1,
      total_minutes: 25,
      completed_sets: 3,
      total_volume_kg: '180.00',
      sessions: [{
        id: 44,
        user_id: 1,
        workout_id: 9,
        workout_title: 'Treino em casa',
        workout_day: workoutDay,
        status: 'completed',
        rest_seconds: 60,
        started_at: new Date(Date.now() - 25 * 60_000).toISOString(),
        completed_at: completedAt,
        duration_seconds: 1_500,
        total_sets: 3,
        completed_sets: 3,
        max_weight_kg: '8.00',
        total_volume_kg: '180.00',
        exercises: [],
      }],
      exercise_progress: [],
    })

    render(<Today userId={1} />)

    expect(await screen.findByText('Voc\u00ea est\u00e1 em dia')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Iniciar treino/ })).toBeNull()
  })
})
