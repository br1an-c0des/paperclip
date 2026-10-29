// Paperclip's service worker for ui-new, ported from ui/public/sw.js (decision 39, D11).
//
// - Network first, always. Only hashed build assets (/assets/<name>-<hash>.<ext>) are cached, so a
//   page that's already loaded keeps working when the network drops; nothing under /api, and no
//   response marked no-store or private, is ever cached or served from the cache.
// - A page opened while offline gets a static "Paperclip is offline" page (never cached content).
// - The production build stamps BUILD_ID (vite.config.ts), so every deploy changes this file: the
//   browser installs the new worker, which takes over at once (skipWaiting, clients.claim), drops
//   the old caches, and parked tabs reload onto the new build (src/shell/service-worker-updates.ts).
//   That's also how it replaces the old UI's worker in a browser that had one.
// - Unstamped (Vite's dev server), it handles nothing, so development is never intercepted.
const BUILD_ID = "__PAPERCLIP_BUILD_ID__";
const CACHE_NAME = `paperclip-ui-new-assets-${BUILD_ID}`;
const privateRequests = new Set();
const privateCacheControl = /(?:^|,)\s*(?:no-store|private)(?:\s*(?:,|=)|\s*$)/i;
const hashedAsset = /^\/assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9.]+$/;

// Capsule Stack, written out: the offline page can't load the app's stylesheet or fonts.
const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0a0a0a">
<title>Paperclip is offline</title>
<style>
:root { --ground: #0a0a0a; --card: #141414; --edge: #1f1f1f; --text: #f4f1ea; --body: #c9c6bf; --muted: #8f8c86; --primary: #f4f1ea; --on-primary: #0a0a0a;
  --shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 16px 34px -18px rgba(0,0,0,.95); color-scheme: dark; }
@media (prefers-color-scheme: light) {
  :root { --ground: #f2f2f4; --card: #ffffff; --edge: transparent; --text: #111113; --body: #45454d; --muted: #6b6b75; --primary: #111113; --on-primary: #ffffff;
    --shadow: 0 1px 2px rgba(17,17,19,.06), 0 10px 28px -14px rgba(17,17,19,.2); color-scheme: light; }
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { min-height: 100dvh; display: grid; place-items: center; padding: max(24px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
  background: var(--ground); color: var(--text); font: 15px/1.55 'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
main { width: min(440px, 100%); padding: 26px 26px 24px; display: flex; flex-direction: column; gap: 14px;
  background: var(--card); border: 1px solid var(--edge); border-radius: 18px; box-shadow: var(--shadow); }
.stack { display: flex; gap: 5px; align-items: flex-end; height: 28px; }
.stack i { display: block; width: 8px; border-radius: 999px; }
.stack i:nth-child(1) { height: 20px; background: linear-gradient(180deg, #8b2cf0, #1f6fe0); }
.stack i:nth-child(2) { height: 28px; background: linear-gradient(180deg, #f7b52f, #f5822a); }
.stack i:nth-child(3) { height: 14px; background: linear-gradient(180deg, #2fd12f, #22b5a5); }
h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -.045em; line-height: 1.05; }
p { margin: 0; color: var(--body); }
small { color: var(--muted); font-size: 12px; }
button { align-self: flex-start; height: 36px; padding: 0 16px; border: 0; border-radius: 999px; background: var(--primary); color: var(--on-primary);
  font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
button:focus-visible { outline: 2px solid #8b2cf0; outline-offset: 2px; }
</style>
</head>
<body>
<main aria-labelledby="offline-title">
<div class="stack" aria-hidden="true"><i></i><i></i><i></i></div>
<h1 id="offline-title">Paperclip is offline</h1>
<p>This device can't reach the Paperclip server. Check your connection, then reload to try again.</p>
<small>Your agents keep working on the server while you're away.</small>
<button type="button" onclick="window.location.reload()">Reload page</button>
</main>
</body>
</html>`;

function offlineNavigationResponse() {
  return new Response(OFFLINE_PAGE, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function evictRequest(request) {
  await Promise.all(
    (await caches.keys()).map(async (key) => {
      const cache = await caches.open(key);
      await cache.delete(request, { ignoreVary: true });
    }),
  );
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

// A new worker starts from nothing: every cache an earlier worker (this UI's or the old UI's) left
// is dropped, and the hashed assets of the build in use fill the new one as they're fetched.
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (BUILD_ID.startsWith("__")) return;
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;
  // Plugin bundles and the server's other non-app routes have no offline contract either.
  if (url.pathname.startsWith("/_plugins/")) return;
  if (request.cache === "no-store") {
    privateRequests.add(request.url);
    event.waitUntil(evictRequest(request).catch(() => {}));
    return;
  }
  const publicAsset = !url.search && hashedAsset.test(url.pathname);
  // Only page loads (for the offline page) and hashed assets (for the cache) go through the worker.
  if (!publicAsset && request.mode !== "navigate") return;

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        const cacheControl = response.headers.get("cache-control") ?? "";
        if (privateCacheControl.test(cacheControl)) {
          privateRequests.add(request.url);
          await evictRequest(request).catch(() => {});
        } else if (response.ok && publicAsset && !privateRequests.has(request.url)) {
          const copy = response.clone();
          await caches
            .open(CACHE_NAME)
            .then(async (cache) => {
              await cache.put(request, copy);
              if (privateRequests.has(request.url)) await cache.delete(request, { ignoreVary: true });
            })
            .catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        if (privateRequests.has(request.url)) return Response.error();
        if (!publicAsset) return offlineNavigationResponse();
        try {
          const cached = await (await caches.open(CACHE_NAME)).match(request);
          if (cached && !privateCacheControl.test(cached.headers.get("cache-control") ?? "")) return cached;
        } catch {
          // No cache storage: an offline miss.
        }
        return Response.error();
      }),
  );
});
