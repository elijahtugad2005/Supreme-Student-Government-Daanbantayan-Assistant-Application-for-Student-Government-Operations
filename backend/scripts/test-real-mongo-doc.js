// Test AI analysis directly on the real document stored in MongoDB GridFS
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { downloadFileFromGridFS } = require('../utils/gridfs');
const mammoth = require('mammoth');
const { __test } = require('../routes/ai.js');

async function testRealDoc() {
  try {
    console.log('Downloading real file 6ac8bc2d994aa36e82e4b4c9 from MongoDB...');
    const buffer = await downloadFileFromGridFS('6ac8bc2d994aa36e82e4b4c9');
    const { value: text } = await mammoth.extractRawText({ buffer });
    console.log('Document text successfully extracted, length:', text.length);

    const prompt = `You are an expert archivist analyzing an official document for Cebu Technological University (CTU) Student Government.

File name: TRANSMITTAL LETTER.docx
Document text content:
${text}

Extract strictly valid JSON with this schema:
{
  "title": "Clear, official document title as written",
  "documentType": "One of: letter, request, minutes_of_meeting, resolution, memorandum, other",
  "documentTypeLabel": "Display name of document type",
  "summary": "A concise executive institutional summary (2 to 4 sentences) detailing purpose and actions",
  "subject": "The primary subject line or theme of the document",
  "agenda": "The main agenda or core topic",
  "authorName": "The individual(s) who PREPARED, RECORDED, or DRAFTED this document (e.g. Researchers).",
  "signatories": [
    {
      "name": "Approving or endorsing official name",
      "position": "Official position or title",
      "required": true
    }
  ]
}

CRITICAL RULES:
1. SUMMARY, AGENDA, & SUBJECT: Accurately summarize the text.
2. Signatories must ONLY be the officials who note, recommend approval, or approve the document. Do not invent names. Use ONLY names present in the document.`;

    console.log('Sending real document text to AI pipeline...');
    const result = await __test.generateAiJson(prompt, null, true);
    console.log('\n--- REAL AI EXTRACTION RESULT ---');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error during test:', err.message);
  } finally {
    process.exit(0);
  }
}

testRealDoc();
