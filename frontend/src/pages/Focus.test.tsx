import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterProvider } from '../router'
import { apiRoutes } from '../services/api'
import { readingApi, type ReadingBook } from '../services/readingApi'
import Focus from './Focus'

vi.mock('../services/api', () => ({
  apiRoutes: {
    getHabits: vi.fn(),
    checkinHabit: vi.fn(),
  },
}))

vi.mock('../services/readingApi', () => ({
  readingApi: {
    getActiveBook: vi.fn(),
    saveActiveBook: vi.fn(),
    deleteActiveBook: vi.fn(),
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

const activeBook: ReadingBook = {
  id: 4,
  user_id: 1,
  title: 'Hábitos Atômicos',
  current_page: 80,
  total_pages: 320,
  notes: 'Tornar o hábito óbvio.',
  progress_percent: 25,
  created_at: '2026-07-29T12:00:00-03:00',
  updated_at: '2026-07-29T12:00:00-03:00',
}

async function renderFocus(options?: {
  book?: ReadingBook | null
  habits?: typeof readingHabit[]
}) {
  vi.mocked(apiRoutes.getHabits).mockResolvedValue({
    data: options?.habits ?? [readingHabit],
  } as never)
  vi.mocked(apiRoutes.checkinHabit).mockResolvedValue({
    data: readingHabit,
  } as never)
  vi.mocked(readingApi.getActiveBook).mockResolvedValue({
    data: options?.book === undefined ? activeBook : options.book,
  } as never)
  vi.mocked(readingApi.saveActiveBook).mockImplementation(async (_userId, data) => ({
    data: {
      ...activeBook,
      ...data,
      progress_percent: (data.current_page / data.total_pages) * 100,
    },
  } as never))
  vi.mocked(readingApi.deleteActiveBook).mockResolvedValue({ data: {} } as never)

  render(
    <RouterProvider>
      <Focus userId={1} />
    </RouterProvider>,
  )

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('Focus timer and reading tracker', () => {
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

  it('shows book progress and saves its page and notes', async () => {
    await renderFocus()

    expect(screen.getByText('25% concluído')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25')

    fireEvent.change(screen.getByLabelText('Página atual'), {
      target: { value: '160' },
    })
    fireEvent.change(screen.getByLabelText('Anotações deste livro'), {
      target: { value: 'Revisar o capítulo sobre ambiente.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar leitura' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(readingApi.saveActiveBook).toHaveBeenCalledWith(1, {
      title: 'Hábitos Atômicos',
      current_page: 160,
      total_pages: 320,
      notes: 'Revisar o capítulo sobre ambiente.',
    })
    expect(screen.getByText('50% concluído')).toBeTruthy()
    expect(screen.getByText('Progresso e anotações salvos.')).toBeTruthy()
  })

  it('keeps the reading tracker available without a reading habit', async () => {
    await renderFocus({ book: null, habits: [] })

    expect(screen.getByText('Acompanhe seu livro atual')).toBeTruthy()
    expect(screen.getByLabelText('Livro que estou lendo')).toBeTruthy()
    expect(screen.getByText('Crie um hábito de leitura')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Iniciar foco' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('blocks a current page greater than the total', async () => {
    await renderFocus()

    fireEvent.change(screen.getByLabelText('Página atual'), {
      target: { value: '400' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar leitura' }))

    expect(
      screen.getByText('A página atual não pode ser maior que o total do livro.'),
    ).toBeTruthy()
    expect(readingApi.saveActiveBook).not.toHaveBeenCalled()
  })
})
