import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RouterProvider } from '../router'
import Navigation from './Navigation'

describe('Navigation', () => {
  it('keeps the four daily areas and ANAHÍ in the bottom navigation', () => {
    render(
      <RouterProvider>
        <Navigation />
      </RouterProvider>,
    )

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(5)
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/today',
      '/habits',
      '/tasks',
      '/shopping',
      '/anahi',
    ])
    expect(screen.queryByRole('link', { name: 'Foco' })).toBeNull()
  })
})
