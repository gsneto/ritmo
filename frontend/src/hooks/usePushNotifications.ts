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
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const supported = pushSupported()

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const response = await apiRoutes.getPushConfig(userId)
      setIsConfigured(response.data.enabled)
      setPublicKey(response.data.public_key)
      if (!supported) {
        setIsSubscribed(false)
        return
      }
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration) {
        setIsSubscribed(false)
        return
      }
      const subscription = await registration.pushManager.getSubscription()
      setIsSubscribed(Boolean(subscription))
      if (response.data.enabled && subscription) {
        await apiRoutes.savePushSubscription(userId, subscription.toJSON())
      }
    } catch (loadError) {
      console.error('Failed to load push configuration:', loadError)
      setError('Não foi possível verificar os lembretes em segundo plano.')
    } finally {
      setIsLoading(false)
    }
  }, [supported, userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const subscribe = useCallback(async () => {
    if (!supported || !isConfigured || !publicKey) return false
    setIsLoading(true)
    setError('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setError('Permissão de notificações não concedida.')
        return false
      }
      const registration = (
        await navigator.serviceWorker.getRegistration()
        || await navigator.serviceWorker.register('/sw.js')
      )
      await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      })
      try {
        await apiRoutes.savePushSubscription(userId, subscription.toJSON())
      } catch (saveError) {
        if (!existing) await subscription.unsubscribe()
        throw saveError
      }
      setIsSubscribed(true)
      return true
    } catch (subscribeError) {
      console.error('Failed to subscribe to Web Push:', subscribeError)
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
        return true
      }
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await apiRoutes.deletePushSubscription(userId, subscription.endpoint)
        await subscription.unsubscribe()
      }
      setIsSubscribed(false)
      return true
    } catch (unsubscribeError) {
      console.error('Failed to unsubscribe from Web Push:', unsubscribeError)
      setError('Não foi possível desativar os lembretes neste aparelho.')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [supported, userId])

  return {
    supported,
    isConfigured,
    isSubscribed,
    isLoading,
    error,
    subscribe,
    unsubscribe,
    refresh,
  }
}
