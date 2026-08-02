import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotifications } from '../hooks/useNotifications'
import { usePwaInstall } from '../hooks/usePwaInstall'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { apiRoutes } from '../services/api'
import type { RitmoBackup, User } from '../services/api'
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

const getBriefingSettings = vi.spyOn(apiRoutes, 'getBriefingSettings')
const updateBriefingSettings = vi.spyOn(apiRoutes, 'updateBriefingSettings')

const user: User = {
  id: 1,
  profile_id: 'antonio',
  name: 'Antonio',
  initials: 'AN',
  theme: 'dark',
}

describe('settings mobile installation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBriefingSettings.mockResolvedValue({
      data: { enabled: false, time: '07:30' },
    } as never)
    updateBriefingSettings.mockResolvedValue({
      data: { enabled: true, time: '06:45' },
    } as never)
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
      deliveryStatus: 'disabled',
      deliveryMode: 'disabled',
      lastCycleAt: null,
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

  it('restores a version 2 backup selected from the device', async () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isInstalled: true,
      isIos: false,
      isAndroid: true,
      install: vi.fn(),
    })
    const restoreRequest = vi.spyOn(apiRoutes, 'restoreUserBackup').mockResolvedValue({
      data: { message: 'restored', restored: { habits: 1, tasks: 2 } },
    } as never)
    const confirmRestore = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onDataReset = vi.fn()
    const backup: RitmoBackup = {
      version: 2,
      app: 'Ritmo',
      exported_at: '2026-08-01T12:00:00Z',
      profile: { name: 'Antonio', initials: 'AN', theme: 'dark' },
      habits: [],
      tasks: [],
      shopping_lists: [],
      shopping_budgets: [],
      workouts: [],
      workout_sessions: [],
      workout_preferences: [],
      reading_books: [],
    }
    const file = new File([JSON.stringify(backup)], 'ritmo-v2.json', {
      type: 'application/json',
    })
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: vi.fn().mockResolvedValue(JSON.stringify(backup)),
    })

    render(
      <Settings
        user={user}
        users={[user]}
        onUserChange={vi.fn()}
        onDataReset={onDataReset}
        onChangeAccessCode={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Escolher backup JSON do Ritmo'), {
      target: { files: [file] },
    })

    await waitFor(() => expect(restoreRequest).toHaveBeenCalledWith(1, backup))
    expect(screen.getByRole('status').textContent).toContain(
      'Backup restaurado com segurança: 3 registros principais.',
    )
    expect(onDataReset).toHaveBeenCalledOnce()

    confirmRestore.mockRestore()
    restoreRequest.mockRestore()
  })

  it('describes the profile content reset without promising to remove everything', () => {
    vi.mocked(usePwaInstall).mockReturnValue({
      canInstall: false,
      isInstalled: true,
      isIos: false,
      isAndroid: true,
      install: vi.fn(),
    })
    const confirmReset = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(
      <Settings
        user={user}
        users={[user]}
        onUserChange={vi.fn()}
        onChangeAccessCode={vi.fn()}
      />,
    )

    expect(screen.getByText(/Preserva nome, iniciais e tema, pareamento de compras/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar conteúdo do perfil' }))
    expect(confirmReset).toHaveBeenCalledWith(expect.stringContaining(
      'vínculo push e configuração do briefing serão preservados',
    ))
    expect(confirmReset).toHaveBeenCalledWith(expect.stringContaining(
      'Os treinos padrão serão recriados.',
    ))

    confirmReset.mockRestore()
  })

  it('configures the daily ANAHÍ briefing for the active profile', async () => {
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

    const enabled = await screen.findByRole('checkbox', {
      name: 'Receber briefing diário',
    })
    await waitFor(() => expect((enabled as HTMLInputElement).disabled).toBe(false))
    fireEvent.click(enabled)
    fireEvent.change(screen.getByLabelText('Horário'), {
      target: { value: '06:45' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar briefing' }))

    await waitFor(() => {
      expect(updateBriefingSettings).toHaveBeenCalledWith(1, {
        enabled: true,
        time: '06:45',
      })
    })
    expect(screen.getByText('Briefing diário programado para 06:45.')).toBeTruthy()
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
      deliveryStatus: 'ready',
      deliveryMode: 'embedded',
      lastCycleAt: new Date('2026-08-01T12:00:00Z'),
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
      deliveryStatus: 'ready',
      deliveryMode: 'embedded',
      lastCycleAt: null,
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

  it('warns when a subscribed device has no healthy background processor', () => {
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
      deliveryStatus: 'unavailable',
      deliveryMode: 'embedded',
      lastCycleAt: new Date('2026-08-01T12:00:00Z'),
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

    expect(screen.getByText('Segundo plano não está processando')).toBeTruthy()
    expect(screen.getByText(/Avisos locais dependem de o Ritmo estar aberto/)).toBeTruthy()
    expect(screen.getByText(/Última execução:/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Testar agora' })).toBeTruthy()
  })
})
