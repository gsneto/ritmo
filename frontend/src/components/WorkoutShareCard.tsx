import { forwardRef } from 'react'
import { Dumbbell, Flame, Layers3, Timer, Trophy } from 'lucide-react'
import type { WorkoutHistory, WorkoutSession } from '../services/workoutSessionApi'

export interface WorkoutShareSummary {
  sessionCount: number
  completedSets: number
  totalMinutes: number
  totalVolumeKg: number
  maxWeightKg: number
  consecutiveWeeks: number
  periodLabel: string
}

function weekKey(value: string): string {
  const date = new Date(value)
  const weekday = (date.getDay() + 6) % 7
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - weekday)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function previousWeek(key: string): string {
  const date = new Date(`${key}T12:00:00`)
  date.setDate(date.getDate() - 7)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function consecutiveTrainingWeeks(sessions: WorkoutSession[]): number {
  const weeks = [...new Set(
    sessions
      .map(session => session.completed_at)
      .filter((value): value is string => Boolean(value))
      .map(weekKey),
  )].sort().reverse()
  if (weeks.length === 0) return 0

  let streak = 0
  let expected = weeks[0]
  for (const week of weeks) {
    if (week !== expected) break
    streak += 1
    expected = previousWeek(expected)
  }
  return streak
}

function formatPeriod(sessions: WorkoutSession[]): string {
  const dates = sessions
    .map(session => session.completed_at)
    .filter((value): value is string => Boolean(value))
    .map(value => new Date(value))
    .sort((left, right) => left.getTime() - right.getTime())
  if (dates.length === 0) return 'Sem período registrado'

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
  const first = formatter.format(dates[0])
  const last = formatter.format(dates[dates.length - 1])
  return first === last ? first : `${first} — ${last}`
}

export function buildWorkoutShareSummary(
  history: WorkoutHistory,
  sessionLimit: number,
): WorkoutShareSummary {
  const sessions = history.sessions.slice(0, Math.max(1, sessionLimit))
  return {
    sessionCount: sessions.length,
    completedSets: sessions.reduce((total, session) => total + session.completed_sets, 0),
    totalMinutes: Math.round(
      sessions.reduce((total, session) => total + (session.duration_seconds ?? 0), 0) / 60,
    ),
    totalVolumeKg: sessions.reduce(
      (total, session) => total + Number(session.total_volume_kg || 0),
      0,
    ),
    maxWeightKg: Math.max(
      0,
      ...sessions.map(session => Number(session.max_weight_kg || 0)),
    ),
    consecutiveWeeks: consecutiveTrainingWeeks(sessions),
    periodLabel: formatPeriod(sessions),
  }
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits })
}

interface WorkoutShareCardProps {
  summary: WorkoutShareSummary
}

const WorkoutShareCard = forwardRef<HTMLDivElement, WorkoutShareCardProps>(
  function WorkoutShareCard({ summary }, ref) {
    return (
      <div ref={ref} className="workout-share-card" aria-label="Resumo visual do treino">
        <header>
          <span><Dumbbell size={22} aria-hidden="true" /></span>
          <div>
            <small>Ritmo</small>
            <strong>Meu progresso de treino</strong>
          </div>
        </header>
        <p className="workout-share-period">{summary.periodLabel}</p>
        <div className="workout-share-metrics">
          <span>
            <Dumbbell size={17} aria-hidden="true" />
            <strong>{summary.sessionCount}</strong>
            <small>sessões</small>
          </span>
          <span>
            <Layers3 size={17} aria-hidden="true" />
            <strong>{summary.completedSets}</strong>
            <small>séries</small>
          </span>
          <span>
            <Timer size={17} aria-hidden="true" />
            <strong>{summary.totalMinutes}</strong>
            <small>minutos</small>
          </span>
          <span>
            <Flame size={17} aria-hidden="true" />
            <strong>{summary.consecutiveWeeks}</strong>
            <small>semanas em ritmo</small>
          </span>
        </div>
        <div className="workout-share-records">
          <span>
            <Trophy size={18} aria-hidden="true" />
            <small>Recorde do período</small>
            <strong>{formatNumber(summary.maxWeightKg, 2)} kg</strong>
          </span>
          <span>
            <Layers3 size={18} aria-hidden="true" />
            <small>Volume total</small>
            <strong>{formatNumber(summary.totalVolumeKg, 1)} kg</strong>
          </span>
        </div>
        <footer>Consistência antes de perfeição.</footer>
      </div>
    )
  },
)

export default WorkoutShareCard
