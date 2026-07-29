import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRoutes } from '../services/api'
import { toLocalDateValue } from '../utils/date'
import Tasks from './Tasks'

const setSearchParamsMock = vi.hoisted(() => vi.fn())

vi.mock('../services/api', () => ({
  apiRoutes: {
    getTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    completeTask: vi.fn(),
  },
}))

vi.mock('../router', () => ({
  useAppSearchParams: () => [
    new URLSearchParams(),
    setSearchParamsMock,
  ] as const,
}))

function shiftedDate(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toLocalDateValue(date)
}

function task(
  id: number,
  name: string,
  date: string,
  completedAt: string | null = null,
) {
  return {
    id,
    user_id: 1,
    name,
    date,
    time: '23:59',
    completed_at: completedAt,
    recurrence: 'none',
    recurrence_interval: 1,
    recurrence_parent_id: null,
    created_at: '2026-07-29T09:00:00',
  }
}

describe('Tasks upgraded experience', () => {
  const today = toLocalDateValue()
  const tasks = [
    task(1, 'Conta atrasada', shiftedDate(-1)),
    task(2, 'Separar documentos', today),
    task(3, 'Consulta', shiftedDate(2)),
    task(4, 'Comprar remédio', shiftedDate(-2), '2026-07-28T12:00:00'),
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiRoutes.getTasks).mockResolvedValue({ data: tasks } as never)
    vi.mocked(apiRoutes.createTask).mockResolvedValue({ data: tasks[1] } as never)
    vi.mocked(apiRoutes.updateTask).mockResolvedValue({ data: tasks[1] } as never)
    vi.mocked(apiRoutes.completeTask).mockResolvedValue({ data: tasks[0] } as never)
  })

  it('summarizes and groups the agenda by urgency', async () => {
    const { container } = render(<Tasks userId={1} />)

    await screen.findByText('Precisam de atenção')
    expect(screen.getByText('Para hoje')).toBeTruthy()
    expect(screen.getByText('Próximas')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Concluídas' })).toBeTruthy()

    const todayCard = container.querySelector('.routine-summary-card.today')
    const overdueCard = container.querySelector('.routine-summary-card.overdue')
    const completedCard = container.querySelector('.routine-summary-card.completed')

    expect(todayCard?.textContent).toContain('1Hoje')
    expect(overdueCard?.textContent).toContain('1Atrasadas')
    expect(completedCard?.textContent).toContain('1Concluídas')
  })

  it('filters tasks for today from the summary card', async () => {
    const { container } = render(<Tasks userId={1} />)

    await screen.findByText('Precisam de atenção')
    const todayCard = container.querySelector<HTMLButtonElement>('.routine-summary-card.today')
    expect(todayCard).toBeTruthy()
    fireEvent.click(todayCard as HTMLButtonElement)

    const taskGroups = container.querySelector('.routine-task-groups')
    expect(taskGroups).toBeTruthy()
    const groupQueries = within(taskGroups as HTMLElement)
    expect(groupQueries.getByText('Separar documentos')).toBeTruthy()
    expect(groupQueries.queryByText('Conta atrasada')).toBeNull()
    expect(groupQueries.queryByText('Consulta')).toBeNull()
  })

  it('creates a recurring task with the selected date and time', async () => {
    render(<Tasks userId={1} />)

    await screen.findByText('Minhas tarefas')
    fireEvent.click(screen.getAllByRole('button', { name: 'Nova tarefa' })[0])

    const form = document.querySelector<HTMLFormElement>('#new-task-form')
    expect(form).toBeTruthy()
    const formQueries = within(form as HTMLFormElement)
    fireEvent.change(formQueries.getByLabelText('Nome da tarefa'), {
      target: { value: 'Levar roupa à lavanderia' },
    })
    fireEvent.change(formQueries.getByLabelText('Horário'), {
      target: { value: '16:20' },
    })
    fireEvent.change(formQueries.getByLabelText('Repetição'), {
      target: { value: 'weekly' },
    })
    fireEvent.click(formQueries.getByRole('button', { name: 'Adicionar tarefa' }))

    await waitFor(() => {
      expect(apiRoutes.createTask).toHaveBeenCalledWith(1, {
        name: 'Levar roupa à lavanderia',
        date: today,
        time: '16:20',
        recurrence: 'weekly',
      })
    })
  })

  it('concludes a task from its large touch target', async () => {
    render(<Tasks userId={1} />)

    await screen.findAllByText('Conta atrasada')
    fireEvent.click(screen.getByRole('button', { name: 'Concluir Conta atrasada' }))

    await waitFor(() => {
      expect(apiRoutes.completeTask).toHaveBeenCalledWith(1)
    })
  })

  it('edits name, date and time without leaving the list', async () => {
    render(<Tasks userId={1} />)

    await screen.findAllByText('Separar documentos')
    fireEvent.click(screen.getByRole('button', { name: 'Editar Separar documentos' }))
    fireEvent.change(screen.getByLabelText('Nome da tarefa'), {
      target: { value: 'Organizar documentos' },
    })
    fireEvent.change(screen.getByLabelText('Horário'), {
      target: { value: '18:10' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(apiRoutes.updateTask).toHaveBeenCalledWith(2, {
        name: 'Organizar documentos',
        date: today,
        time: '18:10',
        recurrence: 'none',
      })
    })
  })
})
