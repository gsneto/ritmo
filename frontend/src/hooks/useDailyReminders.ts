import { useEffect } from 'react'
import { apiRoutes, type Habit, type ShoppingList, type Task } from '../services/api'
import { toLocalDateValue } from '../utils/date'
import { notify } from './useNotifications'

const MAX_DELAY_MS = 36 * 60 * 60 * 1000

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
  if (toLocalDateValue(when) < toLocalDateValue(new Date())) return

  const delay = Math.max(2_000, due - now)
  timers.push(window.setTimeout(() => {
    if (Notification.permission !== 'granted') return
    notify.reminder(title, body, url, key)
    markReminded(key)
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

export function useDailyReminders(userId: number | null) {
  useEffect(() => {
    if (!userId || typeof Notification === 'undefined') return

    const timers: number[] = []
    let cancelled = false

    async function refresh() {
      timers.splice(0).forEach(timer => window.clearTimeout(timer))
      if (Notification.permission !== 'granted') return

      try {
        const [habits, tasks, shopping] = await Promise.all([
          apiRoutes.getHabits(userId as number),
          apiRoutes.getTasks(userId as number),
          apiRoutes.getShoppingLists(userId as number),
        ])
        if (cancelled) return

        const now = new Date()
        const today = toLocalDateValue(now)
        habits.data.forEach(habit => scheduleHabit(timers, habit, today, now))
        tasks.data.forEach(task => scheduleTask(timers, task))
        shopping.data.forEach(list => scheduleShopping(timers, list))
      } catch (error) {
        console.warn('Não foi possível preparar os lembretes do dia:', error)
      }
    }

    void refresh()
    const refreshTimer = window.setInterval(() => void refresh(), 15 * 60 * 1000)

    return () => {
      cancelled = true
      window.clearInterval(refreshTimer)
      timers.forEach(timer => window.clearTimeout(timer))
    }
  }, [userId])
}
