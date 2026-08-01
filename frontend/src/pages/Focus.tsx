import {
  BookOpen,
  Bookmark,
  Calendar,
  ChevronRight,
  Clock,
  Coffee,
  Library,
  Pause,
  PenLine,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react'
import { notify } from '../hooks/useNotifications'
import { useAppSearchParams } from '../router'
import { apiRoutes, type Habit } from '../services/api'
import {
  readingApi,
  type ReadingBook,
  type ReadingBookCreateInput,
  type ReadingNote,
  type ReadingSession,
  type ReadingStatus,
  type ReadingSummary,
} from '../services/readingApi'
import { toLocalDateValue } from '../utils/date'
import '../styles/focus-reading.css'

interface ReadingProps {
  userId: number
}

interface BookForm {
  title: string
  currentPage: string
  totalPages: string
  notes: string
  status: ReadingStatus
  isActive: boolean
}

interface SessionForm {
  date: string
  startPage: string
  endPage: string
  minutes: string
}

interface NoteForm {
  date: string
  page: string
  content: string
}

const EMPTY_SUMMARY: ReadingSummary = {
  pages_this_week: 0,
  duration_this_week: 0,
  total_sessions: 0,
  recent_sessions: [],
  weeks: [],
}

const STATUS_LABELS: Record<ReadingStatus, string> = {
  quero_ler: 'Quero ler',
  lendo: 'Lendo',
  concluido: 'Concluído',
}

function emptyBookForm(): BookForm {
  return {
    title: '',
    currentPage: '0',
    totalPages: '',
    notes: '',
    status: 'quero_ler',
    isActive: false,
  }
}

function formFromBook(book: ReadingBook): BookForm {
  return {
    title: book.title,
    currentPage: String(book.current_page),
    totalPages: String(book.total_pages),
    notes: book.notes,
    status: book.status,
    isActive: book.is_active,
  }
}

function progressFromForm(form: BookForm): number {
  const currentPage = Number(form.currentPage)
  const totalPages = Number(form.totalPages)
  if (
    !Number.isFinite(currentPage)
    || !Number.isFinite(totalPages)
    || totalPages <= 0
  ) {
    return 0
  }
  return Math.min(100, Math.max(0, (currentPage / totalPages) * 100))
}

function formatProgress(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 1,
  }).format(value)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(`${value}T12:00:00`))
}

export default function Reading({ userId }: ReadingProps) {
  const [searchParams, setSearchParams] = useAppSearchParams()
  const [readingHabits, setReadingHabits] = useState<Habit[]>([])
  const [selectedHabitId, setSelectedHabitId] = useState<number | null>(null)
  const [phase, setPhase] = useState<'focus' | 'break'>('focus')
  const [remaining, setRemaining] = useState(25 * 60)
  const [cycles, setCycles] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const intervalRef = useRef<number | null>(null)

  const [books, setBooks] = useState<ReadingBook[]>([])
  const [sessions, setSessions] = useState<ReadingSession[]>([])
  const [notes, setNotes] = useState<ReadingNote[]>([])
  const [summary, setSummary] = useState<ReadingSummary>(EMPTY_SUMMARY)
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null)
  const [bookForm, setBookForm] = useState<BookForm>(emptyBookForm)
  const [sessionForm, setSessionForm] = useState<SessionForm>({
    date: toLocalDateValue(),
    startPage: '0',
    endPage: '0',
    minutes: '25',
  })
  const [noteForm, setNoteForm] = useState<NoteForm>({
    date: toLocalDateValue(),
    page: '0',
    content: '',
  })
  const [libraryFilter, setLibraryFilter] = useState<'todos' | ReadingStatus>('todos')
  const [isAddingBook, setIsAddingBook] = useState(false)
  const [isLoadingReading, setIsLoadingReading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [readingError, setReadingError] = useState('')
  const [readingMessage, setReadingMessage] = useState('')
  const [confirmDeleteBookId, setConfirmDeleteBookId] = useState<number | null>(null)
  const requestedHabitId = Number(searchParams.get('habit')) || null

  const selectedBook = books.find(book => book.id === selectedBookId) || null
  const activeBook = books.find(book => book.is_active) || null
  const selectedHabit = readingHabits.find(habit => habit.id === selectedHabitId)

  useEffect(() => {
    stopTimer()
    setPhase('focus')
    setRemaining(25 * 60)
    setCycles(0)
    setSelectedBookId(null)
    setIsAddingBook(false)
    void loadHabits()
    void refreshReading()
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [userId])

  useEffect(() => {
    if (readingHabits.length === 0) {
      setSelectedHabitId(null)
      return
    }

    setSelectedHabitId(currentId => {
      const requested = readingHabits.find(habit => habit.id === requestedHabitId)
      if (requested) return requested.id
      if (currentId && readingHabits.some(habit => habit.id === currentId)) {
        return currentId
      }
      return readingHabits[0].id
    })
  }, [readingHabits, requestedHabitId])

  useEffect(() => {
    if (isAddingBook || !selectedBook) return
    setBookForm(formFromBook(selectedBook))
    const page = String(selectedBook.current_page)
    setSessionForm(previous => ({
      ...previous,
      startPage: page,
      endPage: page,
    }))
    setNoteForm(previous => ({ ...previous, page }))
    void loadNotes(selectedBook.id)
  }, [selectedBookId, books, isAddingBook])

  async function loadHabits() {
    try {
      const data = await apiRoutes.getHabits(userId)
      const habits: Habit[] = data.data
      setReadingHabits(habits.filter(habit => /leitura|\bler\b/i.test(habit.name)))
    } catch (error) {
      console.error('Failed to load habits:', error)
    }
  }

  async function refreshReading(preferredBookId?: number) {
    setIsLoadingReading(true)
    setReadingError('')
    try {
      const [booksResponse, sessionsResponse, summaryResponse] = await Promise.all([
        readingApi.getBooks(userId),
        readingApi.getSessions(userId),
        readingApi.getSummary(userId),
      ])
      const nextBooks = booksResponse.data
      setBooks(nextBooks)
      setSessions(sessionsResponse.data)
      setSummary(summaryResponse.data)
      setSelectedBookId(currentId => {
        if (
          preferredBookId
          && nextBooks.some(book => book.id === preferredBookId)
        ) {
          return preferredBookId
        }
        if (currentId && nextBooks.some(book => book.id === currentId)) {
          return currentId
        }
        return nextBooks.find(book => book.is_active)?.id
          ?? nextBooks[0]?.id
          ?? null
      })
      if (nextBooks.length === 0) {
        setBookForm(emptyBookForm())
        setNotes([])
      }
    } catch (error) {
      console.error('Failed to load reading library:', error)
      setReadingError('Não foi possível carregar sua biblioteca agora.')
    } finally {
      setIsLoadingReading(false)
    }
  }

  async function loadNotes(bookId: number) {
    try {
      const response = await readingApi.getNotes(bookId)
      setNotes(response.data)
    } catch (error) {
      console.error('Failed to load reading notes:', error)
      setReadingError('Não foi possível carregar as anotações deste livro.')
    }
  }

  function handleHabitChange(id: number) {
    stopTimer()
    setSelectedHabitId(id)
    setSearchParams({ habit: String(id) }, { replace: true })
    setPhase('focus')
    setRemaining(25 * 60)
    setCycles(0)
  }

  function startTimer() {
    if ((!selectedHabitId && !activeBook) || intervalRef.current !== null) return
    setIsRunning(true)
    intervalRef.current = window.setInterval(() => {
      setRemaining(previous => Math.max(0, previous - 1))
    }, 1000)
  }

  function stopTimer() {
    setIsRunning(false)
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  function toggleTimer() {
    if (isRunning) stopTimer()
    else startTimer()
  }

  function resetTimer() {
    stopTimer()
    setPhase('focus')
    setRemaining(25 * 60)
  }

  async function finishPhase() {
    stopTimer()
    notify.pomodoroComplete(phase)

    if (phase === 'focus') {
      const completedCycles = cycles + 1
      setCycles(completedCycles)
      if (selectedHabitId) {
        try {
          await apiRoutes.checkinHabit(selectedHabitId, toLocalDateValue())
          notify.checkin(selectedHabit?.name || 'Leitura')
        } catch (error) {
          console.error('Failed to check-in:', error)
        }
      }
      if (activeBook) {
        try {
          await readingApi.createSession(activeBook.id, {
            session_date: toLocalDateValue(),
            start_page: activeBook.current_page,
            end_page: activeBook.current_page,
            duration_minutes: 25,
            source: 'focus',
          })
          setReadingMessage(`25 minutos registrados no diário de “${activeBook.title}”.`)
          await refreshReading(activeBook.id)
        } catch (error) {
          console.error('Failed to save Pomodoro reading session:', error)
          setReadingError('O Pomodoro terminou, mas não foi possível salvar a sessão no diário.')
        }
      }
      setPhase('break')
      setRemaining(completedCycles % 4 === 0 ? 15 * 60 : 5 * 60)
    } else {
      setPhase('focus')
      setRemaining(25 * 60)
    }
  }

  useEffect(() => {
    if (isRunning && remaining === 0) {
      void finishPhase()
    }
  }, [isRunning, remaining])

  function buildBookInput(): ReadingBookCreateInput | null {
    const title = bookForm.title.trim()
    const currentPage = Number(bookForm.currentPage)
    const totalPages = Number(bookForm.totalPages)
    const notesValue = bookForm.notes.trim()

    if (!title) {
      setReadingError('Digite o título do livro.')
      return null
    }
    if (
      !Number.isInteger(currentPage)
      || currentPage < 0
      || currentPage > 100_000
      || !Number.isInteger(totalPages)
      || totalPages < 1
      || totalPages > 100_000
    ) {
      setReadingError('Use páginas inteiras entre 0 e 100.000.')
      return null
    }
    if (currentPage > totalPages) {
      setReadingError('A página atual não pode ser maior que o total do livro.')
      return null
    }
    if (notesValue.length > 10_000) {
      setReadingError('As anotações podem ter no máximo 10.000 caracteres.')
      return null
    }

    return {
      title,
      current_page: bookForm.status === 'concluido' ? totalPages : currentPage,
      total_pages: totalPages,
      notes: notesValue,
      status: bookForm.status,
      is_active: bookForm.status !== 'concluido' && bookForm.isActive,
    }
  }

  async function saveBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = buildBookInput()
    if (!input) return
    setIsSaving(true)
    setReadingError('')
    setReadingMessage('')
    try {
      const response = isAddingBook || !selectedBook
        ? await readingApi.createBook(userId, input)
        : await readingApi.updateBook(selectedBook.id, input)
      setIsAddingBook(false)
      setSelectedBookId(response.data.id)
      setReadingMessage(
        response.data.progress_percent >= 100
          ? 'Livro concluído e guardado no histórico.'
          : 'Livro e progresso salvos.',
      )
      await refreshReading(response.data.id)
    } catch (error) {
      console.error('Failed to save reading book:', error)
      setReadingError('Não foi possível salvar o livro. Tente novamente.')
    } finally {
      setIsSaving(false)
    }
  }

  async function advanceOnePage() {
    if (!selectedBook) return
    const input = buildBookInput()
    if (!input) return
    const nextPage = Math.min(input.current_page + 1, input.total_pages)
    setIsSaving(true)
    setReadingError('')
    try {
      const response = await readingApi.updateBook(selectedBook.id, {
        ...input,
        current_page: nextPage,
      })
      setReadingMessage('Uma página adicionada ao seu progresso.')
      await refreshReading(response.data.id)
    } catch (error) {
      console.error('Failed to advance reading page:', error)
      setReadingError('Não foi possível avançar a página.')
    } finally {
      setIsSaving(false)
    }
  }

  async function activateBook(book: ReadingBook) {
    setIsSaving(true)
    setReadingError('')
    setReadingMessage('')
    try {
      await readingApi.activateBook(book.id)
      setReadingMessage(`“${book.title}” agora é seu livro ativo.`)
      await refreshReading(book.id)
    } catch (error) {
      console.error('Failed to activate reading book:', error)
      setReadingError('Não foi possível selecionar esse livro.')
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteBook(bookId: number) {
    setIsSaving(true)
    setReadingError('')
    try {
      await readingApi.deleteBook(bookId)
      setConfirmDeleteBookId(null)
      setReadingMessage('Livro removido da biblioteca.')
      await refreshReading()
    } catch (error) {
      console.error('Failed to delete reading book:', error)
      setReadingError('Não foi possível remover o livro.')
    } finally {
      setIsSaving(false)
    }
  }

  async function saveSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedBook) return
    const startPage = Number(sessionForm.startPage)
    const endPage = Number(sessionForm.endPage)
    const durationMinutes = Number(sessionForm.minutes)
    if (
      !Number.isInteger(startPage)
      || !Number.isInteger(endPage)
      || startPage < 0
      || endPage < startPage
      || endPage > selectedBook.total_pages
      || !Number.isInteger(durationMinutes)
      || durationMinutes < 1
      || durationMinutes > 1_440
    ) {
      setReadingError('Confira as páginas e a duração da sessão.')
      return
    }
    setIsSaving(true)
    setReadingError('')
    setReadingMessage('')
    try {
      await readingApi.createSession(selectedBook.id, {
        session_date: sessionForm.date,
        start_page: startPage,
        end_page: endPage,
        duration_minutes: durationMinutes,
        source: 'manual',
      })
      setReadingMessage(
        `${endPage - startPage} páginas e ${durationMinutes} minutos registrados.`,
      )
      await refreshReading(selectedBook.id)
    } catch (error) {
      console.error('Failed to save reading session:', error)
      setReadingError('Não foi possível registrar essa sessão.')
    } finally {
      setIsSaving(false)
    }
  }

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedBook) return
    const page = Number(noteForm.page)
    const content = noteForm.content.trim()
    if (
      !Number.isInteger(page)
      || page < 0
      || page > selectedBook.total_pages
      || !content
    ) {
      setReadingError('Informe a página e escreva sua anotação.')
      return
    }
    setIsSaving(true)
    setReadingError('')
    setReadingMessage('')
    try {
      await readingApi.createNote(selectedBook.id, {
        note_date: noteForm.date,
        page,
        content,
      })
      setNoteForm(previous => ({ ...previous, content: '' }))
      setReadingMessage('Anotação guardada com página e data.')
      await loadNotes(selectedBook.id)
    } catch (error) {
      console.error('Failed to save reading note:', error)
      setReadingError('Não foi possível salvar a anotação.')
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteNote(noteId: number) {
    if (!selectedBook) return
    setIsSaving(true)
    try {
      await readingApi.deleteNote(noteId)
      await loadNotes(selectedBook.id)
      setReadingMessage('Anotação removida.')
    } catch (error) {
      console.error('Failed to delete reading note:', error)
      setReadingError('Não foi possível remover a anotação.')
    } finally {
      setIsSaving(false)
    }
  }

  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0')
  const seconds = String(remaining % 60).padStart(2, '0')
  const completedCyclesForBreak = cycles > 0 ? cycles : 1
  const phaseDuration = phase === 'focus'
    ? 25 * 60
    : (completedCyclesForBreak % 4 === 0 ? 15 : 5) * 60
  const timerProgress = ((phaseDuration - remaining) / phaseDuration) * 100
  const timerActionLabel = isRunning
    ? 'Pausar'
    : remaining < phaseDuration
      ? `Continuar ${phase === 'focus' ? 'Pomodoro' : 'pausa'}`
      : `Iniciar ${phase === 'focus' ? 'Pomodoro' : 'pausa'}`
  const timerStyle = {
    '--focus-timer-progress': `${timerProgress}%`,
  } as CSSProperties
  const readingProgress = progressFromForm(bookForm)
  const filteredBooks = books.filter(
    book => libraryFilter === 'todos' || book.status === libraryFilter,
  )
  const selectedSessions = selectedBook
    ? sessions.filter(session => session.book_id === selectedBook.id)
    : sessions
  const chartMaximum = Math.max(
    1,
    ...summary.weeks.map(week => week.pages_read),
  )

  return (
    <div className="view focus-reading-view" data-view="reading">
      <section className={`focus-hero ${phase === 'break' ? 'is-break' : ''}`}>
        <div className="focus-hero-copy">
          <span className="focus-kicker">
            <Sparkles aria-hidden="true" /> Pomodoro de leitura
          </span>
          <h2>Leia com presença. Guarde cada avanço.</h2>
          <p>
            O Pomodoro registra os 25 minutos no diário do livro ativo.
            Ao terminar, você acrescenta as páginas lidas e suas ideias.
          </p>

          {activeBook && (
            <div className="focus-active-reading">
              <BookOpen aria-hidden="true" />
              <div>
                <small>Livro desta sessão</small>
                <strong>{activeBook.title}</strong>
              </div>
              <span>{formatProgress(activeBook.progress_percent)}%</span>
            </div>
          )}

          {readingHabits.length > 0 ? (
            <label className="focus-habit-selector" htmlFor="focus-habit">
              Hábito para marcar ao concluir
              <select
                id="focus-habit"
                value={selectedHabitId || ''}
                onChange={event => handleHabitChange(Number(event.target.value))}
              >
                {readingHabits.map(habit => (
                  <option key={habit.id} value={habit.id}>{habit.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="focus-habit-invite">
              <BookOpen aria-hidden="true" />
              <div>
                <strong>Você pode ler só com o livro ativo</strong>
                <span>Crie um hábito de leitura se também quiser marcar sua rotina.</span>
              </div>
            </div>
          )}
        </div>

        <div className="focus-timer-card">
          <div className="focus-phase-row">
            <span className="focus-phase-badge">
              {phase === 'focus'
                ? <Target aria-hidden="true" />
                : <Coffee aria-hidden="true" />}
              {phase === 'focus' ? 'Pomodoro' : 'Pausa'}
            </span>
            <span>{cycles} {cycles === 1 ? 'ciclo concluído' : 'ciclos concluídos'}</span>
          </div>

          <div className="focus-timer-ring" style={timerStyle}>
            <div className="focus-timer-face">
              <span
                className="focus-timer-value"
                role="timer"
                aria-label={`${minutes} minutos e ${seconds} segundos restantes`}
              >
                {minutes}:{seconds}
              </span>
              <small>{phase === 'focus' ? 'para ler' : 'para respirar'}</small>
            </div>
          </div>

          <div className="focus-timer-actions">
            <button
              className="focus-reset-button"
              onClick={resetTimer}
              type="button"
              aria-label="Reiniciar"
            >
              <RotateCcw aria-hidden="true" />
            </button>
            <button
              className="focus-main-action"
              disabled={!selectedHabitId && !activeBook}
              onClick={toggleTimer}
              type="button"
            >
              {isRunning
                ? <Pause aria-hidden="true" />
                : <Play aria-hidden="true" />}
              {timerActionLabel}
            </button>
          </div>
          {!selectedHabitId && !activeBook && (
            <small className="focus-disabled-note">
              Selecione um livro ativo ou crie um hábito de leitura.
            </small>
          )}
        </div>
      </section>

      <section className="reading-panel">
        <header className="reading-panel-head">
          <div className="reading-heading-icon"><Library aria-hidden="true" /></div>
          <div>
            <span>Minha biblioteca</span>
            <h2>Livros, progresso e histórico</h2>
          </div>
          <button
            className="reading-new-button"
            onClick={() => {
              setIsAddingBook(true)
              setSelectedBookId(null)
              setBookForm(emptyBookForm())
              setNotes([])
              setConfirmDeleteBookId(null)
              setReadingError('')
              setReadingMessage('')
            }}
            type="button"
          >
            <Plus aria-hidden="true" /> Adicionar livro
          </button>
        </header>

        {readingError && <p className="reading-feedback error" role="alert">{readingError}</p>}
        {readingMessage && <p className="reading-feedback success" role="status">{readingMessage}</p>}

        {isLoadingReading ? (
          <div className="reading-loading" role="status">
            Carregando sua biblioteca…
          </div>
        ) : (
          <>
            <div className="reading-library-filters" aria-label="Filtrar biblioteca">
              {([
                ['todos', 'Todos'],
                ['lendo', 'Lendo'],
                ['quero_ler', 'Quero ler'],
                ['concluido', 'Concluídos'],
              ] as const).map(([value, label]) => (
                <button
                  className={libraryFilter === value ? 'active' : ''}
                  key={value}
                  onClick={() => setLibraryFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            {books.length === 0 && !isAddingBook ? (
              <div className="reading-empty-library">
                <BookOpen aria-hidden="true" />
                <h3>Comece sua biblioteca</h3>
                <p>
                  Adicione o livro que está lendo ou guarde um título para ler depois.
                </p>
                <button
                  onClick={() => {
                    setIsAddingBook(true)
                    setBookForm(emptyBookForm())
                  }}
                  type="button"
                >
                  <Plus aria-hidden="true" /> Adicionar primeiro livro
                </button>
              </div>
            ) : (
              <div className="reading-library-list">
                {filteredBooks.map(book => (
                  <article
                    className={[
                      'reading-library-card',
                      selectedBookId === book.id ? 'selected' : '',
                      book.is_active ? 'active-book' : '',
                    ].filter(Boolean).join(' ')}
                    key={book.id}
                  >
                    <button
                      className="reading-library-select"
                      onClick={() => {
                        setIsAddingBook(false)
                        setSelectedBookId(book.id)
                        setConfirmDeleteBookId(null)
                        setReadingMessage('')
                      }}
                      type="button"
                    >
                      <span className="reading-library-cover" aria-hidden="true">
                        <BookOpen />
                      </span>
                      <span className="reading-library-copy">
                        <small>
                          {book.is_active ? 'Livro ativo · ' : ''}
                          {STATUS_LABELS[book.status]}
                        </small>
                        <strong>{book.title}</strong>
                        <span>Página {book.current_page} de {book.total_pages}</span>
                        <span className="reading-mini-progress">
                          <i style={{ width: `${book.progress_percent}%` }} />
                        </span>
                      </span>
                      <span className="reading-library-percent">
                        {formatProgress(book.progress_percent)}%
                        <ChevronRight aria-hidden="true" />
                      </span>
                    </button>
                    {!book.is_active && book.status !== 'concluido' && (
                      <button
                        className="reading-activate-button"
                        disabled={isSaving}
                        onClick={() => void activateBook(book)}
                        type="button"
                      >
                        Tornar ativo
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}

            {(isAddingBook || selectedBook) && (
              <div className="reading-workspace">
                <form className="reading-form" onSubmit={saveBook}>
                  <div className="reading-form-title">
                    <div>
                      <span>{isAddingBook ? 'Novo título' : 'Livro selecionado'}</span>
                      <h3>
                        {isAddingBook
                          ? 'Adicionar à biblioteca'
                          : 'Atualizar progresso'}
                      </h3>
                    </div>
                    {!isAddingBook && selectedBook?.is_active && (
                      <span className="reading-status">
                        <Bookmark aria-hidden="true" /> Livro ativo
                      </span>
                    )}
                  </div>

                  <div className="reading-progress-card">
                    <div className="reading-book-mark" aria-hidden="true">
                      <BookOpen />
                    </div>
                    <div className="reading-progress-copy">
                      <span>{bookForm.title.trim() || 'Seu próximo livro'}</span>
                      <strong>{formatProgress(readingProgress)}% concluído</strong>
                      <div
                        className="reading-progress-track"
                        role="progressbar"
                        aria-label="Progresso de leitura"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(readingProgress)}
                      >
                        <span style={{ width: `${readingProgress}%` }} />
                      </div>
                      <small>
                        Página {bookForm.currentPage || '0'} de {bookForm.totalPages || '—'}
                      </small>
                    </div>
                  </div>

                  <div className="reading-fields">
                    <label className="reading-title-field">
                      Livro que estou lendo
                      <input
                        maxLength={200}
                        onChange={event => setBookForm(previous => ({
                          ...previous,
                          title: event.target.value,
                        }))}
                        placeholder="Ex.: Ideias para adiar o fim do mundo"
                        required
                        value={bookForm.title}
                      />
                    </label>
                    <label>
                      Página atual
                      <input
                        inputMode="numeric"
                        min="0"
                        onChange={event => setBookForm(previous => ({
                          ...previous,
                          currentPage: event.target.value,
                        }))}
                        required
                        step="1"
                        type="number"
                        value={bookForm.currentPage}
                      />
                    </label>
                    <label>
                      Total de páginas
                      <input
                        inputMode="numeric"
                        min="1"
                        onChange={event => setBookForm(previous => ({
                          ...previous,
                          totalPages: event.target.value,
                        }))}
                        required
                        step="1"
                        type="number"
                        value={bookForm.totalPages}
                      />
                    </label>
                    <label>
                      Situação
                      <select
                        onChange={event => {
                          const status = event.target.value as ReadingStatus
                          setBookForm(previous => ({
                            ...previous,
                            status,
                            isActive: status === 'concluido'
                              ? false
                              : previous.isActive,
                          }))
                        }}
                        value={bookForm.status}
                      >
                        <option value="quero_ler">Quero ler</option>
                        <option value="lendo">Lendo</option>
                        <option value="concluido">Concluído</option>
                      </select>
                    </label>
                  </div>

                  <label className="reading-active-choice">
                    <input
                      aria-label="Usar como livro ativo"
                      checked={bookForm.isActive}
                      disabled={bookForm.status === 'concluido'}
                      onChange={event => setBookForm(previous => ({
                        ...previous,
                        isActive: event.target.checked,
                        status: event.target.checked ? 'lendo' : previous.status,
                      }))}
                      type="checkbox"
                    />
                    <span>
                      <strong>Usar como livro ativo</strong>
                      <small>O Pomodoro salvará 25 minutos no diário deste livro.</small>
                    </span>
                  </label>

                  <label className="reading-notes-field">
                    <span>
                      Anotações anteriores deste livro
                      <small>{bookForm.notes.length.toLocaleString('pt-BR')} / 10.000</small>
                    </span>
                    <textarea
                      aria-label="Anotações anteriores deste livro"
                      maxLength={10_000}
                      onChange={event => setBookForm(previous => ({
                        ...previous,
                        notes: event.target.value,
                      }))}
                      placeholder="O texto que já estava salvo permanece aqui. Novas notas podem receber página e data abaixo."
                      rows={3}
                      value={bookForm.notes}
                    />
                  </label>

                  <div className="reading-actions">
                    <button
                      className="reading-save-button"
                      disabled={isSaving}
                      type="submit"
                    >
                      <Save aria-hidden="true" />
                      {isSaving
                        ? 'Salvando…'
                        : isAddingBook
                          ? 'Adicionar à biblioteca'
                          : 'Salvar leitura'}
                    </button>
                    {!isAddingBook
                      && selectedBook
                      && selectedBook.status !== 'concluido' && (
                        <button
                          className="reading-page-button"
                          disabled={isSaving}
                          onClick={() => void advanceOnePage()}
                          type="button"
                        >
                          <Plus aria-hidden="true" /> Avançar 1 página
                        </button>
                      )}
                    {!isAddingBook && selectedBook && (
                      <button
                        className="reading-delete-button"
                        disabled={isSaving}
                        onClick={() => setConfirmDeleteBookId(selectedBook.id)}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" /> Remover livro
                      </button>
                    )}
                  </div>

                  {confirmDeleteBookId === selectedBook?.id && (
                    <div className="reading-delete-confirm" role="alert">
                      <span>Remover o livro, suas sessões e anotações?</span>
                      <div>
                        <button
                          className="reading-cancel-delete"
                          onClick={() => setConfirmDeleteBookId(null)}
                          type="button"
                        >
                          Cancelar
                        </button>
                        <button
                          className="reading-confirm-delete"
                          disabled={isSaving}
                          onClick={() => void deleteBook(selectedBook.id)}
                          type="button"
                        >
                          Sim, remover
                        </button>
                      </div>
                    </div>
                  )}
                </form>

                {!isAddingBook && selectedBook && (
                  <div className="reading-journal-grid">
                    <section className="reading-log-card">
                      <header>
                        <Clock aria-hidden="true" />
                        <div>
                          <span>Diário</span>
                          <h3>Registrar leitura</h3>
                        </div>
                      </header>
                      <form onSubmit={saveSession}>
                        <label>
                          Data
                          <input
                            onChange={event => setSessionForm(previous => ({
                              ...previous,
                              date: event.target.value,
                            }))}
                            required
                            type="date"
                            value={sessionForm.date}
                          />
                        </label>
                        <label>
                          Página inicial
                          <input
                            min="0"
                            onChange={event => setSessionForm(previous => ({
                              ...previous,
                              startPage: event.target.value,
                            }))}
                            required
                            type="number"
                            value={sessionForm.startPage}
                          />
                        </label>
                        <label>
                          Página final
                          <input
                            min="0"
                            onChange={event => setSessionForm(previous => ({
                              ...previous,
                              endPage: event.target.value,
                            }))}
                            required
                            type="number"
                            value={sessionForm.endPage}
                          />
                        </label>
                        <label>
                          Minutos
                          <input
                            min="1"
                            onChange={event => setSessionForm(previous => ({
                              ...previous,
                              minutes: event.target.value,
                            }))}
                            required
                            type="number"
                            value={sessionForm.minutes}
                          />
                        </label>
                        <button disabled={isSaving} type="submit">
                          <Plus aria-hidden="true" /> Registrar sessão
                        </button>
                      </form>
                    </section>

                    <section className="reading-log-card">
                      <header>
                        <PenLine aria-hidden="true" />
                        <div>
                          <span>Caderno do livro</span>
                          <h3>Nova anotação</h3>
                        </div>
                      </header>
                      <form className="reading-note-form" onSubmit={saveNote}>
                        <label>
                          Data
                          <input
                            onChange={event => setNoteForm(previous => ({
                              ...previous,
                              date: event.target.value,
                            }))}
                            required
                            type="date"
                            value={noteForm.date}
                          />
                        </label>
                        <label>
                          Página
                          <input
                            min="0"
                            onChange={event => setNoteForm(previous => ({
                              ...previous,
                              page: event.target.value,
                            }))}
                            required
                            type="number"
                            value={noteForm.page}
                          />
                        </label>
                        <label className="reading-note-content">
                          Anotação
                          <textarea
                            aria-label="Anotação com página e data"
                            maxLength={5_000}
                            onChange={event => setNoteForm(previous => ({
                              ...previous,
                              content: event.target.value,
                            }))}
                            placeholder="Ideia, frase ou aprendizado…"
                            required
                            rows={3}
                            value={noteForm.content}
                          />
                        </label>
                        <button disabled={isSaving} type="submit">
                          <Save aria-hidden="true" /> Guardar anotação
                        </button>
                      </form>
                    </section>
                  </div>
                )}

                {!isAddingBook && selectedBook && notes.length > 0 && (
                  <section className="reading-notes-list">
                    <header>
                      <PenLine aria-hidden="true" />
                      <div>
                        <span>Anotações de “{selectedBook.title}”</span>
                        <strong>{notes.length} {notes.length === 1 ? 'registro' : 'registros'}</strong>
                      </div>
                    </header>
                    <div>
                      {notes.map(note => (
                        <article key={note.id}>
                          <span>
                            <Calendar aria-hidden="true" />
                            {formatDate(note.note_date)} · página {note.page}
                          </span>
                          <p>{note.content}</p>
                          <button
                            aria-label={`Remover anotação da página ${note.page}`}
                            disabled={isSaving}
                            onClick={() => void deleteNote(note.id)}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <section className="reading-overview" aria-label="Resumo de leitura">
        <article>
          <TrendingUp aria-hidden="true" />
          <div>
            <span>Esta semana</span>
            <strong>{summary.pages_this_week} páginas</strong>
          </div>
        </article>
        <article>
          <Clock aria-hidden="true" />
          <div>
            <span>Tempo de leitura</span>
            <strong>{summary.duration_this_week} min</strong>
          </div>
        </article>
        <article>
          <Library aria-hidden="true" />
          <div>
            <span>Minha biblioteca</span>
            <strong>{books.length} {books.length === 1 ? 'livro' : 'livros'}</strong>
          </div>
        </article>
      </section>

      <section className="reading-history-panel">
        <div className="reading-history-head">
          <div>
            <TrendingUp aria-hidden="true" />
            <span>
              <small>Ritmo de leitura</small>
              <strong>Páginas por semana</strong>
            </span>
          </div>
          <span>{summary.total_sessions} sessões no diário</span>
        </div>

        <div className="reading-week-chart" aria-label="Páginas lidas por semana">
          {summary.weeks.map(week => (
            <div key={week.week_start}>
              <span className="reading-week-value">{week.pages_read}</span>
              <span className="reading-week-bar">
                <i style={{ height: `${Math.max(4, (week.pages_read / chartMaximum) * 100)}%` }} />
              </span>
              <small>{formatDate(week.week_start)}</small>
            </div>
          ))}
          {summary.weeks.length === 0 && (
            <p>As páginas aparecerão aqui depois da primeira sessão.</p>
          )}
        </div>

        <div className="reading-session-history">
          <h3>
            {selectedBook ? `Histórico de “${selectedBook.title}”` : 'Histórico recente'}
          </h3>
          {selectedSessions.length === 0 ? (
            <p className="reading-history-empty">
              Registre uma leitura ou conclua um Pomodoro para iniciar o diário.
            </p>
          ) : (
            selectedSessions.slice(0, 8).map(session => (
              <article key={session.id}>
                <span className="reading-session-date">
                  <Calendar aria-hidden="true" /> {formatDate(session.session_date)}
                </span>
                <div>
                  <strong>{session.book_title}</strong>
                  <small>
                    {session.source === 'focus' ? 'Pomodoro concluído' : 'Leitura registrada'}
                    {' · '}{session.duration_minutes} min
                  </small>
                </div>
                <span className="reading-session-pages">
                  {session.pages_read > 0
                    ? `+${session.pages_read} páginas`
                    : `página ${session.end_page}`}
                </span>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
