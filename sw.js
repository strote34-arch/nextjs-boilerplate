// afishi.ru Service Worker v2.1
const CACHE_NAME   = 'afishiru-v2.1';
const STATIC_CACHE = 'afishiru-static-v2.1';
const API_CACHE    = 'afishiru-api-v2.1';

// Статические файлы — кэшировать навсегда
const STATIC_URLS = [
  '/', '/index.html', '/concerts.html', '/cinema.html',
  '/theater.html', '/exhibits.html', '/kids.html',
  '/articles.html', '/map.html', '/manifest.json',
  '/mobile.css', '/sw.js'
];

// ── Install: предзагрузить статику ────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(STATIC_URLS.filter(u => u !== '/map.html'));
    }).catch(() => {})
  );
  self.skipWaiting();
});

// ── Activate: удалить старые кэши ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== STATIC_CACHE && k !== API_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: стратегия Network First для HTML, Cache First для статики
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API запросы — Network Only (геолокация)
  if (url.pathname.startsWith('/api/')) {
    return; // без кэша
  }

  // HTML — Network First (свежие данные), fallback cache
  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(STATIC_CACHE).then(c => c.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Всё остальное — Cache First
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          const clone = resp.clone();
          caches.open(STATIC_CACHE).then(c => c.put(event.request, clone));
        }
        return resp;
      });
    })
  );
});

// ── Push уведомления ──────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Афиши.ру — новое событие!';
  const opts = {
    body:  data.body  || 'Новые мероприятия в вашем городе',
    icon:  data.icon  || '/images/icon-192.png',
    badge: data.badge || '/images/icon-72.png',
    image: data.image,
    data:  { url: data.url || '/' },
    actions: [
      { action: 'open',    title: 'Открыть' },
      { action: 'dismiss', title: 'Закрыть' },
    ]
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action !== 'dismiss') {
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(clients.openWindow(url));
  }
});
