// 先ほど作った firebase.js から db をインポート（読み込み）
import { db } from './firebase.js';
// 必要なFirestoreの機能をインポート
import { collection, addDoc, onSnapshot, query, where, updateDoc, doc, setDoc, getDoc, increment, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let investChartInstance = null; 

let state = {
  role: localStorage.getItem('chibiz_role'),
  familyCode: localStorage.getItem('chibiz_familyCode'),
  view: 'home',
  points: 0,
  tasks: [],
  tickets: [],
  investments: [],
  exchanges: []
};

const appDiv = document.getElementById('app');
const bottomNav = document.getElementById('bottom-nav');

// --- 便利関数群 ---
function getMarketRates() {
  const today = new Date();
  const rates = { 日本: [], アメリカ: [], labels: [] };
  for (let i = 12; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 15 * 86400000);
    rates.labels.push(`${d.getMonth()+1}/${d.getDate()}`);
    const day = Math.floor(d.getTime() / 86400000);
    const rateJp = 1.0 + Math.sin(day * 0.1) * 0.2 + Math.sin(day * 0.03) * 0.3; 
    const rateAm = 1.0 + Math.cos(day * 0.08) * 0.3 + Math.sin(day * 0.04) * 0.4;
    rates.日本.push(Math.max(0.1, rateJp)); 
    rates.アメリカ.push(Math.max(0.1, rateAm));
  }
  return rates;
}

function formatTimeLeft(deadlineTime) {
  if (!deadlineTime) return '<span class="text-slate-400">--</span>';
  const diff = deadlineTime - Date.now();
  if (diff < 0) return '<span class="text-red-500 font-bold">期限切れ</span>';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `あと${days}日`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours > 0) return `あと${hours}時間`;
  return `あと${Math.floor(diff / (1000 * 60))}分`;
}

// --- 画面の描画（UI）ロジック ---
window.setView = (viewName) => { state.view = viewName; render(); };

function render() {
  if (!state.role || !state.familyCode) {
    bottomNav.classList.add('hidden');
    renderSetup(); return;
  }

  bottomNav.classList.remove('hidden');
  bottomNav.innerHTML = `
    <div class="w-full h-full flex justify-around items-center">
      <button onclick="setView('home')" class="nav-circle ${state.view==='home'?'active':''}">ホーム</button>
      <button onclick="setView('tickets')" class="nav-circle ${state.view==='tickets'?'active':''}">チケット</button>
      <button onclick="setView('settings')" class="nav-circle ${state.view==='settings'?'active':''}">設定</button>
      <button onclick="setView('history')" class="nav-circle ${state.view==='history'?'active':''}">りれき</button>
    </div>
  `;

  let html = renderHeader();

  switch(state.view) {
    case 'home': html += renderHome(); break;
    default: 
      let content = '';
      if(state.view === 'propose') content = renderPropose();
      else if(state.view === 'taskCreate') content = renderTaskCreate();
      else if(state.view === 'exchange') content = renderExchange();
      else if(state.view === 'shop') content = renderShop();
      else if(state.view === 'invest') content = renderInvest();
      else if(state.view === 'tickets') content = renderTickets();
      else if(state.view === 'history') content = renderHistory();
      else if(state.view === 'settings') content = renderSettings();
      html += renderModal(content); 
      break;
  }

  appDiv.innerHTML = `<div class="h-full flex flex-col min-h-0 fade-in">${html}</div>`;

  if (state.view === 'home' || state.view === 'invest') {
    setTimeout(drawInvestChart, 50);
  }
}

function renderHeader() {
  return `
    <div class="flex-none p-3 pb-0">
      <div class="bg-[#1a1c23] text-white rounded-[12px] p-5 flex items-center justify-between shadow-md relative overflow-hidden h-[100px]">
        <div class="flex-1">
          <p class="text-[10px] text-slate-400 font-bold mb-1 tracking-widest">現在のポイント</p>
          <div class="flex items-baseline gap-1">
            <span class="text-4xl font-black font-mono tracking-tighter">${state.points.toLocaleString()}</span>
            <span class="text-sm font-bold text-slate-500">pt</span>
          </div>
        </div>
        <div class="w-px h-12 bg-slate-700 mx-4"></div>
        <div class="flex-1 text-right flex flex-col justify-center">
          <p class="text-[10px] text-slate-400 font-bold mb-1 tracking-widest">同期コード</p>
          <p class="text-xl font-mono font-black tracking-[0.1em] text-[#82aaff]">${state.familyCode}</p>
        </div>
      </div>
    </div>
  `;
}

function renderHome() {
  const activeTasks = state.tasks.filter(t => ['open', 'accepted', 'completed', 'proposed'].includes(t.status));
  const btn1 = state.role === 'child' ? { id: 'propose', label: '見積り' } : { id: 'taskCreate', label: '追加' };
  const btn2 = state.role === 'child' ? { id: 'exchange', label: '交換' } : { id: 'exchange', label: '承認' };
  
  return `
    <div class="flex-1 min-h-0 p-3">
      <div class="h-full grid grid-cols-[45fr_55fr] gap-3">
        <div class="grid grid-rows-[auto_1fr] gap-3 h-full min-h-0">
          <div class="grid grid-cols-2 gap-2 aspect-square">
            <button onclick="setView('${btn1.id}')" class="solid-btn"><span class="text-sm font-bold">${btn1.label}</span></button>
            <button onclick="setView('${btn2.id}')" class="solid-btn"><span class="text-sm font-bold">${btn2.label}</span></button>
            <button onclick="setView('shop')" class="solid-btn"><span class="text-sm font-bold">お店</span></button>
            <button onclick="setView('invest')" class="solid-btn"><span class="text-sm font-bold">かぶ</span></button>
          </div>
          <div class="solid-box relative min-h-0 flex flex-col cursor-pointer overflow-hidden" onclick="setView('invest')">
            <div class="absolute inset-0 p-1">
              <canvas id="investChart"></canvas>
            </div>
          </div>
        </div>

        <div class="solid-box flex flex-col min-h-0 relative">
          <div class="flex-none p-2 border-b-2 border-slate-800 flex justify-between items-end bg-slate-50 rounded-t-[6px]">
            <h2 class="text-lg font-black text-slate-800 tracking-widest">タスク</h2>
            <span class="text-[10px] font-bold text-slate-500">期日</span>
          </div>
          
          <div class="flex-1 overflow-y-auto p-2 space-y-2">
            ${activeTasks.length > 0 ? activeTasks.map(t => {
              const timeLeft = formatTimeLeft(t.deadline);
              let actionBtn = '';
              if (state.role === 'child') {
                if (t.status === 'open') actionBtn = `<button onclick="acceptTask('${t.id}')" class="bg-slate-800 text-white px-2 py-1 rounded text-[10px] font-bold shrink-0">受注</button>`;
                else if (t.status === 'accepted') actionBtn = `<button onclick="completeTask('${t.id}')" class="bg-blue-500 text-white px-2 py-1 rounded text-[10px] font-bold shrink-0">完了</button>`;
                else actionBtn = `<span class="text-[9px] text-slate-400 font-bold shrink-0">待機中</span>`;
              } else {
                if (t.status === 'completed') actionBtn = `<button onclick="approveTask('${t.id}', ${t.points})" class="bg-blue-500 text-white px-2 py-1 rounded text-[10px] font-bold shrink-0">付与</button>`;
                else if (t.status === 'proposed') actionBtn = `<button onclick="approveProposal('${t.id}')" class="bg-slate-800 text-white px-2 py-1 rounded text-[10px] font-bold shrink-0">承認</button>`;
                else actionBtn = `<span class="text-[9px] text-slate-400 font-bold shrink-0">未完了</span>`;
              }

              return `
                <div class="border-b border-slate-200 pb-2 flex flex-col gap-1">
                  <div class="flex justify-between items-start">
                    <span class="font-bold text-xs text-slate-800 leading-tight">・${t.title}</span>
                    <span class="text-[10px] font-bold text-slate-500 whitespace-nowrap ml-1">${timeLeft}</span>
                  </div>
                  <div class="flex justify-between items-center pl-2">
                    <span class="text-[10px] font-black text-blue-600">${t.points} pt</span>
                    ${actionBtn}
                  </div>
                </div>
              `;
            }).join('') : '<p class="text-center text-xs font-bold text-slate-400 mt-4">タスクなし</p>'}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderModal(content) {
  return `
    <div class="flex-1 min-h-0 flex items-center justify-center p-4 bg-slate-900/10 backdrop-blur-sm z-30 relative">
      <div class="solid-box w-full max-h-full flex flex-col relative shadow-2xl">
        <button onclick="setView('home')" class="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 font-bold text-slate-400 transition z-10">✕</button>
        <div class="flex-1 overflow-y-auto p-6 min-h-0">
          ${content}
        </div>
      </div>
    </div>
  `;
}

function renderPropose() {
  return `
    <h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">親に見積りを出す</h2>
    <input type="text" id="prop-title" placeholder="おてつだいのなまえ" class="w-full p-3 solid-box mb-4 font-bold text-sm" />
    <div class="flex items-center gap-2 mb-4">
      <input type="number" id="prop-points" placeholder="コイン" class="w-1/2 p-3 solid-box font-bold text-sm" />
      <span class="font-bold text-sm">pt</span>
    </div>
    <input type="datetime-local" id="prop-deadline" class="w-full p-3 solid-box mb-6 font-bold text-sm bg-slate-50" />
    <button onclick="proposeTask()" class="solid-btn w-full py-3 bg-slate-800 text-white font-bold">提案を送る</button>
  `;
}

function renderTaskCreate() {
  return `
    <h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">仕事を依頼する</h2>
    <input type="text" id="task-title" placeholder="仕事のタイトル" class="w-full p-3 solid-box mb-4 font-bold text-sm" />
    <div class="flex items-center gap-2 mb-4">
      <input type="number" id="task-points" placeholder="コイン" class="w-1/2 p-3 solid-box font-bold text-sm" />
      <span class="font-bold text-sm">pt</span>
    </div>
    <input type="datetime-local" id="task-deadline" class="w-full p-3 solid-box mb-6 font-bold text-sm bg-slate-50" />
    <button onclick="addTask()" class="solid-btn w-full py-3 bg-slate-800 text-white font-bold">依頼を追加</button>
  `;
}

function renderExchange() {
  const pending = state.exchanges.filter(e => e.status === 'pending');
  if (state.role === 'child') {
    return `
      <h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">現金と交換</h2>
      <div class="flex items-center gap-2 mb-6">
        <input type="number" id="exchange-amount" placeholder="金額" class="flex-1 p-3 solid-box font-bold text-lg text-right" />
        <span class="font-black text-lg">円</span>
      </div>
      <button onclick="requestExchange()" class="solid-btn w-full py-3 bg-slate-800 text-white font-bold mb-6">交換申請する</button>
      <div class="space-y-2">
        ${pending.map(e => `<div class="solid-box p-2 text-sm font-bold flex justify-between bg-slate-50"><span>${e.yen}円</span><span class="text-slate-500">承認待ち</span></div>`).join('')}
      </div>
    `;
  } else {
    return `
      <h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">交換の申請</h2>
      <div class="space-y-3">
        ${pending.length > 0 ? pending.map(e => `
          <div class="solid-box p-4 bg-slate-50">
            <p class="font-black text-lg mb-3">${e.yen}円 を要求しています</p>
            <div class="flex gap-2">
              <button onclick="approveExchange('${e.id}', ${e.points})" class="flex-1 solid-btn py-2 bg-slate-800 text-white font-bold text-sm">承認</button>
              <button onclick="rejectExchange('${e.id}')" class="flex-1 solid-btn py-2 font-bold text-sm text-red-500">却下</button>
            </div>
          </div>
        `).join('') : '<p class="text-sm font-bold text-slate-400 text-center">申請はありません</p>'}
      </div>
    `;
  }
}

function renderShop() {
  const tks = state.tickets.filter(t => t.status === 'available');
  if (state.role === 'child') {
    return `
      <h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">お店</h2>
      <div class="space-y-3">
        ${tks.length > 0 ? tks.map(t => `
          <div class="solid-box p-3 flex justify-between items-center bg-slate-50">
            <div><p class="font-bold text-sm">${t.title}</p><p class="text-xs font-black text-blue-600">${t.price} pt</p></div>
            <button onclick="buyTicket('${t.id}', ${t.price})" class="solid-btn px-3 py-1 text-xs font-bold bg-slate-800 text-white">買う</button>
          </div>
        `).join('') : '<p class="text-sm font-bold text-slate-400 text-center">空っぽです</p>'}
      </div>
    `;
  } else {
    return `
      <h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">お店の管理</h2>
      <div class="flex gap-2 mb-4">
        <input type="text" id="ticket-title" placeholder="商品名" class="flex-1 p-2 solid-box text-sm font-bold" />
        <input type="number" id="ticket-points" placeholder="pt" class="w-20 p-2 solid-box text-sm font-bold" />
      </div>
      <button onclick="addTicket()" class="solid-btn w-full py-2 bg-slate-800 text-white font-bold text-sm mb-6">出品する</button>
      <div class="space-y-2">
        ${tks.map(t => `
          <div class="solid-box p-2 flex justify-between items-center">
            <span class="text-sm font-bold">${t.title} <span class="text-blue-600 ml-1">${t.price}pt</span></span>
            <button onclick="deleteTicket('${t.id}')" class="text-xs font-bold text-red-500">削除</button>
          </div>
        `).join('')}
      </div>
    `;
  }
}

function renderInvest() {
  const rates = getMarketRates();
  return `
    <h2 class="text-xl font-black mb-3 border-b-2 border-slate-800 pb-2">かぶ(投資)</h2>
    <div class="solid-box w-full h-[120px] mb-4 relative p-1 bg-slate-50 shrink-0">
      <canvas id="investChart"></canvas>
    </div>
    ${state.role === 'child' ? `
      <div class="flex gap-2 mb-4 shrink-0">
        <input type="number" id="invest-amount" placeholder="pt" class="flex-1 p-2 solid-box text-sm font-bold" />
        <button onclick="investCustom('日本')" class="solid-btn px-3 text-xs font-bold bg-slate-800 text-white">日</button>
        <button onclick="investCustom('アメリカ')" class="solid-btn px-3 text-xs font-bold bg-slate-800 text-white">米</button>
      </div>
    ` : ''}
    <h3 class="font-bold text-sm mb-2 shrink-0">所持かぶ</h3>
    <div class="space-y-2">
      ${state.investments.length > 0 ? state.investments.map(inv => {
        const cur = inv.name === '日本' ? rates.日本[12] : rates.アメリカ[12];
        const val = Math.round((inv.shares || inv.investedPoints / cur) * cur);
        const isUp = val >= inv.investedPoints;
        return `
          <div class="solid-box p-3 bg-slate-50 flex justify-between items-center">
            <div>
              <p class="font-bold text-sm">${inv.name}</p>
              <p class="text-xs font-black ${isUp ? 'text-red-500' : 'text-blue-500'}">価値: ${val}pt</p>
            </div>
            ${state.role === 'child' ? `<button onclick="sellCustom('${inv.id}', '${inv.name}', ${val})" class="solid-btn px-3 py-1 text-xs font-bold bg-white">売る</button>` : ''}
          </div>
        `;
      }).join('') : '<p class="text-xs font-bold text-slate-400 text-center">何も持っていません</p>'}
    </div>
  `;
}

function renderTickets() {
  const ts = state.tickets.filter(t => t.status === 'bought');
  return `
    <h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">チケット</h2>
    <div class="space-y-3">
      ${ts.length > 0 ? ts.map(t => `
        <div class="solid-box p-4 bg-slate-800 text-white flex justify-between items-center">
          <span class="font-bold text-sm">${t.title}</span>
          ${state.role === 'parent' ? `<button onclick="useTicket('${t.id}')" class="solid-btn px-2 py-1 text-xs text-slate-800 bg-white">回収</button>` : `<span class="text-[10px] bg-white text-slate-800 px-2 py-1 rounded">所持中</span>`}
        </div>
      `).join('') : '<p class="text-sm font-bold text-slate-400 text-center">ありません</p>'}
    </div>
  `;
}

function renderHistory() {
  const approved = state.tasks.filter(t => t.status === 'approved');
  const total = approved.reduce((s, t) => s + t.points, 0);
  return `
    <h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">りれき</h2>
    <div class="solid-box p-4 bg-slate-50 text-center mb-6">
      <p class="text-xs font-bold text-slate-500">稼いだ合計</p>
      <p class="text-3xl font-black mt-1">${total.toLocaleString()} pt</p>
    </div>
    <div class="space-y-2">
      ${approved.map(t => `<div class="border-b border-slate-200 py-2 flex justify-between text-sm font-bold"><span>${t.title}</span><span class="text-slate-500">${t.points}pt</span></div>`).join('')}
    </div>
  `;
}

function renderSettings() {
  return `
    <h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">設定</h2>
    <div class="solid-box p-4 bg-slate-50 text-center mb-6">
      <p class="text-xs font-bold text-slate-500 mb-2">同期コード</p>
      <p class="text-2xl font-mono font-black text-blue-600">${state.familyCode}</p>
    </div>
    <button onclick="unlinkAccount()" class="solid-btn w-full py-3 border-red-500 text-red-500 font-bold">連携を解除する</button>
  `;
}

function renderSetup() {
  appDiv.innerHTML = `
    <div class="h-full flex flex-col items-center justify-center p-6 bg-slate-900">
      <h1 class="text-5xl font-black text-white mb-10 tracking-tighter">Chibiz<span class="text-blue-500">.</span></h1>
      <div class="w-full max-w-sm solid-box p-6 mb-6">
        <h3 class="font-bold text-slate-800 mb-4 text-center">親としてスタート</h3>
        <button id="btn-create-parent" class="solid-btn w-full py-3 bg-slate-800 text-white font-bold">コードを発行</button>
      </div>
      <div class="w-full max-w-sm solid-box p-6 bg-slate-50">
        <h3 class="font-bold text-slate-800 mb-4 text-center">子供としてスタート</h3>
        <input type="text" id="input-family-code" placeholder="コード" class="w-full p-3 solid-box rounded mb-4 text-center font-mono font-bold text-xl uppercase tracking-widest" />
        <button id="btn-join-child" class="solid-btn w-full py-3 bg-blue-500 text-white border-blue-600 font-bold">連携する</button>
      </div>
    </div>
  `;

  document.getElementById('btn-create-parent').addEventListener('click', async () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    await setDoc(doc(db, "families", code), { points: 0 });
    localStorage.setItem('chibiz_role', 'parent'); localStorage.setItem('chibiz_familyCode', code);
    state.role = 'parent'; state.familyCode = code; state.view = 'home'; setupListeners();
  });

  document.getElementById('btn-join-child').addEventListener('click', async () => {
    const code = document.getElementById('input-family-code').value.toUpperCase().trim();
    if (!code) return;
    const docSnap = await getDoc(doc(db, "families", code));
    if (docSnap.exists()) {
      localStorage.setItem('chibiz_role', 'child'); localStorage.setItem('chibiz_familyCode', code);
      state.role = 'child'; state.familyCode = code; state.view = 'home'; setupListeners();
    } else alert("コードが見つかりません。");
  });
}

function drawInvestChart() {
  const canvas = document.getElementById('investChart');
  if (!canvas) return; 
  
  const rates = getMarketRates();
  const ctx = canvas.getContext('2d');

  const jpInv = state.investments.find(i => i.name === '日本');
  const amInv = state.investments.find(i => i.name === 'アメリカ');
  const jpShares = jpInv ? (jpInv.shares || (jpInv.investedPoints / rates.日本[12])) : 0;
  const amShares = amInv ? (amInv.shares || (amInv.investedPoints / rates.アメリカ[12])) : 0;

  const showDemo = (!jpInv && !amInv);
  const datasetJp = showDemo ? rates.日本.map(r => Math.round(100 * r)) : rates.日本.map(r => Math.round(jpShares * r));
  const datasetAm = showDemo ? rates.アメリカ.map(r => Math.round(100 * r)) : rates.アメリカ.map(r => Math.round(amShares * r));

  if (investChartInstance) investChartInstance.destroy(); 

  investChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: rates.labels,
      datasets: [
        { data: datasetJp, borderColor: '#1e293b', borderWidth: 2, tension: 0.2, pointRadius: 0 },
        { data: datasetAm, borderColor: '#94a3b8', borderWidth: 2, borderDash: [4, 4], tension: 0.2, pointRadius: 0 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 0 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      layout: { padding: 5 }
    }
  });
}

// --- イベント＆データベース書き込みロジック ---
window.unlinkAccount = () => { if (confirm("連携を解除しますか？")) { localStorage.clear(); window.location.reload(); } };

window.addTask = async () => {
  const title = document.getElementById('task-title').value.trim();
  const points = parseInt(document.getElementById('task-points').value);
  const dlVal = document.getElementById('task-deadline').value;
  const deadline = dlVal ? new Date(dlVal).getTime() : null;
  if (!title || !points) return;
  await addDoc(collection(db, "tasks"), { familyCode: state.familyCode, title, points, deadline, status: 'open', createdAt: Date.now() });
  setView('home');
};

window.proposeTask = async () => {
  const title = document.getElementById('prop-title').value.trim();
  const points = parseInt(document.getElementById('prop-points').value);
  const dlVal = document.getElementById('prop-deadline').value;
  const deadline = dlVal ? new Date(dlVal).getTime() : null;
  if (!title || !points) return;
  await addDoc(collection(db, "tasks"), { familyCode: state.familyCode, title, points, deadline, status: 'proposed', createdAt: Date.now() });
  setView('home');
};

window.approveTask = async (id, points) => { await updateDoc(doc(db, "tasks", id), { status: 'approved' }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(points) }); };
window.approveProposal = async (id) => updateDoc(doc(db, "tasks", id), { status: 'open' });
window.acceptTask = async (id) => updateDoc(doc(db, "tasks", id), { status: 'accepted' });
window.completeTask = async (id) => updateDoc(doc(db, "tasks", id), { status: 'completed' });

window.addTicket = async () => {
  const title = document.getElementById('ticket-title').value.trim();
  const price = parseInt(document.getElementById('ticket-points').value);
  if (title && price > 0) {
    await addDoc(collection(db, "tickets"), { familyCode: state.familyCode, title, price, status: 'available', createdAt: Date.now() });
    setView('shop');
  }
};
window.deleteTicket = async (id) => deleteDoc(doc(db, "tickets", id));
window.buyTicket = async (id, price) => {
  if (state.points < price) return alert("コイン不足");
  await updateDoc(doc(db, "tickets", id), { status: 'bought' });
  await updateDoc(doc(db, "families", state.familyCode), { points: increment(-price) });
};
window.useTicket = async (id) => updateDoc(doc(db, "tickets", id), { status: 'used' });

window.investCustom = async (name) => {
  const amount = parseInt(document.getElementById('invest-amount').value);
  if (!amount || state.points < amount) return alert("コイン不足");
  const currentRate = name === '日本' ? getMarketRates().日本[12] : getMarketRates().アメリカ[12];
  await updateDoc(doc(db, "families", state.familyCode), { points: increment(-amount) });
  const existingInv = state.investments.find(inv => inv.name === name);
  if (existingInv) {
    await updateDoc(doc(db, "investments", existingInv.id), { investedPoints: increment(amount), shares: increment(amount / currentRate) });
  } else {
    await addDoc(collection(db, "investments"), { familyCode: state.familyCode, name, investedPoints: amount, shares: amount / currentRate, createdAt: Date.now() });
  }
  setView('invest');
};

window.sellCustom = async (id, name, val) => {
  await updateDoc(doc(db, "families", state.familyCode), { points: increment(val) });
  await deleteDoc(doc(db, "investments", id));
};

window.requestExchange = async () => {
  const amount = parseInt(document.getElementById('exchange-amount').value);
  if (!amount || state.points < amount) return alert("コイン不足");
  await addDoc(collection(db, "exchanges"), { familyCode: state.familyCode, points: amount, yen: amount, status: 'pending', createdAt: Date.now() });
  setView('home');
};

window.approveExchange = async (id, points) => {
  if (state.points < points) return alert("コイン不足");
  await updateDoc(doc(db, "families", state.familyCode), { points: increment(-points) });
  await updateDoc(doc(db, "exchanges", id), { status: 'approved' });
};
window.rejectExchange = async (id) => updateDoc(doc(db, "exchanges", id), { status: 'rejected' });

// --- Firebase の監視（リアルタイム同期） ---
function setupListeners() {
  if (!state.familyCode) return;
  onSnapshot(doc(db, "families", state.familyCode), (doc) => {
    if (doc.exists()) { state.points = doc.data().points || 0; render(); }
  });
  const watch = (colName, stateKey) => {
    const q = query(collection(db, colName), where("familyCode", "==", state.familyCode));
    onSnapshot(q, (snapshot) => {
      const arr = []; snapshot.forEach(d => arr.push({ id: d.id, ...d.data() }));
      arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      state[stateKey] = arr; render();
    });
  };
  watch("tasks", "tasks"); watch("tickets", "tickets"); watch("investments", "investments"); watch("exchanges", "exchanges");
}

if (state.familyCode) setupListeners(); else render();