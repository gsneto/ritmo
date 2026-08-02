import { useEffect } from 'react'
import {
  apiRoutes,
  REMINDERS_CHANGED_EVENT,
  type Habit,
  type ShoppingList,
  type Task,
} from '../services/api'
import { toLocalDateValue } from '../utils/date'
import { notify } from './useNotifications'
import {
  subscriptionVapidKeyMatch,
  VAPID_PUBLIC_KEY_STORAGE_KEY,
} from './usePushNotifications'

const MAX_DELAY_MS = 36 * 60 * 60 * 1000
const MAX_PAST_DUE_MS = 10 * 60 * 1000

function weekdayFor(date: Date): number {
  return (date.getDay() + 6) % 7
}

function wasReminded(key: string): boolean {
  return window.localStorage.getItem(`ritmo-reminder:${key}`) === '1'
}

function markReminded(key: string): void {
  window.localStorage.setItem(`ritmo-reminder:${key}`, '1')
}

function schedule(
  timers: number[],
  key: string,
  when: Date,
  title: string,
  body: string,
  url: string,
) {
  if (wasReminded(key)) return
  const now = Date.now()
  const due = when.getTime()
  if (due - now > MAX_DELAY_MS) return
  if (now - due > MAX_PAST_DUE_MS) return
  if (toLocalDateValue(when) < toLocalDateValue(new Date())) return

  const delay = Math.max(2_000, due - now)
  timers.push(window.setTimeout(() => {
    void (async () => {
      const callbackNow = new Date()
      const callbackDelay = callbackNow.getTime() - due
      if (callbackDelay > MAX_PAST_DUE_MS) return
      if (toLocalDateValue(when) < toLocalDateValue(callbackNow)) return
      if (wasReminded(key) || Notification.permission !== 'granted') return
      try {
        const shown = await notify.reminder(title, body, url, key)
        if (shown) markReminded(key)
      } catch {
        // A later refresh may schedule another attempt if displaying failed.
      }
    })()
  }, delay))
}

function scheduleHabit(
  timers: number[],
  habit: Habit,
  today: string,
  now: Date,
) {
  const days = habit.active_days?.length ? habit.active_days : [0, 1, 2, 3, 4, 5, 6]
  if (!days.includes(weekdayFor(now)) || habit.check_ins.includes(today)) return
  schedule(
    timers,
    `habit-${habit.id}-${today}`,
    new Date(`${today}T${habit.time}:00`),
    'Hora do seu hábito',
    habit.name,
    `/habits`,
  )
}

function scheduleTask(timers: number[], task: Task) {
  if (task.completed_at) return
  schedule(
    timers,
    `task-${task.id}-${task.date}`,
    new Date(`${task.date}T${task.time || '09:00'}:00`),
    'Tarefa planejada',
    task.name,
    '/tasks',
  )
}

function scheduleShopping(timers: number[], list: ShoppingList) {
  if (list.completed_at) return
  schedule(
    timers,
    `shopping-${list.id}-${list.planned_date}`,
    new Date(`${list.planned_date}T08:00:00`),
    'Compra planejada',
    `${list.name} está na sua agenda.`,
    '/shopping',
  )
}

async function hasActiveBackgroundPush(userId: number): Promise<boolean> {
  if (
    typeof window === 'undefined'
    || !('serviceWorker' in navigator)
    || !('PushManager' in window)
  ) return false

  try {
    const config = await apiRoutes.getPushConfig(userId)
    if (
      !config.data.enabled
      || !config.data.public_key
      || config.data.delivery_status !== 'ready'
    ) return false
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return false
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return false
    const keyMatch = subscriptionVapidKeyMatch(
      subscription,
      config.data.public_key,
      window.localStorage.getItem(VAPID_PUBLIC_KEY_STORAGE_KEY),
    )
    if (keyMatch === 'mismatch') return false
    const status = await apiRoutes.getPushSubscriptionStatus(
      userId,
      subscription.endpoint,
    )
    const active = status.data.active && !status.data.linked_to_other_profile
    if (active && keyMatch === 'unknown') {
      window.localStorage.setItem(
        VAPID_PUBLIC_KEY_STORAGE_KEY,
        config.data.public_key,
      )
    }
    return active
  } catch {
    return false
  }
}

export function useDailyReminders(userId: number | null) {
  useEffect(() => {
    if (!userId || typeof Notification === 'undefined') return

    const timers: number[] = []
    let cancelled = false
    let refreshVersion = 0

    async function refresh() {
      const version = ++refreshVersion
      timers.splice(0).forEach(timer => window.clearTimeout(timer))
      if (Notification.permission !== 'granted') return

      try {
        const [habits, tasks, shopping, backgroundPushActive] = await Promise.all([
          apiRoutes.getHabits(userId as number),
          apiRoutes.getTasks(userId as number),
          apiRoutes.getShoppingLists(userId as number),
          hasActiveBackgroundPush(userId as number),
        ])
        if (cancelled || version !== refreshVersion) return
        if (backgroundPushActive) return

        const now = new Date()
        const today = toLocalDateValue(now)
        habits.data.forEach(habit => scheduleHabit(timers, habit, today, now))
        tasks.data.forEach(task => scheduleTask(timers, task))
        shopping.data.forEach(list => scheduleShopping(timers, list))
      } catch {
        // Keep the next scheduled refresh available after a transient API error.
      }
    }

    void refresh()
    const refreshTimer = window.setInterval(() => void refresh(), 15 * 60 * 1000)
    const handleDataChange = () => void refresh()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener(REMINDERS_CHANGED_EVENT, handleDataChange)
    window.addEventListener('focus', handleDataChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      window.clearInterval(refreshTimer)
      window.removeEventListener(REMINDERS_CHANGED_EVENT, handleDataChange)
      window.removeEventListener('focus', handleDataChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      timers.forEach(timer => window.clearTimeout(timer))
    }
  }, [userId])
}
