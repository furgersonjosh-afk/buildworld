/* BUILD WORLD service worker — makes the app installable and work offline.
   Bump CACHE when you change the cached library assets. */
const CACHE = "buildworld-v5";
const ASSETS = [
  "./", "./index.html", "./manifest.json",
  "./lib/three.min.js", "./lib/RoundedBoxGeometry.js", "./lib/OrbitControls.js",
  "./lib/RoomEnvironment.js", "./lib/RGBELoader.js", "./lib/studio.hdr",
  "./lib/GLTFLoader.js", "./lib/peerjs.min.js",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const isDoc = e.request.mode === "navigate" ||
                url.pathname.endsWith("/") || url.pathname.endsWith("index.html");

  if (isDoc) {
    // network-first for the page, so updates show when online; cache when offline
    e.respondWith(
      fetch(e.request)
        .then((resp) => { const copy = resp.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return resp; })
        .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
    );
  } else {
    // cache-first for static assets (fast + offline)
    e.respondWith(
      caches.match(e.request).then((r) =>
        r || fetch(e.request).then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => { try { c.put(e.request, copy); } catch (_) {} });
          return resp;
        })
      )
    );
  }
});
