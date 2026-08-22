/**
 * Google ニュース RSS から各銘柄10件取り、Gemini で子ども向けに3件選ぶ。
 * 本文は保存しない。タイトルとURLだけ news.json に書く。
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const OUT = new URL('../news.json', import.meta.url);
const KEY = String(process.env.GEMINI_API_KEY || '').trim();
const MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];

const TOPICS = [
  { about: '日経平均', q: '日経平均' },
  { about: 'S&P500', q: 'S&P 500' },
  { about: '金', q: '金 価格 OR ゴールド' },
  { about: '原油', q: '原油 価格 OR WTI' }
];

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseRssItems(xml, max = 10) {
  const items = [];
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < max) {
    const block = m[0];
    const title = decodeXml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const linkTag = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const guid = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const alt = block.match(/<atom:link[^>]+href="([^"]+)"/i);
    const url = decodeXml(linkTag?.[1] || guid?.[1] || alt?.[1] || '');
    if (!title || !isHttpUrl(url)) continue;
    items.push({ title: title.slice(0, 180), url });
  }
  return items;
}

async function searchTen(topic) {
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', topic.q);
  url.searchParams.set('hl', 'ja');
  url.searchParams.set('gl', 'JP');
  url.searchParams.set('ceid', 'JP:ja');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 ienomics-news-rss' }
  });
  if (!res.ok) throw new Error(`${topic.about} ${res.status}`);
  return parseRssItems(await res.text(), 10);
}

function geminiText(json) {
  const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
  return parts.map(p => p.text || '').join('').trim();
}

function parseIndexList(text, n) {
  const raw = String(text || '').replace(/```json|```/g, '').trim();
  const m = raw.match(/\[[\s\S]*?\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    for (const v of arr) {
      const i = Number(v);
      if (!Number.isInteger(i) || i < 1 || i > n || seen.has(i)) continue;
      seen.add(i);
      out.push(i);
    }
    return out;
  } catch {
    return [];
  }
}

async function geminiPick(prompt, n) {
  if (!KEY) return [];
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 80 }
  });
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
          body
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) continue;
      const ids = parseIndexList(geminiText(json), n);
      if (ids.length) return ids;
    } catch {
      // 次のモデルへ
    }
  }
  return [];
}

async function pickTop3(about, list) {
  if (list.length <= 3) return list;
  const numbered = list.map((x, i) => `${i + 1}. ${x.title}`).join('\n');
  const prompt = [
    '小学生でも意味が想像しやすい見出しを、わかりやすい順に3つ選んでください。',
    '政治や戦争の生々しい話、専門用語だらけの話は後ろにしてください。',
    '答えは番号だけのJSON配列。例: [2,5,1]',
    `テーマ: ${about}`,
    numbered
  ].join('\n');
  const ids = await geminiPick(prompt, list.length);
  const picked = [];
  const used = new Set();
  for (const i of ids) {
    picked.push(list[i - 1]);
    used.add(i - 1);
    if (picked.length === 3) break;
  }
  for (let i = 0; i < list.length && picked.length < 3; i++) {
    if (used.has(i)) continue;
    picked.push(list[i]);
  }
  return picked.slice(0, 3);
}

async function main() {
  const items = [];
  for (const topic of TOPICS) {
    try {
      const ten = await searchTen(topic);
      const top = await pickTop3(topic.about, ten);
      for (const row of top) {
        items.push({ about: topic.about, title: row.title, url: row.url });
      }
    } catch (e) {
      console.warn(String(e?.message || e));
    }
    await new Promise(r => setTimeout(r, 400));
  }

  if (!items.length) {
    console.warn('ニュースが1件も取れませんでした');
    return;
  }

  writeFileSync(
    fileURLToPath(OUT),
    JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2) + '\n',
    'utf8'
  );
  console.log(`news.json ${items.length}件`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 0;
});
