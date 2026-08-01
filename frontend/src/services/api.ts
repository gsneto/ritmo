import axios from 'axios'

export const ACCESS_KEY_STORAGE_KEY = 'ritmo-access-key'
export const UNAUTHORIZED_EVENT = 'ritmo:unauthorized'
export const REMINDERS_CHANGED_EVENT = 'ritmo:reminders-changed'

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
  active_days: number[]
  created_at: string
  check_ins: string[]
}

export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface Task {
  id: number
  user_id: number
  name: string
  date: string
  time: string
  completed_at: string | null
  recurrence: TaskRecurrence
  recurrence_interval: number
  recurrence_parent_id: number | null
  created_at: string
}

export type ShoppingKind = 'monthly' | 'weekly' | 'one_time'
export type ShoppingCategory =
  | 'groceries'
  | 'child'
  | 'home'
  | 'personal'
  | 'health'
  | 'transport'
  | 'other'

export interface ShoppingItem {
  id: number
  shopping_list_id: number
  name: string
  quantity: number
  checked_at: string | null
  unit_price_cents: number | null
  price_cents: number | null
  created_at: string
}

export interface ShoppingList {
  id: number
  user_id: number
  name: string
  kind: ShoppingKind
  category: ShoppingCategory
  planned_date: string
  budget_cents: number | null
  repeat_enabled: boolean
  next_list_id: number | null
  completed_on: string | null
  completed_at: string | null
  total_cents: number
  created_at: string
  items: ShoppingItem[]
}

export interface MonthlyExpenseSummary {
  month: string
  total_cents: number
  purchase_count: number
  average_cents: number
  budget_cents: number
  planned_lists_cents: number
  planned_cents: number
  balance_cents: number
  previous_month_total_cents: number
  change_cents: number
  change_percent: number | null
  category_totals: Array<{
    category: ShoppingCategory
    total_cents: number
  }>
  lists: ShoppingList[]
}

export interface ShoppingPriceHistoryEntry {
  item_id: number
  list_id: number
  list_name: string
  item_name: string
  quantity: number
  unit_price_cents: number
  total_cents: number
  purchased_on: string
}

export interface ShoppingPriceHistory {
  item_name: string
  entries: ShoppingPriceHistoryEntry[]
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

export interface RitmoBackup {
  version: 1
  app: 'Ritmo'
  exported_at: string
  profile: {
    name: string
    initials: string
    theme: 'light' | 'dark'
  }
  habits: unknown[]
  tasks: unknown[]
  shopping_lists: unknown[]
  shopping_budgets: unknown[]
  workouts: unknown[]
  workout_sessions: unknown[]
  workout_preferences: unknown[]
  reading_books: unknown[]
}

export interface BackupRestoreResponse {
  message: string
  restored: Record<string, number>
}

export interface PushConfig {
  enabled: boolean
  public_key: string | null
}

export interface BriefingSettings {
  enabled: boolean
  time: string
}

export interface PushSubscriptionStatus {
  active: boolean
  linked_to_other_profile: boolean
}

export interface PushTestResult {
  sent: number
  failed: number
  expired: number
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
  response => {
    const method = response.config.method?.toLowerCase()
    if (
      typeof window !== 'undefined'
      && method
      && ['post', 'put', 'patch', 'delete'].includes(method)
    ) {
      window.dispatchEvent(new Event(REMINDERS_CHANGED_EVENT))
    }
    return response
  },
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
  getUserBackup: (id: number) =>
    api.get<RitmoBackup>(`/users/${id}/backup`),
  getCalendarExport: (id: number) =>
    api.get<Blob>(`/users/${id}/export/calendar.ics`, { responseType: 'blob' }),
  restoreUserBackup: (id: number, backup: RitmoBackup) =>
    api.put<BackupRestoreResponse>(`/users/${id}/backup`, backup),
  getPushConfig: (id: number) =>
    api.get<PushConfig>(`/users/${id}/push-config`),
  getBriefingSettings: (id: number) =>
    api.get<BriefingSettings>(`/users/${id}/briefing-settings`),
  updateBriefingSettings: (id: number, settings: BriefingSettings) =>
    api.put<BriefingSettings>(`/users/${id}/briefing-settings`, settings),
  getPushSubscriptionStatus: (id: number, endpoint: string) =>
    api.post<PushSubscriptionStatus>(
      `/users/${id}/push-subscription/status`,
      { endpoint },
    ),
  savePushSubscription: (
    id: number,
    subscription: PushSubscriptionJSON,
    transfer = false,
  ) =>
    api.put<{ subscribed: boolean }>(
      `/users/${id}/push-subscription`,
      { ...subscription, transfer },
    ),
  deletePushSubscription: (id: number, endpoint: string) =>
    api.delete<{ subscribed: boolean }>(
      `/users/${id}/push-subscription`,
      { data: { endpoint } },
    ),
  sendPushTest: (id: number) =>
    api.post<PushTestResult>(`/users/${id}/push-test`),

  // Habits
  getHabits: (userId: number) => api.get<Habit[]>(`/users/${userId}/habits`),
  createHabit: (
    userId: number,
    data: { name: string; time: string; active_days?: number[] },
  ) =>
    api.post<Habit>(`/users/${userId}/habits`, data),
  updateHabit: (
    habitId: number,
    data: { name?: string; time?: string; active_days?: number[] },
  ) =>
    api.put<Habit>(`/habits/${habitId}`, data),
  deleteHabit: (habitId: number) => api.delete(`/habits/${habitId}`),
  checkinHabit: (habitId: number, date: string) =>
    api.post<Habit>(`/habits/${habitId}/checkin`, { date }),
  removeCheckin: (habitId: number, date: string) =>
    api.delete(`/habits/${habitId}/checkin/${date}`),

  // Tasks
  getTasks: (userId: number) => api.get<Task[]>(`/users/${userId}/tasks`),
  createTask: (
    userId: number,
    data: {
      name: string
      date: string
      time: string
      recurrence?: TaskRecurrence
      recurrence_interval?: number
    },
  ) =>
    api.post<Task>(`/users/${userId}/tasks`, data),
  updateTask: (
    taskId: number,
    data: {
      name?: string
      date?: string
      time?: string
      recurrence?: TaskRecurrence
      recurrence_interval?: number
    },
  ) =>
    api.put<Task>(`/tasks/${taskId}`, data),
  deleteTask: (taskId: number) => api.delete(`/tasks/${taskId}`),
  completeTask: (taskId: number) => api.post<Task>(`/tasks/${taskId}/complete`),

  // Shopping and expenses
  getShoppingLists: (userId: number, completed = false) =>
    api.get<ShoppingList[]>(`/users/${userId}/shopping-lists`, {
      params: { completed },
    }),
  createShoppingList: (
    userId: number,
    data: {
      name: string
      kind: ShoppingKind
      category: ShoppingCategory
      planned_date: string
      budget_cents?: number | null
      repeat_enabled?: boolean
    },
  ) => api.post<ShoppingList>(`/users/${userId}/shopping-lists`, data),
  updateShoppingList: (
    listId: number,
    data: {
      name?: string
      kind?: ShoppingKind
      category?: ShoppingCategory
      planned_date?: string
      budget_cents?: number | null
      repeat_enabled?: boolean
    },
  ) => api.put<ShoppingList>(`/shopping-lists/${listId}`, data),
  deleteShoppingList: (listId: number) =>
    api.delete(`/shopping-lists/${listId}`),
  addShoppingItem: (listId: number, name: string, quantity = 1) =>
    api.post<ShoppingItem>(`/shopping-lists/${listId}/items`, {
      name,
      quantity,
    }),
  updateShoppingItem: (
    itemId: number,
    data: { name?: string; quantity?: number },
  ) =>
    api.put<ShoppingItem>(`/shopping-items/${itemId}`, data),
  checkShoppingItem: (
    itemId: number,
    data: {
      checked: boolean
      quantity?: number
      unit_price_cents?: number
      price_cents?: number
    },
  ) => api.put<ShoppingItem>(`/shopping-items/${itemId}/check`, data),
  deleteShoppingItem: (itemId: number) =>
    api.delete(`/shopping-items/${itemId}`),
  finishShoppingList: (listId: number) =>
    api.post<ShoppingList>(`/shopping-lists/${listId}/finish`),
  reopenShoppingList: (listId: number) =>
    api.post<ShoppingList>(`/shopping-lists/${listId}/reopen`),
  getShoppingHistory: (userId: number, month: string) =>
    api.get<MonthlyExpenseSummary>(`/users/${userId}/shopping-history`, {
      params: { month },
    }),
  setShoppingBudget: (userId: number, month: string, budgetCents: number) =>
    api.put<{ month: string; budget_cents: number }>(
      `/users/${userId}/shopping-budgets/${month}`,
      { budget_cents: budgetCents },
    ),
  getShoppingPriceHistory: (
    userId: number,
    itemName: string,
    limit = 12,
  ) =>
    api.get<ShoppingPriceHistory>(`/users/${userId}/shopping-price-history`, {
      params: { item_name: itemName, limit },
    }),

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
