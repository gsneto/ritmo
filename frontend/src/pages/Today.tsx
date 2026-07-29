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

interface TodayProps {
  userId: number
}

const WORKOUT_DAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(`${value}T12:00:00`))
}

export default function Today({ userId }: TodayProps) {
  const [todayStats, setTodayStats] = useState<TodayStats | null>(null)
  const [monthStats, setMonthStats] = useState<MonthStats | null>(null)
  const [streak, setStreak] = useState<StreakStats | null>(null)
  const [todaysTasks, setTodaysTasks] = useState<Task[]>([])
  const [nextShopping, setNextShopping] = useState<ShoppingList | null>(null)
  const [activeBook, setActiveBook] = useState<ReadingBook | null>(null)
  const [todayWorkout, setTodayWorkout] = useState<WorkoutTemplate | null>(null)
  const [activeWorkout, setActiveWorkout] = useState<WorkoutSession | null>(null)
  const [isLoadingAssistant, setIsLoadingAssistant] = useState(true)

  useEffect(() => {
    loadData()
  }, [userId])

  async function loadData() {
    setIsLoadingAssistant(true)
    setTodayStats(null)
    setMonthStats(null)
    setStreak(null)
    setTodaysTasks([])
    setNextShopping(null)
    setActiveBook(null)
    setTodayWorkout(null)
    setActiveWorkout(null)
    const results = await Promise.allSettled([
        apiRoutes.getTodayStats(userId),
        apiRoutes.getMonthStats(userId),
        apiRoutes.getStreak(userId),
        apiRoutes.getTasks(userId),
        apiRoutes.getShoppingLists(userId),
        readingApi.getActiveBook(userId),
        workoutSessionApi.getWorkouts(userId),
        workoutSessionApi.getActiveSession(userId),
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
    ] = results
    const todayStr = toLocalDateValue()

    if (todayResult.status === 'fulfilled') setTodayStats(todayResult.value.data)
    if (monthResult.status === 'fulfilled') setMonthStats(monthResult.value.data)
    if (streakResult.status === 'fulfilled') setStreak(streakResult.value.data)
    if (tasksResult.status === 'fulfilled') {
      setTodaysTasks(
        tasksResult.value.data
          .filter(task => task.date === todayStr && !task.completed_at)
          .sort((first, second) => first.time.localeCompare(second.time)),
      )
    }
    if (shoppingResult.status === 'fulfilled') {
      const upcoming = [...shoppingResult.value.data]
        .sort((first, second) => first.planned_date.localeCompare(second.planned_date))[0]
      setNextShopping(upcoming || null)
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

    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length > 0) {
      console.error('Some today assistant data could not be loaded:', failures)
    }
    setIsLoadingAssistant(false)
  }

  async function toggleCheckIn(habitId: number, done: boolean) {
    const today = toLocalDateValue()
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
      loadData()
    } catch (error) {
      console.error('Failed to toggle check-in:', error)
    }
  }

  async function toggleTaskCompletion(task: Task) {
    try {
      await apiRoutes.completeTask(task.id)
      loadData()
    } catch (error) {
      console.error('Failed to toggle task:', error)
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
  const currentTime = new Date().toTimeString().slice(0, 5)
  const overdueTask = todaysTasks.find(task => task.time <= currentTime)
  const nextTask = todaysTasks.find(task => task.time > currentTime)
  const pendingHabit = todayStats?.habits_today
    .filter(habit => !habit.done)
    .sort((first, second) => first.time.localeCompare(second.time))[0]
  const nextAction = activeWorkout
    ? {
        eyebrow: 'Treino em andamento',
        title: `Continue ${activeWorkout.workout_title}`,
        detail: `${activeWorkout.completed_sets} de ${activeWorkout.total_sets} séries concluídas.`,
        to: '/habits?workout=1',
        label: 'Retomar treino',
        icon: Dumbbell,
      }
    : overdueTask
      ? {
          eyebrow: 'Prioridade agora',
          title: overdueTask.name,
          detail: `Estava planejada para ${overdueTask.time}. Resolva ou reorganize.`,
          to: '/tasks',
          label: 'Abrir tarefas',
          icon: Target,
        }
      : pendingHabit && (!nextTask || pendingHabit.time <= nextTask.time)
        ? {
            eyebrow: 'Próximo passo',
            title: pendingHabit.name,
            detail: `Seu check-in está previsto para ${pendingHabit.time}.`,
            to: '/habits',
            label: 'Abrir hábitos',
            icon: Zap,
          }
        : nextTask
          ? {
              eyebrow: 'A seguir',
              title: nextTask.name,
              detail: `Planejada para hoje às ${nextTask.time}.`,
              to: '/tasks',
              label: 'Ver agenda',
              icon: Clock3,
            }
          : nextShopping && nextShopping.planned_date <= toLocalDateValue()
            ? {
                eyebrow: 'Compra planejada',
                title: nextShopping.name,
                detail: `${nextShopping.items.length} itens esperando por você.`,
                to: '/shopping',
                label: 'Abrir lista',
                icon: ShoppingBasket,
              }
            : todayWorkout && todayWorkout.exercises.length > 0
              ? {
                  eyebrow: 'Treino de hoje',
                  title: todayWorkout.title,
                  detail: `${todayWorkout.exercises.length} exercícios no seu plano de casa.`,
                  to: '/habits?workout=1',
                  label: 'Iniciar treino',
                  icon: Dumbbell,
                }
              : activeBook
                ? {
                    eyebrow: 'Momento de foco',
                    title: `Continue “${activeBook.title}”`,
                    detail: `Página ${activeBook.current_page} de ${activeBook.total_pages} · ${activeBook.progress_percent}% concluído.`,
                    to: '/focus',
                    label: 'Continuar leitura',
                    icon: BookOpen,
                  }
                : {
                    eyebrow: 'Dia organizado',
                    title: 'Você está em dia',
                    detail: 'Use este espaço para escolher uma próxima ação leve.',
                    to: '/tasks?create=1',
                    label: 'Planejar algo',
                    icon: Sparkles,
                  }
  const NextActionIcon = nextAction.icon
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
              {isLoadingAssistant ? 'Organizando seu dia' : nextAction.eyebrow}
            </p>
            <h2>{isLoadingAssistant ? 'Buscando sua próxima ação…' : nextAction.title}</h2>
            <p>{isLoadingAssistant ? 'Hábitos, tarefas, treino, leitura e compras em um só lugar.' : nextAction.detail}</p>
          </div>
          {!isLoadingAssistant && (
            <AppLink to={nextAction.to} className="assistant-primary-action">
              <span>{nextAction.label}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </AppLink>
          )}
        </article>

        <div className="assistant-timeline" aria-label="Visão do seu dia">
          <AppLink to="/tasks" className="assistant-timeline-item">
            <span className="assistant-timeline-icon task"><Clock3 size={18} /></span>
            <span>
              <small>Agenda</small>
              <strong>
                {todaysTasks.length > 0
                  ? `${todaysTasks.length} ${todaysTasks.length === 1 ? 'tarefa pendente' : 'tarefas pendentes'}`
                  : 'Nenhuma pendência hoje'}
              </strong>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </AppLink>
          <AppLink to="/shopping" className="assistant-timeline-item">
            <span className="assistant-timeline-icon shopping"><ShoppingBasket size={18} /></span>
            <span>
              <small>Próxima compra</small>
              <strong>
                {nextShopping
                  ? `${nextShopping.name} · ${formatShortDate(nextShopping.planned_date)}`
                  : 'Nenhuma compra planejada'}
              </strong>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </AppLink>
          <AppLink to="/habits?workout=1" className="assistant-timeline-item">
            <span className="assistant-timeline-icon workout"><Dumbbell size={18} /></span>
            <span>
              <small>Treino</small>
              <strong>
                {activeWorkout
                  ? `${activeWorkout.workout_title} em andamento`
                  : todayWorkout?.title || 'Descanso planejado'}
              </strong>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </AppLink>
          <AppLink to="/focus" className="assistant-timeline-item">
            <span className="assistant-timeline-icon reading"><BookOpen size={18} /></span>
            <span>
              <small>Leitura</small>
              <strong>
                {activeBook
                  ? `${activeBook.title} · ${activeBook.progress_percent}%`
                  : 'Escolha seu próximo livro'}
              </strong>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </AppLink>
        </div>
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
