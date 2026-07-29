import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACCESS_KEY_STORAGE_KEY,
  api,
  clearAccessKey,
  getAccessKey,
  setAccessKey,
} from './api'

describe('API access key', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('stores and clears a trimmed personal code', () => {
    setAccessKey('  segredo  ')

    expect(getAccessKey()).toBe('segredo')
    expect(window.localStorage.getItem(ACCESS_KEY_STORAGE_KEY)).toBe('segredo')

    clearAccessKey()
    expect(getAccessKey()).toBe('')
  })

  it('adds X-Ritmo-Key to API requests', async () => {
    setAccessKey('segredo')

    const response = await api.get('/test-access-header', {
      adapter: async config => ({
        data: null,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }),
    })

    expect(response.config.headers.get('X-Ritmo-Key')).toBe('segredo')
  })
})
