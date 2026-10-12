const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const key = process.env.GEMINI_API_KEY;
console.log('Testing models with key:', key?.slice(0, 8) + '...');

const models = ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-3.8-flash'];

models.forEach(m => {
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: 'Respond with OK' }] }],
    generationConfig: { maxOutputTokens: 10 }
  });
  const req = https.request({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${m}:generateContent?key=${key}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  }, res => {
    let b = '';
    res.on('data', d => b += d);
    res.on('end', () => console.log(m, '-> HTTP', res.statusCode, b.slice(0, 100)));
  });
  req.write(payload);
  req.end();
});
