// イエノミクスのサービスワーカー。
// 電波が弱い場所でもアプリが開けるように、画面を作るファイルを手元に置いておく。
// Firestore への読み書きはキャッシュせず、必ずネットワークに任せる。
//
// 通知の受け取りもここで行う。以前は通知専用のサービスワーカーを別スコープに
// 登録していたが、その方式ではアプリを完全に終了させたときに通知が届かなかった。
// 画面を受け持っているサービスワーカー自身が受け取るようにすると確実になる。

// 通知の受け取りに必要な部品。オフラインで起動したときは読み込めないので、
// 失敗してもキャッシュ配信だけは動き続けるように囲っておく。
try {
  importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: "AIzaSyA57yXg46NjGVue3WUK-jbZ68hwQwdLA-g",
    authDomain: "tibiz-a395e.firebaseapp.com",
    projectId: "tibiz-a395e",
    storageBucket: "tibiz-a395e.firebasestorage.app",
    messagingSenderId: "347209039114",
    appId: "1:347209039114:web:0d3ff0477e7bb812210ef3"
  });
  // これを呼ぶことで、届いた通知が自動で表示されるようになる。
  // notification 付きで送っているので、自分で表示する処理は書かない（二重表示になる）。
  firebase.messaging();
} catch (e) {
  // 通知だけ使えない状態。オフライン対応はこのまま続く。
}

// 通知をタップしたら、開いているアプリに戻る。なければ新しく開く。
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification?.data?.FCM_MSG?.webpush?.fcmOptions?.link
    || event.notification?.data?.link
    || './index.html';

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        return client.focus();
      }
    }
    return self.clients.openWindow(link);
  })());
});

const VERSION = 'v134';
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
