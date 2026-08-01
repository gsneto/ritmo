import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePushNotifications } from './usePushNotifications'

const apiMocks = vi.hoisted(() => ({
  getPushConfig: vi.fn(),
  getPushSubscriptionStatus: vi.fn(),
  savePushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
  sendPushTest: vi.fn(),
}))

vi.mock('../services/api', () => ({
  apiRoutes: apiMocks,
}))

const originalServiceWorker = Object.getOwnPropertyDescriptor(
  navigator,
  'serviceWorker',
)

function installPushBrowser(subscription: PushSubscription | null) {
  const registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe: vi.fn(),
    },
  }
  const serviceWorker = {
    getRegistration: vi.fn().mockResolvedValue(registration),
    register: vi.fn().mockResolvedValue(registration),
    ready: Promise.resolve(registration),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: serviceWorker,
  })
  vi.stubGlobal('PushManager', class PushManagerMock {})
  vi.stubGlobal('Notification', {
    permission: 'granted',
    requestPermission: vi.fn().mockResolvedValue('granted'),
  })
  return { registration, serviceWorker }
}

describe('usePushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.savePushSubscription.mockResolvedValue({ data: { subscribed: true } })
    apiMocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: false, linked_to_other_profile: false },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
    } else {
      Reflect.deleteProperty(navigator, 'serviceWorker')
    }
  })

  it('does not report a stale browser subscription as active when the server is disabled', async () => {
    const staleSubscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/stale',
      toJSON: vi.fn().mockReturnValue({ endpoint: 'stale' }),
    } as unknown as PushSubscription
    installPushBrowser(staleSubscription)
    apiMocks.getPushConfig.mockResolvedValue({
      data: { enabled: false, public_key: null },
    })

    const { result } = renderHook(() => usePushNotifications(1))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isConfigured).toBe(false)
    expect(result.current.isSubscribed).toBe(false)
    expect(apiMocks.savePushSubscription).not.toHaveBeenCalled()
  })

  it('checks an active subscription without reassigning it during refresh', async () => {
    const subscriptionJson = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/current',
      keys: { p256dh: 'abcdefgh', auth: 'abcdefgh' },
    }
    const subscription = {
      endpoint: subscriptionJson.endpoint,
      toJSON: vi.fn().mockReturnValue(subscriptionJson),
    } as unknown as PushSubscription
    installPushBrowser(subscription)
    apiMocks.getPushConfig.mockResolvedValue({
      data: { enabled: true, public_key: 'public-vapid-key' },
    })
    apiMocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: true, linked_to_other_profile: false },
    })

    const { result } = renderHook(() => usePushNotifications(1))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isConfigured).toBe(true)
    expect(result.current.isSubscribed).toBe(true)
    expect(apiMocks.getPushSubscriptionStatus).toHaveBeenCalledWith(
      1,
      subscriptionJson.endpoint,
    )
    expect(apiMocks.savePushSubscription).not.toHaveBeenCalled()
  })

  it('transfers an existing browser subscription only after the user activates it', async () => {
    const subscriptionJson = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/other-profile',
      keys: { p256dh: 'abcdefgh', auth: 'abcdefgh' },
    }
    const subscription = {
      endpoint: subscriptionJson.endpoint,
      toJSON: vi.fn().mockReturnValue(subscriptionJson),
    } as unknown as PushSubscription
    installPushBrowser(subscription)
    apiMocks.getPushConfig.mockResolvedValue({
      data: { enabled: true, public_key: 'public-vapid-key' },
    })
    apiMocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: false, linked_to_other_profile: true },
    })

    const { result } = renderHook(() => usePushNotifications(2))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isSubscribed).toBe(false)
    expect(result.current.isLinkedToOtherProfile).toBe(true)
    expect(apiMocks.savePushSubscription).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.subscribe()
    })

    expect(apiMocks.savePushSubscription).toHaveBeenCalledWith(
      2,
      subscriptionJson,
      true,
    )
    expect(result.current.isSubscribed).toBe(true)
    expect(result.current.isLinkedToOtherProfile).toBe(false)
  })
})
