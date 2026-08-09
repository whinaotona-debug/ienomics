import { state } from './state.js?v=130';

export const rb = (kanji, kana) => `<ruby>${kanji}<rt>${kana}</rt></ruby>`;

/**
 * ユーザーが入力した文字列をHTMLに埋め込む前に無害化する。
 * 子供が入力した仕事名などが親の画面でスクリプトとして動くのを防ぐ。
 */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function applyFuriganaState() {
  if (state.furigana) {
    document.body.classList.add('furigana-on');
  } else {
    document.body.classList.remove('furigana-on');
  }
}

export function requestPushPermission() {
  if (!("Notification" in window)) {
    console.warn("このブラウザはプッシュ通知をサポートしていません。");
    return;
  }
  if (Notification.permission === "default") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") console.log("プッシュ通知の許可が得られました。");
    });
  }
}

export function sendPushNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification(title, { body: body, icon: 'logo.png' });
    } catch (e) {
      console.warn("通知の表示に失敗:", e);
    }
  } else if (Notification.permission === "default") {
    // まだ許可前なら一度聞いてから送る
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        try {
          new Notification(title, { body: body, icon: 'logo.png' });
        } catch (e) {}
      }
    });
  }
}

export function getIcon(name) {
  const icons = {
    'home': `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline>`,
    // ★ チケットアイコンを本物らしく（両端に切り欠きと切り取り線）変更
    'ticket': `<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"></path><path d="M12 5v2"></path><path d="M12 17v2"></path><path d="M12 11v2"></path>`,
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
    'trash': `<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>`,
    'repeat': `<polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path>`,
    'refresh': `<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>`,
    'pay': `<rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line>`,
    'help': `<circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line>`,
    'bell': `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>`
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name] || ''}</svg>`;
}

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

/** 繰り返しタスクから taskTemplates の ID を取り出す */
export function getTemplateIdFromTask(task) {
  if (!task) return null;
  if (task.templateId) return task.templateId;
  if (!task.generatedKey) return null;
  const m = String(task.generatedKey).match(/^rep_(.+)_(\d{4}-\d{1,2}-\d{1,2})$/);
  return m ? m[1] : null;
}

export function formatRepeatLabel(temp) {
  if (!temp) return '定期';
  const weekNames = ['日', '月', '火', '水', '木', '金', '土'];
  if (temp.type === 'weekly') {
    const days = (temp.days || []).slice().sort((a, b) => a - b).map(d => weekNames[d]).join('');
    return `毎週${days || '？'} ${temp.time || ''}`;
  }
  const day = (temp.days && temp.days[0]) || '?';
  return `毎月${day}日 ${temp.time || ''}`;
}

export function formatPaymentSchedule(p) {
  if (!p) return '';
  const weekNames = ['日', '月', '火', '水', '木', '金', '土'];
  if (p.mode === 'once') {
    return `単発 ${p.dueDate || ''}`;
  }
  let sched = '';
  if (p.interval === 'weekly') {
    const days = (p.days || []).slice().sort((a, b) => a - b).map(d => weekNames[d]).join('');
    sched = `毎週${days || '？'}`;
  } else {
    const day = (p.days && p.days[0]) || '?';
    sched = `毎月${day}日`;
  }
  if (p.countMode === 'infinite') return `${sched}・無限`;
  const left = p.remainingCount ?? p.totalCount ?? '?';
  return `${sched}・残り${left}回`;
}

/** 日付キー YYYY-M-D を比較用数値に */
export function dateKeyToValue(key) {
  if (!key) return 0;
  const [y, m, d] = String(key).split('-').map(Number);
  return y * 10000 + m * 100 + d;
}

function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toDateKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 次の自動支払いまでの情報 { title, daysLeft } */
export function getNextPaymentInfo(payments) {
  const active = (payments || []).filter(p => p.status === 'active');
  if (active.length === 0) return null;

  const today = startOfLocalDay();
  const todayStr = toDateKey(today);
  let best = null;

  for (const p of active) {
    const next = calcNextPaymentDate(p, today, todayStr);
    if (!next) continue;
    const daysLeft = Math.max(0, Math.round((startOfLocalDay(next) - today) / 86400000));
    if (!best || daysLeft < best.daysLeft || (daysLeft === best.daysLeft && (p.amount || 0) > (best.amount || 0))) {
      best = { title: p.title || '支払い', daysLeft, amount: p.amount || 0 };
    }
  }
  return best;
}

function calcNextPaymentDate(p, today, todayStr) {
  if (p.mode === 'once') {
    if (!p.dueDate) return null;
    const [y, m, d] = String(p.dueDate).split('-').map(Number);
    const due = new Date(y, m - 1, d);
    if (p.lastChargedKey) return null;
    return due;
  }

  if (p.interval === 'weekly') {
    const days = p.days || [];
    for (let i = 0; i <= 7; i++) {
      const cand = new Date(today);
      cand.setDate(cand.getDate() + i);
      if (!days.includes(cand.getDay())) continue;
      if (i === 0 && p.lastChargedKey === todayStr) continue;
      return cand;
    }
    return null;
  }

  if (p.interval === 'monthly') {
    const day = (p.days && p.days[0]) || 1;
    const build = (y, m) => {
      const last = new Date(y, m + 1, 0).getDate();
      return new Date(y, m, Math.min(day, last));
    };
    let cand = build(today.getFullYear(), today.getMonth());
    if (cand < today || (toDateKey(cand) === todayStr && p.lastChargedKey === todayStr)) {
      cand = build(today.getFullYear(), today.getMonth() + 1);
    }
    return cand;
  }
  return null;
}

/** 今月のスタンプ(1〜30)と連続お手伝い日数 */
export function getHelpStampData(tasks) {
  const approved = (tasks || []).filter(t => t.status === 'approved');
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cardDays = Math.min(30, daysInMonth);

  const workDayKeys = new Set();
  const stamped = new Set();

  for (const t of approved) {
    const ts = t.completedAt || t.approvedAt || t.createdAt;
    if (!ts) continue;
    const d = new Date(ts);
    workDayKeys.add(toDateKey(d));
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (day >= 1 && day <= cardDays) stamped.add(day);
    }
  }

  let streak = 0;
  const cursor = startOfLocalDay(now);
  if (!workDayKeys.has(toDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (workDayKeys.has(toDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { cardDays, stamped, streak, year, month };
}

/** 市場レート（決定論的。range: 'day' | 'week' | 'month'） */
function rateAt(date, market) {
  const day = Math.floor(date.getTime() / 86400000);
  const hour = date.getHours() + date.getMinutes() / 60;
  const t = day + hour / 24;
  if (market === '日本') {
    return Math.max(0.1, 1.0 + Math.sin(t * 0.1) * 0.2 + Math.sin(t * 0.03) * 0.3 + Math.sin(hour * 0.55) * 0.025);
  }
  return Math.max(0.1, 1.0 + Math.cos(t * 0.08) * 0.3 + Math.sin(t * 0.04) * 0.4 + Math.cos(hour * 0.4) * 0.03);
}

export function getMarketRates(range = 'month') {
  const now = new Date();
  const rates = { 日本: [], アメリカ: [], labels: [] };
  let steps = 30;
  let stepMs = 86400000;
  let labelFn = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

  if (range === 'day') {
    steps = 24;
    stepMs = 3600000;
    labelFn = (d) => `${d.getHours()}時`;
  } else if (range === 'week') {
    steps = 7;
    stepMs = 86400000;
    labelFn = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  } else {
    steps = 30;
    stepMs = 86400000;
    labelFn = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  }

  for (let i = steps - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * stepMs);
    rates.labels.push(labelFn(d));
    rates.日本.push(rateAt(d, '日本'));
    rates.アメリカ.push(rateAt(d, 'アメリカ'));
  }
  return rates;
}

/** 売買・評価用の現在レート（表示期間に依存しない） */
export function getCurrentMarketRates() {
  const now = new Date();
  return {
    日本: rateAt(now, '日本'),
    アメリカ: rateAt(now, 'アメリカ')
  };
}