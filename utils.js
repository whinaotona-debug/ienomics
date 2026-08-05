import { state } from './state.js';

// --- ふりがな（ルビ）をつける関数 ---
export const rb = (kanji, kana) => `<ruby>${kanji}<rt>${kana}</rt></ruby>`;

export function applyFuriganaState() {
  if (state.furigana) {
    document.body.classList.add('furigana-on');
  } else {
    document.body.classList.remove('furigana-on');
  }
}

// ★ 追加：プッシュ通知の許可を求める関数
export function requestPushPermission() {
  if (!("Notification" in window)) {
    console.warn("このブラウザはプッシュ通知をサポートしていません。");
    return;
  }
  if (Notification.permission !== "denied" && Notification.permission !== "granted") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        console.log("プッシュ通知の許可が得られました。");
      }
    });
  }
}

// ★ 追加：プッシュ通知を送信する関数
export function sendPushNotification(title, body) {
  if (!("Notification" in window)) {
    return;
  }
  if (Notification.permission === "granted") {
    new Notification(title, {
      body: body,
      icon: 'logo.png' // 通知にアプリアイコンを表示
    });
  }
}

// --- アイコンを取得する関数 ---
export function getIcon(name) {
  const icons = {
    'home': `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline>`,
    'ticket': `<path d="M15 5H9a2 2 0 00-2 2v3a2 2 0 010 4v3a2 2 0 010 4v3a2 2 0 002 2h6a2 2 0 002-2v-3a2 2 0 010-4V7a2 2 0 00-2-2z"></path><line x1="9" y1="9" x2="9" y2="15" stroke-dasharray="2 2"></line><line x1="15" y1="9" x2="15" y2="15" stroke-dasharray="2 2"></line>`,
    'settings': `<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>`,
    'history': `<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>`,
    'propose': `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>`,
    'exchange': `<path d="M17 3l4 4-4 4"></path><path d="M3 17l4-4 4 4"></path><path d="M21 7H7a4 4 0 0 0-4 4v1"></path><path d="M3 17h14a4 4 0 0 0 4-4v-1"></path>`,
    'invest': `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>`,
    'bank': `<rect x="3" y="10" width="18" height="10" rx="2" ry="2"></rect><path d="M7 10V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4"></path><path d="M12 14v2"></path>`,
    'task': `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>`,
    'calendar': `<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>`,
    'gift': `<polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5"></rect><line x1="12" y1="22" x2="12" y2="7"></line><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>`,
    'eye': `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`,
    'eye-off': `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`,
    'trash': `<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>`
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`;
}

// --- 日数・時間の計算関数 ---
export function formatTimeLeft(deadlineTime) {
  if (!deadlineTime) return '--';
  const diff = deadlineTime - Date.now();
  if (diff < 0) return '期限切れ';
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days >= 1) return `あと${days}日`;
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours >= 1) return `あと${hours}時間`;
  
  const minutes = Math.floor(diff / (1000 * 60));
  return `あと${minutes}分`;
}

// --- 資産運用の相場（レート）を計算する関数 ---
export function getMarketRates() {
  const today = new Date();
  const rates = { 日本: [], アメリカ: [], labels: [] };
  for (let i = 12; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 15 * 86400000);
    rates.labels.push(`${d.getMonth()+1}/${d.getDate()}`);
    const day = Math.floor(d.getTime() / 86400000);
    rates.日本.push(Math.max(0.1, 1.0 + Math.sin(day * 0.1) * 0.2 + Math.sin(day * 0.03) * 0.3)); 
    rates.アメリカ.push(Math.max(0.1, 1.0 + Math.cos(day * 0.08) * 0.3 + Math.sin(day * 0.04) * 0.4));
  }
  return rates;
}