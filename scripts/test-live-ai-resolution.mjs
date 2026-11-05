// scripts/test-live-ai-resolution.mjs
import http from 'http';

// Using actual document from MongoDB GridFS / Firestore:
const documentId = 'AC85snc3fg9poyW3n0nO';

console.log(`Sending live request to Express endpoint http://localhost:3000/api/ai/analyzeDocument for document ${documentId} ...`);

const postData = JSON.stringify({
  documentId,
  preferredProvider: 'auto'
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/ai/analyzeDocument',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
}, (res) => {
  let raw = '';
  res.on('data', chunk => raw += chunk);
  res.on('end', () => {
    console.log('HTTP Status:', res.statusCode);
    try {
      const parsed = JSON.parse(raw);
      console.log('\n--- Live End-to-End Extraction Results ---');
      console.log('Success:', parsed.success ?? true);
      console.log('Model Used:', parsed.analysis?._model || parsed._model);
      console.log('Provider:', parsed.analysis?._provider || parsed._provider);
      console.log('Extracted Title:', parsed.analysis?.title || parsed.title);
      console.log('Document Type:', parsed.analysis?.documentType || parsed.documentType);
      console.log('Author:', parsed.analysis?.author || parsed.author);
      console.log('Signatories:', parsed.analysis?.signatories || parsed.signatories);
      console.log('Tags:', parsed.analysis?.tags || parsed.tags);
      console.log('Summary:', (parsed.analysis?.summary || parsed.summary || '').slice(0, 200) + '...');
      console.log('\nSUCCESS: End-to-End Document AI Verified against MongoDB GridFS!');
    } catch (err) {
      console.log('Raw output:', raw);
    }
  });
});

req.on('error', (err) => {
  console.error('Request failed:', err.message);
});

req.write(postData);
req.end();
