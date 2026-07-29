import { useCallback, useEffect, useState } from 'react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function standaloneMode(): boolean {
  if (typeof window === 'undefined') return false
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia?.('(display-mode: standalone)').matches
    || navigatorWithStandalone.standalone === true
}

function iosDevice(): boolean {
  if (typeof window === 'undefined') return false
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

export function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(standaloneMode)

  useEffect(() => {
    function handlePrompt(event: Event) {
      event.preventDefault()
      setPromptEvent(event as InstallPromptEvent)
    }

    function handleInstalled() {
      setPromptEvent(null)
      setIsInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handlePrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (!promptEvent) return false
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    if (choice.outcome === 'accepted') {
      setPromptEvent(null)
      setIsInstalled(true)
      return true
    }
    return false
  }, [promptEvent])

  return {
    canInstall: promptEvent !== null,
    isInstalled,
    isIos: iosDevice(),
    install,
  }
}
