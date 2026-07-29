const CACHE_NAME = 'ritmo-shell-v4'
const APP_SHELL = [
  '/',
  '/today',
  '/offline.html',
  '/manifest.webmanifest',
  '/grafismo-indigena-ritmo.png',
  '/ritmo-icon-192.png',
  '/ritmo-icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({
          detail: 'O Ritmo está offline. Seus dados continuam seguros e poderão ser atualizados quando a conexão voltar.',
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      )),
    )
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put('/', copy))
          return response
        })
        .catch(async () => (
          await caches.match('/offline.html')
          || await caches.match('/')
        )),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(cached => (
      cached
      || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
        }
        return response
      })
    )),
  )
})

self.addEventListener('push', event => {
  let payload = {
    title: 'Ritmo',
    body: 'Você tem um lembrete no seu dia.',
    url: '/today',
  }

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() }
    } catch {
      payload.body = event.data.text()
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/ritmo-icon-192.png',
      badge: '/ritmo-icon-192.png',
      tag: payload.tag || 'ritmo-reminder',
      data: { url: payload.url || '/today' },
    }),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = event.notification.data?.url || '/today'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        const existing = clients.find(client => 'focus' in client)
        if (existing) {
          existing.navigate(target)
          return existing.focus()
        }
        return self.clients.openWindow(target)
      }),
  )
})
