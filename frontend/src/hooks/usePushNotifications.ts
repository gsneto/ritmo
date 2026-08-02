import { useCallback, useEffect, useState } from 'react'
import { apiRoutes } from '../services/api'

export const VAPID_PUBLIC_KEY_STORAGE_KEY = 'ritmo-push-vapid-public-key'

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
  )
}

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const normalized = (value + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const decoded = window.atob(normalized)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return bytes
}

export type VapidKeyMatch = 'match' | 'mismatch' | 'unknown'

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

export function subscriptionVapidKeyMatch(
  subscription: PushSubscription,
  publicKey: string,
  savedPublicKey: string | null,
): VapidKeyMatch {
  const applicationServerKey = subscription.options?.applicationServerKey
  try {
    const expected = base64UrlToUint8Array(publicKey)
    if (applicationServerKey) {
      return bytesEqual(new Uint8Array(applicationServerKey), expected)
        ? 'match'
        : 'mismatch'
    }
    if (savedPublicKey) {
      return bytesEqual(base64UrlToUint8Array(savedPublicKey), expected)
        ? 'match'
        : 'mismatch'
    }
  } catch {
    return 'mismatch'
  }
  return 'unknown'
}

export function usePushNotifications(userId: number) {
  const [isConfigured, setIsConfigured] = useState(false)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLinkedToOtherProfile, setIsLinkedToOtherProfile] = useState(false)
  const [deliveryStatus, setDeliveryStatus] = useState<
    'ready' | 'starting' | 'unavailable' | 'external' | 'disabled'
  >('disabled')
  const [deliveryMode, setDeliveryMode] = useState<
    'embedded' | 'external' | 'disabled'
  >('disabled')
  const [lastCycleAt, setLastCycleAt] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const supported = pushSupported()

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError('')
    setIsSubscribed(false)
    setIsLinkedToOtherProfile(false)
    try {
      const response = await apiRoutes.getPushConfig(userId)
      setIsConfigured(response.data.enabled)
      setPublicKey(response.data.public_key)
      setDeliveryStatus(response.data.delivery_status)
      setDeliveryMode(response.data.delivery_mode)
      setLastCycleAt(
        response.data.last_cycle_at ? new Date(response.data.last_cycle_at) : null,
      )
      if (!supported || !response.data.enabled || !response.data.public_key) {
        setIsSubscribed(false)
        setLastSyncedAt(new Date())
        return
      }
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration) {
        setIsSubscribed(false)
        setLastSyncedAt(new Date())
        return
      }
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const subscriptionStatus = await apiRoutes.getPushSubscriptionStatus(
          userId,
          subscription.endpoint,
        )
        const linkedToOtherProfile = subscriptionStatus.data.linked_to_other_profile
        const savedPublicKey = window.localStorage.getItem(
          VAPID_PUBLIC_KEY_STORAGE_KEY,
        )
        const keyMatch = subscriptionVapidKeyMatch(
          subscription,
          response.data.public_key,
          savedPublicKey,
        )
        if (
          keyMatch === 'match'
          || (
            keyMatch === 'unknown'
            && subscriptionStatus.data.active
            && !linkedToOtherProfile
          )
        ) {
          window.localStorage.setItem(
            VAPID_PUBLIC_KEY_STORAGE_KEY,
            response.data.public_key,
          )
        }
        setIsLinkedToOtherProfile(linkedToOtherProfile)
        setIsSubscribed(
          !linkedToOtherProfile
          && subscriptionStatus.data.active
          && keyMatch !== 'mismatch'
          && Notification.permission === 'granted',
        )
      }
      setLastSyncedAt(new Date())
    } catch {
      setError('Não foi possível verificar os lembretes em segundo plano.')
    } finally {
      setIsLoading(false)
    }
  }, [supported, userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!supported) return undefined
    const serviceWorker = navigator.serviceWorker
    const handleControllerChange = () => void refresh()
    serviceWorker.addEventListener('controllerchange', handleControllerChange)
    return () => {
      serviceWorker.removeEventListener('controllerchange', handleControllerChange)
    }
  }, [refresh, supported])

  const subscribe = useCallback(async () => {
    if (!supported || !isConfigured || !publicKey) return false
    setIsLoading(true)
    setError('')
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()
      if (permission !== 'granted') {
        setError('Permissão de notificações não concedida.')
        return false
      }
      const initialRegistration = (
        await navigator.serviceWorker.getRegistration()
        || await navigator.serviceWorker.register('/sw.js')
      )
      const registration = await navigator.serviceWorker.ready || initialRegistration
      const existing = await registration.pushManager.getSubscription()
      let transfer = false
      let created = false
      let subscription = existing
      if (existing) {
        const status = await apiRoutes.getPushSubscriptionStatus(
          userId,
          existing.endpoint,
        )
        transfer = status.data.linked_to_other_profile
        const savedPublicKey = window.localStorage.getItem(
          VAPID_PUBLIC_KEY_STORAGE_KEY,
        )
        const keyMatch = subscriptionVapidKeyMatch(
          existing,
          publicKey,
          savedPublicKey,
        )
        if (keyMatch === 'mismatch' || (!status.data.active && !transfer)) {
          if (!await existing.unsubscribe()) {
            throw new Error('Existing push subscription could not be replaced')
          }
          if (!transfer) {
            await apiRoutes.deletePushSubscription(userId, existing.endpoint)
          }
          subscription = null
          transfer = false
        }
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey),
        })
        created = true
      }
      try {
        await apiRoutes.savePushSubscription(
          userId,
          subscription.toJSON(),
          transfer,
        )
      } catch {
        if (created) await subscription.unsubscribe()
        throw new Error('Push subscription could not be saved')
      }
      window.localStorage.setItem(VAPID_PUBLIC_KEY_STORAGE_KEY, publicKey)
      setIsSubscribed(true)
      setIsLinkedToOtherProfile(false)
      setLastSyncedAt(new Date())
      return true
    } catch {
      setError('Não foi possível ativar os lembretes neste aparelho.')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [isConfigured, publicKey, supported, userId])

  const unsubscribe = useCallback(async () => {
    if (!supported) return false
    setIsLoading(true)
    setError('')
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration) {
        setIsSubscribed(false)
        setIsLinkedToOtherProfile(false)
        return true
      }
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await apiRoutes.deletePushSubscription(userId, subscription.endpoint)
        await subscription.unsubscribe()
      }
      window.localStorage.removeItem(VAPID_PUBLIC_KEY_STORAGE_KEY)
      setIsSubscribed(false)
      setIsLinkedToOtherProfile(false)
      setLastSyncedAt(new Date())
      return true
    } catch {
      setError('Não foi possível desativar os lembretes neste aparelho.')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [supported, userId])

  const sendTest = useCallback(async () => {
    if (!isSubscribed || !isConfigured) return false
    setIsLoading(true)
    setError('')
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      if (!subscription) {
        window.localStorage.removeItem(VAPID_PUBLIC_KEY_STORAGE_KEY)
        await refresh()
        setIsSubscribed(false)
        setError('Este aparelho não possui mais uma inscrição ativa.')
        return false
      }
      const response = await apiRoutes.sendPushTest(userId, subscription.endpoint)
      if (response.data.expired > 0) {
        await refresh()
        try {
          await subscription.unsubscribe()
        } catch {
          // The provider already rejected this endpoint; local state must still reset.
        }
        window.localStorage.removeItem(VAPID_PUBLIC_KEY_STORAGE_KEY)
        setIsSubscribed(false)
        setIsLinkedToOtherProfile(false)
        setError('A inscrição expirou. Ative os lembretes novamente neste aparelho.')
        return false
      }
      if (response.data.sent < 1) {
        await refresh()
        setError('O envio de teste não foi aceito pelo serviço de notificações.')
        return false
      }
      setLastSyncedAt(new Date())
      return true
    } catch {
      await refresh()
      setError('Não foi possível enviar o aviso de teste em segundo plano.')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [isConfigured, isSubscribed, refresh, userId])

  return {
    supported,
    isConfigured,
    isSubscribed,
    isLinkedToOtherProfile,
    deliveryStatus,
    deliveryMode,
    lastCycleAt,
    isLoading,
    error,
    lastSyncedAt,
    subscribe,
    unsubscribe,
    sendTest,
    refresh,
  }
}
