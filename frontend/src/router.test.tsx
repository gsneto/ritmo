import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('opens each route at the top of the page', () => {
    render(
      <RouterProvider>
        <RouterProbe />
      </RouterProvider>,
    )
    vi.mocked(window.scrollTo).mockClear()
    document.documentElement.scrollTop = 640
    document.body.scrollTop = 640

    fireEvent.click(screen.getByRole('link', { name: 'Hábitos' }))

    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: 'auto',
    })
    expect(document.documentElement.scrollTop).toBe(0)
    expect(document.body.scrollTop).toBe(0)
  })

  it('keeps the current scroll when only route parameters change', () => {
    render(
      <RouterProvider>
        <RouterProbe />
      </RouterProvider>,
    )
    vi.mocked(window.scrollTo).mockClear()

    act(() => {
      window.history.pushState({}, '', '/today?create=1')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(window.scrollTo).not.toHaveBeenCalled()
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
