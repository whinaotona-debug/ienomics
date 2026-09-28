/**
 * tane.html の分かち書きだけ借りて、銘柄の仕分けに使う。
 * Wikipedia検索も、ユーザーからおぼえることも、あたまの保存もしない。
 */
const SEED = [
  "なに", "だれ", "どこ", "いつ", "なぜ", "どうして",
  "わかる", "わからない", "おしえて", "おぼえる", "おぼえた",
  "ありがとう", "ごめん", "はい", "いいえ",
  "これ", "それ", "あれ", "この", "その",
  "さがす", "さがして", "みる", "きく", "いう",
  "ひと", "もの", "こと", "なまえ",
  "よい", "わるい", "おおきい", "ちいさい",
  "すき", "きらい",
  "わたし", "あなた", "いま", "まえ", "あと",
  "する", "した", "して", "ある", "いる", "ない",
  "だ", "です", "ます", "たい",
  "は", "が", "を", "に", "で", "と", "の", "も", "や", "か",
  "ね", "よ", "な", "わ", "って", "という", "とは", "から", "まで",
  "むずかしい", "やさしい", "もじ", "おおい", "ちがい", "あってる"
];

const BAGS = {
  日経平均: ["日経", "日経平均", "東証", "TOPIX", "トピックス", "株式", "株価", "JPX", "売買停止"],
  "S&P500": ["S&P", "SP500", "米国株", "アメリカ", "ダウ", "ナスダック", "FRB", "FOMC", "Federal", "Reserve", "SEC", "Treasury", "NY"],
  金: ["ゴールド", "金価格", "金相場", "金先物", "貴金属", "gold"],
  原油: ["原油", "石油", "WTI", "ガソリン", "OPEC", "petroleum", "crude"]
};

const SKIP_GOLD = ["金利", "金額", "資金", "現金", "税金", "罰金"];

const dict = [...new Set([
  ...SEED,
  ...Object.values(BAGS).flat()
])].filter(Boolean).sort((a, b) => b.length - a.length);

function normWord(w) {
  return String(w || "").normalize("NFKC").replace(/\s+/g, "").trim();
}

function tokenize(text) {
  const src = String(text || "").normalize("NFKC")
    .replace(/[「」『』()（）]/g, " ")
    .replace(/[、。．，,.!！?？]/g, " ")
    .trim();
  if (!src) return [];
  const out = [];
  src.split(/\s+/).forEach((chunk) => {
    let i = 0;
    while (i < chunk.length) {
      let found = "";
      for (let k = 0; k < dict.length; k++) {
        const w = dict[k];
        if (w && chunk.startsWith(w, i)) { found = w; break; }
      }
      if (found) {
        out.push(found);
        i += found.length;
      } else {
        let j = i + 1;
        while (j < chunk.length) {
          let hit = false;
          for (let k = 0; k < dict.length; k++) {
            if (chunk.startsWith(dict[k], j)) { hit = true; break; }
          }
          if (hit) break;
          j++;
        }
        out.push(chunk.slice(i, j));
        i = j;
      }
    }
  });
  return out.filter(Boolean).map(normWord);
}

export function sortTopic(title) {
  const t = String(title || "");
  if (SKIP_GOLD.some((w) => t.includes(w)) && !/(金価格|金相場|ゴールド|金先物)/.test(t)) {
    /* 金だけ誤爆しやすいので、金利などのときは金袋を見ない */
  }
  const tokens = tokenize(t);
  const low = t.toLowerCase();
  const scores = { 日経平均: 0, "S&P500": 0, 金: 0, 原油: 0 };
  for (const [topic, words] of Object.entries(BAGS)) {
    if (topic === "金" && SKIP_GOLD.some((w) => t.includes(w)) && !/(金価格|金相場|ゴールド)/.test(t)) continue;
    for (const w of words) {
      if (tokens.includes(w) || t.includes(w) || low.includes(w.toLowerCase())) scores[topic] += 1;
    }
  }
  if (/(?<![A-Za-z])oil(?![A-Za-z])/i.test(t) && !/boiler/i.test(t)) scores.原油 += 1;
  let best = "";
  let n = 0;
  for (const [topic, s] of Object.entries(scores)) {
    if (s > n) { n = s; best = topic; }
  }
  return n > 0 ? best : "";
}

export const sortTopicByTitle = sortTopic;
