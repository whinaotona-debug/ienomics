import { state } from './state.js';
import { render } from './ui.js';
import { applyFuriganaState, requestPushPermission, sendPushNotification } from './utils.js';
import { db, auth } from './firebase.js'; 
import { collection, addDoc, onSnapshot, query, where, updateDoc, doc, setDoc, getDoc, increment, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithEmailAndPassword, signOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, updatePassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const APP_URL = "https://whinaotona-debug.github.io/ienomics/index.html"; 
let unsubscribes = [];

applyFuriganaState();
// ★スマホで画面が開かなくなる原因になるため、起動時の通知許可はコメントアウトしています
// requestPushPermission(); 

window.onload = async () => {
  if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = window.localStorage.getItem('emailForSignIn');
    if (!email) {
      alert("エラー：メールを送信した時と同じブラウザ（Safariなど）で開いてください。");
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

async function checkAndGenerateRepeatedTasks() {
  if (!state.familyCode) return;
  const now = new Date();
  const currentDay = now.getDay(); 
  const currentDate = now.getDate(); 
  const currentHHMM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  state.taskTemplates.forEach(async (temp) => {
    if (currentHHMM < temp.time) return;
    const todayStr = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;
    const generatedKey = `rep_${temp.id}_${todayStr}`;
    const isAlreadyCreated = state.tasks.some(t => t.generatedKey === generatedKey);
    if (isAlreadyCreated) return;

    let shouldCreate = false;
    if (temp.type === 'weekly' && temp.days.includes(currentDay)) shouldCreate = true;
    if (temp.type === 'monthly' && temp.days.includes(currentDate)) shouldCreate = true;

    if (shouldCreate) {
      await addDoc(collection(db, "tasks"), {
        familyCode: state.familyCode,
        title: temp.title,
        points: temp.points,
        status: 'open',
        generatedKey: generatedKey,
        createdAt: Date.now(),
        deadline: null
      });
    }
  });
}

function setupListeners() {
  if (!state.familyCode) return;
  unsubscribes.forEach(unsub => unsub()); unsubscribes = []; 
  
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
            if (state.role === 'child' && t.status === 'open') {
              sendPushNotification("新しいお仕事！", `「${t.title}」が追加されました！`);
            }
          }
          if (change.type === "modified" && k === "tasks") {
            const t = change.doc.data();
            if (state.role === 'parent' && t.status === 'completed') {
              sendPushNotification("お仕事完了！", `${state.childName}ちゃんが「${t.title}」を完了しました！確認してください。`);
            }
            if (state.role === 'child' && t.status === 'accepted' && change.doc.data().statusBefore === 'completed') {
              sendPushNotification("やり直し指示", `「${t.title}」のやり直し（差し戻し）が届きました。`);
            }
          }
        });
      }
      
      state[k] = a; 
      if (k === "tasks") {
        state.isInitialLoad = false; 
        checkAndGenerateRepeatedTasks();
      }
      render(); 
    });
    unsubscribes.push(unsub);
  };
  w("tasks", "tasks"); w("tickets", "tickets"); w("investments", "investments"); w("exchanges", "exchanges"); w("banks", "banks"); w("balloons", "balloons");
}

window.setView = (viewName) => { state.view = viewName; render(); };
window.setSetupMode = (mode) => { state.setupMode = mode; state.setupStep = 1; render(); };
window.cancelSetup = () => { state.setupMode = null; state.setupStep = 1; render(); };
window.switchActiveChild = (code) => { state.familyCode = code; localStorage.setItem('ienomics_familyCode', code); setupListeners(); };
window.toggleFurigana = () => { state.furigana = !state.furigana; localStorage.setItem('ienomics_furigana', state.furigana); applyFuriganaState(); render(); };

window.addTask = async () => { 
  const t = document.getElementById('task-title').value;
  const p = parseInt(document.getElementById('task-points').value);
  const d = document.getElementById('task-deadline').value; 
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
      alert("繰り返し発注として保存しました！時間になると自動追加されます。");
    } else {
      await addDoc(collection(db, "tasks"), { 
        familyCode: state.familyCode, title: t, points: p, deadline: d ? new Date(d).getTime() : null, status: 'open', createdAt: Date.now() 
      }); 
    }
    setView('home'); 
  } 
};

window.rejectTask = async (id) => { if (confirm("このお仕事をお断り（拒否）しますか？")) { await updateDoc(doc(db, "tasks", id), { status: 'rejected' }); } };
window.returnTask = async (id) => { if (confirm("やり直し（差し戻し）を指示しますか？")) { await updateDoc(doc(db, "tasks", id), { status: 'accepted', statusBefore: 'completed' }); } };
window.saveNewPassword = async () => { const pass = document.getElementById('new-password').value, passConf = document.getElementById('new-password-confirm').value; if (pass.length < 6) return alert("パスワードは6文字以上にしてください。"); if (pass !== passConf) return alert("パスワードが一致しません！"); const childName = prompt("管理するお子様の名前を入力してください") || "こども"; try { const user = auth.currentUser; await updatePassword(user, pass); await setDoc(doc(db, "users", user.uid), { role: 'parent' }); await setDoc(doc(db, "families", Math.random().toString(36).substring(2, 8).toUpperCase()), { parentUid: user.uid, childName: childName, points: 0, childLinked: false, createdAt: Date.now() }); state.requirePasswordSetup = false; state.role = 'parent'; state.view = 'home'; alert("設定完了！イエノミクスを開始します。"); runMigrationAndLoadChildren(user.uid); } catch (error) { alert("エラー: " + error.message); } };
window.proposeTask = async () => { const t = document.getElementById('prop-title').value, p = parseInt(document.getElementById('prop-points').value), d = document.getElementById('prop-deadline').value; if(t&&p) { await addDoc(collection(db, "tasks"), { familyCode: state.familyCode, title: t, points: p, deadline: d ? new Date(d).getTime() : null, status: 'proposed', createdAt: Date.now() }); setView('home'); } };
window.approveTask = async (id, p) => { await updateDoc(doc(db, "tasks", id), { status: 'approved' }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) }); };
window.approveProposal = async (id) => updateDoc(doc(db, "tasks", id), { status: 'open' });
window.acceptTask = async (id) => updateDoc(doc(db, "tasks", id), { status: 'accepted' });
window.completeTask = async (id) => { await updateDoc(doc(db, "tasks", id), { status: 'completed' }); };
window.addTicket2 = async () => { const t = document.getElementById('t-title').value, p = parseInt(document.getElementById('t-pts').value); if(t&&p) await addDoc(collection(db, "tickets"), { familyCode: state.familyCode, title: t, price: p, status: 'available', createdAt: Date.now() }); };
window.buyTicket = async (id, p) => { if (state.points < p) return alert("pt不足"); await updateDoc(doc(db, "tickets", id), { status: 'bought' }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-p) }); };
window.useTicket = async (id) => updateDoc(doc(db, "tickets", id), { status: 'used' });
window.sellCustom = async (id, v) => { if(confirm(`今の価値【${v}pt】で売却して、ポイントに戻しますか？`)) { await updateDoc(doc(db, "families", state.familyCode), { points: increment(v) }); await deleteDoc(doc(db, "investments", id)); setView('invest'); } };
window.investCustom = async (n) => { const a = parseInt(document.getElementById('invest-amount').value); if (!a || state.points < a) return alert("pt不足"); const r = n === '日本' ? getMarketRates().日本[12] : getMarketRates().アメリカ[12]; await updateDoc(doc(db, "families", state.familyCode), { points: increment(-a) }); const ex = state.investments.find(i => i.name === n); if (ex) { await updateDoc(doc(db, "investments", ex.id), { investedPoints: increment(a), shares: increment(a / r) }); } else { await addDoc(collection(db, "investments"), { familyCode: state.familyCode, name: n, investedPoints: a, shares: a / r, createdAt: Date.now() }); } setView('invest'); };
window.requestExchange = async () => { const a = parseInt(document.getElementById('exchange-amount').value); if (!a || state.points < a) return alert("pt不足"); await addDoc(collection(db, "exchanges"), { familyCode: state.familyCode, points: a, yen: a, status: 'pending', createdAt: Date.now() }); setView('home'); };
window.approveExchange = async (id, p) => { if (state.points < p) return alert("pt不足"); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-p) }); await updateDoc(doc(db, "exchanges", id), { status: 'approved' }); };
window.rejectExchange = async (id) => updateDoc(doc(db, "exchanges", id), { status: 'rejected' });
window.depositBank = async () => { const a = parseInt(document.getElementById('bank-amount').value); if (!a || state.points < a) return alert("pt不足"); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-a) }); await addDoc(collection(db, "banks"), { familyCode: state.familyCode, amount: a, createdAt: Date.now() }); setView('bank'); };
window.withdrawBank = async () => { let t = 0; state.banks.forEach(b => { const m = (Date.now() - b.createdAt) / (1000*60*60*24*30); t += b.amount + Math.floor(b.amount * (0.001 * m)); deleteDoc(doc(db, "banks", b.id)); }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(t) }); setView('home'); alert(`${t}pt 引き出しました`); };
window.sendBalloon = async () => { const p = parseInt(document.getElementById('balloon-points').value), m = document.getElementById('balloon-message').value; if(p){ await addDoc(collection(db, "balloons"), { familyCode: state.familyCode, points: p, message: m, status: 'unread', createdAt: Date.now() }); alert('放ちました🎈'); setView('home'); } };
window.openBalloon = async (id, p, m) => { alert(`🎈ギフト到着！\n\n「${m}」\n\nボーナス ${p} pt 獲得！`); await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) }); await deleteDoc(doc(db, "balloons", id)); };
window.addNewChild = async () => { const name = prompt("追加するお子様の名前を入力してください"); if (!name) return; const user = auth.currentUser; if (!user) return alert("エラー：ログインしていません"); const c = Math.random().toString(36).substring(2, 8).toUpperCase(); try { await setDoc(doc(db, "families", c), { parentUid: user.uid, childName: name, points: 0, childLinked: false, createdAt: Date.now() }); alert(`「${name}」を登録しました！\n子供の端末で同期ID【 ${c} 】を入力してください。`); switchActiveChild(c); } catch (error) { alert("追加エラー: " + error.message); } };

// ==========================================
// ★ 欠落機能の補完＆エラー回避版の追加
// ==========================================

window.unlinkAccount = async () => {
  if (confirm("連携を解除（またはログアウト）しますか？")) {
    try { await signOut(auth); } catch (e) {}
    localStorage.removeItem('ienomics_role');
    localStorage.removeItem('ienomics_familyCode');
    state.role = null; state.familyCode = null; state.children = [];
    if (window.unsubChildren) window.unsubChildren();
    unsubscribes.forEach(unsub => unsub()); unsubscribes = [];
    window.location.reload(); 
  }
};

window.deleteTask = async (id) => {
  if (confirm("このお仕事を削除しますか？")) { await deleteDoc(doc(db, "tasks", id)); }
};
window.deleteTicket = async (id) => {
  if (confirm("このチケットを削除しますか？")) { await deleteDoc(doc(db, "tickets", id)); }
};

window.joinFamily = async () => {
  const code = document.getElementById('setup-family-code').value.toUpperCase().trim();
  if (!code) return alert("IDを入力してください");
  try {
    const docRef = doc(db, "families", code);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      state.familyCode = code; state.role = 'child';
      localStorage.setItem('ienomics_familyCode', code); localStorage.setItem('ienomics_role', 'child');
      try { await updateDoc(docRef, { childLinked: true }); } catch (e) { console.warn("通知スキップ"); }
      setupListeners(); render();
    } else {
      alert("無効なIDです。親の画面で確認してください。");
    }
  } catch (error) {
    alert("通信エラーが発生しました: " + error.message);
  }
};

window.sendRealEmailLink = async () => {
  const email = document.getElementById('setup-email').value;
  if (!email) return alert("メールアドレスを入力してください");
  state.isSending = true; render();
  try {
    const actionCodeSettings = { url: APP_URL, handleCodeInApp: true };
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem('emailForSignIn', email);
    state.message = email; state.setupStep = 2;
  } catch (error) { alert("エラー: " + error.message); } 
  finally { state.isSending = false; render(); }
};

window.loginParent = async () => {
  const email = document.getElementById('login-email').value;
  const pass = document.getElementById('login-password').value;
  if (!email || !pass) return alert("入力してください");
  state.isSending = true; render();
  try {
    const result = await signInWithEmailAndPassword(auth, email, pass);
    state.role = 'parent'; localStorage.setItem('ienomics_role', 'parent');
    await runMigrationAndLoadChildren(result.user.uid);
  } catch (error) { alert("ログイン失敗: パスワードまたはメールアドレスが違います"); } 
  finally { state.isSending = false; render(); }
};