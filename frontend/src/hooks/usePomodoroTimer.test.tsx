import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePomodoroTimer } from './usePomodoroTimer'

describe('usePomodoroTimer', () => {
  it('counts down while running and stops at zero', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => usePomodoroTimer())

    act(() => result.current.start())
    act(() => vi.advanceTimersByTime(2_000))

    expect(result.current.remaining).toBe(25 * 60 - 2)
    act(() => result.current.stop())
    act(() => vi.advanceTimersByTime(2_000))
    expect(result.current.remaining).toBe(25 * 60 - 2)

    vi.useRealTimers()
  })

  it('alternates focus and break and can reset the cycle count', () => {
    const { result } = renderHook(() => usePomodoroTimer())

    act(() => result.current.advancePhase())
    expect(result.current.phase).toBe('break')
    expect(result.current.cycles).toBe(1)
    expect(result.current.remaining).toBe(5 * 60)

    act(() => result.current.advancePhase())
    expect(result.current.phase).toBe('focus')
    expect(result.current.remaining).toBe(25 * 60)

    act(() => result.current.reset(true))
    expect(result.current.cycles).toBe(0)
    expect(result.current.phase).toBe('focus')
  })
})
