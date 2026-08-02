import { useState, useEffect } from 'react'
import { apiRoutes } from '../services/api'
import type {
  CrossDomainInsights,
  Habit,
  MonthStats,
  StreakStats,
  WeekStats,
} from '../services/api'

interface ProgressProps {
  userId: number
}

export default function Progress({ userId }: ProgressProps) {
  const [monthStats, setMonthStats] = useState<MonthStats | null>(null)
  const [weekStats, setWeekStats] = useState<WeekStats | null>(null)
  const [streak, setStreak] = useState<StreakStats | null>(null)
  const [totalCheckins, setTotalCheckins] = useState(0)
  const [insights, setInsights] = useState<CrossDomainInsights | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setLoadState('loading')
    void Promise.all([
      apiRoutes.getMonthStats(userId),
      apiRoutes.getWeekStats(userId),
      apiRoutes.getStreak(userId),
      apiRoutes.getHabits(userId),
      apiRoutes.getInsights(userId),
    ])
      .then(([month, week, streakData, habitsData, insightsData]) => {
        if (!active) return
        setMonthStats(month.data)
        setWeekStats(week.data)
        setStreak(streakData.data)
        setInsights(insightsData.data)
        const total = habitsData.data.reduce(
          (sum: number, h: Habit) => sum + h.check_ins.length,
          0,
        )
        setTotalCheckins(total)
        setLoadState('ready')
      })
      .catch((error: unknown) => {
        if (!active) return
        console.error('Failed to load stats:', error)
        setLoadState('error')
      })
    return () => {
      active = false
    }
  }, [loadAttempt, userId])

  if (loadState === 'loading') {
    return (
      <div className="view" data-view="progress">
        <section className="panel progress-state" role="status">
          <p>Carregando seu progresso...</p>
        </section>
      </div>
    )
  }

  if (loadState === 'error') {
    return (
      <div className="view" data-view="progress">
        <section className="panel progress-state" role="alert">
          <h2>Não foi possível carregar seu progresso</h2>
          <p>As métricas não foram exibidas porque os dados não puderam ser carregados.</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => setLoadAttempt(attempt => attempt + 1)}
          >
            Tentar novamente
          </button>
        </section>
      </div>
    )
  }

  const currentMonthScore = monthStats?.months[monthStats.months.length - 1]?.score || 0
  const streakDays = streak?.streak || 0

  return (
    <div className="view" data-view="progress">
      <section className="panel" aria-labelledby="progress-glossary-title">
        <div className="panel-head">
          <div>
            <p className="section-label">Entenda os números</p>
            <h2 id="progress-glossary-title">Glossário</h2>
          </div>
        </div>
        <dl className="history progress-glossary">
          <div className="history-card">
            <dt>Progresso e consistência</dt>
            <dd>Percentual de check-ins concluídos em relação aos hábitos planejados no período.</dd>
          </div>
          <div className="history-card">
            <dt>Sequência</dt>
            <dd>Dias seguidos com todos os hábitos planejados concluídos. Dias sem hábitos planejados são ignorados.</dd>
          </div>
          <div className="history-card">
            <dt>Check-ins</dt>
            <dd>Total de check-ins registrados em todo o histórico.</dd>
          </div>
        </dl>
      </section>
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
      {insights && insights.insights.length > 0 && (
        <section className="panel" aria-labelledby="cross-domain-insights-title">
          <div className="panel-head">
            <div>
              <p className="section-label">Padrões observados</p>
              <h2 id="cross-domain-insights-title">Conexões do seu ritmo</h2>
            </div>
          </div>
          <div className="insights-grid">
            {insights.insights.map(insight => (
              <article className="insight-card" key={insight.key}>
                <h3>{insight.title}</h3>
                <p>{insight.description}</p>
                <small>{insight.sample_size} dias ou registros analisados</small>
              </article>
            ))}
          </div>
        </section>
      )}
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
