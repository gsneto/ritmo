import { useState, useCallback, useEffect } from 'react'

interface RitmoNotificationOptions {
  title: string
  body: string
  icon?: string
}

function notificationsAvailable(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

function currentPermission(): NotificationPermission {
  return notificationsAvailable() ? Notification.permission : 'default'
}

function canNotify(): boolean {
  return notificationsAvailable() && Notification.permission === 'granted'
}

async function showSystemNotification(
  title: string,
  options: NotificationOptions,
) {
  if (!canNotify()) return null

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        await registration.showNotification(title, {
          ...options,
          icon: options.icon || '/ritmo-icon-192.png',
          badge: '/ritmo-icon-192.png',
        })
        return registration
      }
    } catch (error) {
      console.warn('Service worker notification unavailable:', error)
    }
  }

  const notification = new Notification(title, options)
  setTimeout(() => notification.close(), 5000)
  return notification
}

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(currentPermission)

  useEffect(() => {
    if (notificationsAvailable()) {
      setPermission(Notification.permission)
    }
  }, [])

  const requestPermission = useCallback(async () => {
    if (!notificationsAvailable()) {
      console.warn('Notifications not supported')
      return false
    }

    if (Notification.permission === 'granted') {
      return true
    }

    if (Notification.permission !== 'denied') {
      const result = await Notification.requestPermission()
      setPermission(result)
      return result === 'granted'
    }

    return false
  }, [])

  const sendNotification = useCallback(async (options: RitmoNotificationOptions) => {
    if (!notificationsAvailable()) return null

    if (permission !== 'granted') {
      const granted = await requestPermission()
      if (!granted) return null
    }

    return showSystemNotification(options.title, {
      body: options.body,
      icon: options.icon || '/ritmo-icon-192.png',
      tag: 'ritmo-notification',
    })
  }, [permission, requestPermission])

  return {
    permission,
    requestPermission,
    sendNotification,
    isSupported: notificationsAvailable(),
  }
}

// Convenience functions for common notifications
export const notify = {
  reminder: (
    title: string,
    body: string,
    url = '/today',
    tag = 'ritmo-reminder',
  ) => {
    if (canNotify()) {
      void showSystemNotification(title, {
        body,
        tag,
        data: { url },
      })
    }
  },

  checkin: (habitName: string) => {
    if (canNotify()) {
      void showSystemNotification('Check-in realizado! ✅', {
        body: `Você registrou o hábito: ${habitName}`,
        tag: 'ritmo-checkin',
      })
    }
  },

  pomodoroComplete: (phase: 'focus' | 'break') => {
    if (canNotify()) {
      const title = phase === 'focus' ? 'Tempo de foco concluído! 🎯' : 'Pausa terminada! ☕'
      const body = phase === 'focus'
        ? 'Ótimo trabalho! Faça uma pausa.'
        : 'Hora de voltar ao foco!'

      void showSystemNotification(title, {
        body,
        tag: 'ritmo-pomodoro',
      })
    }
  },

  taskDue: (taskName: string) => {
    if (canNotify()) {
      void showSystemNotification('Tarefa atrasada! ⚠️', {
        body: `A tarefa "${taskName}" está vencida.`,
        tag: 'ritmo-task',
      })
    }
  },

  streakMilestone: (days: number) => {
    if (canNotify()) {
      void showSystemNotification(`Sequência de ${days} dias! 🔥`, {
        body: 'Você está mantendo seus hábitos!',
        tag: 'ritmo-streak',
      })
    }
  },
}
