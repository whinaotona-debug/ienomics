/**
 * 日経・S&P500・原油ETF・金ETFの終値を日付で揃えて market.csv にする。
 * GitHub Pages の公開時と、手元での更新に使う。
 */
const OUT = new URL('../market.csv', import.meta.url);
const DAYS = 420;

const SERIES = [
  { col: '日本', symbol: '^N225' },
  { col: 'アメリカ', symbol: '^GSPC' },
  { col: '原油', symbol: 'USO' },
  { col: '金', symbol: 'GLD' }
];

function ymd(unixSec) {
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

async function fetchChart(symbol) {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - DAYS * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 ienomics-market-update' }
  });
  if (!res.ok) throw new Error(`${symbol} ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const ts = result?.timestamp;
  const close = result?.indicators?.quote?.[0]?.close;
  if (!ts?.length || !close?.length) throw new Error(`${symbol} データなし`);
  const map = new Map();
  for (let i = 0; i < ts.length; i++) {
    const price = close[i];
    if (!Number.isFinite(price) || price <= 0) continue;
    map.set(ymd(ts[i]), Math.round(price * 100) / 100);
  }
  if (map.size < 10) throw new Error(`${symbol} 行が足りない`);
  return map;
}

function joinByDate(maps) {
  const dates = [...new Set(maps.flatMap(m => [...m.keys()]))].sort();
  const last = SERIES.map(() => null);
  const rows = [];
  for (const date of dates) {
    SERIES.forEach((_, i) => {
      if (maps[i].has(date)) last[i] = maps[i].get(date);
    });
    if (last.some(v => v == null)) continue;
    rows.push([date, ...last]);
  }
  return rows;
}

const maps = [];
for (const s of SERIES) {
  const map = await fetchChart(s.symbol);
  console.log(`${s.col} (${s.symbol}): ${map.size}日`);
  maps.push(map);
}

const rows = joinByDate(maps);
if (rows.length < 10) throw new Error('結合後の行が足りない');

const header = ['日付', ...SERIES.map(s => s.col)].join(',');
const body = rows.map(r => r.join(',')).join('\n');
const csv = `${header}\n${body}\n`;
await import('node:fs/promises').then(fs => fs.writeFile(OUT, csv, 'utf8'));

const first = rows[0][0];
const last = rows[rows.length - 1][0];
console.log(`wrote ${OUT.pathname}  ${rows.length}行  ${first} → ${last}`);
