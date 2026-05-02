const CACHE_NAME = 'koboi-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './employee.html',
  './style.css',
  './employee.css',
  './script.js',
  './employee.js',
  './logokoboi.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Fall back to network
        return response || fetch(event.request);
      })
  );
});
