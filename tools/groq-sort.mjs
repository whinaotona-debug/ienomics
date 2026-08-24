/**
 * Groq（gpt-oss）。子ども向け画面からは呼ばない。キーが無いときは null。
 * 無料枠が狭いので、仕分け1回・子供新聞1回まで。
 */
const MODEL = 'openai/gpt-oss-20b';
const TOPIC_LIST = ['日経平均', 'S&P500', '金', '原油', 'なし'];
const TOPICS = new Set(TOPIC_LIST);

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          topic: { type: 'string', enum: TOPIC_LIST }
        },
        required: ['i', 'topic'],
        additionalProperties: false
      }
    }
  },
  required: ['items'],
  additionalProperties: false
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseTopics(text, n) {
  const out = Array(n).fill('');
  let json;
  try {
    json = JSON.parse(String(text || '').replace(/^```json\s*|\s*```$/g, '').trim());
  } catch {
    return out;
  }
  const rows = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : [];
  for (const row of rows) {
    const i = Number(row?.i);
    const topic = String(row?.topic || '').trim();
    if (!Number.isInteger(i) || i < 0 || i >= n) continue;
    if (TOPICS.has(topic) && topic !== 'なし') out[i] = topic;
  }
  return out;
}

function retryWaitMs(res, body) {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header, 45) * 1000;
  const reset = String(body || '').match(/try again in ([\d.]+)s/i);
  if (reset) return Math.min(Number(reset[1]), 45) * 1000;
  return 20000;
}

async function groqChat(key, titles) {
  const numbered = titles.map((t, i) => `${i}: ${t}`).join('\n');
  const payload = {
    model: MODEL,
    temperature: 0,
    max_tokens: 800,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'topics', strict: true, schema: SCHEMA }
    },
    messages: [
      {
        role: 'system',
        content: 'Classify each headline into exactly one topic. Gold means gold price only, not money or interest. JSON only.'
      },
      { role: 'user', content: numbered }
    ]
  };

  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000)
    });
    const body = await res.text();
    if (res.status === 429) {
      last = `${MODEL} 429`;
      await sleep(retryWaitMs(res, body));
      continue;
    }
    if (!res.ok) throw new Error(`${MODEL} ${res.status} ${body.slice(0, 180)}`);
    const json = JSON.parse(body);
    const text = json?.choices?.[0]?.message?.content || '';
    return parseTopics(text, titles.length);
  }
  throw new Error(last || `${MODEL} 429`);
}

function groqKey() {
  return String(process.env.GROQ_API_KEY || process.env.GROQ_API_KEY || '').trim();
}

export async function groqLabelTitles(titles) {
  const key = groqKey();
  if (!key || !titles.length) return null;
  try {
    const labels = await groqChat(key, titles);
    console.log(`Groq仕分け ${labels.filter(Boolean).length}/${titles.length} ${MODEL}`);
    return labels;
  } catch (e) {
    console.warn(String(e?.message || e));
    return null;
  }
}

const ABOUTS = ['日経平均', 'S&P500', '金', '原油'];

const WRITE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          about: { type: 'string', enum: ABOUTS },
          title: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['about', 'title', 'body'],
        additionalProperties: false
      }
    }
  },
  required: ['items'],
  additionalProperties: false
};

const KIDS_PAPER_PROMPT = [
  'あなたは小中学生向けの子供新聞を作る人です。',
  '今から出すことを子供新聞を作ると思ってまとめてください。',
  '前置きは不要です。',
  '子供新聞の文字や記事に関係ないことも書いてはいけません。',
  '記事の内容だけを書いてください。',
  '',
  'あいさつ、自己紹介、対象年齢、学年、「学びになる」「勉強になる」という注釈、出典、参考、リンク、まとめ、注意書き、AIであることの説明、元の文章の丸写しは書かない。',
  '見出しは短く。本文はやさしい日本語で2段落か3段落。将来を断定しない。'
].join('\n');

function looksLikeMeta(s) {
  return /12.?15.?歳|対象年齢|学びになる|学習のポイント|勉強になる|わかりやすくまと|子供新聞を作|小中学生向けです|前置き|出典|参考は|まとめました/.test(String(s || ''));
}

function parseKidsArticles(text) {
  let json;
  try {
    json = JSON.parse(String(text || '').replace(/^```json\s*|\s*```$/g, '').trim());
  } catch {
    return null;
  }
  const rows = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : [];
  const out = {};
  for (const row of rows) {
    const about = String(row?.about || '').trim();
    const title = String(row?.title || '').replace(/\s+/g, ' ').trim();
    const body = String(row?.body || '').trim();
    if (!ABOUTS.includes(about) || !title || body.length < 40) continue;
    if (looksLikeMeta(title) || looksLikeMeta(body)) continue;
    out[about] = { title: title.slice(0, 80), body: body.slice(0, 1800) };
  }
  return Object.keys(out).length ? out : null;
}

export async function groqWriteKidsNews(briefs) {
  const key = groqKey();
  if (!key || !briefs?.length) return null;
  const user = briefs.map(b => {
    const pct = Number(b.pct);
    const move = !Number.isFinite(pct)
      ? '不明'
      : pct > 0.4
        ? `上昇 約${pct.toFixed(1)}%`
        : pct < -0.4
          ? `下落 約${Math.abs(pct).toFixed(1)}%`
          : `ほぼ横ばい 約${pct.toFixed(1)}%`;
    return [
      `【${b.about}】`,
      `値動き: ${move}`,
      b.headline ? `材料の見出し: ${b.headline}` : '材料の見出し: なし'
    ].join('\n');
  }).join('\n\n');

  const payload = {
    model: MODEL,
    temperature: 0.2,
    max_tokens: 1800,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'kids_news', strict: true, schema: WRITE_SCHEMA }
    },
    messages: [
      { role: 'system', content: KIDS_PAPER_PROMPT },
      { role: 'user', content: `${user}\n\n銘柄ごとに子供新聞の見出しと本文を書いてください。JSONだけ返してください。` }
    ]
  };

  let last = '';
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000)
      });
      const body = await res.text();
      if (res.status === 429) {
        last = `${MODEL} 429`;
        await sleep(retryWaitMs(res, body));
        continue;
      }
      if (!res.ok) throw new Error(`${MODEL} ${res.status} ${body.slice(0, 180)}`);
      const json = JSON.parse(body);
      const parsed = parseKidsArticles(json?.choices?.[0]?.message?.content || '');
      if (!parsed) throw new Error(`${MODEL} 子供新聞の本文が取れません`);
      console.log(`Groq子供新聞 ${Object.keys(parsed).length}本 ${MODEL}`);
      return parsed;
    }
    throw new Error(last || `${MODEL} 429`);
  } catch (e) {
    console.warn(String(e?.message || e));
    return null;
  }
}

const WEEKEND_ABOUTS = ['宇宙', '自然', 'くらし', 'お金'];

const WEEKEND_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          about: { type: 'string', enum: WEEKEND_ABOUTS },
          title: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['about', 'title', 'body'],
        additionalProperties: false
      }
    }
  },
  required: ['items'],
  additionalProperties: false
};

const WEEKEND_PAPER_PROMPT = [
  'あなたは小中学生向けの子供新聞を作る人です。',
  'きょうは株や為替の取引所が休みです。値動きの話は書かない。',
  '科学・自然・くらし・お金のしくみから、ためになって面白い話にする。',
  '前置きは不要です。記事の内容だけを書いてください。',
  'あいさつ、自己紹介、対象年齢、「学びになる」などの注釈、出典、まとめ、AIであることの説明は書かない。',
  '見出しは短く。本文はやさしい日本語で2段落か3段落。将来を断定しない。怖い事件や戦争は書かない。'
].join('\n');

function parseWeekendArticles(text) {
  let json;
  try {
    json = JSON.parse(String(text || '').replace(/^```json\s*|\s*```$/g, '').trim());
  } catch {
    return null;
  }
  const rows = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : [];
  const out = {};
  for (const row of rows) {
    const about = String(row?.about || '').trim();
    const title = String(row?.title || '').replace(/\s+/g, ' ').trim();
    const body = String(row?.body || '').trim();
    if (!WEEKEND_ABOUTS.includes(about) || !title || body.length < 40) continue;
    if (looksLikeMeta(title) || looksLikeMeta(body)) continue;
    if (!out[about]) out[about] = { title: title.slice(0, 80), body: body.slice(0, 1800) };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 土日用。株の値動きは使わず、拾った見出しから子供新聞を4本書く。
 */
export async function groqWriteWeekendKidsNews(picks) {
  const key = groqKey();
  if (!key || !picks?.length) return null;
  const user = picks.map((p, i) => [
    `${i + 1}.`,
    p.title ? `見出し: ${p.title}` : '',
    p.source ? `出どころ: ${p.source}` : ''
  ].filter(Boolean).join('\n')).join('\n\n');

  const payload = {
    model: MODEL,
    temperature: 0.35,
    max_tokens: 2000,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'weekend_kids_news', strict: true, schema: WEEKEND_SCHEMA }
    },
    messages: [
      { role: 'system', content: WEEKEND_PAPER_PROMPT },
      {
        role: 'user',
        content: `${user}\n\n宇宙・自然・くらし・お金の4欄について、子供新聞の見出しと本文を書いてください。JSONだけ返してください。`
      }
    ]
  };

  let last = '';
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000)
      });
      const body = await res.text();
      if (res.status === 429) {
        last = `${MODEL} 429`;
        await sleep(retryWaitMs(res, body));
        continue;
      }
      if (!res.ok) throw new Error(`${MODEL} ${res.status} ${body.slice(0, 180)}`);
      const json = JSON.parse(body);
      const parsed = parseWeekendArticles(json?.choices?.[0]?.message?.content || '');
      if (!parsed) throw new Error(`${MODEL} 土日の本文が取れません`);
      console.log(`Groq土日新聞 ${Object.keys(parsed).length}本 ${MODEL}`);
      return parsed;
    }
    throw new Error(last || `${MODEL} 429`);
  } catch (e) {
    console.warn(String(e?.message || e));
    return null;
  }
}

export const writeKidsNews = groqWriteKidsNews;
export const writeWeekendKidsNews = groqWriteWeekendKidsNews;
export const labelTitles = groqLabelTitles;
