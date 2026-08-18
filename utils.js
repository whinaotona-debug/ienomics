import { state } from './state.js?v=155';

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

/** 仕事名＋任意の読み方。フリガナONのときだけルビが出る */
export function jobTitleHtml(title, kana) {
  const t = esc(title || '無題');
  const k = String(kana || '').trim();
  if (!k) return t;
  return `<span class="ie-job-ruby"><span class="ie-job-ruby-reading">${esc(k)}</span><span class="ie-job-ruby-base">${t}</span></span>`;
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
    'bell': `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>`,
    'childAdd': `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line>`
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
  const days = (temp.days || []).map(d => Number(d)).filter(d => Number.isFinite(d));
  if (temp.type === 'weekly') {
    const label = days.slice().sort((a, b) => a - b).map(d => weekNames[d] || '?').join('');
    return `毎週${label || '？'} ${temp.time || ''}`;
  }
  const day = days[0] ?? '?';
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

const JST = 'Asia/Tokyo';
const WEEKDAY_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 日本時間の壁時計。サーバー（UTC）でもスマホでも同じ「今日」になる。
 * weekday は日曜=0（テンプレの曜日指定と同じ）。
 */
export function japanParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: JST,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
    hourCycle: 'h23'
  }).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_EN[get('weekday')] ?? 0
  };
}

export function japanTodayKey(date = new Date()) {
  const j = japanParts(date);
  return `${j.year}-${j.month}-${j.day}`;
}

export function japanDayStartMs(date = new Date()) {
  const j = japanParts(date);
  return new Date(`${j.year}-${pad2(j.month)}-${pad2(j.day)}T00:00:00+09:00`).getTime();
}

export function japanDeadlineMs(hours, minutes, date = new Date()) {
  const j = japanParts(date);
  const h = Number.isFinite(hours) ? hours : 19;
  const m = Number.isFinite(minutes) ? minutes : 0;
  return new Date(`${j.year}-${pad2(j.month)}-${pad2(j.day)}T${pad2(h)}:${pad2(m)}:00+09:00`).getTime();
}

export function msUntilJapanMidnight(date = new Date()) {
  const next = japanDayStartMs(date) + 24 * 60 * 60 * 1000 + 80;
  return Math.max(200, next - date.getTime());
}

export function formatJapanClock(date = new Date()) {
  const j = japanParts(date);
  const week = ['日', '月', '火', '水', '木', '金', '土'][j.weekday];
  return `${j.month}/${j.day}(${week}) ${pad2(j.hour)}:${pad2(j.minute)}`;
}

function japanShiftDays(j, n) {
  const noon = new Date(`${j.year}-${pad2(j.month)}-${pad2(j.day)}T12:00:00+09:00`).getTime();
  return japanParts(new Date(noon + n * 86400000));
}

function startOfLocalDay(d = new Date()) {
  return new Date(japanDayStartMs(d));
}

function toDateKey(d) {
  return japanTodayKey(d);
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
    const days = (p.days || []).map(Number);
    const todayJ = japanParts(today);
    for (let i = 0; i <= 7; i++) {
      const candJ = japanShiftDays(todayJ, i);
      if (!days.includes(candJ.weekday)) continue;
      const candStr = `${candJ.year}-${candJ.month}-${candJ.day}`;
      if (i === 0 && p.lastChargedKey === todayStr) continue;
      return new Date(`${candJ.year}-${pad2(candJ.month)}-${pad2(candJ.day)}T00:00:00+09:00`);
    }
    return null;
  }

  if (p.interval === 'monthly') {
    const day = Number((p.days && p.days[0]) || 1);
    const todayJ = japanParts(today);
    const build = (y, m) => {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const d = Math.min(day, last);
      return new Date(`${y}-${pad2(m)}-${pad2(d)}T00:00:00+09:00`);
    };
    let cand = build(todayJ.year, todayJ.month);
    const candKey = japanTodayKey(cand);
    if (cand.getTime() < today.getTime() || (candKey === todayStr && p.lastChargedKey === todayStr)) {
      const next = japanShiftDays({ ...todayJ, day: 1 }, 32);
      cand = build(next.year, next.month);
    }
    return cand;
  }
  return null;
}

/** 今月のスタンプ(1〜30)と連続お手伝い日数 */
export function getHelpStampData(tasks) {
  const approved = (tasks || []).filter(t => t.status === 'approved');
  const nowJ = japanParts();
  const year = nowJ.year;
  const month = nowJ.month - 1;
  const daysInMonth = new Date(Date.UTC(nowJ.year, nowJ.month, 0)).getUTCDate();
  const cardDays = Math.min(30, daysInMonth);

  const workDayKeys = new Set();
  const stamped = new Set();

  for (const t of approved) {
    const ts = t.completedAt || t.approvedAt || t.createdAt;
    if (!ts) continue;
    const j = japanParts(new Date(ts));
    workDayKeys.add(`${j.year}-${j.month}-${j.day}`);
    if (j.year === nowJ.year && j.month === nowJ.month) {
      if (j.day >= 1 && j.day <= cardDays) stamped.add(j.day);
    }
  }

  let streak = 0;
  let cursor = { ...nowJ };
  if (!workDayKeys.has(`${cursor.year}-${cursor.month}-${cursor.day}`)) {
    cursor = japanShiftDays(cursor, -1);
  }
  while (workDayKeys.has(`${cursor.year}-${cursor.month}-${cursor.day}`)) {
    streak++;
    cursor = japanShiftDays(cursor, -1);
  }

  return { cardDays, stamped, streak, year, month };
}

/**
 * 承認済み仕事を日本時間の日付ごとにまとめる（新しい日が先）。
 * @returns {{ key, year, month, day, weekday, total, items }[]}
 */
export function groupApprovedEarningsByDay(tasks) {
  const map = new Map();
  for (const t of tasks || []) {
    if (t.status !== 'approved') continue;
    const ts = t.approvedAt || t.completedAt || t.createdAt;
    if (!ts) continue;
    const j = japanParts(new Date(ts));
    const key = `${j.year}-${pad2(j.month)}-${pad2(j.day)}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        year: j.year,
        month: j.month,
        day: j.day,
        weekday: j.weekday,
        total: 0,
        items: []
      });
    }
    const g = map.get(key);
    const pts = Number(t.points) || 0;
    g.total += pts;
    g.items.push(t);
  }
  for (const g of map.values()) {
    g.items.sort((a, b) => (b.approvedAt || b.completedAt || b.createdAt || 0) - (a.approvedAt || a.completedAt || a.createdAt || 0));
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

/** 市場レート（決定論的。range: 'day' | 'week' | 'month'） */
export const MARKET_ORDER = ['日本', 'アメリカ', '原油', '金'];

export const MARKET_META = {
  日本: { id: 'japan', label: '🇯🇵 日本株', short: '日本', buyLabel: '日本株を買う', color: '#334155', dash: [] },
  アメリカ: { id: 'us', label: '🇺🇸 米国株', short: '米国', buyLabel: '米国株を買う', color: '#94a3b8', dash: [4, 4] },
  原油: { id: 'oil', label: '原油', short: '原油', buyLabel: '原油を買う', color: '#b45309', dash: [2, 2] },
  金: { id: 'gold', label: '金', short: '金', buyLabel: '金を買う', color: '#ca8a04', dash: [6, 3] }
};

export function marketNameFromId(id) {
  const hit = Object.entries(MARKET_META).find(([, m]) => m.id === id);
  return hit ? hit[0] : null;
}

/* ===== スプレッドシートの相場 =====
   Googleスプレッドシートを「ウェブに公開」した表を読んで、実際の値動きだけを使う。
   つながっていないあいだは倍率1.0（動かない）にし、疑似の上下は使わない。 */

// 列の見出しは家庭ごとに書き方が違うので、それらしい言葉で拾う
const SHEET_COLUMN_ALIASES = {
  日本: ['日本', '日本株', '日経', '日経平均', 'nikkei', 'japan', 'jp'],
  アメリカ: ['アメリカ', '米国', '米国株', 'sp500', 's&p500', 's&p', 'nasdaq', 'dow', 'us', 'usa'],
  原油: ['原油', 'オイル', 'oil', 'wti', 'crude', 'brent'],
  金: ['金', 'ゴールド', 'gold', 'xau']
};
const SHEET_DATE_ALIASES = ['日付', '日時', '年月日', 'date', 'day', 'datetime'];

/** 表のURLを、そのまま読めるCSVのURLに直す */
export function normalizeSheetUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.includes('output=csv') || raw.includes('/gviz/tq')) return raw;

  // 「ウェブに公開」した /pub 形式
  if (raw.includes('/spreadsheets/d/e/')) {
    const [base, queryText = ''] = raw.split('?');
    const query = new URLSearchParams(queryText);
    query.set('single', 'true');
    query.set('output', 'csv');
    const path = `${base.replace(/\/(pubhtml|pub|edit|view)?\/*$/, '')}/pub`;
    return `${path}?${query.toString()}`;
  }

  // 通常の共有URL
  const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (idMatch) {
    const gidMatch = raw.match(/[#?&]gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : '0';
    return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
  }
  return raw;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
}

function matchColumn(header, aliases) {
  const h = String(header || '').trim().toLowerCase();
  if (!h) return false;
  if (aliases.some(a => h === a)) return true;
  return aliases.some(a => a.length >= 2 && h.includes(a));
}

function parseSheetNumber(value) {
  const cleaned = String(value ?? '').replace(/[,¥$￥\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseSheetDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  // Google の Date(2026,7,17) 形式
  const gviz = raw.match(/^Date\((\d+),(\d+),(\d+)/);
  if (gviz) {
    return Date.UTC(Number(gviz[1]), Number(gviz[2]), Number(gviz[3]), 3) ;
  }
  const ymd = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (ymd) {
    return Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 3);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 日付重複があれば後ろ（新しい取得結果）を優先して整列 */
function normalizePricePoints(points) {
  const map = new Map();
  for (const p of points) {
    if (!Number.isFinite(p.ms) || !Number.isFinite(p.price) || p.price <= 0) continue;
    map.set(p.ms, p.price);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, price]) => ({ ms, price }));
}

/**
 * CSVの本文から、市場ごとの値動きを取り出す。
 * 倍率は使わず、実際の価格をそのまま rate に入れる。
 * （以前の倍率基準ズレで、日をまたぐと数倍に見える不具合が出ていた）
 */
export function parseMarketSheetCsv(text) {
  const rows = parseCsv(String(text || ''));
  if (rows.length < 2) throw new Error('表のデータが足りません');

  const header = rows[0];
  const dateIndex = header.findIndex(h => matchColumn(h, SHEET_DATE_ALIASES));
  const columns = {};
  for (const [name, aliases] of Object.entries(SHEET_COLUMN_ALIASES)) {
    const index = header.findIndex((h, i) => i !== dateIndex && matchColumn(h, aliases));
    if (index >= 0) columns[name] = index;
  }
  if (!Object.keys(columns).length) {
    throw new Error('日本・アメリカ・原油・金 の列が見つかりません');
  }

  const series = {};
  for (const [name, index] of Object.entries(columns)) {
    const points = [];
    for (let r = 1; r < rows.length; r++) {
      const price = parseSheetNumber(rows[r][index]);
      if (price == null) continue;
      const ms = dateIndex >= 0 ? parseSheetDate(rows[r][dateIndex]) : r;
      points.push({ ms: ms ?? r, price });
    }
    const cleaned = normalizePricePoints(points);
    if (cleaned.length < 2) continue;
    series[name] = cleaned.map(p => ({ ms: p.ms, rate: p.price, price: p.price }));
  }
  if (!Object.keys(series).length) throw new Error('数字の入った行が見つかりません');
  return series;
}

let sheetSeries = null;

export function setMarketSheetSeries(series) {
  sheetSeries = series && Object.keys(series).length ? series : null;
}

export function getMarketSheetMarkets() {
  return sheetSeries ? Object.keys(sheetSeries) : [];
}

/** 表の最終日と、今日から何日遅れているか */
export function getMarketSheetInfo(now = new Date()) {
  if (!sheetSeries) return null;
  let lastMs = null;
  for (const pts of Object.values(sheetSeries)) {
    if (!pts?.length) continue;
    const ms = pts[pts.length - 1].ms;
    if (lastMs == null || ms > lastMs) lastMs = ms;
  }
  if (lastMs == null) return null;
  const last = japanParts(new Date(lastMs));
  const today = japanParts(now);
  const staleDays = Math.round(
    (Date.UTC(today.year, today.month - 1, today.day) -
      Date.UTC(last.year, last.month - 1, last.day)) / 86400000
  );
  return {
    lastMs,
    lastLabel: `${last.year}/${last.month}/${last.day}`,
    staleDays,
    isStale: staleDays > 4
  };
}

function sheetRateAt(name, ms) {
  const points = sheetSeries?.[name];
  if (!points || !points.length) return null;
  let value = points[0].rate;
  for (const p of points) {
    if (p.ms > ms) break;
    value = p.rate;
  }
  return value;
}

function sheetLatestRate(name) {
  const points = sheetSeries?.[name];
  return points && points.length ? points[points.length - 1].rate : null;
}

export function rateForMarket(rates, name) {
  const r = rates && rates[name];
  return Number.isFinite(r) && r > 0 ? r : 1;
}

/** 買ったときの価格。古い持ち株は購入日の表から復元する。
 * 正解: 今の価値 = 入れたpt × (今の価格 / 買った価格)。売る額は画面の今の価値。 */
export function getBuyRate(inv, currentRate) {
  const stored = Number(inv?.buyRate);
  if (stored > 0) return stored;

  const invested = Number(inv?.investedPoints) || 0;
  const shares = Number(inv?.shares);
  const implied = invested > 0 && shares > 0 ? invested / shares : null;
  const cur = Number(currentRate);
  if (implied > 0 && cur > 0 && implied >= cur / 8 && implied <= cur * 8) return implied;

  const hist = Number(inv?.createdAt) > 0 ? sheetRateAt(inv.name, inv.createdAt) : null;
  if (hist > 0) return hist;
  return cur > 0 ? cur : 1;
}

/** 口数。今の価値は getHoldingShares(inv, rate) * rate */
export function getHoldingShares(inv, rate) {
  const invested = Number(inv.investedPoints) || 0;
  const buy = getBuyRate(inv, rate);
  return invested > 0 && buy > 0 ? invested / buy : 0;
}

export function getHoldingValue(inv, rate) {
  return getHoldingShares(inv, rate) * (Number(rate) || 0);
}

/** 株全体の現在価値。stockCap を超えた値上がり分は反映しない。 */
export function getInvestmentPortfolioValue(investments, rates, stockCap) {
  const raw = (investments || []).reduce((sum, inv) => {
    const rate = rateForMarket(rates, inv.name);
    return sum + getHoldingShares(inv, rate) * rate;
  }, 0);
  const cap = Number(stockCap);
  return Math.round(Number.isFinite(cap) && cap > 0 ? Math.min(raw, cap) : raw);
}

/** 株上限を各保有銘柄へ現在価値の比率で配分した売却価値。 */
export function getInvestmentValues(investments, rates, stockCap) {
  const rows = (investments || []).map(inv => {
    const rate = rateForMarket(rates, inv.name);
    return { id: inv.id, raw: getHoldingShares(inv, rate) * rate };
  });
  const rawTotal = rows.reduce((sum, row) => sum + row.raw, 0);
  const cap = Number(stockCap);
  const scale = Number.isFinite(cap) && cap > 0 && rawTotal > cap ? cap / rawTotal : 1;
  return Object.fromEntries(rows.map(row => [row.id, Math.round(row.raw * scale)]));
}

export function getMarketRates(range = 'month') {
  const now = new Date();
  const rates = { labels: [], ms: [] };
  for (const name of MARKET_ORDER) rates[name] = [];
  let steps = 30;

  if (range === 'day') steps = 5;
  else if (range === 'week') steps = 7;
  else steps = 22;

  const reference = MARKET_ORDER
    .map(name => sheetSeries?.[name])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0];

  if (reference) {
    const points = reference.slice(-steps);
    for (const p of points) {
      const j = japanParts(new Date(p.ms));
      rates.labels.push(`${j.month}/${j.day}`);
      rates.ms.push(p.ms);
      for (const name of MARKET_ORDER) {
        const fallback = sheetLatestRate(name) ?? 1;
        rates[name].push(sheetRateAt(name, p.ms) ?? fallback);
      }
    }
    return rates;
  }

  for (let i = steps - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const j = japanParts(d);
    rates.labels.push(`${j.month}/${j.day}`);
    rates.ms.push(japanDayStartMs(d));
    for (const name of MARKET_ORDER) rates[name].push(sheetLatestRate(name) ?? 1);
  }
  return rates;
}

/**
 * その日までに入れたptと、その日の終値で持っていたpt。
 * 最終点の「持っていた」は、カード／売却額と同じ計算（上限があれば切る）。
 */
export function getPortfolioHistory(investments, range = 'week', stockCap) {
  const rates = getMarketRates(range);
  const cap = Number(stockCap);
  const useCap = Number.isFinite(cap) && cap > 0;
  const putIn = [];
  const held = [];

  for (let i = 0; i < rates.labels.length; i++) {
    const ms = rates.ms[i];
    const owned = (investments || []).filter(inv => {
      const created = Number(inv.createdAt) || 0;
      if (!created) return true;
      return japanDayStartMs(new Date(created)) <= japanDayStartMs(new Date(ms));
    });
    const dayRates = {};
    for (const name of MARKET_ORDER) dayRates[name] = sheetRateAt(name, ms) ?? 1;
    putIn.push(owned.reduce((sum, inv) => sum + (Number(inv.investedPoints) || 0), 0));
    held.push(getInvestmentPortfolioValue(owned, dayRates, useCap ? cap : null));
  }
  return { labels: rates.labels, putIn, held };
}

/** 売買・評価用の現在レート（表示期間に依存しない）。表の実データだけ。 */
export function getCurrentMarketRates() {
  const out = {};
  for (const name of MARKET_ORDER) out[name] = sheetLatestRate(name) ?? 1;
  return out;
}

/** いま表から相場が取れる市場だけ */
export function getTradeableMarkets() {
  return getMarketSheetMarkets().filter(name => MARKET_ORDER.includes(name));
}