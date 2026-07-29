import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppLink, RouterProvider, useAppRouter } from './router'

function RouterProbe() {
  const { pathname } = useAppRouter()

  return (
    <>
      <output aria-label="Rota atual">{pathname}</output>
      <AppLink to="/habits">Hábitos</AppLink>
    </>
  )
}

describe('RouterProvider', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/today')
  })

  it('navigates internal links without reloading the page', () => {
    render(
      <RouterProvider>
        <RouterProbe />
      </RouterProvider>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Hábitos' }))

    expect(screen.getByLabelText('Rota atual').textContent).toBe('/habits')
    expect(screen.getByRole('link', { name: 'Hábitos' }).getAttribute('aria-current')).toBe('page')
  })

  it('responds to browser back and forward navigation', () => {
    render(
      <RouterProvider>
        <RouterProbe />
      </RouterProvider>,
    )

    act(() => {
      window.history.pushState({}, '', '/tasks')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(screen.getByLabelText('Rota atual').textContent).toBe('/tasks')
  })
})
