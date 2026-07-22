/* 月月 Service Worker — 離線支援
 * 策略:
 *   - app 本體(HTML/icon):network-first,有網路時抓最新、沒網路時用快取
 *   - Firebase SDK(CDN):cache-first,版本固定不會變,直接用快取最快
 *   - 其他(Firestore API 等):不攔截,交給 Firestore 自己的離線機制處理
 */
var CACHE = 'tsukitsuki-v1';
var SHELL = [
  './',
  './index.html',
  './icon.png',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 個別加入,單一資源失敗不會讓整個安裝失敗 */
      return Promise.all(
        SHELL.map(function (url) {
          return c.add(url)['catch'](function () {});
        })
      );
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== CACHE) { return caches['delete'](k); }
        })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') { return; }

  var url = req.url;

  /* Firestore / Auth 的 API 呼叫不攔截,讓 SDK 自己處理離線 */
  if (url.indexOf('firestore.googleapis.com') !== -1 ||
      url.indexOf('identitytoolkit.googleapis.com') !== -1 ||
      url.indexOf('googleapis.com/google.firestore') !== -1) {
    return;
  }

  /* Firebase SDK:cache-first */
  if (url.indexOf('gstatic.com/firebasejs') !== -1) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
    return;
  }

  /* app 本體:network-first,失敗回退快取 */
  if (req.mode === 'navigate' || url.indexOf(self.location.origin) === 0) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      })['catch'](function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
  }
});
