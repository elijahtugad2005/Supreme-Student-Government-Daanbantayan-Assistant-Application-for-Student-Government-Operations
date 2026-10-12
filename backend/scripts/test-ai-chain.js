// Live test: runs the real provider chain on a sample transmittal letter.
// Run from project root: node backend/scripts/test-ai-chain.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const Module = require('module');

// Stub Firebase/GridFS deps so the route module loads standalone.
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req.includes('firebase-admin') && req.startsWith('../services')) return { getFirestore: () => ({}) };
  if (req.includes('utils/gridfs')) return {};
  if (req.includes('middleware/auth')) return { authenticate: (_q, _s, n) => n() };
  return origLoad.call(this, req, ...rest);
};

const { __test } = require('../routes/ai.js');

const letter = `TRANSMITTAL LETTER
October 2, 2026
DR. JUAN DELA CRUZ, Dean, College of Technology, CTU Daanbantayan Campus
Dear Sir,
We respectfully submit the research proposal of the BSIT 4th year students entitled
"SSG Office Assistant" for your review and approval.
Respectfully yours,
MARIA SANTOS, Research Adviser
Noted by: PEDRO REYES, BSIT Program Chair`;

(async () => {
  const t0 = Date.now();
  try {
    const out = await __test.generateAiJson(
      `Analyze this document and return JSON {title, documentType (letter|request|minutes_of_meeting|resolution|memorandum|other), summary, subject, agenda, authorName, signatories:[{name,position}]}.\n\n${letter}`,
      null,
      true
    );
    console.log(`OK in ${Date.now() - t0}ms via ${out._provider} / ${out._model}`);
    console.log(JSON.stringify(out, null, 2));
    const pass = out.summary && /letter|request/.test(String(out.documentType));
    console.log(pass ? '\nPASS: summary present and typed as letter/request' : '\nFAIL: wrong type or missing summary');
    process.exit(pass ? 0 : 1);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  }
})();
