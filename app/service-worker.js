// Service worker of the built app. pwa.ts puts VERSION and FILES (every
// built file, relative to this script) in front of it.
//
// It keeps a copy of all the files and answers from that copy first, so the
// app starts without a network. A new version downloads in the background and
// takes over when the page asks for it (the user chose to reload) or once no
// page uses the old one, never in the middle of playing.
/* global VERSION, FILES */
const CACHE = `spiderv-${VERSION}`;
const scope = new URL('./', self.location.href);
const urls = new Set(FILES.map((f) => new URL(f, scope).href));
const INDEX = new URL('index.html', scope).href;

self.addEventListener('install', (e) => {
  // 'reload' skips the HTTP cache, which may still hold the previous version.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...urls].map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('spiderv-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  url.search = '';
  url.hash = '';
  // Any page of the app (e.g. ?demo or ?remote=CODE) is index.html.
  const key = req.mode === 'navigate' && url.href.startsWith(scope.href) ? INDEX : url.href;
  // Everything else (the relay, the AI providers) goes to the network as usual.
  if (!urls.has(key)) return;
  e.respondWith(caches.open(CACHE).then((c) => c.match(key)).then((r) => r ?? fetch(req)));
});
