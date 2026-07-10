/**
 * sw.js
 * Service Worker بسيط: يخزّن "هيكل التطبيق" (App Shell) مؤقتًا ليعمل التطبيق
 * دون اتصال بالإنترنت (طلبات الـAPI نحو الراوتر نفسها لا تُخزَّن أبدًا، فهي
 * بيانات حيّة يجب أن تكون طازجة دومًا).
 */

const CACHE_NAME = 'hlk-dashboard-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './api.js',
  './auth.js',
  './dashboard.js',
  './network.js',
  './wifi.js',
  './devices.js',
  './sms.js',
  './notifications.js',
  './charts.js',
  './settings.js',
  './i18n.js',
  './storage.js',
  './qrcode-lib.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // لا نتدخل إطلاقًا في طلبات API الخاصة بالراوتر — يجب أن تصل الشبكة دومًا
  if (url.pathname.startsWith('/api/')) return;
  // لا نتدخل في الطلبات لأصل مختلف (مثل خطوط Google Fonts) — تمر كما هي
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => cached);
    })
  );
});
