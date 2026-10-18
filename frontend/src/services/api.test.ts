import type { AxiosAdapter } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, isForbiddenError, isUnauthorizedError, readCsrfToken } from './api'

const okAdapter: AxiosAdapter = async config => ({
  data: null,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

const originalCookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')

function mockCookies(value: string) {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => value,
    set: () => {
      // jsdom cannot persist __Host- cookies; tests only read the value.
    },
  })
}

describe('API browser session', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    if (originalCookie) {
      Object.defineProperty(Document.prototype, 'cookie', originalCookie)
    }
    delete (document as unknown as { cookie?: string }).cookie
  })

  it('never stores an access key in localStorage', () => {
    expect(Object.keys(window.localStorage)).toHaveLength(0)
  })

  it('sends cookies with API requests', () => {
    expect(api.defaults.withCredentials).toBe(true)
  })

  it('reads both cookie names', () => {
    mockCookies('outro=1; ritmo_csrf=token-simples; fim=2')
    expect(readCsrfToken()).toBe('token-simples')

    mockCookies('__Host-ritmo_csrf=token-host')
    expect(readCsrfToken()).toBe('token-host')

    mockCookies('outro=1')
    expect(readCsrfToken()).toBe('')
  })

  it('echoes the CSRF cookie on mutating requests only', async () => {
    mockCookies('ritmo_csrf=token-de-teste')

    const readResponse = await api.get('/test-csrf-read', { adapter: okAdapter })
    const writeResponse = await api.post('/test-csrf-write', null, {
      adapter: okAdapter,
    })

    expect(readResponse.config.headers.get('X-CSRF-Token')).toBeUndefined()
    expect(writeResponse.config.headers.get('X-CSRF-Token')).toBe('token-de-teste')
    expect(writeResponse.config.headers.get('X-Ritmo-Key')).toBeUndefined()
  })

  it('distinguishes 401 from 403', () => {
    const unauthorized = Object.assign(new Error('401'), {
      isAxiosError: true,
      response: { status: 401 },
    })
    const forbidden = Object.assign(new Error('403'), {
      isAxiosError: true,
      response: { status: 403 },
    })

    expect(isUnauthorizedError(unauthorized)).toBe(true)
    expect(isUnauthorizedError(forbidden)).toBe(false)
    expect(isForbiddenError(forbidden)).toBe(true)
  })
})
