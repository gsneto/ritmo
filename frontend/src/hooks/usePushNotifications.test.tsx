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
    window.localStorage.clear()
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
      data: {
        enabled: false,
        public_key: null,
        delivery_status: 'disabled',
        delivery_mode: 'disabled',
        last_cycle_at: null,
      },
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
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    installPushBrowser(subscription)
    window.localStorage.setItem('ritmo-push-vapid-public-key', 'public-vapid-key')
    apiMocks.getPushConfig.mockResolvedValue({
      data: {
        enabled: true,
        public_key: 'public-vapid-key',
        delivery_status: 'ready',
        delivery_mode: 'embedded',
        last_cycle_at: '2026-08-01T12:00:00Z',
      },
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

  it('uses the real VAPID key and restores missing local storage', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/real-vapid-key'
    const subscription = {
      endpoint,
      options: {
        applicationServerKey: new Uint8Array([1, 2, 3, 4]).buffer,
        userVisibleOnly: true,
      },
      toJSON: vi.fn().mockReturnValue({ endpoint }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    const { registration } = installPushBrowser(subscription)
    apiMocks.getPushConfig.mockResolvedValue({
      data: {
        enabled: true,
        public_key: 'AQIDBA==',
        delivery_status: 'ready',
        delivery_mode: 'embedded',
        last_cycle_at: null,
      },
    })
    apiMocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: true, linked_to_other_profile: false },
    })

    const { result } = renderHook(() => usePushNotifications(1))

    await waitFor(() => expect(result.current.isSubscribed).toBe(true))
    expect(window.localStorage.getItem('ritmo-push-vapid-public-key')).toBe(
      'AQIDBA==',
    )
    expect(subscription.unsubscribe).not.toHaveBeenCalled()
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('preserves an active subscription when neither browser key nor storage is available', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/key-not-exposed'
    const subscription = {
      endpoint,
      toJSON: vi.fn().mockReturnValue({ endpoint }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    installPushBrowser(subscription)
    apiMocks.getPushConfig.mockResolvedValue({
      data: {
        enabled: true,
        public_key: 'AQIDBA',
        delivery_status: 'ready',
        delivery_mode: 'embedded',
        last_cycle_at: null,
      },
    })
    apiMocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: true, linked_to_other_profile: false },
    })

    const { result } = renderHook(() => usePushNotifications(1))

    await waitFor(() => expect(result.current.isSubscribed).toBe(true))
    expect(window.localStorage.getItem('ritmo-push-vapid-public-key')).toBe('AQIDBA')
    expect(subscription.unsubscribe).not.toHaveBeenCalled()
    expect(apiMocks.deletePushSubscription).not.toHaveBeenCalled()
  })

  it('transfers an existing browser subscription only after the user activates it', async () => {
    const subscriptionJson = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/other-profile',
      keys: { p256dh: 'abcdefgh', auth: 'abcdefgh' },
    }
    const subscription = {
      endpoint: subscriptionJson.endpoint,
      toJSON: vi.fn().mockReturnValue(subscriptionJson),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    installPushBrowser(subscription)
    apiMocks.getPushConfig.mockResolvedValue({
      data: {
        enabled: true,
        public_key: 'public-vapid-key',
        delivery_status: 'ready',
        delivery_mode: 'embedded',
        last_cycle_at: null,
      },
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
    expect(subscription.unsubscribe).not.toHaveBeenCalled()
  })

  it('recreates a divergent VAPID subscription instead of transferring its endpoint', async () => {
    const oldJson = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/other-profile-old-key',
      keys: { p256dh: 'old-p256dh', auth: 'old-auth' },
    }
    const newJson = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/current-profile-new-key',
      keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
    }
    const oldSubscription = {
      endpoint: oldJson.endpoint,
      options: {
        applicationServerKey: new Uint8Array([5, 6, 7, 8]).buffer,
        userVisibleOnly: true,
      },
      toJSON: vi.fn().mockReturnValue(oldJson),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    const newSubscription = {
      endpoint: newJson.endpoint,
      toJSON: vi.fn().mockReturnValue(newJson),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    const { registration } = installPushBrowser(oldSubscription)
    registration.pushManager.subscribe.mockResolvedValue(newSubscription)
    apiMocks.getPushConfig.mockResolvedValue({
      data: {
        enabled: true,
        public_key: 'AQIDBA',
        delivery_status: 'ready',
        delivery_mode: 'embedded',
        last_cycle_at: null,
      },
    })
    apiMocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: false, linked_to_other_profile: true },
    })

    const { result } = renderHook(() => usePushNotifications(2))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.subscribe()
    })

    expect(oldSubscription.unsubscribe).toHaveBeenCalledOnce()
    expect(registration.pushManager.subscribe).toHaveBeenCalledOnce()
    expect(apiMocks.deletePushSubscription).not.toHaveBeenCalled()
    expect(apiMocks.savePushSubscription).toHaveBeenCalledWith(2, newJson, false)
    expect(result.current.isSubscribed).toBe(true)
  })

  it('recreates an active subscription when its real VAPID key differs', async () => {
    const oldJson = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/old-vapid',
      keys: { p256dh: 'old-p256dh', auth: 'old-auth' },
    }
    const newJson = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/new-vapid',
      keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
    }
    const oldSubscription = {
      endpoint: oldJson.endpoint,
      options: {
        applicationServerKey: new Uint8Array([5, 6, 7, 8]).buffer,
        userVisibleOnly: true,
      },
      toJSON: vi.fn().mockReturnValue(oldJson),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    const newSubscription = {
      endpoint: newJson.endpoint,
      toJSON: vi.fn().mockReturnValue(newJson),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    const { registration } = installPushBrowser(oldSubscription)
    registration.pushManager.subscribe.mockResolvedValue(newSubscription)
    apiMocks.getPushConfig.mockResolvedValue({
      data: {
        enabled: true,
        public_key: 'AQIDBA',
        delivery_status: 'ready',
        delivery_mode: 'embedded',
        last_cycle_at: null,
      },
    })
    apiMocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: true, linked_to_other_profile: false },
    })

    const { result } = renderHook(() => usePushNotifications(1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isSubscribed).toBe(false)

    await act(async () => {
      await result.current.subscribe()
    })

    expect(apiMocks.deletePushSubscription).toHaveBeenCalledWith(1, oldJson.endpoint)
    expect(oldSubscription.unsubscribe).toHaveBeenCalledOnce()
    expect(registration.pushManager.subscribe).toHaveBeenCalledOnce()
    expect(apiMocks.savePushSubscription).toHaveBeenCalledWith(1, newJson, false)
    expect(window.localStorage.getItem('ritmo-push-vapid-public-key')).toBe(
      'AQIDBA',
    )
  })

  it('recreates a local endpoint disabled for the same profile', async () => {
    const oldJson = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/server-disabled',
      keys: { p256dh: 'old-p256dh', auth: 'old-auth' },
    }
    const newJson = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/reactivated',
      keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
    }
    const oldSubscription = {
      endpoint: oldJson.endpoint,
      toJSON: vi.fn().mockReturnValue(oldJson),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    const newSubscription = {
      endpoint: newJson.endpoint,
      toJSON: vi.fn().mockReturnValue(newJson),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    const { registration } = installPushBrowser(oldSubscription)
    registration.pushManager.subscribe.mockResolvedValue(newSubscription)
    window.localStorage.setItem('ritmo-push-vapid-public-key', 'current-public-key')
    apiMocks.getPushConfig.mockResolvedValue({
      data: {
        enabled: true,
        public_key: 'current-public-key',
        delivery_status: 'ready',
        delivery_mode: 'embedded',
        last_cycle_at: null,
      },
    })
    apiMocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: false, linked_to_other_profile: false },
    })

    const { result } = renderHook(() => usePushNotifications(1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.subscribe()
    })

    expect(oldSubscription.unsubscribe).toHaveBeenCalledOnce()
    expect(apiMocks.savePushSubscription).toHaveBeenCalledWith(1, newJson, false)
  })

  it('sends a test only to the current browser endpoint', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/current-test-device'
    const subscription = {
      endpoint,
      toJSON: vi.fn().mockReturnValue({ endpoint }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    installPushBrowser(subscription)
    window.localStorage.setItem('ritmo-push-vapid-public-key', 'public-vapid-key')
    apiMocks.getPushConfig.mockResolvedValue({
      data: {
        enabled: true,
        public_key: 'public-vapid-key',
        delivery_status: 'ready',
        delivery_mode: 'embedded',
        last_cycle_at: null,
      },
    })
    apiMocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: true, linked_to_other_profile: false },
    })
    apiMocks.sendPushTest.mockResolvedValue({
      data: { sent: 1, failed: 0, expired: 0 },
    })

    const { result } = renderHook(() => usePushNotifications(1))
    await waitFor(() => expect(result.current.isSubscribed).toBe(true))
    await act(async () => {
      await result.current.sendTest()
    })

    expect(apiMocks.sendPushTest).toHaveBeenCalledWith(1, endpoint)
  })

  it('clears an expired test subscription and asks for activation again', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/expired-test-device'
    const unsubscribe = vi.fn().mockResolvedValue(true)
    const subscription = {
      endpoint,
      toJSON: vi.fn().mockReturnValue({ endpoint }),
      unsubscribe,
    } as unknown as PushSubscription
    installPushBrowser(subscription)
    window.localStorage.setItem('ritmo-push-vapid-public-key', 'public-vapid-key')
    apiMocks.getPushConfig.mockResolvedValue({
      data: {
        enabled: true,
        public_key: 'public-vapid-key',
        delivery_status: 'ready',
        delivery_mode: 'embedded',
        last_cycle_at: null,
      },
    })
    apiMocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: true, linked_to_other_profile: false },
    })
    apiMocks.sendPushTest.mockResolvedValue({
      data: { sent: 0, failed: 0, expired: 1 },
    })

    const { result } = renderHook(() => usePushNotifications(1))
    await waitFor(() => expect(result.current.isSubscribed).toBe(true))
    await act(async () => {
      expect(await result.current.sendTest()).toBe(false)
    })

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem('ritmo-push-vapid-public-key')).toBeNull()
    expect(result.current.isSubscribed).toBe(false)
    expect(result.current.error).toContain('Ative os lembretes novamente')
    expect(apiMocks.getPushConfig).toHaveBeenCalledTimes(2)
  })

  it('refreshes subscription status after a rejected push test', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/rejected-test-device'
    const subscription = {
      endpoint,
      toJSON: vi.fn().mockReturnValue({ endpoint }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription
    installPushBrowser(subscription)
    window.localStorage.setItem('ritmo-push-vapid-public-key', 'public-vapid-key')
    apiMocks.getPushConfig.mockResolvedValue({
      data: {
        enabled: true,
        public_key: 'public-vapid-key',
        delivery_status: 'ready',
        delivery_mode: 'embedded',
        last_cycle_at: null,
      },
    })
    apiMocks.getPushSubscriptionStatus.mockResolvedValue({
      data: { active: true, linked_to_other_profile: false },
    })
    apiMocks.sendPushTest.mockResolvedValue({
      data: { sent: 0, failed: 1, expired: 0 },
    })

    const { result } = renderHook(() => usePushNotifications(1))
    await waitFor(() => expect(result.current.isSubscribed).toBe(true))
    await act(async () => {
      expect(await result.current.sendTest()).toBe(false)
    })

    expect(apiMocks.getPushConfig).toHaveBeenCalledTimes(2)
    expect(result.current.error).toContain('não foi aceito')
  })
})
