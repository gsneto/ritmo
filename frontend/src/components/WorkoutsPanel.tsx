import { useState, useEffect } from 'react'
import { apiRoutes } from '../services/api'
import type { Workout } from '../services/api'
import { Pencil, X, Plus } from 'lucide-react'

interface WorkoutsPanelProps {
  userId: number
  isOpen: boolean
  onClose: () => void
}

interface ExerciseData {
  name: string
  sets: string
  reps: string
}

interface WorkoutData {
  day: string
  title: string
  note: string
  exercises: ExerciseData[]
}

export default function WorkoutsPanel({ userId, isOpen, onClose }: WorkoutsPanelProps) {
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editData, setEditData] = useState<WorkoutData | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadWorkouts()
    }
  }, [userId, isOpen])

  async function loadWorkouts() {
    try {
      const response = await apiRoutes.getWorkouts(userId)
      setWorkouts(response.data)
    } catch (error) {
      console.error('Failed to load workouts:', error)
    }
  }

  function startEditing(index: number) {
    const workout = workouts[index]
    setEditingIndex(index)
    setEditData({
      day: workout.day,
      title: workout.title,
      note: workout.note || '',
      exercises: workout.exercises.map(ex => ({
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps
      }))
    })
  }

  function cancelEditing() {
    setEditingIndex(null)
    setEditData(null)
  }

  function addExercise() {
    if (!editData) return
    setEditData({
      ...editData,
      exercises: [...editData.exercises, { name: '', sets: '3', reps: '10' }]
    })
  }

  function removeExercise(index: number) {
    if (!editData) return
    setEditData({
      ...editData,
      exercises: editData.exercises.filter((_, i) => i !== index)
    })
  }

  function updateExercise(index: number, field: keyof ExerciseData, value: string) {
    if (!editData) return
    const newExercises = [...editData.exercises]
    newExercises[index] = { ...newExercises[index], [field]: value }
    setEditData({ ...editData, exercises: newExercises })
  }

  async function saveWorkout() {
    if (!editData || editingIndex === null) return

    // Create updated workouts array
    const updatedWorkouts: WorkoutData[] = workouts.map((w, i) => {
      if (i === editingIndex) {
        return editData
      }
      return {
        day: w.day,
        title: w.title,
        note: w.note || '',
        exercises: w.exercises.map(ex => ({
          name: ex.name,
          sets: ex.sets,
          reps: ex.reps
        }))
      }
    })

    try {
      await apiRoutes.updateWorkouts(userId, updatedWorkouts)
      setEditingIndex(null)
      setEditData(null)
      loadWorkouts()
    } catch (error) {
      console.error('Failed to save workout:', error)
    }
  }

  function getTodayIndex(): number {
    const day = new Date().getDay()
    return day === 0 ? 6 : day - 1
  }

  if (!isOpen) return null

  const todayIndex = getTodayIndex()

  return (
    <section className="panel workout-panel">
      <div className="panel-head">
        <div><p className="section-label">Treino</p><h2>Treinos da semana</h2></div>
        <button className="icon-button" onClick={onClose} type="button" title="Fechar treinos" aria-label="Fechar treinos">
          <X size={18} />
        </button>
      </div>
      <div className="workout-list">
        {workouts.map((workout, index) => (
          <article key={workout.id} className={`workout-day ${index === todayIndex ? 'today-workout' : ''}`}>
            {editingIndex === index && editData ? (
              <div className="workout-editor">
                <label>
                  Treino do dia
                  <input
                    type="text"
                    value={editData.title}
                    onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                    maxLength={60}
                  />
                </label>
                <div className="exercise-editor-list">
                  {editData.exercises.map((ex, exIndex) => (
                    <div key={exIndex} className="exercise-editor-row">
                      <input
                        type="text"
                        placeholder="Exercício"
                        value={ex.name}
                        onChange={(e) => updateExercise(exIndex, 'name', e.target.value)}
                        maxLength={50}
                        aria-label={`Exercício ${exIndex + 1}`}
                      />
                      <input
                        type="text"
                        placeholder="Séries"
                        value={ex.sets}
                        onChange={(e) => updateExercise(exIndex, 'sets', e.target.value)}
                        maxLength={4}
                        aria-label={`Séries do exercício ${exIndex + 1}`}
                      />
                      <input
                        type="text"
                        placeholder="Reps"
                        value={ex.reps}
                        onChange={(e) => updateExercise(exIndex, 'reps', e.target.value)}
                        maxLength={8}
                        aria-label={`Repetições do exercício ${exIndex + 1}`}
                      />
                      <button
                        type="button"
                        className="icon-button small-icon danger-button"
                        onClick={() => removeExercise(exIndex)}
                        aria-label={`Remover exercício ${exIndex + 1}`}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="add-exercise-button" type="button" onClick={addExercise}>
                  <Plus size={17} />
                  <span>Exercício</span>
                </button>
                <label>
                  Observação
                  <textarea
                    value={editData.note}
                    onChange={(e) => setEditData({ ...editData, note: e.target.value })}
                    maxLength={160}
                    rows={2}
                  />
                </label>
                <div className="editor-actions">
                  <button className="primary-button" type="button" onClick={saveWorkout}>Salvar</button>
                  <button className="ghost-button" type="button" onClick={cancelEditing}>Cancelar</button>
                </div>
              </div>
            ) : (
              <>
                <div className="workout-card-head">
                  <span>{workout.day}</span>
                  <button
                    className="icon-button small-icon"
                    type="button"
                    onClick={() => startEditing(index)}
                    title={`Editar ${workout.day}`}
                    aria-label={`Editar treino de ${workout.day}`}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                </div>
                <h3>{workout.title}</h3>
                <div className="exercise-summary">
                  {workout.exercises.length > 0 ? (
                    workout.exercises.map((ex, exIndex) => (
                      <p key={exIndex}>
                        <strong>{ex.name}</strong>
                        <small>{ex.sets} x {ex.reps}</small>
                      </p>
                    ))
                  ) : (
                    <p className="tiny-note">Sem exercícios</p>
                  )}
                </div>
                {workout.note && <p className="workout-note">{workout.note}</p>}
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
