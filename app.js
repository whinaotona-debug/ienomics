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

// ★ おそらくここがコピーから漏れていました！
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
    'calendar': `<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><path d="M16 2v4M8 2v4M3 10h18"/>`
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
    <div class="w-full h-full flex justify-around items-center bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.05)] pb-2">
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
        <div class="w-20 h-20 rounded-full overflow-hidden border-4 border-white shadow-2xl bg-white flex items-center justify-center">
          <img src="balloon.png" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
          <span style="display:none;" class="text-4xl">🎈</span>
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
      <div class="bg-[#1a1c23] text-white rounded-[12px] p-5 flex items-center justify-between shadow-md relative h-[105px] overflow-hidden">
        
        <!-- 背景右上にロゴを透かして配置 -->
        <img src="logo.png" class="absolute -right-6 -top-6 w-32 h-32 opacity-20 object-cover mix-blend-lighten pointer-events-none" onerror="this.style.display='none'" />

        <div class="flex-1 relative z-10">
          <div class="flex items-center gap-1.5 mb-1">
             <div class="w-4 h-4 rounded-full overflow-hidden bg-white flex items-center justify-center">
               <img src="logo.png" class="w-full h-full object-cover" onerror="this.style.display='none'" />
             </div>
             <p class="text-[10px] text-slate-400 font-bold tracking-widest">イエノミクス ${rb('資産','しさん')}</p>
          </div>
          <div class="flex items-baseline gap-1">
            <span class="text-4xl font-black font-mono tracking-tighter text-emerald-400">${state.points.toLocaleString()}</span>
            <span class="text-sm font-bold text-slate-500">pt</span>
          </div>
        </div>
        <div class="w-px h-12 bg-slate-700 mx-4 relative z-10"></div>
        <div class="flex-1 text-right relative z-10">
          <p class="text-[10px] text-slate-400 font-bold mb-1 tracking-widest">${rb('同期','どうき')}ID</p>
          <p class="text-xl font-mono font-black text-[#82aaff]">${state.familyCode}</p>
        </div>
      </div>
    </div>
  `;
}

function renderHome() {
  const activeTasks = state.tasks.filter(t => ['open', 'accepted', 'completed', 'proposed'].includes(t.status));
  const tJob = state.role === 'child' ? { id: 'propose', title: rb('報酬','ほうしゅう')+'を'+rb('提案','ていあん') } : { id: 'taskCreate', title: rb('仕事','しごと')+'の'+rb('発注','はっちゅう') };
  const tEx = state.role === 'child' ? rb('現金','げんきん')+'に'+rb('換金','かんきん') : rb('換金','かんきん')+rb('承認','しょうにん');

  return `
    <div class="flex-1 min-h-0 p-3">
      <div class="h-full grid grid-cols-[45fr_55fr] gap-3">
        <div class="flex flex-col gap-3 min-h-0">
          <div class="solid-box flex-1 p-2 space-y-3 overflow-y-auto">
            <div>
              <p class="text-[9px] font-black text-slate-400 border-b border-slate-100 mb-1.5 pb-0.5">${rb('仕事','しごと')}</p>
              <button onclick="setView('${tJob.id}')" class="solid-btn w-full py-2 bg-blue-50 text-blue-900 border-blue-900">
                <div class="w-4 h-4">${getIcon('propose')}</div><span class="text-[10px] font-black mt-1">${tJob.title}</span>
              </button>
            </div>
            <div>
              <p class="text-[9px] font-black text-slate-400 border-b border-slate-100 mb-1.5 pb-0.5">${rb('管理','かんり')}</p>
              <div class="grid grid-cols-1 gap-2">
                <button onclick="setView('bank')" class="solid-btn py-2 flex-row gap-2 bg-emerald-50 text-emerald-900 border-emerald-900">
                  <div class="w-4 h-4">${getIcon('bank')}</div><span class="text-[10px] font-black">${rb('銀行','ぎんこう')}</span>
                </button>
                <button onclick="setView('invest')" class="solid-btn py-2 flex-row gap-2 bg-purple-50 text-purple-900 border-purple-900">
                  <div class="w-4 h-4">${getIcon('invest')}</div><span class="text-[10px] font-black">${rb('運用','うんよう')}</span>
                </button>
              </div>
            </div>
            <div>
              <p class="text-[9px] font-black text-slate-400 border-b border-slate-100 mb-1.5 pb-0.5">${rb('支出','ししゅつ')}</p>
              <button onclick="setView('exchange')" class="solid-btn w-full py-2 flex-row gap-2 bg-amber-50 text-amber-900 border-amber-900 mb-2">
                <div class="w-4 h-4">${getIcon('exchange')}</div><span class="text-[10px] font-black">${tEx}</span>
              </button>
              <button onclick="setView('tickets')" class="solid-btn w-full py-2 flex-row gap-2 bg-rose-50 text-rose-900 border-rose-900">
                <div class="w-4 h-4">${getIcon('ticket')}</div><span class="text-[10px] font-black">チケット購入</span>
              </button>
            </div>
            ${state.role === 'parent' ? `<button onclick="setView('balloonSend')" class="solid-btn w-full py-2 bg-pink-500 text-white border-pink-700 mt-2"><span class="text-[10px] font-black">🎈 風船ギフト</span></button>` : ''}
          </div>
          <div class="solid-box h-[110px] relative p-1 cursor-pointer border-purple-800" onclick="setView('invest')">
            <canvas id="investChart"></canvas>
          </div>
        </div>

        <div class="solid-box flex flex-col min-h-0 relative">
          <div class="flex-none p-2 border-b-2 border-slate-800 flex justify-between items-center bg-slate-100 rounded-t-[6px]">
            <h2 class="text-xs font-black text-slate-800 flex items-center gap-1">${getIcon('task')} JOB</h2>
            <button onclick="setView('calendar')" class="w-6 h-6 text-slate-500 hover:text-black transition">${getIcon('calendar')}</button>
          </div>
          <div class="flex-1 overflow-y-auto p-2 space-y-2">
            ${activeTasks.length > 0 ? activeTasks.map(t => {
              const diff = t.deadline ? t.deadline - Date.now() : null;
              const days = diff ? Math.floor(diff / (1000 * 60 * 60 * 24)) : null;
              const timeTxt = diff === null ? '--' : (diff < 0 ? '終了' : (days > 0 ? `あと${days}日` : '今日'));
              let btn = '';
              if (state.role === 'child') {
                if (t.status === 'open') btn = `<button onclick="acceptTask('${t.id}')" class="bg-slate-800 text-white px-2 py-1 rounded text-[9px] font-black">受注</button>`;
                else if (t.status === 'accepted') btn = `<button onclick="completeTask('${t.id}')" class="bg-blue-600 text-white px-2 py-1 rounded text-[9px] font-black">完了</button>`;
                else btn = `<span class="text-[9px] text-slate-400 font-bold">待機</span>`;
              } else {
                if (t.status === 'completed') btn = `<button onclick="approveTask('${t.id}', ${t.points})" class="bg-blue-600 text-white px-2 py-1 rounded text-[9px] font-black">付与</button>`;
                else if (t.status === 'proposed') btn = `<button onclick="approveProposal('${t.id}')" class="bg-slate-800 text-white px-2 py-1 rounded text-[9px] font-black">承認</button>`;
                else btn = `<span class="text-[9px] text-slate-400 font-bold">進行中</span>`;
              }
              return `
                <div class="border-b border-slate-100 pb-2 flex flex-col gap-1">
                  <div class="flex justify-between items-start"><span class="font-bold text-[11px] text-slate-800 leading-tight">${t.title}</span><span class="text-[9px] font-black text-slate-400">${timeTxt}</span></div>
                  <div class="flex justify-between items-center mt-1"><span class="text-[10px] font-black text-blue-600">${t.points} pt</span>${btn}</div>
                </div>
              `;
            }).join('') : `<p class="text-center text-[10px] font-bold text-slate-300 mt-6">現在、仕事はありません</p>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderModal(content) {
  return `<div class="flex-1 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm z-30 absolute inset-0"><div class="solid-box w-full max-h-[90%] flex flex-col relative shadow-2xl animate-in zoom-in-95 duration-200"><button onclick="setView('home')" class="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 font-bold text-slate-400 z-10">✕</button><div class="flex-1 overflow-y-auto p-6 min-h-0">${content}</div></div></div>`;
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
    <h2 class="text-xl font-black mb-4 border-b-2 border-emerald-800 pb-2 text-emerald-900 flex items-center gap-2">${getIcon('bank')} ${rb('家庭内銀行','かていないぎんこう')}</h2>
    <div class="solid-box p-5 bg-emerald-50 border-emerald-800 text-center mb-6">
      <p class="text-xs font-bold text-emerald-600 mb-1">${rb('預金残高','よきんざんだか')}</p>
      <p class="text-4xl font-black text-emerald-900">${currentTotal.toLocaleString()} <span class="text-sm">pt</span></p>
      <p class="text-[11px] font-black text-emerald-600 mt-2 bg-white inline-block px-2 py-0.5 rounded-full border border-emerald-200">
        ${rb('利息','りそく')}: +${totalInterest}pt (月0.1%)
      </p>
    </div>
    ${state.role === 'child' ? `
      <div class="flex gap-2 mb-4">
        <input type="number" id="bank-amount" placeholder="金額を入力" class="flex-1 p-3 solid-box border-emerald-800 font-bold text-sm" />
        <button onclick="depositBank()" class="solid-btn px-6 bg-emerald-800 text-white font-black">預ける</button>
      </div>
      ${currentTotal > 0 ? `<button onclick="withdrawBank()" class="solid-btn w-full py-4 text-sm font-black bg-white text-emerald-800 border-emerald-800">全額引き出す</button>` : ''}
    ` : `<p class="text-xs text-center font-bold text-slate-500">※子供が銀行に預けている資産です</p>`}
  `;
}

function renderInvest() {
  const rates = getMarketRates();
  return `
    <h2 class="text-xl font-black mb-4 border-b-2 border-purple-800 pb-2 text-purple-900 flex items-center gap-2">${getIcon('invest')} ${rb('資産運用','しさんうんよう')}</h2>
    <div class="solid-box w-full h-[180px] mb-6 relative p-2 bg-white border-purple-800"><canvas id="investChart"></canvas></div>
    ${state.role === 'child' ? `
      <div class="flex gap-2 mb-6">
        <input type="number" id="invest-amount" placeholder="金額" class="flex-1 p-3 solid-box border-purple-800 font-bold text-sm" />
        <button onclick="investCustom('日本')" class="solid-btn px-4 bg-blue-800 text-white font-black text-xs">日本株</button>
        <button onclick="investCustom('アメリカ')" class="solid-btn px-4 bg-red-800 text-white font-black text-xs">米国株</button>
      </div>
    ` : ''}
    <div class="space-y-3">
      ${state.investments.length > 0 ? state.investments.map(inv => {
        const cur = inv.name === '日本' ? rates.日本[12] : rates.アメリカ[12];
        const val = Math.round((inv.shares || inv.investedPoints / cur) * cur);
        const diff = val - inv.investedPoints;
        const color = diff >= 0 ? 'text-red-500' : 'text-blue-600';
        return `
          <div class="solid-box p-3 bg-slate-50 flex flex-col gap-2">
            <div class="flex justify-between items-center">
              <span class="font-black text-sm">${inv.name === '日本' ? '🇯🇵 日本株' : '🇺🇸 米国株'}</span>
              <div class="text-right">
                <span class="text-lg font-black">${val.toLocaleString()} pt</span>
                <span class="text-[10px] font-bold ${color} ml-1">(${diff >= 0 ? '+' : ''}${diff})</span>
              </div>
            </div>
            <div class="flex justify-between text-[10px] font-bold text-slate-400 px-1">
              <span>購入時: ${inv.investedPoints} pt</span>
              ${state.role === 'child' ? `<button onclick="sellCustom('${inv.id}', ${val})" class="text-purple-700 underline">売却する</button>` : ''}
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
        { label: '日本', data: datasetJp, borderColor: '#1e40af', backgroundColor: 'rgba(30,64,175,0.1)', borderWidth: 2, tension: 0.2, pointRadius: isDetail?3:0, fill: isDetail },
        { label: '米国', data: datasetAm, borderColor: '#991b1b', backgroundColor: 'rgba(153,27,27,0.1)', borderWidth: 2, borderDash: [4, 4], tension: 0.2, pointRadius: isDetail?3:0, fill: isDetail }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: isDetail, position: 'bottom', labels: { boxWidth: 10, font: {size: 10, weight:'bold'} } }, tooltip: { enabled: isDetail } },
      scales: { x: { display: isDetail, ticks: { font: {size: 9, weight:'bold'} } }, y: { display: isDetail, ticks: { font: {size: 9, weight:'bold'} } } },
      layout: { padding: isDetail ? 10 : 5 }
    }
  });
}

function renderBalloonSend() { return `<h2 class="text-xl font-black mb-4 border-b-2 border-pink-800 pb-2 text-pink-900">🎈 風船ギフトを送る</h2><input type="number" id="balloon-points" placeholder="ポイント" class="w-full p-3 solid-box border-pink-800 mb-4 font-bold text-sm" /><textarea id="balloon-message" placeholder="メッセージ" class="w-full p-3 solid-box border-pink-800 mb-6 font-bold text-sm h-24 resize-none"></textarea><button onclick="sendBalloon()" class="solid-btn w-full py-4 bg-pink-600 text-white font-black">空へ放つ</button>`; }
function renderPropose() { return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">${rb('報酬提案','ほうしゅうていあん')}</h2><input type="text" id="prop-title" placeholder="内容" class="w-full p-3 solid-box mb-4 font-bold text-sm" /><div class="flex items-center gap-2 mb-4"><input type="number" id="prop-points" placeholder="金額" class="w-1/2 p-3 solid-box font-bold text-sm" /><span>pt</span></div><input type="datetime-local" id="prop-deadline" class="w-full p-3 solid-box mb-6 font-bold text-sm bg-slate-50" /><button onclick="proposeTask()" class="solid-btn w-full py-3 bg-slate-800 text-white font-bold">提案する</button>`; }
function renderTaskCreate() { return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">${rb('仕事発注','しごとはっちゅう')}</h2><input type="text" id="task-title" placeholder="内容" class="w-full p-3 solid-box mb-4 font-bold text-sm" /><div class="flex items-center gap-2 mb-4"><input type="number" id="task-points" placeholder="金額" class="w-1/2 p-3 solid-box font-bold text-sm" /><span>pt</span></div><input type="datetime-local" id="task-deadline" class="w-full p-3 solid-box mb-6 font-bold text-sm bg-slate-50" /><button onclick="addTask()" class="solid-btn w-full py-3 bg-slate-800 text-white font-bold">発注する</button>`; }
function renderExchange() {
  const p = state.exchanges.filter(e => e.status === 'pending');
  if (state.role === 'child') return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">${rb('換金申請','かんきんしんせい')}</h2><div class="flex items-center gap-2 mb-6"><input type="number" id="exchange-amount" placeholder="金額" class="flex-1 p-3 solid-box font-bold text-lg text-right" /><span>円</span></div><button onclick="requestExchange()" class="solid-btn w-full py-3 bg-slate-800 text-white font-bold mb-6">申請する</button><div class="space-y-2">${p.map(e => `<div class="solid-box p-2 text-sm font-bold flex justify-between bg-slate-50"><span>${e.yen}円</span><span class="text-slate-400">承認待ち</span></div>`).join('')}</div>`;
  else return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">${rb('換金承認','かんきんしょうにん')}</h2><div class="space-y-3">${p.length>0?p.map(e=>`<div class="solid-box p-4 bg-slate-50"><p class="font-black text-lg mb-3">${e.yen}円 の申請</p><div class="flex gap-2"><button onclick="approveExchange('${e.id}', ${e.points})" class="flex-1 solid-btn py-2 bg-slate-800 text-white font-bold text-sm">承認</button><button onclick="rejectExchange('${e.id}')" class="flex-1 solid-btn py-2 font-bold text-sm text-red-500">却下</button></div></div>`).join(''):`<p class="text-xs font-bold text-slate-300 text-center py-8">現在、申請はありません</p>`}</div>`;
}
function renderTickets() {
  const ts = state.tickets.filter(t => state.role === 'child' ? t.status === 'available' || t.status === 'bought' : true);
  return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">チケット${state.role==='parent'?'管理':'購入'}</h2>${state.role==='parent'?'<div class="flex gap-2 mb-4"><input id="t-title" placeholder="品名" class="flex-1 p-2 solid-box text-sm font-bold"/><input id="t-pts" type="number" placeholder="pt" class="w-20 p-2 solid-box text-sm font-bold"/></div><button onclick="addTicket2()" class="solid-btn w-full py-2 bg-slate-800 text-white font-bold text-sm mb-4">追加</button>':''}<div class="space-y-2">${ts.map(t=>{
    let b = ''; if(state.role==='child'){ if(t.status==='available') b=`<button onclick="buyTicket('${t.id}',${t.price})" class="bg-slate-800 text-white px-3 py-1 rounded text-[10px] font-black">購入</button>`; else b=`<span class="text-[9px] font-black text-slate-400">所持中</span>`; }
    else { if(t.status==='available') b=`<button onclick="deleteTicket('${t.id}')" class="text-red-500 text-[10px] font-bold">削除</button>`; else if(t.status==='bought') b=`<button onclick="useTicket('${t.id}')" class="bg-slate-800 text-white px-3 py-1 rounded text-[10px] font-black">使用済にする</button>`; else b=`<span class="text-[9px] text-slate-300">使用済</span>`; }
    return `<div class="solid-box p-3 ${t.status==='bought'?'bg-slate-50 border-slate-300':''} flex justify-between items-center"><div><p class="font-bold text-sm">${t.title}</p><p class="text-[10px] font-black text-blue-600">${t.price} pt</p></div>${b}</div>`;
  }).join('')}</div>`;
}
function renderHistory() {
  const app = state.tasks.filter(t => t.status === 'approved'); const t = app.reduce((s, t) => s + t.points, 0);
  return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">${rb('資産履歴','しさんりれき')}</h2><div class="solid-box p-4 bg-slate-50 text-center mb-6"><p class="text-[10px] font-black text-slate-400 mb-1">獲得累計</p><p class="text-3xl font-black text-slate-800">${t.toLocaleString()} pt</p></div><div class="space-y-2">${app.map(t => `<div class="border-b border-slate-100 py-2 flex justify-between text-[11px] font-bold"><span>${t.title}</span><span class="text-slate-400">${t.points}pt</span></div>`).join('')}</div>`;
}
function renderSettings() { return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">${rb('各種設定','かくしゅせってい')}</h2><div class="solid-box p-4 bg-slate-50 text-center mb-4"><p class="text-[10px] font-black text-slate-400 mb-2">同期ID</p><p class="text-2xl font-mono font-black text-blue-600">${state.familyCode}</p></div>${state.role==='child'?`<div class="solid-box p-4 bg-white mb-6 flex justify-between items-center cursor-pointer" onclick="toggleFurigana()"><span class="font-bold text-sm">フリガナ(ルビ)表示</span><div class="w-10 h-5 rounded-full border-2 border-slate-800 flex items-center p-0.5 ${state.furigana?'bg-blue-600 justify-end':'bg-slate-200 justify-start'}"><div class="w-3 h-3 bg-white rounded-full border border-slate-800"></div></div></div>`:''}<button onclick="unlinkAccount()" class="solid-btn w-full py-3 border-red-500 text-red-500 font-bold text-sm">連携解除</button>`; }
function renderCalendar() {
  const tasks = state.tasks.filter(t => t.deadline).sort((a, b) => a.deadline - b.deadline);
  return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">${rb('月間予定','げんかんよてい')}</h2><div class="space-y-3">${tasks.length>0?tasks.map(t=>{ const d=new Date(t.deadline); return `<div class="solid-box p-3 bg-slate-50 flex justify-between items-center border-l-4 ${t.deadline<Date.now()?'border-red-400':'border-blue-400'}"><span class="font-bold text-xs">${t.title}</span><span class="text-[10px] font-black text-slate-400">${d.getMonth()+1}/${d.getDate()}</span></div>`; }).join(''):`<p class="text-xs font-bold text-slate-300 text-center py-8">予定はありません</p>`}</div>`;
}
function renderSetup() { 
  appDiv.innerHTML = `
    <div class="h-full flex flex-col items-center justify-center p-6 bg-slate-900 relative overflow-hidden">
      <!-- 背景にロゴを透かす -->
      <img src="logo.png" class="absolute inset-0 w-full h-full object-cover opacity-5 pointer-events-none mix-blend-lighten" onerror="this.style.display='none'" />
      
      <div class="w-24 h-24 mb-6 rounded-full overflow-hidden bg-white shadow-[0_0_20px_rgba(255,255,255,0.2)] flex items-center justify-center relative z-10">
        <img src="logo.png" class="w-full h-full object-cover" onerror="this.style.display='none'" />
      </div>
      <h1 class="text-5xl font-black text-white mb-10 tracking-tighter relative z-10">イエノミクス</h1>
      <div class="w-full max-w-sm solid-box p-6 mb-6 relative z-10"><h3 class="font-bold text-slate-800 mb-4 text-center">親として開始</h3><button id="btn-create-parent" class="solid-btn w-full py-4 bg-slate-800 text-white font-black">新規ID発行</button></div>
      <div class="w-full max-w-sm solid-box p-6 bg-slate-100 relative z-10"><h3 class="font-bold text-slate-800 mb-4 text-center">子供として開始</h3><input id="input-family-code" placeholder="IDを入力" class="w-full p-4 solid-box rounded mb-4 text-center font-mono font-black text-xl uppercase" /><button id="btn-join-child" class="solid-btn w-full py-4 bg-blue-600 text-white font-black">連携する</button></div>
    </div>
  `; 
  document.getElementById('btn-create-parent').onclick = async () => { const c = Math.random().toString(36).substring(2, 8).toUpperCase(); await setDoc(doc(db, "families", c), { points: 0 }); localStorage.setItem('chibiz_role', 'parent'); localStorage.setItem('chibiz_familyCode', c); state.role = 'parent'; state.familyCode = c; state.view = 'home'; setupListeners(); }; document.getElementById('btn-join-child').onclick = async () => { const c = document.getElementById('input-family-code').value.toUpperCase().trim(); if (!c) return; const s = await getDoc(doc(db, "families", c)); if (s.exists()) { localStorage.setItem('chibiz_role', 'child'); localStorage.setItem('chibiz_familyCode', c); state.role = 'child'; state.familyCode = c; state.view = 'home'; setupListeners(); } else alert("IDが違います"); }; 
}

// --- イベントロジック ---
window.unlinkAccount = () => { if (confirm("リセットしますか？")) { localStorage.clear(); window.location.reload(); } };
window.addTask = async () => { const t = document.getElementById('task-title').value, p = parseInt(document.getElementById('task-points').value), d = document.getElementById('task-deadline').value; if(t&&p) { await addDoc(collection(db, "tasks"), { familyCode: state.familyCode, title: t, points: p, deadline: d ? new Date(d).getTime() : null, status: 'open', createdAt: Date.now() }); setView('home'); } };
window.proposeTask = async () => { const t = document.getElementById('prop-title').value, p = parseInt(document.getElementById('prop-points').value), d = document.getElementById('prop-deadline').value; if(t&&p) { await addDoc(collection(db, "tasks"), { familyCode: state.familyCode, title: t, points: p, deadline: d ? new Date(d).getTime() : null, status: 'proposed', createdAt: Date.now() }); setView('home'); } };
window.approveTask = async (id, p) => { await updateDoc(doc(db, "tasks", id), { status: 'approved' }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) }); };
window.approveProposal = async (id) => updateDoc(doc(db, "tasks", id), { status: 'open' });
window.acceptTask = async (id) => updateDoc(doc(db, "tasks", id), { status: 'accepted' });
window.completeTask = async (id) => updateDoc(doc(db, "tasks", id), { status: 'completed' });
window.addTicket2 = async () => { const t = document.getElementById('t-title').value, p = parseInt(document.getElementById('t-pts').value); if(t&&p) await addDoc(collection(db, "tickets"), { familyCode: state.familyCode, title: t, price: p, status: 'available', createdAt: Date.now() }); };
window.deleteTicket = async (id) => deleteDoc(doc(db, "tickets", id));
window.buyTicket = async (id, p) => { if (state.points < p) return alert("pt不足"); await updateDoc(doc(db, "tickets", id), { status: 'bought' }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-p) }); };
window.useTicket = async (id) => updateDoc(doc(db, "tickets", id), { status: 'used' });
window.investCustom = async (n) => { const a = parseInt(document.getElementById('invest-amount').value); if (!a || state.points < a) return alert("pt不足"); const r = n === '日本' ? getMarketRates().日本[12] : getMarketRates().アメリカ[12]; await updateDoc(doc(db, "families", state.familyCode), { points: increment(-a) }); const ex = state.investments.find(i => i.name === n); if (ex) { await updateDoc(doc(db, "investments", ex.id), { investedPoints: increment(a), shares: increment(a / r) }); } else { await addDoc(collection(db, "investments"), { familyCode: state.familyCode, name: n, investedPoints: a, shares: a / r, createdAt: Date.now() }); } setView('invest'); };
window.sellCustom = async (id, v) => { await updateDoc(doc(db, "families", state.familyCode), { points: increment(v) }); await deleteDoc(doc(db, "investments", id)); };
window.requestExchange = async () => { const a = parseInt(document.getElementById('exchange-amount').value); if (!a || state.points < a) return alert("pt不足"); await addDoc(collection(db, "exchanges"), { familyCode: state.familyCode, points: a, yen: a, status: 'pending', createdAt: Date.now() }); setView('home'); };
window.approveExchange = async (id, p) => { if (state.points < p) return alert("pt不足"); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-p) }); await updateDoc(doc(db, "exchanges", id), { status: 'approved' }); };
window.rejectExchange = async (id) => updateDoc(doc(db, "exchanges", id), { status: 'rejected' });
window.depositBank = async () => { const a = parseInt(document.getElementById('bank-amount').value); if (!a || state.points < a) return alert("pt不足"); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-a) }); await addDoc(collection(db, "banks"), { familyCode: state.familyCode, amount: a, createdAt: Date.now() }); setView('bank'); };
window.withdrawBank = async () => { let t = 0; state.banks.forEach(b => { const m = (Date.now() - b.createdAt) / (1000*60*60*24*30); t += b.amount + Math.floor(b.amount * (0.001 * m)); deleteDoc(doc(db, "banks", b.id)); }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(t) }); setView('home'); alert(`${t}pt 引き出しました`); };
window.sendBalloon = async () => { const p = parseInt(document.getElementById('balloon-points').value), m = document.getElementById('balloon-message').value; if(p){ await addDoc(collection(db, "balloons"), { familyCode: state.familyCode, points: p, message: m, status: 'unread', createdAt: Date.now() }); alert('放ちました🎈'); setView('home'); } };
window.openBalloon = async (id, p, m) => { alert(`🎈ギフト到着！\n\n「${m}」\n\nボーナス ${p} pt 獲得！`); await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) }); await deleteDoc(doc(db, "balloons", id)); };

function setupListeners() {
  if (!state.familyCode) return;
  onSnapshot(doc(db, "families", state.familyCode), (d) => { if (d.exists()) { state.points = d.data().points || 0; render(); } });
  const w = (c, k) => { onSnapshot(query(collection(db, c), where("familyCode", "==", state.familyCode)), (s) => { const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); a.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); state[k] = a; render(); }); };
  w("tasks", "tasks"); w("tickets", "tickets"); w("investments", "investments"); w("exchanges", "exchanges"); w("banks", "banks"); w("balloons", "balloons");
}
if (state.familyCode) setupListeners(); else render();