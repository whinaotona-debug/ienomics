/**
 * Groq（gpt-oss、だめなら Qwen）で見出しだけ銘柄仕分けする。
 * 子ども向け画面からは呼ばない。キーが無いときは null。
 */
const MODELS = ['openai/gpt-oss-20b', 'qwen/qwen3.6-27b'];
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

async function groqChat(key, model, titles, { schema } = {}) {
  const numbered = titles.map((t, i) => `${i}: ${t}`).join('\n');
  const payload = {
    model,
    temperature: 0,
    max_tokens: 1200,
    messages: [
      {
        role: 'system',
        content: 'Classify each headline into exactly one topic. Gold means gold price only, not money or interest. Return JSON only: {"items":[{"i":0,"topic":"日経平均"}]} topic must be one of 日経平均,S&P500,金,原油,なし'
      },
      { role: 'user', content: numbered }
    ]
  };
  if (schema) {
    payload.response_format = {
      type: 'json_schema',
      json_schema: { name: 'topics', strict: true, schema: SCHEMA }
    };
  }

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
  if (!res.ok) throw new Error(`${model} ${res.status} ${body.slice(0, 180)}`);
  const json = JSON.parse(body);
  const text = json?.choices?.[0]?.message?.content || '';
  return parseTopics(text, titles.length);
}

export async function groqLabelTitles(titles) {
  const key = String(process.env.GROQ_API_KEY || '').trim();
  if (!key) return null;

  const labels = Array(titles.length).fill('');
  const size = 8;
  let model = MODELS[0];
  let any = false;

  for (let start = 0; start < titles.length; start += size) {
    const chunk = titles.slice(start, start + size);
    let ok = false;
    const order = model === MODELS[0] ? MODELS : [model, ...MODELS.filter(m => m !== model)];
    for (const tryModel of order) {
      const modes = tryModel.startsWith('openai/') ? [true, false] : [false];
      for (const schema of modes) {
        try {
          const got = await groqChat(key, tryModel, chunk, { schema });
          got.forEach((topic, j) => { labels[start + j] = topic; });
          model = tryModel;
          ok = true;
          any = true;
          break;
        } catch (e) {
          console.warn(String(e?.message || e));
        }
      }
      if (ok) break;
    }
    if (start + size < titles.length) await sleep(1500);
  }
  if (!any) return null;
  console.log(`Groq仕分け ${labels.filter(Boolean).length}/${titles.length} ${model}`);
  return labels;
}
