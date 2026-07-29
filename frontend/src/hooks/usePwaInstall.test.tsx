import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PwaInstallProvider,
  usePwaInstall,
} from './usePwaInstall'

function InstallConsumer() {
  const {
    canInstall,
    install,
    isAndroid,
    isInstalled,
  } = usePwaInstall()

  return (
    <div>
      <span>{isAndroid ? 'Android' : 'Outro sistema'}</span>
      <span>{canInstall ? 'Pode instalar' : 'Sem aviso'}</span>
      <span>{isInstalled ? 'Instalado' : 'Não instalado'}</span>
      {canInstall && (
        <button type="button" onClick={() => void install()}>
          Instalar
        </button>
      )}
    </div>
  )
}

function DelayedConsumer() {
  const [showConsumer, setShowConsumer] = useState(false)
  return (
    <PwaInstallProvider>
      <button type="button" onClick={() => setShowConsumer(true)}>
        Abrir ajustes
      </button>
      {showConsumer && <InstallConsumer />}
    </PwaInstallProvider>
  )
}

describe('PWA installation', () => {
  const originalUserAgent = window.navigator.userAgent

  afterEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent,
    })
    vi.restoreAllMocks()
  })

  it('keeps the Android install prompt until the settings UI opens', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/138 Mobile',
    })
    const prompt = vi.fn().mockResolvedValue(undefined)
    const installEvent = new Event('beforeinstallprompt', {
      cancelable: true,
    })
    Object.assign(installEvent, {
      prompt,
      userChoice: Promise.resolve({
        outcome: 'accepted',
        platform: 'web',
      }),
    })

    render(<DelayedConsumer />)
    window.dispatchEvent(installEvent)
    expect(installEvent.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir ajustes' }))
    expect(screen.getByText('Android')).toBeTruthy()
    expect(screen.getByText('Pode instalar')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Instalar' }))
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    expect(await screen.findByText('Instalado')).toBeTruthy()
  })
})
