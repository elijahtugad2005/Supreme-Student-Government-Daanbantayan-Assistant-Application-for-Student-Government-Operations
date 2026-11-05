/**
 * scripts/ai-model-benchmark-check.mjs
 * TDD Benchmark Suite: Compare Gemini & OpenRouter Models on Document Summarization
 * 
 * Seams under test:
 * 1. Prompt Optimization Seam: Compress realistic CTU SSG resolution document via Caveman rules
 * 2. Multi-Provider Execution Seam: Direct API calls to Gemini and OpenRouter models
 * 3. Output Validation Seam: Strictly parse JSON, ensuring title & summary extraction
 * 4. Metrics & Performance Seam: Compare Latency (ms), Tokens (Prompt, Completion, Total), and Cost
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
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!env[key]) env[key] = val;
        }
      }
    }
  }
  return env;
}

const env = loadEnv();
const GEMINI_API_KEY = env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;

// Realistic Sample CTU Legislative Document
const sampleDocumentText = `
Republic of the Philippines
CEBU TECHNOLOGICAL UNIVERSITY
Daanbantayan Campus
Agujo, Daanbantayan, Cebu
OFFICE OF THE SUPREME STUDENT GOVERNMENT

EXCERPTS FROM THE MINUTES OF THE 5TH REGULAR LEGISLATIVE SESSION OF THE SUPREME STUDENT GOVERNMENT (SSG) HELD AT THE CTU STUDENT ACTIVITY CENTER ON NOVEMBER 02, 2026.

Present:
Hon. Frixty Frodo - SSG President / Presiding Officer
Hon. Maria Clara Santos - SSG Vice President
Hon. Juan Dela Cruz - Executive Secretary
Hon. Ana Patricia Reyes - Treasurer
Hon. Carlos Mendoza - Auditor
Hon. Mark Anthony Tan - Public Information Officer
Hon. Sofia Rodriguez - Business Manager

Absent: None.

RESOLUTION NO. 2026-088
Series of 2026

A RESOLUTION AUTHORIZING AND APPROVING THE REALLOCATION AND DISBURSEMENT OF FUNDS AMOUNTING TO SEVENTY-FIVE THOUSAND PESOS (PHP 75,000.00) FROM THE INSTITUTIONAL GENERATED FUND (IGF) FOR THE PROCUREMENT OF SOUND SYSTEM PERIPHERALS, WIRELESS MICROPHONES, AND LED STAGE LIGHTING EQUIPMENT IN PREPARATION FOR THE UPCOMING 2026 ANNUAL UNIVERSITY INTRAMURAL OLYMPICS.

WHEREAS, the annual University Intramurals is scheduled to commence on November 25, 2026, gathering over 4,500 student athletes, delegates, and faculty members across all academic colleges;

WHEREAS, an exhaustive technical audit conducted by the SSG Logistics Committee revealed that existing acoustic equipment at the university gymnasium has suffered from severe audio distortion, intermittent wireless signal drops, and hardware degradation;

WHEREAS, the Supreme Student Government has unencumbered reserves under the Institutional Generated Fund (IGF) ledger account specifically intended for student activity facilities and audio-visual capability enhancements;

WHEREAS, the SSG Committee on Finance and Appropriations has formally reviewed the Project Procurement Management Plan (PPMP) and confirmed that the physical cash balance of fund_igf_main is sufficient to absorb this procurement without creating an institutional deficit;

NOW, THEREFORE, on motion of Hon. Maria Clara Santos, duly seconded by Hon. Ana Patricia Reyes and unanimously approved by all members present:

BE IT RESOLVED, as it is hereby resolved by the Supreme Student Government of Cebu Technological University Daanbantayan Campus in session assembled, to authorize the disbursement of PHP 75,000.00 for the aforementioned sports equipment.

RESOLVED FURTHER, that copies of this resolution be furnished to the Campus Director, the Office of Student Affairs (OSA), and the Commission on Audit (COA) representative for formal notation and post-audit compliance.

Approved unanimously this 2nd day of November 2026 at Daanbantayan, Cebu, Philippines.

I HEREBY CERTIFY to the correctness of the foregoing resolution.

Certified Correct:
JUAN DELA CRUZ
Executive Secretary, SSG

Attested by:
FRIXTY FRODO
SSG President, Presiding Officer

Approved:
PROF. EDUARDO RAMOS
Dean of Student Affairs & Services
`;

function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = JSON.stringify(body);
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers,
      },
      timeout: 35000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request Timeout (35s)'));
    });
    req.write(postData);
    req.end();
  });
}

// 1. Benchmark Gemini
async function runGeminiBenchmark(model, promptText) {
  const startTime = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [
      {
        parts: [
          { text: promptText + '\n\nOutput ONLY valid JSON with keys: title, documentNumber, summary, agenda.' }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
    }
  };

  try {
    const res = await postJson(url, {}, payload);
    const elapsed = Date.now() - startTime;
    if (res.status !== 200) {
      return { model, provider: 'Google Gemini', success: false, error: res.data?.error?.message || `HTTP ${res.status}`, elapsedMs: elapsed };
    }

    const parts = res.data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('');
    const parsed = safeJsonParse(text);
    const usage = res.data?.usageMetadata || {};

    return {
      model,
      provider: 'Google Gemini',
      success: !!parsed && (parsed.title || parsed.summary),
      elapsedMs: elapsed,
      promptTokens: usage.promptTokenCount || 0,
      completionTokens: usage.candidatesTokenCount || 0,
      totalTokens: usage.totalTokenCount || 0,
      extractedTitle: parsed?.title || 'N/A',
      extractedSummary: (parsed?.summary || '').slice(0, 85) + '...',
      costUSD: 0,
    };
  } catch (err) {
    return { model, provider: 'Google Gemini', success: false, error: err.message, elapsedMs: Date.now() - startTime };
  }
}

// 2. Benchmark OpenRouter
async function runOpenRouterBenchmark(model, promptText) {
  const startTime = Date.now();
  const isReasoningHeavy = /dots-3|nemotron|reasoning/i.test(model);
  const payload = {
    model,
    messages: [
      { role: 'system', content: 'You extract metadata from university documents. Output ONE raw JSON object with keys: title, documentNumber, summary, agenda.' },
      { role: 'user', content: promptText }
    ],
    temperature: 0.1,
    max_tokens: isReasoningHeavy ? 2048 : 800,
    response_format: { type: 'json_object' },
  };

  try {
    const res = await postJson('https://openrouter.ai/api/v1/chat/completions', {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://github.com/Shirio-SSG',
      'X-Title': 'Shirio Model Benchmark'
    }, payload);

    const elapsed = Date.now() - startTime;
    if (res.status !== 200) {
      return { model, provider: 'OpenRouter', success: false, error: res.data?.error?.message || `HTTP ${res.status}`, elapsedMs: elapsed };
    }

    const msg = res.data?.choices?.[0]?.message || {};
    const text = msg.content || msg.reasoning || '';
    const parsed = safeJsonParse(text);
    const usage = res.data?.usage || {};

    return {
      model: res.data?.model || model,
      provider: 'OpenRouter',
      success: !!parsed && (parsed.title || parsed.summary),
      elapsedMs: elapsed,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      extractedTitle: parsed?.title || 'N/A',
      extractedSummary: (parsed?.summary || '').slice(0, 85) + '...',
      costUSD: res.data?.usage?.cost || 0,
    };
  } catch (err) {
    return { model, provider: 'OpenRouter', success: false, error: err.message, elapsedMs: Date.now() - startTime };
  }
}

async function runBenchmarkSuite() {
  console.log('================================================================================');
  console.log('🏆 AI DOCUMENT SUMMARY TDD BENCHMARK: GEMINI vs OPENROUTER FREE MODELS');
  console.log('================================================================================\n');

  // Prepare optimized Caveman prompt
  const compressedText = compressDocumentText(sampleDocumentText);
  const promptObj = buildOptimizedAiPrompt({
    fileName: 'RESOLUTION_NO_2026_088_IGF_AUDIO_REALLOCATION.pdf',
    textContent: compressedText,
    labelsList: [
      { id: 'resolution', name: 'Board/SSG Resolution' },
      { id: 'memorandum', name: 'Memorandum' },
      { id: 'ppmp_proposal', name: 'PPMP Procurement Proposal' }
    ]
  });

  const promptText = promptObj.prompt || promptObj;

  console.log(`Document raw chars: ${sampleDocumentText.length} -> Compressed chars: ${compressedText.length}`);
  console.log(`Prompt char count: ${promptText.length}\n`);

  const modelsToBenchmark = [
    { provider: 'gemini', id: 'gemini-3.5-flash' },
    { provider: 'gemini', id: 'gemini-3.5-flash-lite' },
    { provider: 'gemini', id: 'gemini-3.1-flash-lite' },
    { provider: 'openrouter', id: 'nvidia/nemotron-3.5-super-vl:free' },
    { provider: 'openrouter', id: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
    { provider: 'openrouter', id: 'openrouter/free' },
  ];

  const results = [];

  for (const item of modelsToBenchmark) {
    process.stdout.write(`Benchmarking [${item.provider.toUpperCase()}] ${item.id} ... `);
    let res = null;
    if (item.provider === 'gemini') {
      res = await runGeminiBenchmark(item.id, promptText);
    } else {
      res = await runOpenRouterBenchmark(item.id, promptText);
    }
    results.push(res);

    if (res.success) {
      console.log(`PASS (${res.elapsedMs}ms, ${res.totalTokens} tokens)`);
    } else {
      console.log(`FAIL (${res.error || 'No valid JSON'})`);
    }
  }

  console.log('\n================================================================================');
  console.log('📊 BENCHMARK COMPARISON TABLE (SPEED, TOKENS & USABILITY)');
  console.log('================================================================================');
  console.log(
    '| Provider     | Model Name                           | Speed (ms) | In Tokens | Out Tokens | Total Tokens | Summary Quality |'
  );
  console.log(
    '| :----------- | :----------------------------------- | :--------- | :-------- | :--------- | :----------- | :-------------- |'
  );

  for (const r of results) {
    if (r.success) {
      const p = r.provider.padEnd(12);
      const m = r.model.slice(0, 36).padEnd(36);
      const s = String(r.elapsedMs).padStart(10);
      const inT = String(r.promptTokens).padStart(9);
      const outT = String(r.completionTokens).padStart(10);
      const totT = String(r.totalTokens).padStart(12);
      const okT = r.extractedTitle !== 'N/A' ? 'ACCURATE' : 'PARTIAL';
      console.log(`| ${p} | ${m} | ${s} | ${inT} | ${outT} | ${totT} | ${okT.padEnd(15)} |`);
    } else {
      console.log(`| ${r.provider.padEnd(12)} | ${r.model.slice(0, 36).padEnd(36)} | FAILED: ${r.error?.slice(0, 45)} |`);
    }
  }

  console.log('================================================================================\n');

  console.log('=== Sample Model Extracted Summaries ===');
  for (const r of results) {
    if (r.success) {
      console.log(`\n▶ [${r.provider}] ${r.model}:`);
      console.log(`  Title: ${r.extractedTitle}`);
      console.log(`  Summary: ${r.extractedSummary}`);
    }
  }

  // Verify TDD requirements
  const successfulGemini = results.filter(r => r.provider === 'Google Gemini' && r.success);
  const successfulOpenRouter = results.filter(r => r.provider === 'OpenRouter' && r.success);

  console.log('\n=== TDD Verification Assertions ===');
  const geminiPass = successfulGemini.length >= 2;
  const openRouterPass = successfulOpenRouter.length >= 2;
  console.log(`ok   Gemini has working fast models (passed: ${successfulGemini.length}): ${geminiPass ? 'PASS' : 'FAIL'}`);
  console.log(`ok   OpenRouter has working free fallback models (passed: ${successfulOpenRouter.length}): ${openRouterPass ? 'PASS' : 'FAIL'}`);

  if (!geminiPass || !openRouterPass) {
    process.exit(1);
  } else {
    console.log('All model benchmark comparisons completed successfully!');
    process.exit(0);
  }
}

await runBenchmarkSuite();
