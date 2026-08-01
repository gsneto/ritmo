import { api } from './api'


export interface WorkoutExercise {
  id: number
  name: string
  sets: string
  reps: string
}

export interface WorkoutTemplate {
  id: number
  user_id: number
  day: string
  title: string
  note: string
  exercises: WorkoutExercise[]
}

export interface WorkoutExerciseInput {
  name: string
  sets: string
  reps: string
}

export interface WorkoutInput {
  day: string
  title: string
  note: string
  exercises: WorkoutExerciseInput[]
}

export interface WorkoutSessionSet {
  id: number
  set_number: number
  weight_kg: string | number | null
  reps_completed: number | null
  completed_at: string | null
}

export interface WorkoutExerciseSetSnapshot {
  set_number: number
  weight_kg: string | number
  reps_completed: number | null
}

export interface WorkoutExerciseEvolutionPoint {
  session_id: number
  completed_at: string
  max_weight_kg: string | number
  total_reps: number
  completed_sets: number
  target_sets: number
  total_volume_kg: string | number
}

export interface WorkoutExerciseProgress {
  exercise_name: string
  last_session_at: string | null
  last_weight_kg: string | number | null
  last_reps_completed: number | null
  last_completed_sets: number
  last_target_sets: number | null
  last_sets: WorkoutExerciseSetSnapshot[]
  personal_record_weight_kg: string | number | null
  personal_record_reps: number | null
  personal_record_volume_kg: string | number
  suggested_weight_kg: string | number | null
  suggestion_action: 'start' | 'increase' | 'maintain'
  suggestion_text: string
  rest_seconds: number
  increment_kg: string | number
  evolution: WorkoutExerciseEvolutionPoint[]
}

export interface WorkoutSessionExercise {
  id: number
  exercise_id: number | null
  name: string
  target_sets: number
  planned_reps: string | null
  sort_order: number
  sets: WorkoutSessionSet[]
  progress: WorkoutExerciseProgress | null
}

export interface WorkoutSession {
  id: number
  user_id: number
  workout_id: number | null
  workout_title: string
  workout_day: string
  status: 'active' | 'completed'
  rest_seconds: number
  started_at: string
  completed_at: string | null
  duration_seconds: number | null
  total_sets: number
  completed_sets: number
  max_weight_kg: string | number
  total_volume_kg: string | number
  exercises: WorkoutSessionExercise[]
}

export interface WorkoutHistory {
  total_sessions: number
  total_minutes: number
  completed_sets: number
  total_volume_kg: string | number
  sessions: WorkoutSession[]
  exercise_progress: WorkoutExerciseProgress[]
}

export interface WorkoutSetState {
  completed: boolean
  weight_kg?: string
  reps_completed?: number
}

export const workoutSessionApi = {
  getWorkouts: async (userId: number): Promise<WorkoutTemplate[]> => {
    const response = await api.get<WorkoutTemplate[]>(`/users/${userId}/workouts`)
    return response.data
  },

  replaceWorkouts: async (
    userId: number,
    workouts: WorkoutInput[],
  ): Promise<WorkoutTemplate[]> => {
    const response = await api.put<WorkoutTemplate[]>(
      `/users/${userId}/workouts`,
      { workouts },
    )
    return response.data
  },

  getActiveSession: async (userId: number): Promise<WorkoutSession | null> => {
    const response = await api.get<WorkoutSession | null>(
      `/users/${userId}/workout-sessions/active`,
    )
    return response.data
  },

  startSession: async (
    userId: number,
    workoutId: number,
    idempotencyKey: string,
    restSeconds = 60,
  ): Promise<WorkoutSession> => {
    const response = await api.post<WorkoutSession>(
      `/users/${userId}/workouts/${workoutId}/sessions`,
      {
        idempotency_key: idempotencyKey,
        rest_seconds: restSeconds,
      },
    )
    return response.data
  },

  setSetState: async (
    setId: number,
    state: WorkoutSetState,
  ): Promise<WorkoutSession> => {
    const response = await api.put<WorkoutSession>(
      `/workout-session-sets/${setId}`,
      state,
    )
    return response.data
  },

  finishSession: async (sessionId: number): Promise<WorkoutSession> => {
    const response = await api.post<WorkoutSession>(
      `/workout-sessions/${sessionId}/finish`,
    )
    return response.data
  },

  discardSession: async (sessionId: number): Promise<void> => {
    await api.delete(`/workout-sessions/${sessionId}`)
  },

  getHistory: async (
    userId: number,
    limit = 8,
  ): Promise<WorkoutHistory> => {
    const response = await api.get<WorkoutHistory>(
      `/users/${userId}/workout-history`,
      { params: { limit } },
    )
    return response.data
  },

  updateExercisePreference: async (
    userId: number,
    exerciseName: string,
    restSeconds: number,
    incrementKg: string,
  ): Promise<WorkoutExerciseProgress> => {
    const response = await api.put<WorkoutExerciseProgress>(
      `/users/${userId}/workout-exercise-preference`,
      {
        exercise_name: exerciseName,
        rest_seconds: restSeconds,
        increment_kg: incrementKg,
      },
    )
    return response.data
  },
}
