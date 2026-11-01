// RW Belting Quotation Maker – service worker
// Keeps a copy of the app on the phone so it still opens with no signal.
// Strategy: "network first" – when online it always fetches the latest version
// (so updates show up straight away); when offline it uses the saved copy.

const CACHE = 'rw-quotes-v2';   // change the number when you want to force a fresh copy
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './jspdf.umd.min.js',
  './jspdf.plugin.autotable.min.js'
];

// First visit: save the app files.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

// New version: delete old saved copies.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Every request: try the internet first, fall back to the saved copy.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then(saved => saved || caches.match('./index.html'))
      )
  );
});
