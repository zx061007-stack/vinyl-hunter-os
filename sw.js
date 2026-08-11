/* Vinyl Hunter OS — Service Worker
 * 缓存应用外壳，支持离线 / PWA 安装。仅缓存静态资源，不缓存任何远程数据。
 *
 * 更新策略：network-first（网络优先，离线时回退缓存）。
 * 这样每次部署/本地改动后，刷新一次即可拿到最新文件，不会卡在旧缓存。
 */
var CACHE = 'vinyl-hunter-os-v11';
var SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './assets/css/style.css?v=11',
  './assets/js/db.js?v=11',
  './assets/js/api.js?v=11',
  './assets/js/app.js?v=11'
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
  var url = new URL(req.url);
  // 远程 API（汇率 / Discogs / MusicBrainz 等）一律走网络，绝不缓存
  if (url.origin !== self.location.origin) return;
  // 同源静态资源：网络优先，成功则顺手刷新缓存；失败才回退旧缓存（离线可用）
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var clone = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, clone); });
      }
      return res;
    }).catch(function () {
      return caches.match(req);
    })
  );
});
