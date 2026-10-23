// The "brain": vision and research, running inside the agent process.
//   - Vision (identify, locate, check): a vision model looks at a camera snapshot
//   - Research (find the fix): Keenable web search, then a model turns the results into steps
// Models: Nebius if NEBIUS_API_KEY is set; otherwise (or if Nebius fails) LiveKit Inference,
// which uses the same LiveKit Cloud credits as the agent's voice. Fake answers only if both fail.
import { inference, llm } from '@livekit/agents';

const NEBIUS_URL = (process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1/').replace(/\/?$/, '/');
const NEBIUS_KEY = process.env.NEBIUS_API_KEY || '';
const TEXT_MODEL = process.env.NEBIUS_MODEL || 'meta-llama/Llama-3.3-70B-Instruct';
const VISION_MODEL = process.env.NEBIUS_VISION_MODEL || 'Qwen/Qwen2.5-VL-72B-Instruct';
const LIVEKIT_MODEL = process.env.LIVEKIT_BRAIN_LLM || 'openai/gpt-4.1-mini';
const KEENABLE_KEY = process.env.KEENABLE_API_KEY || '';
const TIMEOUT_MS = Number(process.env.BRAIN_TIMEOUT_MS || 25000);

// Fake answers (used only if every model call fails).
// Scenario: a laptop that won't charge. Real vision replaces all of this with what the camera sees.
const FAKES = {
  identify: () => ({
    device_type: 'laptop and charger', brand: 'Apple', model: 'MacBook',
    visible_issue: 'The laptop is not charging; the charger light is off', confidence: 0.6,
  }),
  research: () => ({
    steps: [
      { text: 'Check the charger plug is pushed all the way into the wall outlet', target: 'wall plug' },
      { text: 'Unplug the charging cable from the laptop, wait five seconds, and plug it back in firmly', target: 'charging port' },
      { text: 'Try a different wall outlet, in case this one has no power', target: 'wall outlet' },
      { text: 'Look at the battery icon at the top right of the screen: it should show a lightning bolt', target: 'battery icon' },
      { text: 'If it still does not charge, restart the laptop from the Apple menu', target: 'Apple menu' },
    ],
    sources: [],
  }),
  locate: () => ({ found: true, x: 0.5, y: 0.5 }),
  check: () => ({ done: true, hint: '' }),
};

/** Pull the first JSON object out of a model reply (models sometimes wrap it in prose or ``` fences). */
function parseJson(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON in model reply');
  return JSON.parse(match[0]);
}

async function nebius(model, messages, maxTokens) {
  const res = await fetch(NEBIUS_URL + 'chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${NEBIUS_KEY}` },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Nebius HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

let livekitLLM = null;
async function livekit({ image, system, prompt }) {
  livekitLLM ??= new inference.LLM({ model: LIVEKIT_MODEL });
  const chatCtx = llm.ChatContext.empty();
  if (system) chatCtx.addMessage({ role: 'system', content: system });
  chatCtx.addMessage({
    role: 'user',
    content: image
      ? [llm.createImageContent({ image: `data:image/jpeg;base64,${image}`, inferenceDetail: 'auto' }), prompt]
      : prompt,
  });
  const work = livekitLLM.chat({ chatCtx }).collect();
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('LiveKit model timed out')), TIMEOUT_MS));
  const text = (await Promise.race([work, timeout])).text;
  if (!text) throw new Error(`empty reply from LiveKit model ${LIVEKIT_MODEL}`);
  return text;
}

/** One model call: Nebius first if configured, then LiveKit Inference. Returns the reply text. */
async function ask({ image, system, prompt, maxTokens = 600 }) {
  if (NEBIUS_KEY) {
    try {
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({
        role: 'user',
        content: image
          ? [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } }, { type: 'text', text: prompt }]
          : prompt,
      });
      return await nebius(image ? VISION_MODEL : TEXT_MODEL, messages, maxTokens);
    } catch (err) {
      console.warn(`[brain] Nebius failed (${err.message}); trying LiveKit Inference`);
    }
  }
  return livekit({ image, system, prompt });
}

/** Ask the vision model about one image; returns parsed JSON. */
async function see(image, question) {
  return parseJson(await ask({ image, prompt: `${question}\nAnswer with ONLY a JSON object, no other text.` }));
}

async function guarded(name, fn) {
  try {
    const result = await fn();
    console.log(`[brain] ${name}:`, JSON.stringify(result).slice(0, 300));
    return result;
  } catch (err) {
    console.warn(`[brain:fake] ${name} failed (${err.message}); using fake answer`);
    return FAKES[name]();
  }
}

/** What device is in this picture? image = base64 JPEG. */
export const identify = (image, hint = '') => guarded('identify', () => see(image,
  `This photo is from a phone camera on a tech-support video call. ${hint ? `The caller says it is: ${hint}.` : ''}
Identify the main device. Read any brand or model text you can see, and note anything that looks wrong
(error messages, red or orange lights, unplugged cables).
JSON keys: device_type (e.g. "Wi-Fi router", "TV remote", "laptop screen"), brand, model (or "unknown"),
visible_issue (short, or ""), confidence (0 to 1).`));

/** Where is `target` in this picture? size = { width, height } of the image. Returns { found, x, y } in 0..1. */
export const locate = (image, target, size) => guarded('locate', async () => {
  const r = await see(image,
    `Find the "${target}" in this image (${size.width} x ${size.height} pixels).
JSON keys: found (true/false), x and y = the CENTER of the ${target} as fractions of the image width and height
(0,0 is the top-left corner, 1,1 is the bottom-right).`);
  let x = Number(r.x), y = Number(r.y);
  if (x > 1 || y > 1) { x /= size.width; y /= size.height; }   // some models answer in pixels
  if (!r.found || !Number.isFinite(x) || !Number.isFinite(y)) return { found: false, x: 0, y: 0 };
  return { found: true, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
});

/** Does this picture show that `step` was done? Returns { done, hint }. */
export const check = (image, step) => guarded('check', () => see(image,
  `On a tech-support call, the person was asked to: "${step}".
Does this photo show that it was done (or that the result is now correct)? If unsure, say false.
JSON keys: done (true/false), hint (one short, kind sentence on what to try if not done, or "").`));

async function keenableSearch(query) {
  const res = await fetch('https://api.keenable.ai/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEENABLE_KEY },
    body: JSON.stringify({ query, max_results: 5, snippet_max_length: 1500 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Keenable HTTP ${res.status}`);
  return (await res.json()).results || [];
}

/**
 * The Fix Researcher: search the web for this device + problem, then turn the results
 * into a few simple steps, each with something to point at.
 */
export const research = (device, problem) => guarded('research', async () => {
  const name = [device?.brand, device?.model, device?.device_type].filter(v => v && v !== 'unknown').join(' ');
  let results = [];
  if (KEENABLE_KEY) {
    try { results = await keenableSearch(`${name} ${problem} how to fix`.trim()); }
    catch (err) { console.warn(`[brain] Keenable search failed (${err.message})`); }
  } else {
    console.log('[brain] no KEENABLE_API_KEY; writing steps without web search');
  }
  const context = results.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet || r.description || ''}`).join('\n\n');
  const reply = await ask({
    system: 'You write tech-support steps for older, non-technical people. Plain words, one action per step.',
    prompt: `Device: ${name || 'unknown device'}. Visible issue: ${device?.visible_issue || 'none'}.
Problem in the caller's words: "${problem}".
${context ? `Web results:\n${context}\n\nBase the steps on these results.` : 'No web results; use common, safe fixes.'}
Write 3 to 6 steps, simplest and safest first (restart before reset). Never include steps that need passwords
or payment details. For each step give "target": the one physical thing or on-screen item to look at
(e.g. "power button", "Settings icon"), or "" if none.
Return ONLY JSON: {"steps":[{"text":"...","target":"..."}]}`,
    maxTokens: 900,
  });
  const { steps } = parseJson(reply);
  return {
    steps: (steps || []).slice(0, 6),
    sources: results.slice(0, 3).map(r => ({ title: r.title, url: r.url })),
  };
});
