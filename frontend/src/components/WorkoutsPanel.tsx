import { useEffect, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Clock3,
  Dumbbell,
  History,
  Home,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  TimerReset,
  X,
} from 'lucide-react'
import {
  workoutSessionApi,
  type WorkoutHistory,
  type WorkoutInput,
  type WorkoutSession,
  type WorkoutTemplate,
} from '../services/workoutSessionApi'
import '../styles/workout-session.css'


interface WorkoutsPanelProps {
  userId: number
  isOpen: boolean
  onClose: () => void
  onSessionFinished?: () => void | Promise<void>
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

interface RestTimer {
  remaining: number
  running: boolean
}

const EMPTY_HISTORY: WorkoutHistory = {
  total_sessions: 0,
  total_minutes: 0,
  completed_sets: 0,
  total_volume_kg: '0.00',
  sessions: [],
}

export const HOME_DUMBBELL_PLAN: WorkoutInput[] = [
  {
    day: 'Seg',
    title: 'Peito e tríceps em casa',
    note: 'Use o chão ou um colchonete. Movimento controlado.',
    exercises: [
      { name: 'Supino no chão com halteres', sets: '3', reps: '10' },
      { name: 'Crucifixo no chão', sets: '3', reps: '12' },
      { name: 'Tríceps francês com halter', sets: '3', reps: '10' },
    ],
  },
  {
    day: 'Ter',
    title: 'Pernas com halteres',
    note: 'Mantenha o abdômen firme e priorize a execução.',
    exercises: [
      { name: 'Agachamento goblet', sets: '4', reps: '10' },
      { name: 'Levantamento terra romeno', sets: '3', reps: '10' },
      { name: 'Panturrilha em pé', sets: '3', reps: '15' },
    ],
  },
  {
    day: 'Qua',
    title: 'Recuperação',
    note: 'Caminhada leve ou 10 minutos de mobilidade.',
    exercises: [],
  },
  {
    day: 'Qui',
    title: 'Costas e bíceps em casa',
    note: 'Apoie uma mão em uma cadeira firme para a remada.',
    exercises: [
      { name: 'Remada unilateral com halter', sets: '3', reps: '10' },
      { name: 'Pullover no chão', sets: '3', reps: '12' },
      { name: 'Rosca alternada', sets: '3', reps: '10' },
    ],
  },
  {
    day: 'Sex',
    title: 'Ombros e corpo todo',
    note: 'Treino curto e completo para fechar a semana.',
    exercises: [
      { name: 'Desenvolvimento com halteres', sets: '3', reps: '10' },
      { name: 'Elevação lateral', sets: '3', reps: '12' },
      { name: 'Afundo alternado', sets: '3', reps: '10' },
      { name: 'Caminhada do fazendeiro', sets: '3', reps: '40s' },
    ],
  },
  {
    day: 'Sáb',
    title: 'Mobilidade',
    note: 'Alongamento leve, sem obrigação de carga.',
    exercises: [],
  },
  {
    day: 'Dom',
    title: 'Descanso',
    note: 'Recupere o corpo para a próxima semana.',
    exercises: [],
  },
]

export function formatTimer(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60
  if (hours > 0) {
    return [hours, minutes, seconds]
      .map(value => String(value).padStart(2, '0'))
      .join(':')
  }
  return [minutes, seconds]
    .map(value => String(value).padStart(2, '0'))
    .join(':')
}

export function parseWeight(value: string): string | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized)) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 500) return null
  return parsed.toFixed(2)
}

function plannedReps(value: string | null): string {
  return value?.match(/\d+/)?.[0] ?? ''
}

function normalizeDay(value: string): string {
  return value === 'SÃ¡b' ? 'Sáb' : value
}

function createIdempotencyKey(userId: number, workoutId: number): string {
  const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `workout-${userId}-${workoutId}-${randomPart}`
}

function sessionInputDefaults(session: WorkoutSession): {
  weights: Record<number, string>
  reps: Record<number, string>
} {
  const weights: Record<number, string> = {}
  const reps: Record<number, string> = {}
  for (const exercise of session.exercises) {
    let lastWeight = ''
    for (const set of exercise.sets) {
      if (set.weight_kg !== null) {
        lastWeight = String(Number(set.weight_kg))
      }
      weights[set.id] = set.weight_kg === null
        ? lastWeight
        : String(Number(set.weight_kg))
      reps[set.id] = set.reps_completed === null
        ? plannedReps(exercise.planned_reps)
        : String(set.reps_completed)
    }
  }
  return { weights, reps }
}

function historyDate(value: string | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(value))
}

export default function WorkoutsPanel({
  userId,
  isOpen,
  onClose,
  onSessionFinished,
}: WorkoutsPanelProps) {
  const [workouts, setWorkouts] = useState<WorkoutTemplate[]>([])
  const [activeSession, setActiveSession] = useState<WorkoutSession | null>(null)
  const [historyData, setHistoryData] = useState<WorkoutHistory>(EMPTY_HISTORY)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editData, setEditData] = useState<WorkoutData | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [restTimer, setRestTimer] = useState<RestTimer>({
    remaining: 0,
    running: false,
  })
  const [weightInputs, setWeightInputs] = useState<Record<number, string>>({})
  const [repInputs, setRepInputs] = useState<Record<number, string>>({})
  const [startingWorkoutId, setStartingWorkoutId] = useState<number | null>(null)
  const [savingSetId, setSavingSetId] = useState<number | null>(null)
  const [isFinishing, setIsFinishing] = useState(false)
  const [isApplyingPlan, setIsApplyingPlan] = useState(false)
  const [showFinishConfirm, setShowFinishConfirm] = useState(false)
  const [showPlanConfirm, setShowPlanConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const idempotencyKeys = useRef<Record<number, string>>({})

  useEffect(() => {
    if (!isOpen) return
    void loadPanel()
  }, [userId, isOpen])

  useEffect(() => {
    setRestTimer({ remaining: 0, running: false })
    setEditingIndex(null)
    setEditData(null)
    setShowFinishConfirm(false)
    setShowPlanConfirm(false)
    setError('')
  }, [userId])

  useEffect(() => {
    if (!activeSession) {
      setElapsedSeconds(0)
      return
    }
    const updateElapsed = () => {
      const startMs = new Date(activeSession.started_at).getTime()
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)))
    }
    updateElapsed()
    const interval = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(interval)
  }, [activeSession?.id, activeSession?.started_at])

  useEffect(() => {
    if (!restTimer.running || restTimer.remaining <= 0) return
    const interval = window.setInterval(() => {
      setRestTimer(current => {
        if (!current.running || current.remaining <= 1) {
          return { remaining: 0, running: false }
        }
        return { ...current, remaining: current.remaining - 1 }
      })
    }, 1000)
    return () => window.clearInterval(interval)
  }, [restTimer.running, restTimer.remaining > 0])

  function adoptSession(session: WorkoutSession | null) {
    setActiveSession(session)
    if (!session) {
      setWeightInputs({})
      setRepInputs({})
      return
    }
    const defaults = sessionInputDefaults(session)
    setWeightInputs(defaults.weights)
    setRepInputs(defaults.reps)
  }

  async function loadPanel() {
    setLoading(true)
    setError('')
    try {
      const [templates, session, history] = await Promise.all([
        workoutSessionApi.getWorkouts(userId),
        workoutSessionApi.getActiveSession(userId),
        workoutSessionApi.getHistory(userId),
      ])
      setWorkouts(templates)
      adoptSession(session)
      setHistoryData(history)
    } catch {
      setError('Não foi possível carregar seus treinos agora.')
    } finally {
      setLoading(false)
    }
  }

  function startEditing(index: number) {
    const workout = workouts[index]
    setEditingIndex(index)
    setEditData({
      day: normalizeDay(workout.day),
      title: workout.title,
      note: workout.note || '',
      exercises: workout.exercises.map(exercise => ({
        name: exercise.name,
        sets: exercise.sets,
        reps: exercise.reps,
      })),
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
      exercises: [
        ...editData.exercises,
        { name: '', sets: '3', reps: '10' },
      ],
    })
  }

  function removeExercise(index: number) {
    if (!editData) return
    setEditData({
      ...editData,
      exercises: editData.exercises.filter((_, itemIndex) => itemIndex !== index),
    })
  }

  function updateExercise(
    index: number,
    field: keyof ExerciseData,
    value: string,
  ) {
    if (!editData) return
    const newExercises = [...editData.exercises]
    newExercises[index] = { ...newExercises[index], [field]: value }
    setEditData({ ...editData, exercises: newExercises })
  }

  async function saveWorkout() {
    if (!editData || editingIndex === null) return
    if (!editData.title.trim()) {
      setError('Dê um nome para o treino.')
      return
    }
    const validExercises = editData.exercises.filter(exercise => exercise.name.trim())
    const updatedWorkouts: WorkoutInput[] = workouts.map((workout, index) => {
      if (index === editingIndex) {
        return {
          ...editData,
          title: editData.title.trim(),
          note: editData.note.trim(),
          exercises: validExercises.map(exercise => ({
            ...exercise,
            name: exercise.name.trim(),
          })),
        }
      }
      return {
        day: normalizeDay(workout.day),
        title: workout.title,
        note: workout.note || '',
        exercises: workout.exercises.map(exercise => ({
          name: exercise.name,
          sets: exercise.sets,
          reps: exercise.reps,
        })),
      }
    })

    setError('')
    try {
      const saved = await workoutSessionApi.replaceWorkouts(userId, updatedWorkouts)
      setWorkouts(saved)
      cancelEditing()
    } catch {
      setError('Não foi possível salvar a alteração do treino.')
    }
  }

  async function applyHomePlan() {
    setIsApplyingPlan(true)
    setError('')
    try {
      const saved = await workoutSessionApi.replaceWorkouts(
        userId,
        HOME_DUMBBELL_PLAN,
      )
      setWorkouts(saved)
      setShowPlanConfirm(false)
      cancelEditing()
    } catch {
      setError('Não foi possível aplicar o plano para casa.')
    } finally {
      setIsApplyingPlan(false)
    }
  }

  async function startSession(workout: WorkoutTemplate) {
    if (workout.exercises.length === 0) return
    setStartingWorkoutId(workout.id)
    setError('')
    const key = idempotencyKeys.current[workout.id]
      ?? createIdempotencyKey(userId, workout.id)
    idempotencyKeys.current[workout.id] = key
    try {
      const session = await workoutSessionApi.startSession(
        userId,
        workout.id,
        key,
        60,
      )
      delete idempotencyKeys.current[workout.id]
      adoptSession(session)
      setRestTimer({ remaining: 0, running: false })
    } catch {
      setError('Não foi possível iniciar. Verifique se já existe um treino aberto.')
    } finally {
      setStartingWorkoutId(null)
    }
  }

  async function completeSet(setId: number) {
    if (!activeSession) return
    const weight = parseWeight(weightInputs[setId] ?? '')
    if (weight === null) {
      setError('Informe um peso válido, como 8 ou 8,5 kg.')
      return
    }
    const repsText = repInputs[setId]?.trim() ?? ''
    const reps = repsText ? Number(repsText) : undefined
    if (reps !== undefined && (!Number.isInteger(reps) || reps < 1 || reps > 1000)) {
      setError('Informe uma quantidade válida de repetições.')
      return
    }

    setSavingSetId(setId)
    setError('')
    try {
      const session = await workoutSessionApi.setSetState(setId, {
        completed: true,
        weight_kg: weight,
        ...(reps === undefined ? {} : { reps_completed: reps }),
      })
      adoptSession(session)
      if (session.completed_sets < session.total_sets) {
        setRestTimer({
          remaining: session.rest_seconds,
          running: true,
        })
      }
    } catch {
      setError('Não foi possível registrar esta série.')
    } finally {
      setSavingSetId(null)
    }
  }

  async function clearSet(setId: number) {
    setSavingSetId(setId)
    setError('')
    try {
      const session = await workoutSessionApi.setSetState(setId, {
        completed: false,
      })
      adoptSession(session)
    } catch {
      setError('Não foi possível desfazer esta série.')
    } finally {
      setSavingSetId(null)
    }
  }

  async function finishSession() {
    if (!activeSession) return
    setIsFinishing(true)
    setError('')
    try {
      await workoutSessionApi.finishSession(activeSession.id)
      adoptSession(null)
      setRestTimer({ remaining: 0, running: false })
      setShowFinishConfirm(false)

      const followUpErrors: string[] = []
      try {
        const history = await workoutSessionApi.getHistory(userId)
        setHistoryData(history)
      } catch {
        followUpErrors.push('o histórico será atualizado ao abrir novamente')
      }
      try {
        await onSessionFinished?.()
      } catch {
        followUpErrors.push('o hábito não pôde ser marcado automaticamente')
      }
      if (followUpErrors.length > 0) {
        setError(`Treino salvo; ${followUpErrors.join(' e ')}.`)
      }
    } catch {
      setError('Conclua pelo menos uma série antes de finalizar o treino.')
    } finally {
      setIsFinishing(false)
    }
  }

  if (!isOpen) return null

  const todayDay = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][new Date().getDay()]

  return (
    <section className="panel workout-panel guided-workout-panel">
      <div className="panel-head guided-workout-head">
        <div>
          <p className="section-label">Treino em casa</p>
          <h2>{activeSession ? 'Treino em andamento' : 'Seus treinos com halteres'}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          type="button"
          title="Fechar treinos"
          aria-label="Fechar treinos"
        >
          <X size={18} />
        </button>
      </div>

      {error && <p className="workout-session-alert" role="alert">{error}</p>}
      {loading && <p className="workout-session-loading">Preparando seus treinos…</p>}

      {!loading && activeSession ? (
        <div className="guided-session" aria-label="Treino guiado em andamento">
          <header className="guided-session-hero">
            <div>
              <span className="guided-live-chip"><span /> AO VIVO</span>
              <p>{activeSession.workout_day}</p>
              <h3>{activeSession.workout_title}</h3>
            </div>
            <div className="guided-main-timer" aria-label="Tempo total de treino">
              <Clock3 size={19} aria-hidden="true" />
              <span>Tempo total</span>
              <strong>{formatTimer(elapsedSeconds)}</strong>
            </div>
          </header>

          <div className="guided-progress-row">
            <div>
              <span>Séries concluídas</span>
              <strong>{activeSession.completed_sets} de {activeSession.total_sets}</strong>
            </div>
            <div
              className="guided-progress-track"
              role="progressbar"
              aria-label="Progresso das séries"
              aria-valuemin={0}
              aria-valuemax={activeSession.total_sets}
              aria-valuenow={activeSession.completed_sets}
            >
              <span
                style={{
                  width: `${activeSession.total_sets
                    ? (activeSession.completed_sets / activeSession.total_sets) * 100
                    : 0}%`,
                }}
              />
            </div>
          </div>

          {restTimer.remaining > 0 && (
            <aside className="guided-rest-card" aria-label="Cronômetro de descanso">
              <div className="guided-rest-clock">
                <TimerReset size={22} aria-hidden="true" />
                <div>
                  <span>Descanso</span>
                  <strong role="timer">{formatTimer(restTimer.remaining)}</strong>
                </div>
              </div>
              <div className="guided-rest-actions">
                <button
                  type="button"
                  onClick={() => setRestTimer(current => ({
                    ...current,
                    running: !current.running,
                  }))}
                >
                  {restTimer.running
                    ? <Pause size={16} aria-hidden="true" />
                    : <Play size={16} aria-hidden="true" />}
                  {restTimer.running ? 'Pausar' : 'Continuar'}
                </button>
                <button
                  type="button"
                  onClick={() => setRestTimer(current => ({
                    ...current,
                    remaining: Math.min(current.remaining + 30, 600),
                  }))}
                >
                  <Plus size={16} aria-hidden="true" />
                  30s
                </button>
                <button
                  type="button"
                  onClick={() => setRestTimer({ remaining: 0, running: false })}
                >
                  <SkipForward size={16} aria-hidden="true" />
                  Pular
                </button>
              </div>
            </aside>
          )}

          <div className="guided-exercise-list">
            {activeSession.exercises.map((exercise, exerciseIndex) => {
              const exerciseDone = exercise.sets.every(set => set.completed_at)
              return (
                <article
                  key={exercise.id}
                  className={`guided-exercise-card ${exerciseDone ? 'is-complete' : ''}`}
                >
                  <div className="guided-exercise-head">
                    <span>{String(exerciseIndex + 1).padStart(2, '0')}</span>
                    <div>
                      <h4>{exercise.name}</h4>
                      <p>
                        {exercise.target_sets} séries
                        {exercise.planned_reps ? ` • ${exercise.planned_reps} reps` : ''}
                      </p>
                    </div>
                    {exerciseDone && <CheckCircle2 size={20} aria-label="Exercício concluído" />}
                  </div>
                  <div className="guided-set-list">
                    <div className="guided-set-labels" aria-hidden="true">
                      <span>Série</span>
                      <span>Peso usado</span>
                      <span>Reps</span>
                      <span />
                    </div>
                    {exercise.sets.map(set => {
                      const completed = Boolean(set.completed_at)
                      return (
                        <div
                          key={set.id}
                          className={`guided-set-row ${completed ? 'is-complete' : ''}`}
                        >
                          <strong>{set.set_number}</strong>
                          <label>
                            <span className="sr-only">Peso da série {set.set_number}</span>
                            <input
                              value={weightInputs[set.id] ?? ''}
                              onChange={event => setWeightInputs(current => ({
                                ...current,
                                [set.id]: event.target.value,
                              }))}
                              inputMode="decimal"
                              placeholder="0,0"
                              disabled={completed}
                              aria-label={`Peso da série ${set.set_number} em kg`}
                            />
                            <small>kg</small>
                          </label>
                          <input
                            className="guided-reps-input"
                            value={repInputs[set.id] ?? ''}
                            onChange={event => setRepInputs(current => ({
                              ...current,
                              [set.id]: event.target.value.replace(/\D/g, ''),
                            }))}
                            inputMode="numeric"
                            placeholder="—"
                            disabled={completed}
                            aria-label={`Repetições da série ${set.set_number}`}
                          />
                          {completed ? (
                            <button
                              className="guided-set-undo"
                              type="button"
                              onClick={() => void clearSet(set.id)}
                              disabled={savingSetId === set.id}
                              aria-label={`Desfazer série ${set.set_number}`}
                            >
                              <RotateCcw size={15} aria-hidden="true" />
                            </button>
                          ) : (
                            <button
                              className="guided-set-complete"
                              type="button"
                              onClick={() => void completeSet(set.id)}
                              disabled={savingSetId === set.id}
                              aria-label={`Concluir série ${set.set_number}`}
                            >
                              <Check size={17} aria-hidden="true" />
                              <span>Feita</span>
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </article>
              )
            })}
          </div>

          <div className="guided-finish-bar">
            <div>
              <span>{activeSession.completed_sets}/{activeSession.total_sets} séries</span>
              <strong>{Number(activeSession.max_weight_kg).toLocaleString('pt-BR')} kg máximo</strong>
            </div>
            <button
              type="button"
              onClick={() => setShowFinishConfirm(true)}
              disabled={activeSession.completed_sets === 0}
            >
              <CheckCircle2 size={18} aria-hidden="true" />
              Finalizar treino
            </button>
          </div>
        </div>
      ) : !loading && (
        <>
          <article className="home-workout-callout">
            <span className="home-workout-icon"><Home size={22} aria-hidden="true" /></span>
            <div>
              <p className="section-label">Feito para o que você tem</p>
              <h3>Plano caseiro, somente com halteres</h3>
              <p>Quatro dias de força, descansos leves e exercícios sem aparelhos de academia.</p>
            </div>
            <button type="button" onClick={() => setShowPlanConfirm(true)}>
              <Dumbbell size={17} aria-hidden="true" />
              Usar este plano
            </button>
          </article>

          <div className="workout-list guided-template-list">
            {workouts.map((workout, index) => {
              const isToday = normalizeDay(workout.day) === todayDay
              return (
                <article
                  key={workout.id}
                  className={`workout-day guided-template-card ${isToday ? 'today-workout' : ''}`}
                >
                  {editingIndex === index && editData ? (
                    <div className="workout-editor guided-workout-editor">
                      <label>
                        Treino do dia
                        <input
                          type="text"
                          value={editData.title}
                          onChange={event => setEditData({
                            ...editData,
                            title: event.target.value,
                          })}
                          maxLength={200}
                        />
                      </label>
                      <div className="exercise-editor-list">
                        {editData.exercises.map((exercise, exerciseIndex) => (
                          <div key={exerciseIndex} className="exercise-editor-row">
                            <input
                              type="text"
                              placeholder="Exercício"
                              value={exercise.name}
                              onChange={event => updateExercise(
                                exerciseIndex,
                                'name',
                                event.target.value,
                              )}
                              maxLength={100}
                              aria-label={`Exercício ${exerciseIndex + 1}`}
                            />
                            <input
                              type="text"
                              placeholder="Séries"
                              value={exercise.sets}
                              onChange={event => updateExercise(
                                exerciseIndex,
                                'sets',
                                event.target.value.replace(/\D/g, '').slice(0, 2),
                              )}
                              maxLength={2}
                              inputMode="numeric"
                              aria-label={`Séries do exercício ${exerciseIndex + 1}`}
                            />
                            <input
                              type="text"
                              placeholder="Reps"
                              value={exercise.reps}
                              onChange={event => updateExercise(
                                exerciseIndex,
                                'reps',
                                event.target.value,
                              )}
                              maxLength={20}
                              aria-label={`Repetições do exercício ${exerciseIndex + 1}`}
                            />
                            <button
                              type="button"
                              className="icon-button small-icon danger-button"
                              onClick={() => removeExercise(exerciseIndex)}
                              aria-label={`Remover exercício ${exerciseIndex + 1}`}
                            >
                              <X size={16} aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        className="add-exercise-button"
                        type="button"
                        onClick={addExercise}
                      >
                        <Plus size={17} aria-hidden="true" />
                        <span>Exercício</span>
                      </button>
                      <label>
                        Observação
                        <textarea
                          value={editData.note}
                          onChange={event => setEditData({
                            ...editData,
                            note: event.target.value,
                          })}
                          maxLength={2000}
                          rows={2}
                        />
                      </label>
                      <div className="editor-actions">
                        <button
                          className="primary-button"
                          type="button"
                          onClick={() => void saveWorkout()}
                        >
                          Salvar
                        </button>
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={cancelEditing}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="workout-card-head">
                        <span>{normalizeDay(workout.day)}{isToday ? ' • hoje' : ''}</span>
                        <button
                          className="icon-button small-icon"
                          type="button"
                          onClick={() => startEditing(index)}
                          title={`Editar ${normalizeDay(workout.day)}`}
                          aria-label={`Editar treino de ${normalizeDay(workout.day)}`}
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <h3>{workout.title}</h3>
                      <div className="exercise-summary">
                        {workout.exercises.length > 0 ? (
                          workout.exercises.map(exercise => (
                            <p key={exercise.id}>
                              <strong>{exercise.name}</strong>
                              <small>{exercise.sets} × {exercise.reps}</small>
                            </p>
                          ))
                        ) : (
                          <p className="tiny-note">Recuperação, sem treino guiado</p>
                        )}
                      </div>
                      {workout.note && <p className="workout-note">{workout.note}</p>}
                      {workout.exercises.length > 0 && (
                        <button
                          className="guided-start-button"
                          type="button"
                          onClick={() => void startSession(workout)}
                          disabled={startingWorkoutId !== null}
                        >
                          <Play size={17} fill="currentColor" aria-hidden="true" />
                          {startingWorkoutId === workout.id
                            ? 'Iniciando…'
                            : 'Iniciar treino'}
                        </button>
                      )}
                    </>
                  )}
                </article>
              )
            })}
          </div>
        </>
      )}

      {!loading && historyData.sessions.length > 0 && !activeSession && (
        <section className="workout-history-section">
          <div className="workout-history-head">
            <div>
              <p className="section-label">Seu histórico</p>
              <h3>Treinos concluídos</h3>
            </div>
            <History size={20} aria-hidden="true" />
          </div>
          <div className="workout-history-summary">
            <span>
              <strong>{historyData.total_sessions}</strong>
              {historyData.total_sessions === 1 ? ' sessão' : ' sessões'}
            </span>
            <span>
              <strong>{historyData.completed_sets}</strong>
              {historyData.completed_sets === 1 ? ' série' : ' séries'}
            </span>
            <span>
              <strong>{historyData.total_minutes}</strong>
              {historyData.total_minutes === 1 ? ' minuto' : ' minutos'}
            </span>
          </div>
          <div className="workout-history-list">
            {historyData.sessions.map(session => (
              <article key={session.id}>
                <span className="workout-history-date">{historyDate(session.completed_at)}</span>
                <div>
                  <strong>{session.workout_title}</strong>
                  <small>
                    {session.completed_sets}
                    {session.completed_sets === 1 ? ' série' : ' séries'}
                    {' • '}
                    {formatTimer(session.duration_seconds ?? 0)}
                  </small>
                </div>
                <span className="workout-history-weight">
                  <Dumbbell size={15} aria-hidden="true" />
                  {Number(session.max_weight_kg).toLocaleString('pt-BR')} kg
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      {showPlanConfirm && (
        <div className="workout-modal-backdrop" role="presentation">
          <div
            className="workout-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-plan-title"
          >
            <span className="workout-dialog-icon"><Home size={23} /></span>
            <h3 id="home-plan-title">Aplicar plano para casa?</h3>
            <p>Isso troca sua grade semanal atual. Treinos já concluídos continuam no histórico.</p>
            <div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setShowPlanConfirm(false)}
                disabled={isApplyingPlan}
              >
                Manter o atual
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void applyHomePlan()}
                disabled={isApplyingPlan}
              >
                {isApplyingPlan ? 'Aplicando…' : 'Aplicar plano'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFinishConfirm && activeSession && (
        <div className="workout-modal-backdrop" role="presentation">
          <div
            className="workout-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="finish-workout-title"
          >
            <span className="workout-dialog-icon"><CheckCircle2 size={23} /></span>
            <h3 id="finish-workout-title">Finalizar este treino?</h3>
            <p>
              Você concluiu {activeSession.completed_sets} de {activeSession.total_sets} séries
              em {formatTimer(elapsedSeconds)}.
            </p>
            <div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setShowFinishConfirm(false)}
                disabled={isFinishing}
              >
                Continuar treino
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void finishSession()}
                disabled={isFinishing}
              >
                {isFinishing ? 'Salvando…' : 'Finalizar agora'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
