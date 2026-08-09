// アプリを閉じている間に通知を受け取るサービスワーカー。
// ブラウザがこのファイルを裏で動かしてくれるので、スマホがスリープ中でも通知が届く。
//
// 注意: onBackgroundMessage は定義しない。
// サーバーから notification 付きで送っているため、FCM が自動で表示してくれる。
// ここで自分でも表示すると、通知が2回出てしまう。

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

firebase.messaging();

// 通知をタップしたら、すでに開いているアプリに戻る。なければ新しく開く。
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification?.data?.FCM_MSG?.webpush?.fcmOptions?.link
    || event.notification?.data?.link
    || '/ienomics/index.html';

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if (client.url.includes('/ienomics/') && 'focus' in client) {
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
