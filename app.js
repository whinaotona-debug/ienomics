import { state } from './state.js?v=116';
import { render } from './ui.js?v=116';
import { applyFuriganaState, requestPushPermission, sendPushNotification, getTemplateIdFromTask, dateKeyToValue, getMarketRates } from './utils.js?v=116';
import { db, auth } from './firebase.js'; 
import { collection, addDoc, onSnapshot, query, where, updateDoc, doc, setDoc, getDoc, increment, deleteDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithEmailAndPassword, signOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, updatePassword, sendPasswordResetEmail, verifyPasswordResetCode, confirmPasswordReset } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const APP_URL = "https://whinaotona-debug.github.io/ienomics/index.html"; 
let unsubscribes = [];

// ★ 追加：今日追加したテンプレートのIDを記憶しておく箱（セッション中の一時記憶）
let generatedToday = {};
let deadlineTimer = null;
const DEADLINE_REMIND_MS = 60 * 60 * 1000; // 1時間前
const DEADLINE_CHECK_MS = 30 * 1000;

function getDeadlineNotifiedMap() {
  try {
    return JSON.parse(localStorage.getItem('ienomics_deadline_notified') || '{}');
  } catch {
    return {};
  }
}

function saveDeadlineNotifiedMap(map) {
  localStorage.setItem('ienomics_deadline_notified', JSON.stringify(map));
}

function checkDeadlineReminders() {
  if (!state.familyCode || !Array.isArray(state.tasks) || state.tasks.length === 0) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const now = Date.now();
  const notified = getDeadlineNotifiedMap();
  let changed = false;

  for (const t of state.tasks) {
    if (!t.deadline) continue;
    if (!['open', 'accepted'].includes(t.status)) continue;

    const remaining = t.deadline - now;
    // 期限切れは対象外。残り1時間以内になったら通知
    if (remaining <= 0 || remaining > DEADLINE_REMIND_MS) continue;
    // 同じ期限に対して二重通知しない
    if (notified[t.id] === t.deadline) continue;

    notified[t.id] = t.deadline;
    changed = true;

    const mins = Math.max(1, Math.ceil(remaining / 60000));
    const timeTxt = mins >= 60 ? 'あと1時間' : `あと約${mins}分`;
    if (state.role === 'child') {
      sendPushNotification("期限が近づいています！", `「${t.title}」の期限が${timeTxt}です。急ぎましょう！`);
    } else {
      sendPushNotification("期限アラーム", `「${t.title}」の期限が${timeTxt}です`);
    }
  }

  if (changed) saveDeadlineNotifiedMap(notified);
}

function startDeadlineWatcher() {
  stopDeadlineWatcher();
  requestPushPermission();
  checkDeadlineReminders();
  processScheduledPayments();
  cleanupExpiredDeadlineTasks();
  deadlineTimer = setInterval(() => {
    checkDeadlineReminders();
    processScheduledPayments();
    cleanupExpiredDeadlineTasks();
  }, DEADLINE_CHECK_MS);
}

function stopDeadlineWatcher() {
  if (deadlineTimer) {
    clearInterval(deadlineTimer);
    deadlineTimer = null;
  }
}

let isCleaningExpiredTasks = false;

/** 期限が切れた当日の仕事を、その日 23:59 以降に自動削除 */
async function cleanupExpiredDeadlineTasks() {
  if (state.role !== 'parent' || !state.familyCode || isCleaningExpiredTasks) return;
  if (!Array.isArray(state.tasks) || state.tasks.length === 0) return;

  const now = new Date();
  const nowMs = now.getTime();
  const targets = [];

  for (const t of state.tasks) {
    if (!t.deadline) continue;
    // 進行中・提案・お断りのみ（完了待ち・承認済みは残す）
    if (!['open', 'accepted', 'proposed', 'rejected', 'proposal_rejected'].includes(t.status)) continue;
    // まだ期限前
    if (t.deadline > nowMs) continue;

    const dl = new Date(t.deadline);
    // 期限日の 23:59:00
    const dayEnd = new Date(dl.getFullYear(), dl.getMonth(), dl.getDate(), 23, 59, 0, 0);
    if (nowMs < dayEnd.getTime()) continue;

    targets.push(t);
  }

  if (targets.length === 0) return;

  isCleaningExpiredTasks = true;
  try {
    for (const t of targets) {
      try {
        if (t.generatedKey) {
          generatedToday[t.generatedKey] = true;
          await updateDoc(doc(db, "tasks", t.id), {
            status: 'deleted',
            deletedAt: Date.now(),
            autoDeleted: true
          });
        } else {
          await deleteDoc(doc(db, "tasks", t.id));
        }
      } catch (err) {
        console.error("期限切れタスク削除エラー:", err);
      }
    }
  } finally {
    isCleaningExpiredTasks = false;
  }
}

let isProcessingPayments = false;

function isScheduledPaymentDue(p, now, todayStr) {
  if (!p || p.status !== 'active') return false;
  if (p.lastChargedKey === todayStr) return false;

  if (p.mode === 'once') {
    if (p.lastChargedKey) return false;
    return dateKeyToValue(todayStr) >= dateKeyToValue(p.dueDate);
  }

  // 定期
  if (p.interval === 'weekly') {
    return (p.days || []).includes(now.getDay());
  }
  if (p.interval === 'monthly') {
    return (p.days || []).includes(now.getDate());
  }
  return false;
}

async function processScheduledPayments() {
  if (!state.familyCode || isProcessingPayments) return;
  if (!Array.isArray(state.scheduledPayments) || state.scheduledPayments.length === 0) return;

  isProcessingPayments = true;
  const now = new Date();
  const todayStr = todayKeyString();

  try {
    for (const p of state.scheduledPayments) {
      if (!isScheduledPaymentDue(p, now, todayStr)) continue;

      const amount = Number(p.amount) || 0;
      if (amount <= 0) continue;

      const chargeId = `${p.id}_${todayStr}`;
      const chargeRef = doc(db, "paymentLogs", chargeId);
      const famRef = doc(db, "families", state.familyCode);
      const payRef = doc(db, "scheduledPayments", p.id);

      try {
        let charged = false;
        let wentNegative = false;

        await runTransaction(db, async (tx) => {
          const chargeSnap = await tx.get(chargeRef);
          if (chargeSnap.exists()) return;

          const famSnap = await tx.get(famRef);
          if (!famSnap.exists()) return;
          const pts = famSnap.data().points || 0;

          const paySnap = await tx.get(payRef);
          if (!paySnap.exists()) return;
          const payData = paySnap.data();
          if (payData.status !== 'active') return;
          if (payData.lastChargedKey === todayStr) return;

          const nextPts = pts - amount;
          wentNegative = nextPts < 0;

          tx.set(chargeRef, {
            familyCode: state.familyCode,
            paymentId: p.id,
            title: payData.title || p.title,
            amount,
            chargedAt: Date.now(),
            createdAt: Date.now(),
            wentNegative: wentNegative || undefined
          });
          tx.update(famRef, { points: nextPts });

          const updates = { lastChargedKey: todayStr };
          if (payData.mode === 'once') {
            updates.status = 'done';
          } else if (payData.countMode === 'finite') {
            const left = Math.max(0, (payData.remainingCount ?? 1) - 1);
            updates.remainingCount = left;
            if (left <= 0) updates.status = 'done';
          }
          tx.update(payRef, updates);
          charged = true;
        });

        if (charged) {
          if (wentNegative) {
            sendPushNotification(
              "支払い引落（残高不足）",
              `「${p.title}」 −${amount}pt。口座がマイナスになりました`
            );
          } else {
            sendPushNotification(
              "支払いが引き落とされました",
              `「${p.title}」 −${amount}pt`
            );
          }
        }
      } catch (err) {
        console.error("支払い処理エラー:", err);
      }
    }
  } finally {
    isProcessingPayments = false;
  }
}

applyFuriganaState();

window.onload = async () => {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const oobCode = params.get('oobCode');

  // パスワード再設定メールのリンクから戻ってきた場合
  if (mode === 'resetPassword' && oobCode) {
    try {
      await verifyPasswordResetCode(auth, oobCode);
      state.resetPasswordCode = oobCode;
      state.setupMode = 'password_reset_form';
      window.history.replaceState(null, null, window.location.pathname);
      render();
      return;
    } catch (error) {
      alert("パスワード再設定リンクが無効、または期限切れです。もう一度お試しください。");
      window.history.replaceState(null, null, window.location.pathname);
      state.setupMode = 'parent_forgot';
      render();
      return;
    }
  }

  if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = window.localStorage.getItem('emailForSignIn');
    if (!email) {
      email = window.prompt("セキュリティ確認のため、登録したメールアドレスをもう一度入力してください。");
    }
    if (!email) {
      alert("認証がキャンセルされました。");
      render(); return;
    }
    try {
      const result = await signInWithEmailLink(auth, email, window.location.href);
      window.localStorage.removeItem('emailForSignIn');
      const uid = result.user.uid;
      const userDoc = await getDoc(doc(db, "users", uid));
      
      if (!userDoc.exists()) {
        state.requirePasswordSetup = true;
        window.history.replaceState(null, null, window.location.pathname);
        render();
      } else {
        localStorage.setItem('ienomics_role', 'parent');
        state.role = 'parent'; state.view = 'home';
        window.history.replaceState(null, null, window.location.pathname);
        await runMigrationAndLoadChildren(uid);
      }
    } catch (error) { alert("エラー: " + error.message); render(); }
  } else {
    auth.onAuthStateChanged(async (user) => {
      if (state.role === 'parent') {
        if (user) { await runMigrationAndLoadChildren(user.uid); } 
        else {
          localStorage.removeItem('ienomics_role'); localStorage.removeItem('ienomics_familyCode');
          state.role = null; state.familyCode = null; render();
        }
      } else if (state.role === 'child' && state.familyCode) { setupListeners(); } 
      else { render(); }
    });
  }
};

async function runMigrationAndLoadChildren(uid) {
  const userDoc = await getDoc(doc(db, "users", uid));
  if (userDoc.exists() && userDoc.data().familyCode) {
    const oldCode = userDoc.data().familyCode;
    const familyDoc = await getDoc(doc(db, "families", oldCode));
    if (familyDoc.exists() && !familyDoc.data().parentUid) {
      await updateDoc(doc(db, "families", oldCode), { parentUid: uid, childName: "メイン口座" });
    }
  }
  loadParentChildren(uid);
}

function loadParentChildren(parentUid) {
  const q = query(collection(db, "families"), where("parentUid", "==", parentUid));
  if (window.unsubChildren) window.unsubChildren();
  window.unsubChildren = onSnapshot(q, (snapshot) => {
    const list = [];
    snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
    state.children = list.sort((a, b) => a.createdAt - b.createdAt);
    if (list.length > 0) {
      if (!list.some(c => c.id === state.familyCode)) state.familyCode = list[0].id;
      localStorage.setItem('ienomics_familyCode', state.familyCode);
      const activeChild = list.find(c => c.id === state.familyCode);
      state.childName = activeChild.childName;
      state.points = activeChild.points || 0;
      state.childLinked = activeChild.childLinked !== false;
      setupListeners();
    } else {
      state.familyCode = null; state.childName = ''; state.points = 0; state.childLinked = false; render();
    }
  });
}

// 繰り返し発注: 親端末のみ・確定ドキュメントID・論理削除で二重発注/削除増殖を防ぐ
let isGenerating = false;
let isDeduping = false;

function todayKeyString() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;
}

async function dedupeRepeatedTasks() {
  if (state.role !== 'parent' || isDeduping || !state.familyCode) return;
  const groups = {};
  for (const t of state.tasks) {
    if (!t.generatedKey || t.status === 'deleted') continue;
    if (!groups[t.generatedKey]) groups[t.generatedKey] = [];
    groups[t.generatedKey].push(t);
  }
  const extras = [];
  for (const key of Object.keys(groups)) {
    const list = groups[key].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (let i = 1; i < list.length; i++) extras.push(list[i]);
  }
  if (extras.length === 0) return;
  isDeduping = true;
  try {
    for (const t of extras) {
      await deleteDoc(doc(db, "tasks", t.id));
    }
  } catch (error) {
    console.error("重複タスク整理エラー:", error);
  } finally {
    isDeduping = false;
  }
}

async function checkAndGenerateRepeatedTasks() {
  // 子端末では作らない（親子同時書き込みの二重発注を防ぐ）
  if (state.role !== 'parent') return;
  if (!state.familyCode || !state.tasksReady || isGenerating) return;
  if (!state.taskTemplates || state.taskTemplates.length === 0) return;
  isGenerating = true;

  try {
    await dedupeRepeatedTasks();

    const now = new Date();
    const currentDay = now.getDay();
    const currentDate = now.getDate();
    const todayStr = todayKeyString();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 削除済みも含めてキーがあれば「今日は処理済み」（論理削除で再発注を防ぐ）
    const existingKeys = new Set(
      state.tasks.map(t => t.generatedKey).filter(Boolean)
    );

    for (const temp of state.taskTemplates) {
      const generatedKey = `rep_${temp.id}_${todayStr}`;

      if (generatedToday[generatedKey] || existingKeys.has(generatedKey)) {
        generatedToday[generatedKey] = true;
        continue;
      }

      // 確定IDのドキュメントが既にあればスキップ（他端末との競合対策）
      const taskRef = doc(db, "tasks", generatedKey);
      const existingDoc = await getDoc(taskRef);
      if (existingDoc.exists()) {
        generatedToday[generatedKey] = true;
        existingKeys.add(generatedKey);
        continue;
      }

      let shouldCreate = false;
      if (temp.type === 'weekly' && temp.days.includes(currentDay)) shouldCreate = true;
      if (temp.type === 'monthly' && temp.days.includes(currentDate)) shouldCreate = true;

      if (shouldCreate) {
        generatedToday[generatedKey] = true;
        existingKeys.add(generatedKey);

        const [hours, minutes] = temp.time.split(':').map(Number);
        const deadlineDate = new Date(todayStart);
        deadlineDate.setHours(hours, minutes, 0, 0);

        // addDoc禁止: 同じ generatedKey をドキュメントIDにして上書き合流させる
        await setDoc(taskRef, {
          familyCode: state.familyCode,
          title: temp.title,
          points: temp.points,
          status: 'open',
          generatedKey: generatedKey,
          templateId: temp.id,
          createdAt: Date.now(),
          deadline: deadlineDate.getTime()
        });
      }
    }
  } catch (error) {
    console.error("繰り返しタスク生成エラー:", error);
  } finally {
    isGenerating = false;
  }
}

function setupListeners() {
  if (!state.familyCode) return;
  
  unsubscribes.forEach(unsub => unsub()); 
  unsubscribes = [];
  state.tasksReady = false;
  state.isInitialLoad = true;
  startDeadlineWatcher();
  
  const unsubFamily = onSnapshot(doc(db, "families", state.familyCode), (d) => { 
    if (d.exists()) { 
      const data = d.data();
      state.points = data.points || 0; 
      state.childLinked = data.childLinked !== false; 
      if (state.role === 'child') state.childName = data.childName || 'こども'; 
      render(); 
    } else render();
  }, () => render());
  unsubscribes.push(unsubFamily);

  const unsubTemp = onSnapshot(query(collection(db, "taskTemplates"), where("familyCode", "==", state.familyCode)), (s) => {
    const list = []; s.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
    state.taskTemplates = list;
    checkAndGenerateRepeatedTasks(); 
  });
  unsubscribes.push(unsubTemp);

  const w = (c, k) => { 
    const unsub = onSnapshot(query(collection(db, c), where("familyCode", "==", state.familyCode)), (s) => { 
      const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); 
      a.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); 
      
      if (!state.isInitialLoad) {
        s.docChanges().forEach(change => {
          if (k !== "tasks") return;
          const t = change.doc.data();
          if (!t || t.status === 'deleted') return;
          const prev = state.tasks.find(x => x.id === change.doc.id);

          if (change.type === "added") {
            // 親が発注 → 子供へ
            if (state.role === 'child' && t.status === 'open') {
              sendPushNotification(
                "新しいお仕事！",
                `「${t.title}」（${t.points}pt）が発注されました！`
              );
            }
            // 子供が見積り → 親へ
            if (state.role === 'parent' && t.status === 'proposed') {
              const name = state.childName || 'こども';
              requestPushPermission();
              sendPushNotification(
                "見積りが届きました",
                `${name}ちゃんから「${t.title}」（希望 ${t.points}pt）`
              );
            }
          }

          if (change.type === "modified") {
            // 親が見積りを承認して発注状態に → 子供へ
            if (state.role === 'child' && t.status === 'open' && prev?.status === 'proposed') {
              sendPushNotification(
                "見積りが承認されました！",
                `「${t.title}」がお仕事として発注されました`
              );
            }
            // 親が見積りを却下 → 子供へ
            if (state.role === 'child' && t.status === 'proposal_rejected' && prev?.status === 'proposed') {
              sendPushNotification(
                "見積りが却下されました",
                `「${t.title}」の見積りは却下されました`
              );
            }
            // 子供が完了報告 → 親へ
            if (state.role === 'parent' && t.status === 'completed' && prev?.status !== 'completed') {
              sendPushNotification(
                "お仕事完了！",
                `${state.childName || 'こども'}ちゃんが「${t.title}」を完了しました！`
              );
            }
            // 親が差し戻し → 子供へ
            if (state.role === 'child' && t.status === 'accepted' && prev?.status === 'completed') {
              sendPushNotification(
                "やり直し指示",
                `「${t.title}」のやり直し（差し戻し）が届きました。`
              );
            }
            // 親が付与・承認 → 子供へ
            if (state.role === 'child' && t.status === 'approved' && prev?.status === 'completed') {
              sendPushNotification(
                "お仕事が承認されました！",
                `「${t.title}」で ${t.points}pt ゲット！`
              );
            }
          }
        });
      }
      
      state[k] = a; 
      if (k === "tasks") {
        const firstLoad = state.isInitialLoad;
        state.isInitialLoad = false;
        state.tasksReady = true;
        // 初回読込時のみ自動発注（削除のたびに再生成しない）
        if (firstLoad) checkAndGenerateRepeatedTasks();
        else dedupeRepeatedTasks();
        checkDeadlineReminders();
        cleanupExpiredDeadlineTasks();
      }
      if (k === "scheduledPayments") {
        processScheduledPayments();
      }
      render(); 
    });
    unsubscribes.push(unsub);
  };
  w("tasks", "tasks"); w("tickets", "tickets"); w("investments", "investments"); w("exchanges", "exchanges"); w("banks", "banks"); w("balloons", "balloons"); w("scheduledPayments", "scheduledPayments"); w("paymentLogs", "paymentLogs");
}

window.setView = (viewName) => {
  if (viewName !== 'templateEdit') state.editingTemplateId = null;
  if (viewName !== 'paymentEdit') state.editingPaymentId = null;
  state.view = viewName;
  render();
};
window.setSetupMode = (mode) => { state.setupMode = mode; state.setupStep = 1; render(); };
window.cancelSetup = () => { state.setupMode = null; state.setupStep = 1; render(); };

window.openTemplateEdit = (templateId) => {
  if (state.role !== 'parent') return;
  const temp = state.taskTemplates.find(t => t.id === templateId);
  if (!temp) return alert("この定期設定は見つかりません（すでに削除された可能性があります）");
  state.editingTemplateId = templateId;
  state.view = 'templateEdit';
  render();
};

function readRepeatFormDays() {
  const repeatType = window.repeatType || 'weekly';
  let days = [];
  if (repeatType === 'weekly') {
    document.querySelectorAll('input[name="repeat-weeks"]:checked').forEach(cb => days.push(parseInt(cb.value)));
  } else {
    days.push(parseInt(document.getElementById('repeat-day-select').value));
  }
  return { repeatType, days, time: document.getElementById('repeat-time').value || '19:00' };
}

window.updateTemplate = async () => {
  const id = state.editingTemplateId;
  if (!id) return;
  const title = document.getElementById('tmpl-title').value.trim();
  const points = parseInt(document.getElementById('tmpl-points').value);
  if (!title || !points) return alert("内容と報酬を入力してください");
  const { repeatType, days, time } = readRepeatFormDays();
  if (repeatType === 'weekly' && days.length === 0) return alert("曜日を1つ以上選んでください");

  try {
    await updateDoc(doc(db, "taskTemplates", id), {
      title, points, type: repeatType, days, time
    });

    // 今日すでに出ている未完了の定期ジョブも内容を揃える
    const [hours, minutes] = time.split(':').map(Number);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const deadlineDate = new Date(todayStart);
    deadlineDate.setHours(hours, minutes, 0, 0);

    for (const t of state.tasks) {
      const tid = getTemplateIdFromTask(t);
      if (tid !== id) continue;
      if (!['open', 'accepted', 'rejected'].includes(t.status)) continue;
      await updateDoc(doc(db, "tasks", t.id), {
        title, points, deadline: deadlineDate.getTime(), templateId: id
      });
    }

    state.editingTemplateId = null;
    setView('home');
    alert("定期発注を更新しました");
  } catch (error) {
    alert("更新できませんでした: " + error.message);
  }
};

window.deleteTemplate = async () => {
  const id = state.editingTemplateId;
  if (!id) return;
  if (!confirm("この定期発注を削除しますか？\n今後は自動で追加されなくなります。\n（今日すでに出ている仕事は残ります）")) return;
  try {
    await deleteDoc(doc(db, "taskTemplates", id));
    state.editingTemplateId = null;
    setView('home');
    alert("定期発注を削除しました");
  } catch (error) {
    alert("削除できませんでした: " + error.message);
  }
};

// ★ 修正：切り替えた時に「作ったよスタンプ」をリセットする
window.switchActiveChild = (code) => { 
  state.familyCode = code; 
  localStorage.setItem('ienomics_familyCode', code); 
  generatedToday = {}; // 別の子供に切り替えたらリセット
  setupListeners(); 
};

window.toggleFurigana = () => { state.furigana = !state.furigana; localStorage.setItem('ienomics_furigana', state.furigana); applyFuriganaState(); render(); };

window.addTask = async () => { 
  const t = document.getElementById('task-title').value;
  const p = parseInt(document.getElementById('task-points').value);
  const isRepeat = document.getElementById('task-repeat-toggle').checked;

  if (t && p) { 
    if (isRepeat) {
      const repeatType = window.repeatType || 'weekly';
      let days = [];
      if (repeatType === 'weekly') {
        const checked = document.querySelectorAll('input[name="repeat-weeks"]:checked');
        checked.forEach(cb => days.push(parseInt(cb.value)));
      } else {
        days.push(parseInt(document.getElementById('repeat-day-select').value));
      }
      const time = document.getElementById('repeat-time').value;

      await addDoc(collection(db, "taskTemplates"), {
        familyCode: state.familyCode, title: t, points: p, type: repeatType, days: days, time: time, createdAt: Date.now()
      });
      alert("繰り返し発注として保存しました！該当する日の0時に自動追加されます。");
    } else {
      const d = document.getElementById('task-deadline').value; 
      await addDoc(collection(db, "tasks"), { 
        familyCode: state.familyCode, title: t, points: p, deadline: d ? new Date(d).getTime() : null, status: 'open', createdAt: Date.now() 
      }); 
    }
    setView('home'); 
  } 
};

window.completeTask = async (id) => { 
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  let isExpired = false;
  if (task.deadline && Date.now() > task.deadline) {
    isExpired = true; 
  }
  await updateDoc(doc(db, "tasks", id), { 
    status: 'completed', 
    completedAt: Date.now(),
    isExpired: isExpired 
  }); 
};

window.approveTask = async (id, p) => { 
  await updateDoc(doc(db, "tasks", id), { status: 'approved', approvedAt: Date.now() }); 
  if (p > 0) {
    await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) }); 
  }
};

window.rejectTask = async (id) => { if (confirm("このお仕事をお断り（拒否）しますか？")) { await updateDoc(doc(db, "tasks", id), { status: 'rejected' }); } };
window.returnTask = async (id) => { if (confirm("やり直し（差し戻し）を指示しますか？")) { await updateDoc(doc(db, "tasks", id), { status: 'accepted', statusBefore: 'completed' }); } };
window.saveNewPassword = async () => {
  const pass = document.getElementById('new-password').value;
  const passConf = document.getElementById('new-password-confirm').value;
  if (pass.length < 6) return alert("パスワードは6文字以上にしてください。");
  if (pass !== passConf) return alert("パスワードが一致しません！");

  const childName = prompt("管理するお子様の名前を入力してください") || "こども";

  state.isSending = true;
  state.setupLoadingMessage = 'アカウントを準備しています...';
  render();

  try {
    const user = auth.currentUser;
    await updatePassword(user, pass);
    state.setupLoadingMessage = 'お子様の口座を作成しています...';
    render();
    await setDoc(doc(db, "users", user.uid), { role: 'parent' });
    await setDoc(doc(db, "families", Math.random().toString(36).substring(2, 8).toUpperCase()), {
      parentUid: user.uid,
      childName: childName,
      points: 0,
      childLinked: false,
      createdAt: Date.now()
    });
    state.requirePasswordSetup = false;
    state.isSending = false;
    state.setupLoadingMessage = '';
    state.role = 'parent';
    state.view = 'home';
    alert("設定完了！イエノミクスを開始します。");
    runMigrationAndLoadChildren(user.uid);
  } catch (error) {
    state.isSending = false;
    state.setupLoadingMessage = '';
    render();
    alert("エラー: " + error.message);
  }
};
window.proposeTask = async () => {
  const t = document.getElementById('prop-title').value;
  const p = parseInt(document.getElementById('prop-points').value);
  const d = document.getElementById('prop-deadline').value;
  if (t && p) {
    await addDoc(collection(db, "tasks"), {
      familyCode: state.familyCode,
      title: t,
      points: p,
      deadline: d ? new Date(d).getTime() : null,
      status: 'proposed',
      createdAt: Date.now()
    });
    setView('home');
  }
};
window.approveProposal = async (id) => updateDoc(doc(db, "tasks", id), { status: 'open' });
window.rejectProposal = async (id) => {
  if (!confirm("この見積りを却下しますか？")) return;
  await updateDoc(doc(db, "tasks", id), { status: 'proposal_rejected', rejectedAt: Date.now() });
};
window.acceptTask = async (id) => updateDoc(doc(db, "tasks", id), { status: 'accepted' });
window.addTicket2 = async () => { const t = document.getElementById('t-title').value, p = parseInt(document.getElementById('t-pts').value); if(t&&p) await addDoc(collection(db, "tickets"), { familyCode: state.familyCode, title: t, price: p, status: 'available', createdAt: Date.now() }); };
window.buyTicket = async (id, p) => { if (state.points < p) return alert("pt不足"); await updateDoc(doc(db, "tickets", id), { status: 'bought' }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-p) }); };
window.useTicket = async (id) => updateDoc(doc(db, "tickets", id), { status: 'used' });
window.sellCustom = async (id, v) => { if(confirm(`今の価値【${v}pt】で売却して、ポイントに戻しますか？`)) { await updateDoc(doc(db, "families", state.familyCode), { points: increment(v) }); await deleteDoc(doc(db, "investments", id)); setView('invest'); } };

window.investCustom = async (n) => { 
  if (state.points < 0) return alert("残高がマイナスのため、株の購入はできません。お手伝いでポイントを取り戻しましょう！");
  const valStr = document.getElementById('invest-amount').value;
  if (!valStr) return alert("投資する金額(pt)を入力してください");
  const a = parseInt(valStr); 
  if (isNaN(a) || a <= 0) return alert("正しい金額を入力してください");
  if (state.points < a) return alert(`ptが不足しています（所持: ${state.points}pt）`); 
  
  const r = n === 'japan' ? getMarketRates().日本[12] : getMarketRates().アメリカ[12]; 
  const dbName = n === 'japan' ? '日本' : 'アメリカ'; 
  
  await updateDoc(doc(db, "families", state.familyCode), { points: increment(-a) }); 
  const ex = state.investments.find(i => i.name === dbName); 
  if (ex) { 
    await updateDoc(doc(db, "investments", ex.id), { investedPoints: increment(a), shares: increment(a / r) }); 
  } else { 
    await addDoc(collection(db, "investments"), { familyCode: state.familyCode, name: dbName, investedPoints: a, shares: a / r, createdAt: Date.now() }); 
  } 
  setView('invest'); 
};

window.requestExchange = async () => {
  if (state.points < 0) return alert("残高がマイナスのため、換金申請はできません。お手伝いでポイントを取り戻しましょう！");
  const a = parseInt(document.getElementById('exchange-amount').value);
  if (!a || state.points < a) return alert("pt不足");
  await addDoc(collection(db, "exchanges"), { familyCode: state.familyCode, points: a, yen: a, status: 'pending', createdAt: Date.now() });
  setView('home');
};
window.approveExchange = async (id, p) => { if (state.points < p) return alert("pt不足"); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-p) }); await updateDoc(doc(db, "exchanges", id), { status: 'approved' }); };
window.rejectExchange = async (id) => updateDoc(doc(db, "exchanges", id), { status: 'rejected' });
window.depositBank = async () => { const a = parseInt(document.getElementById('bank-amount').value); if (!a || state.points < a) return alert("pt不足"); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-a) }); await addDoc(collection(db, "banks"), { familyCode: state.familyCode, amount: a, createdAt: Date.now() }); setView('bank'); };
window.withdrawBank = async () => { let t = 0; state.banks.forEach(b => { const m = (Date.now() - b.createdAt) / (1000*60*60*24*30); t += b.amount + Math.floor(b.amount * (0.001 * m)); deleteDoc(doc(db, "banks", b.id)); }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(t) }); setView('home'); alert(`${t}pt 引き出しました`); };
window.sendBalloon = async () => {
  const p = parseInt(document.getElementById('balloon-points').value);
  const m = document.getElementById('balloon-message').value;
  if (p) {
    await addDoc(collection(db, "balloons"), {
      familyCode: state.familyCode,
      points: p,
      message: m,
      status: 'unread',
      createdAt: Date.now()
    });
    alert('送りました');
    setView('home');
  }
};
window.openBalloon = async (id, p, m) => {
  alert(`ギフト到着！\n\n「${m || ''}」\n\nボーナス ${p} pt 獲得！`);
  await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) });
  await deleteDoc(doc(db, "balloons", id));
};
window.addNewChild = async () => { const name = prompt("追加するお子様の名前を入力してください"); if (!name) return; const user = auth.currentUser; if (!user) return alert("エラー：ログインしていません"); const c = Math.random().toString(36).substring(2, 8).toUpperCase(); try { await setDoc(doc(db, "families", c), { parentUid: user.uid, childName: name, points: 0, childLinked: false, createdAt: Date.now() }); alert(`「${name}」を登録しました！\n子供の端末で同期ID【 ${c} 】を入力してください。`); switchActiveChild(c); } catch (error) { alert("追加エラー: " + error.message); } };
window.unlinkAccount = async () => { if (confirm("連携を解除（またはログアウト）しますか？")) { try { await signOut(auth); } catch (e) {} localStorage.removeItem('ienomics_role'); localStorage.removeItem('ienomics_familyCode'); state.role = null; state.familyCode = null; state.children = []; if (window.unsubChildren) window.unsubChildren(); unsubscribes.forEach(unsub => unsub()); unsubscribes = []; stopDeadlineWatcher(); window.location.reload(); } };

window.deleteTask = async (id) => { 
  if (!confirm("このお仕事を削除しますか？")) return;
  try {
    const task = state.tasks.find(t => t.id === id);
    if (task?.generatedKey) {
      // 繰り返し発注分は論理削除（ドキュメントを残して今日の再発注を防ぐ）
      generatedToday[task.generatedKey] = true;
      await updateDoc(doc(db, "tasks", id), { status: 'deleted', deletedAt: Date.now() });
    } else {
      await deleteDoc(doc(db, "tasks", id));
    }
    setView('home');
  } catch (error) {
    alert("削除できませんでした: " + error.message);
  }
};

window.deleteTicket = async (id) => { if (confirm("このチケットを削除しますか？")) { await deleteDoc(doc(db, "tickets", id)); } };

window.openPaymentEdit = (id) => {
  if (state.role !== 'parent') return;
  const p = state.scheduledPayments.find(x => x.id === id);
  if (!p) return alert("支払い設定が見つかりません");
  state.editingPaymentId = id;
  state.view = 'paymentEdit';
  render();
};

window.togglePaymentModeUI = () => {
  const mode = document.querySelector('input[name="pay-mode"]:checked')?.value || 'once';
  document.getElementById('pay-once-ui')?.classList.toggle('hidden', mode !== 'once');
  document.getElementById('pay-repeat-ui')?.classList.toggle('hidden', mode !== 'repeat');
};

window.togglePaymentCountUI = () => {
  const mode = document.querySelector('input[name="pay-count-mode"]:checked')?.value || 'infinite';
  document.getElementById('pay-count-input-wrap')?.classList.toggle('hidden', mode !== 'finite');
};

window.setPayInterval = (type) => {
  window.payInterval = type;
  const isWeekly = type === 'weekly';
  document.getElementById('pay-weekly-select')?.classList.toggle('hidden', !isWeekly);
  document.getElementById('pay-monthly-select')?.classList.toggle('hidden', isWeekly);
  document.getElementById('btn-pay-weekly')?.classList.toggle('primary-btn', isWeekly);
  document.getElementById('btn-pay-monthly')?.classList.toggle('primary-btn', !isWeekly);
};

window.addScheduledPayment = async () => {
  if (state.role !== 'parent') return;
  const title = document.getElementById('pay-title')?.value.trim();
  const amount = parseInt(document.getElementById('pay-amount')?.value);
  if (!title) return alert("支払いの名目を入力してください");
  if (!amount || amount <= 0) return alert("正しい金額を入力してください");

  const mode = document.querySelector('input[name="pay-mode"]:checked')?.value || 'once';
  const data = {
    familyCode: state.familyCode,
    title,
    amount,
    mode,
    status: 'active',
    lastChargedKey: null,
    createdAt: Date.now()
  };

  if (mode === 'once') {
    const due = document.getElementById('pay-due-date')?.value;
    if (!due) return alert("引落日を選んでください");
    const d = new Date(due + 'T00:00:00');
    data.dueDate = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  } else {
    const interval = window.payInterval || 'monthly';
    let days = [];
    if (interval === 'weekly') {
      document.querySelectorAll('input[name="pay-weeks"]:checked').forEach(cb => days.push(parseInt(cb.value)));
      if (days.length === 0) return alert("曜日を1つ以上選んでください");
    } else {
      days.push(parseInt(document.getElementById('pay-day-select').value));
    }
    const countMode = document.querySelector('input[name="pay-count-mode"]:checked')?.value || 'infinite';
    data.interval = interval;
    data.days = days;
    data.countMode = countMode;
    if (countMode === 'finite') {
      const n = parseInt(document.getElementById('pay-count')?.value);
      if (!n || n < 1) return alert("回数は1以上にしてください");
      data.totalCount = n;
      data.remainingCount = n;
    } else {
      data.totalCount = null;
      data.remainingCount = null;
    }
  }

  try {
    await addDoc(collection(db, "scheduledPayments"), data);
    setView('payments');
    alert("支払いを設定しました");
    processScheduledPayments();
  } catch (error) {
    alert("設定できませんでした: " + error.message);
  }
};

window.updateScheduledPayment = async () => {
  if (state.role !== 'parent') return;
  const id = state.editingPaymentId;
  if (!id) return;
  const title = document.getElementById('pay-edit-title')?.value.trim();
  const amount = parseInt(document.getElementById('pay-edit-amount')?.value);
  if (!title) return alert("名目を入力してください");
  if (!amount || amount <= 0) return alert("正しい金額を入力してください");
  try {
    await updateDoc(doc(db, "scheduledPayments", id), { title, amount });
    state.editingPaymentId = null;
    setView('payments');
    alert("支払い設定を更新しました");
  } catch (error) {
    alert("更新できませんでした: " + error.message);
  }
};

window.deleteScheduledPayment = async (id) => {
  if (state.role !== 'parent') return;
  const targetId = id || state.editingPaymentId;
  if (!targetId) return;
  if (!confirm("この支払い設定を削除しますか？")) return;
  try {
    await deleteDoc(doc(db, "scheduledPayments", targetId));
    state.editingPaymentId = null;
    setView('payments');
  } catch (error) {
    alert("削除できませんでした: " + error.message);
  }
};

window.joinFamily = async () => { try { const emailInput = document.getElementById('setup-family-code'); if (!emailInput) return alert("システムエラー"); const code = emailInput.value.toUpperCase().trim(); if (!code) return alert("IDを入力してください"); const docRef = doc(db, "families", code); const docSnap = await getDoc(docRef); if (docSnap.exists()) { state.familyCode = code; state.role = 'child'; localStorage.setItem('ienomics_familyCode', code); localStorage.setItem('ienomics_role', 'child'); try { await updateDoc(docRef, { childLinked: true }); } catch (e) { } setupListeners(); render(); } else { alert("無効なIDです"); } } catch (error) { alert("エラー: " + error.message); } };
window.sendRealEmailLink = async () => { try { const emailInput = document.getElementById('setup-email'); if (!emailInput) return; const email = emailInput.value.trim(); if (!email) return alert("メールアドレスを入力してください"); state.isSending = true; render(); const actionCodeSettings = { url: APP_URL, handleCodeInApp: true }; await sendSignInLinkToEmail(auth, email, actionCodeSettings); window.localStorage.setItem('emailForSignIn', email); state.message = email; state.setupStep = 2; } catch (error) { alert("エラー: " + error.message); } finally { state.isSending = false; render(); } };

window.sendPasswordReset = async () => {
  try {
    const emailInput = document.getElementById('reset-email');
    if (!emailInput) return;
    const email = emailInput.value.trim();
    if (!email) return alert("メールアドレスを入力してください");
    state.isSending = true;
    render();
    const actionCodeSettings = { url: APP_URL, handleCodeInApp: true };
    await sendPasswordResetEmail(auth, email, actionCodeSettings);
    state.message = email;
    state.setupStep = 2;
  } catch (error) {
    const code = error?.code || '';
    if (code === 'auth/user-not-found') {
      alert("このメールアドレスのアカウントが見つかりません");
    } else if (code === 'auth/invalid-email') {
      alert("メールアドレスの形式が正しくありません");
    } else {
      alert("送信エラー: " + error.message);
    }
  } finally {
    state.isSending = false;
    render();
  }
};

window.submitPasswordReset = async () => {
  const code = state.resetPasswordCode;
  if (!code) return alert("再設定コードがありません。メールのリンクから再度開いてください。");
  const pass = document.getElementById('reset-new-password')?.value || '';
  const passConf = document.getElementById('reset-new-password-confirm')?.value || '';
  if (pass.length < 6) return alert("パスワードは6文字以上にしてください。");
  if (pass !== passConf) return alert("パスワードが一致しません！");
  try {
    state.isSending = true;
    render();
    await confirmPasswordReset(auth, code, pass);
    state.resetPasswordCode = null;
    state.setupMode = 'parent_login';
    state.setupStep = 1;
    state.message = '';
    alert("パスワードを変更しました。新しいパスワードでログインしてください。");
  } catch (error) {
    alert("再設定に失敗しました: " + (error.message || error));
  } finally {
    state.isSending = false;
    render();
  }
};

window.loginParent = async () => { try { const email = document.getElementById('login-email').value.trim(); const pass = document.getElementById('login-password').value; if (!email || !pass) return alert("メールアドレスとパスワードを入力してください"); state.isSending = true; render(); const result = await signInWithEmailAndPassword(auth, email, pass); state.role = 'parent'; localStorage.setItem('ienomics_role', 'parent'); await runMigrationAndLoadChildren(result.user.uid); } catch (error) { alert("ログイン失敗: パスワードまたはメールアドレスが違います"); } finally { state.isSending = false; render(); } };