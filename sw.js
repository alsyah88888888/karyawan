const CACHE_NAME = 'koboi-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/admin.html',
  '/karyawan_portal.html',
  '/style.css',
  '/script.js',
  '/portal.js',
  '/images/koboi.png?v=2'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        return fetch(event.request);
      })
  );
});
