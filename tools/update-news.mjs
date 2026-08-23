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

function composeKids(about, pct) {
  const d = dirWord(pct);
  if (about === '日経平均') {
    if (d === 'up') {
      return {
        title: '日本の会社の株のねだんが、ちょっと上がったよ',
        body: '日本の大きな会社の株を集めた「日経平均」は、みんなの買い物みたいに、買う人が多いとねだんが上がるよ。今日は上がるほうに動いたみたい。ねだんは毎日変わるから、一回で一喜一憂しなくて大丈夫。'
      };
    }
    if (d === 'down') {
      return {
        title: '日本の会社の株のねだんが、ちょっと下がったよ',
        body: '株のねだんは、売りたい人が多いと下がるよ。会社の成績や世界のニュースで気持ちが変わるから、下がった日があっても、それがずっと続くとは限らないよ。'
      };
    }
    return {
      title: '日本の株のねだんは、きょうはあまり動かなかったよ',
      body: '日経平均は日本の会社の株の平均のねだんだよ。あまり動かない日は、買う人と売る人の力が近いとき。こういう日も普通にあるよ。'
    };
  }
  if (about === 'S&P500') {
    if (d === 'up') {
      return {
        title: 'アメリカの会社の株のねだんが、ちょっと上がったよ',
        body: 'S&P500は、アメリカの大きな会社をたくさん集めたものさしだよ。アメリカの金利や会社の話で動くことが多い。今日は上がるほうだったよ。'
      };
    }
    if (d === 'down') {
      return {
        title: 'アメリカの会社の株のねだんが、ちょっと下がったよ',
        body: '遠い国の株でも、ねだんは人と人の売り買いできまるよ。下がった日は、みんな少し慎重になっているサインのことがある。長く見るときは、一日だけでは決めないよ。'
      };
    }
    return {
      title: 'アメリカの株のねだんは、きょうはほぼ横ばいだよ',
      body: 'S&P500はアメリカ経済の温度計みたいなもの。大きく動かない日は、新しい大きなニュースが少なかった、ということでもあるよ。'
    };
  }
  if (about === '金') {
    if (d === 'up') {
      return {
        title: '金のねだんが、ちょっと上がったよ',
        body: '金はきらきらの金属で、世界中で買われているよ。お金のねだんや金利の話で、金を買いたい人が増えるとねだんが上がることがあるよ。'
      };
    }
    if (d === 'down') {
      return {
        title: '金のねだんが、ちょっと下がったよ',
        body: '金は「安心したいとき」に買われやすい、と言われるよ。下がった日は、ほかの資産のほうに気持ちが向いていることもある。一日の動きだけで判断しなくていいよ。'
      };
    }
    return {
      title: '金のねだんは、きょうはほぼ変わらなかったよ',
      body: '金は株とちがって会社の成績では動かない。世界のお金の話でゆっくり動くことが多いよ。'
    };
  }
  if (d === 'up') {
    return {
      title: '原油のねだんが、ちょっと上がったよ',
      body: '原油は車のガソリンや飛行機の燃料のもとだよ。世界で使う量と、掘る量がずれるとねだんが変わる。上がると、ものの運びにかかるお金も気になるよ。'
    };
  }
  if (d === 'down') {
    return {
      title: '原油のねだんが、ちょっと下がったよ',
      body: '原油が下がると、運ぶコストが楽になる話につながることもあるよ。ただしねだんは世界の出来事ですぐ変わるから、今日下がっても明日はどうかはわからないよ。'
    };
  }
  return {
    title: '原油のねだんは、きょうはあまり動かなかったよ',
    body: '原油は世界のエネルギーのもとになっているよ。動きが小さい日は、需要と供給のバランスが一時的に安定しているとき、と考えていいよ。'
  };
}

function composeKidsPack(about, pct) {
  const main = composeKids(about, pct);
  const extra = {
    日経平均: [
      {
        title: '日経平均は、日本の大きな会社をまとめたものさしだよ',
        body: 'ひとつひとつの会社の株ではなく、たくさんの会社を平均したものだから、「日本の会社全体の気分」が見えやすいよ。ニュースを見るときは、会社の名前より、みんなで買う気持ちが強いか弱いかに注目してみてね。'
      },
      {
        title: '株のねだんは、一日で決まらないよ',
        body: '今日の動きは大事だけど、明日また反対に動くこともあるよ。学びでは「なぜ上がった・下がったか」より、「売り買いの気持ちが毎日変わる」ことを覚えるのが先で大丈夫。'
      }
    ],
    'S&P500': [
      {
        title: 'S&P500は、アメリカの大きな会社の温度計だよ',
        body: '500社くらいの大きな会社をまとめて見るものさしだよ。アメリカの金利や仕事の話で動くことが多い。遠い国でも、ねだんの決まり方は日本と同じく売り買いだよ。'
      },
      {
        title: 'アメリカの発表は、世界の株にも届くよ',
        body: '中央銀行や会社のルールを決めるところの話は、お金を借りるやすさが変わるサインになることがあるよ。全部を読まなくていい。『お金の流れの話かな』と見当をつけるだけで学びになるよ。'
      }
    ],
    金: [
      {
        title: '金は、会社の成績では動かないねだんだよ',
        body: '株は会社のもうけで動くけど、金は金属そのもののねだんだよ。世界で安心したい気持ちが強いと買われやすい、と言われる。金利やお金の話とセットで出てくることが多いよ。'
      },
      {
        title: '「金」という言葉は、お金のことではないよ',
        body: 'ニュースの「金額」や「資金」は、きらきらの金属の金とはちがうよ。学びではゴールドのねだんの話だけを金として見る。まぎらわしい言葉は、まず中身を確かめてから分けよう。'
      }
    ],
    原油: [
      {
        title: '原油は、運ぶエネルギーのもとになっているよ',
        body: 'ガソリンや飛行機の燃料、ものを作る材料にもつながるよ。世界で使う量と掘る量がずれるとねだんが変わる。私たちの生活の「運ぶコスト」とつながっている、と覚えておこう。'
      },
      {
        title: '原油のニュースは、世界の出来事とセットで出やすいよ',
        body: 'どこかでたくさん使う、あまり掘れない、という話があるとねだんが動きやすいよ。一日の動きだけで「これからずっと」とは決めない。エネルギーは世界で分け合っている、がポイント。'
      }
    ]
  };
  return [main, ...extra[about]];
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

  const pickThree = about => {
    const seen = new Set();
    const hits = [];
    for (let i = 0; i < learned.length && hits.length < 3; i++) {
      if (topicOf(learned[i], i) !== about) continue;
      if (seen.has(learned[i].url)) continue;
      seen.add(learned[i].url);
      hits.push(learned[i]);
    }
    for (const url of FALLBACK_URLS[about]) {
      if (hits.length >= 3) break;
      if (seen.has(url)) continue;
      seen.add(url);
      hits.push({ url, source: '公式発表' });
    }
    return hits;
  };

  const items = ['日経平均', 'S&P500', '金', '原油'].flatMap(about => {
    const pack = composeKidsPack(about, moves[about]);
    const hits = pickThree(about);
    return pack.map((written, i) => ({
      about,
      title: written.title,
      body: written.body,
      url: hits[i].url,
      source: hits[i].source
    }));
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
