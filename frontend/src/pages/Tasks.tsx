import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { apiRoutes } from '../services/api'
import type { Task } from '../services/api'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { toLocalDateValue } from '../utils/date'

interface TasksProps {
  userId: number
}

type FilterType = 'all' | 'pending' | 'overdue' | 'completed'
type TaskStatus = 'pending' | 'overdue' | 'completed'

export default function Tasks({ userId }: TasksProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDate, setNewDate] = useState(() => toLocalDateValue())
  const [newTime, setNewTime] = useState('09:00')

  useEffect(() => {
    loadTasks()
  }, [userId])

  async function loadTasks() {
    try {
      const data = await apiRoutes.getTasks(userId)
      setTasks(data.data)
    } catch (error) {
      console.error('Failed to load tasks:', error)
    }
  }

  function getTaskStatus(task: Task): TaskStatus {
    if (task.completed_at) return 'completed'
    const due = new Date(`${task.date}T${task.time || '23:59'}`)
    return due.getTime() < Date.now() ? 'overdue' : 'pending'
  }

  function getStatusLabel(status: TaskStatus): string {
    const labels = { pending: 'Pendente', overdue: 'Atrasada', completed: 'Concluída' }
    return labels[status]
  }

  function formatDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-')
    return `${day}/${month}/${year}`
  }

  function filteredTasks(): Task[] {
    let filtered = [...tasks]
    if (filter !== 'all') {
      filtered = filtered.filter(t => getTaskStatus(t) === filter)
    }
    const priority = { overdue: 0, pending: 1, completed: 2 }
    return filtered.sort((a, b) => {
      const statusDiff = priority[getTaskStatus(a)] - priority[getTaskStatus(b)]
      if (statusDiff) return statusDiff
      return `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
    })
  }

  function countByFilter(f: FilterType): number {
    if (f === 'all') return tasks.length
    return tasks.filter(t => getTaskStatus(t) === f).length
  }

  async function toggleComplete(task: Task) {
    try {
      await apiRoutes.completeTask(task.id)
      loadTasks()
    } catch (error) {
      console.error('Failed to toggle task:', error)
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newName.trim()) return

    try {
      await apiRoutes.createTask(userId, {
        name: newName.trim(),
        date: newDate || toLocalDateValue(),
        time: newTime || '09:00',
      })
      setNewName('')
      setNewDate(toLocalDateValue())
      setNewTime('09:00')
      setShowCreateForm(false)
      await loadTasks()
    } catch (error) {
      console.error('Failed to create task:', error)
    }
  }

  async function deleteTask(id: number) {
    if (!confirm('Remover a tarefa?')) return
    try {
      await apiRoutes.deleteTask(id)
      loadTasks()
    } catch (error) {
      console.error('Failed to delete task:', error)
    }
  }

  function startEditing(task: Task) {
    setEditingId(task.id)
    setEditName(task.name)
    setEditDate(task.date)
    setEditTime(task.time)
  }

  async function saveEditing() {
    if (!editingId || !editName.trim()) return
    try {
      await apiRoutes.updateTask(editingId, {
        name: editName.trim(),
        date: editDate,
        time: editTime,
      })
      setEditingId(null)
      loadTasks()
    } catch (error) {
      console.error('Failed to update task:', error)
    }
  }

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'Todas' },
    { key: 'pending', label: 'Pendentes' },
    { key: 'overdue', label: 'Atrasadas' },
    { key: 'completed', label: 'Concluídas' },
  ]

  return (
    <div className="view" data-view="tasks">
      <section className="panel">
        <div className="panel-head">
          <div><p className="section-label">Agenda</p><h2>Minhas tarefas</h2></div>
          <button
            className="primary-button compact-button"
            type="button"
            onClick={() => setShowCreateForm(current => !current)}
            aria-expanded={showCreateForm}
            aria-controls="new-task-form"
          >
            <Plus size={17} aria-hidden="true" />
            <span>Nova tarefa</span>
          </button>
        </div>
        {showCreateForm && (
          <form id="new-task-form" className="task-create-form" onSubmit={createTask}>
            <label>
              Nome
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
            <div className="editor-actions">
              <button className="primary-button" type="submit">Adicionar</button>
              <button className="ghost-button" type="button" onClick={() => setShowCreateForm(false)}>
                Cancelar
              </button>
            </div>
          </form>
        )}
        <div className="task-filters" role="group" aria-label="Filtrar tarefas">
          {filters.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={filter === key ? 'active' : ''}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
            >
              {label} ({countByFilter(key)})
            </button>
          ))}
        </div>
        <div className="task-list">
          {filteredTasks().length === 0 ? (
            <p className="empty-state">Nenhuma tarefa nesta lista.</p>
          ) : (
            filteredTasks().map((task) => {
              const status = getTaskStatus(task)
              return (
                <article
                  key={task.id}
                  className={`task-item task-${status}`}
                >
                  {editingId === task.id ? (
                    <div className="inline-edit-form task-edit">
                      <div style={{ display: 'grid', gap: '10px' }}>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          maxLength={60}
                          autoFocus
                          required
                          aria-label={`Nome de ${task.name}`}
                        />
                        <input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          aria-label={`Data de ${task.name}`}
                        />
                        <input
                          type="time"
                          value={editTime}
                          onChange={(e) => setEditTime(e.target.value)}
                          aria-label={`Horário de ${task.name}`}
                        />
                      </div>
                      <div className="item-actions">
                        <button className="primary-button" onClick={saveEditing} type="button">Salvar</button>
                        <button className="ghost-button" onClick={() => setEditingId(null)} type="button">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="task-details">
                        <div className="task-heading">
                          <strong>{task.name}</strong>
                          <span className={`status-chip ${status}`}>
                            {getStatusLabel(status)}
                          </span>
                        </div>
                        <small>{formatDate(task.date)} às {task.time}</small>
                      </div>
                      <div className="item-actions">
                        <button
                          className={`check-button ${status === 'completed' ? 'done' : ''}`}
                          onClick={() => toggleComplete(task)}
                          type="button"
                          aria-label={`${status === 'completed' ? 'Reabrir' : 'Concluir'} ${task.name}`}
                        >
                          {status === 'completed' ? 'Reabrir' : 'Concluir'}
                        </button>
                        <button
                          className="icon-button small-icon"
                          onClick={() => startEditing(task)}
                          type="button"
                          title={`Editar ${task.name}`}
                          aria-label={`Editar ${task.name}`}
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                        <button
                          className="icon-button small-icon danger-button"
                          onClick={() => deleteTask(task.id)}
                          type="button"
                          title={`Remover ${task.name}`}
                          aria-label={`Remover ${task.name}`}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </>
                  )}
                </article>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}
