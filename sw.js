const CACHE_NAME = "sgml-viewer-offline";
const CORE_ASSETS = ["./", "./index.html", "./marked.js"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CACHE_URL") {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then(cache => cache.addAll([...CORE_ASSETS, event.data.url]))
        .then(() => event.ports?.[0]?.postMessage({ ok: true }))
        .catch(error => event.ports?.[0]?.postMessage({ ok: false, error: String(error) }))
    );
  }
  if (event.data?.type === "DISABLE_OFFLINE") {
    event.waitUntil(
      caches.delete(CACHE_NAME)
        .then(() => event.ports?.[0]?.postMessage({ ok: true }))
        .catch(error => event.ports?.[0]?.postMessage({ ok: false, error: String(error) }))
    );
  }
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
