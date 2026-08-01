import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotifications } from '../hooks/useNotifications'
import { usePwaInstall } from '../hooks/usePwaInstall'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { apiRoutes } from '../services/api'
import type { User } from '../services/api'
import Settings from './Settings'

vi.mock('../hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
}))

vi.mock('../hooks/usePwaInstall', () => ({
  usePwaInstall: vi.fn(),
}))

vi.mock('../hooks/usePushNotifications', () => ({
  usePushNotifications: vi.fn(),
}))

const user: User = {
  id: 1,
  profile_id: 'antonio',
  name: 'Antonio',
  initials: 'AN',
  theme: 'dark',
}

describe('settings mobile installation', () => {
  beforeEach(() => {
    vi.mocked(useNotifications).mockReturnValue({
      permission: 'default',
      requestPermission: vi.fn(),
      sendNotification: vi.fn(),
      isSupported: false,
      isSecureContext: true,
    })
    vi.mocked(usePushNotifications).mockReturnValue({
      supported: false,
      isConfigured: false,
      isSubscribed: false,
      isLinkedToOtherProfile: false,
      isLoading: false,
      error: '',
      lastSyncedAt: null,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      sendTest: vi.fn(),
      refresh: vi.fn(),
    })
  })

  it('shows the Android Chrome menu path when a native prompt is unavailable', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isInstalled: false,
      isIos: false,
      isAndroid: true,
      install: vi.fn(),
    })

    render(
      <Settings
        user={user}
        users={[user]}
        onUserChange={vi.fn()}
        onChangeAccessCode={vi.fn()}
      />,
    )

    expect(screen.getByText(
      'Chrome: menu ⋮ → Instalar app ou Adicionar à tela inicial',
    )).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Instalar' })).toBeNull()
  })

  it('uses the Android install prompt when Chrome makes it available', async () => {
    const install = vi.fn().mockResolvedValue(true)
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: true,
      isInstalled: false,
      isIos: false,
      isAndroid: true,
      install,
    })

    render(
      <Settings
        user={user}
        users={[user]}
        onUserChange={vi.fn()}
        onChangeAccessCode={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Instalar' }))
    await waitFor(() => expect(install).toHaveBeenCalledOnce())
    expect((await screen.findByRole('status')).textContent).toContain(
      'Instalação iniciada',
    )
  })

  it('downloads the calendar export for the active profile', async () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isInstalled: true,
      isIos: false,
      isAndroid: true,
      install: vi.fn(),
    })
    const exportRequest = vi.spyOn(apiRoutes, 'getCalendarExport').mockResolvedValue({
      data: new Blob(['BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'], {
        type: 'text/calendar',
      }),
    } as never)
    const createObjectUrl = vi.fn(() => 'blob:ritmo-calendar')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(
      <Settings
        user={user}
        users={[user]}
        onUserChange={vi.fn()}
        onChangeAccessCode={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Exportar calendário' }))

    await waitFor(() => expect(exportRequest).toHaveBeenCalledWith(1))
    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(screen.getByRole('status').textContent).toContain('Calendário baixado')

    click.mockRestore()
    exportRequest.mockRestore()
  })

  it('explains why notifications cannot work over an insecure phone address', () => {
    vi.mocked(useNotifications).mockReturnValue({
      permission: 'default',
      requestPermission: vi.fn(),
      sendNotification: vi.fn(),
      isSupported: false,
      isSecureContext: false,
    })
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isInstalled: false,
      isIos: false,
      isAndroid: true,
      install: vi.fn(),
    })

    render(
      <Settings
        user={user}
        users={[user]}
        onUserChange={vi.fn()}
        onChangeAccessCode={vi.fn()}
      />,
    )

    expect(screen.getByText('Abra pelo endereço seguro')).toBeTruthy()
    expect(screen.getByText(/não funcionam pelo IP iniciado com http:\/\//i)).toBeTruthy()
  })

  it('sends a visible local test when permission is already granted', async () => {
    const sendNotification = vi.fn().mockResolvedValue({})
    vi.mocked(useNotifications).mockReturnValue({
      permission: 'granted',
      requestPermission: vi.fn(),
      sendNotification,
      isSupported: true,
      isSecureContext: true,
    })
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isInstalled: true,
      isIos: false,
      isAndroid: true,
      install: vi.fn(),
    })

    render(
      <Settings
        user={user}
        users={[user]}
        onUserChange={vi.fn()}
        onChangeAccessCode={vi.fn()}
      />,
    )

    expect(screen.getByText('Alertas com o app aberto')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Testar agora' }))
    await waitFor(() => expect(sendNotification).toHaveBeenCalledOnce())
    expect(screen.getByRole('status').textContent).toContain('Aviso local enviado')
  })

  it('describes a background test as accepted by the service, not confirmed by the phone', async () => {
    const sendTest = vi.fn().mockResolvedValue(true)
    vi.mocked(useNotifications).mockReturnValue({
      permission: 'granted',
      requestPermission: vi.fn(),
      sendNotification: vi.fn(),
      isSupported: true,
      isSecureContext: true,
    })
    vi.mocked(usePushNotifications).mockReturnValue({
      supported: true,
      isConfigured: true,
      isSubscribed: true,
      isLinkedToOtherProfile: false,
      isLoading: false,
      error: '',
      lastSyncedAt: null,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      sendTest,
      refresh: vi.fn(),
    })
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isInstalled: true,
      isIos: false,
      isAndroid: true,
      install: vi.fn(),
    })

    render(
      <Settings
        user={user}
        users={[user]}
        onUserChange={vi.fn()}
        onChangeAccessCode={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Testar agora' }))
    await waitFor(() => expect(sendTest).toHaveBeenCalledOnce())
    expect(screen.getByRole('status').textContent).toContain(
      'Envio de teste aceito pelo serviço; confira a bandeja de notificações.',
    )
  })

  it('tells iPhone users to install the PWA before enabling notifications', () => {
    vi.mocked(useNotifications).mockReturnValue({
      permission: 'default',
      requestPermission: vi.fn(),
      sendNotification: vi.fn(),
      isSupported: true,
      isSecureContext: true,
    })
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isInstalled: false,
      isIos: true,
      isAndroid: false,
      install: vi.fn(),
    })

    render(
      <Settings
        user={user}
        users={[user]}
        onUserChange={vi.fn()}
        onChangeAccessCode={vi.fn()}
      />,
    )

    expect(screen.getByText('Instale o Ritmo primeiro')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ativar' })).toBeNull()
  })

  it('makes moving a browser subscription to this profile explicit', () => {
    vi.mocked(useNotifications).mockReturnValue({
      permission: 'granted',
      requestPermission: vi.fn(),
      sendNotification: vi.fn(),
      isSupported: true,
      isSecureContext: true,
    })
    vi.mocked(usePushNotifications).mockReturnValue({
      supported: true,
      isConfigured: true,
      isSubscribed: false,
      isLinkedToOtherProfile: true,
      isLoading: false,
      error: '',
      lastSyncedAt: null,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      sendTest: vi.fn(),
      refresh: vi.fn(),
    })
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isInstalled: true,
      isIos: false,
      isAndroid: true,
      install: vi.fn(),
    })

    render(
      <Settings
        user={user}
        users={[user]}
        onUserChange={vi.fn()}
        onChangeAccessCode={vi.fn()}
      />,
    )

    expect(screen.getByText(/vinculado a outro perfil/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ativar neste perfil' })).toBeTruthy()
  })
})
