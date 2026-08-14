// イエノミクスの通知サーバー。
//
// なぜサーバーが必要か:
//   ブラウザの new Notification() は、アプリが開いている間しか動かない。
//   スマホがスリープしていても通知を届けるには、Firestore の変化を見て
//   サーバーから送るしかない。それをやっているのがこのファイル。
//
// 送り先の管理:
//   各端末は pushTokens コレクションに { familyCode, role, token } を登録する。
//   「この家族の子供の端末ぜんぶ」に送りたいときは、そこを検索して使う。

const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();

const JST = 'Asia/Tokyo';
const WEEKDAY_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 日本時間の壁時計。Cloud Functions の Date は UTC なので、ここで必ず揃える */
function japanParts(date = new Date()) {
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
    weekday: WEEKDAY_EN[get('weekday')] ?? 0
  };
}

function japanTodayKey(date = new Date()) {
  const j = japanParts(date);
  return `${j.year}-${j.month}-${j.day}`;
}

function japanDeadlineMs(hours, minutes, date = new Date()) {
  const j = japanParts(date);
  const h = Number.isFinite(hours) ? hours : 19;
  const m = Number.isFinite(minutes) ? minutes : 0;
  return new Date(`${j.year}-${pad2(j.month)}-${pad2(j.day)}T${pad2(h)}:${pad2(m)}:00+09:00`).getTime();
}

// 日本のユーザー向けなので東京リージョンに置く（通知が届くまでが少し速くなる）
setGlobalOptions({ region: 'asia-northeast1', maxInstances: 10 });

const APP_LINK = 'https://whinaotona-debug.github.io/ienomics/index.html';
const ICON = 'https://whinaotona-debug.github.io/ienomics/logo.png';

/**
 * 指定した家族の、指定した役割の端末すべてに通知を送る。
 * @param {string} familyCode 同期ID
 * @param {'parent'|'child'|'all'} role 送りたい相手
 */
async function notify(familyCode, role, title, body, tag) {
  if (!familyCode || !title) return;

  let query = db.collection('pushTokens').where('familyCode', '==', familyCode);
  if (role !== 'all') query = query.where('role', '==', role);

  const snap = await query.get();
  if (snap.empty) {
    console.log(`[notify] 宛先なし family=${familyCode} role=${role}`);
    return;
  }

  // 同じ端末が複数行あっても1回だけ送る
  const tokenToDocs = new Map();
  for (const d of snap.docs) {
    const token = d.get('token');
    if (!token) continue;
    if (!tokenToDocs.has(token)) tokenToDocs.set(token, []);
    tokenToDocs.get(token).push(d.ref);
  }
  const tokens = [...tokenToDocs.keys()];
  if (tokens.length === 0) return;

  const response = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body: body || '' },
    webpush: {
      notification: {
        title,
        body: body || '',
        icon: ICON,
        badge: ICON,
        tag: tag || undefined,
        // 同じ種類の通知が来たら上書きせず、ちゃんと鳴らす
        renotify: Boolean(tag)
      },
      fcmOptions: { link: APP_LINK }
    }
  });

  // 使えなくなったトークンを掃除する（アプリを消した端末など）
  const stale = [];
  response.responses.forEach((res, i) => {
    if (res.success) return;
    const code = res.error?.code || '';
    console.warn(`[notify] 送信失敗 ${code}`);
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token' ||
      code === 'messaging/invalid-argument'
    ) {
      stale.push(...tokenToDocs.get(tokens[i]));
    }
  });
  if (stale.length) {
    await Promise.all(stale.map(ref => ref.delete().catch(() => {})));
    console.log(`[notify] 無効トークンを${stale.length}件削除`);
  }

  console.log(`[notify] 成功${response.successCount} / 失敗${response.failureCount} (${title})`);
}

/** 子供の呼び名を取り出す */
async function getChildName(familyCode) {
  try {
    const snap = await db.collection('families').doc(familyCode).get();
    return snap.get('childName') || 'こども';
  } catch (e) {
    return 'こども';
  }
}

// ---- お仕事が追加されたとき ----
exports.onTaskCreated = onDocumentCreated('tasks/{taskId}', async (event) => {
  const t = event.data?.data();
  if (!t || !t.familyCode) return;
  const points = Number(t.points) || 0;

  if (t.status === 'open') {
    await notify(
      t.familyCode, 'child',
      '新しいお仕事！',
      `「${t.title}」（${points}pt）が発注されました`,
      'task-open'
    );
  } else if (t.status === 'accepted' && (t.autoAccepted || t.generatedKey)) {
    // 定期は受注手続きなしで始まるので、子供に「今日の分が出た」と知らせる
    await notify(
      t.familyCode, 'child',
      '今日の定期のお仕事',
      `「${t.title}」（${points}pt）が始まりました。終わったら完了を押してね`,
      'task-repeat'
    );
  } else if (t.status === 'proposed') {
    const name = await getChildName(t.familyCode);
    await notify(
      t.familyCode, 'parent',
      '見積りが届きました',
      `${name}さんから「${t.title}」（希望 ${points}pt）`,
      'task-proposed'
    );
  }
});

// ---- お仕事の状態が変わったとき ----
exports.onTaskUpdated = onDocumentUpdated('tasks/{taskId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after || !after.familyCode) return;
  if (before.status === after.status) return;

  const code = after.familyCode;
  const title = after.title || 'お仕事';
  const points = Number(after.points) || 0;

  // 見積りが承認されて発注になった
  if (before.status === 'proposed' && after.status === 'open') {
    return notify(code, 'child', '見積りが承認されました！', `「${title}」がお仕事になりました`, 'task-approved');
  }
  // 見積りが却下された
  if (before.status === 'proposed' && after.status === 'proposal_rejected') {
    return notify(code, 'child', '見積りが却下されました', `「${title}」の見積りは通りませんでした`, 'task-rejected');
  }
  // 子供が完了報告した
  if (after.status === 'completed') {
    const name = await getChildName(code);
    return notify(code, 'parent', 'お仕事完了の報告', `${name}さんが「${title}」を終わらせました`, 'task-completed');
  }
  // 親がやり直しを指示した
  if (before.status === 'completed' && after.status === 'accepted') {
    return notify(code, 'child', 'やり直しの指示', `「${title}」をもう一度お願いします`, 'task-redo');
  }
  // 親が承認してポイントを付与した
  if (before.status === 'completed' && after.status === 'approved') {
    return notify(code, 'child', 'お仕事が承認されました！', `「${title}」で ${points}pt ゲット！`, 'task-paid');
  }
  // 子供が受注した
  if (before.status === 'open' && after.status === 'accepted') {
    const name = await getChildName(code);
    return notify(code, 'parent', 'お仕事を受注しました', `${name}さんが「${title}」を引き受けました`, 'task-accepted');
  }
  // 子供がお断りした
  if (after.status === 'rejected') {
    const name = await getChildName(code);
    return notify(code, 'parent', 'お仕事をお断りされました', `${name}さんが「${title}」を断りました`, 'task-declined');
  }
});

// ---- ギフトが届いたとき ----
exports.onGiftCreated = onDocumentCreated('balloons/{giftId}', async (event) => {
  const g = event.data?.data();
  if (!g || !g.familyCode) return;
  const points = Number(g.points) || 0;
  const body = g.message ? `「${g.message}」 +${points}pt` : `ボーナス ${points}pt が届きました`;
  await notify(g.familyCode, 'child', 'ギフトが届きました', body, 'gift');
});

// ---- 換金の申請が来たとき ----
exports.onExchangeCreated = onDocumentCreated('exchanges/{exchangeId}', async (event) => {
  const e = event.data?.data();
  if (!e || !e.familyCode || e.status !== 'pending') return;
  const name = await getChildName(e.familyCode);
  await notify(
    e.familyCode, 'parent',
    '換金申請が届きました',
    `${name}さんが ${Number(e.yen) || 0}円 の換金を希望しています`,
    'exchange'
  );
});

// ---- 換金の結果が出たとき ----
exports.onExchangeUpdated = onDocumentUpdated('exchanges/{exchangeId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after || before.status === after.status) return;
  const yen = Number(after.yen) || 0;

  if (after.status === 'approved') {
    return notify(after.familyCode, 'child', '換金が承認されました！', `${yen}円 を受け取れます`, 'exchange-result');
  }
  if (after.status === 'rejected') {
    return notify(after.familyCode, 'child', '換金が却下されました', `${yen}円 の申請は通りませんでした`, 'exchange-result');
  }
});

// ---- 自動支払いが引き落とされたとき ----
exports.onPaymentCharged = onDocumentCreated('paymentLogs/{logId}', async (event) => {
  const l = event.data?.data();
  if (!l || !l.familyCode) return;
  const amount = Number(l.amount) || 0;
  const title = l.wentNegative ? '支払い引落（残高不足）' : '支払いが引き落とされました';
  const body = l.wentNegative
    ? `「${l.title}」 −${amount}pt。口座がマイナスになりました`
    : `「${l.title}」 −${amount}pt`;
  await notify(l.familyCode, 'all', title, body, 'payment');
});

// ---- お子さまの口座が削除されたとき ----
//
// 端末側でも関連データを消しているが、通知の宛先（pushTokens）は
// 「一覧で引けない」決まりにしてあるため端末からは掃除できない。
// 残しておくと消えた口座宛の通知が届き続けるので、ここで消す。
// 途中で通信が切れて端末側が消しきれなかった分の取りこぼしも拾う。
exports.onFamilyDeleted = onDocumentDeleted('families/{code}', async (event) => {
  const code = event.params.code;
  const collections = [
    'pushTokens', 'tasks', 'taskTemplates', 'tickets', 'exchanges',
    'investments', 'banks', 'balloons', 'scheduledPayments', 'paymentLogs'
  ];

  let total = 0;
  for (const name of collections) {
    // まとめ書きの上限を超えないよう、500件ずつ消していく
    while (true) {
      const snap = await db.collection(name).where('familyCode', '==', code).limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      total += snap.size;
      if (snap.size < 400) break;
    }
  }

  console.log(`[onFamilyDeleted] family=${code} の残りデータ${total}件を削除`);
});

/**
 * 定期のお仕事を、サーバー側で今日分だけ作る。
 * ドキュメントIDは端末側と同じ `rep_{テンプレID}_{年月日}` なので二重にならない。
 */
async function runGenerateRepeatedTasks() {
  const now = new Date();
  const j = japanParts(now);
  const todayStr = japanTodayKey(now);

  const snap = await db.collection('taskTemplates').get();
  if (snap.empty) return;

  let created = 0;
  let skipped = 0;
  let fixed = 0;

  for (const d of snap.docs) {
    const temp = d.data() || {};
    const days = Array.isArray(temp.days)
      ? temp.days.map(Number).filter(n => Number.isFinite(n))
      : [];

    let due = false;
    if (temp.type === 'weekly') due = days.includes(j.weekday);
    else if (temp.type === 'monthly') due = days.includes(j.day);
    if (!due) continue;

    const timeParts = String(temp.time || '19:00').split(':');
    const hours = Number(timeParts[0]);
    const minutes = Number(timeParts[1]) || 0;
    const deadlineMs = japanDeadlineMs(hours, minutes, now);

    const generatedKey = `rep_${d.id}_${todayStr}`;
    const taskRef = db.collection('tasks').doc(generatedKey);
    const existing = await taskRef.get();
    if (existing.exists) {
      const data = existing.data() || {};
      if (data.deadline !== deadlineMs && ['open', 'accepted'].includes(data.status)) {
        await taskRef.update({ deadline: deadlineMs });
        fixed += 1;
      }
      skipped += 1;
      continue;
    }

    await taskRef.set({
      familyCode: temp.familyCode,
      title: temp.title || 'お仕事',
      titleKana: temp.titleKana || '',
      points: Number(temp.points) || 0,
      status: 'accepted',
      generatedKey,
      templateId: d.id,
      createdAt: Date.now(),
      deadline: deadlineMs,
      autoGenerated: true,
      autoAccepted: true
    });
    created += 1;
  }

  console.log(`[generateRepeatedTasks] 作成${created} / 既存スキップ${skipped} / 期限修正${fixed} (${todayStr} JST ${j.hour}:${pad2(j.minute)})`);
}

// 0:00ちょうど（日本時間）。アプリを落としていなくても、サーバー側で今日分が出る。
exports.generateRepeatedTasks = onSchedule(
  { schedule: '0 0 * * *', timeZone: 'Asia/Tokyo' },
  runGenerateRepeatedTasks
);

// 取りこぼし防止。0:00に失敗しても、最大15分以内に追いつく。
exports.generateRepeatedTasksCatchup = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'Asia/Tokyo' },
  runGenerateRepeatedTasks
);

/**
 * 期限が近いお仕事を知らせる。10分ごとに動く。
 * アプリを閉じていても動くので、これまでの端末側タイマーより確実。
 */
exports.remindDeadlines = onSchedule(
  { schedule: 'every 10 minutes', timeZone: 'Asia/Tokyo' },
  async () => {
    const now = Date.now();
    const limit = now + 60 * 60 * 1000; // 1時間先まで

    // deadline の範囲だけで絞る（複合インデックスが不要な形）
    const snap = await db.collection('tasks')
      .where('deadline', '>=', now)
      .where('deadline', '<=', limit)
      .get();

    if (snap.empty) return;

    for (const d of snap.docs) {
      const t = d.data();
      if (!['open', 'accepted'].includes(t.status)) continue;
      // 同じ期限について二重に知らせない
      if (t.deadlineNotifiedFor === t.deadline) continue;

      const mins = Math.max(1, Math.ceil((t.deadline - now) / 60000));
      const timeTxt = mins >= 60 ? 'あと1時間' : `あと約${mins}分`;

      await d.ref.update({
        deadlineNotifiedFor: t.deadline,
        deadlineNotifiedAt: FieldValue.serverTimestamp()
      });

      await notify(
        t.familyCode, 'all',
        '期限が近づいています',
        `「${t.title}」の期限は${timeTxt}です`,
        `deadline-${d.id}`
      );
    }
  }
);
