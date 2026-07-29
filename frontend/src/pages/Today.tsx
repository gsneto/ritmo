import { useState, useEffect } from 'react'
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Flame,
  ListPlus,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { apiRoutes } from '../services/api'
import type { TodayStats, MonthStats, StreakStats, Task } from '../services/api'
import { notify } from '../hooks/useNotifications'
import { toLocalDateValue } from '../utils/date'
import { AppLink } from '../router'

interface TodayProps {
  userId: number
}

export default function Today({ userId }: TodayProps) {
  const [todayStats, setTodayStats] = useState<TodayStats | null>(null)
  const [monthStats, setMonthStats] = useState<MonthStats | null>(null)
  const [streak, setStreak] = useState<StreakStats | null>(null)
  const [todaysTasks, setTodaysTasks] = useState<Task[]>([])

  useEffect(() => {
    loadData()
  }, [userId])

  async function loadData() {
    try {
      const [today, month, streakData, tasksResponse] = await Promise.all([
        apiRoutes.getTodayStats(userId),
        apiRoutes.getMonthStats(userId),
        apiRoutes.getStreak(userId),
        apiRoutes.getTasks(userId),
      ])
      setTodayStats(today.data)
      setMonthStats(month.data)
      setStreak(streakData.data)

      // Filter today's tasks
      const todayStr = toLocalDateValue()
      const tasks = tasksResponse.data.filter(t => t.date === todayStr && !t.completed_at)
      setTodaysTasks(tasks)
    } catch (error) {
      console.error('Failed to load today data:', error)
    }
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

      <section className="content-grid today-content-grid">
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
