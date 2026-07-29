import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertCircle,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Dumbbell,
  Pencil,
  Plus,
  RefreshCw,
  Timer,
  Trash2,
  X,
} from 'lucide-react'
import { apiRoutes } from '../services/api'
import type { Habit } from '../services/api'
import WorkoutsPanel from '../components/WorkoutsPanel'
import { toLocalDateValue } from '../utils/date'
import { useAppRouter } from '../router'
import '../styles/routine-upgrade.css'

interface HabitsProps {
  userId: number
}

const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Seg' },
  { value: 1, label: 'Ter' },
  { value: 2, label: 'Qua' },
  { value: 3, label: 'Qui' },
  { value: 4, label: 'Sex' },
  { value: 5, label: 'Sáb' },
  { value: 6, label: 'Dom' },
]
const EVERY_DAY = WEEKDAY_OPTIONS.map(day => day.value)

function configuredDays(habit: Habit): number[] {
  return habit.active_days?.length ? habit.active_days : EVERY_DAY
}

function daysSummary(days: number[]): string {
  if (days.length === 7) return 'Todos os dias'
  if (days.join(',') === '0,1,2,3,4') return 'Dias úteis'
  return WEEKDAY_OPTIONS
    .filter(option => days.includes(option.value))
    .map(option => option.label)
    .join(', ')
}

export default function Habits({ userId }: HabitsProps) {
  const { navigate, search } = useAppRouter()
  const [habits, setHabits] = useState<Habit[]>([])
  const [name, setName] = useState('')
  const [time, setTime] = useState('09:00')
  const [activeDays, setActiveDays] = useState<number[]>(EVERY_DAY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editActiveDays, setEditActiveDays] = useState<number[]>(EVERY_DAY)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [showWorkouts, setShowWorkouts] = useState(false)
  const [workoutHabitId, setWorkoutHabitId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const workoutsRef = useRef<HTMLDivElement>(null)

  const today = toLocalDateValue()
  const todayWeekday = (new Date().getDay() + 6) % 7

  const loadHabits = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const { data } = await apiRoutes.getHabits(userId)
      setHabits(data)
      setError('')
    } catch (loadError) {
      console.error('Failed to load habits:', loadError)
      setError('Não foi possível carregar seus hábitos. Tente novamente.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadHabits(true)
  }, [loadHabits])

  useEffect(() => {
    if (new URLSearchParams(search || '').get('workout') === '1') {
      setWorkoutHabitId(null)
      setShowWorkouts(true)
    }
  }, [search])

  useEffect(() => {
    if (showWorkouts) {
      workoutsRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }, [showWorkouts])

  const orderedHabits = useMemo(
    () => [...habits].sort((a, b) => a.time.localeCompare(b.time)),
    [habits],
  )
  const scheduledHabits = habits.filter(habit => configuredDays(habit).includes(todayWeekday))
  const completedCount = scheduledHabits.filter(habit => habit.check_ins.includes(today)).length
  const remainingCount = scheduledHabits.length - completedCount
  const progress = scheduledHabits.length === 0
    ? 0
    : Math.round((completedCount / scheduledHabits.length) * 100)
  const nextHabit = orderedHabits.find(
    habit => configuredDays(habit).includes(todayWeekday) && !habit.check_ins.includes(today),
  )

  function toggleActiveDay(day: number, editing = false) {
    const current = editing ? editActiveDays : activeDays
    const update = editing ? setEditActiveDays : setActiveDays
    if (current.includes(day)) {
      if (current.length === 1) return
      update(current.filter(value => value !== day))
      return
    }
    update([...current, day].sort((a, b) => a - b))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName || busyKey) return

    setBusyKey('create')
    setError('')
    try {
      await apiRoutes.createHabit(userId, {
        name: trimmedName,
        time: time || '09:00',
        active_days: activeDays,
      })
      setName('')
      setTime('09:00')
      setActiveDays(EVERY_DAY)
      await loadHabits()
    } catch (createError) {
      console.error('Failed to create habit:', createError)
      setError('Não foi possível adicionar o hábito. Confira os dados e tente novamente.')
    } finally {
      setBusyKey(null)
    }
  }

  async function toggleCheckIn(habit: Habit) {
    const key = `toggle-${habit.id}`
    if (busyKey) return
    const isCheckedIn = habit.check_ins.includes(today)

    setBusyKey(key)
    setError('')
    try {
      if (isCheckedIn) {
        await apiRoutes.removeCheckin(habit.id, today)
      } else {
        await apiRoutes.checkinHabit(habit.id, today)
      }
      await loadHabits()
    } catch (toggleError) {
      console.error('Failed to toggle check-in:', toggleError)
      setError(`Não foi possível ${isCheckedIn ? 'desmarcar' : 'concluir'} esse hábito.`)
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteHabit(id: number) {
    if (busyKey) return
    setBusyKey(`delete-${id}`)
    setError('')
    try {
      await apiRoutes.deleteHabit(id)
      setPendingDeleteId(null)
      if (editingId === id) setEditingId(null)
      await loadHabits()
    } catch (deleteError) {
      console.error('Failed to delete habit:', deleteError)
      setError('Não foi possível remover o hábito.')
    } finally {
      setBusyKey(null)
    }
  }

  function startEditing(habit: Habit) {
    setPendingDeleteId(null)
    setEditingId(habit.id)
    setEditName(habit.name)
    setEditTime(habit.time)
    setEditActiveDays(configuredDays(habit))
  }

  async function saveEditing() {
    const trimmedName = editName.trim()
    if (!editingId || !trimmedName || busyKey) return

    const id = editingId
    setBusyKey(`edit-${id}`)
    setError('')
    try {
      await apiRoutes.updateHabit(id, {
        name: trimmedName,
        time: editTime || '09:00',
        active_days: editActiveDays,
      })
      setEditingId(null)
      await loadHabits()
    } catch (updateError) {
      console.error('Failed to update habit:', updateError)
      setError('Não foi possível salvar as alterações do hábito.')
    } finally {
      setBusyKey(null)
    }
  }

  function isReadingHabit(habitName: string) {
    return /leitura|\bler\b/i.test(habitName)
  }

  function isWorkoutHabit(habitName: string) {
    return /treino|exerc[ií]cio|muscula[cç][aã]o/i.test(habitName)
  }

  function goToFocus(habitId: number) {
    navigate(`/focus?habit=${habitId}`)
  }

  function openWorkouts(habitId: number | null) {
    setWorkoutHabitId(habitId)
    setShowWorkouts(true)
  }

  function closeWorkouts() {
    setShowWorkouts(false)
    setWorkoutHabitId(null)
    if (new URLSearchParams(search || '').get('workout') === '1') {
      navigate('/habits', { replace: true })
    }
  }

  async function handleWorkoutFinished() {
    const habit = habits.find(item => item.id === workoutHabitId)
    if (!habit || habit.check_ins.includes(today)) {
      await loadHabits()
      return
    }

    try {
      await apiRoutes.checkinHabit(habit.id, today)
      await loadHabits()
    } catch (checkInError) {
      console.error('Failed to check in workout habit:', checkInError)
      setError('O treino foi finalizado, mas não foi possível marcar o hábito como feito.')
    }
  }

  return (
    <div className="view routine-view" data-view="habits">
      <section className="routine-hero routine-habit-hero" aria-labelledby="habits-title">
        <div className="routine-hero-copy">
          <p className="routine-kicker">Sua rotina de hoje</p>
          <h2 id="habits-title">Pequenos passos, todos os dias.</h2>
          <p>
            Acompanhe o que já fez e enxergue com clareza o próximo passo da sua rotina.
          </p>
        </div>

        <div className="routine-progress-card" aria-label={`${progress}% dos hábitos concluídos hoje`}>
          <div className="routine-progress-heading">
            <div>
              <span>Progresso de hoje</span>
              <strong>{completedCount} de {scheduledHabits.length}</strong>
            </div>
            <b>{progress}%</b>
          </div>
          <div
            className="routine-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="routine-progress-foot">
            <span>
              <CheckCircle2 size={16} aria-hidden="true" />
              {completedCount} {completedCount === 1 ? 'feito' : 'feitos'}
            </span>
            <span>
              <Clock3 size={16} aria-hidden="true" />
              {remainingCount} {remainingCount === 1 ? 'restante' : 'restantes'}
            </span>
          </div>
        </div>
      </section>

      <section className="panel routine-panel routine-create-panel">
        <div className="routine-section-head">
          <div>
            <p className="routine-kicker">Novo hábito</p>
            <h2>O que você quer repetir?</h2>
            <p>Você só precisa escolher um nome e um horário.</p>
          </div>
          <span className="routine-head-icon"><Plus size={20} aria-hidden="true" /></span>
        </div>

        <form className="routine-create-form routine-habit-form" onSubmit={handleSubmit}>
          <label>
            Nome do hábito
            <input
              type="text"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Ex: Treino em casa"
              maxLength={60}
              required
            />
          </label>
          <label>
            Horário
            <input
              type="time"
              value={time}
              onChange={event => setTime(event.target.value)}
              required
            />
          </label>
          <fieldset className="routine-day-picker">
            <legend>Dias da semana</legend>
            <div>
              {WEEKDAY_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={activeDays.includes(option.value) ? 'is-active' : ''}
                  aria-pressed={activeDays.includes(option.value)}
                  onClick={() => toggleActiveDay(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            className="primary-button routine-submit"
            type="submit"
            disabled={!name.trim() || busyKey !== null}
          >
            {busyKey === 'create'
              ? <><RefreshCw className="routine-spin" size={18} aria-hidden="true" /> Adicionando...</>
              : <><Plus size={18} aria-hidden="true" /> Adicionar hábito</>}
          </button>
        </form>
      </section>

      {error && (
        <div className="routine-alert" role="alert">
          <AlertCircle size={19} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Fechar aviso">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      )}

      <section className={`routine-next-card ${nextHabit ? '' : 'is-complete'}`}>
        <div className="routine-next-icon" aria-hidden="true">
          {nextHabit ? <Clock3 size={22} /> : <CheckCircle2 size={22} />}
        </div>
        <div>
          <span>
            {nextHabit
              ? 'Próximo hábito'
              : habits.length === 0
                ? 'Sua rotina'
                : 'Rotina concluída'}
          </span>
          <strong>
            {nextHabit
              ? nextHabit.name
              : habits.length === 0
                ? 'Adicione seu primeiro hábito'
                : 'Tudo feito por hoje!'}
          </strong>
          <small>
            {nextHabit
              ? `${nextHabit.time} · toque em “Marcar feito” quando concluir`
              : habits.length === 0
                ? 'Comece com algo simples que você quer repetir diariamente.'
                : scheduledHabits.length === 0
                  ? 'Hoje é um dia livre na sua rotina.'
                  : 'Você completou todos os hábitos planejados.'}
          </small>
        </div>
        {nextHabit && (
          <button
            className="routine-next-action"
            type="button"
            onClick={() => void toggleCheckIn(nextHabit)}
            disabled={busyKey !== null}
          >
            <Check size={18} aria-hidden="true" />
            Marcar feito
          </button>
        )}
      </section>

      <section className="routine-workout-entry" aria-label="Treinos em casa">
        <span className="routine-workout-entry-icon" aria-hidden="true">
          <Dumbbell size={24} />
        </span>
        <div>
          <p className="routine-kicker">Treino com halteres</p>
          <strong>Inicie, registre cargas e acompanhe sua evolução</strong>
          <small>Descanso cronometrado, séries, repetições e recordes em um só lugar.</small>
        </div>
        <button
          type="button"
          onClick={() => openWorkouts(null)}
        >
          Abrir treinos
        </button>
      </section>

      <section className="panel routine-panel">
        <div className="routine-section-head">
          <div>
            <p className="routine-kicker">Minha rotina</p>
            <h2>Hábitos de hoje</h2>
            <p>
              {habits.length === 0
                ? 'Comece com um hábito simples.'
                : scheduledHabits.length === 0
                  ? 'Nenhum hábito está planejado para hoje.'
                : remainingCount === 1
                  ? '1 hábito ainda aguarda você hoje.'
                  : `${remainingCount} hábitos ainda aguardam você hoje.`}
            </p>
          </div>
          {habits.length > 0 && <span className="routine-count">{habits.length}</span>}
        </div>

        {loading ? (
          <div className="routine-loading" role="status">
            <RefreshCw className="routine-spin" size={22} aria-hidden="true" />
            <span>Carregando seus hábitos...</span>
          </div>
        ) : habits.length === 0 ? (
          <div className="routine-empty-state">
            <span><CheckCircle2 size={24} aria-hidden="true" /></span>
            <div>
              <strong>Sua rotina começa aqui</strong>
              <p>Adicione acima o primeiro hábito que deseja praticar todos os dias.</p>
            </div>
          </div>
        ) : (
          <div className="routine-list">
            {orderedHabits.map((habit, index) => {
              const isDone = habit.check_ins.includes(today)
              const isScheduledToday = configuredDays(habit).includes(todayWeekday)
              const isBusy = busyKey?.endsWith(`-${habit.id}`) ?? false
              const isDeleting = pendingDeleteId === habit.id

              return (
                <article
                  key={habit.id}
                  className={`routine-item routine-habit-item ${isDone ? 'is-done' : ''} ${isScheduledToday ? '' : 'is-off-day'}`}
                >
                  {editingId === habit.id ? (
                    <div className="routine-inline-editor">
                      <label>
                        Nome do hábito
                        <input
                          type="text"
                          value={editName}
                          onChange={event => setEditName(event.target.value)}
                          maxLength={60}
                          autoFocus
                          required
                        />
                      </label>
                      <label>
                        Horário
                        <input
                          type="time"
                          value={editTime}
                          onChange={event => setEditTime(event.target.value)}
                        />
                      </label>
                      <fieldset className="routine-day-picker routine-day-picker-edit">
                        <legend>Dias</legend>
                        <div>
                          {WEEKDAY_OPTIONS.map(option => (
                            <button
                              key={option.value}
                              type="button"
                              className={editActiveDays.includes(option.value) ? 'is-active' : ''}
                              aria-pressed={editActiveDays.includes(option.value)}
                              onClick={() => toggleActiveDay(option.value, true)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                      <div className="routine-editor-actions">
                        <button
                          className="primary-button"
                          onClick={() => void saveEditing()}
                          type="button"
                          disabled={!editName.trim() || isBusy}
                        >
                          {isBusy ? 'Salvando...' : 'Salvar'}
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => setEditingId(null)}
                          type="button"
                          disabled={isBusy}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        className={`routine-check-control ${isDone ? 'is-done' : ''}`}
                        type="button"
                        onClick={() => void toggleCheckIn(habit)}
                        disabled={busyKey !== null || !isScheduledToday}
                        aria-label={isScheduledToday
                          ? `${isDone ? 'Desmarcar' : 'Marcar'} ${habit.name} hoje`
                          : `${habit.name} não está planejado para hoje`}
                      >
                        {isBusy && busyKey?.startsWith('toggle')
                          ? <RefreshCw className="routine-spin" size={19} aria-hidden="true" />
                          : isDone
                            ? <Check size={20} aria-hidden="true" />
                            : isScheduledToday
                              ? <span>{index + 1}</span>
                              : <CalendarDays size={18} aria-hidden="true" />}
                      </button>

                      <div className="routine-item-main">
                        <div className="routine-item-title">
                          <strong>{habit.name}</strong>
                          {isDone && <span className="routine-status done">Feito hoje</span>}
                        </div>
                        <small className="routine-habit-schedule">
                          <span className="routine-habit-time">
                            <Clock3 size={15} aria-hidden="true" />
                            <time dateTime={habit.time}>{habit.time}</time>
                          </span>
                          <span className="routine-schedule-separator" aria-hidden="true">·</span>
                          <span className="routine-habit-days">
                            <CalendarDays size={15} aria-hidden="true" />
                            {daysSummary(configuredDays(habit))}
                          </span>
                        </small>
                      </div>

                      <div className="routine-item-actions">
                        {isReadingHabit(habit.name) && (
                          <button
                            className="routine-special-action focus"
                            type="button"
                            onClick={() => goToFocus(habit.id)}
                            disabled={busyKey !== null}
                          >
                            <Timer size={17} aria-hidden="true" />
                            <span>Foco</span>
                          </button>
                        )}
                        {isWorkoutHabit(habit.name) && (
                          <button
                            className="routine-special-action workout"
                            type="button"
                            onClick={() => openWorkouts(habit.id)}
                            disabled={busyKey !== null}
                          >
                            <Dumbbell size={17} aria-hidden="true" />
                            <span>Treino</span>
                          </button>
                        )}

                        {isDeleting ? (
                          <div className="routine-delete-confirm" role="group" aria-label={`Confirmar remoção de ${habit.name}`}>
                            <span>Remover?</span>
                            <button
                              className="routine-confirm-delete"
                              type="button"
                              onClick={() => void deleteHabit(habit.id)}
                              disabled={isBusy}
                            >
                              {isBusy ? 'Removendo...' : 'Sim'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDeleteId(null)}
                              disabled={isBusy}
                            >
                              Não
                            </button>
                          </div>
                        ) : (
                          <div className="routine-more-actions">
                            <button
                              type="button"
                              title={`Editar ${habit.name}`}
                              onClick={() => startEditing(habit)}
                              disabled={busyKey !== null}
                              aria-label={`Editar ${habit.name}`}
                            >
                              <Pencil size={17} aria-hidden="true" />
                            </button>
                            <button
                              className="danger"
                              onClick={() => {
                                setEditingId(null)
                                setPendingDeleteId(habit.id)
                              }}
                              type="button"
                              title={`Remover ${habit.name}`}
                              disabled={busyKey !== null}
                              aria-label={`Remover ${habit.name}`}
                            >
                              <Trash2 size={17} aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <div ref={workoutsRef}>
        <WorkoutsPanel
          userId={userId}
          isOpen={showWorkouts}
          onClose={closeWorkouts}
          onSessionFinished={handleWorkoutFinished}
        />
      </div>
    </div>
  )
}
