const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const payload = JSON.stringify({
  model: process.env.OPENROUTER_AI_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free',
  messages: [
    { role: 'system', content: 'You are an institutional document metadata extraction AI. Respond with strictly raw JSON only. Do not add conversational text or markdown code blocks.' },
    { role: 'user', content: 'Analyze this: Meeting held on March 1. Extract JSON: {"summary": "two sentences", "title": "the title"}' }
  ],
  temperature: 0.1,
  max_tokens: 500
});

const req = https.request({
  hostname: 'openrouter.ai',
  path: '/api/v1/chat/completions',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  let b = '';
  res.on('data', d => b += d);
  res.on('end', () => console.log('OPENROUTER RAW RESPONSE:\n', b));
});

req.write(payload);
req.end();
