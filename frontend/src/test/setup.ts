import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  writable: true,
  value: vi.fn(),
})

afterEach(() => {
  cleanup()
  vi.mocked(window.scrollTo).mockClear()
})
