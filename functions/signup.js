/**
 * 親の新規登録（4桁の認証コード方式）と、登録途中アカウントの復旧。
 *
 * 流れ:
 *   1. requestSignupCode  … コードを発行してメールで送る（60秒に1回まで。サーバーで強制）
 *   2. verifySignupCode   … コードを確かめ、30分だけ使える「登録チケット」を渡す
 *   3. completeParentSignup … チケットを使って Auth ユーザー・users・families をそろえる
 *   +  createParentFamily … ログイン済みで口座が無い親に、口座だけ作る
 *
 * 守っていること:
 *   - コード確認が済むまで Auth ユーザーは作らない（確認前のアカウントは存在しない）。
 *   - 「正常なアカウント」（口座がある親）は、このファイルの処理では一切書き換えない。
 *   - コードは平文で保存しない（ランダムな塩＋SHA-256）。比較は timingSafeEqual。
 *   - 総当たり対策: 失敗は「メールアドレスごとの累計」で数え、コードを再発行しても減らさない。
 *     累計5回で1時間ロック（その間はコードの確認も再送信もできない）。判定と更新はトランザクション内。
 *     ロックの解除条件: (1) 5回目の失敗から1時間たつ（自動で解除され、失敗回数も0に戻る）
 *                       (2) 管理者が signupCodes/{sha256("signup:"+メール)} を削除する
 *     ロックが止めるのは「そのメールアドレスでの新規登録・復旧」だけ。ログイン・パスワード再設定・
 *     子どもの同期・口座のある正常なアカウントには影響しない（第三者がロックさせても、それ以上の被害は無い）。
 *   - パスワードは Admin SDK で設定する（クライアントの updatePassword は
 *     「ログイン直後5分以内」の制限で requires-recent-login になるため使わない）。
 *   - コード・パスワード・チケットはログに出さない。
 */
const crypto = require('crypto');

const CODE_TTL_MS = 10 * 60 * 1000;      // コードの有効期限 10分
const CODE_MAX_ATTEMPTS = 5;             // 1つのコードで間違えられる回数
const EMAIL_MAX_FAILURES = 5;            // 同じメールアドレスでの失敗の累計上限（コードを再発行しても減らない）
const EMAIL_LOCK_MS = 60 * 60 * 1000;    // 累計上限に達したら 1時間ロック
const RESEND_COOLDOWN_MS = 60 * 1000;    // 再送信まで 60秒
const TICKET_TTL_MS = 30 * 60 * 1000;    // コード確認後、登録を終えるまでの猶予 30分
const PASSWORD_MIN = 6;                  // 既存のログイン・再設定画面と同じ
const PASSWORD_MAX = 128;
const CHILD_NAME_MAX = 20;
const DEFAULT_STOCK_CAP = 10000;         // app.js の DEFAULT_STOCK_CAP と同じ
const FAMILY_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // app.js の generateFamilyCode と同じ

const CODES = 'signupCodes';
const TICKETS = 'signupTickets';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function emailKey(email) {
  return sha256Hex(`signup:${email}`);
}

function hashCode(code, salt) {
  return sha256Hex(`${salt}:${code}`);
}

function newCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a || ''), 'hex');
  const bb = Buffer.from(String(b || ''), 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function newFamilyCode() {
  const buf = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) code += FAMILY_CODE_CHARS[buf[i] % FAMILY_CODE_CHARS.length];
  return code;
}

function buildCodeEmail(code) {
  const subject = '【イエノミクス】認証コード';
  const text = [
    'イエノミクスの認証コードです。',
    '',
    `認証コード: ${code}`,
    '',
    'アプリの画面にこの4桁の数字を入力してください。',
    'コードの有効期限は10分です。',
    '',
    'このメールに心当たりがない場合は、何もせずに削除してください。'
  ].join('\n');
  const html = [
    '<p>イエノミクスの認証コードです。</p>',
    `<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">${code}</p>`,
    '<p>アプリの画面にこの4桁の数字を入力してください。<br>コードの有効期限は10分です。</p>',
    '<p style="color:#666;font-size:12px">このメールに心当たりがない場合は、何もせずに削除してください。</p>'
  ].join('');
  return { subject, text, html };
}

function createSignupHandlers({ db, adminAuth, FieldValue, HttpsError, sendEmail, maskEmail, now = () => Date.now() }) {

  function readEmail(data) {
    const email = normalizeEmail(data?.email);
    if (!email || !isValidEmail(email)) {
      throw new HttpsError('invalid-argument', '有効なメールアドレスを入力してください');
    }
    return email;
  }

  async function getUserByEmailOrNull(email) {
    try {
      return await adminAuth.getUserByEmail(email);
    } catch (e) {
      if (e?.code === 'auth/user-not-found') return null;
      throw e;
    }
  }

  /**
   * その親に口座があるか（= 正常なアカウントか）。
   * parentUid で引ける口座、または旧データ（users.familyCode が指す口座）があれば正常とみなす。
   * 旧データは app.js の runMigrationAndLoadChildren がログイン時に parentUid を補う。
   */
  async function findExistingFamily(uid, tx = null) {
    const q = db.collection('families').where('parentUid', '==', uid).limit(1);
    const snap = tx ? await tx.get(q) : await q.get();
    if (!snap.empty) return snap.docs[0].id;
    const userRef = db.collection('users').doc(uid);
    const userSnap = tx ? await tx.get(userRef) : await userRef.get();
    const legacyCode = userSnap.exists ? userSnap.get('familyCode') : null;
    if (typeof legacyCode === 'string' && legacyCode) {
      const famRef = db.collection('families').doc(legacyCode);
      const famSnap = tx ? await tx.get(famRef) : await famRef.get();
      if (famSnap.exists) return legacyCode;
    }
    return null;
  }

  /**
   * メールアドレスのアカウント状態。
   *   new      … Auth ユーザーなし
   *   recover  … Auth ユーザーはあるが口座が無い（旧方式で途中終了など）
   *   complete … 口座がある正常なアカウント（このフローでは触らない）
   *   disabled … 無効化されたアカウント
   */
  async function classifyAccount(email) {
    const user = await getUserByEmailOrNull(email);
    if (!user) return { state: 'new', user: null };
    if (user.disabled) return { state: 'disabled', user };
    const familyCode = await findExistingFamily(user.uid);
    if (familyCode) return { state: 'complete', user };
    return { state: 'recover', user };
  }

  function rejectByState(state) {
    if (state === 'complete') {
      throw new HttpsError('already-exists', 'このメールアドレスはすでに登録されています', {
        authCode: 'auth/email-already-in-use'
      });
    }
    if (state === 'disabled') {
      throw new HttpsError('permission-denied', 'このアカウントは現在利用できません');
    }
  }

  /**
   * パスワードが設定済みか。Admin SDK では確実に判定できない（権限によってハッシュが伏せられる）ため、
   *   yes     … ハッシュが見える、または users ドキュメントがある
   *             （旧方式は updatePassword 成功後にだけ users を作っていた）
   *   unknown … それ以外（旧方式で途中終了した多くのアカウント）
   * どちらでも、コード確認済みなら新しいパスワードを設定してよい（パスワード再設定と同じ強さの本人確認）。
   */
  async function passwordHint(user) {
    if (!user) return 'none';
    if (user.passwordHash) return 'yes';
    const userSnap = await db.collection('users').doc(user.uid).get();
    return userSnap.exists ? 'yes' : 'unknown';
  }

  /** ロックの状態。期限切れのロックは「解除済み（失敗回数0）」として扱う */
  function lockState(d, t) {
    const lockedUntil = Number(d?.lockedUntil) || 0;
    if (lockedUntil > t) return { locked: true, lockedUntil, failCount: EMAIL_MAX_FAILURES, expired: false };
    if (lockedUntil) return { locked: false, lockedUntil: 0, failCount: 0, expired: true };
    return { locked: false, lockedUntil: 0, failCount: Number(d?.failCount) || 0, expired: false };
  }

  function lockedError(lockedUntil, t) {
    const retryAfterSec = Math.max(1, Math.ceil((lockedUntil - t) / 1000));
    return new HttpsError('failed-precondition',
      '認証の失敗が5回に達したため、このメールアドレスでの登録を1時間停止しています。時間をおいてから、もう一度コードを受け取ってください',
      { reason: 'email-locked', lockedUntil, retryAfterSec, attemptsLeft: 0 });
  }

  // ---- 1. コード発行・再送信 ----
  async function requestSignupCode(request) {
    const email = readEmail(request.data);
    const account = await classifyAccount(email);
    rejectByState(account.state);

    const ref = db.collection(CODES).doc(emailKey(email));
    const code = newCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const t = now();

    const reserved = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : {};
      const lock = lockState(d, t);
      if (lock.locked) return { ok: false, lockedUntil: lock.lockedUntil };
      const lastSentAt = Number(d.lastSentAt) || 0;
      if (lastSentAt && t - lastSentAt < RESEND_COOLDOWN_MS) {
        return { ok: false, resendAvailableAt: lastSentAt + RESEND_COOLDOWN_MS };
      }
      // 新しいコードで上書きする＝古いコードはこの時点で無効。
      // 失敗の累計（failCount）はリセットしない。期限切れのロックだけ解除する。
      tx.set(ref, {
        codeHash: hashCode(code, salt),
        salt,
        expiresAt: t + CODE_TTL_MS,
        attempts: 0,
        status: 'pending',
        lastSentAt: t,
        sendCount: FieldValue.increment(1),
        updatedAt: t,
        ...(lock.expired ? { failCount: 0, lockedUntil: 0 } : {}),
        ...(snap.exists ? {} : { createdAt: t, failCount: 0, lockedUntil: 0 })
      }, { merge: true });
      return { ok: true, failCount: lock.failCount };
    });

    if (!reserved.ok && reserved.lockedUntil) throw lockedError(reserved.lockedUntil, t);
    if (!reserved.ok) {
      const retryAfterSec = Math.max(1, Math.ceil((reserved.resendAvailableAt - t) / 1000));
      throw new HttpsError('resource-exhausted', `再送信は${retryAfterSec}秒後にできます`, {
        resendAvailableAt: reserved.resendAvailableAt,
        retryAfterSec
      });
    }

    try {
      const { subject, text, html } = buildCodeEmail(code);
      await sendEmail({ to: email, subject, text, html, code, logTag: 'requestSignupCode' });
    } catch (e) {
      // 送れなかったときは待たせない（ただし、この間に別の送信で上書きされていたら触らない）
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.get('lastSentAt') === t) {
          tx.update(ref, { lastSentAt: 0, status: 'send_failed', updatedAt: now() });
        }
      }).catch(() => {});
      if (e instanceof HttpsError) throw e;
      console.error('[requestSignupCode] send failed', { to: maskEmail(email), message: e?.message || String(e) });
      throw new HttpsError('internal', 'メール送信に失敗しました');
    }

    console.log('[requestSignupCode] sent', { to: maskEmail(email), mode: account.state });
    return {
      ok: true,
      expiresAt: t + CODE_TTL_MS,
      resendAvailableAt: t + RESEND_COOLDOWN_MS,
      attemptsLeft: Math.max(0, EMAIL_MAX_FAILURES - (reserved.failCount || 0)),
      serverNow: t
    };
  }

  // ---- 2. コード確認 ----
  async function verifySignupCode(request) {
    const email = readEmail(request.data);
    const code = String(request.data?.code || '').trim();
    if (!/^\d{4}$/.test(code)) {
      throw new HttpsError('invalid-argument', '4桁の数字を入力してください');
    }
    const ref = db.collection(CODES).doc(emailKey(email));
    const t = now();

    // トランザクション内で throw すると失敗回数の加算まで取り消されるため、結果を返してから判定する
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { kind: 'missing' };
      const d = snap.data();
      // メールアドレス単位のロック（コードの状態より先に見る）
      const lock = lockState(d, t);
      if (lock.locked) return { kind: 'email-locked', lockedUntil: lock.lockedUntil };
      const reset = lock.expired ? { failCount: 0, lockedUntil: 0 } : {};
      const stale = (kind) => {
        if (lock.expired) tx.update(ref, { ...reset, updatedAt: t });
        return { kind };
      };
      if (!d.codeHash) return stale('missing');
      if (d.status === 'verified') return stale('used');
      if (d.status === 'locked') return stale('locked'); // 解除後は新しいコードが必要
      if (d.status !== 'pending') return stale('missing');
      if (!(Number(d.expiresAt) > t)) return stale('expired');
      const attempts = Number(d.attempts) || 0;
      if (attempts >= CODE_MAX_ATTEMPTS) {
        tx.update(ref, { ...reset, status: 'locked', updatedAt: t });
        return { kind: 'locked' };
      }
      if (safeEqualHex(hashCode(code, d.salt), d.codeHash)) {
        // 成功したら失敗の累計は0に戻す
        tx.update(ref, { status: 'verified', verifiedAt: t, updatedAt: t, failCount: 0, lockedUntil: 0 });
        return { kind: 'ok' };
      }
      const nextAttempts = attempts + 1;
      const nextFail = lock.failCount + 1;
      if (nextFail >= EMAIL_MAX_FAILURES) {
        const lockedUntil = t + EMAIL_LOCK_MS;
        tx.update(ref, { attempts: nextAttempts, failCount: nextFail, lockedUntil, status: 'locked', updatedAt: t });
        return { kind: 'email-locked', lockedUntil, justLocked: true };
      }
      const codeLocked = nextAttempts >= CODE_MAX_ATTEMPTS;
      tx.update(ref, { attempts: nextAttempts, failCount: nextFail, lockedUntil: 0, status: codeLocked ? 'locked' : 'pending', updatedAt: t });
      return {
        kind: codeLocked ? 'locked' : 'wrong',
        attemptsLeft: Math.min(CODE_MAX_ATTEMPTS - nextAttempts, EMAIL_MAX_FAILURES - nextFail)
      };
    });

    switch (result.kind) {
      case 'email-locked':
        if (result.justLocked) console.warn('[verifySignupCode] email locked', { to: maskEmail(email) });
        throw lockedError(result.lockedUntil, t);
      case 'missing':
      case 'used':
        throw new HttpsError('not-found', 'コードが見つかりません。「コードを再送信」から新しいコードを受け取ってください', { reason: result.kind });
      case 'expired':
        throw new HttpsError('deadline-exceeded', 'コードの有効期限（10分）が切れました。「コードを再送信」から新しいコードを受け取ってください', { reason: 'expired' });
      case 'locked':
        throw new HttpsError('failed-precondition', 'このコードは使えなくなりました。「コードを再送信」から新しいコードを受け取ってください', { reason: 'locked', attemptsLeft: 0 });
      case 'wrong':
        throw new HttpsError('invalid-argument', `コードが違います（あと${result.attemptsLeft}回）`, { reason: 'wrong', attemptsLeft: result.attemptsLeft });
      default:
        break;
    }

    // コードは本人のメール。ここでアカウントの状態を確かめてからチケットを出す
    const account = await classifyAccount(email);
    rejectByState(account.state);

    const ticket = crypto.randomBytes(32).toString('base64url');
    const ticketExpiresAt = t + TICKET_TTL_MS;
    await db.collection(TICKETS).doc(sha256Hex(ticket)).set({
      email,
      emailKey: emailKey(email),
      mode: account.state, // new | recover
      uid: account.user?.uid || null,
      status: 'active',
      createdAt: t,
      expiresAt: ticketExpiresAt
    });

    return {
      ok: true,
      ticket,
      ticketExpiresAt,
      mode: account.state,
      hasPassword: account.state === 'recover' ? await passwordHint(account.user) : 'none'
    };
  }

  /**
   * 口座が無ければ作る。あれば何もしない（上書き・初期化しない）。
   * users/{uid} を読み書きして同時実行を直列化し、口座の二重作成を防ぐ。
   */
  async function ensureParentFamily(uid, childName, { ticketRef = null } = {}) {
    const userRef = db.collection('users').doc(uid);
    const t = now();
    // 候補の同期IDを先に作っておく（トランザクションでは読み込みを書き込みより先にする）
    const candidates = Array.from({ length: 12 }, newFamilyCode);

    return db.runTransaction(async (tx) => {
      if (ticketRef) {
        const tSnap = await tx.get(ticketRef);
        if (!tSnap.exists || tSnap.get('status') !== 'active') {
          throw new HttpsError('failed-precondition', '登録の手続きはすでに完了しています。ログインしてください', { reason: 'ticket-used' });
        }
      }
      const existing = await findExistingFamily(uid, tx);
      const userSnap = await tx.get(userRef);
      let code = existing;
      let created = false;
      if (!code) {
        for (const c of candidates) {
          const famSnap = await tx.get(db.collection('families').doc(c));
          if (!famSnap.exists) { code = c; break; }
        }
        if (!code) throw new HttpsError('unavailable', '同期IDを作れませんでした。もう一度お試しください');
        tx.create(db.collection('families').doc(code), {
          parentUid: uid,
          childUids: [],
          childName,
          points: 0,
          stockCap: DEFAULT_STOCK_CAP,
          childLinked: false,
          createdAt: t
        });
        created = true;
      }
      // 口座を新しく作ったときだけ users を書く（既に口座がある正常なアカウントは一切書き換えない）。
      // users を読んで書くので、同時に2回呼ばれても片方が再試行になり、口座は1つだけになる。
      if (created) {
        if (!userSnap.exists) {
          tx.set(userRef, { role: 'parent', createdAt: t });
        } else {
          tx.update(userRef, { role: 'parent', familySetupAt: t });
        }
      }
      if (ticketRef) tx.update(ticketRef, { status: 'done', doneAt: t, uid });
      return { familyCode: code, created };
    });
  }

  function readProfile(data, { requirePassword = true } = {}) {
    const childName = String(data?.childName || '').trim();
    if (!childName) throw new HttpsError('invalid-argument', 'お子さまの名前を入力してください');
    if (childName.length > CHILD_NAME_MAX) {
      throw new HttpsError('invalid-argument', `お子さまの名前は${CHILD_NAME_MAX}文字以内にしてください`);
    }
    const password = String(data?.password || '');
    if (requirePassword) {
      if (password.length < PASSWORD_MIN) throw new HttpsError('invalid-argument', `パスワードは${PASSWORD_MIN}文字以上にしてください`);
      if (password.length > PASSWORD_MAX) throw new HttpsError('invalid-argument', 'パスワードが長すぎます');
    }
    return { childName, password };
  }

  // ---- 3. 登録完了（新規・復旧） ----
  async function completeParentSignup(request) {
    const email = readEmail(request.data);
    const ticket = String(request.data?.ticket || '');
    const { childName, password } = readProfile(request.data);
    if (!ticket) throw new HttpsError('invalid-argument', '登録の手続きをやり直してください');

    const ticketRef = db.collection(TICKETS).doc(sha256Hex(ticket));
    const tSnap = await ticketRef.get();
    const t = now();
    if (!tSnap.exists || tSnap.get('emailKey') !== emailKey(email)) {
      throw new HttpsError('permission-denied', '登録の手続きをやり直してください');
    }
    if (tSnap.get('status') !== 'active') {
      throw new HttpsError('failed-precondition', '登録の手続きはすでに完了しています。ログインしてください', { reason: 'ticket-used' });
    }
    if (!(Number(tSnap.get('expiresAt')) > t)) {
      throw new HttpsError('deadline-exceeded', '登録の有効時間（30分）が切れました。メールアドレスの入力からやり直してください', { reason: 'ticket-expired' });
    }

    // 最新の状態で判定し直す（チケット発行後に状態が変わっていても正常な口座は触らない）
    let account = await classifyAccount(email);
    if (account.state === 'complete') {
      await ticketRef.update({ status: 'done', doneAt: t, note: 'already-complete' }).catch(() => {});
      rejectByState('complete');
    }
    rejectByState(account.state);

    let uid;
    if (account.state === 'new') {
      try {
        const created = await adminAuth.createUser({ email, password, emailVerified: true });
        uid = created.uid;
      } catch (e) {
        if (e?.code !== 'auth/email-already-exists') throw mapAuthError(e);
        // 同時実行で先に作られた。状態を取り直して復旧側で続ける
        account = await classifyAccount(email);
        rejectByState(account.state);
        uid = account.user.uid;
        await adminAuth.updateUser(uid, { password, emailVerified: true }).catch((err) => { throw mapAuthError(err); });
      }
    } else {
      // 復旧: 口座が無いアカウントだけ。コードで本人確認済みなのでパスワードを（再）設定してよい
      uid = account.user.uid;
      await adminAuth.updateUser(uid, { password, emailVerified: true }).catch((err) => { throw mapAuthError(err); });
    }

    let result;
    try {
      result = await ensureParentFamily(uid, childName, { ticketRef });
    } catch (e) {
      // 同時送信などで、同じチケットの登録が先に完了していた場合は成功として返す
      if (e instanceof HttpsError && e.details?.reason === 'ticket-used') {
        const again = await ticketRef.get();
        const familyCode = again.get('uid') === uid ? await findExistingFamily(uid) : null;
        if (again.get('status') === 'done' && familyCode) {
          return { ok: true, mode: account.state, familyCode, created: false, alreadyDone: true };
        }
      }
      throw e;
    }
    await db.collection(CODES).doc(emailKey(email)).delete().catch(() => {});
    console.log('[completeParentSignup] done', { to: maskEmail(email), mode: account.state, created: result.created });
    return { ok: true, mode: account.state, familyCode: result.familyCode, created: result.created };
  }

  function mapAuthError(e) {
    if (e instanceof HttpsError) return e;
    const code = e?.code || '';
    if (code === 'auth/invalid-password') return new HttpsError('invalid-argument', `パスワードは${PASSWORD_MIN}文字以上にしてください`);
    if (code === 'auth/invalid-email') return new HttpsError('invalid-argument', 'メールアドレスの形式が正しくありません');
    console.error('[signup] auth error', code || e?.message || e);
    return new HttpsError('internal', '登録に失敗しました。もう一度お試しください');
  }

  // ---- ログイン済みで口座が無い親に、口座だけ作る ----
  async function createParentFamily(request) {
    const auth = request.auth;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'ログインが必要です');
    if (auth.token?.firebase?.sign_in_provider === 'anonymous' || !auth.token?.email) {
      throw new HttpsError('permission-denied', '親のアカウントでログインしてください');
    }
    if (auth.token.email_verified !== true) {
      throw new HttpsError('failed-precondition', 'メールアドレスの確認が済んでいません');
    }
    const { childName } = readProfile(request.data, { requirePassword: false });
    const result = await ensureParentFamily(auth.uid, childName);
    console.log('[createParentFamily] done', { to: maskEmail(auth.token.email), created: result.created });
    return { ok: true, familyCode: result.familyCode, created: result.created };
  }

  return { requestSignupCode, verifySignupCode, completeParentSignup, createParentFamily, ensureParentFamily, classifyAccount };
}

module.exports = {
  createSignupHandlers,
  buildCodeEmail,
  CODE_TTL_MS,
  CODE_MAX_ATTEMPTS,
  EMAIL_MAX_FAILURES,
  EMAIL_LOCK_MS,
  RESEND_COOLDOWN_MS,
  TICKET_TTL_MS
};
