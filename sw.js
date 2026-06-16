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

self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Just For Jess ✦', {
      body:  data.body  || 'Your card for today is waiting 💛',
      icon:  '/jess/icon-192.png',
      badge: '/jess/icon-192.png',
      data:  { url: data.url || 'https://arjen-rave.github.io/jess' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
