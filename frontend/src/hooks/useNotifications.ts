import { useState, useCallback, useEffect } from 'react'

interface NotificationOptions {
  title: string
  body: string
  icon?: string
}

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default')

  useEffect(() => {
    setPermission(Notification.permission)
  }, [])

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) {
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

  const sendNotification = useCallback(async (options: NotificationOptions) => {
    if (permission !== 'granted') {
      const granted = await requestPermission()
      if (!granted) return null
    }

    if ('Notification' in window) {
      const notification = new Notification(options.title, {
        body: options.body,
        icon: options.icon || '/vite.svg',
        badge: '/vite.svg',
        tag: 'ritmo-notification',
        renotify: true,
      })

      // Auto close after 5 seconds
      setTimeout(() => notification.close(), 5000)

      return notification
    }

    return null
  }, [permission, requestPermission])

  return {
    permission,
    requestPermission,
    sendNotification,
    isSupported: 'Notification' in window,
  }
}

// Convenience functions for common notifications
export const notify = {
  checkin: (habitName: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Check-in realizado! ✅', {
        body: `Você registrou o hábito: ${habitName}`,
        tag: 'ritmo-checkin',
      })
    }
  },

  pomodoroComplete: (phase: 'focus' | 'break') => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const title = phase === 'focus' ? 'Tempo de foco concluído! 🎯' : 'Pausa terminada! ☕'
      const body = phase === 'focus'
        ? 'Ótimo trabalho! Faça uma pausa.'
        : 'Hora de voltar ao foco!'

      new Notification(title, {
        body,
        tag: 'ritmo-pomodoro',
      })
    }
  },

  taskDue: (taskName: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Tarefa atrasada! ⚠️', {
        body: `A tarefa "${taskName}" está vencida.`,
        tag: 'ritmo-task',
      })
    }
  },

  streakMilestone: (days: number) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`Sequência de ${days} dias! 🔥`, {
        body: 'Você está mantendo seus hábitos!',
        tag: 'ritmo-streak',
      })
    }
  },
}
