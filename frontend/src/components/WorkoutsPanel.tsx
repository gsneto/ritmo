import { useEffect, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Clock3,
  Dumbbell,
  History,
  Home,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  TimerReset,
  Trash2,
  TrendingUp,
  Trophy,
  Video,
  X,
} from 'lucide-react'
import {
  workoutSessionApi,
  type WorkoutExerciseProgress,
  type WorkoutHistory,
  type WorkoutInput,
  type WorkoutSession,
  type WorkoutSessionExercise,
  type WorkoutSessionSet,
  type WorkoutTemplate,
} from '../services/workoutSessionApi'
import { useWorkoutTimers } from '../hooks/useWorkoutTimers'
import { getExerciseVideo } from '../utils/exerciseVideos'
import '../styles/workout-session.css'


interface WorkoutsPanelProps {
  userId: number
  isOpen: boolean
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

type GuidedStep = 'weight' | 'ready' | 'series' | 'rest' | 'complete'

interface GuidedSetContext {
  exercise: WorkoutSessionExercise
  exerciseIndex: number
  set: WorkoutSessionSet
}

const GUIDED_STEPS: Array<{ id: Exclude<GuidedStep, 'complete'>; label: string }> = [
  { id: 'weight', label: 'Peso' },
  { id: 'ready', label: 'Confirmar' },
  { id: 'series', label: 'Série' },
  { id: 'rest', label: 'Descanso' },
]

const STALE_SESSION_SECONDS = 4 * 60 * 60

const EMPTY_HISTORY: WorkoutHistory = {
  total_sessions: 0,
  total_minutes: 0,
  completed_sets: 0,
  total_volume_kg: '0.00',
  sessions: [],
  exercise_progress: [],
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

function exerciseKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
}

function formatKg(value: string | number | null): string {
  if (value === null) return '—'
  return Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

export function sessionInputDefaults(session: WorkoutSession): {
  weights: Record<number, string>
  reps: Record<number, string>
} {
  const weights: Record<number, string> = {}
  const reps: Record<number, string> = {}
  for (const exercise of session.exercises) {
    let lastWeight = ''
    for (const set of exercise.sets) {
      const previousSet = exercise.progress?.last_sets.find(
        previous => previous.set_number === set.set_number,
      )
      if (set.weight_kg !== null) {
        lastWeight = String(Number(set.weight_kg))
      }
      weights[set.id] = set.weight_kg === null
        ? (
            previousSet
              ? String(Number(previousSet.weight_kg))
              : lastWeight || (
                  exercise.progress?.last_weight_kg === null
                    || exercise.progress?.last_weight_kg === undefined
                    ? ''
                    : String(Number(exercise.progress.last_weight_kg))
                )
          )
        : String(Number(set.weight_kg))
      reps[set.id] = set.reps_completed === null
        ? (
            previousSet?.reps_completed === null
              || previousSet?.reps_completed === undefined
              ? plannedReps(exercise.planned_reps)
              : String(previousSet.reps_completed)
          )
        : String(set.reps_completed)
    }
  }
  return { weights, reps }
}

export function findNextIncompleteSet(
  session: WorkoutSession,
): GuidedSetContext | null {
  for (const [exerciseIndex, exercise] of session.exercises.entries()) {
    const set = exercise.sets.find(item => !item.completed_at)
    if (set) return { exercise, exerciseIndex, set }
  }
  return null
}

function findSetContext(
  session: WorkoutSession,
  setId: number | null,
): GuidedSetContext | null {
  if (setId === null) return null
  for (const [exerciseIndex, exercise] of session.exercises.entries()) {
    const set = exercise.sets.find(item => item.id === setId)
    if (set) return { exercise, exerciseIndex, set }
  }
  return null
}

function elapsedThroughLastCompletedSet(session: WorkoutSession): number | null {
  const startedAt = Date.parse(session.started_at)
  if (!Number.isFinite(startedAt)) return null

  let lastCompletedSetAt: number | null = null
  for (const exercise of session.exercises) {
    for (const set of exercise.sets) {
      if (!set.completed_at) continue
      const completedAt = Date.parse(set.completed_at)
      if (!Number.isFinite(completedAt)) continue
      lastCompletedSetAt = Math.max(lastCompletedSetAt ?? completedAt, completedAt)
    }
  }

  return lastCompletedSetAt === null
    ? null
    : Math.max(0, Math.floor((lastCompletedSetAt - startedAt) / 1000))
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
  onSessionFinished,
}: WorkoutsPanelProps) {
  const [workouts, setWorkouts] = useState<WorkoutTemplate[]>([])
  const [activeSession, setActiveSession] = useState<WorkoutSession | null>(null)
  const [historyData, setHistoryData] = useState<WorkoutHistory>(EMPTY_HISTORY)
  const [preparedWorkout, setPreparedWorkout] = useState<WorkoutTemplate | null>(null)
  const [guidedStep, setGuidedStep] = useState<GuidedStep>('weight')
  const [currentSetId, setCurrentSetId] = useState<number | null>(null)
  const [preparedWeight, setPreparedWeight] = useState('')
  const [preparedReps, setPreparedReps] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editData, setEditData] = useState<WorkoutData | null>(null)
  const [weightInputs, setWeightInputs] = useState<Record<number, string>>({})
  const [repInputs, setRepInputs] = useState<Record<number, string>>({})
  const [startingWorkoutId, setStartingWorkoutId] = useState<number | null>(null)
  const [savingSetId, setSavingSetId] = useState<number | null>(null)
  const [savingPreferenceKey, setSavingPreferenceKey] = useState<string | null>(null)
  const [isFinishing, setIsFinishing] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const [isApplyingPlan, setIsApplyingPlan] = useState(false)
  const [showFinishConfirm, setShowFinishConfirm] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const [showPlanConfirm, setShowPlanConfirm] = useState(false)
  const [showExerciseVideo, setShowExerciseVideo] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const idempotencyKeys = useRef<Record<number, string>>({})
  const {
    elapsedSeconds,
    seriesElapsedSeconds,
    setSeriesElapsedSeconds,
    setSetStartedAt,
    restTimer,
    setRestTimer,
  } = useWorkoutTimers(activeSession, guidedStep)

  useEffect(() => {
    if (!isOpen) return
    void loadPanel()
  }, [userId, isOpen])

  useEffect(() => {
    setRestTimer({ remaining: 0, running: false })
    setPreparedWorkout(null)
    setGuidedStep('weight')
    setCurrentSetId(null)
    setPreparedWeight('')
    setPreparedReps('')
    setSeriesElapsedSeconds(0)
    setSetStartedAt(null)
    setEditingIndex(null)
    setEditData(null)
    setShowFinishConfirm(false)
    setShowDiscardConfirm(false)
    setShowPlanConfirm(false)
    setShowExerciseVideo(false)
    setError('')
  }, [userId])

  useEffect(() => {
    if (guidedStep === 'series' || guidedStep === 'rest' || guidedStep === 'complete') {
      setShowExerciseVideo(false)
    }
  }, [guidedStep])

  useEffect(() => {
    if (
      guidedStep === 'rest'
      && restTimer.remaining === 0
      && !restTimer.running
    ) {
      setGuidedStep('weight')
    }
  }, [guidedStep, restTimer.remaining, restTimer.running])

  function adoptSession(session: WorkoutSession | null, resetGuide = false) {
    setActiveSession(session)
    if (!session) {
      setWeightInputs({})
      setRepInputs({})
      setCurrentSetId(null)
      setGuidedStep('weight')
      setSetStartedAt(null)
      setSeriesElapsedSeconds(0)
      return
    }
    const defaults = sessionInputDefaults(session)
    setWeightInputs(defaults.weights)
    setRepInputs(defaults.reps)
    if (resetGuide) {
      const next = findNextIncompleteSet(session)
      setCurrentSetId(next?.set.id ?? null)
      setGuidedStep(next ? 'weight' : 'complete')
      setSetStartedAt(null)
      setSeriesElapsedSeconds(0)
    }
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
      adoptSession(session, true)
      setHistoryData({
        ...history,
        exercise_progress: history.exercise_progress ?? [],
      })
    } catch {
      setError('Não foi possível carregar seus treinos agora.')
    } finally {
      setLoading(false)
    }
  }

  function adoptExerciseProgress(progress: WorkoutExerciseProgress) {
    const key = exerciseKey(progress.exercise_name)
    setActiveSession(current => {
      if (!current) return current
      return {
        ...current,
        exercises: current.exercises.map(exercise => (
          exerciseKey(exercise.name) === key
            ? { ...exercise, progress }
            : exercise
        )),
      }
    })
    setHistoryData(current => {
      const existing = current.exercise_progress ?? []
      const next = existing.some(item => exerciseKey(item.exercise_name) === key)
        ? existing.map(item => (
            exerciseKey(item.exercise_name) === key ? progress : item
          ))
        : [...existing, progress]
      return {
        ...current,
        exercise_progress: next.sort((left, right) => (
          left.exercise_name.localeCompare(right.exercise_name, 'pt-BR')
        )),
      }
    })
  }

  async function updateExercisePreference(
    progress: WorkoutExerciseProgress,
    restSeconds: number,
    incrementKg: string,
  ) {
    const key = exerciseKey(progress.exercise_name)
    setSavingPreferenceKey(key)
    setError('')
    try {
      const saved = await workoutSessionApi.updateExercisePreference(
        userId,
        progress.exercise_name,
        restSeconds,
        incrementKg,
      )
      adoptExerciseProgress(saved)
    } catch {
      setError('Não foi possível salvar o descanso e a progressão deste exercício.')
    } finally {
      setSavingPreferenceKey(null)
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

  function prepareSession(workout: WorkoutTemplate) {
    if (workout.exercises.length === 0) return
    const firstExercise = workout.exercises[0]
    const progress = historyData.exercise_progress.find(item => (
      exerciseKey(item.exercise_name) === exerciseKey(firstExercise.name)
    ))
    const suggestedWeight = progress?.suggested_weight_kg
      ?? progress?.last_weight_kg
      ?? ''
    setPreparedWorkout(workout)
    setPreparedWeight(
      suggestedWeight === '' ? '' : String(Number(suggestedWeight)),
    )
    setPreparedReps(plannedReps(firstExercise.reps))
    setGuidedStep('weight')
    setCurrentSetId(null)
    setRestTimer({ remaining: 0, running: false })
    setSetStartedAt(null)
    setSeriesElapsedSeconds(0)
    setShowExerciseVideo(false)
    setError('')
  }

  function cancelPreparation() {
    setPreparedWorkout(null)
    setPreparedWeight('')
    setPreparedReps('')
    setGuidedStep('weight')
    setShowExerciseVideo(false)
    setError('')
  }

  function validateCurrentSet(): boolean {
    const weightText = preparedWorkout
      ? preparedWeight
      : (currentSetId === null ? '' : weightInputs[currentSetId] ?? '')
    if (parseWeight(weightText) === null) {
      setError('Informe o peso que você vai usar, como 8 ou 8,5 kg.')
      return false
    }
    const repsText = preparedWorkout
      ? preparedReps.trim()
      : (currentSetId === null ? '' : repInputs[currentSetId]?.trim() ?? '')
    const reps = repsText ? Number(repsText) : undefined
    if (reps !== undefined && (!Number.isInteger(reps) || reps < 1 || reps > 1000)) {
      setError('Informe uma quantidade válida de repetições.')
      return false
    }
    setError('')
    return true
  }

  function advanceToConfirmation() {
    if (!validateCurrentSet()) return
    setGuidedStep('ready')
  }

  async function startCurrentSeries() {
    if (!validateCurrentSet()) return
    if (activeSession && currentSetId !== null) {
      setGuidedStep('series')
      setSetStartedAt(Date.now())
      setSeriesElapsedSeconds(0)
      return
    }
    if (!preparedWorkout) return

    const workout = preparedWorkout
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
      const next = findNextIncompleteSet(session)
      if (!next) {
        setError('Este treino não possui uma série disponível.')
        setGuidedStep('complete')
        return
      }
      const defaults = sessionInputDefaults(session)
      setWeightInputs({
        ...defaults.weights,
        [next.set.id]: String(Number(parseWeight(preparedWeight))),
      })
      setRepInputs({
        ...defaults.reps,
        [next.set.id]: preparedReps.trim(),
      })
      setCurrentSetId(next.set.id)
      setPreparedWorkout(null)
      setGuidedStep('series')
      setSetStartedAt(Date.now())
      setSeriesElapsedSeconds(0)
      setRestTimer({ remaining: 0, running: false })
    } catch {
      setError('Não foi possível começar a série. Verifique sua conexão e tente novamente.')
    } finally {
      setStartingWorkoutId(null)
    }
  }

  async function completeCurrentSet() {
    if (!activeSession || currentSetId === null) return
    const setId = currentSetId
    const context = findSetContext(activeSession, setId)
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
      setSetStartedAt(null)
      setSeriesElapsedSeconds(0)
      const next = findNextIncompleteSet(session)
      if (next) {
        setCurrentSetId(next.set.id)
        setRestTimer({
          remaining: context?.exercise.progress?.rest_seconds
            ?? session.rest_seconds,
          running: true,
        })
        setGuidedStep('rest')
      } else {
        setCurrentSetId(null)
        setRestTimer({ remaining: 0, running: false })
        setGuidedStep('complete')
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
      setCurrentSetId(setId)
      setRestTimer({ remaining: 0, running: false })
      setGuidedStep('weight')
      setSetStartedAt(null)
      setSeriesElapsedSeconds(0)
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
        setHistoryData({
          ...history,
          exercise_progress: history.exercise_progress ?? [],
        })
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

  async function discardSession() {
    if (!activeSession) return
    setIsDiscarding(true)
    setError('')
    try {
      await workoutSessionApi.discardSession(activeSession.id)
      adoptSession(null)
      setRestTimer({ remaining: 0, running: false })
      setShowDiscardConfirm(false)
    } catch {
      setError('Não foi possível cancelar este treino. Tente novamente.')
    } finally {
      setIsDiscarding(false)
    }
  }

  if (!isOpen) return null

  const todayDay = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][new Date().getDay()]
  const exerciseProgress = historyData.exercise_progress ?? []
  const progressByExercise = new Map(
    exerciseProgress.map(progress => [exerciseKey(progress.exercise_name), progress]),
  )
  const currentContext = activeSession
    ? findSetContext(activeSession, currentSetId)
    : null
  const isStaleActiveSession = activeSession !== null
    && elapsedSeconds >= STALE_SESSION_SECONDS
  const lastCompletedSetElapsedSeconds = activeSession
    ? elapsedThroughLastCompletedSet(activeSession)
    : null
  const finishDurationSeconds = isStaleActiveSession && lastCompletedSetElapsedSeconds !== null
    ? lastCompletedSetElapsedSeconds
    : elapsedSeconds
  const preparedExercise = preparedWorkout?.exercises[0] ?? null
  const currentExerciseName = currentContext?.exercise.name
    ?? preparedExercise?.name
    ?? ''
  const currentExerciseVideo = getExerciseVideo(currentExerciseName)
  const currentProgress = currentContext?.exercise.progress
    ?? (
      preparedExercise
        ? progressByExercise.get(exerciseKey(preparedExercise.name))
        : null
    )
  const currentWeight = preparedWorkout
    ? preparedWeight
    : (
        currentSetId === null
          ? ''
          : weightInputs[currentSetId] ?? ''
      )
  const currentReps = preparedWorkout
    ? preparedReps
    : (
        currentSetId === null
          ? ''
          : repInputs[currentSetId] ?? ''
      )
  const currentSetNumber = currentContext?.set.set_number ?? 1
  const currentTargetSets = currentContext?.exercise.target_sets
    ?? preparedExercise?.sets
    ?? '—'
  const currentPlannedReps = currentContext?.exercise.planned_reps
    ?? preparedExercise?.reps
    ?? null
  const guidedStepIndex = guidedStep === 'complete'
    ? GUIDED_STEPS.length
    : GUIDED_STEPS.findIndex(step => step.id === guidedStep)
  const guidedStatus = guidedStep === 'series'
    ? 'SÉRIE EM ANDAMENTO'
    : guidedStep === 'rest'
      ? 'DESCANSO'
      : guidedStep === 'complete'
        ? 'TREINO CONCLUÍDO'
        : 'PREPARANDO'
  const currentRestOptions = Array.from(new Set([
    45,
    60,
    75,
    90,
    120,
    currentProgress?.rest_seconds ?? 60,
  ])).sort((left, right) => left - right)
  const currentIncrementOptions = Array.from(new Set([
    '0.50',
    '1.00',
    '2.00',
    currentProgress ? Number(currentProgress.increment_kg).toFixed(2) : '1.00',
  ])).sort((left, right) => Number(left) - Number(right))
  const preferenceIsSaving = currentProgress
    ? savingPreferenceKey === exerciseKey(currentProgress.exercise_name)
    : false

  return (
    <section className="panel workout-panel guided-workout-panel">
      <div className="panel-head guided-workout-head">
        <div>
          <p className="section-label">Treino em casa</p>
          <h2>{activeSession ? 'Treino em andamento' : 'Seus treinos com halteres'}</h2>
        </div>
      </div>

      {error && <p className="workout-session-alert" role="alert">{error}</p>}
      {loading && <p className="workout-session-loading">Preparando seus treinos…</p>}

      {!loading && (activeSession || preparedWorkout) ? (
        <div className="guided-session" aria-label="Treino guiado em andamento">
          <header className="guided-session-hero">
            <div>
              <span className="guided-live-chip"><span /> {guidedStatus}</span>
              <p>{activeSession?.workout_day ?? preparedWorkout?.day}</p>
              <h3>{activeSession?.workout_title ?? preparedWorkout?.title}</h3>
            </div>
            <div className="guided-main-timer" aria-label="Tempo total de treino">
              <Clock3 size={19} aria-hidden="true" />
              <span>
                {activeSession
                  ? isStaleActiveSession
                    ? 'Treino interrompido'
                    : 'Tempo total'
                  : 'Cronômetro'}
              </span>
              <strong>
                {activeSession
                  ? isStaleActiveSession
                    ? 'Pausado'
                    : formatTimer(elapsedSeconds)
                  : 'Aguardando'}
              </strong>
            </div>
          </header>

          {isStaleActiveSession && (
            <aside className="guided-stale-session" role="alert">
              <div>
                <strong>Seu treino ficou aberto por muito tempo.</strong>
                <p>
                  {activeSession.completed_sets === 0
                    ? 'Nenhuma série foi registrada. Você pode descartá-lo sem criar histórico.'
                    : 'Ao encerrar, a duração vai considerar até a última série registrada.'}
                </p>
              </div>
              {activeSession.completed_sets === 0 && (
                <button
                  type="button"
                  onClick={() => setShowDiscardConfirm(true)}
                >
                  Descartar treino
                </button>
              )}
            </aside>
          )}

          <ol className="guided-timeline" aria-label="Etapas de cada série">
            {GUIDED_STEPS.map((step, index) => {
              const isCurrent = guidedStep !== 'complete' && index === guidedStepIndex
              const isDone = guidedStep === 'complete' || index < guidedStepIndex
              return (
                <li
                  key={step.id}
                  className={`${isCurrent ? 'is-current' : ''} ${isDone ? 'is-done' : ''}`}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <span>{isDone ? <Check size={14} aria-hidden="true" /> : index + 1}</span>
                  <small>{step.label}</small>
                </li>
              )
            })}
          </ol>

          {activeSession && (
            <div className="guided-progress-row">
              <div>
                <span>Progresso</span>
                <strong>{activeSession.completed_sets} de {activeSession.total_sets} séries</strong>
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
          )}

          <article className={`guided-step-card is-${guidedStep}`}>
            {guidedStep !== 'complete' ? (
              <>
                <header className="guided-step-head">
                  <span>
                    {currentContext
                      ? `Exercício ${currentContext.exerciseIndex + 1}`
                      : 'Primeiro exercício'}
                  </span>
                  <h4>{currentExerciseName}</h4>
                  <p>
                    Série {currentSetNumber} de {currentTargetSets}
                    {currentPlannedReps ? ` • meta de ${currentPlannedReps} reps` : ''}
                  </p>
                  {currentExerciseVideo
                    && !showExerciseVideo
                    && (guidedStep === 'weight' || guidedStep === 'ready') && (
                    <button
                      className="guided-video-trigger"
                      type="button"
                      onClick={() => setShowExerciseVideo(true)}
                      aria-expanded={showExerciseVideo}
                    >
                      <Video size={17} aria-hidden="true" />
                      Ver execução
                    </button>
                  )}
                </header>

                {showExerciseVideo && currentExerciseVideo && (
                  <section
                    className="guided-video-preview"
                    aria-label={`Execução de ${currentExerciseName}`}
                  >
                    <div className="guided-video-preview-head">
                      <div>
                        <span>Demonstração rápida</span>
                        <strong>{currentExerciseName}</strong>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowExerciseVideo(false)}
                        aria-label="Fechar execução"
                      >
                        <X size={19} aria-hidden="true" />
                      </button>
                    </div>
                    <video
                      src={currentExerciseVideo.src}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      aria-label={`Vídeo demonstrativo de ${currentExerciseName}`}
                    />
                    <p>{currentExerciseVideo.cue}</p>
                    <small>O cronômetro continua parado enquanto você se prepara.</small>
                  </section>
                )}

                {guidedStep === 'weight' && (
                  <div className="guided-step-content">
                    <div>
                      <p className="section-label">Passo 1</p>
                      <h3>Qual peso você vai usar?</h3>
                      <p>Escolha antes de iniciar. O cronômetro ainda está parado.</p>
                    </div>
                    {currentProgress && (
                      <p className={`guided-progression-hint is-${currentProgress.suggestion_action}`}>
                        <TrendingUp size={16} aria-hidden="true" />
                        <span>{currentProgress.suggestion_text}</span>
                      </p>
                    )}
                    <div className="guided-weight-fields">
                      <label>
                        Peso
                        <span>
                          <input
                            value={currentWeight}
                            onChange={event => {
                              if (preparedWorkout) {
                                setPreparedWeight(event.target.value)
                              } else if (currentSetId !== null) {
                                setWeightInputs(current => ({
                                  ...current,
                                  [currentSetId]: event.target.value,
                                }))
                              }
                            }}
                            inputMode="decimal"
                            placeholder="Ex.: 8,5"
                            aria-label="Peso que vou usar"
                          />
                          <small>kg</small>
                        </span>
                      </label>
                      <label>
                        Repetições
                        <input
                          value={currentReps}
                          onChange={event => {
                            const value = event.target.value.replace(/\D/g, '')
                            if (preparedWorkout) {
                              setPreparedReps(value)
                            } else if (currentSetId !== null) {
                              setRepInputs(current => ({
                                ...current,
                                [currentSetId]: value,
                              }))
                            }
                          }}
                          inputMode="numeric"
                          placeholder="Ex.: 10"
                          aria-label="Repetições que vou fazer"
                        />
                      </label>
                    </div>
                    <div className="guided-primary-actions">
                      {preparedWorkout && (
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={cancelPreparation}
                        >
                          Voltar
                        </button>
                      )}
                      <button
                        className="primary-button"
                        type="button"
                        onClick={advanceToConfirmation}
                      >
                        Avançar
                      </button>
                    </div>
                  </div>
                )}

                {guidedStep === 'ready' && (
                  <div className="guided-step-content guided-ready-content">
                    <span className="guided-step-icon"><Dumbbell size={25} aria-hidden="true" /></span>
                    <div>
                      <p className="section-label">Passo 2</p>
                      <h3>Podemos iniciar a série?</h3>
                      <p>
                        Você confirmou <strong>{formatKg(parseWeight(currentWeight))} kg</strong>
                        {currentReps ? ` e ${currentReps} repetições` : ''}.
                      </p>
                    </div>
                    <p className="guided-no-save-note">
                      O tempo e o registro só começam quando você confirmar abaixo.
                    </p>
                    <div className="guided-primary-actions">
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => setGuidedStep('weight')}
                        disabled={startingWorkoutId !== null}
                      >
                        Alterar peso
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => void startCurrentSeries()}
                        disabled={startingWorkoutId !== null}
                      >
                        <Play size={17} fill="currentColor" aria-hidden="true" />
                        {startingWorkoutId !== null ? 'Iniciando…' : 'Sim, iniciar série'}
                      </button>
                    </div>
                  </div>
                )}

                {guidedStep === 'series' && (
                  <div className="guided-step-content guided-series-content">
                    <div>
                      <p className="section-label">Passo 3</p>
                      <h3>Série em andamento</h3>
                    </div>
                    <strong className="guided-series-timer" role="timer">
                      {formatTimer(seriesElapsedSeconds)}
                    </strong>
                    <div className="guided-series-summary">
                      <span><Dumbbell size={17} aria-hidden="true" /> {formatKg(parseWeight(currentWeight))} kg</span>
                      {currentReps && <span>{currentReps} repetições</span>}
                    </div>
                    <div className="guided-finished-question">
                      <strong>Já terminou esta série?</strong>
                      <small>Nada será salvo até você confirmar.</small>
                    </div>
                    <button
                      className="guided-done-button"
                      type="button"
                      onClick={() => void completeCurrentSet()}
                      disabled={savingSetId !== null}
                    >
                      <CheckCircle2 size={19} aria-hidden="true" />
                      {savingSetId !== null ? 'Registrando…' : 'Sim, terminei a série'}
                    </button>
                  </div>
                )}

                {guidedStep === 'rest' && (
                  <div className="guided-step-content guided-rest-content">
                    <span className="guided-step-icon is-rest">
                      <TimerReset size={26} aria-hidden="true" />
                    </span>
                    <div>
                      <p className="section-label">Passo 4</p>
                      <h3>Hora do descanso</h3>
                      <p>A próxima série só começa depois que você confirmar novamente.</p>
                    </div>
                    <strong className="guided-rest-timer" role="timer">
                      {formatTimer(restTimer.remaining)}
                    </strong>
                    <div className="guided-rest-actions">
                      <button
                        type="button"
                        onClick={() => setRestTimer(current => ({
                          ...current,
                          remaining: Math.min(current.remaining + 30, 600),
                        }))}
                      >
                        <Plus size={16} aria-hidden="true" />
                        Mais 30s
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => {
                          setRestTimer({ remaining: 0, running: false })
                          setGuidedStep('weight')
                        }}
                      >
                        <SkipForward size={17} aria-hidden="true" />
                        Já descansei
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="guided-step-content guided-complete-content">
                <span className="guided-step-icon is-complete">
                  <CheckCircle2 size={28} aria-hidden="true" />
                </span>
                <p className="section-label">Todas as séries feitas</p>
                <h3>Treino concluído!</h3>
                <p>Revise o resultado e finalize para guardar no seu histórico.</p>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setShowFinishConfirm(true)}
                >
                  Finalizar e salvar treino
                </button>
              </div>
            )}
          </article>

          {currentProgress && guidedStep !== 'complete' && (
            <details className="guided-details">
              <summary>Ver histórico e ajustar descanso</summary>
              <div className="guided-exercise-insights">
                <div className="guided-exercise-metrics">
                  <span>
                    <History size={14} aria-hidden="true" />
                    <small>Última sessão</small>
                    <strong>
                      {currentProgress.last_weight_kg === null
                        ? 'Primeiro registro'
                        : `${formatKg(currentProgress.last_weight_kg)} kg × ${currentProgress.last_reps_completed ?? '—'} reps`}
                    </strong>
                  </span>
                  <span>
                    <Trophy size={14} aria-hidden="true" />
                    <small>Recorde pessoal</small>
                    <strong>{formatKg(currentProgress.personal_record_weight_kg)} kg</strong>
                  </span>
                </div>
                <div className="guided-exercise-preferences">
                  <label>
                    Descanso após a série
                    <select
                      value={currentProgress.rest_seconds}
                      onChange={event => void updateExercisePreference(
                        currentProgress,
                        Number(event.target.value),
                        Number(currentProgress.increment_kg).toFixed(2),
                      )}
                      disabled={preferenceIsSaving}
                    >
                      {currentRestOptions.map(seconds => (
                        <option key={seconds} value={seconds}>{seconds}s</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Aumento sugerido
                    <select
                      value={Number(currentProgress.increment_kg).toFixed(2)}
                      onChange={event => void updateExercisePreference(
                        currentProgress,
                        currentProgress.rest_seconds,
                        event.target.value,
                      )}
                      disabled={preferenceIsSaving}
                    >
                      {currentIncrementOptions.map(increment => (
                        <option key={increment} value={increment}>
                          +{formatKg(increment)} kg
                        </option>
                      ))}
                    </select>
                  </label>
                  {preferenceIsSaving && <small>Salvando…</small>}
                </div>
                <small className="guided-progression-disclaimer">
                  Sugestão baseada nos seus registros; não substitui orientação profissional.
                </small>
              </div>
            </details>
          )}

          {activeSession && (
            <details className="guided-details">
              <summary>Ver todas as séries do treino</summary>
              <div className="guided-session-outline">
                {activeSession.exercises.map(exercise => (
                  <section key={exercise.id}>
                    <strong>{exercise.name}</strong>
                    <div>
                      {exercise.sets.map(set => (
                        <span
                          key={set.id}
                          className={set.completed_at ? 'is-complete' : ''}
                        >
                          Série {set.set_number}
                          {set.completed_at && (
                            <>
                              {' • '}{formatKg(set.weight_kg)} kg
                              <button
                                type="button"
                                onClick={() => void clearSet(set.id)}
                                disabled={savingSetId === set.id}
                                aria-label={`Desfazer série ${set.set_number} de ${exercise.name}`}
                              >
                                <RotateCcw size={13} aria-hidden="true" />
                              </button>
                            </>
                          )}
                        </span>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </details>
          )}

          {activeSession && guidedStep !== 'complete' && (
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
                Encerrar treino
              </button>
            </div>
          )}
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
                          workout.exercises.map(exercise => {
                            const progress = progressByExercise.get(
                              exerciseKey(exercise.name),
                            )
                            return (
                              <p key={exercise.id}>
                                <strong>{exercise.name}</strong>
                                <small>{exercise.sets} × {exercise.reps}</small>
                                {progress?.last_weight_kg !== null
                                  && progress?.last_weight_kg !== undefined
                                  && (
                                    <span className="template-exercise-progress">
                                      Última {formatKg(progress.last_weight_kg)} kg
                                      {progress.last_reps_completed !== null
                                        ? ` × ${progress.last_reps_completed} reps`
                                        : ''}
                                      {' · '}
                                      PR {formatKg(progress.personal_record_weight_kg)} kg
                                    </span>
                                  )}
                              </p>
                            )
                          })
                        ) : (
                          <p className="tiny-note">Recuperação, sem treino guiado</p>
                        )}
                      </div>
                      {workout.note && <p className="workout-note">{workout.note}</p>}
                      {workout.exercises.length > 0 && (
                        <button
                          className="guided-start-button"
                          type="button"
                          onClick={() => prepareSession(workout)}
                        >
                          <Play size={17} fill="currentColor" aria-hidden="true" />
                          Iniciar treino
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

      {!loading && exerciseProgress.length > 0 && !activeSession && (
        <section className="workout-exercise-progress-section">
          <div className="workout-history-head">
            <div>
              <p className="section-label">Evolução por exercício</p>
              <h3>Cargas, recordes e próximo passo</h3>
            </div>
            <TrendingUp size={20} aria-hidden="true" />
          </div>
          <div className="workout-exercise-progress-grid">
            {exerciseProgress.map(progress => {
              const maxWeight = Math.max(
                1,
                ...progress.evolution.map(point => Number(point.max_weight_kg)),
              )
              return (
                <article key={exerciseKey(progress.exercise_name)}>
                  <div className="workout-progress-card-head">
                    <div>
                      <strong>{progress.exercise_name}</strong>
                      <small>
                        Última {formatKg(progress.last_weight_kg)} kg
                        {' · '}
                        PR {formatKg(progress.personal_record_weight_kg)} kg
                      </small>
                    </div>
                    <span title="Recorde pessoal">
                      <Trophy size={15} aria-hidden="true" />
                      {formatKg(progress.personal_record_weight_kg)}
                    </span>
                  </div>
                  {progress.evolution.length > 0 && (
                    <div
                      className="workout-evolution-chart"
                      role="img"
                      aria-label={`Evolução de carga de ${progress.exercise_name}`}
                    >
                      {progress.evolution.map(point => (
                        <span
                          key={point.session_id}
                          title={`${historyDate(point.completed_at)}: ${formatKg(point.max_weight_kg)} kg`}
                          style={{
                            height: `${Math.max(
                              12,
                              (Number(point.max_weight_kg) / maxWeight) * 100,
                            )}%`,
                          }}
                        />
                      ))}
                    </div>
                  )}
                  <p className={`workout-progress-next is-${progress.suggestion_action}`}>
                    {progress.suggestion_text}
                  </p>
                </article>
              )
            })}
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
              em {formatTimer(finishDurationSeconds)}.
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

      {showDiscardConfirm && activeSession && (
        <div className="workout-modal-backdrop" role="presentation">
          <div
            className="workout-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="discard-workout-title"
          >
            <span className="workout-dialog-icon danger"><Trash2 size={23} /></span>
            <h3 id="discard-workout-title">Descartar este treino?</h3>
            <p>
              Nenhuma série foi registrada. O treino será removido sem entrar no histórico.
            </p>
            <div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                disabled={isDiscarding}
              >
                Continuar treino
              </button>
              <button
                className="workout-danger-button"
                type="button"
                onClick={() => void discardSession()}
                disabled={isDiscarding}
              >
                {isDiscarding ? 'Descartando…' : 'Sim, descartar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
