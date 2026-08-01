import {
  Coffee,
  Pause,
  Play,
  RotateCcw,
  Target,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import type { PomodoroPhase } from '../hooks/usePomodoroTimer'

interface PomodoroTimerCardProps {
  phase: PomodoroPhase
  cycles: number
  isRunning: boolean
  minutes: string
  seconds: string
  timerStyle: CSSProperties
  timerActionLabel: string
  canStart: boolean
  onReset: () => void
  onToggle: () => void
}

export default function PomodoroTimerCard({
  phase,
  cycles,
  isRunning,
  minutes,
  seconds,
  timerStyle,
  timerActionLabel,
  canStart,
  onReset,
  onToggle,
}: PomodoroTimerCardProps) {
  return (
    <div className="focus-timer-card">
      <div className="focus-phase-row">
        <span className="focus-phase-badge">
          {phase === 'focus'
            ? <Target aria-hidden="true" />
            : <Coffee aria-hidden="true" />}
          {phase === 'focus' ? 'Pomodoro' : 'Pausa'}
        </span>
        <span>{cycles} {cycles === 1 ? 'ciclo concluído' : 'ciclos concluídos'}</span>
      </div>

      <div className="focus-timer-ring" style={timerStyle}>
        <div className="focus-timer-face">
          <span
            className="focus-timer-value"
            role="timer"
            aria-label={`${minutes} minutos e ${seconds} segundos restantes`}
          >
            {minutes}:{seconds}
          </span>
          <small>{phase === 'focus' ? 'para ler' : 'para respirar'}</small>
        </div>
      </div>

      <div className="focus-timer-actions">
        <button
          className="focus-reset-button"
          onClick={onReset}
          type="button"
          aria-label="Reiniciar"
        >
          <RotateCcw aria-hidden="true" />
        </button>
        <button
          className="focus-main-action"
          disabled={!canStart}
          onClick={onToggle}
          type="button"
        >
          {isRunning
            ? <Pause aria-hidden="true" />
            : <Play aria-hidden="true" />}
          {timerActionLabel}
        </button>
      </div>
      {!canStart && (
        <small className="focus-disabled-note">
          Selecione um livro ativo ou crie um hábito de leitura.
        </small>
      )}
    </div>
  )
}
