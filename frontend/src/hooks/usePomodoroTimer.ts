import { useCallback, useEffect, useState } from 'react'

export type PomodoroPhase = 'focus' | 'break'

const FOCUS_SECONDS = 25 * 60

export interface PomodoroTimer {
  phase: PomodoroPhase
  remaining: number
  cycles: number
  isRunning: boolean
  start: () => void
  stop: () => void
  toggle: () => void
  reset: (resetCycles?: boolean) => void
  advancePhase: () => void
}

export function usePomodoroTimer(): PomodoroTimer {
  const [phase, setPhase] = useState<PomodoroPhase>('focus')
  const [remaining, setRemaining] = useState(FOCUS_SECONDS)
  const [cycles, setCycles] = useState(0)
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    if (!isRunning) return
    const interval = window.setInterval(() => {
      setRemaining(previous => Math.max(0, previous - 1))
    }, 1000)
    return () => window.clearInterval(interval)
  }, [isRunning])

  const start = useCallback(() => {
    setIsRunning(true)
  }, [])

  const stop = useCallback(() => {
    setIsRunning(false)
  }, [])

  const toggle = useCallback(() => {
    setIsRunning(current => !current)
  }, [])

  const reset = useCallback((resetCycles = false) => {
    setIsRunning(false)
    setPhase('focus')
    setRemaining(FOCUS_SECONDS)
    if (resetCycles) setCycles(0)
  }, [])

  const advancePhase = useCallback(() => {
    if (phase === 'focus') {
      const completedCycles = cycles + 1
      setCycles(completedCycles)
      setPhase('break')
      setRemaining(completedCycles % 4 === 0 ? 15 * 60 : 5 * 60)
      return
    }
    setPhase('focus')
    setRemaining(FOCUS_SECONDS)
  }, [cycles, phase])

  return {
    phase,
    remaining,
    cycles,
    isRunning,
    start,
    stop,
    toggle,
    reset,
    advancePhase,
  }
}
