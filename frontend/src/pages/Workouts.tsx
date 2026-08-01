import WorkoutsPanel from '../components/WorkoutsPanel'
import { useAppRouter } from '../router'
import { apiRoutes } from '../services/api'
import { toLocalDateValue } from '../utils/date'

interface WorkoutsProps {
  userId: number
}

export default function Workouts({ userId }: WorkoutsProps) {
  const { search } = useAppRouter()
  const linkedHabitValue = new URLSearchParams(search).get('habit')
  const linkedHabitId = linkedHabitValue && /^\d+$/.test(linkedHabitValue)
    ? Number(linkedHabitValue)
    : null

  async function markLinkedHabitAsDone() {
    if (!linkedHabitId || !Number.isSafeInteger(linkedHabitId)) return
    await apiRoutes.checkinHabit(linkedHabitId, toLocalDateValue())
  }

  return (
    <div className="view routine-view workout-view" data-view="workouts">
      <WorkoutsPanel
        userId={userId}
        isOpen
        onSessionFinished={linkedHabitId ? markLinkedHabitAsDone : undefined}
      />
    </div>
  )
}
