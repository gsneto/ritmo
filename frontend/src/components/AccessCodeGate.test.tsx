import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AccessCodeGate from './AccessCodeGate'

describe('AccessCodeGate', () => {
  it('submits a trimmed personal code without account fields', async () => {
    const onSubmit = vi.fn(async () => undefined)
    render(<AccessCodeGate onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText('Código da casa'), {
      target: { value: '  meu-segredo  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('meu-segredo')
    })
    expect(screen.queryByLabelText(/usuário|e-mail/i)).toBeNull()
  })

  it('announces an invalid-code message', () => {
    render(
      <AccessCodeGate
        message="Código recusado. Confira e tente novamente."
        onSubmit={async () => undefined}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('Código recusado')
  })
})
