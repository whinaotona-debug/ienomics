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
    title: 'なぜ夜空の星は、昼間見えないのか',
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
    title: '台風の目は、なぜ静かになるのか',
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
    title: 'プラスチックは、石油からどうやってできるのか',
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
    title: '銀行は、預かったお金をたんすにしまっているのか',
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
    return {
      about: base.about,
      title: article?.title || base.title,
      body: (article?.body && article.body.length >= 400) ? article.body : base.body,
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
        `日経平均株価は、東京の証券取引所に上場している代表的な企業の株価を平均した指数だ。${move}指数は「日本株全体のムード」の一面でしかなく、翌日に逆転することもある。一つの数字だけで将来を決めないのが基本だ。`,
        '個別企業ではなく、選ばれた銘柄の平均だから、市場全体の温度を見るのに使う。構成銘柄は定期的に入れ替わる。値がさ株（1株あたりの値段が高い株）の動きが、平均を強く引っ張ることもある。',
        'ニュースでは、指数そのものの話と、ある会社の決算や不祥事の話を分けて読むと混乱しにくい。日経平均が下がっても、すべての会社が同じ理由で下がったとは限らない。逆に、指数が上がっても自分の知っている会社だけが上がったわけでもない。',
        '「なぜ動いたか」の仮説と、それが翌日も有効かは別問題だ。金利が上がると、お金を借りて事業を広げることが少し難しくなる、と説明されることが多い。為替（円とドルの交換レート）が動けば、輸出企業と輸入企業で影響の出方も変わる。',
        '海外市場、とくに米国株の動きは、翌朝の東京市場のスタート地点になりやすい。短期の値動きより、金利・為替・海外市場との関係を追うと、数字の意味が見えてくる。予想を当てることより、なぜその説明が使われるかを知ることが大事だ。'
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
        `S&P500は米国の主要約500社で構成する株価指数で、世界の投資の基準になりやすい。${move}米国株の動きは、日本株や円ドルにも波及することがある。遠い市場でも価格は、買いたい人と売りたい人のバランスで決まる。`,
        '時価総額（会社の値段の合計）が大きい企業が、指数に与える影響も大きい。ITや金融の比重が変わるだけで、指数の意味合いも変わる。日本から見るときは、円ドル相場とセットで考えると実感しやすい。',
        '米国では、中央銀行が決める政策金利と、雇用の統計が特に注目される。金利が高いと、借金をして投資する魅力が下がる、という説明がよく使われる。雇用が強いと景気は元気に見えるが、金利が下がりにくくなる、という見方もある。',
        '中央銀行の金利や、企業開示のルールに関する発表は、お金の借りやすさやリスクの取り方を変えることがある。原文を全部読む必要はない。「金融政策か、規制か、個別の処分か」と種類を分けるだけで十分だ。',
        'アメリカの取引時間は日本の夜にあたる。だから米国市場の結果は、翌朝のニュースや東京市場の始まり方に残りやすい。一日の上げ下げを「これからずっと」と決めない。指数は便利な温度計だが、世界のすべてを表すわけではない。'
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
        '金はアクセサリーや工業製品にも使われるが、価格の話では「投資や準備として持たれる実物」として語られることが多い。国の中央銀行が金を保有している、というニュースも、需給の材料として取り上げられる。',
        '見出しの「金」はゴールドとは限らない。金額・資金・金利は金属の金ではない。この欄は金価格の話だけにする。単語だけで分類すると誤るので、本文が実物資産の話かを確認する。',
        '円で見た金価格は、ドル建ての金価格と円ドル為替の両方の影響を受ける。ドルで下がっても円安なら、円建てはあまり下がらないこともある。一つの画面の数字が、どの通貨建てかを意識すると、混乱しにくい。'
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
      '産油地域の情勢、OPECプラスの方針、在庫発表などが材料になる。一日の下落を「これから安い」と決めない。エネルギーは国境を越えて取引される。',
      '原油にはいくつかの代表的な価格がある。米国のWTI、欧州のブレントなどだ。ニュースで「原油」とだけ書いてあっても、どの指標かは記事によって違う。比べるときは、同じ種類の価格かどうかを確かめる。',
      '日本は原油の多くを輸入に頼っている。原油高はガソリンや物流コストに波及しうる。ただし、税金や為替、在庫のタイミングで、ガソリンスタンドの値段が原油と同じ速さで動くとは限らない。数字を一つ見ただけで家計まで決めつけないのが大切だ。'
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
    return {
      about,
      title: article?.title || written.title,
      body: (article?.body && article.body.length >= 400) ? article.body : written.body,
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
