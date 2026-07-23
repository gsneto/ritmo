import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRoutes, Habit } from '../services/api'
import { Trash2, Timer, Dumbbell, Check, Plus, Pencil, X } from 'lucide-react'
import WorkoutsPanel from '../components/WorkoutsPanel'

interface HabitsProps {
  userId: number
}

export default function Habits({ userId }: HabitsProps) {
  const navigate = useNavigate()
  const [habits, setHabits] = useState<Habit[]>([])
  const [entryType, setEntryType] = useState<'habit' | 'task'>('habit')
  const [name, setName] = useState('')
  const [time, setTime] = useState('09:00')
  const [date, setDate] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editTime, setEditTime] = useState('')
  const [showWorkouts, setShowWorkouts] = useState(false)

  useEffect(() => {
    loadHabits()
  }, [userId])

  async function loadHabits() {
    try {
      const data = await apiRoutes.getHabits(userId)
      setHabits(data.data)
    } catch (error) {
      console.error('Failed to load habits:', error)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    try {
      if (entryType === 'task') {
        const today = new Date().toISOString().split('T')[0]
        await apiRoutes.createTask(userId, {
          name: name.trim(),
          date: date || today,
          time: time || '09:00',
        })
      } else {
        await apiRoutes.createHabit(userId, {
          name: name.trim(),
          time: time || '09:00',
        })
      }
      setName('')
      setTime('09:00')
      setDate('')
      loadHabits()
    } catch (error) {
      console.error('Failed to create:', error)
    }
  }

  async function toggleCheckIn(habit: Habit) {
    const today = new Date().toISOString().split('T')[0]
    const isCheckedIn = habit.check_ins.includes(today)
    try {
      if (isCheckedIn) {
        await apiRoutes.removeCheckin(habit.id, today)
      } else {
        await apiRoutes.checkinHabit(habit.id, today)
      }
      loadHabits()
    } catch (error) {
      console.error('Failed to toggle check-in:', error)
    }
  }

  async function deleteHabit(id: number) {
    if (!confirm('Remover o hábito?')) return
    try {
      await apiRoutes.deleteHabit(id)
      loadHabits()
    } catch (error) {
      console.error('Failed to delete habit:', error)
    }
  }

  function startEditing(habit: Habit) {
    setEditingId(habit.id)
    setEditName(habit.name)
    setEditTime(habit.time)
  }

  async function saveEditing() {
    if (!editingId) return
    try {
      await apiRoutes.updateHabit(editingId, { name: editName, time: editTime })
      setEditingId(null)
      loadHabits()
    } catch (error) {
      console.error('Failed to update habit:', error)
    }
  }

  function isReadingHabit(name: string) {
    return /leitura|\bler\b/i.test(name)
  }

  function isWorkoutHabit(name: string) {
    return /treino/i.test(name)
  }

  function goToFocus(habitId: number) {
    navigate('/focus')
  }

  function openWorkouts() {
    setShowWorkouts(true)
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="view" data-view="habits">
      <section className="panel">
        <div className="panel-head">
          <div><p className="section-label">Cadastro</p><h2 id="entryTitle">{entryType === 'task' ? 'Nova tarefa' : 'Novo hábito'}</h2></div>
        </div>
        <form className="entry-form" onSubmit={handleSubmit}>
          <input type="hidden" value={entryType} />
          <div className="entry-type" role="group">
            <button
              type="button"
              className={entryType === 'habit' ? 'active' : ''}
              onClick={() => setEntryType('habit')}
            >
              Hábito
            </button>
            <button
              type="button"
              className={entryType === 'task' ? 'active' : ''}
              onClick={() => setEntryType('task')}
            >
              Tarefa
            </button>
          </div>
          <div className="entry-fields">
            <label>
              Nome
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={entryType === 'task' ? 'Ex: Prova de matemática' : 'Ex: Caminhar 20 minutos'}
                maxLength={60}
                required
              />
            </label>
            {entryType === 'task' && (
              <label>
                Data
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            )}
            <label>
              Horário
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
              />
            </label>
            <button className="primary-button" type="submit">
              {entryType === 'task' ? 'Adicionar tarefa' : 'Adicionar hábito'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div><p className="section-label">Rotina</p><h2>Meus hábitos</h2></div>
        </div>
        <div className="habit-list">
          {habits.length === 0 ? (
            <p className="empty-state">Nenhum hábito cadastrado.</p>
          ) : (
            [...habits].sort((a, b) => a.time.localeCompare(b.time)).map((habit) => (
              <article key={habit.id} className="habit-item">
                {editingId === habit.id ? (
                  <div className="inline-edit-form">
                    <div style={{ display: 'grid', gap: '10px' }}>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={60}
                        autoFocus
                      />
                      <input
                        type="time"
                        value={editTime}
                        onChange={(e) => setEditTime(e.target.value)}
                      />
                    </div>
                    <div className="item-actions">
                      <button className="primary-button" onClick={saveEditing} type="button">Salvar</button>
                      <button className="ghost-button" onClick={() => setEditingId(null)} type="button">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="habit-details">
                      <strong>{habit.name}</strong>
                      <small>
                        {habit.time}
                        {habit.check_ins.includes(today) && ' · feito hoje'}
                      </small>
                    </div>
                    <div className="item-actions">
                      {isReadingHabit(habit.name) && (
                        <button
                          className="focus-button"
                          type="button"
                          title="Ir para Foco"
                          onClick={() => goToFocus(habit.id)}
                        >
                          <Timer size={16} />
                        </button>
                      )}
                      {isWorkoutHabit(habit.name) && (
                        <button
                          className="workout-button"
                          type="button"
                          title="Ver treinos"
                          onClick={openWorkouts}
                        >
                          <Dumbbell size={16} />
                        </button>
                      )}
                      <button
                        className={`check-button ${habit.check_ins.includes(today) ? 'done' : ''}`}
                        onClick={() => toggleCheckIn(habit)}
                        type="button"
                      >
                        {habit.check_ins.includes(today) ? 'Feito' : 'Marcar'}
                      </button>
                      <button
                        className="icon-button small-icon"
                        type="button"
                        title={`Editar ${habit.name}`}
                        onClick={() => startEditing(habit)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button small-icon danger-button"
                        onClick={() => deleteHabit(habit.id)}
                        type="button"
                        title={`Remover ${habit.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </>
                )}
              </article>
            ))
          )}
        </div>
      </section>

      <WorkoutsPanel
        userId={userId}
        isOpen={showWorkouts}
        onClose={() => setShowWorkouts(false)}
      />
    </div>
  )
}
