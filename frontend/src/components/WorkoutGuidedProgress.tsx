import { Check } from 'lucide-react'
import type { WorkoutSession } from '../services/workoutSessionApi'

type GuidedStep = 'weight' | 'ready' | 'series' | 'rest' | 'complete'

const GUIDED_STEPS: Array<{ id: Exclude<GuidedStep, 'complete'>; label: string }> = [
  { id: 'weight', label: 'Peso' },
  { id: 'ready', label: 'Confirmar' },
  { id: 'series', label: 'Série' },
  { id: 'rest', label: 'Descanso' },
]

interface WorkoutGuidedProgressProps {
  guidedStep: GuidedStep
  activeSession: WorkoutSession | null
}

export default function WorkoutGuidedProgress({
  guidedStep,
  activeSession,
}: WorkoutGuidedProgressProps) {
  const guidedStepIndex = guidedStep === 'complete'
    ? GUIDED_STEPS.length
    : GUIDED_STEPS.findIndex(step => step.id === guidedStep)

  return (
    <>
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
    </>
  )
}
