import { useState, useEffect, useRef } from 'react'
import { apiRoutes, Habit } from '../services/api'
import { notify } from '../hooks/useNotifications'

interface FocusProps {
  userId: number
}

export default function Focus({ userId }: FocusProps) {
  const [readingHabits, setReadingHabits] = useState<Habit[]>([])
  const [selectedHabitId, setSelectedHabitId] = useState<number | null>(null)
  const [phase, setPhase] = useState<'focus' | 'break'>('focus')
  const [remaining, setRemaining] = useState(25 * 60)
  const [cycles, setCycles] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const intervalRef = useRef<number | null>(null)
  const prevPhaseRef = useRef<'focus' | 'break'>('focus')

  useEffect(() => {
    loadHabits()
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [userId])

  useEffect(() => {
    if (readingHabits.length > 0 && !selectedHabitId) {
      setSelectedHabitId(readingHabits[0].id)
    }
  }, [readingHabits])

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
    setPhase('focus')
    setRemaining(25 * 60)
    setCycles(0)
  }

  function startTimer() {
    setIsRunning(true)
    intervalRef.current = window.setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          finishPhase()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  function stopTimer() {
    setIsRunning(false)
    if (intervalRef.current) {
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

    // Send notification when phase changes
    const nextPhase = phase === 'focus' ? 'break' : 'focus'
    notify.pomodoroComplete(phase)

    if (phase === 'focus') {
      setCycles(prev => prev + 1)
      const today = new Date().toISOString().split('T')[0]
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

  const selectedHabit = readingHabits.find(h => h.id === selectedHabitId)
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0')
  const seconds = String(remaining % 60).padStart(2, '0')
  const breakMinutes = cycles > 0 && cycles % 4 === 0 ? 15 : 5

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
        <label className="focus-selector">
          Leitura
          <select
            value={selectedHabitId || ''}
            onChange={(e) => handleHabitChange(Number(e.target.value))}
          >
            {readingHabits.map(h => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>
        <div className="pomodoro-content">
          <div className="pomodoro-clock">
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
                {isRunning ? 'Pausar' : phase === 'focus' ? 'Iniciar foco' : 'Iniciar pausa'}
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
