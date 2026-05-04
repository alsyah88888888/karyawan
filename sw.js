const CACHE_NAME = 'koboi-hris-v3'; // Naikkan versi ke v3
const urlsToCache = [
  './',
  './index.html',
  './employee.html',
  './style.css',
  './employee.css',
  './script.js',
  './employee.js',
  './logokoboi.png',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800;900&display=swap',
  'https://unpkg.com/lucide@latest'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    })
  );
});

// STRATEGI: Network First (Coba internet dulu, baru cache)
// Agar setiap ada update IP di script.js, HP langsung tahu.
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
