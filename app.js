import { state } from './state.js?v=106';
import { render } from './ui.js?v=106';
import { applyFuriganaState, requestPushPermission, sendPushNotification, getTemplateIdFromTask } from './utils.js?v=106';
import { db, auth } from './firebase.js'; 
import { collection, addDoc, onSnapshot, query, where, updateDoc, doc, setDoc, getDoc, increment, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithEmailAndPassword, signOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, updatePassword, sendPasswordResetEmail, verifyPasswordResetCode, confirmPasswordReset } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const APP_URL = "https://whinaotona-debug.github.io/ienomics/index.html"; 
let unsubscribes = [];

// ★ 追加：今日追加したテンプレートのIDを記憶しておく箱（セッション中の一時記憶）
let generatedToday = {}; 

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
          if (change.type === "added" && k === "tasks") {
            const t = change.doc.data();
            if (t.status === 'deleted') return;
            if (state.role === 'child' && t.status === 'open') {
              sendPushNotification("新しいお仕事！", `「${t.title}」が追加されました！`);
            }
          }
          if (change.type === "modified" && k === "tasks") {
            const t = change.doc.data();
            if (state.role === 'parent' && t.status === 'completed') {
              sendPushNotification("お仕事完了！", `${state.childName}ちゃんが「${t.title}」を完了しました！`);
            }
            if (state.role === 'child' && t.status === 'accepted' && change.doc.data().statusBefore === 'completed') {
              sendPushNotification("やり直し指示", `「${t.title}」のやり直し（差し戻し）が届きました。`);
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
      }
      render(); 
    });
    unsubscribes.push(unsub);
  };
  w("tasks", "tasks"); w("tickets", "tickets"); w("investments", "investments"); w("exchanges", "exchanges"); w("banks", "banks"); w("balloons", "balloons");
}

window.setView = (viewName) => {
  if (viewName !== 'templateEdit') state.editingTemplateId = null;
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
  await updateDoc(doc(db, "tasks", id), { status: 'approved' }); 
  if (p > 0) {
    await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) }); 
  }
};

window.rejectTask = async (id) => { if (confirm("このお仕事をお断り（拒否）しますか？")) { await updateDoc(doc(db, "tasks", id), { status: 'rejected' }); } };
window.returnTask = async (id) => { if (confirm("やり直し（差し戻し）を指示しますか？")) { await updateDoc(doc(db, "tasks", id), { status: 'accepted', statusBefore: 'completed' }); } };
window.saveNewPassword = async () => { const pass = document.getElementById('new-password').value, passConf = document.getElementById('new-password-confirm').value; if (pass.length < 6) return alert("パスワードは6文字以上にしてください。"); if (pass !== passConf) return alert("パスワードが一致しません！"); const childName = prompt("管理するお子様の名前を入力してください") || "こども"; try { const user = auth.currentUser; await updatePassword(user, pass); await setDoc(doc(db, "users", user.uid), { role: 'parent' }); await setDoc(doc(db, "families", Math.random().toString(36).substring(2, 8).toUpperCase()), { parentUid: user.uid, childName: childName, points: 0, childLinked: false, createdAt: Date.now() }); state.requirePasswordSetup = false; state.role = 'parent'; state.view = 'home'; alert("設定完了！イエノミクスを開始します。"); runMigrationAndLoadChildren(user.uid); } catch (error) { alert("エラー: " + error.message); } };
window.proposeTask = async () => { const t = document.getElementById('prop-title').value, p = parseInt(document.getElementById('prop-points').value), d = document.getElementById('prop-deadline').value; if(t&&p) { await addDoc(collection(db, "tasks"), { familyCode: state.familyCode, title: t, points: p, deadline: d ? new Date(d).getTime() : null, status: 'proposed', createdAt: Date.now() }); setView('home'); } };
window.approveProposal = async (id) => updateDoc(doc(db, "tasks", id), { status: 'open' });
window.acceptTask = async (id) => updateDoc(doc(db, "tasks", id), { status: 'accepted' });
window.addTicket2 = async () => { const t = document.getElementById('t-title').value, p = parseInt(document.getElementById('t-pts').value); if(t&&p) await addDoc(collection(db, "tickets"), { familyCode: state.familyCode, title: t, price: p, status: 'available', createdAt: Date.now() }); };
window.buyTicket = async (id, p) => { if (state.points < p) return alert("pt不足"); await updateDoc(doc(db, "tickets", id), { status: 'bought' }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-p) }); };
window.useTicket = async (id) => updateDoc(doc(db, "tickets", id), { status: 'used' });
window.sellCustom = async (id, v) => { if(confirm(`今の価値【${v}pt】で売却して、ポイントに戻しますか？`)) { await updateDoc(doc(db, "families", state.familyCode), { points: increment(v) }); await deleteDoc(doc(db, "investments", id)); setView('invest'); } };

window.investCustom = async (n) => { 
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

window.requestExchange = async () => { const a = parseInt(document.getElementById('exchange-amount').value); if (!a || state.points < a) return alert("pt不足"); await addDoc(collection(db, "exchanges"), { familyCode: state.familyCode, points: a, yen: a, status: 'pending', createdAt: Date.now() }); setView('home'); };
window.approveExchange = async (id, p) => { if (state.points < p) return alert("pt不足"); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-p) }); await updateDoc(doc(db, "exchanges", id), { status: 'approved' }); };
window.rejectExchange = async (id) => updateDoc(doc(db, "exchanges", id), { status: 'rejected' });
window.depositBank = async () => { const a = parseInt(document.getElementById('bank-amount').value); if (!a || state.points < a) return alert("pt不足"); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-a) }); await addDoc(collection(db, "banks"), { familyCode: state.familyCode, amount: a, createdAt: Date.now() }); setView('bank'); };
window.withdrawBank = async () => { let t = 0; state.banks.forEach(b => { const m = (Date.now() - b.createdAt) / (1000*60*60*24*30); t += b.amount + Math.floor(b.amount * (0.001 * m)); deleteDoc(doc(db, "banks", b.id)); }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(t) }); setView('home'); alert(`${t}pt 引き出しました`); };
window.sendBalloon = async () => { const p = parseInt(document.getElementById('balloon-points').value), m = document.getElementById('balloon-message').value; if(p){ await addDoc(collection(db, "balloons"), { familyCode: state.familyCode, points: p, message: m, status: 'unread', createdAt: Date.now() }); alert('放ちました🎈'); setView('home'); } };
window.openBalloon = async (id, p, m) => { alert(`🎈ギフト到着！\n\n「${m}」\n\nボーナス ${p} pt 獲得！`); await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) }); await deleteDoc(doc(db, "balloons", id)); };
window.addNewChild = async () => { const name = prompt("追加するお子様の名前を入力してください"); if (!name) return; const user = auth.currentUser; if (!user) return alert("エラー：ログインしていません"); const c = Math.random().toString(36).substring(2, 8).toUpperCase(); try { await setDoc(doc(db, "families", c), { parentUid: user.uid, childName: name, points: 0, childLinked: false, createdAt: Date.now() }); alert(`「${name}」を登録しました！\n子供の端末で同期ID【 ${c} 】を入力してください。`); switchActiveChild(c); } catch (error) { alert("追加エラー: " + error.message); } };
window.unlinkAccount = async () => { if (confirm("連携を解除（またはログアウト）しますか？")) { try { await signOut(auth); } catch (e) {} localStorage.removeItem('ienomics_role'); localStorage.removeItem('ienomics_familyCode'); state.role = null; state.familyCode = null; state.children = []; if (window.unsubChildren) window.unsubChildren(); unsubscribes.forEach(unsub => unsub()); unsubscribes = []; window.location.reload(); } };

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