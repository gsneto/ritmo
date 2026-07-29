import axios from 'axios'

export const ACCESS_KEY_STORAGE_KEY = 'ritmo-access-key'
export const UNAUTHORIZED_EVENT = 'ritmo:unauthorized'

// In development, Vite proxies /api to FastAPI. Production must provide the
// complete API prefix, for example https://api.example.com/api.
const configuredBaseUrl = import.meta.env.VITE_API_URL?.trim()
const BASE_URL = configuredBaseUrl
  ? configuredBaseUrl.replace(/\/+$/, '')
  : '/api'

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export interface User {
  id: number
  profile_id: string
  name: string
  initials: string
  theme: 'light' | 'dark'
}

export interface Habit {
  id: number
  user_id: number
  name: string
  time: string
  created_at: string
  check_ins: string[]
}

export interface Task {
  id: number
  user_id: number
  name: string
  date: string
  time: string
  completed_at: string | null
  created_at: string
}

export interface Exercise {
  id: number
  name: string
  sets: string
  reps: string
}

export interface Workout {
  id: number
  user_id: number
  day: string
  title: string
  note: string
  exercises: Exercise[]
}

export interface TodayStats {
  today_progress: string
  checked_count: string
  habits_today: Array<{
    id: number
    name: string
    time: string
    done: boolean
  }>
}

export interface MonthStats {
  months: Array<{
    month: string
    score: number
  }>
}

export interface WeekStats {
  days: Array<{
    day: string
    percent: number
    done: number
    total: number
  }>
}

export interface StreakStats {
  streak: number
}

export interface WorkoutInput {
  day: string
  title: string
  note: string
  exercises: Array<{
    name: string
    sets: string
    reps: string
  }>
}

export function getAccessKey(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(ACCESS_KEY_STORAGE_KEY)?.trim() || ''
}

export function setAccessKey(value: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ACCESS_KEY_STORAGE_KEY, value.trim())
}

export function clearAccessKey(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(ACCESS_KEY_STORAGE_KEY)
}

export function isUnauthorizedError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401
}

api.interceptors.request.use((config) => {
  const accessKey = getAccessKey()
  if (accessKey) {
    config.headers.set('X-Ritmo-Key', accessKey)
  }
  return config
})

api.interceptors.response.use(
  response => response,
  (error: unknown) => {
    if (
      isUnauthorizedError(error)
      && typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    return Promise.reject(error)
  },
)

export const apiRoutes = {
  // Users
  getUsers: () => api.get<User[]>('/users'),
  getUser: (id: number) => api.get<User>(`/users/${id}`),
  updateUser: (id: number, data: Partial<Pick<User, 'name' | 'initials' | 'theme'>>) =>
    api.put<User>(`/users/${id}`, data),
  updateTheme: (id: number, theme: User['theme']) =>
    api.put<User>(`/users/${id}/theme`, { theme }),
  resetUserData: (id: number) => api.delete(`/users/${id}/data`),

  // Habits
  getHabits: (userId: number) => api.get<Habit[]>(`/users/${userId}/habits`),
  createHabit: (userId: number, data: { name: string; time: string }) =>
    api.post<Habit>(`/users/${userId}/habits`, data),
  updateHabit: (habitId: number, data: { name?: string; time?: string }) =>
    api.put<Habit>(`/habits/${habitId}`, data),
  deleteHabit: (habitId: number) => api.delete(`/habits/${habitId}`),
  checkinHabit: (habitId: number, date: string) =>
    api.post<Habit>(`/habits/${habitId}/checkin`, { date }),
  removeCheckin: (habitId: number, date: string) =>
    api.delete(`/habits/${habitId}/checkin/${date}`),

  // Tasks
  getTasks: (userId: number) => api.get<Task[]>(`/users/${userId}/tasks`),
  createTask: (userId: number, data: { name: string; date: string; time: string }) =>
    api.post<Task>(`/users/${userId}/tasks`, data),
  updateTask: (taskId: number, data: { name?: string; date?: string; time?: string }) =>
    api.put<Task>(`/tasks/${taskId}`, data),
  deleteTask: (taskId: number) => api.delete(`/tasks/${taskId}`),
  completeTask: (taskId: number) => api.post<Task>(`/tasks/${taskId}/complete`),

  // Workouts
  getWorkouts: (userId: number) => api.get<Workout[]>(`/users/${userId}/workouts`),
  updateWorkouts: (userId: number, workouts: WorkoutInput[]) =>
    api.put<Workout[]>(`/users/${userId}/workouts`, { workouts }),

  // Stats
  getTodayStats: (userId: number) => api.get<TodayStats>(`/users/${userId}/stats/today`),
  getMonthStats: (userId: number) => api.get<MonthStats>(`/users/${userId}/stats/monthly`),
  getWeekStats: (userId: number) => api.get<WeekStats>(`/users/${userId}/stats/week`),
  getStreak: (userId: number) => api.get<StreakStats>(`/users/${userId}/stats/streak`),
}

export { api }
