import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDailyReminders } from './useDailyReminders'

const mocks = vi.hoisted(() => ({
  getHabits: vi.fn(),
  getTasks: vi.fn(),
  getShoppingLists: vi.fn(),
  getPushConfig: vi.fn(),
  getPushSubscriptionStatus: vi.fn(),
  reminder: vi.fn(),
}))

vi.mock('../services/api', () => ({
  REMINDERS_CHANGED_EVENT: 'ritmo:reminders-changed',
  apiRoutes: {
    getHabits: mocks.getHabits,
    getTasks: mocks.getTasks,
    getShoppingLists: mocks.getShoppingLists,
    getPushConfig: mocks.getPushConfig,
    getPushSubscriptionStatus: mocks.getPushSubscriptionStatus,
  },
}))

vi.mock('./useNotifications', () => ({
  notify: { reminder: mocks.reminder },
}))

const originalServiceWorker = Object.getOwnPropertyDescriptor(
  navigator,
  'serviceWorker',
)

function habitAt(time: string) {
  return {
    id: 7,
    user_id: 1,
    name: 'Beber água',
    time,
    active_days: [0, 1, 2, 3, 4, 5, 6],
    created_at: '2026-07-01',
    check_ins: [],
  }
}

async function flushReminderLoading() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useDailyReminders', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 31, 12, 0, 0))
    vi.clearAllMocks()
    window.localStorage.clear()
    vi.stubGlobal('Notification', { permission: 'granted' })
    mocks.getTasks.mockResolvedValue({ data: [] })
    mocks.getShoppingLists.mockResolvedValue({ data: [] })
    mocks.getPushConfig.mockResolvedValue({ data: { enabled: false, public_key: null } })
    mocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: false, linked_to_other_profile: false },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    if (originalServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
    } else {
      Reflect.deleteProperty(navigator, 'serviceWorker')
    }
  })

  it('does not fire old reminders in a burst when the app is opened later', async () => {
    mocks.getHabits.mockResolvedValue({ data: [habitAt('08:00')] })

    renderHook(() => useDailyReminders(1))
    await flushReminderLoading()
    await act(async () => vi.advanceTimersByTime(3_000))

    expect(mocks.reminder).not.toHaveBeenCalled()
  })

  it('fires a near-future reminder once while background push is unavailable', async () => {
    mocks.getHabits.mockResolvedValue({ data: [habitAt('12:01')] })

    renderHook(() => useDailyReminders(1))
    await flushReminderLoading()
    await act(async () => vi.advanceTimersByTime(61_000))

    expect(mocks.reminder).toHaveBeenCalledOnce()
    expect(mocks.reminder).toHaveBeenCalledWith(
      'Hora do seu hábito',
      'Beber água',
      '/habits',
      'habit-7-2026-07-31',
    )
  })

  it('reschedules immediately after a habit or task is changed', async () => {
    mocks.getHabits
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValue({ data: [habitAt('12:01')] })

    renderHook(() => useDailyReminders(1))
    await flushReminderLoading()
    act(() => window.dispatchEvent(new Event('ritmo:reminders-changed')))
    await flushReminderLoading()
    await act(async () => vi.advanceTimersByTime(61_000))

    expect(mocks.reminder).toHaveBeenCalledOnce()
  })

  it('does not duplicate local reminders when background push is connected', async () => {
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/device' }
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(subscription),
      },
    }
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: vi.fn().mockResolvedValue(registration) },
    })
    vi.stubGlobal('PushManager', class PushManagerMock {})
    mocks.getPushConfig.mockResolvedValue({
      data: { enabled: true, public_key: 'public-vapid-key' },
    })
    mocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: true, linked_to_other_profile: false },
    })
    mocks.getHabits.mockResolvedValue({ data: [habitAt('12:01')] })

    renderHook(() => useDailyReminders(1))
    await flushReminderLoading()
    await act(async () => vi.advanceTimersByTime(61_000))

    expect(mocks.reminder).not.toHaveBeenCalled()
  })

  it('keeps local reminders when this browser is linked to another profile', async () => {
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/other-profile' }
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(subscription),
      },
    }
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: vi.fn().mockResolvedValue(registration) },
    })
    vi.stubGlobal('PushManager', class PushManagerMock {})
    mocks.getPushConfig.mockResolvedValue({
      data: { enabled: true, public_key: 'public-vapid-key' },
    })
    mocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: false, linked_to_other_profile: true },
    })
    mocks.getHabits.mockResolvedValue({ data: [habitAt('12:01')] })

    renderHook(() => useDailyReminders(2))
    await flushReminderLoading()
    await act(async () => vi.advanceTimersByTime(61_000))

    expect(mocks.getPushSubscriptionStatus).toHaveBeenCalledWith(
      2,
      subscription.endpoint,
    )
    expect(mocks.reminder).toHaveBeenCalledOnce()
  })
})
