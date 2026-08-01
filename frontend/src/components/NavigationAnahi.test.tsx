import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { RouterProvider } from '../router'
import Navigation from './Navigation'

describe('Navigation with ANAHÍ', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/today')
  })

  it('places ANAHÍ as the last item on the right of the main navigation', () => {
    render(
      <RouterProvider>
        <Navigation />
      </RouterProvider>,
    )

    const links = screen.getAllByRole('link')
    const anahiLink = screen.getByRole('link', { name: 'ANAHÍ' })

    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/today',
      '/habits',
      '/tasks',
      '/shopping',
      '/anahi',
    ])
    expect(links[links.length - 1]).toBe(anahiLink)

    fireEvent.click(anahiLink)
    expect(anahiLink.getAttribute('aria-current')).toBe('page')
  })
})
