import { useState, useEffect } from 'react'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Dumbbell,
  Flame,
  ListPlus,
  Plus,
  ShoppingBasket,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { apiRoutes } from '../services/api'
import type {
  MonthStats,
  ShoppingList,
  StreakStats,
  Task,
  TodayStats,
} from '../services/api'
import { notify } from '../hooks/useNotifications'
import { toLocalDateValue } from '../utils/date'
import { AppLink } from '../router'
import { readingApi, type ReadingBook } from '../services/readingApi'
import {
  workoutSessionApi,
  type WorkoutSession,
  type WorkoutTemplate,
} from '../services/workoutSessionApi'
import {
  buildRhythmPlan,
  type RhythmAction,
  type RhythmActionKind,
} from '../utils/rhythmPlan'

interface TodayProps {
  userId: number
}

const WORKOUT_DAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const RHYTHM_ACTION_ICONS: Record<RhythmActionKind, LucideIcon> = {
  workout: Dumbbell,
  task: Target,
  habit: Zap,
  shopping: ShoppingBasket,
  reading: BookOpen,
  plan: Sparkles,
}

const DEFAULT_RHYTHM_ACTION: RhythmAction = {
  id: 'plan-day',
  kind: 'plan',
  eyebrow: 'Dia organizado',
  title: 'Você está em dia',
  detail: 'Use este espaço para escolher uma próxima ação leve.',
  to: '/tasks?create=1',
  label: 'Planejar algo',
}

function nextLocalDate(value: string): string {
  const nextDate = new Date(`${value}T12:00:00`)
  nextDate.setDate(nextDate.getDate() + 1)
  return toLocalDateValue(nextDate)
}

export default function Today({ userId }: TodayProps) {
  const [todayStats, setTodayStats] = useState<TodayStats | null>(null)
  const [monthStats, setMonthStats] = useState<MonthStats | null>(null)
  const [streak, setStreak] = useState<StreakStats | null>(null)
  const [pendingTasks, setPendingTasks] = useState<Task[]>([])
  const [shoppingLists, setShoppingLists] = useState<ShoppingList[]>([])
  const [activeBook, setActiveBook] = useState<ReadingBook | null>(null)
  const [todayWorkout, setTodayWorkout] = useState<WorkoutTemplate | null>(null)
  const [activeWorkout, setActiveWorkout] = useState<WorkoutSession | null>(null)
  const [workoutCompletedToday, setWorkoutCompletedToday] = useState(false)
  const [isLoadingAssistant, setIsLoadingAssistant] = useState(true)
  const [assistantActionId, setAssistantActionId] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const currentDate = toLocalDateValue(now)
  const currentTime = now.toTimeString().slice(0, 5)

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    void loadData()
  }, [userId, currentDate])

  async function loadData() {
    setIsLoadingAssistant(true)
    setTodayStats(null)
    setMonthStats(null)
    setStreak(null)
    setPendingTasks([])
    setShoppingLists([])
    setActiveBook(null)
    setTodayWorkout(null)
    setActiveWorkout(null)
    setWorkoutCompletedToday(false)
    const results = await Promise.allSettled([
        apiRoutes.getTodayStats(userId),
        apiRoutes.getMonthStats(userId),
        apiRoutes.getStreak(userId),
        apiRoutes.getTasks(userId),
        apiRoutes.getShoppingLists(userId),
        readingApi.getActiveBook(userId),
        workoutSessionApi.getWorkouts(userId),
        workoutSessionApi.getActiveSession(userId),
        workoutSessionApi.getHistory(userId, 1),
    ])

    const [
      todayResult,
      monthResult,
      streakResult,
      tasksResult,
      shoppingResult,
      bookResult,
      workoutsResult,
      activeWorkoutResult,
      workoutHistoryResult,
    ] = results
    if (todayResult.status === 'fulfilled') setTodayStats(todayResult.value.data)
    if (monthResult.status === 'fulfilled') setMonthStats(monthResult.value.data)
    if (streakResult.status === 'fulfilled') setStreak(streakResult.value.data)
    if (tasksResult.status === 'fulfilled') {
      setPendingTasks(
        tasksResult.value.data
          .filter(task => !task.completed_at)
          .sort((first, second) => (
            first.date.localeCompare(second.date) || first.time.localeCompare(second.time)
          )),
      )
    }
    if (shoppingResult.status === 'fulfilled') {
      setShoppingLists(shoppingResult.value.data)
    }
    if (bookResult.status === 'fulfilled') setActiveBook(bookResult.value.data)
    if (workoutsResult.status === 'fulfilled') {
      const expectedDay = WORKOUT_DAY[new Date().getDay()]
      setTodayWorkout(
        workoutsResult.value.find(workout => (
          workout.day === expectedDay
          || (expectedDay === 'Sáb' && workout.day === 'SÃ¡b')
        )) || null,
      )
    }
    if (activeWorkoutResult.status === 'fulfilled') {
      setActiveWorkout(activeWorkoutResult.value)
    }
    if (workoutHistoryResult.status === 'fulfilled') {
      setWorkoutCompletedToday(
        workoutHistoryResult.value.sessions.some(session => (
          session.status === 'completed'
          && session.completed_at !== null
          && toLocalDateValue(new Date(session.completed_at)) === currentDate
        )),
      )
    }

    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length > 0) {
      console.error('Some today assistant data could not be loaded:', failures)
    }
    setIsLoadingAssistant(false)
  }

  async function toggleCheckIn(habitId: number, done: boolean) {
    const today = currentDate
    try {
      if (done) {
        await apiRoutes.removeCheckin(habitId, today)
      } else {
        await apiRoutes.checkinHabit(habitId, today)
        // Check if this completes all habits for a streak milestone
        const habit = todayStats?.habits_today.find(h => h.id === habitId)
        if (habit) {
          notify.checkin(habit.name)
        }
      }
      await loadData()
    } catch (error) {
      console.error('Failed to toggle check-in:', error)
    }
  }

  async function toggleTaskCompletion(task: Task) {
    try {
      await apiRoutes.completeTask(task.id)
      await loadData()
    } catch (error) {
      console.error('Failed to toggle task:', error)
    }
  }

  async function runAssistantAction(action: RhythmAction) {
    if (!action.quickAction) return
    setAssistantActionId(action.id)
    try {
      if (action.quickAction === 'checkin' && action.habitId) {
        await apiRoutes.checkinHabit(action.habitId, currentDate)
        const habit = todayStats?.habits_today.find(item => item.id === action.habitId)
        if (habit) notify.checkin(habit.name)
      }
      if (action.quickAction === 'complete-task' && action.taskId) {
        await apiRoutes.completeTask(action.taskId)
      }
      await loadData()
    } catch (error) {
      console.error('Failed to run assistant action:', error)
    } finally {
      setAssistantActionId(null)
    }
  }

  async function deferAssistantTask(action: RhythmAction) {
    if (!action.taskId) return
    setAssistantActionId(action.id)
    try {
      await apiRoutes.updateTask(action.taskId, { date: nextLocalDate(currentDate) })
      await loadData()
    } catch (error) {
      console.error('Failed to defer assistant task:', error)
    } finally {
      setAssistantActionId(null)
    }
  }

  const doneCount = todayStats?.habits_today.filter(h => h.done).length || 0
  const totalHabits = todayStats?.habits_today.length || 0
  const pendingHabits = Math.max(totalHabits - doneCount, 0)
  const progressPercent = totalHabits > 0
    ? Math.round((doneCount / totalHabits) * 100)
    : 0
  const monthScore = monthStats?.months[monthStats.months.length - 1]?.score || 0
  const streakDays = streak?.streak || 0
  const todaysTasks = pendingTasks
    .filter(task => task.date === currentDate)
    .sort((first, second) => first.time.localeCompare(second.time))
  const rhythmPlan = buildRhythmPlan({
    currentDate,
    currentTime,
    habits: todayStats?.habits_today ?? [],
    pendingTasks,
    shoppingLists,
    activeBook,
    todayWorkout,
    activeWorkout,
    workoutCompletedToday,
  })
  const nextAction = rhythmPlan[0] ?? DEFAULT_RHYTHM_ACTION
  const laterActions = rhythmPlan.slice(1)
  const NextActionIcon = RHYTHM_ACTION_ICONS[nextAction.kind]
  const formattedDate = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date())
  const displayDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1)
  const headline = progressPercent === 100
    ? 'Rotina concluída. Mandou bem!'
    : doneCount > 0
      ? 'Você já colocou o dia em movimento'
      : 'Qual é o primeiro passo de hoje?'
  const supportingText = progressPercent === 100
    ? 'Tudo marcado por hoje. Aproveite a sensação de dever cumprido.'
    : totalHabits > 0
      ? `${pendingHabits} ${pendingHabits === 1 ? 'hábito pendente' : 'hábitos pendentes'} para fechar sua rotina.`
      : 'Crie um hábito simples e comece a construir seu ritmo.'

  return (
    <div className="view" data-view="today">
      <section className="hero today-hero">
        <div className="hero-copy">
          <p className="today-date">
            <CalendarDays size={16} aria-hidden="true" />
            <span>{displayDate}</span>
          </p>
          <p className="section-label">Seu ritmo agora</p>
          <h2>{headline}</h2>
          <p>{supportingText}</p>
          <div className="today-quick-actions" aria-label="Ações rápidas">
            <AppLink to="/habits" className="quick-action quick-action-primary">
              <Plus size={17} aria-hidden="true" />
              <span>Novo hábito</span>
            </AppLink>
            <AppLink to="/tasks?create=1" className="quick-action quick-action-secondary">
              <ListPlus size={17} aria-hidden="true" />
              <span>Nova tarefa</span>
            </AppLink>
          </div>
        </div>
        <div className="hero-overview">
          <article className="today-progress-card">
            <div
              className="progress-ring"
              style={{
                background: `conic-gradient(#ffffff ${progressPercent}%, rgba(255, 255, 255, 0.2) 0)`,
              }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
              aria-label={`${progressPercent}% da rotina de hoje concluída`}
            >
              <div className="progress-ring-center">
                <strong>{progressPercent}%</strong>
                <span>feito</span>
              </div>
            </div>
            <div>
              <span>Progresso de hoje</span>
              <strong>{doneCount} de {totalHabits}</strong>
              <small>{totalHabits === 0 ? 'Comece pelo primeiro hábito' : 'Cada marcação conta'}</small>
            </div>
          </article>
          <div className="hero-mini-metrics">
            <article>
              <span className="hero-metric-icon" aria-hidden="true"><TrendingUp size={17} /></span>
              <div><small>Este mês</small><strong>{monthScore}%</strong></div>
            </article>
            <article>
              <span className="hero-metric-icon" aria-hidden="true"><Flame size={17} /></span>
              <div><small>Sequência</small><strong>{streakDays} {streakDays === 1 ? 'dia' : 'dias'}</strong></div>
            </article>
          </div>
        </div>
      </section>

      <section className="today-checkin-section" aria-label="Check-in de hábitos">
        <article className="panel today-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Check-in</p>
              <h2>Hábitos de hoje</h2>
            </div>
            <AppLink to="/habits" className="panel-link">
              <span>Ver todos</span>
              <ArrowRight size={15} aria-hidden="true" />
            </AppLink>
          </div>
          <div className="today-panel-summary">
            <span><Sparkles size={15} aria-hidden="true" /> {todayStats?.checked_count || '0 de 0 feitos'}</span>
            {totalHabits > 0 && <strong>{progressPercent}%</strong>}
          </div>
          <div className="habit-list today-habit-list" id="todayHabitList">
            {todayStats?.habits_today.length === 0 ? (
              <div className="empty-state today-empty-state">
                <Circle size={22} aria-hidden="true" />
                <div>
                  <strong>Nenhum hábito para hoje</strong>
                  <span>Adicione algo simples para começar.</span>
                </div>
              </div>
            ) : (
              todayStats?.habits_today.map((habit) => (
                <article key={habit.id} className={`today-routine-item ${habit.done ? 'is-done' : ''}`}>
                  <div className="habit-details">
                    <strong>{habit.name}</strong>
                    <small>{habit.done ? 'Concluído hoje' : 'Ainda não marcado'}</small>
                  </div>
                  <span className="today-time-chip"><Clock3 size={14} aria-hidden="true" /> {habit.time}</span>
                  <button
                    className={`today-check-action ${habit.done ? 'done' : ''}`}
                    onClick={() => toggleCheckIn(habit.id, habit.done)}
                    type="button"
                    aria-label={`${habit.done ? 'Desmarcar' : 'Marcar'} ${habit.name} hoje`}
                  >
                    {habit.done ? <CheckCircle2 size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}
                    <span>{habit.done ? 'Feito' : 'Marcar'}</span>
                  </button>
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="today-assistant" aria-labelledby="today-assistant-title">
        <article className="assistant-next-card">
          <span className="assistant-icon" aria-hidden="true">
            <NextActionIcon size={22} />
          </span>
          <div className="assistant-next-copy">
            <p className="section-label" id="today-assistant-title">
              {isLoadingAssistant ? 'Organizando seu dia' : `Agora · ${nextAction.eyebrow}`}
            </p>
            <h2>{isLoadingAssistant ? 'Buscando sua próxima ação…' : nextAction.title}</h2>
            <p>{isLoadingAssistant ? 'Hábitos, tarefas, treino, leitura e compras em um só lugar.' : nextAction.detail}</p>
          </div>
          {!isLoadingAssistant && nextAction.quickAction ? (
            <div className="assistant-quick-actions">
              <button
                className="assistant-primary-action"
                type="button"
                onClick={() => void runAssistantAction(nextAction)}
                disabled={assistantActionId === nextAction.id}
              >
                <Check size={17} aria-hidden="true" />
                <span>{assistantActionId === nextAction.id ? 'Salvando…' : nextAction.label}</span>
              </button>
              {nextAction.quickAction === 'complete-task' && (
                <button
                  className="assistant-secondary-action"
                  type="button"
                  onClick={() => void deferAssistantTask(nextAction)}
                  disabled={assistantActionId === nextAction.id}
                >
                  <CalendarDays size={16} aria-hidden="true" />
                  <span>Adiar para amanhã</span>
                </button>
              )}
            </div>
          ) : !isLoadingAssistant ? (
            <AppLink to={nextAction.to} className="assistant-primary-action">
              <span>{nextAction.label}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </AppLink>
          ) : null}
        </article>

        {!isLoadingAssistant && laterActions.length > 0 && (
          <div className="assistant-trail" role="region" aria-label="Trilha viva do seu dia">
            <div className="assistant-trail-head">
              <div>
                <p className="section-label">Trilha do dia</p>
                <h2>Depois do agora</h2>
              </div>
              <span>{laterActions.length} {laterActions.length === 1 ? 'passo' : 'passos'}</span>
            </div>
            <div className="assistant-timeline">
              {laterActions.map((action, index) => {
                const ActionIcon = RHYTHM_ACTION_ICONS[action.kind]
                return (
                  <AppLink key={action.id} to={action.to} className="assistant-timeline-item">
                    <span className={`assistant-timeline-icon ${action.kind}`}><ActionIcon size={18} /></span>
                    <span>
                      <small>{index === 0 ? 'Em seguida' : 'Depois'} · {action.eyebrow}</small>
                      <strong>{action.title}</strong>
                      <em>{action.detail}</em>
                    </span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </AppLink>
                )
              })}
            </div>
          </div>
        )}
      </section>

      <section className="today-agenda-section" aria-label="Agenda de hoje">
        <article className="panel today-panel agenda-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Agenda</p>
              <h2>Próximas tarefas</h2>
            </div>
            <AppLink to="/tasks" className="panel-link">
              <span>Agenda</span>
              <ArrowRight size={15} aria-hidden="true" />
            </AppLink>
          </div>
          <div className="today-tasks">
            {todaysTasks.length === 0 ? (
              <div className="empty-state today-empty-state">
                <Check size={22} aria-hidden="true" />
                <div>
                  <strong>Agenda livre por hoje</strong>
                  <span>Nenhuma tarefa pendente.</span>
                </div>
              </div>
            ) : (
              todaysTasks.map((task) => (
                <article key={task.id} className="today-agenda-item">
                  <div>
                    <strong>{task.name}</strong>
                    <small><Clock3 size={14} aria-hidden="true" /> Hoje às {task.time}</small>
                  </div>
                  <button
                    className="today-task-action"
                    onClick={() => toggleTaskCompletion(task)}
                    type="button"
                    aria-label={`Concluir ${task.name}`}
                  >
                    <Check size={17} aria-hidden="true" />
                    <span>Concluir</span>
                  </button>
                </article>
              ))
            )}
          </div>
        </article>
      </section>
    </div>
  )
}
