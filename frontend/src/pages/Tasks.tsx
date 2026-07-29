import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Pencil,
  Plus,
  RefreshCw,
  Repeat2,
  Trash2,
  X,
} from 'lucide-react'
import { apiRoutes } from '../services/api'
import type { Task, TaskRecurrence } from '../services/api'
import { toLocalDateValue } from '../utils/date'
import { useAppSearchParams } from '../router'
import '../styles/routine-upgrade.css'

interface TasksProps {
  userId: number
}

type FilterType = 'all' | 'today' | 'pending' | 'overdue' | 'completed'
type TaskStatus = 'pending' | 'overdue' | 'completed'

interface TaskGroup {
  key: 'overdue' | 'today' | 'upcoming' | 'completed'
  title: string
  description: string
  tasks: Task[]
}

const RECURRENCE_OPTIONS: Array<{ value: TaskRecurrence; label: string }> = [
  { value: 'none', label: 'Não repetir' },
  { value: 'daily', label: 'Todo dia' },
  { value: 'weekly', label: 'Toda semana' },
  { value: 'monthly', label: 'Todo mês' },
]

function recurrenceLabel(recurrence: TaskRecurrence): string {
  return RECURRENCE_OPTIONS.find(option => option.value === recurrence)?.label ?? 'Não repetir'
}

export default function Tasks({ userId }: TasksProps) {
  const [searchParams, setSearchParams] = useAppSearchParams()
  const createRequested = searchParams.get('create') === '1'
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editRecurrence, setEditRecurrence] = useState<TaskRecurrence>('none')
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(createRequested)
  const [newName, setNewName] = useState('')
  const [newDate, setNewDate] = useState(() => toLocalDateValue())
  const [newTime, setNewTime] = useState('09:00')
  const [newRecurrence, setNewRecurrence] = useState<TaskRecurrence>('none')
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')

  const today = toLocalDateValue()
  const tomorrow = useMemo(() => {
    const date = new Date()
    date.setDate(date.getDate() + 1)
    return toLocalDateValue(date)
  }, [])

  const loadTasks = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const { data } = await apiRoutes.getTasks(userId)
      setTasks(data)
      setError('')
    } catch (loadError) {
      console.error('Failed to load tasks:', loadError)
      setError('Não foi possível carregar suas tarefas. Tente novamente.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadTasks(true)
  }, [loadTasks])

  useEffect(() => {
    if (!createRequested) return
    setShowCreateForm(true)
    setSearchParams({}, { replace: true })
  }, [createRequested, setSearchParams])

  function getTaskStatus(task: Task): TaskStatus {
    if (task.completed_at) return 'completed'
    const due = new Date(`${task.date}T${task.time || '23:59'}`)
    return due.getTime() < Date.now() ? 'overdue' : 'pending'
  }

  function getStatusLabel(status: TaskStatus): string {
    const labels = {
      pending: 'Pendente',
      overdue: 'Atrasada',
      completed: 'Concluída',
    }
    return labels[status]
  }

  function formatDate(dateStr: string): string {
    if (dateStr === today) return 'Hoje'
    if (dateStr === tomorrow) return 'Amanhã'
    const [year, month, day] = dateStr.split('-')
    return `${day}/${month}/${year}`
  }

  function taskTimestamp(task: Task): number {
    return new Date(`${task.date}T${task.time || '23:59'}`).getTime()
  }

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => {
      const statusPriority = { overdue: 0, pending: 1, completed: 2 }
      const statusDifference = statusPriority[getTaskStatus(a)] - statusPriority[getTaskStatus(b)]
      if (statusDifference) return statusDifference
      if (a.completed_at && b.completed_at) {
        return b.completed_at.localeCompare(a.completed_at)
      }
      return taskTimestamp(a) - taskTimestamp(b)
    }),
    // The current time is intentionally read whenever task data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks],
  )

  const todayCount = tasks.filter(task => !task.completed_at && task.date === today).length
  const overdueCount = tasks.filter(task => getTaskStatus(task) === 'overdue').length
  const completedCount = tasks.filter(task => getTaskStatus(task) === 'completed').length
  const pendingCount = tasks.filter(task => getTaskStatus(task) === 'pending').length
  const openCount = tasks.length - completedCount
  const nextTask = sortedTasks.find(task => getTaskStatus(task) !== 'completed')

  const visibleTasks = sortedTasks.filter(task => {
    if (filter === 'all') return true
    if (filter === 'today') return !task.completed_at && task.date === today
    return getTaskStatus(task) === filter
  })

  const groups: TaskGroup[] = [
    {
      key: 'overdue',
      title: 'Precisam de atenção',
      description: 'Tarefas que passaram do horário planejado',
      tasks: visibleTasks.filter(task => getTaskStatus(task) === 'overdue'),
    },
    {
      key: 'today',
      title: 'Para hoje',
      description: 'O que ainda cabe no seu dia',
      tasks: visibleTasks.filter(
        task => getTaskStatus(task) === 'pending' && task.date === today,
      ),
    },
    {
      key: 'upcoming',
      title: 'Próximas',
      description: 'Compromissos dos próximos dias',
      tasks: visibleTasks.filter(
        task => getTaskStatus(task) === 'pending' && task.date !== today,
      ),
    },
    {
      key: 'completed',
      title: 'Concluídas',
      description: 'O que você já resolveu',
      tasks: visibleTasks.filter(task => getTaskStatus(task) === 'completed'),
    },
  ].filter(group => group.tasks.length > 0) as TaskGroup[]

  function countByFilter(selectedFilter: FilterType): number {
    if (selectedFilter === 'all') return tasks.length
    if (selectedFilter === 'today') return todayCount
    if (selectedFilter === 'overdue') return overdueCount
    if (selectedFilter === 'completed') return completedCount
    return pendingCount
  }

  async function toggleComplete(task: Task) {
    if (busyKey) return
    setBusyKey(`toggle-${task.id}`)
    setError('')
    try {
      await apiRoutes.completeTask(task.id)
      await loadTasks()
    } catch (toggleError) {
      console.error('Failed to toggle task:', toggleError)
      setError(`Não foi possível ${task.completed_at ? 'reabrir' : 'concluir'} essa tarefa.`)
    } finally {
      setBusyKey(null)
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = newName.trim()
    if (!trimmedName || !newDate || busyKey) return

    setBusyKey('create')
    setError('')
    try {
      await apiRoutes.createTask(userId, {
        name: trimmedName,
        date: newDate,
        time: newTime || '09:00',
        recurrence: newRecurrence,
      })
      setNewName('')
      setNewDate(today)
      setNewTime('09:00')
      setNewRecurrence('none')
      setShowCreateForm(false)
      setFilter('all')
      await loadTasks()
    } catch (createError) {
      console.error('Failed to create task:', createError)
      setError('Não foi possível criar a tarefa. Confira os dados e tente novamente.')
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteTask(id: number) {
    if (busyKey) return
    setBusyKey(`delete-${id}`)
    setError('')
    try {
      await apiRoutes.deleteTask(id)
      setPendingDeleteId(null)
      if (editingId === id) setEditingId(null)
      await loadTasks()
    } catch (deleteError) {
      console.error('Failed to delete task:', deleteError)
      setError('Não foi possível remover a tarefa.')
    } finally {
      setBusyKey(null)
    }
  }

  function startEditing(task: Task) {
    setPendingDeleteId(null)
    setEditingId(task.id)
    setEditName(task.name)
    setEditDate(task.date)
    setEditTime(task.time)
    setEditRecurrence(task.recurrence ?? 'none')
  }

  async function saveEditing() {
    const trimmedName = editName.trim()
    if (!editingId || !trimmedName || !editDate || busyKey) return

    const id = editingId
    setBusyKey(`edit-${id}`)
    setError('')
    try {
      await apiRoutes.updateTask(id, {
        name: trimmedName,
        date: editDate,
        time: editTime || '09:00',
        recurrence: editRecurrence,
      })
      setEditingId(null)
      await loadTasks()
    } catch (updateError) {
      console.error('Failed to update task:', updateError)
      setError('Não foi possível salvar as alterações da tarefa.')
    } finally {
      setBusyKey(null)
    }
  }

  function openCreateForm() {
    setShowCreateForm(true)
    setError('')
  }

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'Todas' },
    { key: 'today', label: 'Hoje' },
    { key: 'pending', label: 'Pendentes' },
    { key: 'overdue', label: 'Atrasadas' },
    { key: 'completed', label: 'Concluídas' },
  ]

  return (
    <div className="view routine-view" data-view="tasks">
      <section className="routine-hero routine-task-hero" aria-labelledby="tasks-title">
        <div className="routine-hero-copy">
          <p className="routine-kicker">Organize sem complicar</p>
          <h2 id="tasks-title">O que precisa acontecer agora?</h2>
          <p>Veja as prioridades do dia e tire cada pendência da cabeça.</p>
          <button className="routine-hero-button" type="button" onClick={openCreateForm}>
            <Plus size={18} aria-hidden="true" />
            Nova tarefa
          </button>
        </div>

        <div className="routine-summary-grid" aria-label="Resumo das tarefas">
          <button
            type="button"
            className={`routine-summary-card today ${filter === 'today' ? 'is-active' : ''}`}
            onClick={() => setFilter('today')}
            aria-pressed={filter === 'today'}
          >
            <CalendarDays size={20} aria-hidden="true" />
            <strong>{todayCount}</strong>
            <span>Hoje</span>
          </button>
          <button
            type="button"
            className={`routine-summary-card overdue ${filter === 'overdue' ? 'is-active' : ''}`}
            onClick={() => setFilter('overdue')}
            aria-pressed={filter === 'overdue'}
          >
            <AlertCircle size={20} aria-hidden="true" />
            <strong>{overdueCount}</strong>
            <span>Atrasadas</span>
          </button>
          <button
            type="button"
            className={`routine-summary-card completed ${filter === 'completed' ? 'is-active' : ''}`}
            onClick={() => setFilter('completed')}
            aria-pressed={filter === 'completed'}
          >
            <CheckCircle2 size={20} aria-hidden="true" />
            <strong>{completedCount}</strong>
            <span>Concluídas</span>
          </button>
        </div>
      </section>

      {error && (
        <div className="routine-alert" role="alert">
          <AlertCircle size={19} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Fechar aviso">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      )}

      {nextTask && (
        <section className={`routine-next-card task ${getTaskStatus(nextTask) === 'overdue' ? 'is-overdue' : ''}`}>
          <div className="routine-next-icon" aria-hidden="true">
            {getTaskStatus(nextTask) === 'overdue'
              ? <AlertCircle size={22} />
              : <CalendarClock size={22} />}
          </div>
          <div>
            <span>{getTaskStatus(nextTask) === 'overdue' ? 'Prioridade agora' : 'Próxima tarefa'}</span>
            <strong>{nextTask.name}</strong>
            <small>{formatDate(nextTask.date)} · {nextTask.time}</small>
          </div>
          <button
            className="routine-next-action"
            type="button"
            onClick={() => void toggleComplete(nextTask)}
            disabled={busyKey !== null}
          >
            <Check size={18} aria-hidden="true" />
            Concluir
          </button>
        </section>
      )}

      {showCreateForm && (
        <section className="panel routine-panel routine-create-panel">
          <div className="routine-section-head">
            <div>
              <p className="routine-kicker">Nova tarefa</p>
              <h2>Planeje o próximo passo</h2>
              <p>Defina o que fazer e quando você quer resolver.</p>
            </div>
            <button
              className="routine-close-button"
              type="button"
              onClick={() => setShowCreateForm(false)}
              aria-label="Fechar criação de tarefa"
              disabled={busyKey === 'create'}
            >
              <X size={19} aria-hidden="true" />
            </button>
          </div>

          <form id="new-task-form" className="routine-create-form routine-task-form" onSubmit={createTask}>
            <label className="routine-task-name-field">
              Nome da tarefa
              <input
                type="text"
                value={newName}
                onChange={event => setNewName(event.target.value)}
                maxLength={60}
                required
                autoFocus
                placeholder="Ex: Pagar a conta de luz"
              />
            </label>
            <label>
              Data
              <input
                type="date"
                value={newDate}
                onChange={event => setNewDate(event.target.value)}
                required
              />
            </label>
            <label>
              Horário
              <input
                type="time"
                value={newTime}
                onChange={event => setNewTime(event.target.value)}
                required
              />
            </label>
            <label>
              Repetição
              <select
                value={newRecurrence}
                onChange={event => setNewRecurrence(event.target.value as TaskRecurrence)}
              >
                {RECURRENCE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="routine-quick-dates" aria-label="Atalhos de data">
              <span>Agendar para</span>
              <button
                type="button"
                className={newDate === today ? 'is-active' : ''}
                onClick={() => setNewDate(today)}
              >
                Hoje
              </button>
              <button
                type="button"
                className={newDate === tomorrow ? 'is-active' : ''}
                onClick={() => setNewDate(tomorrow)}
              >
                Amanhã
              </button>
            </div>
            <div className="routine-editor-actions routine-create-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={!newName.trim() || !newDate || busyKey !== null}
              >
                {busyKey === 'create'
                  ? <><RefreshCw className="routine-spin" size={18} aria-hidden="true" /> Adicionando...</>
                  : <><Plus size={18} aria-hidden="true" /> Adicionar tarefa</>}
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setShowCreateForm(false)}
                disabled={busyKey === 'create'}
              >
                Cancelar
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel routine-panel">
        <div className="routine-section-head routine-task-list-head">
          <div>
            <p className="routine-kicker">Sua agenda</p>
            <h2>Minhas tarefas</h2>
            <p>
              {tasks.length === 0
                ? 'Crie sua primeira tarefa.'
                : openCount === 1
                  ? '1 tarefa ainda está aberta.'
                  : `${openCount} tarefas ainda estão abertas.`}
            </p>
          </div>
          {!showCreateForm && (
            <button
              aria-label="Nova tarefa"
              className="primary-button routine-add-compact"
              type="button"
              onClick={openCreateForm}
            >
              <Plus size={17} aria-hidden="true" />
              <span>Nova tarefa</span>
            </button>
          )}
        </div>

        <div className="routine-filters" role="group" aria-label="Filtrar tarefas">
          {filters.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={filter === key ? 'is-active' : ''}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
            >
              <span>{label}</span>
              <b>{countByFilter(key)}</b>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="routine-loading" role="status">
            <RefreshCw className="routine-spin" size={22} aria-hidden="true" />
            <span>Carregando suas tarefas...</span>
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="routine-empty-state">
            <span><CheckCircle2 size={24} aria-hidden="true" /></span>
            <div>
              <strong>{tasks.length === 0 ? 'Nenhuma tarefa por aqui' : 'Tudo limpo neste filtro'}</strong>
              <p>
                {tasks.length === 0
                  ? 'Adicione uma tarefa para começar a organizar seu dia.'
                  : 'Escolha outro filtro para ver as demais tarefas.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="routine-task-groups">
            {groups.map(group => (
              <section key={group.key} className={`routine-task-group group-${group.key}`}>
                <div className="routine-group-heading">
                  <div>
                    <h3>{group.title}</h3>
                    <p>{group.description}</p>
                  </div>
                  <span>{group.tasks.length}</span>
                </div>

                <div className="routine-list">
                  {group.tasks.map(task => {
                    const status = getTaskStatus(task)
                    const isBusy = busyKey?.endsWith(`-${task.id}`) ?? false
                    const isDeleting = pendingDeleteId === task.id

                    return (
                      <article
                        key={task.id}
                        className={`routine-item routine-task-item is-${status}`}
                      >
                        {editingId === task.id ? (
                          <div className="routine-inline-editor routine-task-editor">
                            <label className="routine-task-name-field">
                              Nome da tarefa
                              <input
                                type="text"
                                value={editName}
                                onChange={event => setEditName(event.target.value)}
                                maxLength={60}
                                autoFocus
                                required
                              />
                            </label>
                            <label>
                              Data
                              <input
                                type="date"
                                value={editDate}
                                onChange={event => setEditDate(event.target.value)}
                                required
                              />
                            </label>
                            <label>
                              Horário
                              <input
                                type="time"
                                value={editTime}
                                onChange={event => setEditTime(event.target.value)}
                              />
                            </label>
                            <label>
                              Repetição
                              <select
                                value={editRecurrence}
                                onChange={event => setEditRecurrence(event.target.value as TaskRecurrence)}
                              >
                                {RECURRENCE_OPTIONS.map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </label>
                            <div className="routine-editor-actions">
                              <button
                                className="primary-button"
                                onClick={() => void saveEditing()}
                                type="button"
                                disabled={!editName.trim() || !editDate || isBusy}
                              >
                                {isBusy ? 'Salvando...' : 'Salvar'}
                              </button>
                              <button
                                className="ghost-button"
                                onClick={() => setEditingId(null)}
                                type="button"
                                disabled={isBusy}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <button
                              className={`routine-check-control ${status === 'completed' ? 'is-done' : ''}`}
                              type="button"
                              onClick={() => void toggleComplete(task)}
                              disabled={busyKey !== null}
                              aria-label={`${status === 'completed' ? 'Reabrir' : 'Concluir'} ${task.name}`}
                            >
                              {isBusy && busyKey?.startsWith('toggle')
                                ? <RefreshCw className="routine-spin" size={19} aria-hidden="true" />
                                : status === 'completed'
                                  ? <Check size={20} aria-hidden="true" />
                                  : null}
                            </button>

                            <div className="routine-item-main">
                              <div className="routine-item-title">
                                <strong>{task.name}</strong>
                                <span className={`routine-status ${status}`}>
                                  {getStatusLabel(status)}
                                </span>
                              </div>
                              <small>
                                <CalendarDays size={15} aria-hidden="true" />
                                {formatDate(task.date)}
                                <span aria-hidden="true">·</span>
                                <Clock3 size={15} aria-hidden="true" />
                                {task.time}
                                {(task.recurrence ?? 'none') !== 'none' && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <Repeat2 size={15} aria-hidden="true" />
                                    {recurrenceLabel(task.recurrence)}
                                  </>
                                )}
                              </small>
                            </div>

                            <div className="routine-item-actions">
                              <button
                                className={`routine-task-complete ${status === 'completed' ? 'is-reopen' : ''}`}
                                onClick={() => void toggleComplete(task)}
                                type="button"
                                disabled={busyKey !== null}
                              >
                                {status === 'completed' ? 'Reabrir' : 'Concluir'}
                                <ChevronRight size={17} aria-hidden="true" />
                              </button>

                              {isDeleting ? (
                                <div className="routine-delete-confirm" role="group" aria-label={`Confirmar remoção de ${task.name}`}>
                                  <span>Remover?</span>
                                  <button
                                    className="routine-confirm-delete"
                                    type="button"
                                    onClick={() => void deleteTask(task.id)}
                                    disabled={isBusy}
                                  >
                                    {isBusy ? 'Removendo...' : 'Sim'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPendingDeleteId(null)}
                                    disabled={isBusy}
                                  >
                                    Não
                                  </button>
                                </div>
                              ) : (
                                <div className="routine-more-actions">
                                  <button
                                    type="button"
                                    title={`Editar ${task.name}`}
                                    onClick={() => startEditing(task)}
                                    disabled={busyKey !== null}
                                    aria-label={`Editar ${task.name}`}
                                  >
                                    <Pencil size={17} aria-hidden="true" />
                                  </button>
                                  <button
                                    className="danger"
                                    onClick={() => {
                                      setEditingId(null)
                                      setPendingDeleteId(task.id)
                                    }}
                                    type="button"
                                    title={`Remover ${task.name}`}
                                    disabled={busyKey !== null}
                                    aria-label={`Remover ${task.name}`}
                                  >
                                    <Trash2 size={17} aria-hidden="true" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
