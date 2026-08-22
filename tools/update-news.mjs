/**
 * Google ニュースの RSS から、日経・S&P500・金・原油の記事URLだけ取る。
 * 本文は保存しない（転載しない）。APIキーは不要。
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const OUT = new URL('../news.json', import.meta.url);

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

function firstItemLink(xml) {
  const item = String(xml).match(/<item\b[\s\S]*?<\/item>/i);
  if (!item) return null;
  const block = item[0];
  const linkTag = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  const guid = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
  const alt = block.match(/<atom:link[^>]+href="([^"]+)"/i);
  const raw = decodeXml(linkTag?.[1] || guid?.[1] || alt?.[1] || '');
  return raw || null;
}

function sourceName(xml) {
  const item = String(xml).match(/<item\b[\s\S]*?<\/item>/i);
  if (!item) return '';
  const src = item[0].match(/<source[^>]*>([\s\S]*?)<\/source>/i);
  return decodeXml(src?.[1] || '').slice(0, 80);
}

async function searchOne(topic) {
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', topic.q);
  url.searchParams.set('hl', 'ja');
  url.searchParams.set('gl', 'JP');
  url.searchParams.set('ceid', 'JP:ja');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 ienomics-news-rss' }
  });
  if (!res.ok) throw new Error(`${topic.about} ${res.status}`);
  const xml = await res.text();
  const link = firstItemLink(xml);
  if (!isHttpUrl(link)) return null;
  return {
    about: topic.about,
    url: link,
    source: sourceName(xml)
  };
}

async function main() {
  const items = [];
  for (const topic of TOPICS) {
    try {
      const row = await searchOne(topic);
      if (row) items.push(row);
    } catch (e) {
      console.warn(String(e?.message || e));
    }
    await new Promise(r => setTimeout(r, 400));
  }

  if (!items.length) {
    console.warn('ニュースが1件も取れませんでした');
    return;
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    items
  };
  writeFileSync(fileURLToPath(OUT), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`news.json ${items.length}件`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 0;
});
