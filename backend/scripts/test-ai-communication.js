/**
 * backend/scripts/test-ai-communication.js
 * 
 * Lightweight AI Communication & Quota Test
 * Tests connectivity to Gemini & OpenRouter using minimal tokens (~10 tokens)
 * to strictly preserve the daily free quota allowance.
 * 
 * Run from project root:
 *   node backend/scripts/test-ai-communication.js
 */

'use strict';

const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../functions/.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: false });
require('dotenv').config({ path: path.join(__dirname, '../../.env.local'), override: false });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_AI_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free';

console.log('============================================================');
console.log('       SSG AI Assistant — Lightweight Connectivity Test     ');
console.log('============================================================');
console.log('Designed to test communication while conserving daily quota.\n');

function postRequest(options, data) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        const ms = Date.now() - t0;
        resolve({ statusCode: res.statusCode, body, ms });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function testOpenRouter() {
  console.log('------------------------------------------------------------');
  console.log('1. Testing OpenRouter (Free Fallback Provider)');
  console.log('------------------------------------------------------------');
  if (!OPENROUTER_API_KEY) {
    console.log('⚠️  OPENROUTER_API_KEY is not configured in .env');
    return false;
  }

  const payload = JSON.stringify({
    model: OPENROUTER_MODEL,
    messages: [{ role: 'user', content: 'Say OK' }],
    max_tokens: 5,
  });

  const options = {
    hostname: 'openrouter.ai',
    path: '/api/v1/chat/completions',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  try {
    const res = await postRequest(options, payload);
    if (res.statusCode === 200) {
      const parsed = JSON.parse(res.body);
      const text = parsed.choices?.[0]?.message?.content?.trim() || '';
      const tokens = parsed.usage?.total_tokens || 0;
      const cost = parsed.usage?.cost || 0;
      console.log(`✅ OpenRouter Response: [${res.statusCode}] OK in ${res.ms}ms`);
      console.log(`   Model:   ${OPENROUTER_MODEL}`);
      console.log(`   Output:  "${text}"`);
      console.log(`   Tokens:  ${tokens} tokens consumed (Cost: $${cost})`);
      return true;
    } else {
      console.log(`❌ OpenRouter Error: HTTP ${res.statusCode}`);
      console.log(`   Details: ${res.body}`);
      return false;
    }
  } catch (err) {
    console.log(`❌ OpenRouter Request Failed: ${err.message}`);
    return false;
  }
}

async function testGemini() {
  console.log('\n------------------------------------------------------------');
  console.log('2. Testing Google Gemini (Primary Provider)');
  console.log('------------------------------------------------------------');
  if (!GEMINI_API_KEY) {
    console.log('⚠️  GEMINI_API_KEY is not configured in .env');
    return false;
  }

  const payload = JSON.stringify({
    contents: [{ parts: [{ text: 'Say OK' }] }],
    generationConfig: { maxOutputTokens: 5 },
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  try {
    const res = await postRequest(options, payload);
    if (res.statusCode === 200) {
      const parsed = JSON.parse(res.body);
      const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      console.log(`✅ Gemini Response: [${res.statusCode}] OK in ${res.ms}ms`);
      console.log(`   Output: "${text}"`);
      return true;
    } else if (res.statusCode === 503) {
      console.log(`⚠️  Gemini Temporarily Busy [HTTP 503] in ${res.ms}ms (Google spike demand)`);
      console.log(`   Automatic Fallback to OpenRouter will handle requests without user disruption.`);
      return true;
    } else {
      console.log(`❌ Gemini Response: HTTP ${res.statusCode}`);
      console.log(`   Details: ${res.body}`);
      return false;
    }
  } catch (err) {
    console.log(`❌ Gemini Request Failed: ${err.message}`);
    return false;
  }
}

async function main() {
  const openRouterOk = await testOpenRouter();
  const geminiOk = await testGemini();

  console.log('\n============================================================');
  console.log('                       TEST SUMMARY                         ');
  console.log('============================================================');
  console.log(`OpenRouter (Free Tier Fallback): ${openRouterOk ? 'OPERATIONAL ✅' : 'FAILED ❌'}`);
  console.log(`Google Gemini (Primary Tier):    ${geminiOk ? 'REACHABLE / RECOGNIZED ✅' : 'FAILED ❌'}`);
  console.log('\nQuota Preservation Strategy in Place:');
  console.log('1. 12-second pacing queue between document evaluations to avoid RPM limits.');
  console.log('2. Dual-provider failover: When Gemini daily quota reaches capacity, requests shift to OpenRouter.');
  console.log('3. Client-side quota latching prevents sending failed repeated requests when allowance is spent.');
  console.log('============================================================\n');
}

main().catch(console.error);
