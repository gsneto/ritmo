const PWA_SHORTCUT_DESTINATIONS: Record<string, string> = {
  'quick-habit': '/habits?quick=1',
  'new-shopping': '/shopping?create=1',
}

export function resolvePwaShortcut(search: string): string | null {
  const action = new URLSearchParams(search).get('action')
  return action ? PWA_SHORTCUT_DESTINATIONS[action] ?? null : null
}
