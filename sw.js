const CACHE = 'jj-v1';
const ASSETS = [
  '/jess/',
  '/jess/index.html',
  '/jess/manifest.json',
  '/jess/icon-192.png',
  '/jess/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

self.addEventListener('push', e => {
  e.waitUntil(
    self.registration.showNotification('Just For Jess ✦', {
      body: 'Your card for today is waiting 💛',
      icon: '/jess/icon-192.png',
      badge: '/jess/icon-192.png'
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('/jess') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/jess/');
    })
  );
});
