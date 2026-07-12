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
  banks: [],    // 新機能：銀行
  balloons: []  // 新機能：風船
};

const appDiv = document.getElementById('app');
const bottomNav = document.getElementById('bottom-nav');

// ★ ルビ関数（文字の上に綺麗に乗るようにCSSで修正済み）
const rb = (kanji, kana) => `<ruby>${kanji}<rt>${kana}</rt></ruby>`;
if (state.furigana) document.body.classList.add('furigana-on');

window.toggleFurigana = () => {
  state.furigana = !state.furigana;
  localStorage.setItem('chibiz_furigana', state.furigana);
  document.body.classList.toggle('furigana-on', state.furigana);
  render();
};

// ★ 画像に合わせた線画アイコンを生成する関数
function getIcon(name) {
  const icons = {
    'home': `<path d="M3 10l9-7 9 7v10a2 2 0 01-2 2H5a2 2 0 01-2-2V10z"/><path d="M9 21V12h6v9"/>`,
    'ticket': `<rect x="3" y="8" width="18" height="10" rx="2" ry="2"/><path d="M7 8v10M17 8v10M10 12l2 2 4-4"/>`,
    'settings': `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>`,
    'history': `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`,
    'propose': `<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>`,
    'exchange': `<circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8M10 10l2-2 2 2M10 14l2 2 2-2"/>`,
    'invest': `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M3 15l5-5 4 4 9-9"/>`,
    'bank': `<rect x="3" y="20" width="18" height="2"/><path d="M4 20V10h16v10M12 10V4L3 9h18l-9-5zM8 20v-8M12 20v-8M16 20v-8"/>`,
    'task': `<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/><path d="M9 15h4M9 19h4"/>`,
    'calendar': `<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><path d="M16 2v4M8 2v4M3 10h18"/>`
  };
  return `<svg viewBox="0 0 24 24">${icons[name] || ''}</svg>`;
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

  // ★ ボトムナビをカッコいいタブバーに変更
  bottomNav.classList.remove('hidden');
  bottomNav.innerHTML = `
    <div class="w-full h-full flex justify-around items-center bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.05)] pb-1">
      <button onclick="setView('home')" class="nav-tab ${state.view==='home'?'active':''}">${getIcon('home')}<span>${rb('家','ホーム')}</span></button>
      <button onclick="setView('tickets')" class="nav-tab ${state.view==='tickets'?'active':''}">${getIcon('ticket')}<span>チケット</span></button>
      <button onclick="setView('history')" class="nav-tab ${state.view==='history'?'active':''}">${getIcon('history')}<span>りれき</span></button>
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

  // ★ 風船が届いている場合のオーバーレイ表示
  if (state.role === 'child' && state.view === 'home' && state.balloons.length > 0) {
    const b = state.balloons[0];
    html += `
      <div class="absolute bottom-24 right-6 z-40 float-balloon" onclick="openBalloon('${b.id}', ${b.points}, '${b.message}')">
        <div class="text-6xl drop-shadow-lg">🎈</div>
        <div class="bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded-full absolute -top-2 -right-2 border-2 border-white">届いた!</div>
      </div>
    `;
  }

  appDiv.innerHTML = `<div class="h-full flex flex-col min-h-0 fade-in relative">${html}</div>`;

  if (state.view === 'home' || state.view === 'invest') {
    setTimeout(drawInvestChart, 50);
  }
}

// 絶対に変わらない上部ポイント
function renderHeader() {
  return `
    <div class="flex-none p-3 pb-0">
      <div class="bg-[#1a1c23] text-white rounded-[12px] p-5 flex items-center justify-between shadow-md relative h-[100px]">
        <div class="flex-1">
          <p class="text-[10px] text-slate-400 font-bold mb-1 tracking-widest">${rb('現在','げんざい')}のポイント</p>
          <div class="flex items-baseline gap-1">
            <span class="text-4xl font-black font-mono tracking-tighter">${state.points.toLocaleString()}</span>
            <span class="text-sm font-bold text-slate-500">pt</span>
          </div>
        </div>
        <div class="w-px h-12 bg-slate-700 mx-4"></div>
        <div class="flex-1 text-right flex flex-col justify-center">
          <p class="text-[10px] text-slate-400 font-bold mb-1 tracking-widest">${rb('同期','どうき')}コード</p>
          <p class="text-xl font-mono font-black tracking-[0.1em] text-[#82aaff]">${state.familyCode}</p>
        </div>
      </div>
    </div>
  `;
}

// ★ 大規模アップデートしたホーム画面レイアウト
function renderHome() {
  const activeTasks = state.tasks.filter(t => ['open', 'accepted', 'completed', 'proposed'].includes(t.status));
  
  // 親と子でボタンの文言を変える
  const tJob = state.role === 'child' ? { id: 'propose', title: rb('見積','みつも')+'り' } : { id: 'taskCreate', title: rb('仕事','しごと')+rb('追加','ついか') };
  const tEx = state.role === 'child' ? rb('現金','げんきん')+'と'+rb('交換','こうかん') : rb('交換','こうかん')+rb('承認','しょうにん');

  return `
    <div class="flex-1 min-h-0 p-3">
      <div class="h-full grid grid-cols-[45fr_55fr] gap-3">
        
        <!-- 左側：仕事・管理・使う の3段構成 -->
        <div class="solid-box flex flex-col p-2 gap-3 min-h-0 overflow-y-auto">
          <!-- 仕事 -->
          <div>
            <p class="text-[10px] font-black text-slate-400 border-b border-slate-200 mb-1 pb-1">${rb('仕事','しごと')}</p>
            <button onclick="setView('${tJob.id}')" class="solid-btn w-full py-2 flex-row gap-2 bg-blue-50 text-blue-900 border-blue-900">
              <div class="w-4 h-4">${getIcon('propose')}</div><span class="text-xs font-bold">${tJob.title}</span>
            </button>
            ${state.role === 'parent' ? `
              <button onclick="setView('balloonSend')" class="solid-btn w-full py-2 flex-row gap-2 bg-pink-50 text-pink-900 border-pink-900 mt-2">
                <span class="text-xs">🎈</span><span class="text-xs font-bold">${rb('風船','ふうせん')}を${rb('送','おく')}る</span>
              </button>
            ` : ''}
          </div>
          
          <!-- 管理 -->
          <div>
            <p class="text-[10px] font-black text-slate-400 border-b border-slate-200 mb-1 pb-1">${rb('管理','かんり')}</p>
            <div class="grid grid-cols-2 gap-2">
              <button onclick="setView('bank')" class="solid-btn py-2 gap-1 bg-emerald-50 text-emerald-900 border-emerald-900">
                <div class="w-5 h-5">${getIcon('bank')}</div><span class="text-[10px] font-bold">${rb('銀行','ぎんこう')}</span>
              </button>
              <button onclick="setView('invest')" class="solid-btn py-2 gap-1 bg-purple-50 text-purple-900 border-purple-900">
                <div class="w-5 h-5">${getIcon('invest')}</div><span class="text-[10px] font-bold">${rb('運用','うんよう')}</span>
              </button>
            </div>
          </div>

          <!-- 使う -->
          <div>
            <p class="text-[10px] font-black text-slate-400 border-b border-slate-200 mb-1 pb-1">${rb('使','つか')}う</p>
            <div class="flex flex-col gap-2">
              <button onclick="setView('exchange')" class="solid-btn py-2 flex-row gap-2 bg-amber-50 text-amber-900 border-amber-900">
                <div class="w-4 h-4">${getIcon('exchange')}</div><span class="text-xs font-bold">${tEx}</span>
              </button>
              <button onclick="setView('tickets')" class="solid-btn py-2 flex-row gap-2 bg-rose-50 text-rose-900 border-rose-900">
                <div class="w-4 h-4">${getIcon('ticket')}</div><span class="text-xs font-bold">チケット</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 右側：タスクリスト（カレンダーアイコン付き） -->
        <div class="solid-box flex flex-col min-h-0 relative">
          <div class="flex-none p-2 border-b-2 border-slate-800 flex justify-between items-center bg-slate-50 rounded-t-[6px]">
            <h2 class="text-sm font-black text-slate-800 flex items-center gap-1"><div class="w-4 h-4">${getIcon('task')}</div>タスク</h2>
            <!-- 期日の文字の代わりにカレンダーアイコン -->
            <button onclick="setView('calendar')" class="w-6 h-6 text-slate-600 hover:text-black transition">
              ${getIcon('calendar')}
            </button>
          </div>
          
          <div class="flex-1 overflow-y-auto p-2 space-y-2">
            ${activeTasks.length > 0 ? activeTasks.map(t => {
              // 簡易的に日数を計算
              const diff = t.deadline ? t.deadline - Date.now() : null;
              const days = diff ? Math.floor(diff / (1000 * 60 * 60 * 24)) : null;
              const timeTxt = diff === null ? '--' : (diff < 0 ? '終了' : (days > 0 ? `あと${days}日` : '今日'));
              const timeCol = diff !== null && diff < 0 ? 'text-red-500' : 'text-slate-500';

              let btn = '';
              if (state.role === 'child') {
                if (t.status === 'open') btn = `<button onclick="acceptTask('${t.id}')" class="bg-slate-800 text-white px-2 py-1 rounded text-[10px] font-bold shrink-0">${rb('受注','じゅちゅう')}</button>`;
                else if (t.status === 'accepted') btn = `<button onclick="completeTask('${t.id}')" class="bg-blue-500 text-white px-2 py-1 rounded text-[10px] font-bold shrink-0">${rb('完了','かんりょう')}</button>`;
                else btn = `<span class="text-[9px] text-slate-400 font-bold shrink-0">${rb('待機中','たいきちゅう')}</span>`;
              } else {
                if (t.status === 'completed') btn = `<button onclick="approveTask('${t.id}', ${t.points})" class="bg-blue-500 text-white px-2 py-1 rounded text-[10px] font-bold shrink-0">${rb('付与','ふよ')}</button>`;
                else if (t.status === 'proposed') btn = `<button onclick="approveProposal('${t.id}')" class="bg-slate-800 text-white px-2 py-1 rounded text-[10px] font-bold shrink-0">${rb('承認','しょうにん')}</button>`;
                else btn = `<span class="text-[9px] text-slate-400 font-bold shrink-0">${rb('未完了','みかんりょう')}</span>`;
              }

              return `
                <div class="border-b border-slate-200 pb-2 flex flex-col gap-1">
                  <div class="flex justify-between items-start">
                    <span class="font-bold text-xs text-slate-800 leading-tight">・${t.title}</span>
                    <span class="text-[9px] font-bold ${timeCol} whitespace-nowrap ml-1">${timeTxt}</span>
                  </div>
                  <div class="flex justify-between items-center pl-2 mt-1">
                    <span class="text-[10px] font-black text-blue-600">${t.points} pt</span>
                    ${btn}
                  </div>
                </div>
              `;
            }).join('') : `<p class="text-center text-xs font-bold text-slate-400 mt-4">タスクなし</p>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

// 共通モーダルラッパー
function renderModal(content) {
  return `
    <div class="flex-1 min-h-0 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm z-30 relative absolute inset-0">
      <div class="solid-box w-full max-h-full flex flex-col relative shadow-2xl">
        <button onclick="setView('home')" class="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 font-bold text-slate-400 transition z-10">✕</button>
        <div class="flex-1 overflow-y-auto p-6 min-h-0">
          ${content}
        </div>
      </div>
    </div>
  `;
}

// ★ 新機能：銀行（月0.1% 単利計算・小数点以下切り捨て）
function renderBank() {
  let totalDeposit = 0;
  let totalInterest = 0;

  state.banks.forEach(b => {
    const months = (Date.now() - b.createdAt) / (1000 * 60 * 60 * 24 * 30); // おおよその月数
    const interest = Math.floor(b.amount * (0.001 * months)); // 0.1%の利息（小数点切り捨て）
    totalDeposit += b.amount;
    totalInterest += interest;
  });

  const currentTotal = totalDeposit + totalInterest;

  return `
    <h2 class="text-xl font-black mb-4 border-b-2 border-emerald-800 pb-2 text-emerald-900 flex items-center gap-2"><div class="w-6 h-6">${getIcon('bank')}</div>${rb('銀行','ぎんこう')}</h2>
    <div class="solid-box p-4 bg-emerald-50 border-emerald-800 text-center mb-6">
      <p class="text-xs font-bold text-emerald-600 mb-1">${rb('預','あず')}金${rb('残高','ざんだか')}</p>
      <p class="text-3xl font-black text-emerald-900">${currentTotal.toLocaleString()} <span class="text-sm">pt</span></p>
      <p class="text-[10px] font-bold text-emerald-600 mt-2">（うち${rb('利息','りそく')}: +${totalInterest}pt）</p>
    </div>
    
    ${state.role === 'child' ? `
      <div class="flex gap-2 mb-4">
        <input type="number" id="bank-amount" placeholder="pt" class="flex-1 p-2 solid-box border-emerald-800 text-sm font-bold" />
        <button onclick="depositBank()" class="solid-btn px-4 text-xs font-bold bg-emerald-800 text-white">${rb('預','あず')}ける</button>
      </div>
      ${currentTotal > 0 ? `<button onclick="withdrawBank()" class="solid-btn w-full py-3 text-sm font-bold bg-white text-emerald-800 border-emerald-800">${rb('全額','ぜんがく')} ${rb('引','ひ')}き${rb('出','だ')}す</button>` : ''}
    ` : `<p class="text-xs text-center font-bold text-slate-500">${rb('子供','こども')}が${rb('預','あず')}けているお金です</p>`}
  `;
}

// ★ カレンダー画面（期日順タスク表示）
function renderCalendar() {
  const tasks = state.tasks.filter(t => t.deadline).sort((a, b) => a.deadline - b.deadline);
  return `
    <h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2 flex items-center gap-2"><div class="w-6 h-6">${getIcon('calendar')}</div>スケジュール</h2>
    <div class="space-y-3">
      ${tasks.length > 0 ? tasks.map(t => {
        const d = new Date(t.deadline);
        const dateStr = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
        return `
          <div class="solid-box p-3 bg-slate-50 flex justify-between items-center border-l-4 ${t.deadline < Date.now() ? 'border-red-500' : 'border-blue-500'}">
            <span class="font-bold text-sm">${t.title}</span>
            <span class="text-xs font-black ${t.deadline < Date.now() ? 'text-red-500' : 'text-blue-600'}">${dateStr}</span>
          </div>
        `;
      }).join('') : `<p class="text-sm font-bold text-slate-400 text-center">${rb('予定','よてい')}はありません</p>`}
    </div>
  `;
}

// ★ 新機能：風船を送る画面（親のみ）
function renderBalloonSend() {
  return `
    <h2 class="text-xl font-black mb-4 border-b-2 border-pink-800 pb-2 text-pink-900">🎈 ${rb('風船','ふうせん')}を${rb('送','おく')}る</h2>
    <p class="text-xs font-bold text-slate-500 mb-4">メッセージとコインを${rb('付','つ')}けて${rb('子供','こども')}にプレゼントします。</p>
    <input type="number" id="balloon-points" placeholder="${rb('送','おく')}るコイン (pt)" class="w-full p-3 solid-box border-pink-800 mb-4 font-bold text-sm" />
    <textarea id="balloon-message" placeholder="テスト100点おめでとう！" class="w-full p-3 solid-box border-pink-800 mb-6 font-bold text-sm h-24 resize-none"></textarea>
    <button onclick="sendBalloon()" class="solid-btn w-full py-3 bg-pink-600 text-white font-bold border-pink-800">${rb('空','そら')}へ${rb('放','はな')}つ</button>
  `;
}

// 投資画面（グラフ修正版）
function renderInvest() {
  const rates = getMarketRates();
  return `
    <h2 class="text-xl font-black mb-3 border-b-2 border-purple-800 pb-2 text-purple-900 flex items-center gap-2"><div class="w-6 h-6">${getIcon('invest')}</div>${rb('運用','うんよう')} (投資)</h2>
    <p class="text-[10px] font-bold text-slate-400 mb-2">グラフをなぞると${rb('金額','きんがく')}が${rb('見','み')}れます</p>
    <div class="solid-box w-full h-[180px] mb-4 relative p-2 bg-white shrink-0 border-purple-800">
      <canvas id="investChart"></canvas>
    </div>
    ${state.role === 'child' ? `
      <div class="flex gap-2 mb-4 shrink-0">
        <input type="number" id="invest-amount" placeholder="pt" class="flex-1 p-2 solid-box border-purple-800 text-sm font-bold" />
        <button onclick="investCustom('日本')" class="solid-btn px-4 text-xs font-bold bg-blue-800 text-white">日本</button>
        <button onclick="investCustom('アメリカ')" class="solid-btn px-4 text-xs font-bold bg-red-800 text-white">米国</button>
      </div>
    ` : ''}
    <h3 class="font-bold text-sm mb-2 shrink-0">${rb('所持','しょじ')}かぶ</h3>
    <div class="space-y-2">
      ${state.investments.length > 0 ? state.investments.map(inv => {
        const cur = inv.name === '日本' ? rates.日本[12] : rates.アメリカ[12];
        const val = Math.round((inv.shares || inv.investedPoints / cur) * cur);
        const diff = val - inv.investedPoints;
        const isUp = diff >= 0;
        return `
          <div class="solid-box p-3 bg-purple-50 border-purple-800 flex justify-between items-center">
            <div>
              <p class="font-black text-sm">${inv.name}</p>
              <p class="text-[10px] text-slate-500 font-bold">${rb('投資','とうし')}: ${inv.investedPoints} pt</p>
            </div>
            <div class="text-right mr-2">
              <p class="text-lg font-black ${isUp ? 'text-red-500' : 'text-blue-600'}">${val} pt</p>
              <p class="text-[10px] font-bold ${isUp ? 'text-red-500' : 'text-blue-600'}">${isUp ? '+' : ''}${diff}</p>
            </div>
            ${state.role === 'child' ? `<button onclick="sellCustom('${inv.id}', ${val})" class="solid-btn px-2 py-1 text-xs font-bold bg-white">${rb('売','う')}る</button>` : ''}
          </div>
        `;
      }).join('') : `<p class="text-xs font-bold text-slate-400 text-center">${rb('何','なに')}もありません</p>`}
    </div>
  `;
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
  
  const isDetail = state.view === 'invest';

  investChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: rates.labels,
      datasets: [
        { label: '日本', data: datasetJp, borderColor: '#1e40af', backgroundColor: 'rgba(30,64,175,0.1)', borderWidth: 2, tension: 0.2, pointRadius: isDetail?2:0, fill: isDetail },
        { label: 'アメリカ', data: datasetAm, borderColor: '#991b1b', backgroundColor: 'rgba(153,27,27,0.1)', borderWidth: 2, borderDash: [4, 4], tension: 0.2, pointRadius: isDetail?2:0, fill: isDetail }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: isDetail ? 400 : 0 },
      // ★ ここが「なぞるだけで両方表示される」魔法の設定！
      interaction: { mode: 'index', intersect: false },
      plugins: { 
        legend: { display: isDetail, position: 'bottom', labels: { boxWidth: 10, font: {size: 10} } }, 
        tooltip: { enabled: isDetail } 
      },
      scales: { 
        x: { display: isDetail, ticks: { font: {size: 9} } }, 
        y: { display: isDetail, ticks: { font: {size: 9} } } 
      },
      layout: { padding: isDetail ? 10 : 5 }
    }
  });
}

// --- その他のレンダー関数（中略・既存のままルビのみ追加） ---
function renderPropose() { return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">${rb('親','おや')}に${rb('見積','みつも')}りを${rb('出','だ')}す</h2><input type="text" id="prop-title" placeholder="なまえ" class="w-full p-3 solid-box mb-4 font-bold text-sm" /><div class="flex items-center gap-2 mb-4"><input type="number" id="prop-points" placeholder="pt" class="w-1/2 p-3 solid-box font-bold text-sm" /><span class="font-bold text-sm">pt</span></div><input type="datetime-local" id="prop-deadline" class="w-full p-3 solid-box mb-6 font-bold text-sm bg-slate-50" /><button onclick="proposeTask()" class="solid-btn w-full py-3 bg-slate-800 text-white font-bold">${rb('提案','ていあん')}を${rb('送','おく')}る</button>`; }
function renderTaskCreate() { return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">${rb('仕事','しごと')}を${rb('依頼','いらい')}する</h2><input type="text" id="task-title" placeholder="タイトル" class="w-full p-3 solid-box mb-4 font-bold text-sm" /><div class="flex items-center gap-2 mb-4"><input type="number" id="task-points" placeholder="pt" class="w-1/2 p-3 solid-box font-bold text-sm" /><span class="font-bold text-sm">pt</span></div><input type="datetime-local" id="task-deadline" class="w-full p-3 solid-box mb-6 font-bold text-sm bg-slate-50" /><button onclick="addTask()" class="solid-btn w-full py-3 bg-slate-800 text-white font-bold">${rb('追加','ついか')}する</button>`; }
function renderExchange() {
  const p = state.exchanges.filter(e => e.status === 'pending');
  if (state.role === 'child') return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2 flex items-center gap-2"><div class="w-6 h-6">${getIcon('exchange')}</div>${rb('現金','げんきん')}と${rb('交換','こうかん')}</h2><div class="flex items-center gap-2 mb-6"><input type="number" id="exchange-amount" placeholder="金額" class="flex-1 p-3 solid-box font-bold text-lg text-right" /><span class="font-black text-lg">${rb('円','えん')}</span></div><button onclick="requestExchange()" class="solid-btn w-full py-3 bg-slate-800 text-white font-bold mb-6">${rb('申請','しんせい')}する</button><div class="space-y-2">${p.map(e => `<div class="solid-box p-2 text-sm font-bold flex justify-between bg-slate-50"><span>${e.yen}円</span><span class="text-slate-500">${rb('承認待','しょうにんま')}ち</span></div>`).join('')}</div>`;
  else return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2">${rb('交換','こうかん')}の${rb('申請','しんせい')}</h2><div class="space-y-3">${p.length>0?p.map(e=>`<div class="solid-box p-4 bg-slate-50"><p class="font-black text-lg mb-3">${e.yen}円 を要求しています</p><div class="flex gap-2"><button onclick="approveExchange('${e.id}', ${e.points})" class="flex-1 solid-btn py-2 bg-slate-800 text-white font-bold text-sm">${rb('承認','しょうにん')}</button><button onclick="rejectExchange('${e.id}')" class="flex-1 solid-btn py-2 font-bold text-sm text-red-500">${rb('却下','きゃっか')}</button></div></div>`).join(''):`<p class="text-sm font-bold text-slate-400 text-center">ありません</p>`}</div>`;
}
function renderTickets() {
  const ts = state.tickets.filter(t => state.role === 'child' ? t.status === 'available' || t.status === 'bought' : true);
  return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2 flex items-center gap-2"><div class="w-6 h-6">${getIcon('ticket')}</div>チケット</h2>
  ${state.role === 'parent' ? `<div class="flex gap-2 mb-4"><input type="text" id="t-title" placeholder="名前" class="flex-1 p-2 solid-box text-sm font-bold" /><input type="number" id="t-pts" placeholder="pt" class="w-20 p-2 solid-box text-sm font-bold" /></div><button onclick="addTicket2()" class="solid-btn w-full py-2 bg-slate-800 text-white font-bold text-sm mb-4">${rb('追加','ついか')}</button>`:''}
  <div class="space-y-2">${ts.map(t=>{
    let btn = '';
    if(state.role==='child'){ if(t.status==='available') btn = `<button onclick="buyTicket('${t.id}',${t.price})" class="solid-btn px-2 py-1 text-xs font-bold bg-slate-800 text-white">${rb('買','か')}う</button>`; else btn = `<span class="text-[10px] bg-slate-200 px-2 py-1 rounded font-bold">${rb('所持中','しょじちゅう')}</span>`; }
    else { if(t.status==='available') btn = `<button onclick="deleteTicket('${t.id}')" class="text-xs font-bold text-red-500">削除</button>`; else if(t.status==='bought') btn = `<button onclick="useTicket('${t.id}')" class="solid-btn px-2 py-1 text-xs bg-slate-800 text-white">${rb('回収','かいしゅう')}</button>`; else btn = `<span class="text-xs text-slate-400">使用済</span>`; }
    return `<div class="solid-box p-3 ${t.status==='bought'?'bg-slate-800 text-white':'bg-slate-50'} flex justify-between items-center"><div><p class="font-bold text-sm">${t.title}</p><p class="text-xs font-black ${t.status==='bought'?'text-slate-300':'text-blue-600'}">${t.price} pt</p></div>${btn}</div>`;
  }).join('')}</div>`;
}
function renderHistory() {
  const app = state.tasks.filter(t => t.status === 'approved');
  const t = app.reduce((s, t) => s + t.points, 0);
  return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2 flex items-center gap-2"><div class="w-6 h-6">${getIcon('history')}</div>りれき</h2><div class="solid-box p-4 bg-slate-50 text-center mb-6"><p class="text-xs font-bold text-slate-500">${rb('稼','かせ')}いだ${rb('合計','ごうけい')}</p><p class="text-3xl font-black mt-1">${t.toLocaleString()} pt</p></div><div class="space-y-2">${app.map(t => `<div class="border-b border-slate-200 py-2 flex justify-between text-sm font-bold"><span>${t.title}</span><span class="text-slate-500">${t.points}pt</span></div>`).join('')}</div>`;
}
function renderSettings() {
  return `<h2 class="text-xl font-black mb-4 border-b-2 border-slate-800 pb-2 flex items-center gap-2"><div class="w-6 h-6">${getIcon('settings')}</div>${rb('設定','せってい')}</h2><div class="solid-box p-4 bg-slate-50 text-center mb-4"><p class="text-xs font-bold text-slate-500 mb-2">${rb('同期','どうき')}コード</p><p class="text-2xl font-mono font-black text-blue-600">${state.familyCode}</p></div>${state.role === 'child' ? `<div class="solid-box p-4 bg-white mb-6 flex justify-between items-center cursor-pointer" onclick="toggleFurigana()"><span class="font-bold text-sm">フリガナ(ルビ)を${rb('表示','ひょうじ')}</span><div class="w-10 h-5 rounded-full border-2 border-slate-800 flex items-center p-0.5 ${state.furigana ? 'bg-blue-500 justify-end' : 'bg-slate-200 justify-start'}"><div class="w-3 h-3 bg-white rounded-full border border-slate-800 shadow-sm"></div></div></div>` : '<div class="mb-6"></div>'}<button onclick="unlinkAccount()" class="solid-btn w-full py-3 border-red-500 text-red-500 font-bold">${rb('連携','れんけい')}を${rb('解除','かいじょ')}する</button>`;
}
function renderSetup() {
  appDiv.innerHTML = `<div class="h-full flex flex-col items-center justify-center p-6 bg-slate-900"><h1 class="text-5xl font-black text-white mb-10 tracking-tighter">Chibiz<span class="text-blue-500">.</span></h1><div class="w-full max-w-sm solid-box p-6 mb-6"><h3 class="font-bold text-slate-800 mb-4 text-center">親としてスタート</h3><button id="btn-create-parent" class="solid-btn w-full py-3 bg-slate-800 text-white font-bold">コードを発行</button></div><div class="w-full max-w-sm solid-box p-6 bg-slate-50"><h3 class="font-bold text-slate-800 mb-4 text-center">子供としてスタート</h3><input type="text" id="input-family-code" placeholder="コード" class="w-full p-3 solid-box rounded mb-4 text-center font-mono font-bold text-xl uppercase tracking-widest" /><button id="btn-join-child" class="solid-btn w-full py-3 bg-blue-500 text-white border-blue-600 font-bold">連携する</button></div></div>`;
  document.getElementById('btn-create-parent').addEventListener('click', async () => { const code = Math.random().toString(36).substring(2, 8).toUpperCase(); await setDoc(doc(db, "families", code), { points: 0 }); localStorage.setItem('chibiz_role', 'parent'); localStorage.setItem('chibiz_familyCode', code); state.role = 'parent'; state.familyCode = code; state.view = 'home'; setupListeners(); });
  document.getElementById('btn-join-child').addEventListener('click', async () => { const code = document.getElementById('input-family-code').value.toUpperCase().trim(); if (!code) return; const docSnap = await getDoc(doc(db, "families", code)); if (docSnap.exists()) { localStorage.setItem('chibiz_role', 'child'); localStorage.setItem('chibiz_familyCode', code); state.role = 'child'; state.familyCode = code; state.view = 'home'; setupListeners(); } else alert("コードが見つかりません。"); });
}

// --- イベント群 ---
window.unlinkAccount = () => { if (confirm("連携を解除しますか？")) { localStorage.clear(); window.location.reload(); } };
window.addTask = async () => { const t = document.getElementById('task-title').value; const p = parseInt(document.getElementById('task-points').value); const d = document.getElementById('task-deadline').value; if(t&&p) { await addDoc(collection(db, "tasks"), { familyCode: state.familyCode, title: t, points: p, deadline: d ? new Date(d).getTime() : null, status: 'open', createdAt: Date.now() }); setView('home'); } };
window.proposeTask = async () => { const t = document.getElementById('prop-title').value; const p = parseInt(document.getElementById('prop-points').value); const d = document.getElementById('prop-deadline').value; if(t&&p) { await addDoc(collection(db, "tasks"), { familyCode: state.familyCode, title: t, points: p, deadline: d ? new Date(d).getTime() : null, status: 'proposed', createdAt: Date.now() }); setView('home'); } };
window.approveTask = async (id, p) => { await updateDoc(doc(db, "tasks", id), { status: 'approved' }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) }); };
window.approveProposal = async (id) => updateDoc(doc(db, "tasks", id), { status: 'open' });
window.acceptTask = async (id) => updateDoc(doc(db, "tasks", id), { status: 'accepted' });
window.completeTask = async (id) => updateDoc(doc(db, "tasks", id), { status: 'completed' });
window.addTicket2 = async () => { const t = document.getElementById('t-title').value; const p = parseInt(document.getElementById('t-pts').value); if(t&&p) await addDoc(collection(db, "tickets"), { familyCode: state.familyCode, title: t, price: p, status: 'available', createdAt: Date.now() }); };
window.deleteTicket = async (id) => deleteDoc(doc(db, "tickets", id));
window.buyTicket = async (id, p) => { if (state.points < p) return alert("コイン不足"); await updateDoc(doc(db, "tickets", id), { status: 'bought' }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-p) }); };
window.useTicket = async (id) => updateDoc(doc(db, "tickets", id), { status: 'used' });
window.investCustom = async (name) => { const a = parseInt(document.getElementById('invest-amount').value); if (!a || state.points < a) return alert("コイン不足"); const r = name === '日本' ? getMarketRates().日本[12] : getMarketRates().アメリカ[12]; await updateDoc(doc(db, "families", state.familyCode), { points: increment(-a) }); const ex = state.investments.find(inv => inv.name === name); if (ex) { await updateDoc(doc(db, "investments", ex.id), { investedPoints: increment(a), shares: increment(a / r) }); } else { await addDoc(collection(db, "investments"), { familyCode: state.familyCode, name, investedPoints: a, shares: a / r, createdAt: Date.now() }); } setView('invest'); };
window.sellCustom = async (id, val) => { await updateDoc(doc(db, "families", state.familyCode), { points: increment(val) }); await deleteDoc(doc(db, "investments", id)); };
window.requestExchange = async () => { const a = parseInt(document.getElementById('exchange-amount').value); if (!a || state.points < a) return alert("コイン不足"); await addDoc(collection(db, "exchanges"), { familyCode: state.familyCode, points: a, yen: a, status: 'pending', createdAt: Date.now() }); setView('home'); };
window.approveExchange = async (id, p) => { if (state.points < p) return alert("コイン不足"); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-p) }); await updateDoc(doc(db, "exchanges", id), { status: 'approved' }); };
window.rejectExchange = async (id) => updateDoc(doc(db, "exchanges", id), { status: 'rejected' });

// 銀行操作
window.depositBank = async () => { const a = parseInt(document.getElementById('bank-amount').value); if (!a || state.points < a) return alert("コイン不足"); await updateDoc(doc(db, "families", state.familyCode), { points: increment(-a) }); await addDoc(collection(db, "banks"), { familyCode: state.familyCode, amount: a, createdAt: Date.now() }); setView('bank'); };
window.withdrawBank = async () => { let total = 0; state.banks.forEach(b => { const m = (Date.now() - b.createdAt) / (1000*60*60*24*30); total += b.amount + Math.floor(b.amount * (0.001 * m)); deleteDoc(doc(db, "banks", b.id)); }); await updateDoc(doc(db, "families", state.familyCode), { points: increment(total) }); setView('home'); alert(`${total}pt 引き出しました！`); };

// 風船操作
window.sendBalloon = async () => { const p = parseInt(document.getElementById('balloon-points').value); const m = document.getElementById('balloon-message').value; if(p){ await addDoc(collection(db, "balloons"), { familyCode: state.familyCode, points: p, message: m, status: 'unread', createdAt: Date.now() }); alert('送りました！🎈'); setView('home'); } };
window.openBalloon = async (id, p, m) => { alert(`🎈親からのメッセージ！\n\n「${m}」\n\nボーナス ${p} pt ゲット！`); await updateDoc(doc(db, "families", state.familyCode), { points: increment(p) }); await deleteDoc(doc(db, "balloons", id)); };

// Firebase 監視
function setupListeners() {
  if (!state.familyCode) return;
  onSnapshot(doc(db, "families", state.familyCode), (doc) => { if (doc.exists()) { state.points = doc.data().points || 0; render(); } });
  const watch = (colName, stateKey) => { onSnapshot(query(collection(db, colName), where("familyCode", "==", state.familyCode)), (snapshot) => { const arr = []; snapshot.forEach(d => arr.push({ id: d.id, ...d.data() })); arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); state[stateKey] = arr; render(); }); };
  watch("tasks", "tasks"); watch("tickets", "tickets"); watch("investments", "investments"); watch("exchanges", "exchanges"); watch("banks", "banks"); watch("balloons", "balloons");
}
if (state.familyCode) setupListeners(); else render();