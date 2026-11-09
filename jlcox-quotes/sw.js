// J.L. Cox Cranes Quotation Maker – service worker
// Keeps a copy of the app on the phone so it still opens with no signal.
// Strategy: "network first" – when online it always fetches the latest version
// (so updates show up straight away); when offline it uses the saved copy.

const PREFIX = 'jlcox-quotes-';
const CACHE = PREFIX + 'v2';   // change the number when you want to force a fresh copy
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

// New version: delete this app's old saved copies.
// Only names starting with PREFIX are touched, because other apps on the same
// website (like RW Quotes) keep their saved copies in the same place.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Every request: try the internet first, fall back to the saved copy.
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Saved quotes always come straight from the server – never from a saved copy.
  if (url.pathname.includes('/api/')) return;

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
