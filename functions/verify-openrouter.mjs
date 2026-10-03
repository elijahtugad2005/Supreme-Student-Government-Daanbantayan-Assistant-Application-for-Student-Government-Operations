/**
 * Live check that OpenRouter works, and that the configured model exists.
 *
 *   cd functions
 *   node verify-openrouter.mjs
 *
 * Reads the key from functions/.env and NEVER prints it. Response bodies are
 * redacted before display so an echoed key cannot leak into a terminal or a
 * pasted screenshot.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REDACT = /sk-or-v1-[A-Za-z0-9_-]+/g;
const clean = (value) => String(value ?? '').replace(REDACT, 'sk-or-v1-***');

const loadEnv = (path) => {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
};

const env = loadEnv(fileURLToPath(new URL('./.env', import.meta.url)));
const apiKey = env.OPENROUTER_API_KEY;
const model = env.OPENROUTER_AI_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free';

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n     ${clean(detail)}`}`);
};

console.log('\n=== Configuration ===');
check('OPENROUTER_API_KEY is present', Boolean(apiKey));
check('the key is not the placeholder',
  Boolean(apiKey) && !apiKey.startsWith('your_'), 'still a placeholder');
console.log(`   model: ${model}`);

if (!apiKey) {
  console.log('\nCannot continue without a key.');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${apiKey}`,
  'X-Title': 'SSG Document Intelligence',
};
if (env.OPENROUTER_SITE_URL) headers['HTTP-Referer'] = env.OPENROUTER_SITE_URL;

// ── 1. Is the key itself valid? ──
console.log('\n=== Key validation ===');
try {
  const res = await fetch('https://openrouter.ai/api/v1/key', { headers });
  const body = await res.text();
  check('the key is accepted (HTTP 200)', res.status === 200, `HTTP ${res.status} ${clean(body).slice(0, 200)}`);
} catch (error) {
  check('the key endpoint is reachable', false, error.message);
}

// ── 2. Does the model exist? ──
console.log('\n=== Model availability ===');
try {
  const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
  const body = await res.json();
  const ids = (body?.data || []).map((m) => m.id);
  const exact = ids.includes(model);
  check('the configured model exists on OpenRouter', exact, `model "${model}" not in the catalogue`);
  if (!exact) {
    // Show near matches so the right id is obvious.
    const fragment = model.split('/').pop()?.split(':')[0] || model;
    const similar = ids.filter((id) => id.toLowerCase().includes(fragment.toLowerCase().slice(0, 12)));
    console.log(`   ${ids.length} models available. Similar to "${fragment}":`);
    similar.slice(0, 8).forEach((id) => console.log(`     - ${id}`));
  }
} catch (error) {
  check('the models endpoint is reachable', false, error.message);
}

// ── 3. Can it actually answer our shape of request? ──
// Retried, because free-tier models intermittently return prose or an empty
// body. The Cloud Function retries too (openrouter.js attempts=3), so a single
// unlucky response here would make preflight flap rather than report a real
// fault.
console.log('\n=== A real chat completion with structured output ===');
const schema = {
  type: 'object',
  properties: {
    documentType: { type: 'string' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['documentType', 'confidence', 'reason'],
};

const USER_PROMPT =
  'MEMORANDUM\nTo: All Committee Chairs\nFrom: Secretary\nDate: September 28, 2026\n' +
  'Subject: First Quarter Report\n\nPlease submit your narrative report on or before ' +
  'October 5, 2026. Within five working days after the activity, submit the liquidation report.';

/** Extract JSON the same tolerant way the function does. */
const parseLoose = (text) => {
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s !== -1 && e > s) {
      try {
        return JSON.parse(cleaned.slice(s, e + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
};

const ATTEMPTS = 3;
let parsed = null;
let lastRaw = '';
let lastStatus = null;

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You classify official student-government documents. Respond with a single JSON ' +
              `object and nothing else. It must match this schema: ${JSON.stringify(schema)}`,
          },
          { role: 'user', content: USER_PROMPT },
        ],
        temperature: 0.2,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      }),
    });

    lastStatus = res.status;
    const raw = await res.text();
    if (res.ok) {
      const payload = JSON.parse(raw);
      lastRaw = payload?.choices?.[0]?.message?.content ?? '';
      parsed = parseLoose(lastRaw);
      if (parsed) break;
      console.log(`   attempt ${attempt}: unparsable response, retrying`);
    } else {
      console.log(`   attempt ${attempt}: HTTP ${res.status}, retrying`);
    }
  } catch (error) {
    console.log(`   attempt ${attempt}: ${error.message}, retrying`);
  }
  // eslint-disable-next-line no-await-in-loop
  if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
}

check('the completion request is accepted', lastStatus === 200, `HTTP ${lastStatus} ${clean(lastRaw).slice(0, 200)}`);
if (parsed) console.log(`   parsed: ${clean(JSON.stringify(parsed)).slice(0, 240)}`);
check('a usable JSON object came back', parsed !== null, clean(lastRaw).slice(0, 200));
if (parsed) {
  check('documentType is a string', typeof parsed.documentType === 'string', clean(JSON.stringify(parsed.documentType)));
  check('confidence is numeric', typeof parsed.confidence === 'number', clean(JSON.stringify(parsed.confidence)));
}

console.log(failed === 0 ? '\nOpenRouter is working.' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);