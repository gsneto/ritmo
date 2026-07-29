import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterProvider } from '../router'
import { apiRoutes } from '../services/api'
import Focus from './Focus'

vi.mock('../services/api', () => ({
  apiRoutes: {
    getHabits: vi.fn(),
    checkinHabit: vi.fn(),
  },
}))

vi.mock('../hooks/useNotifications', () => ({
  notify: {
    checkin: vi.fn(),
    pomodoroComplete: vi.fn(),
  },
}))

const readingHabit = {
  id: 7,
  user_id: 1,
  name: 'Leitura',
  time: '09:00',
  created_at: '2026-07-29',
  check_ins: [],
}

async function renderFocus() {
  vi.mocked(apiRoutes.getHabits).mockResolvedValue({
    data: [readingHabit],
  } as never)
  vi.mocked(apiRoutes.checkinHabit).mockResolvedValue({
    data: readingHabit,
  } as never)

  render(
    <RouterProvider>
      <Focus userId={1} />
    </RouterProvider>,
  )

  await act(async () => {
    await Promise.resolve()
  })
}

describe('Focus timer', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/focus')
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('labels a paused timer as a continuation', async () => {
    await renderFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar foco' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }))

    expect(screen.getByRole('button', { name: 'Continuar foco' })).toBeTruthy()
  })

  it('moves to a full break after focus completes', async () => {
    await renderFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar foco' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000)
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(screen.getByRole('timer').textContent).toBe('05:00')
    expect(screen.getByText('Pausa')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Iniciar pausa' })).toBeTruthy()
    expect(apiRoutes.checkinHabit).toHaveBeenCalledWith(7, '2026-07-29')
  })
})
