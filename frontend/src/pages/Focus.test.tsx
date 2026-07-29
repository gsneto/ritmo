import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterProvider } from '../router'
import { apiRoutes } from '../services/api'
import {
  readingApi,
  type ReadingBook,
  type ReadingNote,
  type ReadingSession,
  type ReadingSummary,
} from '../services/readingApi'
import Focus from './Focus'

vi.mock('../services/api', () => ({
  apiRoutes: {
    getHabits: vi.fn(),
    checkinHabit: vi.fn(),
  },
}))

vi.mock('../services/readingApi', () => ({
  readingApi: {
    getBooks: vi.fn(),
    createBook: vi.fn(),
    updateBook: vi.fn(),
    activateBook: vi.fn(),
    deleteBook: vi.fn(),
    getSessions: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    getNotes: vi.fn(),
    createNote: vi.fn(),
    deleteNote: vi.fn(),
    getSummary: vi.fn(),
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
  status: 'lendo',
  is_active: true,
  progress_percent: 25,
  completed_at: null,
  created_at: '2026-07-29T12:00:00-03:00',
  updated_at: '2026-07-29T12:00:00-03:00',
}

const wishlistBook: ReadingBook = {
  ...activeBook,
  id: 5,
  title: 'A queda do céu',
  current_page: 0,
  total_pages: 736,
  notes: '',
  status: 'quero_ler',
  is_active: false,
  progress_percent: 0,
}

const readingSession: ReadingSession = {
  id: 11,
  book_id: activeBook.id,
  book_title: activeBook.title,
  session_date: '2026-07-29',
  start_page: 60,
  end_page: 80,
  pages_read: 20,
  duration_minutes: 30,
  source: 'manual',
  created_at: '2026-07-29T12:00:00-03:00',
}

const readingNote: ReadingNote = {
  id: 19,
  book_id: activeBook.id,
  note_date: '2026-07-29',
  page: 72,
  content: 'Preparar o ambiente facilita começar.',
  created_at: '2026-07-29T12:00:00-03:00',
  updated_at: '2026-07-29T12:00:00-03:00',
}

const summary: ReadingSummary = {
  pages_this_week: 20,
  duration_this_week: 30,
  total_sessions: 1,
  recent_sessions: [readingSession],
  weeks: [
    {
      week_start: '2026-07-06',
      week_end: '2026-07-12',
      pages_read: 0,
      duration_minutes: 0,
      session_count: 0,
    },
    {
      week_start: '2026-07-13',
      week_end: '2026-07-19',
      pages_read: 12,
      duration_minutes: 20,
      session_count: 1,
    },
    {
      week_start: '2026-07-20',
      week_end: '2026-07-26',
      pages_read: 34,
      duration_minutes: 45,
      session_count: 2,
    },
    {
      week_start: '2026-07-27',
      week_end: '2026-08-02',
      pages_read: 20,
      duration_minutes: 30,
      session_count: 1,
    },
  ],
}

async function renderFocus(options?: {
  books?: ReadingBook[]
  habits?: typeof readingHabit[]
  notes?: ReadingNote[]
  sessions?: ReadingSession[]
}) {
  const books = options?.books ?? [activeBook, wishlistBook]
  vi.mocked(apiRoutes.getHabits).mockResolvedValue({
    data: options?.habits ?? [readingHabit],
  } as never)
  vi.mocked(apiRoutes.checkinHabit).mockResolvedValue({
    data: readingHabit,
  } as never)
  vi.mocked(readingApi.getBooks).mockResolvedValue({ data: books } as never)
  vi.mocked(readingApi.getSessions).mockResolvedValue({
    data: options?.sessions ?? [readingSession],
  } as never)
  vi.mocked(readingApi.getSummary).mockResolvedValue({ data: summary } as never)
  vi.mocked(readingApi.getNotes).mockResolvedValue({
    data: options?.notes ?? [readingNote],
  } as never)
  vi.mocked(readingApi.updateBook).mockImplementation(async (_bookId, data) => ({
    data: {
      ...activeBook,
      ...data,
      progress_percent: (
        (data.current_page ?? activeBook.current_page)
        / (data.total_pages ?? activeBook.total_pages)
      ) * 100,
    },
  } as never))
  vi.mocked(readingApi.createBook).mockImplementation(async (_userId, data) => ({
    data: {
      ...activeBook,
      ...data,
      id: 21,
      progress_percent: (data.current_page / data.total_pages) * 100,
    },
  } as never))
  vi.mocked(readingApi.activateBook).mockResolvedValue({
    data: { ...wishlistBook, status: 'lendo', is_active: true },
  } as never)
  vi.mocked(readingApi.createSession).mockResolvedValue({
    data: readingSession,
  } as never)
  vi.mocked(readingApi.createNote).mockResolvedValue({
    data: readingNote,
  } as never)
  vi.mocked(readingApi.deleteBook).mockResolvedValue({ data: {} } as never)
  vi.mocked(readingApi.deleteNote).mockResolvedValue({ data: {} } as never)

  render(
    <RouterProvider>
      <Focus userId={1} />
    </RouterProvider>,
  )

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('Focus timer, library and reading journal', () => {
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

  it('saves a completed reading focus in the journal and checks the habit', async () => {
    await renderFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar foco' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000)
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(screen.getByRole('timer').textContent).toBe('05:00')
    expect(screen.getByText('Pausa')).toBeTruthy()
    expect(apiRoutes.checkinHabit).toHaveBeenCalledWith(7, '2026-07-29')
    expect(readingApi.createSession).toHaveBeenCalledWith(4, {
      session_date: '2026-07-29',
      start_page: 80,
      end_page: 80,
      duration_minutes: 25,
      source: 'focus',
    })
  })

  it('shows the library, weekly result and page-linked note', async () => {
    await renderFocus()

    expect(screen.getByText('20 páginas')).toBeTruthy()
    expect(screen.getByText('30 min')).toBeTruthy()
    expect(screen.getByText('2 livros')).toBeTruthy()
    expect(screen.getAllByText('Hábitos Atômicos').length).toBeGreaterThan(0)
    expect(screen.getByText('A queda do céu')).toBeTruthy()
    expect(screen.getByText('Preparar o ambiente facilita começar.')).toBeTruthy()
    expect(screen.getByText(/página 72/i)).toBeTruthy()
  })

  it('updates book progress and preserves its original notes', async () => {
    await renderFocus()

    fireEvent.change(screen.getByLabelText('Página atual'), {
      target: { value: '160' },
    })
    fireEvent.change(screen.getByLabelText('Anotações anteriores deste livro'), {
      target: { value: 'Revisar o capítulo sobre ambiente.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar leitura' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(readingApi.updateBook).toHaveBeenCalledWith(4, {
      title: 'Hábitos Atômicos',
      current_page: 160,
      total_pages: 320,
      notes: 'Revisar o capítulo sobre ambiente.',
      status: 'lendo',
      is_active: true,
    })
  })

  it('adds a future title and can make it active', async () => {
    await renderFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar livro' }))
    fireEvent.change(screen.getByLabelText('Livro que estou lendo'), {
      target: { value: 'O amanhã não está à venda' },
    })
    fireEvent.change(screen.getByLabelText('Total de páginas'), {
      target: { value: '96' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar à biblioteca' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(readingApi.createBook).toHaveBeenCalledWith(1, {
      title: 'O amanhã não está à venda',
      current_page: 0,
      total_pages: 96,
      notes: '',
      status: 'quero_ler',
      is_active: false,
    })

    const wishlistCard = screen.getByText('A queda do céu')
      .closest('.reading-library-card')
    expect(wishlistCard).toBeTruthy()
    fireEvent.click(
      within(wishlistCard as HTMLElement).getByRole('button', {
        name: 'Tornar ativo',
      }),
    )
    expect(readingApi.activateBook).toHaveBeenCalledWith(5)
  })

  it('registers pages, duration and a dated note for the selected book', async () => {
    await renderFocus()

    fireEvent.change(screen.getByLabelText('Página inicial'), {
      target: { value: '80' },
    })
    fireEvent.change(screen.getByLabelText('Página final'), {
      target: { value: '95' },
    })
    fireEvent.change(screen.getByLabelText('Minutos'), {
      target: { value: '35' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar sessão' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(readingApi.createSession).toHaveBeenCalledWith(4, {
      session_date: '2026-07-29',
      start_page: 80,
      end_page: 95,
      duration_minutes: 35,
      source: 'manual',
    })

    fireEvent.change(screen.getByLabelText('Anotação com página e data'), {
      target: { value: 'Lembrar desta ideia.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar anotação' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(readingApi.createNote).toHaveBeenCalledWith(4, {
      note_date: '2026-07-29',
      page: 80,
      content: 'Lembrar desta ideia.',
    })
  })

  it('keeps focus disabled only when there is no active book or reading habit', async () => {
    await renderFocus({ books: [], habits: [], notes: [], sessions: [] })

    expect(screen.getByText('Comece sua biblioteca')).toBeTruthy()
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
    expect(readingApi.updateBook).not.toHaveBeenCalled()
  })
})
