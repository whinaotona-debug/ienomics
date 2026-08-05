import { state } from './state.js';
import { getIcon, rb, formatTimeLeft, getMarketRates } from './utils.js';
import { auth } from './firebase.js';
import { isSignInWithEmailLink } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const appDiv = document.getElementById('app');
const bottomNav = document.getElementById('bottom-nav');
let investChartInstance = null;

window.togglePassword = (inputId, eyeIconId) => {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(eyeIconId);
  if (input.type === 'password') { input.type = 'text'; icon.innerHTML = getIcon('eye-off'); }
  else { input.type = 'password'; icon.innerHTML = getIcon('eye'); }
};

export function render() {
  if (state.requirePasswordSetup) {
    bottomNav.classList.add('hidden');
    appDiv.innerHTML = `<div class="h-full flex flex-col min-h-0 fade-in relative">${renderPasswordSetup()}</div>`;
    return;
  }
  if (!state.role || !state.familyCode) {
    bottomNav.classList.add('hidden');
    if(!isSignInWithEmailLink(auth, window.location.href)) {
      appDiv.innerHTML = `<div class="h-full flex flex-col min-h-0 fade-in relative">${renderSetup()}</div>`;
    }
    return;
  }
  if (state.role === 'parent' && !state.childLinked) {
    bottomNav.classList.add('hidden');
    appDiv.innerHTML = `<div class="h-full flex flex-col min-h-0 fade-in relative">${renderWaitingChild()}</div>`;
    return;
  }

  bottomNav.classList.remove('hidden');
  bottomNav.innerHTML = `
    <div class="w-full h-full flex justify-around items-center bg-white shadow-[0_-5px_20px_rgba(0,0,0,0.02)] pb-2 pt-1">
      <button onclick="setView('home')" class="nav-tab ${state.view==='home'?'active':''}">${getIcon('home')}<span class="mt-0.5">ホーム</span></button>
      <button onclick="setView('tickets')" class="nav-tab ${state.view==='tickets'?'active':''}">${getIcon('ticket')}<span class="mt-0.5">チケット</span></button>
      <button onclick="setView('history')" class="nav-tab ${state.view==='history'?'active':''}">${getIcon('history')}<span class="mt-0.5">${rb('履歴','りれき')}</span></button>
      <button onclick="setView('settings')" class="nav-tab ${state.view==='settings'?'active':''}">${getIcon('settings')}<span class="mt-0.5">${rb('設定','せってい')}</span></button>
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
      else if(state.view === 'invest') content = renderInvest();
      else if(state.view === 'bank') content = renderBank();
      else if(state.view === 'calendar') content = renderCalendar();
      else if(state.view === 'balloonSend') content = renderBalloonSend();
      else if(state.view === 'tickets') content = renderTickets();
      else if(state.view === 'history') content = renderHistory();
      else if(state.view === 'settings') content = renderSettings();
      html += renderModal(content); 
      break;
  }

  if (state.role === 'child' && state.view === 'home' && state.balloons.length > 0) {
    const b = state.balloons[0];
    html += `
      <div class="absolute bottom-28 right-6 z-40 float-balloon" onclick="openBalloon('${b.id}', ${b.points}, '${b.message}')">
        <div class="w-16 h-16 rounded-full overflow-hidden shadow-lg bg-white flex items-center justify-center border border-slate-100">
          <img src="logo.png" class="w-full h-full object-cover" onerror="this.style.display='none';" />
          <span class="text-2xl text-pink-500">${getIcon('gift')}</span>
        </div>
      </div>
    `;
  }

  appDiv.innerHTML = `<div class="h-full flex flex-col min-h-0 fade-in relative">${html}</div>`;
  if (state.view === 'home' || state.view === 'invest') setTimeout(drawInvestChart, 50);
}

function renderHeader() {
  let nameTag = '';
  if (state.role === 'parent') {
    nameTag = `
      <select onchange="switchActiveChild(this.value)" class="bg-transparent text-[10px] text-slate-300 font-semibold tracking-[0.1em] outline-none appearance-none cursor-pointer hover:text-white transition">
        ${state.children.map(c => `<option value="${c.id}" ${c.id === state.familyCode ? 'selected' : ''} class="text-slate-800">${c.childName} の口座</option>`).join('')}
      </select>
      <button onclick="addNewChild()" class="text-[8px] bg-white/20 hover:bg-white/30 text-white px-2 py-0.5 rounded-full transition ml-1">＋追加</button>
    `;
  } else { nameTag = `<p class="text-[10px] text-slate-300 font-semibold tracking-[0.1em]">${state.childName} の${rb('資産','しさん')}</p>`; }

  return `
    <div class="flex-none p-3 pb-0">
      <div class="bg-slate-900 text-white rounded-[16px] p-5 flex items-center justify-between shadow-lg relative h-[105px] overflow-hidden">
        <img src="logo.png" class="absolute -right-8 -top-8 w-40 h-40 opacity-[0.08] object-cover pointer-events-none" onerror="this.style.display='none'" />
        <div class="flex-1 relative z-10">
          <div class="flex items-center gap-1.5 mb-1.5">
             <div class="w-4 h-4 rounded-full overflow-hidden bg-white/10 flex items-center justify-center">
               <img src="logo.png" class="w-full h-full object-cover" onerror="this.style.display='none'" />
             </div>
             ${nameTag}
          </div>
          <div class="flex items-baseline gap-1.5">
            <span class="text-4xl font-black tracking-tight">${state.points.toLocaleString()}</span>
            <span class="text-xs font-medium text-slate-400">pt</span>
          </div>
        </div>
        <div class="w-px h-10 bg-white/10 mx-5 relative z-10"></div>
        <div class="flex-1 text-right relative z-10 flex flex-col justify-center">
          <p class="text-[9px] text-slate-400 font-semibold mb-1 tracking-widest">${rb('同期','どうき')}ID</p>
          <p class="text-sm font-mono font-bold tracking-widest text-white/80">${state.familyCode}</p>
        </div>
      </div>
    </div>
  `;
}

function renderHome() {
  const activeTasks = state.tasks.filter(t => ['open', 'accepted', 'completed', 'proposed', 'rejected'].includes(t.status));
  const tJob = state.role === 'child' ? { id: 'propose', title: rb('報酬','ほうしゅう')+'を'+rb('提案','ていあん') } : { id: 'taskCreate', title: rb('仕事','しごと')+'の'+rb('発注','はっちゅう') };
  const tEx = state.role === 'child' ? rb('換金申請','かんきんしんせい') : rb('換金承認','かんきんしょうにん');

  let taskHtml = activeTasks.length > 0 ? activeTasks.map(t => {
    const timeTxt = formatTimeLeft(t.deadline);
    let btn = ''; let trashBtn = '';
    
    if (state.role === 'child') {
      if (t.status === 'open') {
        btn = `
          <div class="flex gap-1.5">
            <button onclick="rejectTask('${t.id}')" class="solid-btn px-2.5 py-1.5 text-[9px] font-bold text-slate-500 border-slate-200 bg-slate-50 hover:bg-slate-100">お断り</button>
            <button onclick="acceptTask('${t.id}')" class="solid-btn primary-btn px-3 py-1.5 text-[9px] font-bold shrink-0 shadow-sm">受注</button>
          </div>
        `;
      } else if (t.status === 'accepted') {
        btn = `<button onclick="completeTask('${t.id}')" class="solid-btn px-3 py-1.5 text-[9px] font-bold shrink-0 text-emerald-600 border-emerald-200 bg-emerald-50 hover:bg-emerald-100">完了</button>`;
      } else {
        btn = `<span class="text-[9px] text-slate-400 font-medium shrink-0">確認待ち</span>`;
      }
    } else {
      if (t.status === 'open' || t.status === 'rejected') {
        trashBtn = `<button onclick="deleteTask('${t.id}')" class="text-red-400 hover:text-red-600 w-4 h-4 shrink-0 transition">${getIcon('trash')}</button>`;
      }
      
      if (t.status === 'completed') {
        btn = `
          <div class="flex gap-1.5">
            <button onclick="returnTask('${t.id}')" class="solid-btn px-2.5 py-1.5 text-[9px] font-bold text-rose-500 border-rose-200 bg-rose-50 hover:bg-rose-100">やり直し</button>
            <button onclick="approveTask('${t.id}', ${t.points})" class="solid-btn primary-btn px-3 py-1.5 text-[9px] font-bold shrink-0 shadow-sm">付与</button>
          </div>
        `;
      } else if (t.status === 'rejected') {
        btn = `<span class="text-[9px] text-rose-500 font-bold shrink-0">お断りされました</span>`;
      } else if (t.status === 'proposed') {
        btn = `<button onclick="approveProposal('${t.id}')" class="solid-btn primary-btn px-3 py-1.5 text-[9px] font-bold shrink-0 shadow-sm">承認</button>`;
      } else {
        btn = `<span class="text-[9px] text-slate-400 font-medium shrink-0">進行中</span>`;
      }
    }
    
    return `
      <div class="p-3 flex flex-col gap-1.5 min-w-0 bg-white hover:bg-slate-50 rounded-xl transition border border-transparent hover:border-slate-100">
        <div class="flex justify-between items-center gap-2 min-w-0">
          <span class="font-bold text-xs text-slate-700 truncate flex-1">${t.title}</span>
          <div class="flex items-center gap-1.5">
            <span class="text-[9px] font-medium ${timeTxt.includes('切れ')?'text-red-500':'text-slate-400'} shrink-0">${timeTxt}</span>
            ${trashBtn}
          </div>
        </div>
        <div class="flex justify-between items-center mt-0.5">
          <span class="text-xs font-black text-slate-800 shrink-0">${t.points} <span class="text-[9px] font-semibold text-slate-400">pt</span></span>
          ${btn}
        </div>
      </div>
    `;
  }).join('') : `<div class="flex flex-col items-center justify-center h-full opacity-40"><div class="w-6 h-6 mb-2 text-slate-400">${getIcon('task')}</div><p class="text-[10px] font-bold text-slate-400">仕事はありません</p></div>`;

  return `
    <div class="flex-1 min-h-0 p-3">
      <div class="h-full grid grid-cols-[38fr_62fr] gap-3">
        <div class="flex flex-col gap-3 min-h-0 min-w-0">
          <div class="solid-box flex-1 p-2.5 space-y-3 overflow-y-auto">
            <div>
              <p class="text-[9px] font-bold text-slate-400 mb-1.5 ml-1 tracking-wider">${rb('仕事','しごと')}</p>
              <button onclick="setView('${tJob.id}')" class="solid-btn w-full py-3 hover:bg-slate-50 flex-row gap-2">
                <div class="w-4 h-4 text-slate-600">${getIcon('propose')}</div><span class="text-[9px] font-bold text-slate-700 mt-0.5">${tJob.title}</span>
              </button>
            </div>
            <div>
              <p class="text-[9px] font-bold text-slate-400 mb-1.5 ml-1 tracking-wider">${rb('管理','かんり')}</p>
              <div class="grid grid-cols-1 gap-2">
                <button onclick="setView('bank')" class="solid-btn py-2.5 flex-row gap-2 hover:bg-slate-50">
                  <div class="w-4 h-4 text-emerald-600">${getIcon('bank')}</div><span class="text-[10px] font-bold text-slate-700 mt-0.5">${rb('銀行','ぎんこう')}</span>
                </button>
                <button onclick="setView('invest')" class="solid-btn py-2.5 flex-row gap-2 hover:bg-slate-50">
                  <div class="w-4 h-4 text-purple-600">${getIcon('invest')}</div><span class="text-[10px] font-bold text-slate-700 mt-0.5">${rb('運用','うんよう')}</span>
                </button>
              </div>
            </div>
            <div>
              <p class="text-[9px] font-bold text-slate-400 mb-1.5 ml-1 tracking-wider">${rb('支出','ししゅつ')}</p>
              <div class="grid grid-cols-1 gap-2">
                <button onclick="setView('exchange')" class="solid-btn w-full py-2.5 flex-row gap-2 hover:bg-slate-50">
                  <div class="w-4 h-4 text-amber-500">${getIcon('exchange')}</div><span class="text-[10px] font-bold text-slate-700 mt-0.5">${tEx}</span>
                </button>
                <button onclick="setView('tickets')" class="solid-btn w-full py-2.5 flex-row gap-2 hover:bg-slate-50">
                  <div class="w-4 h-4 text-rose-500">${getIcon('ticket')}</div><span class="text-[10px] font-bold text-slate-700 mt-0.5">チケット</span>
                </button>
              </div>
            </div>
            ${state.role === 'parent' ? `
              <button onclick="setView('balloonSend')" class="solid-btn w-full py-2.5 mt-2 bg-slate-900 border-slate-900 text-white hover:bg-slate-800">
                <div class="flex items-center gap-1.5"><div class="w-3 h-3">${getIcon('gift')}</div><span class="text-[10px] font-bold">ギフト送信</span></div>
              </button>
            ` : ''}
          </div>
          <div class="solid-box h-[90px] relative p-1 cursor-pointer hover:bg-slate-50 transition" onclick="setView('invest')">
            <canvas id="investChart"></canvas>
          </div>
        </div>
        <div class="solid-box flex flex-col min-h-0 relative overflow-hidden min-w-0">
          <div class="flex-none p-3 border-b border-slate-100 flex justify-between items-center bg-white rounded-t-2xl">
            <h2 class="text-xs font-bold text-slate-800 flex items-center gap-1.5"><div class="w-3 h-3 text-slate-400">${getIcon('task')}</div>JOB LIST</h2>
            <button onclick="setView('calendar')" class="w-4 h-4 text-slate-400 hover:text-slate-800 transition">${getIcon('calendar')}</button>
          </div>
          <div class="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1">
            ${taskHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderModal(content) {
  return `
    <div class="flex-1 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-md z-30 absolute inset-0">
      <div class="solid-box w-full max-h-[90%] flex flex-col relative shadow-[0_20px_40px_rgba(0,0,0,0.08)] animate-in zoom-in-95 duration-200">
        <button onclick="setView('home')" class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-500 z-10 transition">✕</button>
        <div class="flex-1 overflow-y-auto p-6 min-h-0">
          ${content}
        </div>
      </div>
    </div>
  `;
}

function renderBank() {
  let totalDeposit = 0, totalInterest = 0;
  state.banks.forEach(b => {
    const months = (Date.now() - b.createdAt) / (1000 * 60 * 60 * 24 * 30);
    const interest = Math.floor(b.amount * (0.001 * months)); 
    totalDeposit += b.amount; totalInterest += interest;
  });
  const currentTotal = totalDeposit + totalInterest;
  return `
    <h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-4 h-4 text-emerald-500">${getIcon('bank')}</div>${rb('家庭内銀行','かていないぎんこう')}</h2>
    <div class="p-6 bg-slate-50 rounded-2xl text-center mb-6">
      <p class="text-[10px] font-bold text-slate-500 mb-1 tracking-widest">${rb('預金残高','よきんざんだか')}</p>
      <p class="text-4xl font-black text-slate-800 tracking-tight">${currentTotal.toLocaleString()} <span class="text-sm font-bold text-slate-400">pt</span></p>
      <p class="text-[9px] font-bold text-emerald-600 mt-3 inline-block px-3 py-1 rounded-full border border-emerald-100 bg-white">${rb('利息','りそく')}: +${totalInterest}pt (月0.1%)</p>
    </div>
    ${state.role === 'child' ? `<div class="flex gap-2 mb-4"><input type="number" id="bank-amount" placeholder="金額を入力" class="flex-1 p-3 bg-white border border-slate-200 rounded-xl font-bold text-sm focus:outline-none focus:border-slate-400 transition" /><button onclick="depositBank()" class="solid-btn primary-btn px-6 font-bold text-sm">預ける</button></div>${currentTotal > 0 ? `<button onclick="withdrawBank()" class="solid-btn w-full py-4 text-sm font-bold hover:bg-slate-50">全額引き出す</button>` : ''}` : `<p class="text-[10px] text-center font-bold text-slate-400">子供の預金資産です</p>`}
  `;
}

function renderInvest() {
  const rates = getMarketRates();
  return `
    <h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-4 h-4 text-purple-500">${getIcon('invest')}</div>${rb('資産運用','しさんうんよう')}</h2>
    <div class="w-full h-[180px] mb-6 relative p-1"><canvas id="investChart"></canvas></div>
    ${state.role === 'child' ? `<div class="flex gap-2 mb-6"><input type="number" id="invest-amount" placeholder="金額" class="flex-1 p-3 bg-white border border-slate-200 rounded-xl font-bold text-sm focus:outline-none" /><button onclick="investCustom('日本')" class="solid-btn px-4 bg-slate-100 hover:bg-slate-200 font-bold text-xs">日本株</button><button onclick="investCustom('アメリカ')" class="solid-btn px-4 bg-slate-100 hover:bg-slate-200 font-bold text-xs">米国株</button></div>` : ''}
    <div class="space-y-3">
      ${state.investments.length > 0 ? state.investments.map(inv => {
        const cur = inv.name === '日本' ? rates.日本[12] : rates.アメリカ[12];
        const val = Math.round((inv.shares || inv.investedPoints / cur) * cur);
        const diff = val - inv.investedPoints;
        const color = diff >= 0 ? 'text-emerald-500' : 'text-rose-500';
        return `<div class="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col gap-2"><div class="flex justify-between items-center"><span class="font-bold text-sm text-slate-700">${inv.name === '日本' ? '🇯🇵 日本株' : '🇺🇸 米国株'}</span><div class="text-right flex items-baseline gap-2"><span class="text-[10px] font-bold ${color}">${diff >= 0 ? '+' : ''}${diff}</span><span class="text-lg font-black text-slate-800">${val.toLocaleString()} <span class="text-[10px] font-bold text-slate-500">pt</span></span></div></div><div class="flex justify-between items-center text-[10px] font-bold text-slate-400"><span>購入額: ${inv.investedPoints} pt</span>${state.role === 'child' ? `<button onclick="sellCustom('${inv.id}', ${val})" class="text-slate-500 hover:text-slate-800 bg-white px-3 py-1.5 rounded border border-slate-200">売却する</button>` : ''}</div></div>`;
      }).join('') : `<p class="text-[10px] font-bold text-slate-400 text-center py-4">現在、運用中の資産はありません</p>`}
    </div>
  `;
}

function renderSettings() { 
  return `
    <h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-4 h-4 text-slate-400">${getIcon('settings')}</div>${rb('各種設定','かくしゅせってい')}</h2>
    <div class="p-6 bg-slate-50 rounded-2xl text-center mb-6 border border-slate-100">
      <p class="text-[9px] font-semibold text-slate-400 mb-2 tracking-widest">同期ID</p>
      <p class="text-2xl font-mono font-bold text-slate-800 tracking-widest">${state.familyCode}</p>
    </div>
    ${state.role==='child'?`
      <div class="p-4 bg-white rounded-xl mb-8 flex justify-between items-center cursor-pointer border border-slate-100" onclick="toggleFurigana()">
        <span class="font-bold text-sm text-slate-600">フリガナ(ルビ)表示</span>
        <div class="w-10 h-5 rounded-full flex items-center p-0.5 transition-colors duration-200 ${state.furigana?'bg-slate-800 justify-end':'bg-slate-200 justify-start'}">
          <div class="w-4 h-4 bg-white rounded-full shadow-sm"></div>
        </div>
      </div>
    `:''}
    <button onclick="unlinkAccount()" class="solid-btn w-full py-4 bg-white text-red-500 font-bold text-xs hover:bg-red-50">連携を解除する</button>
  `; 
}

export function drawInvestChart() {
  const canvas = document.getElementById('investChart'); if (!canvas) return;
  const rates = getMarketRates(); const ctx = canvas.getContext('2d');
  const jpInv = state.investments.find(i => i.name === '日本'), amInv = state.investments.find(i => i.name === 'アメリカ');
  const jpShares = jpInv ? (jpInv.shares || (jpInv.investedPoints / rates.日本[12])) : 0;
  const amShares = amInv ? (amInv.shares || (amInv.investedPoints / rates.アメリカ[12])) : 0;
  const datasetJp = (state.view==='invest'&&!jpInv&&!amInv) ? rates.日本.map(r => Math.round(100 * r)) : rates.日本.map(r => Math.round(jpShares * r));
  const datasetAm = (state.view==='invest'&&!jpInv&&!amInv) ? rates.アメリカ.map(r => Math.round(100 * r)) : rates.アメリカ.map(r => Math.round(amShares * r));
  if (investChartInstance) investChartInstance.destroy();
  const isDetail = state.view === 'invest';
  investChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: rates.labels,
      datasets: [
        { label: '日本', data: datasetJp, borderColor: '#334155', backgroundColor: 'rgba(51,65,85,0.05)', borderWidth: 1.5, tension: 0.3, pointRadius: isDetail?2:0, fill: isDetail },
        { label: '米国', data: datasetAm, borderColor: '#94a3b8', backgroundColor: 'rgba(148,163,184,0.05)', borderWidth: 1.5, borderDash: [4, 4], tension: 0.3, pointRadius: isDetail?2:0, fill: isDetail }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: isDetail, position: 'bottom', labels: { usePointStyle: true, boxWidth: 6, font: {size: 10} } }, tooltip: { enabled: isDetail, backgroundColor: 'rgba(15,23,42,0.9)', padding: 10, cornerRadius: 8 } },
      scales: { x: { display: isDetail, grid: {display: false}, ticks: { font: {size: 9}, color: '#94a3b8' } }, y: { display: isDetail, border:{dash:[4,4]}, grid: {color: '#f8fafc'}, ticks: { font: {size: 9}, color: '#94a3b8' } } },
      layout: { padding: isDetail ? 0 : 5 }
    }
  });
}

function renderBalloonSend() { return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-4 h-4 text-slate-800">${getIcon('gift')}</div>ギフト送信</h2><input type="number" id="balloon-points" placeholder="プレゼントするポイント" class="w-full p-3 bg-white border border-slate-200 rounded-xl mb-4 font-bold text-sm focus:outline-none focus:border-slate-400" /><textarea id="balloon-message" placeholder="メッセージを入力" class="w-full p-3 bg-white border border-slate-200 rounded-xl mb-6 font-bold text-sm h-24 resize-none focus:outline-none focus:border-slate-400"></textarea><button onclick="sendBalloon()" class="solid-btn primary-btn w-full py-4 font-bold">空へ放つ</button>`; }
function renderPropose() { return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800">${rb('報酬提案','ほうしゅうていあん')}</h2><input type="text" id="prop-title" placeholder="仕事の内容" class="w-full p-3 bg-white border border-slate-200 rounded-xl mb-4 font-bold text-sm focus:outline-none focus:border-slate-400" /><div class="flex items-center gap-3 mb-4"><input type="number" id="prop-points" placeholder="希望金額" class="w-1/2 p-3 bg-white border border-slate-200 rounded-xl font-bold text-sm focus:outline-none focus:border-slate-400" /><span class="font-bold text-sm text-slate-500">pt</span></div><input type="datetime-local" id="prop-deadline" class="w-full p-3 bg-white border border-slate-200 rounded-xl mb-6 font-bold text-sm text-slate-500 focus:outline-none focus:border-slate-400" /><button onclick="proposeTask()" class="solid-btn primary-btn w-full py-4 font-bold">提案を送信</button>`; }

function renderTaskCreate() { 
  return `
    <h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800">${rb('仕事発注','しごとはっちゅう')}</h2>
    <input type="text" id="task-title" placeholder="仕事の内容" class="w-full p-3 bg-white border border-slate-200 rounded-xl mb-4 font-bold text-sm focus:outline-none" />
    <div class="flex items-center gap-3 mb-4">
      <input type="number" id="task-points" placeholder="報酬金額" class="w-1/2 p-3 bg-white border border-slate-200 rounded-xl font-bold text-sm focus:outline-none" />
      <span class="font-bold text-sm text-slate-500">pt</span>
    </div>
    
    <div class="mb-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
      <label class="flex items-center gap-2 font-bold text-xs text-slate-600 cursor-pointer">
        <input type="checkbox" id="task-repeat-toggle" onchange="toggleRepeatUI()" class="rounded border-slate-300"> 🔁 定期的に繰り返して発注する
      </label>
      <div id="repeat-ui" class="hidden mt-4 space-y-4">
        <div class="flex gap-2">
          <button type="button" onclick="setRepeatType('weekly')" class="solid-btn flex-1 py-2 font-bold text-[10px]" id="btn-rep-weekly">曜日指定</button>
          <button type="button" onclick="setRepeatType('monthly')" class="solid-btn flex-1 py-2 font-bold text-[10px]" id="btn-rep-monthly">毎月指定</button>
        </div>
        <div id="weekly-select" class="hidden">
          <p class="text-[9px] font-bold text-slate-400 mb-2">発注する曜日を選択</p>
          <div class="flex gap-2 flex-wrap">
            ${['日','月','火','水','木','金','土'].map((w,i)=>`<label class="flex items-center gap-1 text-[10px] font-bold text-slate-600"><input type="checkbox" name="repeat-weeks" value="${i}"> ${w}</label>`).join('')}
          </div>
        </div>
        <div id="monthly-select" class="hidden">
          <p class="text-[9px] font-bold text-slate-400 mb-2">発注する日付を選択（1〜31日）</p>
          <select id="repeat-day-select" class="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none">
            ${Array.from({length:31},(_,i)=>`<option value="${i+1}">${i+1}日</option>`).join('')}
          </select>
        </div>
        <div>
          <p class="text-[9px] font-bold text-slate-400 mb-2">自動追加する時間</p>
          <input type="time" id="repeat-time" class="p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none" value="09:00">
        </div>
      </div>
    </div>

    <input type="datetime-local" id="task-deadline" class="w-full p-3 bg-white border border-slate-200 rounded-xl mb-6 font-bold text-sm text-slate-500 focus:outline-none" />
    <button onclick="addTask()" class="solid-btn primary-btn w-full py-4 font-bold">発注する</button>
  `; 
}

window.toggleRepeatUI = () => {
  const isRepeat = document.getElementById('task-repeat-toggle').checked;
  document.getElementById('repeat-ui').classList.toggle('hidden', !isRepeat);
  if (isRepeat) {
    setRepeatType('weekly'); 
  }
};
window.setRepeatType = (type) => {
  window.repeatType = type;
  const isWeekly = type === 'weekly';
  document.getElementById('weekly-select').classList.toggle('hidden', !isWeekly);
  document.getElementById('monthly-select').classList.toggle('hidden', isWeekly);
  document.getElementById('btn-rep-weekly').classList.toggle('primary-btn', isWeekly);
  document.getElementById('btn-rep-monthly').classList.toggle('primary-btn', !isWeekly);
};

function renderExchange() { const p = state.exchanges.filter(e => e.status === 'pending'); if (state.role === 'child') return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-4 h-4 text-amber-500">${getIcon('exchange')}</div>${rb('換金申請','かんきんしんせい')}</h2><div class="flex items-center gap-3 mb-6"><input type="number" id="exchange-amount" placeholder="金額" class="flex-1 p-4 bg-white border border-slate-200 rounded-xl font-black text-xl text-right focus:outline-none focus:border-slate-400" /><span class="font-bold text-sm text-slate-500">円</span></div><button onclick="requestExchange()" class="solid-btn primary-btn w-full py-4 font-bold mb-6">申請する</button><div class="space-y-2">${p.map(e => `<div class="p-3 rounded-xl text-sm font-bold flex justify-between bg-slate-50 border border-slate-100"><span class="text-slate-700">${e.yen} 円</span><span class="text-slate-400 text-[10px] bg-white px-2 py-1 rounded border border-slate-200">承認待ち</span></div>`).join('')}</div>`; else return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800">${rb('換金承認','かんきんしょうにん')}</h2><div class="space-y-3">${p.length>0?p.map(e=>`<div class="p-5 rounded-2xl bg-slate-50 border border-slate-100"><p class="font-black text-lg mb-4 text-slate-800">${e.yen}円 の申請</p><div class="flex gap-3"><button onclick="approveExchange('${e.id}', ${e.points})" class="flex-1 solid-btn primary-btn py-3 font-bold text-sm">承認する</button><button onclick="rejectExchange('${e.id}')" class="flex-1 solid-btn py-3 font-bold text-sm text-slate-500 hover:bg-slate-100">却下</button></div></div>`).join(''):`<div class="flex flex-col items-center justify-center py-10 opacity-40"><div class="w-8 h-8 mb-3 text-slate-400">${getIcon('exchange')}</div><p class="text-[10px] font-bold text-slate-400">現在、申請はありません</p></div>`}</div>`; }
function renderTickets() { const ts = state.tickets.filter(t => state.role === 'child' ? t.status === 'available' || t.status === 'bought' : true); return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-4 h-4 text-rose-500">${getIcon('ticket')}</div>チケット${state.role==='parent'?'管理':'購入'}</h2>${state.role==='parent'?'<div class="flex gap-2 mb-6"><input id="t-title" placeholder="品名" class="flex-1 p-3 bg-white border border-slate-200 rounded-xl text-sm font-bold focus:outline-none"/><input id="t-pts" type="number" placeholder="pt" class="w-24 p-3 bg-white border border-slate-200 rounded-xl text-sm font-bold focus:outline-none"/></div><button onclick="addTicket2()" class="solid-btn primary-btn w-full py-3 font-bold text-sm mb-6">追加する</button>':''}<div class="space-y-3">${ts.map(t=>{ let b = ''; if(state.role==='child'){ if(t.status==='available') b=`<button onclick="buyTicket('${t.id}',${t.price})" class="solid-btn primary-btn px-4 py-2 rounded-lg text-[10px] font-bold">購入</button>`; else b=`<span class="text-[9px] font-bold text-slate-400 bg-slate-100 px-3 py-1.5 rounded-md">所持中</span>`; } else { if(t.status==='available') b=`<button onclick="deleteTicket('${t.id}')" class="text-slate-400 hover:text-red-500 text-[10px] font-bold transition">削除</button>`; else if(t.status==='bought') b=`<button onclick="useTicket('${t.id}')" class="solid-btn primary-btn px-3 py-1.5 rounded-lg text-[10px] font-bold">使用済にする</button>`; else b=`<span class="text-[9px] text-slate-300 font-bold">使用済</span>`; } return `<div class="p-4 rounded-xl border ${t.status==='bought'?'bg-slate-50 border-slate-200':'bg-white border-slate-100'} flex justify-between items-center"><div><p class="font-bold text-sm text-slate-700">${t.title}</p><p class="text-[10px] font-bold mt-0.5 ${t.status==='bought'?'text-slate-400':'text-rose-500'}">${t.price} pt</p></div>${b}</div>`; }).join('')}</div>`; }
function renderHistory() { const app = state.tasks.filter(t => t.status === 'approved'); const t = app.reduce((s, t) => s + t.points, 0); return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-4 h-4 text-slate-400">${getIcon('history')}</div>${rb('資産履歴','しさんりれき')}</h2><div class="p-6 bg-slate-50 rounded-2xl text-center mb-6 border border-slate-100"><p class="text-[10px] font-semibold text-slate-400 mb-1 tracking-widest">獲得累計</p><p class="text-3xl font-black text-slate-800 tracking-tight">${t.toLocaleString()} <span class="text-[10px] font-bold text-slate-400">pt</span></p></div><div class="space-y-1">${app.map(t => `<div class="border-b border-slate-50 py-3 flex justify-between items-center text-xs font-bold"><span class="text-slate-600">${t.title}</span><span class="text-slate-800 bg-slate-100 px-2 py-1 rounded-md border border-slate-200">+${t.points} pt</span></div>`).join('')}</div>`; }
function renderCalendar() { const tasks = state.tasks.filter(t => t.deadline).sort((a, b) => a.deadline - b.deadline); return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-4 h-4 text-blue-500">${getIcon('calendar')}</div>${rb('月間予定','げっかんよてい')}</h2><div class="space-y-3">${tasks.length>0?tasks.map(t=>{ const d=new Date(t.deadline); return `<div class="p-4 bg-white border border-slate-100 rounded-xl flex justify-between items-center border-l-4 ${t.deadline<Date.now()?'border-l-slate-300':'border-l-blue-400'}"><span class="font-bold text-sm text-slate-700">${t.title}</span><span class="text-[10px] font-black bg-slate-50 px-2 py-1 rounded-md border border-slate-100 ${t.deadline<Date.now()?'text-slate-400':'text-slate-600'}">${d.getMonth()+1}/${d.getDate()}</span></div>`; }).join(''):`<div class="flex flex-col items-center justify-center py-10 opacity-40"><div class="w-8 h-8 mb-2 text-slate-300">${getIcon('calendar')}</div><p class="text-[10px] font-bold text-slate-400">予定はありません</p></div>`}</div>`; }
function renderPasswordSetup() { return `<div class="h-full flex flex-col items-center justify-center p-6 bg-slate-50 relative overflow-hidden"><img src="logo.png" class="absolute inset-0 w-full h-full object-cover opacity-5 pointer-events-none mix-blend-multiply" onerror="this.style.display='none'" /><div class="w-full max-w-sm bg-white p-8 rounded-3xl shadow-xl border border-slate-100 relative z-10 text-center animate-in zoom-in-95"><h3 class="font-black text-slate-800 mb-2 text-lg">パスワードを設定</h3><p class="text-[10px] font-bold text-slate-500 mb-6 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">次回以降のログインに使う<br>パスワードを決めてください。</p><div class="password-wrapper"><input type="password" id="new-password" placeholder="パスワード（6文字以上）" class="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm focus:outline-none focus:border-blue-400 focus:bg-white transition" /><div id="eye-new" class="password-eye" onclick="togglePassword('new-password', 'eye-new')">${getIcon('eye')}</div></div><div class="password-wrapper"><input type="password" id="new-password-confirm" placeholder="もう一度入力（確認用）" class="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm focus:outline-none focus:border-blue-400 focus:bg-white transition" /><div id="eye-confirm" class="password-eye" onclick="togglePassword('new-password-confirm', 'eye-confirm')">${getIcon('eye')}</div></div><button onclick="saveNewPassword()" class="solid-btn primary-btn w-full py-4 font-bold shadow-md shadow-blue-200">設定して開始</button></div></div>`; }
function renderWaitingChild() { return `<div class="h-full flex flex-col items-center justify-center p-6 bg-slate-50 relative overflow-hidden"><img src="logo.png" class="absolute inset-0 w-full h-full object-cover opacity-5 pointer-events-none mix-blend-multiply" onerror="this.style.display='none'" /><div class="w-full max-w-sm bg-white p-8 rounded-3xl shadow-xl border border-slate-100 relative z-10 text-center animate-in zoom-in-95"><h3 class="font-black text-slate-800 mb-2 text-lg">${state.childName} の連携待機中</h3><p class="text-[10px] font-bold text-slate-500 mb-6 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">子供の端末で「子供として開始」を選び、<br>以下の同期IDを入力してください。</p><div class="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl mb-6 font-mono font-black text-3xl tracking-widest text-slate-800">${state.familyCode}</div><div class="flex items-center justify-center gap-2 mb-6 text-xs font-bold text-slate-400 animate-pulse"><div class="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>子供の接続を待機中...</div>${state.children.length > 1 ? `<button onclick="switchActiveChild('${state.children.find(c=>c.id!==state.familyCode)?.id}')" class="text-[10px] text-blue-500 font-bold mb-4">別の子供の画面へ</button><br>` : ''}<button onclick="unlinkAccount()" class="text-[10px] text-slate-400 hover:text-red-500 font-bold underline">ログアウト</button></div></div>`; }

function renderSetup() {
  let content = '';
  
  if (state.isSending) {
    content = `<div class="w-full max-w-sm bg-white p-12 rounded-3xl shadow-xl border border-slate-100 text-center relative z-10"><div class="w-10 h-10 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-4"></div><p class="text-[10px] font-bold text-slate-500">通信中...</p></div>`;
  } else if (!state.setupMode) {
    content = `<div class="w-full max-w-sm bg-white p-8 rounded-3xl shadow-xl border border-slate-100 mb-6 relative z-10 text-center"><h3 class="font-black text-slate-800 mb-6 text-lg">どちらで始めますか？</h3><button onclick="setSetupMode('parent_select')" class="solid-btn primary-btn w-full py-4 font-bold mb-3 shadow-md">親として開始</button><button onclick="setSetupMode('child')" class="solid-btn w-full py-4 font-bold text-slate-600 hover:bg-slate-50">子供として開始</button></div>`;
  } else if (state.setupMode === 'parent_select') {
    content = `<div class="w-full max-w-sm bg-white p-8 rounded-3xl shadow-xl border border-slate-100 relative z-10"><button onclick="cancelSetup()" class="absolute top-4 left-4 text-slate-400 hover:text-slate-600 font-bold text-sm">◀ 戻る</button><h3 class="font-black text-slate-800 mb-6 text-center text-lg mt-4">親のアカウント設定</h3><button onclick="setSetupMode('parent_register')" class="solid-btn primary-btn w-full py-4 font-bold mb-3 shadow-md">新しく始める（メール認証）</button><button onclick="setSetupMode('parent_login')" class="solid-btn w-full py-4 font-bold text-slate-600 hover:bg-slate-50">既存のアカウントにログイン</button></div>`;
  } else if (state.setupMode === 'parent_register' && state.setupStep === 2) {
    content = `<div class="w-full max-w-sm bg-white p-8 rounded-3xl shadow-xl border border-slate-100 relative z-10 text-center"><div class="w-16 h-16 text-emerald-500 mx-auto mb-4"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg></div><h3 class="font-black text-slate-800 mb-4 text-lg">メールを送信しました</h3><p class="text-[10px] font-bold text-slate-500 mb-6 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">「${state.message}」宛に<br>登録用URLを送信しました。<br><br>メールアプリを開き、<br>リンクをクリックしてください。</p><p class="text-[10px] text-slate-400">※この画面は閉じて構いません</p></div>`;
  } else if (state.setupMode === 'parent_register') {
    content = `<div class="w-full max-w-sm bg-white p-8 rounded-3xl shadow-xl border border-slate-100 relative z-10"><button onclick="setSetupMode('parent_select')" class="absolute top-4 left-4 text-slate-400 hover:text-slate-600 font-bold text-sm">◀ 戻る</button><h3 class="font-black text-slate-800 mb-2 text-center text-lg mt-4">新規登録（親）</h3><p class="text-[10px] font-medium text-slate-400 text-center mb-6 leading-relaxed">入力したアドレスに認証リンクを送信します。<br>パスワードは認証後に設定します。</p><input type="email" id="setup-email" placeholder="メールアドレス" class="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl mb-6 font-bold text-sm focus:outline-none focus:border-slate-400 focus:bg-white transition" /><button onclick="sendRealEmailLink()" class="solid-btn primary-btn w-full py-4 font-bold shadow-md">認証メールを送信する</button></div>`;
  } else if (state.setupMode === 'parent_login') {
    content = `<div class="w-full max-w-sm bg-white p-8 rounded-3xl shadow-xl border border-slate-100 relative z-10"><button onclick="setSetupMode('parent_select')" class="absolute top-4 left-4 text-slate-400 hover:text-slate-600 font-bold text-sm">◀ 戻る</button><h3 class="font-black text-slate-800 mb-6 text-center text-lg mt-4">ログイン（親）</h3><input type="email" id="login-email" placeholder="メールアドレス" class="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl mb-3 font-bold text-sm focus:outline-none focus:border-slate-400 focus:bg-white transition" /><div class="password-wrapper"><input type="password" id="login-password" placeholder="パスワード" class="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm focus:outline-none focus:border-slate-400 focus:bg-white transition" /><div id="eye-login" class="password-eye" onclick="togglePassword('login-password', 'eye-login')">${getIcon('eye')}</div></div><button onclick="loginParent()" class="solid-btn primary-btn w-full py-4 font-bold shadow-md">ログイン</button></div>`;
  } else if (state.setupMode === 'child') {
    content = `<div class="w-full max-w-sm bg-white p-8 rounded-3xl shadow-xl border border-slate-100 relative z-10"><button onclick="cancelSetup()" class="absolute top-4 left-4 text-slate-400 hover:text-slate-600 font-bold text-sm">◀ 戻る</button><h3 class="font-black text-slate-800 mb-2 text-center text-lg mt-4">親の同期IDを入力</h3><p class="text-[10px] font-medium text-slate-400 text-center mb-6 leading-relaxed">親のアプリの設定画面にある<br>「同期ID」を入力して連携します。</p><input id="setup-family-code" placeholder="IDを入力" class="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl mb-6 text-center font-mono font-black text-2xl uppercase tracking-widest focus:outline-none focus:border-slate-400 focus:bg-white transition" /><button onclick="joinFamily()" class="solid-btn primary-btn w-full py-4 font-bold shadow-md">同期してスタート</button></div>`;
  }
  
  return `<div class="h-full flex flex-col items-center justify-center p-6 bg-slate-50 relative overflow-hidden"><img src="logo.png" class="absolute inset-0 w-full h-full object-cover opacity-5 pointer-events-none mix-blend-multiply" onerror="this.style.display='none'" /><div class="w-24 h-24 mb-8 rounded-full overflow-hidden bg-white shadow-[0_10px_30px_rgba(0,0,0,0.08)] flex items-center justify-center relative z-10 border border-slate-100"><img src="logo.png" class="w-full h-full object-cover" onerror="this.style.display='none'" /></div><h1 class="text-3xl font-black text-slate-800 mb-10 tracking-tighter relative z-10">イエノミクス</h1>${content}</div>`;
}