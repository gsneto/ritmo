import { useState, useEffect, useRef } from 'react'
import { apiRoutes } from '../services/api'
import type { Habit } from '../services/api'
import { notify } from '../hooks/useNotifications'
import { toLocalDateValue } from '../utils/date'
import { useAppSearchParams } from '../router'

interface FocusProps {
  userId: number
}

export default function Focus({ userId }: FocusProps) {
  const [searchParams, setSearchParams] = useAppSearchParams()
  const [readingHabits, setReadingHabits] = useState<Habit[]>([])
  const [selectedHabitId, setSelectedHabitId] = useState<number | null>(null)
  const [phase, setPhase] = useState<'focus' | 'break'>('focus')
  const [remaining, setRemaining] = useState(25 * 60)
  const [cycles, setCycles] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const intervalRef = useRef<number | null>(null)
  const requestedHabitId = Number(searchParams.get('habit')) || null

  useEffect(() => {
    loadHabits()
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
      }
    }
  }, [userId])

  useEffect(() => {
    if (readingHabits.length === 0) {
      setSelectedHabitId(null)
      return
    }

    setSelectedHabitId(currentId => {
      const requested = readingHabits.find(habit => habit.id === requestedHabitId)
      if (requested) return requested.id
      if (currentId && readingHabits.some(habit => habit.id === currentId)) return currentId
      return readingHabits[0].id
    })
  }, [readingHabits, requestedHabitId])

  async function loadHabits() {
    try {
      const data = await apiRoutes.getHabits(userId)
      const habits: Habit[] = data.data
      const reading = habits.filter(h => /leitura|\bler\b/i.test(h.name))
      setReadingHabits(reading)
    } catch (error) {
      console.error('Failed to load habits:', error)
    }
  }

  function handleHabitChange(id: number) {
    stopTimer()
    setSelectedHabitId(id)
    setSearchParams({ habit: String(id) }, { replace: true })
    setPhase('focus')
    setRemaining(25 * 60)
    setCycles(0)
  }

  function startTimer() {
    setIsRunning(true)
    intervalRef.current = window.setInterval(() => {
      setRemaining(prev => Math.max(0, prev - 1))
    }, 1000)
  }

  function stopTimer() {
    setIsRunning(false)
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  function toggleTimer() {
    if (isRunning) {
      stopTimer()
    } else {
      startTimer()
    }
  }

  function resetTimer() {
    stopTimer()
    setPhase('focus')
    setRemaining(25 * 60)
  }

  async function finishPhase() {
    stopTimer()

    notify.pomodoroComplete(phase)

    if (phase === 'focus') {
      setCycles(prev => prev + 1)
      const today = toLocalDateValue()
      if (selectedHabitId) {
        try {
          await apiRoutes.checkinHabit(selectedHabitId, today)
          notify.checkin(selectedHabit?.name || 'Leitura')
        } catch (error) {
          console.error('Failed to check-in:', error)
        }
      }
      const breakMinutes = cycles > 0 && (cycles + 1) % 4 === 0 ? 15 : 5
      setPhase('break')
      setRemaining(breakMinutes * 60)
    } else {
      setPhase('focus')
      setRemaining(25 * 60)
    }
  }

  useEffect(() => {
    if (isRunning && remaining === 0) {
      void finishPhase()
    }
  }, [isRunning, remaining])

  const selectedHabit = readingHabits.find(h => h.id === selectedHabitId)
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0')
  const seconds = String(remaining % 60).padStart(2, '0')
  const breakMinutes = cycles > 0 && cycles % 4 === 0 ? 15 : 5
  const phaseDuration = phase === 'focus' ? 25 * 60 : breakMinutes * 60
  const timerActionLabel = isRunning
    ? 'Pausar'
    : remaining < phaseDuration
      ? `Continuar ${phase === 'focus' ? 'foco' : 'pausa'}`
      : `Iniciar ${phase === 'focus' ? 'foco' : 'pausa'}`

  if (readingHabits.length === 0) {
    return (
      <div className="view" data-view="focus">
        <section className="panel focus-panel">
          <div className="panel-head"><div><p className="section-label">Foco</p><h2>Pomodoro</h2></div></div>
          <p className="empty-state">Nenhum hábito de leitura cadastrado.</p>
        </section>
      </div>
    )
  }

  return (
    <div className="view" data-view="focus">
      <section className="panel focus-panel">
        <div className="panel-head"><div><p className="section-label">Foco</p><h2>Pomodoro</h2></div></div>
        <label className="focus-selector" htmlFor="focus-habit">
          Leitura
          <select
            id="focus-habit"
            value={selectedHabitId || ''}
            onChange={(e) => handleHabitChange(Number(e.target.value))}
          >
            {readingHabits.map(h => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>
        <div className="pomodoro-content">
          <div
            className="pomodoro-clock"
            role="timer"
            aria-label={`${minutes} minutos e ${seconds} segundos restantes`}
          >
            {minutes}:{seconds}
          </div>
          <div>
            <p className="section-label">{phase === 'focus' ? 'Foco' : 'Pausa'}</p>
            <h2>{selectedHabit?.name || 'Leitura'}</h2>
            <p className="pomodoro-copy">
              {phase === 'focus'
                ? '25 minutos para ler sem interrupções.'
                : `${breakMinutes} minutos de pausa antes do próximo foco.`}
            </p>
            <p className="tiny-note">Ciclo {cycles + 1}</p>
            <div className="pomodoro-actions">
              <button className="primary-button" onClick={toggleTimer} type="button">
                {timerActionLabel}
              </button>
              <button className="ghost-button" onClick={resetTimer} type="button">
                Reiniciar
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
