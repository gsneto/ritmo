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

vi.mock('../components/WorkoutsPanel', () => ({
  default: ({
    isOpen,
    onSessionFinished,
  }: {
    isOpen: boolean
    onSessionFinished?: () => void | Promise<void>
  }) => isOpen
    ? (
        <button type="button" onClick={() => void onSessionFinished?.()}>
          Finalizar treino de teste
        </button>
      )
    : null,
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
    created_at: '2026-07-29T09:00:00',
    check_ins: checkIns,
  }
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
  })

  it('creates a habit with only name and time', async () => {
    render(<Habits userId={1} />)

    await screen.findByText('Hábitos de hoje')
    fireEvent.change(screen.getByLabelText('Nome do hábito'), {
      target: { value: 'Alongar' },
    })
    fireEvent.change(screen.getByLabelText('Horário'), {
      target: { value: '07:15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar hábito' }))

    await waitFor(() => {
      expect(apiRoutes.createHabit).toHaveBeenCalledWith(1, {
        name: 'Alongar',
        time: '07:15',
      })
    })
  })

  it('marks the workout habit after a finished session', async () => {
    render(<Habits userId={1} />)

    await screen.findByText('Hábitos de hoje')
    fireEvent.click(screen.getByRole('button', { name: 'Treino' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar treino de teste' }))

    await waitFor(() => {
      expect(apiRoutes.checkinHabit).toHaveBeenCalledWith(2, today)
    })
  })

  it('keeps a clear recovery action when loading fails', async () => {
    vi.mocked(apiRoutes.getHabits).mockRejectedValueOnce(new Error('offline'))
    render(<Habits userId={1} />)

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Não foi possível carregar seus hábitos. Tente novamente.')).toBeTruthy()
  })
})
