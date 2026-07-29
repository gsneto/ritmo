import { render, screen, waitFor } from '@testing-library/react'
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
          { id: 1, name: 'Beber água', time: '08:00', done: false },
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
  })

  it('prioritizes an active workout and unifies the other parts of the day', async () => {
    render(<Today userId={1} />)

    expect(await screen.findByText('Continue Pernas com halteres')).toBeTruthy()
    expect(screen.getByText('2 de 4 séries concluídas.')).toBeTruthy()
    expect(screen.getByText('Compra mensal ·', { exact: false })).toBeTruthy()
    expect(screen.getByText('A queda do céu · 20%')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /Retomar treino/ }).getAttribute('href'),
    ).toBe('/habits?workout=1')
  })

  it('keeps core habits visible if an optional assistant source fails', async () => {
    vi.mocked(readingApi.getActiveBook).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(workoutSessionApi.getActiveSession).mockResolvedValueOnce(null)

    render(<Today userId={1} />)

    expect(await screen.findAllByText('Beber água')).not.toHaveLength(0)
    await waitFor(() => {
      expect(screen.getByText('Escolha seu próximo livro')).toBeTruthy()
    })
  })
})
