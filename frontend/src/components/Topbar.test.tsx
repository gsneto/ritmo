import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Topbar from './Topbar'


describe('Topbar', () => {
  it('shows only the first name with the bow and an accessible more-options menu', () => {
    const onMenuNavigate = vi.fn()
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
        onMenuNavigate={onMenuNavigate}
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

    const menuButton = screen.getByRole('button', { name: 'Abrir mais opções' })
    expect(menuButton.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(menuButton)
    expect(menuButton.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Treinos' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Leitura' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Evolução' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Configurações' })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Treinos' }))
    expect(onMenuNavigate).toHaveBeenCalledWith('/workouts')
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(menuButton)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leitura' }))
    expect(onMenuNavigate).toHaveBeenCalledWith('/reading')
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(menuButton)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Evolução' }))
    expect(onMenuNavigate).toHaveBeenCalledWith('/progress')
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(menuButton)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configurações' }))
    expect(onMenuNavigate).toHaveBeenCalledWith('/settings')
  })
})
