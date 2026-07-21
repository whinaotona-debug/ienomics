import { db } from './firebase.js';
import { collection, addDoc, onSnapshot, query, where, updateDoc, doc, setDoc, getDoc, increment, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let investChartInstance = null; 

let state = {
  role: localStorage.getItem('chibiz_role'),
  familyCode: localStorage.getItem('chibiz_familyCode'),
  furigana: localStorage.getItem('chibiz_furigana') === 'true',
  view: 'home',
  points: 0,
  tasks: [],
  tickets: [],
  investments: [],
  exchanges: [],
  banks: [],    
  balloons: []  
};

const appDiv = document.getElementById('app');
const bottomNav = document.getElementById('bottom-nav');

const rb = (kanji, kana) => `<ruby>${kanji}<rt>${kana}</rt></ruby>`;
if (state.furigana) document.body.classList.add('furigana-on');

window.toggleFurigana = () => {
  state.furigana = !state.furigana;
  localStorage.setItem('chibiz_furigana', state.furigana);
  document.body.classList.toggle('furigana-on', state.furigana);
  render();
};

function getIcon(name) {
  const icons = {
    'home': `<path d="M3 10l9-7 9 7v10a2 2 0 01-2 2H5a2 2 0 01-2-2V10z"/><path d="M9 21V12h6v9"/>`,
    'ticket': `<rect x="3" y="8" width="18" height="10" rx="2" ry="2"/><path d="M7 8v10M17 8v10M10 12l2 2 4-4"/>`,
    'settings': `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>`,
    'history': `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`,
    'propose': `<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>`,
    'exchange': `<circle cx="12" cy="12" r="10"/><path d="M16 12l-4-4-4 4M12 8v8"/>`,
    'invest': `<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>`,
    'bank': `<path d="M3 21h18M3 10h18M5 10v11M19 10v11M12 10v11M12 3L3 10h18l-9-7z"/>`,
    'task': `<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>`,
    'calendar': `<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><path d="M16 2v4M8 2v4M3 10h18"/>`,
    'balloon': `<path d="M12 2C9.24 2 7 4.24 7 7c0 3.31 2.5 5.5 5 7 .5.3.5.3 0 0 2.5-1.5 5-3.69 5-7 0-2.76-2.24-5-5-5z"/><path d="M12 14v7"/><path d="M10 21h4"/>`
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`;
}

function getMarketRates() {
  const today = new Date();
  const rates = { 日本: [], アメリカ: [], labels: [] };
  for (let i = 12; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 15 * 86400000);
    rates.labels.push(`${d.getMonth()+1}/${d.getDate()}`);
    const day = Math.floor(d.getTime() / 86400000);
    rates.日本.push(Math.max(0.1, 1.0 + Math.sin(day * 0.1) * 0.2 + Math.sin(day * 0.03) * 0.3)); 
    rates.アメリカ.push(Math.max(0.1, 1.0 + Math.cos(day * 0.08) * 0.3 + Math.sin(day * 0.04) * 0.4));
  }
  return rates;
}

window.setView = (viewName) => { state.view = viewName; render(); };

function render() {
  if (!state.role || !state.familyCode) {
    bottomNav.classList.add('hidden');
    renderSetup(); return;
  }
  bottomNav.classList.remove('hidden');
  bottomNav.innerHTML = `
    <div class="w-full h-full flex justify-around items-center bg-white shadow-[0_-5px_15px_rgba(0,0,0,0.03)] pb-2 pt-1">
      <button onclick="setView('home')" class="nav-tab ${state.view==='home'?'active':''}">${getIcon('home')}<span>${rb('家','ホーム')}</span></button>
      <button onclick="setView('tickets')" class="nav-tab ${state.view==='tickets'?'active':''}">${getIcon('ticket')}<span>チケット</span></button>
      <button onclick="setView('history')" class="nav-tab ${state.view==='history'?'active':''}">${getIcon('history')}<span>${rb('履歴','りれき')}</span></button>
      <button onclick="setView('settings')" class="nav-tab ${state.view==='settings'?'active':''}">${getIcon('settings')}<span>${rb('設定','せってい')}</span></button>
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
        <div class="w-20 h-20 rounded-full overflow-hidden shadow-[0_10px_25px_rgba(0,0,0,0.15)] bg-white flex items-center justify-center">
          <img src="logo.png" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
          <span style="display:none;" class="text-3xl text-pink-500">${getIcon('balloon')}</span>
        </div>
      </div>
    `;
  }

  appDiv.innerHTML = `<div class="h-full flex flex-col min-h-0 fade-in relative">${html}</div>`;
  if (state.view === 'home' || state.view === 'invest') setTimeout(drawInvestChart, 50);
}

function renderHeader() {
  return `
    <div class="flex-none p-3 pb-0">
      <div class="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl p-5 flex items-center justify-between shadow-[0_8px_20px_rgba(0,0,0,0.1)] relative h-[110px] overflow-hidden">
        <img src="logo.png" class="absolute -right-8 -top-8 w-40 h-40 opacity-[0.15] object-cover mix-blend-screen pointer-events-none" onerror="this.style.display='none'" />
        <div class="flex-1 relative z-10">
          <div class="flex items-center gap-2 mb-1.5">
             <div class="w-4 h-4 rounded-full overflow-hidden bg-white/20 flex items-center justify-center backdrop-blur-sm">
               <img src="logo.png" class="w-full h-full object-cover" onerror="this.style.display='none'" />
             </div>
             <p class="text-[10px] text-slate-300 font-semibold tracking-[0.15em]">イエノミクス ${rb('資産','しさん')}</p>
          </div>
          <div class="flex items-baseline gap-1.5">
            <span class="text-4xl font-black tracking-tight text-white">${state.points.toLocaleString()}</span>
            <span class="text-xs font-semibold text-slate-400">pt</span>
          </div>
        </div>
        <div class="w-px h-10 bg-white/10 mx-5 relative z-10"></div>
        <div class="flex-1 text-right relative z-10">
          <p class="text-[9px] text-slate-400 font-semibold mb-1.5 tracking-widest">${rb('同期','どうき')}ID</p>
          <p class="text-lg font-mono font-bold text-blue-300 tracking-wider bg-white/10 px-2 py-1 rounded-lg inline-block backdrop-blur-sm">${state.familyCode}</p>
        </div>
      </div>
    </div>
  `;
}

// ★ 左右のバランスを 1:1（半分ずつ）に修正しました！
function renderHome() {
  const activeTasks = state.tasks.filter(t => ['open', 'accepted', 'completed', 'proposed'].includes(t.status));
  const tJob = state.role === 'child' ? { id: 'propose', title: rb('報酬','ほうしゅう')+'を'+rb('提案','ていあん') } : { id: 'taskCreate', title: rb('仕事','しごと')+'の'+rb('発注','はっちゅう') };
  const tEx = state.role === 'child' ? rb('現金','げんきん')+'に'+rb('換金','かんきん') : rb('換金','かんきん')+rb('承認','しょうにん');

  return `
    <div class="flex-1 min-h-0 p-3">
      <!-- ここを grid-cols-2 (50:50) に変更してバランスを整えました -->
      <div class="h-full grid grid-cols-2 gap-3">
        
        <!-- 左側：洗練されたメニューボタン -->
        <div class="flex flex-col gap-3 min-h-0 min-w-0">
          <div class="solid-box flex-1 p-2.5 space-y-3 overflow-y-auto">
            <div>
              <p class="text-[9px] font-bold text-slate-400 mb-1.5 ml-1">${rb('仕事','しごと')}</p>
              <button onclick="setView('${tJob.id}')" class="solid-btn w-full py-2.5 bg-blue-50/50 hover:bg-blue-50 text-blue-600">
                <div class="w-5 h-5 mb-0.5">${getIcon('propose')}</div><span class="text-[9px] font-bold">${tJob.title}</span>
              </button>
            </div>
            
            <div>
              <p class="text-[9px] font-bold text-slate-400 mb-1.5 ml-1">${rb('管理','かんり')}</p>
              <div class="grid grid-cols-1 gap-2">
                <button onclick="setView('bank')" class="solid-btn py-2 flex-row gap-2 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-600">
                  <div class="w-4 h-4">${getIcon('bank')}</div><span class="text-[10px] font-bold">${rb('銀行','ぎんこう')}</span>
                </button>
                <button onclick="setView('invest')" class="solid-btn py-2 flex-row gap-2 bg-purple-50/50 hover:bg-purple-50 text-purple-600">
                  <div class="w-4 h-4">${getIcon('invest')}</div><span class="text-[10px] font-bold">${rb('運用','うんよう')}</span>
                </button>
              </div>
            </div>

            <div>
              <p class="text-[9px] font-bold text-slate-400 mb-1.5 ml-1">${rb('支出','ししゅつ')}</p>
              <div class="grid grid-cols-1 gap-2">
                <button onclick="setView('exchange')" class="solid-btn w-full py-2 flex-row gap-2 bg-amber-50/50 hover:bg-amber-50 text-amber-600">
                  <div class="w-4 h-4">${getIcon('exchange')}</div><span class="text-[10px] font-bold">${tEx}</span>
                </button>
                <button onclick="setView('tickets')" class="solid-btn w-full py-2 flex-row gap-2 bg-rose-50/50 hover:bg-rose-50 text-rose-600">
                  <div class="w-4 h-4">${getIcon('ticket')}</div><span class="text-[10px] font-bold">チケット</span>
                </button>
              </div>
            </div>

            ${state.role === 'parent' ? `
              <button onclick="setView('balloonSend')" class="solid-btn w-full py-2.5 bg-slate-800 text-white mt-2">
                <div class="flex items-center gap-1"><div class="w-3 h-3">${getIcon('balloon')}</div><span class="text-[10px] font-bold">ギフト送信</span></div>
              </button>
            ` : ''}
          </div>

          <div class="solid-box h-[100px] relative p-1 cursor-pointer" onclick="setView('invest')">
            <canvas id="investChart"></canvas>
          </div>
        </div>

        <!-- 右側：JOBリスト -->
        <div class="solid-box flex flex-col min-h-0 relative overflow-hidden min-w-0">
          <div class="flex-none p-3 border-b border-slate-100 flex justify-between items-center bg-white rounded-t-2xl">
            <h2 class="text-xs font-bold text-slate-800 flex items-center gap-1.5"><div class="w-4 h-4 text-slate-400">${getIcon('task')}</div>JOB LIST</h2>
            <button onclick="setView('calendar')" class="w-5 h-5 text-slate-400 hover:text-blue-500 transition">${getIcon('calendar')}</button>
          </div>
          
          <div class="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1">
            ${activeTasks.length > 0 ? activeTasks.map(t => {
              const diff = t.deadline ? t.deadline - Date.now() : null;
              const days = diff ? Math.floor(diff / (1000 * 60 * 60 * 24)) : null;
              const timeTxt = diff === null ? '--' : (diff < 0 ? '終了' : (days > 0 ? `あと${days}日` : '今日'));
              
              let btn = '';
              if (state.role === 'child') {
                if (t.status === 'open') btn = `<button onclick="acceptTask('${t.id}')" class="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shrink-0 shadow-sm">受注</button>`;
                else if (t.status === 'accepted') btn = `<button onclick="completeTask('${t.id}')" class="bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shrink-0 shadow-sm">完了</button>`;
                else btn = `<span class="text-[10px] text-slate-400 font-semibold shrink-0 bg-slate-50 px-2 py-1 rounded-md">待機</span>`;
              } else {
                if (t.status === 'completed') btn = `<button onclick="approveTask('${t.id}', ${t.points})" class="bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shrink-0 shadow-sm">付与</button>`;
                else if (t.status === 'proposed') btn = `<button onclick="approveProposal('${t.id}')" class="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shrink-0 shadow-sm">承認</button>`;
                else btn = `<span class="text-[10px] text-slate-400 font-semibold shrink-0 bg-slate-50 px-2 py-1 rounded-md">進行中</span>`;
              }
              return `
                <div class="p-2.5 flex flex-col gap-1 min-w-0 bg-white hover:bg-slate-50 rounded-xl transition">
                  <div class="flex justify-between items-center gap-2 min-w-0">
                    <span class="font-bold text-xs text-slate-700 truncate flex-1">${t.title}</span>
                    <span class="text-[10px] font-semibold text-slate-400 shrink-0">${timeTxt}</span>
                  </div>
                  <div class="flex justify-between items-center mt-0.5">
                    <span class="text-xs font-bold text-blue-500 shrink-0">${t.points} pt</span>
                    ${btn}
                  </div>
                </div>
              `;
            }).join('') : `<div class="flex flex-col items-center justify-center h-full opacity-50"><div class="w-8 h-8 mb-2 text-slate-300">${getIcon('task')}</div><p class="text-[10px] font-bold text-slate-400">仕事はありません</p></div>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderModal(content) {
  return `<div class="flex-1 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-md z-30 absolute inset-0"><div class="solid-box w-full max-h-[90%] flex flex-col relative shadow-[0_20px_50px_rgba(0,0,0,0.1)] animate-in zoom-in-95 duration-200"><button onclick="setView('home')" class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-500 z-10 transition">✕</button><div class="flex-1 overflow-y-auto p-6 min-h-0">${content}</div></div></div>`;
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
    <h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-5 h-5 text-emerald-500">${getIcon('bank')}</div>${rb('家庭内銀行','かていないぎんこう')}</h2>
    <div class="p-6 bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-2xl text-center mb-6 border border-emerald-100/50">
      <p class="text-xs font-semibold text-emerald-600 mb-1">${rb('預金残高','よきんざんだか')}</p>
      <p class="text-4xl font-black text-emerald-900 tracking-tight">${currentTotal.toLocaleString()} <span class="text-sm font-bold text-emerald-700">pt</span></p>
      <p class="text-[10px] font-bold text-emerald-600 mt-3 bg-white/60 inline-block px-3 py-1 rounded-full backdrop-blur-sm">
        ${rb('利息','りそく')}: +${totalInterest}pt (月0.1%)
      </p>
    </div>
    ${state.role === 'child' ? `
      <div class="flex gap-2 mb-4">
        <input type="number" id="bank-amount" placeholder="金額を入力" class="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm focus:outline-none focus:border-emerald-400 focus:bg-white transition" />
        <button onclick="depositBank()" class="solid-btn px-6 bg-emerald-600 text-white font-bold text-sm shadow-md shadow-emerald-200">預ける</button>
      </div>
      ${currentTotal > 0 ? `<button onclick="withdrawBank()" class="solid-btn w-full py-4 text-sm font-bold bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50">全額引き出す</button>` : ''}
    ` : `<p class="text-xs text-center font-bold text-slate-400">子供の預金資産です</p>`}
  `;
}

function renderInvest() {
  const rates = getMarketRates();
  return `
    <h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-5 h-5 text-purple-500">${getIcon('invest')}</div>${rb('資産運用','しさんうんよう')}</h2>
    <div class="w-full h-[180px] mb-6 relative p-1 bg-white"><canvas id="investChart"></canvas></div>
    ${state.role === 'child' ? `
      <div class="flex gap-2 mb-6">
        <input type="number" id="invest-amount" placeholder="金額" class="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm focus:outline-none focus:border-purple-400 focus:bg-white transition" />
        <button onclick="investCustom('日本')" class="solid-btn px-4 bg-blue-600 text-white font-bold text-xs shadow-md shadow-blue-200">日本株</button>
        <button onclick="investCustom('アメリカ')" class="solid-btn px-4 bg-red-500 text-white font-bold text-xs shadow-md shadow-red-200">米国株</button>
      </div>
    ` : ''}
    <div class="space-y-3">
      ${state.investments.length > 0 ? state.investments.map(inv => {
        const cur = inv.name === '日本' ? rates.日本[12] : rates.アメリカ[12];
        const val = Math.round((inv.shares || inv.investedPoints / cur) * cur);
        const diff = val - inv.investedPoints;
        const color = diff >= 0 ? 'text-red-500' : 'text-blue-500';
        const bg = inv.name === '日本' ? 'bg-blue-50/50' : 'bg-red-50/50';
        return `
          <div class="p-4 ${bg} rounded-xl border border-slate-100 flex flex-col gap-2">
            <div class="flex justify-between items-center">
              <span class="font-bold text-sm text-slate-700">${inv.name === '日本' ? '🇯🇵 日本株' : '🇺🇸 米国株'}</span>
              <div class="text-right flex items-baseline gap-2">
                <span class="text-[11px] font-bold ${color}">${diff >= 0 ? '+' : ''}${diff}</span>
                <span class="text-lg font-black text-slate-800">${val.toLocaleString()} <span class="text-xs font-bold text-slate-500">pt</span></span>
              </div>
            </div>
            <div class="flex justify-between items-center text-[10px] font-bold text-slate-400">
              <span>購入額: ${inv.investedPoints} pt</span>
              ${state.role === 'child' ? `<button onclick="sellCustom('${inv.id}', ${val})" class="text-slate-500 hover:text-slate-800 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm transition">売却する</button>` : ''}
            </div>
          </div>
        `;
      }).join('') : `<p class="text-xs font-bold text-slate-300 text-center py-4">現在、運用中の資産はありません</p>`}
    </div>
  `;
}

function drawInvestChart() {
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
        { label: '日本', data: datasetJp, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.1)', borderWidth: 2, tension: 0.3, pointRadius: isDetail?3:0, fill: isDetail },
        { label: '米国', data: datasetAm, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 2, borderDash: [5, 5], tension: 0.3, pointRadius: isDetail?3:0, fill: isDetail }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: isDetail, position: 'bottom', labels: { usePointStyle: true, boxWidth: 6, font: {size: 10, weight:'600'} } }, tooltip: { enabled: isDetail, backgroundColor: 'rgba(15,23,42,0.9)', padding: 10, cornerRadius: 8 } },
      scales: { x: { display: isDetail, grid: {display: false}, ticks: { font: {size: 9}, color: '#94a3b8' } }, y: { display: isDetail, border:{dash:[4,4]}, grid: {color: '#f1f5f9'}, ticks: { font: {size: 9}, color: '#94a3b8' } } },
      layout: { padding: isDetail ? 0 : 5 }
    }
  });
}

function renderBalloonSend() { return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-5 h-5 text-pink-500">${getIcon('balloon')}</div>風船ギフトを送る</h2><input type="number" id="balloon-points" placeholder="プレゼントするポイント" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4 font-bold text-sm focus:outline-none focus:border-pink-400 focus:bg-white" /><textarea id="balloon-message" placeholder="メッセージを入力" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl mb-6 font-bold text-sm h-24 resize-none focus:outline-none focus:border-pink-400 focus:bg-white"></textarea><button onclick="sendBalloon()" class="solid-btn w-full py-4 bg-slate-800 text-white font-bold shadow-lg shadow-slate-200">空へ放つ</button>`; }
function renderPropose() { return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800">${rb('報酬提案','ほうしゅうていあん')}</h2><input type="text" id="prop-title" placeholder="仕事の内容" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4 font-bold text-sm focus:outline-none focus:bg-white focus:border-blue-400" /><div class="flex items-center gap-3 mb-4"><input type="number" id="prop-points" placeholder="希望金額" class="w-1/2 p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm focus:outline-none focus:bg-white focus:border-blue-400" /><span class="font-bold text-sm text-slate-500">pt</span></div><input type="datetime-local" id="prop-deadline" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl mb-6 font-bold text-sm text-slate-600 focus:outline-none focus:bg-white focus:border-blue-400" /><button onclick="proposeTask()" class="solid-btn w-full py-4 bg-blue-600 text-white font-bold shadow-lg shadow-blue-200">提案を送信</button>`; }
function renderTaskCreate() { return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800">${rb('仕事発注','しごとはっちゅう')}</h2><input type="text" id="task-title" placeholder="仕事の内容" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4 font-bold text-sm focus:outline-none focus:bg-white focus:border-slate-800" /><div class="flex items-center gap-3 mb-4"><input type="number" id="task-points" placeholder="報酬金額" class="w-1/2 p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm focus:outline-none focus:bg-white focus:border-slate-800" /><span class="font-bold text-sm text-slate-500">pt</span></div><input type="datetime-local" id="task-deadline" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl mb-6 font-bold text-sm text-slate-600 focus:outline-none focus:bg-white focus:border-slate-800" /><button onclick="addTask()" class="solid-btn w-full py-4 bg-slate-800 text-white font-bold shadow-lg shadow-slate-200">発注する</button>`; }
function renderExchange() {
  const p = state.exchanges.filter(e => e.status === 'pending');
  if (state.role === 'child') return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-5 h-5 text-amber-500">${getIcon('exchange')}</div>${rb('換金申請','かんきんしんせい')}</h2><div class="flex items-center gap-3 mb-6"><input type="number" id="exchange-amount" placeholder="金額" class="flex-1 p-4 bg-slate-50 border border-slate-200 rounded-xl font-black text-xl text-right focus:outline-none focus:bg-white focus:border-amber-400" /><span class="font-bold text-lg text-slate-600">円</span></div><button onclick="requestExchange()" class="solid-btn w-full py-4 bg-slate-800 text-white font-bold mb-6 shadow-lg shadow-slate-200">申請する</button><div class="space-y-2">${p.map(e => `<div class="p-3 rounded-xl text-sm font-bold flex justify-between bg-slate-50 border border-slate-100"><span class="text-slate-700">${e.yen} 円</span><span class="text-amber-500 text-xs bg-amber-50 px-2 py-1 rounded-md">承認待ち</span></div>`).join('')}</div>`;
  else return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800">${rb('換金承認','かんきんしょうにん')}</h2><div class="space-y-3">${p.length>0?p.map(e=>`<div class="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm"><p class="font-black text-lg mb-4 text-slate-800">${e.yen}円 の申請</p><div class="flex gap-3"><button onclick="approveExchange('${e.id}', ${e.points})" class="flex-1 solid-btn py-3 bg-slate-800 text-white font-bold text-sm">承認する</button><button onclick="rejectExchange('${e.id}')" class="flex-1 solid-btn py-3 font-bold text-sm text-slate-500 bg-slate-100 hover:bg-slate-200">却下</button></div></div>`).join(''):`<div class="flex flex-col items-center justify-center py-10 opacity-50"><div class="w-10 h-10 mb-3 text-slate-300">${getIcon('exchange')}</div><p class="text-xs font-bold text-slate-400">現在、申請はありません</p></div>`}</div>`;
}
function renderTickets() {
  const ts = state.tickets.filter(t => state.role === 'child' ? t.status === 'available' || t.status === 'bought' : true);
  return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-5 h-5 text-rose-500">${getIcon('ticket')}</div>チケット${state.role==='parent'?'管理':'購入'}</h2>${state.role==='parent'?'<div class="flex gap-2 mb-6"><input id="t-title" placeholder="品名" class="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:bg-white"/><input id="t-pts" type="number" placeholder="pt" class="w-24 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:bg-white"/></div><button onclick="addTicket2()" class="solid-btn w-full py-3 bg-slate-800 text-white font-bold text-sm mb-6 shadow-md">追加する</button>':''}<div class="space-y-3">${ts.map(t=>{
    let b = ''; if(state.role==='child'){ if(t.status==='available') b=`<button onclick="buyTicket('${t.id}',${t.price})" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-[10px] font-bold shadow-sm">購入</button>`; else b=`<span class="text-[10px] font-bold text-slate-400 bg-slate-100 px-3 py-1.5 rounded-lg">所持中</span>`; }
    else { if(t.status==='available') b=`<button onclick="deleteTicket('${t.id}')" class="text-slate-400 hover:text-red-500 text-xs font-bold transition">削除</button>`; else if(t.status==='bought') b=`<button onclick="useTicket('${t.id}')" class="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shadow-sm">使用済にする</button>`; else b=`<span class="text-[10px] text-slate-300 font-bold">使用済</span>`; }
    return `<div class="p-4 rounded-xl border ${t.status==='bought'?'bg-slate-50 border-slate-200':'bg-white border-slate-100'} flex justify-between items-center shadow-sm"><div><p class="font-bold text-sm text-slate-700">${t.title}</p><p class="text-xs font-bold mt-0.5 ${t.status==='bought'?'text-slate-400':'text-rose-500'}">${t.price} pt</p></div>${b}</div>`;
  }).join('')}</div>`;
}
function renderHistory() {
  const app = state.tasks.filter(t => t.status === 'approved'); const t = app.reduce((s, t) => s + t.points, 0);
  return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-5 h-5 text-slate-500">${getIcon('history')}</div>${rb('資産履歴','しさんりれき')}</h2><div class="p-6 bg-slate-50 rounded-2xl text-center mb-6 border border-slate-100"><p class="text-xs font-semibold text-slate-500 mb-1">獲得累計</p><p class="text-3xl font-black text-slate-800 tracking-tight">${t.toLocaleString()} <span class="text-sm font-bold text-slate-400">pt</span></p></div><div class="space-y-1">${app.map(t => `<div class="border-b border-slate-50 py-3 flex justify-between items-center text-xs font-bold"><span class="text-slate-700">${t.title}</span><span class="text-blue-500 bg-blue-50 px-2 py-1 rounded-md">+${t.points} pt</span></div>`).join('')}</div>`;
}
function renderSettings() { return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-5 h-5 text-slate-500">${getIcon('settings')}</div>${rb('各種設定','かくしゅせってい')}</h2><div class="p-6 bg-slate-50 rounded-2xl text-center mb-6 border border-slate-100"><p class="text-xs font-semibold text-slate-500 mb-2">同期ID</p><p class="text-2xl font-mono font-black text-blue-600 tracking-widest">${state.familyCode}</p></div>${state.role==='child'?`<div class="p-4 bg-white rounded-xl mb-8 flex justify-between items-center cursor-pointer border border-slate-100 shadow-sm" onclick="toggleFurigana()"><span class="font-bold text-sm text-slate-700">フリガナ(ルビ)表示</span><div class="w-12 h-6 rounded-full flex items-center p-1 transition-colors duration-300 ${state.furigana?'bg-blue-500 justify-end':'bg-slate-200 justify-start'}"><div class="w-4 h-4 bg-white rounded-full shadow-sm"></div></div></div>`:''}<button onclick="unlinkAccount()" class="solid-btn w-full py-4 bg-slate-100 text-red-500 font-bold text-sm hover:bg-red-50 hover:border-red-100">連携を解除する</button>`; }
function renderCalendar() {
  const tasks = state.tasks.filter(t => t.deadline).sort((a, b) => a.deadline - b.deadline);
  return `<h2 class="text-lg font-bold mb-4 border-b border-slate-100 pb-3 text-slate-800 flex items-center gap-2"><div class="w-5 h-5 text-blue-500">${getIcon('calendar')}</div>${rb('月間予定','げっかんよてい')}</h2><div class="space-y-3">${tasks.length>0?tasks.map(t=>{ const d=new Date(t.deadline); return `<div class="p-4 bg-white border border-slate-100 rounded-xl shadow-sm flex justify-between items-center border-l-4 ${t.deadline<Date.now()?'border-l-red-400':'border-l-blue-400'}"><span class="font-bold text-sm text-slate-700">${t.title}</span><span class="text-xs font-black bg-slate-50 px-2 py-1 rounded-md ${t.deadline<Date.now()?'text-red-500':'text-slate-500'}">${d.getMonth()+1}/${d.getDate()}</span></div>`; }).join(''):`<div class="flex flex-col items-center justify-center py-10 opacity-50"><div class="w-8 h-8 mb-2 text-slate-300">${getIcon('calendar')}</div><p class="text-xs font-bold text-slate-400">予定はありません</p></div>`}</div>`;
}

// ★ 2段階認証とメール通知のモックアップを搭載！
function renderSetup() { 
  appDiv.innerHTML = `
    <div class="h-full flex flex-col items-center justify-center p-6 bg-slate-50 relative overflow-hidden">
      <img src="logo.png" class="absolute inset-0 w-full h-full object-cover opacity-5 pointer-events-none mix-blend-multiply" onerror="this.style.display='none'" />
      <div class="w-24 h-24 mb-6 rounded-full overflow-hidden bg-white shadow-xl flex items-center justify-center relative z-10 border-4 border-white">
        <img src="logo.png" class="w-full h-full object-cover" onerror="this.style.display='none'" />
      </div>
      <h1 class="text-4xl font-black text-slate-800 mb-10 tracking-tighter relative z-10">イエノミクス</h1>
      
      <!-- 親の登録 -->
      <div class="w-full max-w-sm bg-white p-6 rounded-2xl shadow-lg border border-slate-100 mb-6 relative z-10">
        <h3 class="font-bold text-slate-500 mb-4 text-center text-sm">親として登録</h3>
        <input type="email" id="input-email-parent" placeholder="メールアドレスを入力" class="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl mb-4 font-bold text-sm focus:outline-none focus:border-blue-400 focus:bg-white" />
        <button onclick="handleAuth('parent')" class="solid-btn w-full py-4 bg-slate-800 text-white font-bold shadow-md">メール認証して開始</button>
      </div>
      
      <!-- 子供の登録 -->
      <div class="w-full max-w-sm bg-white p-6 rounded-2xl shadow-lg border border-slate-100 relative z-10">
        <h3 class="font-bold text-slate-500 mb-4 text-center text-sm">子供として連携</h3>
        <input type="email" id="input-email-child" placeholder="親のメールアドレスを入力" class="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl mb-4 font-bold text-sm focus:outline-none focus:border-blue-400 focus:bg-white" />
        <input id="input-family-code" placeholder="親の同期ID" class="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl mb-4 text-center font-mono font-black text-xl uppercase focus:outline-none focus:border-blue-400 focus:bg-white" />
        <button onclick="handleAuth('child')" class="solid-btn w-full py-4 bg-blue-600 text-white font-bold shadow-md shadow-blue-200">認証して連携する</button>
      </div>
    </div>
  `; 
}

// ★ フェイク2段階認証ロジック
window.handleAuth = async (role) => {
  const email = document.getElementById(`input-email-${role}`).value;
  if(!email.includes('@')) return alert('正しいメールアドレスを入力してください。');

  // フェイクの認証コードを生成して送信風に見せる
  const code = Math.floor(100000 + Math.random() * 900000);
  alert(`✉️ 【イエノミクス セキュリティ】\n\n「${email}」宛に、2段階認証の確認メールを送信しました。\n\n※デモ用コード: ${code}`);

  const inputCode = prompt('メールに届いた6桁の認証コードを入力してください。');
  if(inputCode !== String(code)) return alert('認証コードが違います。セキュリティのため処理を中断します。');

  alert('認証に成功しました！');

  if(role === 'parent') {
    const c = Math.random().toString(36).substring(2, 8).toUpperCase(); 
    await setDoc(doc(db, "families", c), { points: 0 }); 
    localStorage.setItem('chibiz_role', 'parent'); localStorage.setItem('chibiz_familyCode', c); 
    state.role = 'parent'; state.familyCode = c; state.view = 'home'; setupListeners();
  } else {
    const c = document.getElementById('input-family-code').value.toUpperCase().trim(); 
    if (!c) return; const s = await getDoc(doc(db, "families", c)); 
    if (s.exists()) { 
      localStorage.setItem('chibiz_role', 'child'); localStorage.setItem('chibiz_familyCode', c); 
      state.role = 'child'; state.familyCode = c; state.view = 'home'; setupListeners(); 
    } else alert("同期IDが違います");
  }
}


// --- イベントロジック（アクション時にメール通知のフリをする） ---
function notifyMail(title) {
  setTimeout(() => alert(`✉️ 親のメールアドレスに「${title}」の通知を送信しました。`), 500);
}

window.unlinkAccount = () => { if (confirm("リセットしますか？")) { localStorage.clear(); window.location.reload(); } };
window.addTask = async () => { const t = document.getElementById('task-title').value, p = parseInt(document.getElementById('task-points').value), d = document.getElementById('task-deadline').value; if(t&&p) { await addDoc(collection(db, "tasks"), { familyCode: state.familyCode, title: t, points: p, deadline: d ? new Date(d).getTime() : null, status: 'open', createdAt: Date.now() }); setView('home'); notifyMail('新しい仕事が発注されました'); } };
window.proposeTask = async () => { const t = document.getElementById('prop-title').value, p = parseInt(document.getElementById('prop-points').value), d = document.getElementById('prop-deadline').value; if(t&&p) { await addDoc(collection(db, "tasks"), { familyCode: state.familyCode, title: t, points: p, deadline: d ? new Date(d).getTime() : null, status: 'proposed', createdAt: Date.now() }); setView('home'); notifyMail('子供から新しい報酬の提案が届きました'); } };
window.approveTask = async (id, p) => { await updateDoc(doc(db, "tasks", id), { status: 'approved' }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) }); };
window.approveProposal = async (id) => updateDoc(doc(db, "tasks", id), { status: 'open' });
window.acceptTask = async (id) => updateDoc(doc(db, "tasks", id), { status: 'accepted' });
window.completeTask = async (id) => { await updateDoc(doc(db, "tasks", id), { status: 'completed' }); notifyMail('子供が仕事を完了しました。確認してください'); };
window.addTicket2 = async () => { const t = document.getElementById('t-title').value, p = parseInt(document.getElementById('t-pts').value); if(t&&p) await addDoc(collection(db, "tickets"), { familyCode: state.familyCode, title: t, price: p, status: 'available', createdAt: Date.now() }); };
window.deleteTicket = async (id) => deleteDoc(doc(db, "tickets", id));
window.buyTicket = async (id, p) => { if (state.points < p) return alert("pt不足"); await updateDoc(doc(db, "tickets", id), { status: 'bought' }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-p) }); notifyMail('子供がチケットを購入しました'); };
window.useTicket = async (id) => updateDoc(doc(db, "tickets", id), { status: 'used' });

window.sellCustom = async (id, v) => { 
  if(confirm(`今の価値【${v}pt】で売却して、ポイントに戻しますか？`)) {
    await updateDoc(doc(db, "families", state.familyCode), { points: increment(v) }); 
    await deleteDoc(doc(db, "investments", id)); 
    setView('invest');
  }
};

window.investCustom = async (n) => { const a = parseInt(document.getElementById('invest-amount').value); if (!a || state.points < a) return alert("pt不足"); const r = n === '日本' ? getMarketRates().日本[12] : getMarketRates().アメリカ[12]; await updateDoc(doc(db, "families", state.familyCode), { points: increment(-a) }); const ex = state.investments.find(i => i.name === n); if (ex) { await updateDoc(doc(db, "investments", ex.id), { investedPoints: increment(a), shares: increment(a / r) }); } else { await addDoc(collection(db, "investments"), { familyCode: state.familyCode, name: n, investedPoints: a, shares: a / r, createdAt: Date.now() }); } setView('invest'); };
window.requestExchange = async () => { const a = parseInt(document.getElementById('exchange-amount').value); if (!a || state.points < a) return alert("pt不足"); await addDoc(collection(db, "exchanges"), { familyCode: state.familyCode, points: a, yen: a, status: 'pending', createdAt: Date.now() }); setView('home'); notifyMail('子供から現金換金の申請が届きました'); };
window.approveExchange = async (id, p) => { if (state.points < p) return alert("pt不足"); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-p) }); await updateDoc(doc(db, "exchanges", id), { status: 'approved' }); };
window.rejectExchange = async (id) => updateDoc(doc(db, "exchanges", id), { status: 'rejected' });
window.depositBank = async () => { const a = parseInt(document.getElementById('bank-amount').value); if (!a || state.points < a) return alert("pt不足"); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-a) }); await addDoc(collection(db, "banks"), { familyCode: state.familyCode, amount: a, createdAt: Date.now() }); setView('bank'); };
window.withdrawBank = async () => { let t = 0; state.banks.forEach(b => { const m = (Date.now() - b.createdAt) / (1000*60*60*24*30); t += b.amount + Math.floor(b.amount * (0.001 * m)); deleteDoc(doc(db, "banks", b.id)); }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(t) }); setView('home'); alert(`${t}pt 引き出しました`); };
window.sendBalloon = async () => { const p = parseInt(document.getElementById('balloon-points').value), m = document.getElementById('balloon-message').value; if(p){ await addDoc(collection(db, "balloons"), { familyCode: state.familyCode, points: p, message: m, status: 'unread', createdAt: Date.now() }); alert('放ちました🎈'); setView('home'); } };
window.openBalloon = async (id, p, m) => { alert(`風船ギフト到着！\n\n「${m}」\n\nボーナス ${p} pt 獲得！`); await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) }); await deleteDoc(doc(db, "balloons", id)); };

function setupListeners() {
  if (!state.familyCode) return;
  onSnapshot(doc(db, "families", state.familyCode), (d) => { if (d.exists()) { state.points = d.data().points || 0; render(); } });
  const w = (c, k) => { onSnapshot(query(collection(db, c), where("familyCode", "==", state.familyCode)), (s) => { const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); a.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); state[k] = a; render(); }); };
  w("tasks", "tasks"); w("tickets", "tickets"); w("investments", "investments"); w("exchanges", "exchanges"); w("banks", "banks"); w("balloons", "balloons");
}
if (state.familyCode) setupListeners(); else render();