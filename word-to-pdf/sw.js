// Service worker: keeps a copy of the app's files so it opens without internet.
// Rule: try the internet first (so you always get the newest version),
// and if there is no internet, use the saved copy.

const CACHE = 'word-to-pdf-v1';
const FILES = [
  './',
  './index.html',
  './manifest.json',
  './jszip.min.js',
  './docx-preview.min.js',
  './icon-192.png',
  './icon-512.png'
];

// 1. When the app is installed: save all the files
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

// 2. When a new version takes over: delete old saved copies
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 3. Every time the app asks for a file
self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only handle our own files (not Google Fonts)
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true })
          .then((saved) => saved || caches.match('./index.html'))
      )
  );
});
