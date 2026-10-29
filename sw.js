'use strict';

const CACHE_NAME = 'sgml-viewer-cache-v10';
const STAGING_CACHE_PREFIX = 'sgml-viewer-staging-v10-';
const SHARE_CACHE_NAME = 'sgml-viewer-share-v1';
const CONVERTER_CACHE_NAME = 'sgml-viewer-converters-v1';
const CONVERTER_RESOURCES = [
  'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];
const APP_SHELL = [
  './',
  './index.html',
  './Documentation/index.html',
  './style.css',
  './manifest.json',
  './marked.js',
  './tex-chtml.js',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './js/editor-language.js',
  './js/editor.js',
  './js/app-state.js',
  './js/sgml-renderer.js',
  './js/file-converter.js',
  './js/document-library.js',
  './js/default-document.js',
  './js/app.js'
];

function isConverterResourceURL(url) {
  return CONVERTER_RESOURCES.includes(url.href);
}

async function getConverterResource(request) {
  const cache = await caches.open(CONVERTER_CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
      return response;
    }
    const cached = await cache.match(request) || await cache.match(request.url);
    return cached || response;
  } catch (error) {
    const cached = await cache.match(request) || await cache.match(request.url);
    if (cached) return cached;
    throw error;
  }
}

async function cacheConverterLibraries(force = false) {
  const cache = await caches.open(CONVERTER_CACHE_NAME);
  const results = await Promise.allSettled(CONVERTER_RESOURCES.map(async url => {
    if (!force && await cache.match(url)) return { url, cached: true };
    const response = await fetch(new Request(url, { cache: 'reload', mode: 'cors' }));
    if (!response.ok) throw new Error(`HTTP ${response.status} while caching ${url}`);
    await cache.put(new Request(url), response.clone());
    return { url, cached: false };
  }));
  return results.map((item, index) => item.status === 'fulfilled'
    ? item.value
    : { url: CONVERTER_RESOURCES[index], error: String(item.reason?.message || item.reason) });
}

const scopeURL = () => new URL('./', self.registration.scope);
const inScope = url => url.origin === scopeURL().origin && url.pathname.startsWith(scopeURL().pathname);

function isAppShellURL(url) {
  return APP_SHELL.some(path => {
    const item = new URL(path, self.registration.scope);
    return item.origin === url.origin && item.pathname === url.pathname;
  });
}

function canonicalCacheURL(input) {
  const url = new URL(input.url || input.href || input);
  if (isAppShellURL(url)) {
    url.search = '';
    url.hash = '';
  }
  return url.href;
}

async function preservePreviousCache() {
  const target = await caches.open(CACHE_NAME);
  const keys = await caches.keys();
  const previous = keys.filter(name =>
    (name.startsWith('sgml-viewer-offline-v') || name.startsWith('sgml-viewer-cache-v')) &&
    name !== CACHE_NAME
  );
  for (const name of previous) {
    try {
      const oldCache = await caches.open(name);
      for (const request of await oldCache.keys()) {
        if (await target.match(request)) continue;
        const response = await oldCache.match(request);
        if (response) await target.put(request, response.clone());
      }
    } catch (error) {
      console.warn('Could not migrate a previous SGML cache:', name, error);
    }
  }
}

async function cacheOne(url) {
  const target = new URL(url, self.registration.scope);
  const response = await fetch(new Request(target.href, { cache: 'reload' }));
  if (!response.ok && response.type !== 'opaque') {
    throw new Error(`HTTP ${response.status} while refreshing ${target.pathname}`);
  }
  const cache = await caches.open(CACHE_NAME);
  await cache.put(canonicalCacheURL(target), response.clone());
}

async function cacheAppShell() {
  // Stage every app-shell resource first. A partial download must not mix a new
  // index.html with older/missing scripts in the active cache.
  const stagingName = STAGING_CACHE_PREFIX + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const staging = await caches.open(stagingName);
  const results = await Promise.allSettled(APP_SHELL.map(async path => {
    const target = new URL(path, self.registration.scope);
    const response = await fetch(new Request(target.href, { cache: 'reload' }));
    if (!response.ok && response.type !== 'opaque') {
      throw new Error(`HTTP ${response.status} while refreshing ${target.pathname}`);
    }
    await staging.put(canonicalCacheURL(target), response.clone());
  }));
  const failed = results
    .map((item, index) => item.status === 'rejected' ? {
      url: APP_SHELL[index],
      error: String(item.reason?.message || item.reason)
    } : null)
    .filter(Boolean);

  if (failed.length) {
    await caches.delete(stagingName);
    return { ok: false, failed };
  }

  try {
    const targetCache = await caches.open(CACHE_NAME);
    for (const path of APP_SHELL) {
      const targetURL = new URL(path, self.registration.scope);
      const key = canonicalCacheURL(targetURL);
      const response = await staging.match(key);
      if (!response) throw new Error(`Missing staged resource: ${targetURL.pathname}`);
      await targetCache.put(key, response.clone());
    }
    return { ok: true, failed: [] };
  } catch (error) {
    return { ok: false, failed: [{ url: '<cache-commit>', error: String(error?.message || error) }] };
  } finally {
    await caches.delete(stagingName);
  }
}

async function getCachedResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  const exact = await cache.match(request);
  if (exact) return exact;
  const canonical = await cache.match(canonicalCacheURL(request.url));
  if (canonical) return canonical;
  if (request.mode === 'navigate') {
    const root = scopeURL();
    const home = await cache.match(root.href) || await cache.match(new URL('index.html', root).href);
    if (home) return home;
  }
  return null;
}

function getShareActionURL() {
  return new URL('./share/', self.registration.scope);
}
function getShareDataBaseURL() {
  return new URL('./__sgml_shared_file', self.registration.scope);
}
function isShareAction(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && url.pathname === getShareActionURL().pathname;
}
function isShareDataRequest(request) {
  const url = new URL(request.url);
  const base = getShareDataBaseURL();
  return url.origin === base.origin && url.pathname === base.pathname && url.searchParams.has('token');
}

async function storeSharedFile(request) {
  const formData = await request.formData();
  let file = null;
  for (const value of formData.values()) {
    if (typeof File !== 'undefined' && value instanceof File) {
      file = value;
      break;
    }
  }
  if (!file) {
    return Response.redirect(new URL('./?__sgml_share_error=no-file', self.registration.scope).href, 303);
  }
  const token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const dataURL = new URL('./__sgml_shared_file?token=' + encodeURIComponent(token), self.registration.scope);
  const cache = await caches.open(SHARE_CACHE_NAME);
  const safeName = encodeURIComponent(file.name || 'Shared File');
  const rawBytes = await file.arrayBuffer();
  await cache.put(new Request(dataURL.href), new Response(rawBytes, {
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-SGML-File-Name': safeName,
      'Cache-Control': 'no-store'
    }
  }));
  return Response.redirect(new URL('./?__sgml_shared=' + encodeURIComponent(token), self.registration.scope).href, 303);
}

function reply(event, result) {
  if (event.ports && event.ports[0]) event.ports[0].postMessage(result);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Keep the previous working cache until a complete new app shell is ready.
    await preservePreviousCache();
    const result = await cacheAppShell();
    if (!result.ok) {
      throw new Error('App shell refresh was incomplete; keeping the previous Service Worker.');
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.filter(name =>
      (name.startsWith('sgml-viewer-offline-v') || name.startsWith('sgml-viewer-cache-v') || name.startsWith('sgml-viewer-offline-state-v') || name.startsWith(STAGING_CACHE_PREFIX)) && name !== CACHE_NAME
    ).map(name => caches.delete(name)));
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (data.type === 'CACHE_APP_SHELL' || data.type === 'REFRESH_APP_SHELL') {
    event.waitUntil(cacheAppShell().then(result => reply(event, { ok: result.ok, complete: result.ok, failed: result.failed }))
      .catch(error => reply(event, { ok: false, error: String(error?.message || error) })));
    return;
  }
  if (data.type === 'CACHE_CONVERTER_LIBRARIES' || data.type === 'REFRESH_CONVERTER_LIBRARIES') {
    const force = data.type === 'REFRESH_CONVERTER_LIBRARIES';
    event.waitUntil(cacheConverterLibraries(force).then(results => reply(event, {
      ok: results.every(item => !item.error),
      results
    })).catch(error => reply(event, { ok: false, error: String(error?.message || error) })));
    return;
  }
  if (data.type === 'CACHE_URL' && data.url) {
    event.waitUntil((async () => {
      const url = new URL(data.url, self.registration.scope);
      if (!inScope(url)) throw new Error('Only resources in this viewer can be cached.');
      await cacheOne(url.href);
      reply(event, { ok: true });
    })().catch(error => reply(event, { ok: false, error: String(error?.message || error) })));
    return;
  }
  if (data.type === 'DELETE_SHARED_FILE' && data.url) {
    event.waitUntil(caches.open(SHARE_CACHE_NAME)
      .then(cache => cache.delete(new Request(data.url)))
      .then(ok => reply(event, { ok })));
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method === 'POST' && isShareAction(request)) {
    event.respondWith(storeSharedFile(request).catch(error => {
      console.error('Share target handling failed:', error);
      return Response.redirect(new URL('./?__sgml_share_error=failed', self.registration.scope).href, 303);
    }));
    return;
  }

  if (request.method === 'GET' && isShareDataRequest(request)) {
    event.respondWith(caches.open(SHARE_CACHE_NAME).then(async cache => {
      const cached = await cache.match(request);
      return cached || new Response('Shared file not found.', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }));
    return;
  }

  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (isConverterResourceURL(url)) {
    event.respondWith(getConverterResource(request));
    return;
  }
  if (!inScope(url)) return;

  // Network-first: online requests get the newest resource and update the cache.
  // If the network fails, the most recently cached response is used instead.
  event.respondWith((async () => {
    try {
      // A navigation request may not be cloned with a different cache mode.
      // Keep its original request; explicitly revalidate other same-origin resources.
      const freshRequest = request.mode === 'navigate'
        ? request
        : new Request(request, { cache: 'no-cache' });
      const response = await fetch(freshRequest);
      if (response && (response.ok || response.type === 'opaque') && !isAppShellURL(url)) {
        // App-shell files are committed together by cacheAppShell(); cache other
        // same-origin resources individually as they are used.
        const cache = await caches.open(CACHE_NAME);
        await cache.put(canonicalCacheURL(url), response.clone());
      }
      return response;
    } catch (error) {
      const cached = await getCachedResponse(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        return new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SGML Viewer</title><h2>SGML Viewer is not cached yet</h2><p>Open this page once while connected to cache its resources. After that, the viewer can use the cached app when the network is unavailable.</p>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
      throw error;
    }
  })());
});
