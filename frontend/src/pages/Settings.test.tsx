import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotifications } from '../hooks/useNotifications'
import { usePwaInstall } from '../hooks/usePwaInstall'
import { usePushNotifications } from '../hooks/usePushNotifications'
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
    })
    vi.mocked(usePushNotifications).mockReturnValue({
      supported: false,
      isConfigured: false,
      isSubscribed: false,
      isLoading: false,
      error: '',
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
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
})
