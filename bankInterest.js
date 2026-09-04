/**
 * 家庭内銀行の利息エンジン（純関数・Firestore 非依存）。
 * Functions 側は functions/bankInterest.js に同内容を置くこと。
 *
 * 日利 = amount × BANK_MONTHLY_RATE ÷ 30（分母固定）
 * 当月分は accruedInterest、前月分は翌月以降の処理で amount へ入金。
 */

export const BANK_MONTHLY_RATE = 0.005;
export const BANK_DAILY_DIVISOR = 30;
export const BANK_INTEREST_ENGINE_VERSION = 2;

const JST = 'Asia/Tokyo';
const WEEKDAY_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function pad2(n) {
  return String(n).padStart(2, '0');
}

function japanParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: JST,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hourCycle: 'h23'
  }).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY_EN[get('weekday')] ?? 0
  };
}

export function bankJapanTodayKey(date = new Date()) {
  const j = japanParts(date);
  return `${j.year}-${j.month}-${j.day}`;
}

export function bankJapanMonthKey(date = new Date()) {
  const j = japanParts(date);
  return `${j.year}-${j.month}`;
}

export function bankMonthKeyNum(key) {
  const [y, m] = String(key || '').split('-').map(Number);
  if (!y || !m) return 0;
  return y * 12 + m;
}

export function bankNextMonthKey(key) {
  const [y, m] = String(key || '').split('-').map(Number);
  if (!y || !m) return bankJapanMonthKey();
  if (m >= 12) return `${y + 1}-1`;
  return `${y}-${m + 1}`;
}

export function bankMonthBefore(key) {
  const [y, m] = String(key || '').split('-').map(Number);
  if (!y || !m) return bankJapanMonthKey();
  if (m <= 1) return `${y - 1}-12`;
  return `${y}-${m - 1}`;
}

export function bankDayKeyNum(key) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  if (!y || !m || !d) return 0;
  return y * 10000 + m * 100 + d;
}

export function bankMonthKeyFromDayKey(dayKey) {
  const [y, m] = String(dayKey || '').split('-').map(Number);
  if (!y || !m) return '';
  return `${y}-${m}`;
}

function lastDayOfCalendarMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function bankLastDayOfMonthKey(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number);
  if (!y || !m) return '';
  return `${y}-${m}-${lastDayOfCalendarMonth(y, m)}`;
}

export function bankPrevDayKey(dayKey) {
  const [y, m, d] = String(dayKey || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const ms = new Date(`${y}-${pad2(m)}-${pad2(d)}T12:00:00+09:00`).getTime() - 86400000;
  return bankJapanTodayKey(new Date(ms));
}

export function bankNextDayKey(dayKey) {
  const [y, m, d] = String(dayKey || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const ms = new Date(`${y}-${pad2(m)}-${pad2(d)}T12:00:00+09:00`).getTime() + 86400000;
  return bankJapanTodayKey(new Date(ms));
}

export function bankDailyInterest(amount) {
  return (Number(amount) || 0) * BANK_MONTHLY_RATE / BANK_DAILY_DIVISOR;
}

/** 表示残高 */
export function bankDisplayBalance(b) {
  return Math.floor(Number(b?.amount) || 0);
}

/** 表示利息（入金済み分のみ。accruedInterest は含めない） */
export function bankDisplayInterest(b) {
  const amount = Number(b?.amount) || 0;
  const principal = Number(b?.principal ?? amount) || 0;
  return Math.max(0, Math.floor(amount - principal));
}

export function bankDisplayPrincipal(b) {
  return Math.round(Number(b?.principal ?? b?.amount) || 0);
}

/**
 * 新規預入ドキュメントの初期フィールド。
 * @param {number} amount
 * @param {number} createdAtMs
 * @param {Date|number} [now]
 */
export function initialBankDepositFields(amount, createdAtMs, now = Date.now()) {
  const at = Number(createdAtMs) || Date.now();
  const depositDay = bankJapanTodayKey(new Date(at));
  const depositMonth = bankJapanMonthKey(new Date(at));
  const nowDate = now instanceof Date ? now : new Date(now);
  const a = Number(amount) || 0;
  return {
    amount: a,
    principal: a,
    createdAt: at,
    lastSettledMonth: bankMonthBefore(depositMonth),
    lastAccruedDate: bankPrevDayKey(depositDay),
    accruedInterest: 0,
    interestEngineVersion: BANK_INTEREST_ENGINE_VERSION,
    lastInterestKey: bankJapanMonthKey(nowDate)
  };
}

/**
 * 旧エンジンデータ → 新エンジン境界。amount は減額しない。
 * @param {object} doc
 * @param {Date|number} [now]
 */
export function migrateBankDepositIfNeeded(doc, now = Date.now()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const todayMonth = bankJapanMonthKey(nowDate);
  const createdAt = Number(doc?.createdAt) || Date.now();
  const depositDay = bankJapanTodayKey(new Date(createdAt));
  const depositMonth = bankJapanMonthKey(new Date(createdAt));
  const amount = Number(doc?.amount) || 0;
  const principal = Number(doc?.principal ?? amount) || 0;

  if (Number(doc?.interestEngineVersion) === BANK_INTEREST_ENGINE_VERSION
    && doc?.lastSettledMonth
    && doc?.lastAccruedDate != null) {
    return {
      amount,
      principal,
      createdAt,
      accruedInterest: Number(doc.accruedInterest) || 0,
      lastAccruedDate: String(doc.lastAccruedDate),
      lastSettledMonth: String(doc.lastSettledMonth),
      interestEngineVersion: BANK_INTEREST_ENGINE_VERSION,
      lastInterestKey: todayMonth
    };
  }

  const lastInterestKey = doc?.lastInterestKey
    ? String(doc.lastInterestKey)
    : depositMonth;
  const lastSettledMonth = bankMonthBefore(lastInterestKey);
  let lastAccruedDate = bankLastDayOfMonthKey(lastSettledMonth);
  const dayBeforeDeposit = bankPrevDayKey(depositDay);
  if (bankDayKeyNum(lastAccruedDate) < bankDayKeyNum(depositDay)) {
    lastAccruedDate = dayBeforeDeposit;
  }

  return {
    amount,
    principal,
    createdAt,
    accruedInterest: 0,
    lastAccruedDate,
    lastSettledMonth,
    interestEngineVersion: BANK_INTEREST_ENGINE_VERSION,
    lastInterestKey: todayMonth
  };
}

/**
 * ある月の未計上日を accruedInterest に加算し、lastAccruedDate を進める。
 * amount は変えない。
 */
function accrueDaysInMonth(state, monthKey, throughDayKey, depositDay) {
  const monthEnd = bankLastDayOfMonthKey(monthKey);
  const cap = bankDayKeyNum(throughDayKey) < bankDayKeyNum(monthEnd) ? throughDayKey : monthEnd;
  let { amount, accruedInterest, lastAccruedDate } = state;
  let d = bankNextDayKey(lastAccruedDate);
  while (d && bankDayKeyNum(d) <= bankDayKeyNum(cap)) {
    if (bankMonthKeyFromDayKey(d) === monthKey && bankDayKeyNum(d) >= bankDayKeyNum(depositDay)) {
      accruedInterest += bankDailyInterest(amount);
    }
    lastAccruedDate = d;
    d = bankNextDayKey(d);
  }
  return { ...state, accruedInterest, lastAccruedDate };
}

/**
 * now（または todayKey）時点までの利息状態を計算する。
 * @param {object} doc raw または migrate 済み
 * @param {Date|number|string} now Date / ms / 'YYYY-M-D'
 */
export function computeBankInterestState(doc, now = Date.now()) {
  let todayKey;
  if (typeof now === 'string' && /^\d{4}-\d{1,2}-\d{1,2}$/.test(now)) {
    todayKey = now;
  } else {
    const nowDate = now instanceof Date ? now : new Date(now);
    todayKey = bankJapanTodayKey(nowDate);
  }
  const todayMonth = bankMonthKeyFromDayKey(todayKey);
  const nowMs = typeof now === 'string'
    ? new Date(`${todayKey.replace(/^(\d+)-(\d+)-(\d+)$/, (_, y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`)}T12:00:00+09:00`).getTime()
    : (now instanceof Date ? now.getTime() : Number(now) || Date.now());

  let state = migrateBankDepositIfNeeded(doc, nowMs);
  const depositDay = bankJapanTodayKey(new Date(state.createdAt));

  // 実行月より前の未 settle 月を古い順に入金
  let guard = 0;
  while (bankMonthKeyNum(bankNextMonthKey(state.lastSettledMonth)) < bankMonthKeyNum(todayMonth)) {
    const monthToSettle = bankNextMonthKey(state.lastSettledMonth);
    state = accrueDaysInMonth(state, monthToSettle, bankLastDayOfMonthKey(monthToSettle), depositDay);
    state = {
      ...state,
      amount: state.amount + state.accruedInterest,
      accruedInterest: 0,
      lastSettledMonth: monthToSettle,
      lastAccruedDate: bankLastDayOfMonthKey(monthToSettle),
      lastInterestKey: todayMonth,
      interestEngineVersion: BANK_INTEREST_ENGINE_VERSION
    };
    if (++guard > 240) break;
  }

  // 当月分は accrued のみ
  if (bankMonthKeyNum(state.lastSettledMonth) < bankMonthKeyNum(todayMonth)
    || bankMonthKeyFromDayKey(state.lastAccruedDate) === todayMonth
    || bankDayKeyNum(state.lastAccruedDate) < bankDayKeyNum(todayKey)) {
    state = accrueDaysInMonth(state, todayMonth, todayKey, depositDay);
  }

  state.lastInterestKey = todayMonth;
  state.interestEngineVersion = BANK_INTEREST_ENGINE_VERSION;
  return state;
}

/** Firestore に書く差分があるか */
export function bankInterestStateChanged(before, after) {
  if (!before || !after) return true;
  return Number(before.amount) !== Number(after.amount)
    || Number(before.accruedInterest) !== Number(after.accruedInterest)
    || String(before.lastAccruedDate) !== String(after.lastAccruedDate)
    || String(before.lastSettledMonth) !== String(after.lastSettledMonth)
    || Number(before.interestEngineVersion) !== Number(after.interestEngineVersion)
    || String(before.lastInterestKey || '') !== String(after.lastInterestKey || '')
    || Number(before.principal) !== Number(after.principal);
}

export function bankInterestWritePayload(state) {
  return {
    amount: state.amount,
    principal: state.principal,
    accruedInterest: state.accruedInterest,
    lastAccruedDate: state.lastAccruedDate,
    lastSettledMonth: state.lastSettledMonth,
    interestEngineVersion: BANK_INTEREST_ENGINE_VERSION,
    lastInterestKey: state.lastInterestKey
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function approxEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

/** 仕様例の自己テスト。失敗時は throw */
export function selfTestBankInterestLogic() {
  const rate = BANK_MONTHLY_RATE / BANK_DAILY_DIVISOR;

  // 8/30 預入 1000 → 9/4 初処理
  {
    const created = new Date('2026-08-30T12:00:00+09:00').getTime();
    const init = initialBankDepositFields(1000, created, new Date('2026-08-30T12:00:00+09:00'));
    assert(init.lastSettledMonth === '2026-7', 'init settle month');
    assert(init.lastAccruedDate === '2026-8-29', 'init accrued date');
    const s = computeBankInterestState(init, '2026-9-4');
    assert(s.lastSettledMonth === '2026-8', 'sep4 settled aug');
    const augInterest = 1000 * rate * 2;
    assert(approxEqual(s.amount, 1000 + augInterest), `sep4 amount got ${s.amount}`);
    const sepDaily = s.amount * rate;
    assert(approxEqual(s.accruedInterest, sepDaily * 4), `sep4 accrued got ${s.accruedInterest}`);
    assert(s.lastAccruedDate === '2026-9-4', 'sep4 lastAccruedDate');
    assert(bankDisplayBalance(s) === Math.floor(s.amount), 'display balance');
    assert(bankDisplayInterest(s) === Math.floor(s.amount - 1000), 'display interest excludes accrued');
  }

  // 同日再実行で不変
  {
    const created = new Date('2026-08-30T12:00:00+09:00').getTime();
    const a = computeBankInterestState(initialBankDepositFields(1000, created), '2026-9-4');
    const b = computeBankInterestState(a, '2026-9-4');
    assert(approxEqual(a.amount, b.amount) && approxEqual(a.accruedInterest, b.accruedInterest), 'idempotent same day');
    assert(a.lastAccruedDate === b.lastAccruedDate && a.lastSettledMonth === b.lastSettledMonth, 'idempotent keys');
  }

  // 10/5 初処理: 8月→9月入金、10月は accrued
  {
    const created = new Date('2026-08-30T12:00:00+09:00').getTime();
    const s = computeBankInterestState(initialBankDepositFields(1000, created), '2026-10-5');
    assert(s.lastSettledMonth === '2026-9', 'oct5 settled sep');
    const afterAug = 1000 + 1000 * rate * 2;
    const sepInterest = afterAug * rate * 30; // Sep has 30 days
    assert(approxEqual(s.amount, afterAug + sepInterest), `oct5 amount got ${s.amount}`);
    const octDaily = s.amount * rate;
    assert(approxEqual(s.accruedInterest, octDaily * 5), `oct5 accrued got ${s.accruedInterest}`);
  }

  // 移行: lastInterestKey=2026-9, amount=1005 → 8月再入金しない
  {
    const created = new Date('2026-08-30T12:00:00+09:00').getTime();
    const legacy = {
      amount: 1005,
      principal: 1000,
      createdAt: created,
      lastInterestKey: '2026-9'
    };
    const migrated = migrateBankDepositIfNeeded(legacy, new Date('2026-09-04T12:00:00+09:00'));
    assert(migrated.lastSettledMonth === '2026-8', 'migrate settle');
    assert(migrated.lastAccruedDate === '2026-8-31', 'migrate accrued date');
    assert(migrated.amount === 1005, 'migrate no reduce');
    const s = computeBankInterestState(legacy, '2026-9-4');
    assert(s.amount === 1005, 'migrate no re-credit aug');
    assert(s.lastSettledMonth === '2026-8', 'migrate stay settled');
    const daily = 1005 * rate;
    assert(approxEqual(s.accruedInterest, daily * 4), `migrate sep accrued got ${s.accruedInterest}`);
  }

  // 2月（28日）: 1/31 預入相当の境界から2月を settle
  {
    const created = new Date('2026-02-01T12:00:00+09:00').getTime();
    const init = initialBankDepositFields(3000, created);
    // lastAccruedDate=1/31, settle Feb on Mar 1
    const s = computeBankInterestState(init, '2026-3-1');
    assert(s.lastSettledMonth === '2026-2', 'feb settled');
    const days = 28; // 2026 is not leap? 2026 Feb has 28 days. Deposit Feb 1 → days 1..28 = 28 days
    const expected = 3000 + 3000 * rate * days;
    assert(approxEqual(s.amount, expected), `feb amount got ${s.amount} expected ${expected}`);
    // Mar 1 accrued one day
    assert(approxEqual(s.accruedInterest, s.amount * rate), 'mar1 one day accrued');
  }

  // 31日の月
  {
    const created = new Date('2026-07-01T12:00:00+09:00').getTime();
    const s = computeBankInterestState(initialBankDepositFields(1000, created), '2026-8-1');
    assert(approxEqual(s.amount, 1000 + 1000 * rate * 31), 'july 31 days');
  }

  return true;
}
