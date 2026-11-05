import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getApiKey() {
  const envText = fs.readFileSync(path.resolve(__dirname, '../backend/.env'), 'utf8');
  const m = envText.match(/^OPENROUTER_API_KEY=(.+)$/m);
  return m ? m[1].trim() : '';
}

const key = getApiKey();

const candidateModels = [
  'dots-studio/dots-3-note-preview:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'liquid/lfm-2.5-2.6b:free',
  'openrouter/free'
];

async function pingModel(model, withJsonFormat = true) {
  return new Promise((resolve) => {
    const payload = {
      model,
      messages: [
        {
          role: 'system',
          content: 'You extract metadata from CTU Student Government documents. Output ONLY a valid JSON object without markdown or code blocks.',
        },
        {
          role: 'user',
          content: 'Extract JSON: {"title": "Resolution No. 2026-001", "summary": "Approved campus budget for student activities."}',
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
    };

    if (withJsonFormat) {
      payload.response_format = { type: 'json_object' };
      payload.reasoning = { exclude: true, effort: 'low' };
    }

    const postData = JSON.stringify(payload);

    const req = https.request({
      hostname: 'openrouter.ai',
      port: 443,
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://github.com/Shirio-SSG',
        'X-Title': 'Shirio Model Test',
      },
      timeout: 25000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data.slice(0, 150) });
        }
      });
    });

    req.on('error', (err) => resolve({ error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'timeout' });
    });

    req.write(postData);
    req.end();
  });
}

console.log('Testing candidates...');
for (const model of candidateModels) {
  process.stdout.write(`Testing ${model} ... `);
  const res = await pingModel(model, true);
  if (res.status === 200) {
    const msg = res.data?.choices?.[0]?.message || {};
    const text = msg.content || msg.reasoning || '';
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) {}
    if (parsed && (parsed.title || parsed.summary)) {
      console.log(`[PASS] JSON OK: ${JSON.stringify(parsed).slice(0, 60)}`);
    } else {
      console.log(`[RAW TEXT] (${text.slice(0, 60).replace(/\n/g, ' ')})`);
    }
  } else {
    console.log(`[FAIL] HTTP ${res.status}: ${res.data?.error?.message || res.error || ''}`);
  }
}

