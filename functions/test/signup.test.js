// 新規登録（4桁コード）と登録途中アカウント復旧のテスト。
// 実行: cd functions && node --test test/
// Firestore / Admin Auth は test/fakes.js の偽物を使う（本番・エミュレータに接続しない）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { HttpsError } = require('firebase-functions/v2/https');
const { createSignupHandlers, RESEND_COOLDOWN_MS, CODE_TTL_MS, TICKET_TTL_MS } = require('../signup');
const { FakeDB, FakeAuth, FieldValue } = require('./fakes');

function setup({ failSend = false } = {}) {
  const db = new FakeDB();
  const adminAuth = new FakeAuth();
  const clock = { t: Date.UTC(2026, 8, 28, 3, 0, 0) };
  const outbox = [];
  const h = createSignupHandlers({
    db, adminAuth, FieldValue, HttpsError,
    maskEmail: (e) => e.replace(/^(..).*@/, '$1***@'),
    now: () => clock.t,
    sendEmail: async ({ to, code }) => {
      if (failSend) throw new Error('resend down');
      outbox.push({ to, code });
    }
  });
  const call = (fn, data, auth = null) => h[fn]({ data, auth });
  const lastCode = (email) => [...outbox].reverse().find((m) => m.to === email)?.code;
  return { db, adminAuth, clock, outbox, h, call, lastCode };
}

async function rejects(p, code, re) {
  await assert.rejects(p, (e) => {
    assert.ok(e instanceof HttpsError, `HttpsError expected, got ${e}`);
    assert.equal(e.code, code, `code ${e.code} message ${e.message}`);
    if (re) assert.match(e.message, re);
    return true;
  });
}

async function registerNew(ctx, email = 'new@example.com', password = 'secret123', childName = 'はなこ') {
  await ctx.call('requestSignupCode', { email });
  const v = await ctx.call('verifySignupCode', { email, code: ctx.lastCode(email) });
  return ctx.call('completeParentSignup', { email, ticket: v.ticket, password, childName });
}

// ---- 登録 ----
test('新規登録: コード送信→確認→完了で Auth・users・口座がそろい、ログインできる', async () => {
  const ctx = setup();
  const email = 'Parent@Example.com ';
  const r1 = await ctx.call('requestSignupCode', { email });
  assert.equal(ctx.outbox.length, 1);
  assert.match(ctx.outbox[0].code, /^\d{4}$/);
  assert.equal(ctx.outbox[0].to, 'parent@example.com');
  assert.equal(r1.resendAvailableAt - r1.serverNow, 60000);
  assert.equal(r1.expiresAt - r1.serverNow, 10 * 60000);
  assert.equal(ctx.adminAuth.users.size, 0, 'コード確認前は Auth ユーザーを作らない');
  // 平文コードは保存しない
  assert.ok(!ctx.db.dump().includes(`"${ctx.outbox[0].code}"`));

  const v = await ctx.call('verifySignupCode', { email, code: ctx.outbox[0].code });
  assert.equal(v.mode, 'new');
  assert.equal(ctx.adminAuth.users.size, 0, 'コード確認だけではまだ作らない');

  const done = await ctx.call('completeParentSignup', { email, ticket: v.ticket, password: 'secret123', childName: ' はなこ ' });
  assert.equal(done.created, true);
  assert.ok(ctx.adminAuth.signIn('parent@example.com', 'secret123'));
  const user = [...ctx.adminAuth.users.values()][0];
  assert.equal(user.emailVerified, true);
  const fam = await ctx.db.collection('families').doc(done.familyCode).get();
  assert.deepEqual(fam.data(), {
    parentUid: user.uid, childUids: [], childName: 'はなこ', points: 0,
    stockCap: 10000, childLinked: false, createdAt: ctx.clock.t
  });
  assert.match(done.familyCode, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal((await ctx.db.collection('users').doc(user.uid).get()).get('role'), 'parent');
  // 同じチケットは二度使えない
  await rejects(ctx.call('completeParentSignup', { email, ticket: v.ticket, password: 'secret123', childName: 'x' }), 'failed-precondition');
});

test('新規登録: 入力チェック（メール形式・4桁・パスワード6文字・名前）', async () => {
  const ctx = setup();
  await rejects(ctx.call('requestSignupCode', { email: 'bad' }), 'invalid-argument');
  await ctx.call('requestSignupCode', { email: 'a@example.com' });
  await rejects(ctx.call('verifySignupCode', { email: 'a@example.com', code: '12a4' }), 'invalid-argument', /4桁/);
  const v = await ctx.call('verifySignupCode', { email: 'a@example.com', code: ctx.lastCode('a@example.com') });
  await rejects(ctx.call('completeParentSignup', { email: 'a@example.com', ticket: v.ticket, password: '12345', childName: 'x' }), 'invalid-argument', /6文字/);
  await rejects(ctx.call('completeParentSignup', { email: 'a@example.com', ticket: v.ticket, password: '123456', childName: '  ' }), 'invalid-argument', /名前/);
  await rejects(ctx.call('completeParentSignup', { email: 'b@example.com', ticket: v.ticket, password: '123456', childName: 'x' }), 'permission-denied');
  // 失敗しても何も作られていない
  assert.equal(ctx.adminAuth.users.size, 0);
});

// ---- 再送信 ----
test('再送信: 60秒以内はサーバーが拒否し、残り秒数を返す。60秒後は新コード・旧コード無効', async () => {
  const ctx = setup();
  const email = 'r@example.com';
  await ctx.call('requestSignupCode', { email });
  const oldCode = ctx.lastCode(email);
  ctx.clock.t += 59_000;
  await assert.rejects(ctx.call('requestSignupCode', { email }), (e) => {
    assert.equal(e.code, 'resource-exhausted');
    assert.equal(e.details.retryAfterSec, 1);
    return true;
  });
  assert.equal(ctx.outbox.length, 1, '待機中はメールを送らない');
  ctx.clock.t += 1_000;
  await ctx.call('requestSignupCode', { email });
  assert.equal(ctx.outbox.length, 2);
  let newCode = ctx.lastCode(email);
  if (newCode === oldCode) { // 1/10000 で同じ番号になり得るので引き直す
    ctx.clock.t += RESEND_COOLDOWN_MS; await ctx.call('requestSignupCode', { email }); newCode = ctx.lastCode(email);
  }
  await rejects(ctx.call('verifySignupCode', { email, code: oldCode }), 'invalid-argument', /違います/);
  const v = await ctx.call('verifySignupCode', { email, code: newCode });
  assert.ok(v.ticket);
});

test('再送信: 60秒待機は同時に押されても1通だけ（サーバー側で強制）', async () => {
  const ctx = setup();
  const email = 'race@example.com';
  const results = await Promise.allSettled([1, 2, 3].map(() => ctx.call('requestSignupCode', { email })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(ctx.outbox.length, 1);
});

test('再送信: メール送信に失敗したときは待機を解除して、すぐ再試行できる', async () => {
  const ctx = setup({ failSend: true });
  await rejects(ctx.call('requestSignupCode', { email: 'f@example.com' }), 'internal');
  const doc = (await ctx.db.collection('signupCodes').doc(require('crypto').createHash('sha256').update('signup:f@example.com').digest('hex')).get()).data();
  assert.equal(doc.lastSentAt, 0);
  // 送れていないコードは使えない
  await rejects(ctx.call('verifySignupCode', { email: 'f@example.com', code: '0000' }), 'not-found');
});

// ---- 期限切れ ----
test('期限切れ: 10分を過ぎたコードは使えず、再送信すれば使える', async () => {
  const ctx = setup();
  const email = 'x@example.com';
  await ctx.call('requestSignupCode', { email });
  const code = ctx.lastCode(email);
  ctx.clock.t += CODE_TTL_MS;
  await rejects(ctx.call('verifySignupCode', { email, code }), 'deadline-exceeded', /有効期限/);
  await ctx.call('requestSignupCode', { email });
  const v = await ctx.call('verifySignupCode', { email, code: ctx.lastCode(email) });
  assert.ok(v.ticket);
});

// ---- 入力5回失敗・累計ロック ----
const LOCK_MS = 60 * 60 * 1000;
function wrongOf(code) { return code === '0000' ? '1111' : '0000'; }
async function expectLocked(p) {
  await assert.rejects(p, (e) => {
    assert.equal(e.code, 'failed-precondition', e.message);
    assert.equal(e.details?.reason, 'email-locked');
    assert.ok(e.details.retryAfterSec > 0);
    return true;
  });
}

test('入力5回失敗: 5回目で1時間ロック。ロック中は正しいコードも再送信も拒否（メールも送らない）', async () => {
  const ctx = setup();
  const email = 'l@example.com';
  await ctx.call('requestSignupCode', { email });
  const code = ctx.lastCode(email);
  for (let i = 1; i <= 4; i++) {
    await assert.rejects(ctx.call('verifySignupCode', { email, code: wrongOf(code) }), (e) => {
      assert.equal(e.code, 'invalid-argument'); assert.equal(e.details.attemptsLeft, 5 - i); return true;
    });
  }
  await expectLocked(ctx.call('verifySignupCode', { email, code: wrongOf(code) }));
  await expectLocked(ctx.call('verifySignupCode', { email, code }));
  ctx.clock.t += RESEND_COOLDOWN_MS;
  await expectLocked(ctx.call('requestSignupCode', { email }));
  assert.equal(ctx.outbox.length, 1, 'ロック中はメールを送らない');
});

test('累計: コードを再発行しても失敗回数はリセットされず、合計5回でロック', async () => {
  const ctx = setup();
  const email = 'acc@example.com';
  await ctx.call('requestSignupCode', { email });
  const c1 = ctx.lastCode(email);
  for (let i = 0; i < 3; i++) await assert.rejects(ctx.call('verifySignupCode', { email, code: wrongOf(c1) }));
  ctx.clock.t += RESEND_COOLDOWN_MS;
  const r = await ctx.call('requestSignupCode', { email });
  assert.equal(r.attemptsLeft, 2, '再発行後も残りは2回');
  const c2 = ctx.lastCode(email);
  await assert.rejects(ctx.call('verifySignupCode', { email, code: wrongOf(c2) }), (e) => { assert.equal(e.details.attemptsLeft, 1); return true; });
  await expectLocked(ctx.call('verifySignupCode', { email, code: wrongOf(c2) }));
  await expectLocked(ctx.call('verifySignupCode', { email, code: c2 }));
});

test('ロック解除: 1時間後に再送信でき、失敗回数は0に戻り、登録を再開できる。59分では解除されない', async () => {
  const ctx = setup();
  const email = 'unlock@example.com';
  await ctx.call('requestSignupCode', { email });
  const c = ctx.lastCode(email);
  for (let i = 0; i < 4; i++) await assert.rejects(ctx.call('verifySignupCode', { email, code: wrongOf(c) }));
  await expectLocked(ctx.call('verifySignupCode', { email, code: wrongOf(c) }));
  ctx.clock.t += LOCK_MS - 60_000;
  await expectLocked(ctx.call('requestSignupCode', { email }));
  ctx.clock.t += 60_000;
  const r = await ctx.call('requestSignupCode', { email });
  assert.equal(r.attemptsLeft, 5);
  const v = await ctx.call('verifySignupCode', { email, code: ctx.lastCode(email) });
  const done = await ctx.call('completeParentSignup', { email, ticket: v.ticket, password: 'secret123', childName: 'はなこ' });
  assert.equal(done.created, true);
});

test('ロック解除後に古いコードで確認しても使えない（新しいコードが必要）', async () => {
  const ctx = setup();
  const email = 'old-after-unlock@example.com';
  await ctx.call('requestSignupCode', { email });
  const c = ctx.lastCode(email);
  for (let i = 0; i < 5; i++) await assert.rejects(ctx.call('verifySignupCode', { email, code: wrongOf(c) }));
  ctx.clock.t += LOCK_MS;
  await rejects(ctx.call('verifySignupCode', { email, code: c }), 'failed-precondition', /使えなく/);
});

test('成功すると失敗回数は0に戻る（4回失敗→正解→再度コード要求で残り5回）', async () => {
  const ctx = setup();
  const email = 'reset@example.com';
  await ctx.call('requestSignupCode', { email });
  const c = ctx.lastCode(email);
  for (let i = 0; i < 4; i++) await assert.rejects(ctx.call('verifySignupCode', { email, code: wrongOf(c) }));
  await ctx.call('verifySignupCode', { email, code: c });
  ctx.clock.t += RESEND_COOLDOWN_MS;
  const r = await ctx.call('requestSignupCode', { email });
  assert.equal(r.attemptsLeft, 5);
});

test('同時送信: 50回同時に間違えても、評価されるのは最大5回でロック。正解が混ざっていても突破できない', async () => {
  for (let round = 0; round < 20; round++) {
    const ctx = setup();
    const email = `par${round}@example.com`;
    await ctx.call('requestSignupCode', { email });
    const c = ctx.lastCode(email);
    const guesses = [];
    for (let i = 0; i < 60 && guesses.length < 50; i++) {
      const g = String(i).padStart(4, '0');
      if (g !== c) guesses.push(g);
    }
    guesses.splice(25, 0, c); // 正解を真ん中に混ぜる（最初の5回の評価に入らない位置）
    const rs = await Promise.allSettled(guesses.map((code) => ctx.call('verifySignupCode', { email, code })));
    const wrong = rs.filter((r) => r.status === 'rejected' && r.reason?.details?.reason === 'wrong').length;
    const ok = rs.filter((r) => r.status === 'fulfilled').length;
    const doc = [...ctx.db.docs.entries()].find(([k]) => k.startsWith('signupCodes/'))[1];
    assert.ok(wrong <= 4, `wrong=${wrong}`);
    assert.ok(doc.failCount <= 5, `failCount=${doc.failCount}`);
    if (ok === 1) {
      assert.ok(wrong <= 4 && doc.failCount === 0, '正解が先に評価された場合だけ成功（それまでの失敗は4回以下）');
    } else {
      assert.equal(ok, 0);
      assert.equal(doc.failCount, 5);
      assert.ok(doc.lockedUntil > ctx.clock.t);
    }
  }
});

test('ロックはメールアドレスごと: 他のアドレスの登録には影響しない', async () => {
  const ctx = setup();
  await ctx.call('requestSignupCode', { email: 'a1@example.com' });
  const c = ctx.lastCode('a1@example.com');
  for (let i = 0; i < 5; i++) await assert.rejects(ctx.call('verifySignupCode', { email: 'a1@example.com', code: wrongOf(c) }));
  await registerNew(ctx, 'a2@example.com');
  assert.ok(ctx.adminAuth.signIn('a2@example.com', 'secret123'));
});

test('ロックさせても、正常なアカウントの判定・データは変わらない（ログイン可能のまま）', async () => {
  const ctx = setup();
  const u = await ctx.adminAuth.createUser({ email: 'safe@example.com', password: 'goodpass', emailVerified: true });
  await ctx.db.collection('families').doc('SAFE01').set({ parentUid: u.uid, points: 7 });
  const before = ctx.db.dump();
  await rejects(ctx.call('requestSignupCode', { email: 'safe@example.com' }), 'already-exists');
  for (let i = 0; i < 6; i++) await assert.rejects(ctx.call('verifySignupCode', { email: 'safe@example.com', code: '1234' }));
  assert.equal(ctx.db.dump(), before);
  assert.ok(ctx.adminAuth.signIn('safe@example.com', 'goodpass'));
});

test('入力: 確認済みのコードは再利用できない', async () => {
  const ctx = setup();
  const email = 'u@example.com';
  await ctx.call('requestSignupCode', { email });
  const code = ctx.lastCode(email);
  await ctx.call('verifySignupCode', { email, code });
  await rejects(ctx.call('verifySignupCode', { email, code }), 'not-found');
});

// ---- 途中離脱 ----
test('途中離脱: コード確認後に離脱しても30分以内なら同じチケットで完了できる。過ぎたらやり直し', async () => {
  const ctx = setup();
  const email = 'leave@example.com';
  await ctx.call('requestSignupCode', { email });
  const v = await ctx.call('verifySignupCode', { email, code: ctx.lastCode(email) });
  ctx.clock.t += TICKET_TTL_MS - 1000;
  const done = await ctx.call('completeParentSignup', { email, ticket: v.ticket, password: 'secret123', childName: 'たろう' });
  assert.equal(done.created, true);

  const ctx2 = setup();
  await ctx2.call('requestSignupCode', { email });
  const v2 = await ctx2.call('verifySignupCode', { email, code: ctx2.lastCode(email) });
  ctx2.clock.t += TICKET_TTL_MS;
  await rejects(ctx2.call('completeParentSignup', { email, ticket: v2.ticket, password: 'secret123', childName: 'たろう' }), 'deadline-exceeded');
  assert.equal(ctx2.adminAuth.users.size, 0, '期限切れなら何も作らない');
});

test('途中離脱: 口座作成の途中で落ちても、同じチケットで再実行すると口座は1つだけ', async () => {
  const ctx = setup();
  const email = 'crash@example.com';
  await ctx.call('requestSignupCode', { email });
  const v = await ctx.call('verifySignupCode', { email, code: ctx.lastCode(email) });
  // 1回目: Auth 作成直後に Firestore が落ちたことにする
  const orig = ctx.db.runTransaction.bind(ctx.db);
  ctx.db.runTransaction = async () => { throw new Error('firestore down'); };
  await assert.rejects(ctx.call('completeParentSignup', { email, ticket: v.ticket, password: 'secret123', childName: 'はなこ' }));
  ctx.db.runTransaction = orig;
  assert.equal(ctx.adminAuth.users.size, 1);
  // 2回目: 同じチケットで続きから
  const done = await ctx.call('completeParentSignup', { email, ticket: v.ticket, password: 'secret123', childName: 'はなこ' });
  assert.equal(done.mode, 'recover');
  const fams = await ctx.db.collection('families').get();
  assert.equal(fams.size, 1);
  assert.ok(ctx.adminAuth.signIn(email, 'secret123'));
});

test('同時実行: 登録完了が2回同時に送られても、口座は1つだけ', async () => {
  const ctx = setup();
  const email = 'dup@example.com';
  await ctx.call('requestSignupCode', { email });
  const v = await ctx.call('verifySignupCode', { email, code: ctx.lastCode(email) });
  const rs = await Promise.allSettled([1, 2].map(() => ctx.call('completeParentSignup', { email, ticket: v.ticket, password: 'secret123', childName: 'はなこ' })));
  assert.deepEqual(rs.map((r) => r.status), ['fulfilled', 'fulfilled'], '二重送信でも両方成功として返す（エラー表示にしない）');
  assert.equal(rs[0].value.familyCode, rs[1].value.familyCode);
  assert.ok(ctx.adminAuth.signIn(email, 'secret123'));
  assert.equal((await ctx.db.collection('families').get()).size, 1);
  assert.equal(ctx.adminAuth.users.size, 1);
});

// ---- 既存アカウント復旧 ----
test('復旧（パスワード未設定）: 旧メールリンク方式で止まったアカウントに、パスワードと口座を作る。uid は変わらない', async () => {
  const ctx = setup();
  const email = 'old@example.com';
  const old = await ctx.adminAuth.createUser({ email, emailVerified: true }); // リンクで作られ、パスワード未設定
  await ctx.call('requestSignupCode', { email });
  const v = await ctx.call('verifySignupCode', { email, code: ctx.lastCode(email) });
  assert.equal(v.mode, 'recover');
  assert.equal(v.hasPassword, 'unknown');
  assert.equal(ctx.adminAuth.signIn(email, 'newpass1'), false);
  const done = await ctx.call('completeParentSignup', { email, ticket: v.ticket, password: 'newpass1', childName: 'じろう' });
  assert.equal(done.mode, 'recover');
  assert.equal(ctx.adminAuth.users.size, 1);
  assert.ok(ctx.adminAuth.signIn(email, 'newpass1'));
  const fam = await ctx.db.collection('families').doc(done.familyCode).get();
  assert.equal(fam.get('parentUid'), old.uid);
  assert.equal((await ctx.db.collection('users').doc(old.uid).get()).get('role'), 'parent');
});

test('復旧（パスワード設定済み）: users はあるが口座が無い → hasPassword=yes。再設定しても users の既存項目は残る', async () => {
  const ctx = setup();
  const email = 'half@example.com';
  const u = await ctx.adminAuth.createUser({ email, password: 'oldpass1', emailVerified: true });
  await ctx.db.collection('users').doc(u.uid).set({ role: 'parent', memo: 'keep' });
  await ctx.call('requestSignupCode', { email });
  const v = await ctx.call('verifySignupCode', { email, code: ctx.lastCode(email) });
  assert.equal(v.mode, 'recover');
  assert.equal(v.hasPassword, 'yes');
  const done = await ctx.call('completeParentSignup', { email, ticket: v.ticket, password: 'newpass2', childName: 'さぶろう' });
  assert.ok(ctx.adminAuth.signIn(email, 'newpass2'));
  const userDoc = (await ctx.db.collection('users').doc(u.uid).get()).data();
  assert.equal(userDoc.memo, 'keep');
  assert.equal((await ctx.db.collection('families').doc(done.familyCode).get()).get('parentUid'), u.uid);
});

test('復旧（今のパスワードでログイン）: ログイン後の createParentFamily で口座だけ作る', async () => {
  const ctx = setup();
  const email = 'keep@example.com';
  const u = await ctx.adminAuth.createUser({ email, password: 'oldpass1', emailVerified: true });
  const auth = { uid: u.uid, token: { email, email_verified: true, firebase: { sign_in_provider: 'password' } } };
  const r = await ctx.call('createParentFamily', { childName: 'しろう' }, auth);
  assert.equal(r.created, true);
  assert.ok(ctx.adminAuth.signIn(email, 'oldpass1'), 'パスワードは変わらない');
  const again = await ctx.call('createParentFamily', { childName: '別の名前' }, auth);
  assert.equal(again.created, false);
  assert.equal(again.familyCode, r.familyCode);
  assert.equal((await ctx.db.collection('families').get()).size, 1);
});

test('createParentFamily: 未ログイン・匿名（子ども端末）・メール未確認は拒否', async () => {
  const ctx = setup();
  await rejects(ctx.call('createParentFamily', { childName: 'x' }, null), 'unauthenticated');
  await rejects(ctx.call('createParentFamily', { childName: 'x' }, { uid: 'a', token: { firebase: { sign_in_provider: 'anonymous' } } }), 'permission-denied');
  await rejects(ctx.call('createParentFamily', { childName: 'x' }, { uid: 'b', token: { email: 'b@example.com', email_verified: false, firebase: { sign_in_provider: 'password' } } }), 'failed-precondition');
  assert.equal((await ctx.db.collection('families').get()).size, 0);
});

// ---- 正常なアカウントは壊さない ----
async function seedHealthy(ctx, email = 'ok@example.com') {
  const u = await ctx.adminAuth.createUser({ email, password: 'goodpass', emailVerified: true });
  await ctx.db.collection('users').doc(u.uid).set({ role: 'parent' });
  await ctx.db.collection('families').doc('ABCDEF').set({ parentUid: u.uid, childUids: ['c1'], childName: 'いちろう', points: 1234, stockCap: 10000, childLinked: true, createdAt: 1 });
  await ctx.db.collection('banks').doc('b1').set({ familyCode: 'ABCDEF', amount: 500 });
  return u;
}

test('正常なアカウント: コード送信・確認・完了・口座作成のどれでも一切書き換えない', async () => {
  const ctx = setup();
  const u = await seedHealthy(ctx);
  const before = ctx.db.dump();
  const authBefore = ctx.adminAuth.dump();
  await rejects(ctx.call('requestSignupCode', { email: 'OK@example.com' }), 'already-exists');
  assert.equal(ctx.outbox.length, 0, '正常なアカウントにはコードを送らない');
  await rejects(ctx.call('verifySignupCode', { email: 'ok@example.com', code: '1234' }), 'not-found');
  const auth = { uid: u.uid, token: { email: 'ok@example.com', email_verified: true, firebase: { sign_in_provider: 'password' } } };
  const r = await ctx.call('createParentFamily', { childName: '上書き' }, auth);
  assert.equal(r.created, false);
  assert.equal(r.familyCode, 'ABCDEF');
  assert.equal(ctx.db.dump(), before, 'Firestore は1バイトも変わらない');
  assert.equal(ctx.adminAuth.dump(), authBefore, 'Auth も変わらない');
  assert.ok(ctx.adminAuth.signIn('ok@example.com', 'goodpass'));
});

test('正常なアカウント: 途中で正常になった場合（チケット発行後に口座ができた）も上書きしない', async () => {
  const ctx = setup();
  const email = 'late@example.com';
  const u = await ctx.adminAuth.createUser({ email, emailVerified: true });
  await ctx.call('requestSignupCode', { email });
  const v = await ctx.call('verifySignupCode', { email, code: ctx.lastCode(email) });
  await ctx.db.collection('families').doc('ZZZZZZ').set({ parentUid: u.uid, points: 50 });
  const authBefore = ctx.adminAuth.dump();
  await rejects(ctx.call('completeParentSignup', { email, ticket: v.ticket, password: 'secret123', childName: 'x' }), 'already-exists');
  assert.equal(ctx.adminAuth.dump(), authBefore, 'パスワードは変更しない');
  assert.equal((await ctx.db.collection('families').get()).size, 1);
});

test('旧データの親（users.familyCode で口座を指し、口座に parentUid が無い）は正常とみなす', async () => {
  const ctx = setup();
  const email = 'legacy@example.com';
  const u = await ctx.adminAuth.createUser({ email, password: 'legacy1', emailVerified: true });
  await ctx.db.collection('users').doc(u.uid).set({ role: 'parent', familyCode: 'LEGACY' });
  await ctx.db.collection('families').doc('LEGACY').set({ points: 99 });
  const before = ctx.db.dump();
  await rejects(ctx.call('requestSignupCode', { email }), 'already-exists');
  const auth = { uid: u.uid, token: { email, email_verified: true, firebase: { sign_in_provider: 'password' } } };
  const r = await ctx.call('createParentFamily', { childName: 'x' }, auth);
  assert.equal(r.created, false);
  assert.equal(ctx.db.dump(), before);
});

test('無効化されたアカウントは復旧しない', async () => {
  const ctx = setup();
  const u = await ctx.adminAuth.createUser({ email: 'd@example.com', emailVerified: true });
  await ctx.adminAuth.updateUser(u.uid, { disabled: true });
  await rejects(ctx.call('requestSignupCode', { email: 'd@example.com' }), 'permission-denied');
  assert.equal(ctx.outbox.length, 0);
});

// ---- 削除した関数・App Check ----
const { execFileSync } = require('child_process');
function loadIndex(env = {}, script = "console.log(JSON.stringify(Object.keys(require('./index.js'))))") {
  return execFileSync(process.execPath, ['-e', script], {
    cwd: require('path').join(__dirname, '..'),
    env: { ...process.env, GCLOUD_PROJECT: 'demo-test', FIREBASE_CONFIG: '{"projectId":"demo-test"}', ...env },
    encoding: 'utf8', timeout: 30000
  }).trim().split('\n').pop();
}

test('sendTestEmail と sendSignInEmail はコードから消え、パスワード再設定と新しい関数は残っている', () => {
  const names = JSON.parse(loadIndex());
  assert.ok(!names.includes('sendTestEmail'));
  assert.ok(!names.includes('sendSignInEmail'));
  for (const n of ['sendPasswordResetEmail', 'requestSignupCode', 'verifySignupCode', 'completeParentSignup', 'createParentFamily']) {
    assert.ok(names.includes(n), n);
  }
});

test('App Check: enforce のときはトークンの無い呼び出しを、データに触る前に拒否する', () => {
  const script = `
    const m = require('./index.js');
    Promise.all(['requestSignupCode','verifySignupCode','completeParentSignup'].map((n) =>
      Promise.resolve().then(() => m[n].run({ data: { email: 'x@example.com' } })).then(() => 'passed', (e) => e.details?.reason || e.message)
    )).then((r) => console.log(JSON.stringify(r)));`;
  const r = JSON.parse(loadIndex({ SIGNUP_APP_CHECK_MODE: 'enforce' }, script));
  assert.deepEqual(r, ['app-check', 'app-check', 'app-check']);
});
