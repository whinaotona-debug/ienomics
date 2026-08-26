/**
 * 学び用RSS。AI学習・スクレイピング禁止が書いてある媒体は使わない。
 * 媒体の見出しは画面に出さない。Yahoo・Googleニュースは使わない。
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { labelTitles, writeKidsNews, writeWeekendKidsNews } from './groq-sort.mjs';
import { sortTopicByTitle } from './tane-sort.mjs';

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

const WEEKEND_FEEDS = [
  { name: 'NASA', href: 'https://www.nasa.gov/rss/dyn/breaking_news.rss' },
  { name: 'JAXA', href: 'https://www.jaxa.jp/rss/press.xml' },
  { name: '国立天文台', href: 'https://www.nao.ac.jp/feed/' },
  { name: '気象庁', href: 'https://www.jma.go.jp/bosai/forecast/rss.xml' },
  { name: '環境省', href: 'https://www.env.go.jp/press/rss.xml' },
  { name: 'GIGAZINE', href: 'https://gigazine.net/news/rss_2.0/' },
  { name: 'Impress Watch', href: 'https://www.watch.impress.co.jp/data/rss/1.0/ipw/feed.rdf' },
  { name: 'METI Journal', href: 'https://journal.meti.go.jp/feed/' }
];

const WEEKEND_SKIP = /株価|日経|ダウ|ナスダック|為替|円安|円高|決算|上場|戦争|爆撃|殺害|死亡事故|性被害/;
const WEEKEND_LIKE = /宇宙|惑星|火星|月|衛星|ロケット|星|銀河|恐竜|化石|深海|火山|地震|天気|台風|オーロラ|動物|昆虫|発明|実験|発見|ロボット|電池|水|海|森|お金|銀行|貯金/;

const WEEKEND_FALLBACK = [
  {
    about: '宇宙',
    title: '昼間の空にも星はある　見えにくいだけ',
    blurb: '昼は空が明るくて星の光がまける',
    topics: ['星は昼も出ている', '空気が光を散らして空が青い', '暗い場所だと星の数が見える'],
    body: [
      '星は昼も出ている。太陽の光が空気に散らばって空が明るくなり、星の光がまけてしまうだけだ。月のない暗い場所へ行くと、同じ目でも星の数がぐっと増えて見える。街の明かりが少ない山や海辺で、空が一層濃く見えるのはそのためだ。',
      '宇宙飛行士が地球の外で見る空は、昼側でも星が見えることがある。まぶしい太陽を隠せば、背景はほぼ真っ黒だからだ。空が青いのも、空気が青い光を散らすせいだ。空気のない月面では、空は黒く見える。',
      '双眼鏡で月のクレーターを探すと、「光と影」だけで立体に見える。望遠鏡がなくても、月の満ち欠けは毎日観察できる。同じ月なのに形が変わるのは、照らされている面と、こちらから見える面の関係が変わるからだ。',
      '流れ星は星が落ちてくるのではなく、小さな砂粒が大気に飛び込んで光っている。何分もかかると思って待つと、見えた瞬間にびっくりしやすい。観察の記録をノートに残すと、季節ごとの星座の移動にも気づける。',
      '値動きは休みでも、空の観察はいつでもできる。天気と月の明るさで見え方は変わる。暗い場所に目を慣らすのに数分かかることさえ知っておくと、星が増えたように感じられる。'
    ].join('\n\n'),
    url: 'https://www.nao.ac.jp/faq/',
    source: '国立天文台'
  },
  {
    about: '自然',
    title: '台風の「目」は一時的に静か　外側が一番強い',
    blurb: 'まんなかは穏やかでも、すぐ外は強風',
    topics: ['目では空気が下に降りる', '目の外側が一番風が強い', '通り過ぎたあと再び強まる'],
    body: [
      '台風は巨大な空気の渦だ。外側では雨風が強いのに、まんなかの「目」では空気が下に降りて雲が消え、比較的穏やかになることがある。目のすぐ外側が一番風が強い。渦の大きさは数百キロメートルに及ぶこともある。',
      'だから「少し晴れた」だけで安心はできない。目が通り過ぎると、反対側から再び強い風が吹く。気象衛星の写真で渦を見ると、地図の上の円が実は立体の空気の動きだとわかる。雨雲の帯が渦巻きになっている様子は、教科書の絵よりわかりやすい。',
      '天気予報は当てずっぽうではなく、気圧・水蒸気・風をコンピュータで先読みしている。計算には世界中の観測データが使われる。翌日の予定を立てるとき、警報の意味を読む練習になる。',
      '台風は海の暖かい水蒸気をエネルギーにする。海面水温が高いと発達しやすい、と説明されることが多い。上陸すると地面や山の摩擦で勢力が弱まることもあるが、大雨の被害は風が弱まってからも続くことがある。',
      '「接近」と「上陸」は意味が違う。ニュースの言葉を正確に読むと、避難の判断もしやすい。怖い数字だけを追うより、風・雨・高潮のどれが危ないかを分けることが大切だ。'
    ].join('\n\n'),
    url: 'https://www.jma.go.jp/jma/kishou/know/typhoon/1-1.html',
    source: '気象庁'
  },
  {
    about: 'くらし',
    title: 'ペットボトルのもとは原油の一部が多い',
    blurb: 'プラスチックは石油からできることが多い',
    topics: ['原油を分けて材料にする', '分子をつなげてプラスチックに', '分解しにくいのが課題'],
    body: [
      'ペットボトルもレジ袋も、もとをたどると原油の一部からできていることが多い。原油を加熱して分けると、ガソリンやナフサなど性質の違う液体になる。その小さな分子をつなげると、細長いプラスチックの鎖になる。',
      '軽い・さびない・好きな形にしやすい、という便利さの裏側で、自然には分解しにくい。燃やす・埋める・再利用する、のどれを選ぶかで地球への負荷が変わる。同じ「プラスチック」でも、種類によってリサイクルのしやすさは違う。',
      '身の回りの「何からできているか」を一つ調べると、工場と海と自分の買い物が一本の線でつながる。ラベルのマークは、その材料の手がかりになる。全部を暗記する必要はない。気になった一つを調べる習慣があれば十分だ。',
      '石油は燃料だけではない。服の繊維や、医療で使う器具の一部にも姿を変える。だから「石油を使わない」と一言で片づけるより、何に使われているかを知ることが先になる。',
      '減らす・繰り返し使う・分けて出す、の順番で考えると、くらしの工夫が見えてくる。完璧を目指さなくても、今週の買い物袋を一つ減らすことから始められる。'
    ].join('\n\n'),
    url: 'https://www.env.go.jp/recycle/plastic/',
    source: '環境省'
  },
  {
    about: 'お金',
    title: '銀行は預かったお金を全部しまっていない',
    blurb: '預金の一部は貸し出しに回る',
    topics: ['引き出し用に一部を残す', '残りは企業や家へ貸す', '利息はそのお礼の一部'],
    body: [
      '銀行に預けたお金は、金庫に全額眠っているわけではない。一部は引き出しに備え、残りは企業や家への貸し出しに回る。貸し出した先が利息を払い、その一部が預金者の利息になる。この循環が、銀行の基本的なしくみだ。',
      'みんなが同時に全額を下ろそうとすると足りなくなるので、国のしくみで備えがある。だから「預けた数字」と「金庫の紙幣」は同じ枚数とは限らない。通帳やアプリの数字は、権利の記録でもある。',
      '土日は株の取引所が閉まる。銀行のATMが動いていても、市場で値段が付く商品とは別の休み方だ。お金の置き場所を考える練習日にできる。現金・預金・投資では、すぐ使えるかどうかと、増えたり減ったりするかどうかが違う。',
      '利息は「お金を貸したお礼」に近い。預金者は銀行にお金を貸し、銀行は企業に貸し出す。金利が変わると、このお礼の大きさも変わる。だからニュースの「金利」は、銀行の話と株の話の両方に出てくる。',
      '暗証番号や振り込みの確認は、しくみを守るための約束だ。便利さと安全はセットで考える。分からない取引は、急いで押さない。お金の勉強は、難しい数式より、まず「誰が誰に何を預けているか」を追うことから始まる。'
    ].join('\n\n'),
    url: 'https://www.boj.or.jp/about/education/index.htm',
    source: '日本銀行'
  }
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
  const raw = String(xml || '');
  const chunks = raw.split(/<item[\s>]/i).slice(1);
  for (const chunk of chunks) {
    const body = chunk.split(/<\/item>/i)[0] || '';
    const title = decodeXml((body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
    const link = decodeXml((body.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]
      || (body.match(/<link[^>]+href=["']([^"']+)["']/i) || [])[1]
      || '').trim();
    if (title && isHttpUrl(link)) items.push({ title, url: link });
  }
  const entries = raw.split(/<entry[\s>]/i).slice(1);
  for (const chunk of entries) {
    const body = chunk.split(/<\/entry>/i)[0] || '';
    const title = decodeXml((body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
    const link = decodeXml((body.match(/<link[^>]+href=["']([^"']+)["']/i) || [])[1]
      || (body.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]
      || '').trim();
    if (title && isHttpUrl(link)) items.push({ title, url: link });
  }
  return items;
}

function japanWeekday(date = new Date()) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short' }).format(date);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? 1;
}

function isJapanWeekend() {
  const w = japanWeekday();
  return w === 0 || w === 6;
}

function writeNewsFile({ kind, learnedFrom, items }) {
  writeFileSync(
    fileURLToPath(OUT),
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      kind,
      source: 'イエノミクス解説',
      learnedFrom,
      items
    }, null, 2) + '\n',
    'utf8'
  );
}

function scoreWeekendTitle(title) {
  const t = String(title || '');
  if (WEEKEND_SKIP.test(t)) return -1;
  let n = 1;
  if (WEEKEND_LIKE.test(t)) n += 3;
  return n;
}

function guessWeekendAbout(title) {
  const t = String(title || '');
  if (/宇宙|惑星|火星|月|衛星|ロケット|星|銀河|NASA|JAXA/.test(t)) return '宇宙';
  if (/恐竜|化石|深海|火山|地震|天気|台風|オーロラ|動物|昆虫|海|森/.test(t)) return '自然';
  if (/お金|銀行|貯金|利息|物価|税/.test(t)) return 'お金';
  return 'くらし';
}

async function buildWeekendNews() {
  const learned = [];
  for (const feed of WEEKEND_FEEDS) {
    try {
      const items = await loadRssFeed(feed);
      learned.push(...items);
      console.log(`${feed.name} ${items.length}件（土日）`);
    } catch (e) {
      console.warn(String(e?.message || e));
    }
  }

  const ranked = learned
    .map(row => ({ ...row, score: scoreWeekendTitle(row.title) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const seen = new Set();
  const picks = [];
  for (const row of ranked) {
    if (picks.length >= 10) break;
    const key = row.title.slice(0, 24);
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(row);
  }

  const kids = await writeWeekendKidsNews(picks);
  const usedUrl = new Set();
  const takeUrl = about => {
    const hit = picks.find(p => guessWeekendAbout(p.title) === about && !usedUrl.has(p.url))
      || picks.find(p => !usedUrl.has(p.url));
    if (hit) usedUrl.add(hit.url);
    return hit;
  };

  const items = WEEKEND_FALLBACK.map(base => {
    const article = kids?.[base.about];
    const hit = takeUrl(base.about);
    const useAi = article?.body && article.body.length >= 400;
    return {
      about: base.about,
      title: useAi ? article.title : base.title,
      blurb: (useAi && article.blurb) ? article.blurb : base.blurb,
      topics: (useAi && Array.isArray(article.topics) && article.topics.length)
        ? article.topics.slice(0, 5)
        : base.topics,
      body: useAi ? article.body : base.body,
      url: hit?.url || base.url,
      source: hit?.source || base.source
    };
  });

  writeNewsFile({
    kind: 'weekend',
    learnedFrom: WEEKEND_FEEDS.map(f => f.name),
    items
  });
  console.log(`news.json 土日 ${items.length}件 材料${learned.length}件`);
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
  const abs = Number.isFinite(pct) ? Math.abs(pct).toFixed(1) : null;
  const arrow = pct > 0.4 ? '↑' : pct < -0.4 ? '↓' : '→';
  const d = dirWord(pct);

  if (about === '日経平均') {
    const title = d === 'up'
      ? `日経平均が上昇　買う人が優勢に`
      : d === 'down'
        ? `日経平均が下落　売りが優勢に`
        : `日経平均はほぼ横ばい　材料待ちの一日`;
    const blurb = abs
      ? `日経平均${arrow} 約${abs}%　${d === 'up' ? '買い優勢' : d === 'down' ? '売り優勢' : '様子見'}`
      : title;
    return {
      title,
      blurb,
      topics: [
        d === 'up' ? '代表的な日本株の平均が上がった' : d === 'down' ? '代表的な日本株の平均が下がった' : '上げ下げが小さく、材料待ち',
        '金利・為替・海外市場が材料になりやすい',
        '指数が動いても、全銘柄が同じ理由とは限らない'
      ],
      body: [
        `日経平均は、東京の証券取引所に上場する代表企業の株価を平均した指数だ。${d === 'up' ? '直近は上がった' : d === 'down' ? '直近は下がった' : '直近はほぼ横ばいだった'}。${abs ? `変化は約${abs}%だ。` : ''}買う人と売る人のどちらが多いかが、この数字に表れる。`,
        'ニュースでは「日本株全体のムード」として紹介されることが多い。ただし翌日に逆転することもある。一つの数字だけで将来を決めないのが基本だ。',
        '値がさ株（1株の値段が高い株）の動きが平均を強く引っ張ることがある。日経平均が下がっても、すべての会社が同じ理由で下がったとは限らない。',
        '金利が上がると、お金を借りて事業を広げることが少し難しくなる、と説明されることが多い。円とドルの交換レートが動けば、輸出企業と輸入企業で影響の出方も変わる。',
        '米国株の結果は翌朝の東京に残りやすい。短期の値動きより、金利・為替・海外市場との関係を追うと、数字の意味が見えてくる。'
      ].join('\n\n')
    };
  }

  if (about === 'S&P500') {
    const title = d === 'up'
      ? `S&P500が上昇　米国の主要株が買われる`
      : d === 'down'
        ? `S&P500が下落　リスクを取りにくい一日`
        : `S&P500はほぼ横ばい　強気と弱気が拮抗`;
    const blurb = abs
      ? `S&P500${arrow} 約${abs}%　${d === 'up' ? '米国株に買い' : d === 'down' ? '慎重ムード' : '様子見'}`
      : title;
    return {
      title,
      blurb,
      topics: [
        '米国の主要約500社の平均を見る指数',
        '金利と雇用の発表が注目されやすい',
        '日本株や円ドルにも波及することがある'
      ],
      body: [
        `S&P500は米国の主要約500社でつくる指数だ。${d === 'up' ? '直近は上がった' : d === 'down' ? '直近は下がった' : '直近はほぼ横ばいだった'}。${abs ? `変化は約${abs}%だ。` : ''}世界の投資の基準になりやすい。`,
        '時価総額が大きい企業ほど指数への影響が大きい。ITや金融の比重が変わるだけで、指数の意味合いも変わる。',
        '中央銀行の金利や雇用統計が材料になりやすい。金利が高いと、借金をして投資する魅力が下がる、という説明がよく使われる。',
        '米国の取引時間は日本の夜にあたる。だから結果は翌朝のニュースや東京市場の始まり方に残りやすい。',
        '一日の上げ下げを「これからずっと」と決めない。指数は便利な温度計だが、世界のすべてを表すわけではない。'
      ].join('\n\n')
    };
  }

  if (about === '金') {
    const title = d === 'up'
      ? `金価格が上昇　利息のつかない資産が買われる`
      : d === 'down'
        ? `金価格が下落　株などへ資金が向きやすい`
        : `金価格はほぼ変わらず　金利・為替は一段落`;
    const blurb = abs
      ? `金${arrow} 約${abs}%　${d === 'up' ? '買われやすい局面' : d === 'down' ? '売り優勢' : '動き小さめ'}`
      : title;
    return {
      title,
      blurb,
      topics: [
        '金は企業の利益ではなく、金利や不安で動きやすい',
        '配当はない。株とは別物として比べる',
        '円建ての値段はドルと為替の両方の影響を受ける'
      ],
      body: [
        `金（ゴールド）の価格は、${d === 'up' ? '直近は上がった' : d === 'down' ? '直近は下がった' : '直近はほぼ変わらなかった'}。${abs ? `変化は約${abs}%だ。` : ''}企業の利益ではなく、通貨の価値や金利、先行きの不安で動きやすい。`,
        '金利が高いと「利息のつかない金」は相対的に不利、と説明されることが多い。だから金と株を同時に見るときは、金利の方向を意識する。',
        '金はアクセサリーや工業製品にも使われるが、価格のニュースでは投資や準備として持たれる実物として語られることが多い。',
        '見出しの「金」はゴールドとは限らない。金額・資金・金利は金属の金ではない。この欄は金価格の話だけにする。',
        '円で見た金価格は、ドル建ての金価格と円ドル為替の両方の影響を受ける。一つの画面の数字がどの通貨建てかを意識すると混乱しにくい。'
      ].join('\n\n')
    };
  }

  const title = d === 'up'
    ? `原油が上昇　運ぶコストの話題が出やすい`
    : d === 'down'
      ? `原油が下落　ガソリンや輸送コストの話に`
      : `原油はほぼ横ばい　需給は様子見`;
  const blurb = abs
    ? `原油${arrow} 約${abs}%　${d === 'up' ? '運ぶコストが意識される' : d === 'down' ? 'コストが軽くなる話も' : '材料待ち'}`
    : title;
  return {
    title,
    blurb,
    topics: [
      d === 'up' ? '原油高は燃料や物流の話題につながりやすい' : d === 'down' ? '原油安は運ぶコストが軽くなる話になりやすい' : '需給が一時的に安定、または材料待ち',
      'ガソリン・航空燃料・プラスチックの上流にある',
      '産油国の方針や在庫発表で翌日に動きやすい'
    ],
    body: [
      `原油は、${d === 'up' ? '直近は上がった' : d === 'down' ? '直近は下がった' : '直近はほぼ横ばいだった'}。${abs ? `変化は約${abs}%だ。` : ''}輸送燃料や化学製品の原料になるので、物価や企業のコストの話題と一緒に語られる。`,
      '需要（景気や移動）と供給（産出・在庫・輸出規制）がずれると価格が動く。家計では「運ぶコスト」、企業では「原材料コスト」として効いてくる。',
      '産油地域の情勢、OPECプラスの方針、在庫発表などが材料になる。一日の下落を「これから安い」と決めない。',
      '原油にはWTIやブレントなど代表的な価格がある。ニュースで「原油」とだけ書いてあっても、どの指標かは記事によって違う。',
      '日本は原油の多くを輸入に頼っている。税金や為替、在庫のタイミングで、ガソリンスタンドの値段が原油と同じ速さで動くとは限らない。'
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

async function loadRssFeed(feed) {
  return fetchFeed(feed);
}

async function main() {
  if (isJapanWeekend()) {
    await buildWeekendNews();
    return;
  }

  const learned = [];
  for (const feed of FEEDS) {
    try {
      const items = await loadRssFeed(feed);
      learned.push(...items);
      const tagged = items.filter(x => sortTopicByTitle(x.title));
      console.log(`${feed.name} ${items.length}件 語彙仕分け${tagged.length}`);
    } catch (e) {
      console.warn(String(e?.message || e));
    }
  }

  const taneOf = learned.map(x => sortTopicByTitle(x.title));
  const prefer = ['JPX マーケットニュース', 'FRB', 'FRB 金利', '日本銀行', 'METI Journal', 'SEC', '金融庁', 'JPX お知らせ'];
  const groqIdx = [];
  for (const name of prefer) {
    for (let i = 0; i < learned.length && groqIdx.length < 20; i++) {
      if (learned[i].source === name && !groqIdx.includes(i)) groqIdx.push(i);
    }
  }
  const groq = await labelTitles(groqIdx.map(i => learned[i].title));
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

  const briefs = ['日経平均', 'S&P500', '金', '原油'].map(about => {
    const hit = pickOne(about);
    return { about, pct: moves[about], headline: hit.title || '', hit };
  });
  const kids = await writeKidsNews(briefs.map(({ about, pct, headline }) => ({ about, pct, headline })));

  const items = briefs.map(({ about, hit }) => {
    const written = composeExplain(about, moves[about]);
    const article = kids?.[about];
    const useAi = article?.body && article.body.length >= 400;
    return {
      about,
      title: useAi ? article.title : written.title,
      blurb: (useAi && article.blurb) ? article.blurb : written.blurb,
      topics: (useAi && Array.isArray(article.topics) && article.topics.length)
        ? article.topics.slice(0, 5)
        : written.topics,
      body: useAi ? article.body : written.body,
      url: hit.url,
      source: hit.source
    };
  });

  writeNewsFile({
    kind: 'market',
    learnedFrom: FEEDS.map(f => f.name),
    items
  });
  console.log(`news.json ${items.length}件 学び${learned.length}件`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 0;
});
