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

export interface WorkoutSessionExercise {
  id: number
  exercise_id: number | null
  name: string
  target_sets: number
  planned_reps: string | null
  sort_order: number
  sets: WorkoutSessionSet[]
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
}
