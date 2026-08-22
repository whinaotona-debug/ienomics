/**
 * GNews から日経・S&P500・金・原油の記事URLだけ取る。
 * 本文は保存しない（転載しない）。キーが無いときは news.json を触らない。
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const OUT = new URL('../news.json', import.meta.url);
const KEY = String(process.env.GNEWS_API_KEY || '').trim();

const TOPICS = [
  { about: '日経平均', q: '日経平均' },
  { about: 'S&P500', q: 'S&P 500' },
  { about: '金', q: '金 価格' },
  { about: '原油', q: '原油 価格' }
];

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

async function searchOne(topic) {
  const url = new URL('https://gnews.io/api/v4/search');
  url.searchParams.set('q', topic.q);
  url.searchParams.set('lang', 'ja');
  url.searchParams.set('max', '1');
  url.searchParams.set('apikey', KEY);
  const res = await fetch(url, { headers: { 'User-Agent': 'ienomics-news' } });
  if (!res.ok) throw new Error(`${topic.about} ${res.status}`);
  const json = await res.json();
  const art = json?.articles?.[0];
  const link = String(art?.url || '').trim();
  if (!isHttpUrl(link)) return null;
  return {
    about: topic.about,
    url: link,
    source: String(art?.source?.name || '').slice(0, 80)
  };
}

async function main() {
  if (!KEY) {
    console.warn('GNEWS_API_KEY が無いのでニュースは更新しません');
    return;
  }

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
