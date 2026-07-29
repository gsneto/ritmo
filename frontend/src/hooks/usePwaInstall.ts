import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'

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
    || (
      /macintosh/i.test(window.navigator.userAgent)
      && window.navigator.maxTouchPoints > 1
    )
}

function androidDevice(): boolean {
  if (typeof window === 'undefined') return false
  return /android/i.test(window.navigator.userAgent)
}

interface PwaInstallContextValue {
  canInstall: boolean
  isInstalled: boolean
  isIos: boolean
  isAndroid: boolean
  install: () => Promise<boolean>
}

interface PwaInstallProviderProps {
  children: ReactNode
}

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null)

export function PwaInstallProvider({
  children,
}: PwaInstallProviderProps) {
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

    const displayMode = window.matchMedia?.('(display-mode: standalone)')
    function handleDisplayModeChange() {
      setIsInstalled(standaloneMode())
    }

    window.addEventListener('beforeinstallprompt', handlePrompt)
    window.addEventListener('appinstalled', handleInstalled)
    displayMode?.addEventListener?.('change', handleDisplayModeChange)
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      displayMode?.removeEventListener?.('change', handleDisplayModeChange)
    }
  }, [])

  const install = useCallback(async () => {
    if (!promptEvent) return false
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    setPromptEvent(null)
    if (choice.outcome === 'accepted') {
      setIsInstalled(true)
      return true
    }
    return false
  }, [promptEvent])

  const value = useMemo<PwaInstallContextValue>(() => ({
    canInstall: promptEvent !== null,
    isInstalled,
    isIos: iosDevice(),
    isAndroid: androidDevice(),
    install,
  }), [install, isInstalled, promptEvent])

  return createElement(
    PwaInstallContext.Provider,
    { value },
    children,
  )
}

export function usePwaInstall(): PwaInstallContextValue {
  const context = useContext(PwaInstallContext)
  if (!context) {
    throw new Error('usePwaInstall must be used inside PwaInstallProvider')
  }
  return context
}
