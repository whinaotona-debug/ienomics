/**
 * Groq（gpt-oss）で見出しだけ銘柄仕分けする。
 * 子ども向け画面からは呼ばない。キーが無いときは null。
 * 無料枠は1分のトークンが少ないので、呼び出しは1回だけにする。
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

export async function groqLabelTitles(titles) {
  const key = String(process.env.GROQ_API_KEY || '').trim();
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
