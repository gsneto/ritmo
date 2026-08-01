import { toLocalDateValue } from './date'

export interface StreakBadge {
  minimum: number
  label: string
  tone: 'spark' | 'steady' | 'century' | 'legacy'
}

const STREAK_BADGES: StreakBadge[] = [
  { minimum: 7, label: 'Em ritmo', tone: 'spark' },
  { minimum: 30, label: 'Constância', tone: 'steady' },
  { minimum: 100, label: 'Imparável', tone: 'century' },
  { minimum: 365, label: 'Um ano de ritmo', tone: 'legacy' },
]

export function getStreakBadge(streakCount: number): StreakBadge | null {
  return [...STREAK_BADGES]
    .reverse()
    .find(badge => streakCount >= badge.minimum) ?? null
}

function previousDay(date: Date): Date {
  const result = new Date(date)
  result.setDate(result.getDate() - 1)
  return result
}

function appWeekday(date: Date): number {
  return (date.getDay() + 6) % 7
}

export function getHabitStreak(
  checkIns: string[],
  activeDays: number[],
  today = new Date(),
): number {
  const checkedDates = new Set(checkIns)
  const scheduledDays = new Set(activeDays.length ? activeDays : [0, 1, 2, 3, 4, 5, 6])
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  while (!scheduledDays.has(appWeekday(cursor))) {
    cursor = previousDay(cursor)
  }

  // An unfinished habit scheduled for today should not lose yesterday's streak
  // before the user has had the chance to complete it.
  if (!checkedDates.has(toLocalDateValue(cursor)) && toLocalDateValue(cursor) === toLocalDateValue(today)) {
    cursor = previousDay(cursor)
    while (!scheduledDays.has(appWeekday(cursor))) {
      cursor = previousDay(cursor)
    }
  }

  let streak = 0
  while (checkedDates.has(toLocalDateValue(cursor))) {
    streak += 1
    cursor = previousDay(cursor)
    while (!scheduledDays.has(appWeekday(cursor))) {
      cursor = previousDay(cursor)
    }
  }

  return streak
}
