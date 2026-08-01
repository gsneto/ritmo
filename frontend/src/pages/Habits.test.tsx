import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRoutes } from '../services/api'
import { toLocalDateValue } from '../utils/date'
import Habits from './Habits'

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('../services/api', () => ({
  apiRoutes: {
    getHabits: vi.fn(),
    createHabit: vi.fn(),
    updateHabit: vi.fn(),
    deleteHabit: vi.fn(),
    checkinHabit: vi.fn(),
    removeCheckin: vi.fn(),
  },
}))

vi.mock('../router', () => ({
  useAppRouter: () => ({ navigate: navigateMock }),
}))

function habit(
  id: number,
  name: string,
  time: string,
  checkIns: string[] = [],
) {
  return {
    id,
    user_id: 1,
    name,
    time,
    active_days: [0, 1, 2, 3, 4, 5, 6],
    created_at: '2026-07-29T09:00:00',
    check_ins: checkIns,
  }
}

function recentCheckIns(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - index)
    return toLocalDateValue(date)
  })
}

describe('Habits upgraded experience', () => {
  const today = toLocalDateValue()
  const habits = [
    habit(1, 'Beber água', '08:00', [today]),
    habit(2, 'Treino em casa', '18:30'),
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiRoutes.getHabits).mockResolvedValue({ data: habits } as never)
    vi.mocked(apiRoutes.createHabit).mockResolvedValue({ data: habits[0] } as never)
    vi.mocked(apiRoutes.checkinHabit).mockResolvedValue({ data: habits[1] } as never)
  })

  it('shows today progress and the next unfinished habit', async () => {
    render(<Habits userId={1} />)

    expect(await screen.findByText('1 de 2')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50')
    expect(screen.getByText('Próximo hábito')).toBeTruthy()
    expect(screen.getAllByText('Treino em casa').length).toBeGreaterThan(0)
    const workoutTime = screen.getByText('18:30', { selector: 'time' })
    expect(workoutTime.getAttribute('datetime')).toBe('18:30')
    expect(workoutTime.closest('.routine-habit-schedule')).toBeTruthy()
  })

  it('places the new habit form directly below the progress hero', async () => {
    const { container } = render(<Habits userId={1} />)

    await screen.findByText('Hábitos de hoje')
    const createPanel = container.querySelector('.routine-create-panel')

    expect(createPanel).toBeTruthy()
    expect(createPanel?.previousElementSibling?.classList.contains('routine-habit-hero')).toBe(true)
  })

  it('creates a habit with its selected weekdays', async () => {
    render(<Habits userId={1} />)

    await screen.findByText('Hábitos de hoje')
    fireEvent.change(screen.getByLabelText('Nome do hábito'), {
      target: { value: 'Alongar' },
    })
    fireEvent.change(screen.getByLabelText('Horário'), {
      target: { value: '07:15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Dom' }))
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar hábito' }))

    await waitFor(() => {
      expect(apiRoutes.createHabit).toHaveBeenCalledWith(1, {
        name: 'Alongar',
        time: '07:15',
        active_days: [0, 1, 2, 3, 4, 5],
      })
    })
  })

  it('opens the separate workout area from a workout habit', async () => {
    render(<Habits userId={1} />)

    await screen.findByText('Hábitos de hoje')
    fireEvent.click(screen.getByRole('button', { name: 'Treino' }))

    expect(navigateMock).toHaveBeenCalledWith('/workouts?habit=2')
  })

  it('opens Leitura with the selected reading habit', async () => {
    vi.mocked(apiRoutes.getHabits).mockResolvedValueOnce({
      data: [habit(3, 'Leitura', '20:00')],
    } as never)
    render(<Habits userId={1} />)

    await screen.findByText('Hábitos de hoje')
    fireEvent.click(screen.getByRole('button', { name: 'Leitura' }))

    expect(navigateMock).toHaveBeenCalledWith('/reading?habit=3')
  })

  it('keeps a clear recovery action when loading fails', async () => {
    vi.mocked(apiRoutes.getHabits).mockRejectedValueOnce(new Error('offline'))
    render(<Habits userId={1} />)

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Não foi possível carregar seus hábitos. Tente novamente.')).toBeTruthy()
  })

  it('shows the streak milestone reached by a habit', async () => {
    vi.mocked(apiRoutes.getHabits).mockResolvedValueOnce({
      data: [habit(4, 'Meditar', '07:00', recentCheckIns(7))],
    } as never)

    render(<Habits userId={1} />)

    expect(await screen.findByText('7 dias')).toBeTruthy()
    expect(screen.getByLabelText('Marco de 7 dias: Em ritmo')).toBeTruthy()
  })

  it('focuses the next check-in requested by a PWA shortcut', async () => {
    render(<Habits userId={1} quickCheckInRequested />)

    const nextControl = await screen.findByRole('button', {
      name: 'Marcar Treino em casa hoje',
    })
    await waitFor(() => expect(document.activeElement).toBe(nextControl))
    expect(navigateMock).toHaveBeenCalledWith('/habits', { replace: true })
  })
})
