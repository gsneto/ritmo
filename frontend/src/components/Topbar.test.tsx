import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Topbar from './Topbar'


describe('Topbar', () => {
  it('shows only the first name with the bow and accessible icon controls', () => {
    const onSettingsClick = vi.fn()
    const onThemeChange = vi.fn()

    render(
      <Topbar
        user={{
          id: 1,
          profile_id: 'antonio',
          name: 'Antonio da Silva',
          initials: 'AS',
          theme: 'light',
        }}
        onSettingsClick={onSettingsClick}
        onThemeChange={onThemeChange}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Olá, Antonio!' })).toBeTruthy()
    expect(screen.queryByText('da Silva')).toBeNull()
    expect(screen.getByText('🏹')).toBeTruthy()

    const lightButton = screen.getByRole('button', { name: 'Usar tema claro' })
    const darkButton = screen.getByRole('button', { name: 'Usar tema escuro' })
    expect(lightButton.getAttribute('aria-pressed')).toBe('true')
    expect(darkButton.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(darkButton)
    expect(onThemeChange).toHaveBeenCalledWith('dark')

    fireEvent.click(screen.getByRole('button', { name: 'Abrir ajustes' }))
    expect(onSettingsClick).toHaveBeenCalledOnce()
  })
})
