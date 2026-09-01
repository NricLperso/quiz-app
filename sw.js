// Service worker — cache app shell (offline-ready). Le mode "En direct" reste en ligne.
const CACHE = 'quiz-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './questions.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Ne jamais mettre en cache les appels à l'API de quiz (toujours frais)
  if (url.hostname.includes('quizzapi')) return;
  // App shell : cache d'abord, réseau en secours
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});
