import { useState, useEffect } from 'react'
import { apiRoutes } from '../services/api'
import type { MonthStats, WeekStats, StreakStats, Habit } from '../services/api'

interface ProgressProps {
  userId: number
}

export default function Progress({ userId }: ProgressProps) {
  const [monthStats, setMonthStats] = useState<MonthStats | null>(null)
  const [weekStats, setWeekStats] = useState<WeekStats | null>(null)
  const [streak, setStreak] = useState<StreakStats | null>(null)
  const [totalCheckins, setTotalCheckins] = useState(0)

  useEffect(() => {
    loadData()
  }, [userId])

  async function loadData() {
    try {
      const [month, week, streakData, habitsData] = await Promise.all([
        apiRoutes.getMonthStats(userId),
        apiRoutes.getWeekStats(userId),
        apiRoutes.getStreak(userId),
        apiRoutes.getHabits(userId),
      ])
      setMonthStats(month.data)
      setWeekStats(week.data)
      setStreak(streakData.data)
      const total = habitsData.data.reduce((sum: number, h: Habit) => sum + h.check_ins.length, 0)
      setTotalCheckins(total)
    } catch (error) {
      console.error('Failed to load stats:', error)
    }
  }

  const currentMonthScore = monthStats?.months[monthStats.months.length - 1]?.score || 0
  const streakDays = streak?.streak || 0

  return (
    <div className="view" data-view="progress">
      <section className="content-grid evolution-grid">
        <article className="panel">
          <div className="panel-head"><div><p className="section-label">Mensal</p><h2>Consistência</h2></div></div>
          <div className="chart">
            {monthStats?.months.map((month, idx) => (
              <div key={idx} className="bar-row">
                <span>{month.month}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${month.score}%` }}></div>
                </div>
                <strong>{month.score}%</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <div className="panel-head"><div><p className="section-label">Semana</p><h2>Últimos dias</h2></div></div>
          <div className="week-history">
            {weekStats?.days.map((day, idx) => (
              <article key={idx} className="day-history">
                <span>{day.day}</span>
                <strong>{day.percent}%</strong>
                <small>{day.done}/{day.total}</small>
              </article>
            ))}
          </div>
        </article>
      </section>
      <section className="panel">
        <div className="panel-head"><div><p className="section-label">Resumo</p><h2>Sua evolução</h2></div></div>
        <div className="history">
          <article className="history-card">
            <p className="tiny-note">Consistência do mês</p>
            <strong>{currentMonthScore}%</strong>
          </article>
          <article className="history-card">
            <p className="tiny-note">Sequência atual</p>
            <strong>{streakDays} {streakDays === 1 ? 'dia' : 'dias'}</strong>
          </article>
          <article className="history-card">
            <p className="tiny-note">Check-ins registrados</p>
            <strong>{totalCheckins}</strong>
          </article>
        </div>
      </section>
    </div>
  )
}
