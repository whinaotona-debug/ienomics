/**
 * Groq（Qwen、だめなら gpt-oss）で見出しだけ銘柄仕分けする。
 * 子ども向け画面からは呼ばない。キーが無いときは null。
 */
const MODELS = ['qwen/qwen3.6-27b', 'openai/gpt-oss-20b'];
const TOPICS = new Set(['日経平均', 'S&P500', '金', '原油', 'なし']);

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

async function groqChat(key, model, titles) {
  const numbered = titles.map((t, i) => `${i}: ${t}`).join('\n');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '見出しを日経平均,S&P500,金,原油,なしのどれか一つに分類する。金は金価格・ゴールドのみ。金利・金額・資金は金ではない。JSONのみ。形式:{"items":[{"i":0,"topic":"日経平均"}]}'
        },
        { role: 'user', content: numbered }
      ]
    }),
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
  const size = 12;
  let model = MODELS[0];

  for (let start = 0; start < titles.length; start += size) {
    const chunk = titles.slice(start, start + size);
    let ok = false;
    for (const tryModel of (model === MODELS[0] ? MODELS : [model, ...MODELS.filter(m => m !== model)])) {
      try {
        const got = await groqChat(key, tryModel, chunk);
        got.forEach((topic, j) => { labels[start + j] = topic; });
        model = tryModel;
        ok = true;
        break;
      } catch (e) {
        console.warn(String(e?.message || e));
      }
    }
    if (!ok) return null;
    if (start + size < titles.length) await sleep(1500);
  }
  console.log(`Groq仕分け ${labels.filter(Boolean).length}/${titles.length} ${model}`);
  return labels;
}
