import { render, screen } from '@testing-library/react'
import * as Sentry from '@sentry/react'
import { describe, expect, it, vi } from 'vitest'
import ErrorBoundary from './ErrorBoundary'

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
}))

const testError = new Error('Falha de teste')

function BrokenContent(): never {
  throw testError
}

describe('ErrorBoundary', () => {
  it('shows a Portuguese fallback and reports the exception to Sentry', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const preventWindowError = (event: ErrorEvent) => event.preventDefault()
    window.addEventListener('error', preventWindowError)

    try {
      render(
        <ErrorBoundary>
          <BrokenContent />
        </ErrorBoundary>,
      )

      expect(screen.getByRole('alert').textContent).toContain('Algo deu errado')
      expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy()
      expect(Sentry.captureException).toHaveBeenCalledWith(testError, {
        extra: {
          componentStack: expect.any(String),
        },
      })
    } finally {
      window.removeEventListener('error', preventWindowError)
      consoleError.mockRestore()
    }
  })
})
