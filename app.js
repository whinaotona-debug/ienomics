import { state } from './state.js';
import { render } from './ui.js';
import { applyFuriganaState } from './utils.js';
import { db, auth } from './firebase.js'; 
import { collection, addDoc, onSnapshot, query, where, updateDoc, doc, setDoc, getDoc, increment, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithEmailAndPassword, signOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, updatePassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const APP_URL = "https://whinaotona-debug.github.io/tibiz/"; 
let unsubscribes = [];

// --- アプリの起動処理 ---
applyFuriganaState();

window.onload = async () => {
  if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = window.localStorage.getItem('emailForSignIn');
    if (!email) email = window.prompt('確認のため、もう一度メールアドレスを入力してください');
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
    } catch (error) {
      alert("エラーが発生しました: " + error.message);
      render();
    }
  } else {
    auth.onAuthStateChanged(async (user) => {
      if (state.role === 'parent') {
        if (user) {
          await runMigrationAndLoadChildren(user.uid);
        } else {
          localStorage.removeItem('ienomics_role');
          localStorage.removeItem('ienomics_familyCode');
          state.role = null; state.familyCode = null;
          render();
        }
      } else if (state.role === 'child' && state.familyCode) {
        setupListeners();
      } else {
        render();
      }
    });
  }
};

// --- 子供の切り替え・管理ロジック ---
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
      state.familyCode = null; state.childName = ''; state.points = 0; state.childLinked = false;
      render();
    }
  });
}

// データベースのリアルタイム通信
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

  const w = (c, k) => { 
    const unsub = onSnapshot(query(collection(db, c), where("familyCode", "==", state.familyCode)), (s) => { 
      const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); 
      a.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); state[k] = a; render(); 
    });
    unsubscribes.push(unsub);
  };
  w("tasks", "tasks"); w("tickets", "tickets"); w("investments", "investments"); w("exchanges", "exchanges"); w("banks", "banks"); w("balloons", "balloons");
}

// --- グローバル関数（HTMLから呼ばれるボタン操作など） ---
window.setView = (viewName) => { state.view = viewName; render(); };
window.setSetupMode = (mode) => { state.setupMode = mode; state.setupStep = 1; render(); };
window.cancelSetup = () => { state.setupMode = null; state.setupStep = 1; render(); };
window.switchActiveChild = (code) => { state.familyCode = code; localStorage.setItem('ienomics_familyCode', code); setupListeners(); };

window.toggleFurigana = () => {
  state.furigana = !state.furigana;
  localStorage.setItem('ienomics_furigana', state.furigana);
  applyFuriganaState();
  render();
};

// ログイン・登録関連
window.addNewChild = async () => {
  const name = prompt("追加するお子様の名前を入力してください（例：はなこ）");
  if (!name) return;
  const user = auth.currentUser;
  if (!user) return alert("エラー：ログインしていません");
  const c = Math.random().toString(36).substring(2, 8).toUpperCase(); 
  try {
    await setDoc(doc(db, "families", c), { parentUid: user.uid, childName: name, points: 0, childLinked: false, createdAt: Date.now() });
    alert(`「${name}」を登録しました！\n子供の端末で同期ID【 ${c} 】を入力してください。`);
    switchActiveChild(c);
  } catch (error) { alert("追加エラー: " + error.message); }
};
window.sendRealEmailLink = async () => { const email = document.getElementById('setup-email').value; if (!email.includes('@')) return alert('正しいメールアドレスを入力してください。'); state.isSending = true; render(); const actionCodeSettings = { url: APP_URL, handleCodeInApp: true }; try { await sendSignInLinkToEmail(auth, email, actionCodeSettings); window.localStorage.setItem('emailForSignIn', email); window.localStorage.setItem('tempSetupMode', 'parent'); state.isSending = false; state.message = email; state.setupStep = 2; render(); } catch (error) { state.isSending = false; render(); alert("エラーが発生しました: " + error.message); } };
window.loginParent = async () => { const email = document.getElementById('login-email').value; const pass = document.getElementById('login-password').value; if (!email || !pass) return alert('入力してください。'); state.isSending = true; render(); try { const userCredential = await signInWithEmailAndPassword(auth, email, pass); const uid = userCredential.user.uid; await runMigrationAndLoadChildren(uid); localStorage.setItem('ienomics_role', 'parent'); state.role = 'parent'; state.view = 'home'; state.isSending = false; } catch (error) { state.isSending = false; render(); alert("ログイン失敗: " + error.message); } };
window.joinFamily = async () => { const c = document.getElementById('setup-family-code').value.toUpperCase().trim(); if (!c) return; const s = await getDoc(doc(db, "families", c)); if (s.exists()) { await updateDoc(doc(db, "families", c), { childLinked: true }); localStorage.setItem('ienomics_role', 'child'); localStorage.setItem('ienomics_familyCode', c); state.role = 'child'; state.familyCode = c; state.view = 'home'; setupListeners(); } else { alert("同期IDが見つかりません。親のアプリでIDを確認してください。"); } };
window.unlinkAccount = async () => { if (confirm("ログアウトして最初に戻りますか？")) { await signOut(auth); localStorage.clear(); window.location.reload(); } };

// システムデータ操作関連（追加・削除など）
window.deleteTask = async (id) => { if(confirm("この発注を取り消しますか？")) { await deleteDoc(doc(db, "tasks", id)); setView('home'); } };
window.addTask = async () => { const t = document.getElementById('task-title').value, p = parseInt(document.getElementById('task-points').value), d = document.getElementById('task-deadline').value; if(t&&p) { await addDoc(collection(db, "tasks"), { familyCode: state.familyCode, title: t, points: p, deadline: d ? new Date(d).getTime() : null, status: 'open', createdAt: Date.now() }); setView('home'); } };
window.proposeTask = async () => { const t = document.getElementById('prop-title').value, p = parseInt(document.getElementById('prop-points').value), d = document.getElementById('prop-deadline').value; if(t&&p) { await addDoc(collection(db, "tasks"), { familyCode: state.familyCode, title: t, points: p, deadline: d ? new Date(d).getTime() : null, status: 'proposed', createdAt: Date.now() }); setView('home'); } };
window.approveTask = async (id, p) => { await updateDoc(doc(db, "tasks", id), { status: 'approved' }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) }); };
window.approveProposal = async (id) => updateDoc(doc(db, "tasks", id), { status: 'open' });
window.acceptTask = async (id) => updateDoc(doc(db, "tasks", id), { status: 'accepted' });
window.completeTask = async (id) => { await updateDoc(doc(db, "tasks", id), { status: 'completed' }); };
window.addTicket2 = async () => { const t = document.getElementById('t-title').value, p = parseInt(document.getElementById('t-pts').value); if(t&&p) await addDoc(collection(db, "tickets"), { familyCode: state.familyCode, title: t, price: p, status: 'available', createdAt: Date.now() }); };
window.deleteTicket = async (id) => deleteDoc(doc(db, "tickets", id));
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