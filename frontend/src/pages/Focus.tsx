import {
  BookOpen,
  Bookmark,
  Check,
  Coffee,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Target,
  Trash2,
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
  type ReadingBookInput,
} from '../services/readingApi'
import { toLocalDateValue } from '../utils/date'
import '../styles/focus-reading.css'

interface FocusProps {
  userId: number
}

interface ReadingForm {
  title: string
  currentPage: string
  totalPages: string
  notes: string
}

const EMPTY_READING_FORM: ReadingForm = {
  title: '',
  currentPage: '0',
  totalPages: '',
  notes: '',
}

function formFromBook(book: ReadingBook): ReadingForm {
  return {
    title: book.title,
    currentPage: String(book.current_page),
    totalPages: String(book.total_pages),
    notes: book.notes,
  }
}

function progressFromForm(form: ReadingForm): number {
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

export default function Focus({ userId }: FocusProps) {
  const [searchParams, setSearchParams] = useAppSearchParams()
  const [readingHabits, setReadingHabits] = useState<Habit[]>([])
  const [selectedHabitId, setSelectedHabitId] = useState<number | null>(null)
  const [phase, setPhase] = useState<'focus' | 'break'>('focus')
  const [remaining, setRemaining] = useState(25 * 60)
  const [cycles, setCycles] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [book, setBook] = useState<ReadingBook | null>(null)
  const [bookForm, setBookForm] = useState<ReadingForm>(EMPTY_READING_FORM)
  const [isLoadingBook, setIsLoadingBook] = useState(true)
  const [isSavingBook, setIsSavingBook] = useState(false)
  const [bookError, setBookError] = useState('')
  const [bookMessage, setBookMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const intervalRef = useRef<number | null>(null)
  const requestedHabitId = Number(searchParams.get('habit')) || null

  useEffect(() => {
    stopTimer()
    setPhase('focus')
    setRemaining(25 * 60)
    setCycles(0)
    void loadHabits()
    void loadBook()
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

  async function loadHabits() {
    try {
      const data = await apiRoutes.getHabits(userId)
      const habits: Habit[] = data.data
      setReadingHabits(habits.filter(habit => /leitura|\bler\b/i.test(habit.name)))
    } catch (error) {
      console.error('Failed to load habits:', error)
    }
  }

  async function loadBook() {
    setIsLoadingBook(true)
    setBook(null)
    setBookForm(EMPTY_READING_FORM)
    setBookError('')
    setBookMessage('')
    try {
      const response = await readingApi.getActiveBook(userId)
      setBook(response.data)
      setBookForm(response.data ? formFromBook(response.data) : EMPTY_READING_FORM)
    } catch (error) {
      console.error('Failed to load reading book:', error)
      setBookError('Não foi possível carregar seu livro agora.')
    } finally {
      setIsLoadingBook(false)
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
    if (!selectedHabitId || intervalRef.current !== null) return
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
    if (isRunning) {
      stopTimer()
    } else {
      startTimer()
    }
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
      setCycles(previous => previous + 1)
      if (selectedHabitId) {
        try {
          await apiRoutes.checkinHabit(selectedHabitId, toLocalDateValue())
          notify.checkin(selectedHabit?.name || 'Leitura')
        } catch (error) {
          console.error('Failed to check-in:', error)
        }
      }
      const nextBreakMinutes = cycles > 0 && (cycles + 1) % 4 === 0 ? 15 : 5
      setPhase('break')
      setRemaining(nextBreakMinutes * 60)
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

  function buildBookInput(currentPageOverride?: number): ReadingBookInput | null {
    const title = bookForm.title.trim()
    const currentPage = currentPageOverride ?? Number(bookForm.currentPage)
    const totalPages = Number(bookForm.totalPages)
    const notes = bookForm.notes.trim()

    if (!title) {
      setBookError('Digite o título do livro.')
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
      setBookError(
        'Use páginas inteiras: atual a partir de 0 e total a partir de 1 (máximo 100.000).',
      )
      return null
    }
    if (currentPage > totalPages) {
      setBookError('A página atual não pode ser maior que o total do livro.')
      return null
    }
    if (notes.length > 10_000) {
      setBookError('As anotações podem ter no máximo 10.000 caracteres.')
      return null
    }

    return {
      title,
      current_page: currentPage,
      total_pages: totalPages,
      notes,
    }
  }

  async function persistBook(input: ReadingBookInput) {
    setIsSavingBook(true)
    setBookError('')
    setBookMessage('')
    try {
      const response = await readingApi.saveActiveBook(userId, input)
      setBook(response.data)
      setBookForm(formFromBook(response.data))
      setBookMessage(
        response.data.progress_percent >= 100
          ? 'Livro concluído. Excelente leitura!'
          : 'Progresso e anotações salvos.',
      )
    } catch (error) {
      console.error('Failed to save reading book:', error)
      setBookError('Não foi possível salvar. Tente novamente.')
    } finally {
      setIsSavingBook(false)
    }
  }

  async function handleSaveBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = buildBookInput()
    if (input) await persistBook(input)
  }

  async function advanceOnePage() {
    const currentPage = Number(bookForm.currentPage)
    const totalPages = Number(bookForm.totalPages)
    if (!Number.isInteger(currentPage) || !Number.isInteger(totalPages)) {
      setBookError('Confira a página atual e o total do livro.')
      return
    }
    const nextPage = Math.min(currentPage + 1, totalPages)
    const input = buildBookInput(nextPage)
    if (input) await persistBook(input)
  }

  async function deleteBook() {
    setIsSavingBook(true)
    setBookError('')
    try {
      await readingApi.deleteActiveBook(userId)
      setBook(null)
      setBookForm(EMPTY_READING_FORM)
      setConfirmDelete(false)
      setBookMessage('Livro removido do acompanhamento.')
    } catch (error) {
      console.error('Failed to delete reading book:', error)
      setBookError('Não foi possível remover o livro.')
    } finally {
      setIsSavingBook(false)
    }
  }

  const selectedHabit = readingHabits.find(habit => habit.id === selectedHabitId)
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0')
  const seconds = String(remaining % 60).padStart(2, '0')
  const breakMinutes = cycles > 0 && cycles % 4 === 0 ? 15 : 5
  const phaseDuration = phase === 'focus' ? 25 * 60 : breakMinutes * 60
  const timerProgress = ((phaseDuration - remaining) / phaseDuration) * 100
  const timerActionLabel = isRunning
    ? 'Pausar'
    : remaining < phaseDuration
      ? `Continuar ${phase === 'focus' ? 'foco' : 'pausa'}`
      : `Iniciar ${phase === 'focus' ? 'foco' : 'pausa'}`
  const readingProgress = progressFromForm(bookForm)
  const progressLabel = `${formatProgress(readingProgress)}% concluído`
  const timerStyle = {
    '--focus-timer-progress': `${timerProgress}%`,
  } as CSSProperties

  return (
    <div className="view focus-reading-view" data-view="focus">
      <section className={`focus-hero ${phase === 'break' ? 'is-break' : ''}`}>
        <div className="focus-hero-copy">
          <span className="focus-kicker"><Sparkles aria-hidden="true" /> Modo sem distrações</span>
          <h2>Um bloco de atenção para avançar no que importa.</h2>
          <p>
            Leia por 25 minutos, faça uma pausa curta e registre seu progresso
            sem sair desta tela.
          </p>

          {readingHabits.length > 0 ? (
            <label className="focus-habit-selector" htmlFor="focus-habit">
              Hábito desta sessão
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
                <strong>Crie um hábito de leitura</strong>
                <span>Ele será usado para registrar cada Pomodoro concluído.</span>
              </div>
            </div>
          )}
        </div>

        <div className="focus-timer-card">
          <div className="focus-phase-row">
            <span className="focus-phase-badge">
              {phase === 'focus' ? <Target aria-hidden="true" /> : <Coffee aria-hidden="true" />}
              {phase === 'focus' ? 'Foco' : 'Pausa'}
            </span>
            <span>{cycles} {cycles === 1 ? 'ciclo concluído' : 'ciclos concluídos'}</span>
          </div>

          <div className="focus-timer-ring" style={timerStyle}>
            <div className="focus-timer-face">
              <span className="focus-timer-value" role="timer" aria-label={`${minutes} minutos e ${seconds} segundos restantes`}>
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
              disabled={!selectedHabitId}
              onClick={toggleTimer}
              type="button"
            >
              {isRunning ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              {timerActionLabel}
            </button>
          </div>
          {!selectedHabitId && (
            <small className="focus-disabled-note">
              Escolha um hábito de leitura para iniciar o cronômetro.
            </small>
          )}
        </div>
      </section>

      <section className="reading-panel">
        <header className="reading-panel-head">
          <div className="reading-heading-icon"><BookOpen aria-hidden="true" /></div>
          <div>
            <span>Minha leitura</span>
            <h2>{book ? 'Livro em andamento' : 'Acompanhe seu livro atual'}</h2>
          </div>
          {book && (
            <span className={`reading-status ${readingProgress >= 100 ? 'complete' : ''}`}>
              {readingProgress >= 100 ? <Check aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
              {readingProgress >= 100 ? 'Concluído' : 'Em leitura'}
            </span>
          )}
        </header>

        {isLoadingBook ? (
          <div className="reading-loading" role="status">
            Carregando sua leitura…
          </div>
        ) : (
          <form className="reading-form" onSubmit={handleSaveBook}>
            <div className="reading-progress-card">
              <div className="reading-book-mark" aria-hidden="true">
                <BookOpen />
              </div>
              <div className="reading-progress-copy">
                <span>{bookForm.title.trim() || 'Seu próximo livro'}</span>
                <strong>{progressLabel}</strong>
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
                  placeholder="Ex.: Hábitos Atômicos"
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
            </div>

            <label className="reading-notes-field">
              <span>
                Anotações deste livro
                <small>{bookForm.notes.length.toLocaleString('pt-BR')} / 10.000</small>
              </span>
              <textarea
                aria-label="Anotações deste livro"
                maxLength={10_000}
                onChange={event => setBookForm(previous => ({
                  ...previous,
                  notes: event.target.value,
                }))}
                placeholder="Ideias importantes, frases, aprendizados e o que você quer aplicar…"
                rows={6}
                value={bookForm.notes}
              />
            </label>

            {bookError && <p className="reading-feedback error" role="alert">{bookError}</p>}
            {bookMessage && <p className="reading-feedback success" role="status">{bookMessage}</p>}

            <div className="reading-actions">
              <button className="reading-save-button" disabled={isSavingBook} type="submit">
                <Save aria-hidden="true" />
                {isSavingBook ? 'Salvando…' : book ? 'Salvar leitura' : 'Começar acompanhamento'}
              </button>
              {book && readingProgress < 100 && (
                <button
                  className="reading-page-button"
                  disabled={isSavingBook}
                  onClick={() => void advanceOnePage()}
                  type="button"
                >
                  <Plus aria-hidden="true" /> Avançar 1 página
                </button>
              )}
              {book && !confirmDelete && (
                <button
                  className="reading-delete-button"
                  disabled={isSavingBook}
                  onClick={() => setConfirmDelete(true)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" /> Remover livro
                </button>
              )}
            </div>

            {confirmDelete && (
              <div className="reading-delete-confirm" role="alert">
                <span>Remover este livro e suas anotações?</span>
                <div>
                  <button
                    className="reading-cancel-delete"
                    onClick={() => setConfirmDelete(false)}
                    type="button"
                  >
                    Cancelar
                  </button>
                  <button
                    className="reading-confirm-delete"
                    disabled={isSavingBook}
                    onClick={() => void deleteBook()}
                    type="button"
                  >
                    Sim, remover
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
      </section>
    </div>
  )
}
