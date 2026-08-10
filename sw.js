/* Vinyl Hunter OS — Service Worker
 * 缓存应用外壳，支持离线 / PWA 安装。仅缓存静态资源，不缓存任何远程数据。
 */
var CACHE = 'vinyl-hunter-os-v1';
var SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './assets/css/style.css',
  './assets/js/db.js',
  './assets/js/api.js',
  './assets/js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  // 应用外壳走缓存优先；远程 API 走网络优先（且不会被本 SW 预缓存）
  e.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        // 仅缓存同源静态资源
        if (res && res.ok && new URL(req.url).origin === self.location.origin) {
          var clone = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, clone); });
        }
        return res;
      }).catch(function () { return cached; });
    })
  );
});
