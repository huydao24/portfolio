const CACHE_NAME = 'dnh-portfolio-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './index.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});

// Handle push notifications in background
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Tin nhắn mới';
  const options = {
    body: data.body || 'Bạn có thông báo mới từ Huy',
    icon: './images/avatar.jpg',
    badge: './images/avatar.jpg'
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
