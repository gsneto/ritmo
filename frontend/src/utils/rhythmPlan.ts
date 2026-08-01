import type { ReadingBook } from '../services/readingApi'
import type { ShoppingList, Task, TodayStats } from '../services/api'
import type { WorkoutSession, WorkoutTemplate } from '../services/workoutSessionApi'

export type RhythmActionKind =
  | 'workout'
  | 'task'
  | 'habit'
  | 'shopping'
  | 'reading'
  | 'plan'

export type RhythmQuickAction = 'checkin' | 'complete-task'

export interface RhythmAction {
  id: string
  kind: RhythmActionKind
  eyebrow: string
  title: string
  detail: string
  to: string
  label: string
  taskId?: number
  habitId?: number
  quickAction?: RhythmQuickAction
}

interface RhythmPlanInput {
  currentDate: string
  currentTime: string
  habits: TodayStats['habits_today']
  pendingTasks: Task[]
  shoppingLists: ShoppingList[]
  activeBook: ReadingBook | null
  todayWorkout: WorkoutTemplate | null
  activeWorkout: WorkoutSession | null
  workoutCompletedToday: boolean
}

function shortDate(value: string): string {
  const [, month, day] = value.split('-')
  return month && day ? `${day}/${month}` : value
}

function incompleteItems(list: ShoppingList): number {
  return list.items.filter(item => !item.checked_at).length
}

function pushTaskAction(actions: RhythmAction[], task: Task, input: RhythmPlanInput) {
  const wasPlannedEarlier = task.date < input.currentDate
  const timeHasArrived = task.date === input.currentDate && task.time <= input.currentTime
  actions.push({
    id: `task-${task.id}`,
    kind: 'task',
    eyebrow: wasPlannedEarlier ? 'Tarefa atrasada' : 'Prioridade agora',
    title: task.name,
    detail: wasPlannedEarlier
      ? `Planejada para ${shortDate(task.date)} às ${task.time}.`
      : timeHasArrived
        ? `O horário de ${task.time} já chegou.`
        : `Planejada para hoje às ${task.time}.`,
    to: '/tasks',
    label: 'Concluir agora',
    taskId: task.id,
    quickAction: 'complete-task',
  })
}

export function buildRhythmPlan(input: RhythmPlanInput): RhythmAction[] {
  const actions: RhythmAction[] = []
  const sortedTasks = [...input.pendingTasks].sort((first, second) => (
    first.date.localeCompare(second.date) || first.time.localeCompare(second.time)
  ))
  const sortedHabits = input.habits
    .filter(habit => !habit.done)
    .sort((first, second) => first.time.localeCompare(second.time))
  const sortedShopping = [...input.shoppingLists]
    .sort((first, second) => first.planned_date.localeCompare(second.planned_date))

  if (input.activeWorkout) {
    actions.push({
      id: `workout-session-${input.activeWorkout.id}`,
      kind: 'workout',
      eyebrow: 'Treino em andamento',
      title: `Continue ${input.activeWorkout.workout_title}`,
      detail: `${input.activeWorkout.completed_sets} de ${input.activeWorkout.total_sets} séries concluídas.`,
      to: '/workouts',
      label: 'Retomar treino',
    })
  }

  const overdueTask = sortedTasks.find(task => (
    task.date < input.currentDate
    || (task.date === input.currentDate && task.time <= input.currentTime)
  ))
  if (overdueTask) pushTaskAction(actions, overdueTask, input)

  const dueHabit = sortedHabits.find(habit => habit.time <= input.currentTime)
  if (dueHabit) {
    actions.push({
      id: `habit-${dueHabit.id}`,
      kind: 'habit',
      eyebrow: 'Ritual de agora',
      title: dueHabit.name,
      detail: `Seu check-in de ${dueHabit.time} está esperando por você.`,
      to: '/habits',
      label: 'Marcar agora',
      habitId: dueHabit.id,
      quickAction: 'checkin',
    })
  }

  const upcomingTask = sortedTasks.find(task => (
    task.date === input.currentDate && task.time > input.currentTime
  ))
  if (upcomingTask) {
    actions.push({
      id: `task-${upcomingTask.id}`,
      kind: 'task',
      eyebrow: 'Em seguida',
      title: upcomingTask.name,
      detail: `Planejada para hoje às ${upcomingTask.time}.`,
      to: '/tasks',
      label: 'Abrir tarefa',
      taskId: upcomingTask.id,
    })
  }

  const upcomingHabit = sortedHabits.find(habit => habit.time > input.currentTime)
  if (upcomingHabit) {
    actions.push({
      id: `habit-${upcomingHabit.id}`,
      kind: 'habit',
      eyebrow: 'No seu ritmo',
      title: upcomingHabit.name,
      detail: `Seu próximo check-in está previsto para ${upcomingHabit.time}.`,
      to: '/habits',
      label: 'Ver hábitos',
      habitId: upcomingHabit.id,
    })
  }

  const dueShopping = sortedShopping.find(list => (
    list.planned_date <= input.currentDate && incompleteItems(list) > 0
  ))
  if (dueShopping) {
    const remainingItems = incompleteItems(dueShopping)
    actions.push({
      id: `shopping-${dueShopping.id}`,
      kind: 'shopping',
      eyebrow: 'Compra planejada',
      title: dueShopping.name,
      detail: `${remainingItems} ${remainingItems === 1 ? 'item esperando' : 'itens esperando'} por você.`,
      to: '/shopping',
      label: 'Abrir lista',
    })
  }

  if (
    !input.activeWorkout
    && !input.workoutCompletedToday
    && input.todayWorkout?.exercises.length
  ) {
    actions.push({
      id: `workout-plan-${input.todayWorkout.id}`,
      kind: 'workout',
      eyebrow: 'Treino de hoje',
      title: input.todayWorkout.title,
      detail: `${input.todayWorkout.exercises.length} exercícios no seu plano de casa.`,
      to: '/workouts',
      label: 'Iniciar treino',
    })
  }

  if (input.activeBook) {
    actions.push({
      id: `reading-${input.activeBook.id}`,
      kind: 'reading',
      eyebrow: 'Momento de leitura',
      title: `Continue “${input.activeBook.title}”`,
      detail: `Página ${input.activeBook.current_page} de ${input.activeBook.total_pages} · ${input.activeBook.progress_percent}% concluído.`,
      to: '/reading',
      label: 'Continuar leitura',
    })
  }

  const futureShopping = sortedShopping.find(list => list.planned_date > input.currentDate)
  if (futureShopping) {
    actions.push({
      id: `shopping-future-${futureShopping.id}`,
      kind: 'shopping',
      eyebrow: 'Mais adiante',
      title: futureShopping.name,
      detail: `Planejada para ${shortDate(futureShopping.planned_date)}.`,
      to: '/shopping',
      label: 'Ver compra',
    })
  }

  if (actions.length === 0) {
    actions.push({
      id: 'plan-day',
      kind: 'plan',
      eyebrow: 'Dia organizado',
      title: 'Você está em dia',
      detail: 'Use este espaço para escolher uma próxima ação leve.',
      to: '/tasks?create=1',
      label: 'Planejar algo',
    })
  }

  const uniqueActions = actions.filter((action, index, list) => (
    list.findIndex(candidate => candidate.id === action.id) === index
  ))
  return uniqueActions.slice(0, 3)
}
