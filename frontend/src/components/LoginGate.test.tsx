import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LoginGate from './LoginGate'
import type { PublicProfile } from '../services/api'

const profiles: PublicProfile[] = [
  { profile_id: 'antonio', name: 'Antonio', initials: 'A', theme: 'light' },
  { profile_id: 'itayna', name: 'Itayna', initials: 'I', theme: 'light' },
]

describe('LoginGate', () => {
  it('submits the selected profile and password', async () => {
    const onSubmit = vi.fn(async () => undefined)
    render(<LoginGate profiles={profiles} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText('Perfil'), {
      target: { value: 'itayna' },
    })
    fireEvent.change(screen.getByLabelText('Senha'), {
      target: { value: 'senha-ficticia' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('itayna', 'senha-ficticia')
    })
  })

  it('preselects the profile requested by a switch', () => {
    render(
      <LoginGate
        profiles={profiles}
        initialProfileId="itayna"
        onSubmit={async () => undefined}
      />,
    )

    expect((screen.getByLabelText('Perfil') as HTMLSelectElement).value).toBe('itayna')
  })

  it('announces a rejected login without revealing which field failed', () => {
    render(
      <LoginGate
        profiles={profiles}
        message="Perfil ou senha inválidos."
        onSubmit={async () => undefined}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('Perfil ou senha inválidos')
  })

  it('does not submit an empty password', async () => {
    const onSubmit = vi.fn(async () => undefined)
    render(<LoginGate profiles={profiles} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })
})
