import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Workouts from './Workouts'

const routerState = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: '',
}))

const checkinHabitMock = vi.hoisted(() => vi.fn())
const workoutsPanelState = vi.hoisted(() => ({
  props: null as {
    isOpen: boolean
    onClose?: () => void
    onSessionFinished?: () => void | Promise<void>
  } | null,
}))

vi.mock('../router', () => ({
  useAppRouter: () => routerState,
}))

vi.mock('../services/api', () => ({
  apiRoutes: {
    checkinHabit: checkinHabitMock,
  },
}))

vi.mock('../utils/date', () => ({
  toLocalDateValue: () => '2026-07-31',
}))

vi.mock('../components/WorkoutsPanel', () => ({
  default: (props: {
    isOpen: boolean
    onClose?: () => void
    onSessionFinished?: () => void | Promise<void>
  }) => {
    workoutsPanelState.props = props
    return props.isOpen
    ? (
        <>
          <span>Treino aberto para teste</span>
          <button type="button" onClick={() => void props.onSessionFinished?.()}>Concluir treino de teste</button>
        </>
      )
    : null
  },
}))

describe('Workouts page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routerState.search = ''
    workoutsPanelState.props = null
  })

  it('keeps the guided workout in its own area without a close route to today', () => {
    render(<Workouts userId={1} />)

    expect(screen.getByText('Treino aberto para teste')).toBeTruthy()
    expect(workoutsPanelState.props?.onClose).toBeUndefined()
    expect(routerState.navigate).not.toHaveBeenCalled()
  })

  it('marks the linked workout habit only after a finished session', async () => {
    routerState.search = '?habit=8'
    render(<Workouts userId={1} />)

    fireEvent.click(screen.getByRole('button', { name: 'Concluir treino de teste' }))

    await waitFor(() => {
      expect(checkinHabitMock).toHaveBeenCalledWith(8, '2026-07-31')
    })
  })
})
