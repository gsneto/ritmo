import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LoginGate from './LoginGate'
import type { PublicProfile } from '../services/api'

const profiles: PublicProfile[] = [
  { login_id: 'handle-um', label: 'Perfil 1' },
  { login_id: 'handle-dois', label: 'Perfil 2' },
]

describe('LoginGate', () => {
  it('submits the selected login handle and password', async () => {
    const onSubmit = vi.fn(async () => undefined)
    render(<LoginGate profiles={profiles} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText('Perfil'), {
      target: { value: 'handle-dois' },
    })
    fireEvent.change(screen.getByLabelText('Senha'), {
      target: { value: 'senha-ficticia' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('handle-dois', 'senha-ficticia')
    })
  })

  it('shows only anonymous labels, never a name', () => {
    render(<LoginGate profiles={profiles} onSubmit={async () => undefined} />)

    const options = screen
      .getAllByRole('option')
      .map(option => option.textContent)

    expect(options).toEqual(['Perfil 1', 'Perfil 2'])
  })

  it('preselects the handle requested by a switch', () => {
    render(
      <LoginGate
        profiles={profiles}
        initialProfileId="handle-dois"
        onSubmit={async () => undefined}
      />,
    )

    expect((screen.getByLabelText('Perfil') as HTMLSelectElement).value).toBe(
      'handle-dois',
    )
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
