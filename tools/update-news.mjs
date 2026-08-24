/**
 * 学び用RSS。AI学習・スクレイピング禁止が書いてある媒体は使わない。
 * 媒体の見出しは画面に出さない。Yahoo・Googleニュースは使わない。
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { groqLabelTitles } from './groq-sort.mjs';
import { sortTopic } from './tane-sort.mjs';

const OUT = new URL('../news.json', import.meta.url);
const MARKET_CSV = new URL('../market.csv', import.meta.url);

const FEEDS = [
  { name: '金融庁', href: 'https://www.fsa.go.jp/fsaNewsListAll_rss2.xml' },
  { name: '日本銀行', href: 'https://www.boj.or.jp/rss/whatsnew.xml' },
  { name: '日本銀行（統計）', href: 'https://www.boj.or.jp/rss/statistics.xml' },
  { name: 'JPX マーケットニュース', href: 'https://www.jpx.co.jp/rss/markets_news.xml' },
  { name: 'JPX お知らせ', href: 'https://www.jpx.co.jp/rss/jpx-news.xml' },
  { name: 'JPX 注意喚起', href: 'https://www.jpx.co.jp/rss/alerts.xml' },
  { name: 'METI Journal', href: 'https://journal.meti.go.jp/feed/' },
  { name: 'FRB', href: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  { name: 'SEC', href: 'https://www.sec.gov/news/pressreleases.rss' },
  { name: 'FRB 金利', href: 'https://www.federalreserve.gov/feeds/prates.xml' },
  { name: '毎日新聞 速報', href: 'https://mainichi.jp/rss/etc/mainichi-flash.rss' },
  { name: '朝日 ビジネス', href: 'https://www.asahi.com/rss/asahi/business.rdf' },
  { name: '朝日 国際', href: 'https://www.asahi.com/rss/asahi/international.rdf' },
  { name: 'Impress Watch', href: 'https://www.watch.impress.co.jp/data/rss/1.0/ipw/feed.rdf' },
  { name: 'PC Watch', href: 'https://pc.watch.impress.co.jp/data/rss/1.0/pcw/feed.rdf' },
  { name: 'INTERNET Watch', href: 'https://internet.watch.impress.co.jp/data/rss/1.0/iw/feed.rdf' },
  { name: 'GIGAZINE', href: 'https://gigazine.net/news/rss_2.0/' }
];

const FALLBACK_URLS = {
  日経平均: [
    'https://www.jpx.co.jp/news/index.html',
    'https://www.jpx.co.jp/markets/indices/n225/index.html',
    'https://www.fsa.go.jp/'
  ],
  'S&P500': [
    'https://www.federalreserve.gov/newsevents.htm',
    'https://www.sec.gov/news/pressreleases',
    'https://www.federalreserve.gov/releases/h15/'
  ],
  金: [
    'https://www.boj.or.jp/',
    'https://www.boj.or.jp/statistics/index.htm',
    'https://www.fsa.go.jp/'
  ],
  原油: [
    'https://journal.meti.go.jp/',
    'https://www.meti.go.jp/',
    'https://www.boj.or.jp/statistics/index.htm'
  ]
};

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
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseRssItems(xml) {
  const items = [];
  const chunks = String(xml || '').split(/<item[\s>]/i).slice(1);
  for (const chunk of chunks) {
    const body = chunk.split(/<\/item>/i)[0] || '';
    const title = decodeXml((body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
    const link = decodeXml((body.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    if (title && isHttpUrl(link)) items.push({ title, url: link });
  }
  return items;
}

function lastMovePct(col) {
  const text = readFileSync(fileURLToPath(MARKET_CSV), 'utf8');
  const rows = text.trim().split(/\r?\n/).slice(1).filter(Boolean);
  if (rows.length < 2) return 0;
  const idx = { 日本: 1, アメリカ: 2, 原油: 3, 金: 4 }[col];
  const a = Number(String(rows[rows.length - 2]).split(',')[idx]);
  const b = Number(String(rows[rows.length - 1]).split(',')[idx]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return 0;
  return ((b - a) / a) * 100;
}

function dirWord(pct) {
  if (pct > 0.4) return 'up';
  if (pct < -0.4) return 'down';
  return 'flat';
}

function composeExplain(about, pct) {
  const d = dirWord(pct);
  if (about === '日経平均') {
    const move = d === 'up'
      ? '直近は上昇した。買う人が売る人より多い局面だった、と読んでよい。'
      : d === 'down'
        ? '直近は下落した。売りが優勢だった記録に近く、金利や海外市場、投資家の慎重さも材料になりうる。'
        : '直近はほぼ横ばいだった。買いと売りが拮抗しているか、大きな材料が出ていないことが多い。';
    return {
      title: d === 'up' ? '日経平均は直近、上昇した' : d === 'down' ? '日経平均は直近、下落した' : '日経平均は直近、ほぼ横ばいだった',
      body: [
        `日経平均株価は、東京市場の代表的な企業の株価を平均した指数だ。${move}指数は「日本株全体のムード」の一面でしかなく、翌日に逆転することもある。一つの数字だけで将来を決めないのが基本だ。`,
        '個別企業ではなく、選ばれた銘柄の平均だから、市場全体の温度を見るのに使う。構成銘柄は入れ替わるし、値がさ株の影響が強い。ニュースでは指数そのものと、個別企業の決算や不祥事の話を分けて読むと混乱しにくい。',
        '学習のポイントは「なぜ動いたか」の仮説を立てることと、それが翌日も有効かは別問題だと知ること。短期の値動きに一喜一憂するより、金利・為替・海外市場との関係を追うほうが、12〜15歳の学びになる。'
      ].join('\n\n')
    };
  }
  if (about === 'S&P500') {
    const move = d === 'up'
      ? '直近は上昇した。金利見通しや企業決算が材料になりやすい。'
      : d === 'down'
        ? '直近は下落した。リスクを取りにくくなったサインのことがあるが、一日の下落が景気の終わりを意味するとは限らない。'
        : '直近はほぼ横ばいだった。新しい材料が少ないか、強気と弱気が打ち消し合っていることが多い。';
    return {
      title: d === 'up' ? 'S&P500は直近、上昇した' : d === 'down' ? 'S&P500は直近、下落した' : 'S&P500は直近、ほぼ横ばいだった',
      body: [
        `S&P500は米国の主要約500社で構成する株価指数で、世界の投資の基準になりやすい。${move}米国株の動きは、日本株や円ドルにも波及することがある。遠い市場でも価格は需給で決まる。`,
        '時価総額の大きい企業が指数に与える影響が大きい。ITや金融の比重が変わるだけで、指数の意味合いも変わる。日本から見るときは、円ドル相場とセットで考えると実感しやすい。米国は金利と雇用の指標が特に注目される。',
        '中央銀行の金利や、企業開示のルールに関する発表は、お金の借りやすさやリスクの取り方を変えることがある。原文を全部読む必要はない。「金融政策か、規制か、個別の処分か」と種類を分けるだけで十分だ。'
      ].join('\n\n')
    };
  }
  if (about === '金') {
    const move = d === 'up'
      ? '直近は上昇した。金利が低い、または先行きが不透明だと買われやすい、という説明がよく使われる。'
      : d === 'down'
        ? '直近は下落した。株式などリスク資産のほうに資金が向きやすい局面のことがある。逆も起こる。'
        : '直近はほぼ変わらなかった。為替や金利の材料が一段落していることが多い。';
    return {
      title: d === 'up' ? '金価格は直近、上昇した' : d === 'down' ? '金価格は直近、下落した' : '金価格は直近、ほぼ変わらなかった',
      body: [
        `金（ゴールド）は企業の利益では動かず、通貨の価値や金利、地政学リスクの影響を受けやすい。${move}配当はなく、株価指数とは別物として比較すると理解しやすい。「安全資産」というラベルだけで決めつけないほうがいい。`,
        '株は将来の利益の見込みで価格がつく。金は実物で、金利が高いと「利息のつかない金」は相対的に不利、と説明されることが多い。だから金と株を同時に見るときは、金利の方向を意識する。',
        '見出しの「金」はゴールドとは限らない。金額・資金・金利は金属の金ではない。学びでは金価格だけをこの欄に載せる。単語だけで分類すると誤るので、本文が実物資産の話かを確認する習慣が役に立つ。'
      ].join('\n\n')
    };
  }
  const move = d === 'up'
    ? '直近は上昇した。需要が増える、供給が絞られる、と見られると上がりやすい。'
    : d === 'down'
      ? '直近は下落した。輸送コスト低下の話にも、需要減のサインにも読める。産油国の方針や在庫統計で翌日にひっくり返りやすい。'
      : '直近はほぼ横ばいだった。需給が一時的に安定しているか、材料待ちのことがある。';
  return {
    title: d === 'up' ? '原油価格は直近、上昇した' : d === 'down' ? '原油価格は直近、下落した' : '原油価格は直近、ほぼ横ばいだった',
    body: [
      `原油は輸送燃料や化学製品の原料になる。${move}燃料コストは物価にもつながりうるので、株や為替と一緒に語られる。エネルギー価格は世界の出来事で急変しやすい。`,
      'ガソリン、航空燃料、プラスチックなどの上流にある。需要（景気や移動）と供給（産出・在庫・輸出規制）がずれると価格が動く。家計では「運ぶコスト」、企業では「原材料コスト」として効いてくる。',
      '産油地域の情勢、OPECプラスの方針、在庫発表などが材料になる。一日の下落を「これから安い」と決めない。エネルギーは国境を越えて取引される。'
    ].join('\n\n')
  };
}

async function fetchFeed(feed) {
  const res = await fetch(feed.href, {
    headers: { 'User-Agent': 'ienomics-rss-learn', Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`${feed.name} ${res.status}`);
  return parseRssItems(await res.text()).map(row => ({ ...row, source: feed.name }));
}

async function main() {
  const learned = [];
  for (const feed of FEEDS) {
    try {
      const items = await fetchFeed(feed);
      learned.push(...items);
      const tagged = items.filter(x => sortTopic(x.title));
      console.log(`${feed.name} ${items.length}件 語彙仕分け${tagged.length}`);
    } catch (e) {
      console.warn(String(e?.message || e));
    }
  }

  const taneOf = learned.map(x => sortTopic(x.title));
  const prefer = ['JPX マーケットニュース', 'FRB', 'FRB 金利', '日本銀行', 'METI Journal', 'SEC', '金融庁', 'JPX お知らせ'];
  const groqIdx = [];
  for (const name of prefer) {
    for (let i = 0; i < learned.length && groqIdx.length < 20; i++) {
      if (learned[i].source === name && !groqIdx.includes(i)) groqIdx.push(i);
    }
  }
  const groq = await groqLabelTitles(groqIdx.map(i => learned[i].title));
  const groqAt = new Map(groqIdx.map((i, j) => [i, groq?.[j] || '']));
  const topicOf = (row, i) => groqAt.get(i) || taneOf[i];

  const moves = {
    日経平均: lastMovePct('日本'),
    'S&P500': lastMovePct('アメリカ'),
    金: lastMovePct('金'),
    原油: lastMovePct('原油')
  };

  const pickOne = about => {
    for (let i = 0; i < learned.length; i++) {
      if (topicOf(learned[i], i) === about) return learned[i];
    }
    return { url: FALLBACK_URLS[about][0], source: '公式発表' };
  };

  const items = ['日経平均', 'S&P500', '金', '原油'].map(about => {
    const written = composeExplain(about, moves[about]);
    const hit = pickOne(about);
    return {
      about,
      title: written.title,
      body: written.body,
      url: hit.url,
      source: hit.source
    };
  });

  writeFileSync(
    fileURLToPath(OUT),
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      source: 'イエノミクス解説',
      learnedFrom: FEEDS.map(f => f.name),
      items
    }, null, 2) + '\n',
    'utf8'
  );
  console.log(`news.json ${items.length}件 学び${learned.length}件`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 0;
});
