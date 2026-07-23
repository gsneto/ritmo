import { useState, useEffect } from 'react'
import { apiRoutes, TodayStats, MonthStats, StreakStats, Task } from '../services/api'
import { notify } from '../hooks/useNotifications'
import { Check, Trash2 } from 'lucide-react'

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
      const todayStr = new Date().toISOString().split('T')[0]
      const tasks = tasksResponse.data.filter(t => t.date === todayStr && !t.completed_at)
      setTodaysTasks(tasks)
    } catch (error) {
      console.error('Failed to load today data:', error)
    }
  }

  async function toggleCheckIn(habitId: number, done: boolean) {
    const today = new Date().toISOString().split('T')[0]
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

  async function deleteTask(taskId: number) {
    if (!confirm('Remover a tarefa?')) return
    try {
      await apiRoutes.deleteTask(taskId)
      loadData()
    } catch (error) {
      console.error('Failed to delete task:', error)
    }
  }

  function formatTime(time: string): string {
    return time
  }

  const doneCount = todayStats?.habits_today.filter(h => h.done).length || 0
  const totalCount = todayStats?.habits_today.length || 0
  const monthScore = monthStats?.months[monthStats.months.length - 1]?.score || 0

  return (
    <div className="view" data-view="today">
      <section className="hero">
        <div className="hero-copy">
          <p className="section-label">Resumo de hoje</p>
          <h2>{doneCount > 0 ? 'Você já começou bem hoje' : 'Comece com um check-in'}</h2>
          <p>{doneCount > 0 ? 'Cada check-in fica registrado no seu histórico.' : 'Marque o primeiro hábito do seu dia.'}</p>
        </div>
        <div className="hero-metrics">
          <article className="metric">
            <span>Hoje</span>
            <strong>{todayStats?.today_progress || '0%'}</strong>
          </article>
          <article className="metric">
            <span>Este mês</span>
            <strong>{monthScore}%</strong>
          </article>
          <article className="metric">
            <span>Sequência</span>
            <strong>{streak?.streak || 0} dias</strong>
          </article>
        </div>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-head">
            <div><p className="section-label">Check-in</p><h2>Hoje</h2></div>
            <span className="tiny-note">{todayStats?.checked_count || '0 de 0 feitos'}</span>
          </div>
          <div className="habit-list" id="todayHabitList">
            {todayStats?.habits_today.length === 0 ? (
              <p className="empty-state">Nenhum hábito ativo.</p>
            ) : (
              todayStats?.habits_today.map((habit) => (
                <article key={habit.id} className="habit-item">
                  <div className="habit-details">
                    <strong>{habit.name}</strong>
                    <small>
                      {habit.time}
                      {habit.done && ' · feito hoje'}
                    </small>
                  </div>
                  <div className="item-actions">
                    <button
                      className={`check-button ${habit.done ? 'done' : ''}`}
                      onClick={() => toggleCheckIn(habit.id, habit.done)}
                      type="button"
                    >
                      {habit.done ? 'Feito' : 'Marcar'}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div><p className="section-label">Agenda</p><h2>Para hoje</h2></div>
          </div>
          <div className="today-tasks">
            {todaysTasks.length === 0 ? (
              <p className="empty-state">Nenhuma tarefa para hoje.</p>
            ) : (
              todaysTasks.map((task) => (
                <article key={task.id} className="today-task">
                  <div>
                    <strong>{task.name}</strong>
                    <small>{formatTime(task.time)}</small>
                  </div>
                  <div className="item-actions">
                    <button
                      className="check-button"
                      onClick={() => toggleTaskCompletion(task)}
                      type="button"
                    >
                      Concluir
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </article>
      </section>
    </div>
  )
}
