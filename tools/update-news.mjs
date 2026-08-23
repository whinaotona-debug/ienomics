/**
 * GDELT DOC 2.0 から各銘柄の記事見出しとURLを取る。
 * 本文は保存しない。NHK・Yahooなどの媒体RSSは使わない。
 * 利用時は https://www.gdeltproject.org/ への出典が必要。
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const OUT = new URL('../news.json', import.meta.url);
const GAP_MS = 8000;

async function gdeltFetch(href) {
  return fetch(href, {
    headers: { Accept: 'application/json', 'User-Agent': 'ienomics-gdelt-news' },
    signal: AbortSignal.timeout(90000)
  });
}

const TOPICS = [
  {
    about: '日経平均',
    query: '(Nikkei OR "Nikkei 225" OR 日経平均) sourcelang:japanese',
    hints: ['日経', 'nikkei', '平均', '株', '東証', 'topix', '株価']
  },
  {
    about: 'S&P500',
    query: '(S&P OR SP500 OR 米国株) sourcelang:japanese',
    hints: ['s&p', 'sp500', '米国株', 'アメリカ', 'ダウ', 'ナスダック', 'ウォール']
  },
  {
    about: '金',
    query: '(ゴールド OR 金価格 OR 金相場 OR "gold price") sourcelang:japanese',
    hints: ['ゴールド', 'gold', '金価格', '金相場', '金先物', '貴金属']
  },
  {
    about: '原油',
    query: '(原油 OR WTI OR 石油価格) sourcelang:japanese',
    hints: ['原油', '石油', 'wti', 'oil', 'ガソリン']
  }
];

const SKIP_HARD = /レイプ|性的|自殺/;
const SKIP_SOFT = /逮捕|疑惑/;
const BOOST_EASY = /なぜ|とは|解説|しくみ|仕組み|わかり|上が|下が|円安|円高|高い|安い|初めて/;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function cleanTitle(raw) {
  let t = String(raw || '');
  t = t.replace(/_\s*x[0-9A-Fa-f]{4}\s*_/g, '');
  t = t.replace(/[\u0000-\u001f]/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/([ぁ-んァ-ン一-龥々ー])\s+(?=[ぁ-んァ-ン一-龥々ー「」『』（）％])/g, '$1');
  t = t.replace(/\s*[|｜]\s*[^|｜]+$/, '');
  t = t.replace(/\s+[-–—]\s*(日経|ロイター|朝日|毎日|読売|共同|時事).*$/, '');
  return t.slice(0, 160);
}

function titleLooksLikeSiteName(title, domain) {
  const d = String(domain || '').replace(/^www\./, '');
  const n = title.replace(/\s/g, '');
  if (n.length < 8) return true;
  if (d && n === d.replace(/\./g, '')) return true;
  return /ONLINE$|公式サイト$/.test(title) && n.length < 18;
}

function hoursAgo(seendate) {
  const m = String(seendate || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return 72;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return (Date.now() - ms) / 3600000;
}

function scoreArticle(topic, art) {
  const title = art.title;
  const low = title.toLowerCase();
  let s = 40;

  if (art.language === 'Japanese') s += 18;
  if (art.sourcecountry === 'Japan') s += 10;
  if (SKIP_HARD.test(title)) s -= 80;
  if (SKIP_SOFT.test(title)) s -= 18;
  if (BOOST_EASY.test(title)) s += 16;

  const hit = topic.hints.some(h => low.includes(h.toLowerCase()) || title.includes(h));
  s += hit ? 22 : -12;

  const len = title.length;
  if (len >= 16 && len <= 72) s += 10;
  else if (len > 100) s -= 8;
  else if (len < 12) s -= 20;

  const age = hoursAgo(art.seendate);
  if (age <= 24) s += 12;
  else if (age <= 72) s += 4;
  else s -= 6;

  if (/[！!]{2,}|[？?]{2,}/.test(title)) s -= 6;
  return s;
}

function keepForTopic(topic, title) {
  if (SKIP_HARD.test(title)) return false;
  if (/金総書記|金正恩|金銭疑惑/.test(title)) return false;
  if (topic.about === '金') return /(ゴールド|金価格|金相場|金先物|貴金属|\bgold\b)/i.test(title);
  if (topic.about === '原油') return /(原油|石油|WTI|\boil\b|ガソリン)/i.test(title);
  if (topic.about === '日経平均') return /(日経|株価|TOPIX|東証|株式)/i.test(title);
  if (topic.about === 'S&P500') return /(S&P|SP500|米国株|ダウ|ナスダック|ウォール|NY株|ニューヨーク)/i.test(title);
  return true;
}

function pickTop5(topic, list) {
  const ranked = [...list].sort((a, b) => b.score - a.score);
  const out = [];
  const hostCount = new Map();
  for (const row of ranked) {
    if (row.score < 0) continue;
    const host = (() => {
      try { return new URL(row.url).hostname.replace(/^www\./, ''); } catch { return row.domain || ''; }
    })();
    if (host && (hostCount.get(host) || 0) >= 2) continue;
    const dup = out.some(x => x.title.slice(0, 18) === row.title.slice(0, 18));
    if (dup) continue;
    out.push(row);
    if (host) hostCount.set(host, (hostCount.get(host) || 0) + 1);
    if (out.length === 5) break;
  }
  if (out.length < 5) {
    for (const row of ranked) {
      if (out.includes(row)) continue;
      out.push(row);
      if (out.length === 5) break;
    }
  }
  return out.slice(0, 5);
}

async function searchTopic(topic) {
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', topic.query);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('maxrecords', '40');
  url.searchParams.set('timespan', '3d');
  url.searchParams.set('sort', 'DateDesc');
  url.searchParams.set('format', 'json');

  let lastErr = '';
  for (let i = 0; i < 2; i++) {
    try {
      const res = await gdeltFetch(url.href);
      if (res.status === 429) {
        lastErr = '429';
        await sleep(15000);
        continue;
      }
      if (!res.ok) throw new Error(`${topic.about} ${res.status}`);
      const text = await res.text();
      if (/limit requests/i.test(text)) {
        lastErr = '429';
        await sleep(15000);
        continue;
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`${topic.about} JSONではない`);
      }
      const raw = Array.isArray(json?.articles) ? json.articles : [];
      const seen = new Set();
      const list = [];
      for (const a of raw) {
        const title = cleanTitle(a?.title);
        const link = String(a?.url || '').trim();
        if (!title || !isHttpUrl(link)) continue;
        if (titleLooksLikeSiteName(title, a?.domain)) continue;
        if (!keepForTopic(topic, title)) continue;
        const key = link.replace(/[?#].*$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        const row = {
          title,
          url: link,
          domain: String(a?.domain || ''),
          language: String(a?.language || ''),
          sourcecountry: String(a?.sourcecountry || ''),
          seendate: String(a?.seendate || '')
        };
        row.score = scoreArticle(topic, row);
        list.push(row);
      }
      return list;
    } catch (e) {
      lastErr = String(e?.code || e?.cause?.code || e?.message || e);
      await sleep(8000);
    }
  }
  throw new Error(`${topic.about} ${lastErr || '取得失敗'}`);
}

function toOutput(topic, row) {
  return {
    about: topic.about,
    title: row.title,
    url: row.url,
    source: String(row.domain || '').replace(/^www\./, '')
  };
}

async function main() {
  await sleep(GAP_MS);
  const items = [];
  for (let i = 0; i < TOPICS.length; i++) {
    const topic = TOPICS[i];
    if (i > 0) await sleep(GAP_MS);
    let found = [];
    try {
      found = await searchTopic(topic);
    } catch (e) {
      console.warn(String(e?.message || e));
    }

    const top = pickTop5(topic, found);
    for (const row of top) items.push(toOutput(topic, row));
    console.log(`${topic.about} 候補${found.length} → ${top.length}件`);
  }

  if (!items.length) {
    console.warn('ニュースが1件も取れませんでした');
    return;
  }

  writeFileSync(
    fileURLToPath(OUT),
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      source: 'GDELT Project',
      sourceUrl: 'https://www.gdeltproject.org/',
      items
    }, null, 2) + '\n',
    'utf8'
  );
  console.log(`news.json ${items.length}件`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 0;
});
