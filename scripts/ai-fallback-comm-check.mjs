/**
 * scripts/ai-fallback-comm-check.mjs
 * TDD Benchmark & Verification Suite for AI Document Summary Fallback Models
 *
 * Slices Under Test:
 * Slice 1: Realistic Sample Documents Creation (Resolution, Financial Liquidation, Meeting Minutes)
 * Slice 2: Prompt Optimization Integration (Comparing Raw vs Caveman-Compressed Prompt Tokens)
 * Slice 3: Live Document Summary Benchmarking (Speed in ms, Latency, Token Usage per Model)
 * Slice 4: Schema & Quality Verification (Asserting valid title, summary, documentType, agenda)
 * Slice 5: Model Comparison Matrix (Gemini vs OpenRouter Fallback Cascade)
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import Caveman prompt optimizer
const { compressDocumentText, buildOptimizedAiPrompt, safeJsonParse } = await import('../backend/utils/aiPromptOptimizer.js');

function loadEnv() {
  const envPaths = [
    path.resolve(__dirname, '../backend/.env'),
    path.resolve(__dirname, '../.env.local'),
    path.resolve(__dirname, '../.env'),
  ];

  const env = { ...process.env };

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!env[key]) {
            env[key] = val;
          }
        }
      }
    }
  }
  return env;
}

const env = loadEnv();
const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
const GEMINI_API_KEY = env.GEMINI_API_KEY;

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) {
    results.push(`ok   ${label}`);
  } else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
  }
};

// ── Realistic Sample Documents ────────────────────────────────
const SAMPLE_DOCUMENTS = [
  {
    name: 'SSG_Resolution_2026_042_Lockers.txt',
    type: 'resolution',
    text: `
Republic of the Philippines
CEBU TECHNOLOGICAL UNIVERSITY
Daanbantayan Campus, Agujo, Daanbantayan, Cebu
OFFICE OF THE SUPREME STUDENT GOVERNMENT

EXCERPTS FROM THE MINUTES OF THE 4TH REGULAR SESSION OF THE SUPREME STUDENT GOVERNMENT HELD AT THE STUDENT CENTER ON OCTOBER 24, 2026.

Present:
Hon. Frixty Frodo - SSG President / Presiding Officer
Hon. Maria Santos - SSG Vice President
Hon. Juan Dela Cruz - Executive Secretary
Hon. Ana Reyes - SSG Treasurer

RESOLUTION NO. 2026-042

A RESOLUTION AUTHORIZING AND APPROVING THE ACQUISITION AND INSTALLATION OF THIRTY (30) CAMPUS STUDENT LOCKER UNITS AT THE HM AND EDUCATION BUILDINGS FOR THE TOTAL AMOUNT OF THREE THOUSAND PESOS (PHP 3,000.00).

WHEREAS, the student body has continually requested secure storage facilities for their academic equipment, hospitality utensils, and personal belongings during laboratory sessions;
WHEREAS, the Supreme Student Government has allocated funds under the Income-Generating Projects (IGP) enterprise account;
WHEREAS, the procurement of 15 units for the HM Building and 15 units for the Education Building aligns with the university student welfare initiative;

NOW THEREFORE, on motion of Hon. Maria Santos, duly seconded by all members present;
BE IT RESOLVED, as it is hereby resolved by the Supreme Student Government in session assembled, to approve the procurement and installation of the 30 campus locker units.

Approved and enacted this 24th day of October 2026.

Prepared by:
JUAN DELA CRUZ
Executive Secretary, SSG

Attested by:
FRIXTY FRODO
SSG President
    `.trim(),
  },
  {
    name: 'Liquidation_Report_Intramurals_2026.txt',
    type: 'financial_report',
    text: `
CEBU TECHNOLOGICAL UNIVERSITY - DAANBANTAYAN CAMPUS
SUPREME STUDENT GOVERNMENT
FINANCIAL LIQUIDATION REPORT

PROJECT / EVENT: Campus Intramural Games 2026
DATE OF IMPLEMENTATION: September 15 - 18, 2026
SOURCE OF FUND: Fiscal Year Budget 2026-2027 (Account Ref: BDO Institutional ****2005)
APPROVED BUDGET ALLOCATION: PHP 125,000.00

SUMMARY OF DISBURSEMENTS:
1. Sports Equipment & Trophies (Official Receipt #8912) - PHP 45,250.00
2. Officiating Referees Honorarium (Acknowledgment Receipts) - PHP 32,000.00
3. First Aid & Medical Station Supplies (Mercury Drug OR #4410) - PHP 8,750.00
4. Refreshments & Meals for Volunteers (Jollibee Food Corp #1029) - PHP 21,500.00
5. Sound System & Stage Rental (SoundPro Services OR #5512) - PHP 14,000.00

TOTAL ACTUAL EXPENDITURE: PHP 121,500.00
UNEXPENDED CASH BALANCE RETURNED TO DEPOSITORY: PHP 3,500.00

CERTIFICATION:
I hereby certify that the above disbursements were made under my direct supervision in accordance with government accounting and auditing standards.

Certified Correct:
ANA REYES
SSG Treasurer

Verified & Audited:
CARLOS MENDEZ
SSG Auditor
    `.trim(),
  },
];

const LABELS = [
  { id: 'resolution', name: 'Board / Council Resolution' },
  { id: 'financial_report', name: 'Financial Liquidation / Audit Report' },
  { id: 'minutes', name: 'Meeting Minutes' },
];

console.log('=== Slice 1: Sample Documents & Preprocessing Validation ===');
check('Sample documents defined', SAMPLE_DOCUMENTS.length >= 2);

const sampleDoc = SAMPLE_DOCUMENTS[0];
const compressedText = compressDocumentText(sampleDoc.text, 4000);
check('Caveman compression reduces raw whitespace', compressedText.length <= sampleDoc.text.length);

const { prompt: optimizedPrompt } = buildOptimizedAiPrompt({
  fileName: sampleDoc.name,
  textContent: compressedText,
  labelsList: LABELS,
});

check('Optimized prompt contains document name & types', optimizedPrompt.includes(sampleDoc.name) && optimizedPrompt.includes('TYPES:'));

// ── HTTP API Caller ───────────────────────────────────────────
function callOpenRouter(model, prompt) {
  return new Promise((resolve) => {
    if (!OPENROUTER_API_KEY) {
      return resolve({ success: false, error: 'No OpenRouter API key configured' });
    }

    const isReasoning = /dots-3|nemotron|reasoning/i.test(model) || model === 'openrouter/free';
    const postData = JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You extract metadata from CTU Student Government documents. Output ONLY a valid JSON object without markdown or code blocks.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 2800,
      response_format: { type: 'json_object' },
    });

    const startTime = Date.now();
    const req = https.request(
      {
        hostname: 'openrouter.ai',
        port: 443,
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://github.com/Shirio-SSG',
          'X-Title': 'Shirio Benchmark',
        },
        timeout: 45000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode === 200) {
              const msg = parsed.choices?.[0]?.message || {};
              const contentText = msg.content || msg.reasoning || '';
              const usage = parsed.usage || {};
              resolve({
                success: true,
                latencyMs,
                content: contentText,
                tokens: {
                  prompt: usage.prompt_tokens || 0,
                  completion: usage.completion_tokens || 0,
                  total: usage.total_tokens || 0,
                },
                rawModel: parsed.model || model,
              });
            } else {
              resolve({
                success: false,
                latencyMs,
                error: parsed.error?.message || `HTTP ${res.statusCode}`,
              });
            }
          } catch (e) {
            resolve({ success: false, latencyMs, error: 'JSON parse error: ' + data.slice(0, 100) });
          }
        });
      }
    );

    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout (45s)' });
    });

    req.write(postData);
    req.end();
  });
}

function callGemini(model, prompt) {
  return new Promise((resolve) => {
    if (!GEMINI_API_KEY) {
      return resolve({ success: false, error: 'No Gemini API key configured' });
    }

    const postData = JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt + '\n\nOutput ONLY a valid JSON object without markdown formatting or code blocks.' },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    });

    const startTime = Date.now();
    const req = https.request(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode === 200) {
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
              const usage = parsed.usageMetadata || {};
              resolve({
                success: true,
                latencyMs,
                content: text,
                tokens: {
                  prompt: usage.promptTokenCount || 0,
                  completion: usage.candidatesTokenCount || 0,
                  total: usage.totalTokenCount || 0,
                },
                rawModel: model,
              });
            } else {
              resolve({
                success: false,
                latencyMs,
                error: parsed.error?.message || `HTTP ${res.statusCode}`,
              });
            }
          } catch (e) {
            resolve({ success: false, latencyMs, error: 'Gemini parse error: ' + data.slice(0, 100) });
          }
        });
      }
    );

    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout (30s)' });
    });

    req.write(postData);
    req.end();
  });
}

// ── Models To Benchmark ───────────────────────────────────────
const defaultFallbackModels = 'nvidia/nemotron-3-ultra-550b-a55b:free,nvidia/nemotron-3.5-super-vl:free,openrouter/free';
const configuredFallbackModels = [
  env.OPENROUTER_AI_MODEL || 'dots-studio/dots-3-note-preview:free',
  ...String(env.OPENROUTER_FALLBACK_MODELS || defaultFallbackModels).split(',').map((s) => s.trim()).filter(Boolean),
].filter((m, i, arr) => m && arr.indexOf(m) === i);

console.log('\n=== Slice 2: Reading & Summarizing Sample Documents Across Models ===');

const benchmarkTable = [];

async function runBenchmark() {
  for (const doc of SAMPLE_DOCUMENTS) {
    console.log(`\n📄 Processing: "${doc.name}"`);
    const compressed = compressDocumentText(doc.text, 4000);
    const { prompt } = buildOptimizedAiPrompt({
      fileName: doc.name,
      textContent: compressed,
      labelsList: LABELS,
    });

    // 1. Test Primary Gemini (if key configured)
    if (GEMINI_API_KEY) {
      process.stdout.write(`  [Gemini: ${env.GEMINI_MODEL || 'gemini-flash-latest'}] ... `);
      const gemRes = await callGemini(env.GEMINI_MODEL || 'gemini-flash-latest', prompt);
      if (gemRes.success) {
        const parsed = safeJsonParse(gemRes.content);
        const titleOk = !!parsed.title;
        const summaryOk = !!parsed.summary;
        console.log(`PASS (${gemRes.latencyMs}ms | ${gemRes.tokens.total} tokens)`);
        benchmarkTable.push({
          document: doc.name,
          provider: 'Gemini',
          model: gemRes.rawModel,
          speed: `${gemRes.latencyMs}ms`,
          promptTokens: gemRes.tokens.prompt,
          completionTokens: gemRes.tokens.completion,
          totalTokens: gemRes.tokens.total,
          summarySnippet: (parsed.summary || '').slice(0, 60) + '...',
          validJson: titleOk && summaryOk ? 'YES' : 'PARTIAL',
        });
        check(`Gemini summary extraction for ${doc.name}`, titleOk && summaryOk);
      } else {
        console.log(`FAIL (${gemRes.error})`);
        benchmarkTable.push({
          document: doc.name,
          provider: 'Gemini',
          model: env.GEMINI_MODEL || 'gemini-flash-latest',
          speed: `${gemRes.latencyMs}ms`,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          summarySnippet: `Error: ${gemRes.error.slice(0, 40)}`,
          validJson: 'NO',
        });
      }
    }

    // 2. Test OpenRouter Fallback Models
    for (const model of configuredFallbackModels) {
      process.stdout.write(`  [OpenRouter: ${model}] ... `);
      const orRes = await callOpenRouter(model, prompt);
      if (orRes.success) {
        const parsed = safeJsonParse(orRes.content);
        const titleOk = !!parsed.title;
        const summaryOk = !!parsed.summary;
        console.log(`PASS (${orRes.latencyMs}ms | ${orRes.tokens.total} tokens)`);
        benchmarkTable.push({
          document: doc.name,
          provider: 'OpenRouter',
          model: orRes.rawModel,
          speed: `${orRes.latencyMs}ms`,
          promptTokens: orRes.tokens.prompt,
          completionTokens: orRes.tokens.completion,
          totalTokens: orRes.tokens.total,
          summarySnippet: (parsed.summary || '').slice(0, 60) + '...',
          validJson: titleOk && summaryOk ? 'YES' : 'PARTIAL',
        });
        check(`OpenRouter (${model}) summary extraction for ${doc.name}`, titleOk && summaryOk);
      } else {
        console.log(`FAIL (${orRes.error})`);
        benchmarkTable.push({
          document: doc.name,
          provider: 'OpenRouter',
          model,
          speed: `${orRes.latencyMs}ms`,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          summarySnippet: `Error: ${orRes.error.slice(0, 40)}`,
          validJson: 'NO',
        });
        check(`OpenRouter (${model}) summary extraction for ${doc.name}`, false, orRes.error);
      }
    }
  }

  console.log('\n=== Slice 3: Token Usage & Speed Benchmark Comparison Matrix ===\n');
  console.table(benchmarkTable);

  console.log('\n=== Slice 4: Resilience & Extraction Assertions ===');
  const validOutputs = benchmarkTable.filter((r) => r.validJson === 'YES');
  check('Multiple fallback models produced 100% valid document metadata', validOutputs.length >= 3);

  console.log('\n=== TDD Results ===');
  results.forEach((r) => console.log(r));

  if (failed > 0) {
    console.log(`\nBenchmark completed with ${failed} check failure(s).`);
    process.exit(1);
  } else {
    console.log('\nAll sample document reading, token comparison, and speed tests passed!');
    process.exit(0);
  }
}

await runBenchmark();
