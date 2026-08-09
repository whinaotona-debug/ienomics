// イエノミクスのサービスワーカー。
// 電波が弱い場所でもアプリが開けるように、画面を作るファイルを手元に置いておく。
// Firestore への読み書きはキャッシュせず、必ずネットワークに任せる。

const VERSION = 'v129';
const SHELL_CACHE = `ienomics-shell-${VERSION}`;
const RUNTIME_CACHE = `ienomics-runtime-${VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './ui.js',
  './state.js',
  './utils.js',
  './dialog.js',
  './tutorial.js',
  './push.js',
  './firebase.js',
  './manifest.json',
  './logo.png'
];

// キャッシュしてはいけない相手（毎回サーバーに聞く必要がある）
const NEVER_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // 1つでも失敗すると全部入らないので、個別に入れる
      .then(cache => Promise.allSettled(SHELL_ASSETS.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (!/^https?:$/.test(url.protocol)) return;
  if (NEVER_CACHE_HOSTS.some(host => url.hostname.endsWith(host))) return;
  // 通知用サービスワーカーは常に最新を取りに行かせる
  if (url.pathname.endsWith('/firebase-messaging-sw.js')) return;

  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // 自分のファイルは「まずネットワーク、だめならキャッシュ」。
    // ?v= を上げたときに必ず新しい版が届くようにするため。
    event.respondWith(networkFirst(req));
  } else {
    // CDN やフォントは「まずキャッシュ、裏で更新」。表示が速くなる。
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request) || await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // 画面遷移なら、少なくともトップページを返してアプリを開けるようにする
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(response => {
      if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || network || Response.error();
}
