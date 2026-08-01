import { describe, expect, it } from 'vitest'
import { resolvePwaShortcut } from './pwaShortcuts'

describe('PWA shortcuts', () => {
  it('maps supported manifest actions to an in-app destination', () => {
    expect(resolvePwaShortcut('?action=quick-habit')).toBe('/habits?quick=1')
    expect(resolvePwaShortcut('?action=new-shopping')).toBe('/shopping?create=1')
    expect(resolvePwaShortcut('?action=unknown')).toBeNull()
  })
})
