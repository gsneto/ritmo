import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { WorkoutHistory, WorkoutSession } from '../services/workoutSessionApi'
import WorkoutShareCard, { buildWorkoutShareSummary } from './WorkoutShareCard'

function completedSession(
  id: number,
  completedAt: string,
  maxWeight: number,
): WorkoutSession {
  return {
    id,
    user_id: 1,
    workout_id: 2,
    workout_title: 'Treino em casa',
    workout_day: 'Seg',
    status: 'completed',
    rest_seconds: 60,
    started_at: completedAt,
    completed_at: completedAt,
    duration_seconds: 1_800,
    total_sets: 4,
    completed_sets: 4,
    max_weight_kg: maxWeight,
    total_volume_kg: 400,
    exercises: [],
  }
}

describe('WorkoutShareCard', () => {
  it('summarizes the selected sessions and consecutive training weeks', () => {
    const history: WorkoutHistory = {
      total_sessions: 3,
      total_minutes: 90,
      completed_sets: 12,
      total_volume_kg: 1_200,
      sessions: [
        completedSession(3, '2026-07-27T10:00:00-03:00', 12),
        completedSession(2, '2026-07-20T10:00:00-03:00', 10),
        completedSession(1, '2026-07-06T10:00:00-03:00', 8),
      ],
      exercise_progress: [],
    }

    const summary = buildWorkoutShareSummary(history, 2)
    expect(summary).toMatchObject({
      sessionCount: 2,
      completedSets: 8,
      totalMinutes: 60,
      totalVolumeKg: 800,
      maxWeightKg: 12,
      consecutiveWeeks: 2,
    })

    render(<WorkoutShareCard summary={summary} />)
    expect(screen.getByLabelText('Resumo visual do treino')).toBeTruthy()
    expect(screen.getByText('Recorde do período')).toBeTruthy()
    expect(screen.getByText('12 kg')).toBeTruthy()
  })
})
