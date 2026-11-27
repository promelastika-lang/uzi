// Работа без интернета: файлы приложения хранятся в кеше телефона.
// При выходе новой версии поменяйте номер ниже — приложение обновится при следующем запуске.
const VERSION = 'uzi-v2.1.0';

const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/exchange.js',
  'js/i18n.js',
  'js/i18n-extra.js',
  'js/media.js',
  'js/models.js',
  'js/ops.js',
  'js/pdf.js',
  'js/router.js',
  'js/ui.js',
  'js/util.js',
  'js/views/calendar.js',
  'js/views/appointment.js',
  'js/views/references.js',
  'js/views/other.js',
  'js/views/patient.js',
  'js/views/media.js',
  'vendor/standalone.module.js',
  'vendor/pdfmake.min.js',
  'vendor/vfs_fonts.js',
  'vendor/qrcode.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Сначала кеш (мгновенный запуск, работает без сети); в фоне подтягиваем свежую версию.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const refresh = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      const fresh = await refresh;
      return fresh || new Response('Нет сети', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })
  );
});
