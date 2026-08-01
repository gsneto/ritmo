import { useCallback, useEffect, useState } from 'react'
import { apiRoutes } from '../services/api'

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

export function usePushNotifications(userId: number) {
  const [isConfigured, setIsConfigured] = useState(false)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLinkedToOtherProfile, setIsLinkedToOtherProfile] = useState(false)
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
        setIsSubscribed(
          subscriptionStatus.data.active && Notification.permission === 'granted',
        )
        setIsLinkedToOtherProfile(
          subscriptionStatus.data.linked_to_other_profile,
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
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      })
      try {
        await apiRoutes.savePushSubscription(
          userId,
          subscription.toJSON(),
          Boolean(existing),
        )
      } catch {
        if (!existing) await subscription.unsubscribe()
        throw new Error('Push subscription could not be saved')
      }
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
      const response = await apiRoutes.sendPushTest(userId)
      if (response.data.sent < 1) {
        setError('O envio de teste não foi aceito pelo serviço de notificações.')
        return false
      }
      setLastSyncedAt(new Date())
      return true
    } catch {
      setError('Não foi possível enviar o aviso de teste em segundo plano.')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [isConfigured, isSubscribed, userId])

  return {
    supported,
    isConfigured,
    isSubscribed,
    isLinkedToOtherProfile,
    isLoading,
    error,
    lastSyncedAt,
    subscribe,
    unsubscribe,
    sendTest,
    refresh,
  }
}
