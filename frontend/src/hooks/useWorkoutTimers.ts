import { useEffect, useState } from 'react'
import type { WorkoutSession } from '../services/workoutSessionApi'

interface RestTimer {
  remaining: number
  running: boolean
}

export function useWorkoutTimers(
  activeSession: WorkoutSession | null,
  guidedStep: string,
) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [seriesElapsedSeconds, setSeriesElapsedSeconds] = useState(0)
  const [setStartedAt, setSetStartedAt] = useState<number | null>(null)
  const [restTimer, setRestTimer] = useState<RestTimer>({
    remaining: 0,
    running: false,
  })

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
    if (guidedStep !== 'series' || setStartedAt === null) {
      setSeriesElapsedSeconds(0)
      return
    }
    const updateSetElapsed = () => {
      setSeriesElapsedSeconds(Math.max(0, Math.floor((Date.now() - setStartedAt) / 1000)))
    }
    updateSetElapsed()
    const interval = window.setInterval(updateSetElapsed, 1000)
    return () => window.clearInterval(interval)
  }, [guidedStep, setStartedAt])

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
  }, [restTimer.running])

  return {
    elapsedSeconds,
    seriesElapsedSeconds,
    setSeriesElapsedSeconds,
    setSetStartedAt,
    restTimer,
    setRestTimer,
  }
}
