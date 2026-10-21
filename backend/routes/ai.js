// backend/routes/ai.js
// Express API endpoints for Document AI Analysis
// Replaces Firebase Cloud Functions so AI works locally & in production without Blaze plan!

const express = require('express');
const router = express.Router();
const https = require('https');
const { getFirestore } = require('../services/firebase-admin');
const { getDownloadStream, getFileMetadata } = require('../utils/gridfs');
const { authenticate } = require('../middleware/auth');

// Optional mammoth import for docx
let mammoth = null;
try {
  mammoth = require('mammoth');
} catch (_) {
  try {
    mammoth = require('../../functions/node_modules/mammoth');
  } catch (__) {}
}

let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch (_) {
  try {
    pdfParse = require('../../node_modules/pdf-parse');
  } catch (__) {}
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_AI_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free';

// Reusable Keep-Alive agent saves ~200-300ms per request by reusing TLS connections
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10, timeout: 60000 });

// ── HTTP Helper ───────────────────────────────────────────────
function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = JSON.stringify(body);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        agent: httpsAgent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Smart Excerpt Helper ──────────────────────────────────────
// Slices the key metadata sections (head + signatories at tail)
// Reducing prompt token overhead by ~60% accelerates TTFT (time-to-first-token)
function smartExcerpt(text, maxChars = 5000) {
  if (!text || text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.3));
  return `${head}\n\n[...]\n\n${tail}`;
}

// ── Robust JSON Parser Helper ─────────────────────────────────
function safeJsonParse(raw) {
  if (typeof raw !== 'string') return raw || {};
  let str = raw.trim();

  // Strip <think>...</think> reasoning tags often returned by DeepSeek / Nemotron / Qwen models
  str = str.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Strip markdown code fences (e.g. ```json ... ```)
  str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Try direct parse first
  try {
    return JSON.parse(str);
  } catch (_) {}

  // Find outermost JSON brackets { ... }
  const firstBrace = str.indexOf('{');
  const lastBrace = str.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = str.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {}
  }

  // If there are multiple JSON blocks, try each
  const jsonMatches = str.match(/\{[\s\S]*?\}/g);
  if (jsonMatches) {
    for (const match of jsonMatches.reverse()) {
      try {
        const parsed = JSON.parse(match);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (_) {}
    }
  }

  // Attempt repair for unclosed quotes / truncated JSON
  if (firstBrace !== -1) {
    let candidate = str.slice(firstBrace);
    if ((candidate.match(/"/g) || []).length % 2 !== 0) {
      candidate += '"';
    }
    const openBraces = (candidate.match(/\{/g) || []).length;
    const closeBraces = (candidate.match(/\}/g) || []).length;
    for (let i = 0; i < openBraces - closeBraces; i++) {
      candidate += '}';
    }
    try {
      return JSON.parse(candidate);
    } catch (_) {}
  }

  console.warn('[AI] Failed to parse JSON, returning fallback object:', str.slice(0, 150));
  return {};
}

// ── Gemini Quota State Tracker ─────────────────────────────────
const geminiQuotaState = {
  depleted: false,
  message: null,
  resetAt: null,
  lastChecked: null,
};

function recordGeminiQuotaDepletion(msg) {
  geminiQuotaState.depleted = true;
  geminiQuotaState.message = msg || 'Gemini daily quota depleted';
  geminiQuotaState.lastChecked = new Date().toISOString();

  let resetTime = Date.now() + 12 * 60 * 60 * 1000; // default 12h
  const match = String(msg).match(/retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (match) {
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseFloat(match[3] || '0');
    const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
    if (totalMs > 0) resetTime = Date.now() + totalMs;
  }
  geminiQuotaState.resetAt = new Date(resetTime).toISOString();
  console.warn(`[AI] Marked Gemini quota as DEPLETED until ${geminiQuotaState.resetAt}: ${msg}`);
}

function isGeminiQuotaDepleted() {
  if (geminiQuotaState.depleted && geminiQuotaState.resetAt) {
    if (new Date(geminiQuotaState.resetAt).getTime() <= Date.now()) {
      geminiQuotaState.depleted = false;
      geminiQuotaState.message = null;
      geminiQuotaState.resetAt = null;
    }
  }
  return geminiQuotaState.depleted;
}

// ── Call AI with Fallback ─────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A result is only usable if the model actually read the document.
const isUsable = (a) =>
  a && typeof a === 'object' && (a.title || a.summary || a.subject || a.documentType);

const GEMINI_MODELS = [
  GEMINI_MODEL,
  ...String(process.env.GEMINI_FALLBACK_MODELS || 'gemini-flash-latest,gemini-flash-lite-latest')
    .split(',').map((s) => s.trim()).filter(Boolean),
].filter((m, i, arr) => m && arr.indexOf(m) === i);

const OPENROUTER_MODELS = [
  OPENROUTER_MODEL,
  ...String(process.env.OPENROUTER_FALLBACK_MODELS || 'meta-llama/llama-3.3-70b-instruct:free,google/gemma-3-27b-it:free')
    .split(',').map((s) => s.trim()).filter(Boolean),
].filter((m, i, arr) => m && arr.indexOf(m) === i);

async function tryGemini(model, prompt, filePart) {
  const contents = [{
    parts: [
      ...(filePart ? [filePart] : []),
      { text: prompt + '\n\nOutput ONLY a valid JSON object without markdown formatting or code blocks.' },
    ],
  }];
  // Retry transient overload (503/429/500) with backoff.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {},
      { contents, generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' } }
    );
    if (res.status === 200) {
      const parts = res.data?.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || '').join('');
      return safeJsonParse(text || '{}');
    }
    const msg = res.data?.error?.message || 'Unknown error';
    console.warn(`[AI] Gemini ${model} attempt ${attempt + 1}: HTTP ${res.status} ${msg}`);
    if (res.status === 429 || /quota exceeded/i.test(msg) || /rate-limit/i.test(msg)) {
      recordGeminiQuotaDepletion(msg);
      return null; // Stop immediately on daily quota depletion
    }
    if (![429, 500, 503].includes(res.status)) return null; // 404 etc: don't retry
    await sleep(1500 * (attempt + 1));
  }
  return null;
}

async function tryOpenRouter(model, prompt) {
  const res = await postJson(
    'https://openrouter.ai/api/v1/chat/completions',
    { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    {
      model,
      messages: [
        { role: 'system', content: 'You extract metadata from institutional documents. Reply with ONE raw JSON object only. No reasoning, no prose, no markdown.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
      // Reasoning models otherwise burn the token budget thinking and return empty content.
      reasoning: { exclude: true, effort: 'low' },
    }
  );
  if (res.status !== 200) {
    console.warn(`[AI] OpenRouter ${model}: HTTP ${res.status} ${res.data?.error?.message || ''}`);
    return null;
  }
  const msg = res.data?.choices?.[0]?.message || {};
  return safeJsonParse(msg.content || msg.reasoning || '{}');
}

async function generateAiJson(prompt, filePart, hasText = true, preferredProvider = 'auto') {
  const errors = [];
  const choice = String(preferredProvider || 'auto').toLowerCase();

  const tryGeminiBlock = async () => {
    if (!GEMINI_API_KEY) {
      errors.push('Gemini API key not configured');
      return null;
    }
    for (const model of GEMINI_MODELS) {
      try {
        const out = await tryGemini(model, prompt, filePart);
        if (isUsable(out)) return { ...out, _provider: 'gemini', _model: model };
        if (out) errors.push(`${model}: empty result`);
      } catch (e) {
        errors.push(`${model}: ${e.message}`);
      }
    }
    return null;
  };

  const tryOpenRouterBlock = async () => {
    if (!OPENROUTER_API_KEY) {
      errors.push('OpenRouter API key not configured');
      return null;
    }
    if (!hasText) {
      errors.push('No extractable text (scanned PDF/image) — OpenRouter free models require extractable text');
      return null;
    }
    for (const model of OPENROUTER_MODELS) {
      try {
        console.log(`[AI] Using OpenRouter (${model})...`);
        const out = await tryOpenRouter(model, prompt);
        if (isUsable(out)) return { ...out, _provider: 'openrouter', _model: model };
        errors.push(`${model}: empty result`);
      } catch (e) {
        errors.push(`${model}: ${e.message}`);
      }
    }
    return null;
  };

  // 1. Direct OpenRouter selection
  if (choice === 'openrouter') {
    const res = await tryOpenRouterBlock();
    if (res) return res;
    throw new Error(`OpenRouter failed: ${errors.join(' | ')}`);
  }

  // 2. Direct Gemini selection
  if (choice === 'gemini') {
    if (isGeminiQuotaDepleted()) {
      throw new Error(`Gemini quota is currently depleted. ${geminiQuotaState.message || 'Please use OpenRouter.'}`);
    }
    const res = await tryGeminiBlock();
    if (res) return res;
    throw new Error(`Gemini failed: ${errors.join(' | ')}`);
  }

  // 3. Auto mode: If Gemini quota is depleted, prioritize OpenRouter directly!
  if (isGeminiQuotaDepleted() && OPENROUTER_API_KEY && hasText) {
    console.log('[AI] Gemini quota depleted. Auto-routing to OpenRouter...');
    const orRes = await tryOpenRouterBlock();
    if (orRes) return orRes;
  }

  // Otherwise, try Gemini first
  const gRes = await tryGeminiBlock();
  if (gRes) return gRes;

  // Fallback to OpenRouter
  if (OPENROUTER_API_KEY && hasText) {
    console.log('[AI] Gemini unavailable or quota exceeded. Falling back to OpenRouter...');
    const orRes = await tryOpenRouterBlock();
    if (orRes) return orRes;
  }

  throw new Error(`All AI providers failed. ${errors.join(' | ')}`);
}

// ── Helper to read GridFS Stream to Buffer ────────────────────
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ──────────────────────────────────────────────────────────────
// ENDPOINTS
// ──────────────────────────────────────────────────────────────

/**
 * Status probe — matches Cloud Function `aiStatus` contract exactly
 */
const getStatus = (req, res) => {
  const gemini = Boolean(GEMINI_API_KEY);
  const openrouter = Boolean(OPENROUTER_API_KEY);
  const configured = gemini || openrouter;
  const quotaDepleted = isGeminiQuotaDepleted();

  res.status(200).json({
    ok: true,
    configured,
    model: GEMINI_MODEL,
    threshold: 0.7,
    geminiQuota: {
      depleted: quotaDepleted,
      resetAt: geminiQuotaState.resetAt,
      message: geminiQuotaState.message,
      lastChecked: geminiQuotaState.lastChecked,
    },
    providers: [
      {
        id: 'auto',
        name: 'Auto (Best Available)',
        description: quotaDepleted ? 'Routes to OpenRouter (Gemini quota depleted)' : 'Gemini primary with OpenRouter fallback',
        available: configured,
      },
      {
        id: 'gemini',
        name: 'Google Gemini',
        model: GEMINI_MODEL,
        available: gemini && !quotaDepleted,
        quotaDepleted,
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        model: OPENROUTER_MODEL,
        available: openrouter,
      },
    ],
    fallbackActive: (openrouter && !gemini) || (quotaDepleted && openrouter),
    apiKeyHint: GEMINI_API_KEY ? `${GEMINI_API_KEY.slice(0, 4)}…` : null,
    openrouterKeyHint: OPENROUTER_API_KEY ? `${OPENROUTER_API_KEY.slice(0, 4)}…` : null,
  });
};

router.get('/status', getStatus);
router.post('/status', getStatus);
router.get('/aiStatus', getStatus);
router.post('/aiStatus', getStatus);


/**
 * POST /api/ai/analyzeDocument
 * Analyzes document binary and writes extracted intelligence to Firestore
 */
router.post('/analyzeDocument', async (req, res) => {
  try {
    const { documentId, fileContent } = req.body;
    if (!documentId) {
      return res.status(400).json({ error: 'documentId is required' });
    }

    const db = getFirestore();
    const docRef = db.collection('documents').doc(documentId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const docData = snap.data();

    // Mark as processing
    await docRef.update({
      aiState: 'processing',
      aiError: null,
      aiStartedAt: new Date().toISOString(),
    });

    let buffer = null;
    let mimeType = docData.mimeType || 'application/pdf';
    let fileName = docData.originalFileName || docData.title || 'document';

    // 1. Resolve File Bytes
    if (fileContent?.base64) {
      buffer = Buffer.from(fileContent.base64, 'base64');
      mimeType = fileContent.mimeType || mimeType;
      fileName = fileContent.name || fileName;
    } else if (docData.mongoFileId) {
      console.log(`[AI] Fetching binary from GridFS: ${docData.mongoFileId}`);
      const stream = await getDownloadStream(docData.mongoFileId);
      buffer = await streamToBuffer(stream);
    } else if (docData.storagePath) {
      const { getStorageBucket } = require('../services/firebase-admin');
      const bucket = getStorageBucket();
      const [downloaded] = await bucket.file(docData.storagePath).download();
      buffer = downloaded;
    }

    // 2. Prepare content for AI
    let filePart = null;
    let textContent = '';

    if (buffer) {
      if (mimeType === 'application/pdf') {
        filePart = {
          inlineData: {
            mimeType,
            data: buffer.toString('base64'),
          },
        };
        // Also extract text from PDF so fallback models have full text
        if (pdfParse) {
          try {
            let extracted = '';
            if (typeof pdfParse === 'function') {
              const res = await pdfParse(buffer);
              extracted = res?.text || '';
            } else if (pdfParse.PDFParse) {
              const parser = new pdfParse.PDFParse({ data: buffer });
              const res = await parser.getText();
              extracted = res?.text || '';
            }
            if (extracted) {
              textContent = smartExcerpt(extracted, 6000);
              console.log(`[AI] Extracted ${textContent.length} chars from PDF "${fileName}"`);
            }
          } catch (pdfErr) {
            console.warn('[AI] pdf-parse error (multimodal inline data still available):', pdfErr.message);
          }
        }
      } else if (mimeType.startsWith('image/')) {
        filePart = {
          inlineData: {
            mimeType,
            data: buffer.toString('base64'),
          },
        };
      } else if ((mimeType.includes('wordprocessingml') || String(fileName).toLowerCase().endsWith('.docx') || String(fileName).toLowerCase().endsWith('.doc')) && mammoth) {
        try {
          const { value } = await mammoth.extractRawText({ buffer });
          textContent = smartExcerpt(value, 6000);
          console.log(`[AI] Extracted ${textContent.length} chars from DOCX "${fileName}"`);
        } catch (mErr) {
          console.warn('[AI] mammoth extraction error:', mErr.message);
          textContent = smartExcerpt(buffer.toString('utf8'), 6000);
        }
      } else {
        textContent = smartExcerpt(buffer.toString('utf8'), 6000);
      }
    }

    // 3. Load institutional labels for classification
    let labelsList = [
      { id: 'minutes_of_meeting', name: 'Minutes of the Meeting', description: 'Records of discussions, decisions, and attendees of SSG or committee meetings' },
      { id: 'resolution', name: 'Resolution', description: 'Formal expressions of opinion, intention, or decision voted on by the student council' },
      { id: 'memorandum', name: 'Memorandum', description: 'Official internal communications, directives, circulars, or policy announcements' },
      { id: 'letter', name: 'Letter', description: 'Formal correspondence to administration, faculty, external partners, or students' },
      { id: 'narrative_report', name: 'Narrative Report', description: 'Detailed post-activity or accomplishment reports with documentation' },
      { id: 'notice', name: 'Notice', description: 'Formal public announcements, notices of meeting, calls for submission' },
      { id: 'request', name: 'Request', description: 'Formal requests for venue, equipment, excuse letters, or project approvals' },
      { id: 'financial', name: 'Financial Document', description: 'Budgets, liquidations, financial statements, receipts, and disbursement records' },
      { id: 'certification', name: 'Certification', description: 'Certificates of recognition, participation, clearance, or officer credentials' },
      { id: 'activity', name: 'Activity Document', description: 'Activity proposals, project designs, event guidelines, and program matrices' },
      { id: 'administrative', name: 'Administrative Document', description: 'Internal guidelines, inventories, rosters, and operational policies' },
      { id: 'other', name: 'Other', description: 'Any official document not fitting the standard categories' },
    ];
    try {
      const labelSnap = await db.collection('documentLabels').get();
      if (!labelSnap.empty) {
        labelsList = labelSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
    } catch (_) {}

    const permittedLabelsText = labelsList.map(l => `- "${l.id}": ${l.name} (${l.description || 'Institutional document'})`).join('\n');

    // 4. AI Analysis Prompt with Institutional Accuracy, Summary, Agenda, and Subject extraction
    const prompt = `You are an expert archivist analyzing an official document for Cebu Technological University (CTU) Student Government.

File name: ${fileName}
${textContent ? `Document text content:\n${textContent}\n` : ''}

Permitted Document Types / Labels:
${permittedLabelsText}

Extract strictly valid JSON with this schema:
{
  "title": "Clear, official document title as written",
  "documentNumber": "Reference, resolution, or memorandum control number (e.g. RESO-2026-001, MEMO No. 4) or null",
  "documentDate": "Date issued/signed in YYYY-MM-DD format, or null",
  "documentType": "One exact id from permitted list above (e.g. minutes_of_meeting, resolution, memorandum)",
  "documentTypeLabel": "The display name of the chosen document type",
  "summary": "A concise executive institutional summary (2 to 4 sentences) detailing the purpose, discussions, decisions, and required actions",
  "agenda": "The main agenda, core topic, or overarching discussion point of the document or meeting",
  "subject": "The primary subject line or theme of the document (e.g. 'Request for Venue', '6th Regular Session', 'Budget Proposal')",
  "authorName": "The individual who PREPARED, RECORDED, or DRAFTED this document (e.g. Secretary, Recorder, Prepared by). Null if not stated.",
  "authorRole": "The exact title/role beside author name, e.g. 'Secretary', 'Recorded by', 'Prepared by'",
  "labels": ["The chosen documentType id from the permitted list"],
  "signatories": [
    {
      "name": "Approving or endorsing official name (President, Adviser, Dean, Campus Director, etc.)",
      "position": "Official position or title (e.g. 'SSG President', 'SSG Adviser', 'Campus Director')",
      "required": true
    }
  ]
}

CRITICAL RULES:
1. SUMMARY, AGENDA, & SUBJECT:
   - Provide an accurate, comprehensive summary of the document contents.
   - Extract the main agenda and subject explicitly.
   - Do NOT extract or include Agenda Items lists, Organization/Offices, Deadlines, or Keywords.
2. CLASSIFICATION: Choose the most accurate documentType id from the permitted list:
   - "minutes_of_meeting": Meeting discussions, presiding officers, attendees, resolutions approved during meeting.
   - "resolution": Formal legislative resolutions with "WHEREAS" / "BE IT RESOLVED".
   - "memorandum": Official memos, directives, circulars.
   - "activity": Project proposals, activity designs.
   - "request": Letters of request, venue requests, excuse letters.
   - "financial": Budgets, liquidations, financial statements.
3. AUTHOR vs SIGNATORIES:
   - The AUTHOR (authorName) is who wrote/recorded/prepared the document (Secretary, Drafter, Prepared by).
   - SIGNATORIES are officials who must APPROVE, ATTEST, or NOTE the document (President, Adviser, Dean).
   - An author NEVER approves their own document. Do NOT put the author in the signatories list.
   - If no approval signatories are found, return [] for signatories.
4. OUTPUT:
   - Output ONLY the valid JSON object. No explanation or markdown blocks.`;

    const chosenProvider = req.body.provider || req.body.preferredProvider || 'auto';
    const analysis = await generateAiJson(prompt, filePart, Boolean(textContent && textContent.trim().length > 40), chosenProvider);

    // 5. Match label to system vocabulary accurately
    const targetType = String(analysis.documentType || '').toLowerCase().trim();
    const targetLabel = String(analysis.documentTypeLabel || '').toLowerCase().trim();

    let matchedLabel = labelsList.find(
      (l) => l.id.toLowerCase() === targetType || (l.name && l.name.toLowerCase() === targetLabel)
    );
    let labelFromHeuristic = false;

    // Weighted heuristic: the filename + document heading count far more than a
    // passing mention deep in the body (a letter that says "minutes" is still a letter).
    if (!matchedLabel || matchedLabel.id === 'other') {
      const head = `${fileName} ${String(textContent).slice(0, 600)}`.toLowerCase();
      const body = String(textContent).toLowerCase();
      const RULES = [
        ['letter', /transmittal|\bletter\b|dear\s+(sir|ma'?am|madam|dr|prof|mr|ms)|respectfully\s+yours|sincerely/],
        ['request', /letter\s+of\s+request|request\s+for|requesting|permission\s+to/],
        ['minutes_of_meeting', /minutes\s+of\s+(the\s+)?meeting|meeting\s+minutes|call\s+to\s+order|adjourn/],
        ['resolution', /\bresolution\b|\breso\b|be\s+it\s+resolved|whereas/],
        ['memorandum', /memorandum|\bmemo\b/],
        ['narrative_report', /narrative\s+report|accomplishment\s+report/],
        ['activity', /activity\s+design|project\s+proposal/],
        ['financial', /liquidation|disbursement|budget|financial\s+statement/],
        ['certification', /certif(y|ication)|this\s+is\s+to\s+certify/],
      ];
      let best = null;
      let bestScore = 0;
      for (const [id, re] of RULES) {
        const score = (re.test(head) ? 3 : 0) + (re.test(body) ? 1 : 0);
        if (score > bestScore && labelsList.some((l) => l.id === id)) {
          best = id;
          bestScore = score;
        }
      }
      if (best) {
        matchedLabel = labelsList.find((l) => l.id === best);
        labelFromHeuristic = true;
      }
    }

    if (!matchedLabel) {
      matchedLabel = labelsList.find((l) => l.id === 'other') || { id: 'other', name: 'Other' };
    }

    const validLabelIds = new Set(labelsList.map((l) => l.id));
    let detectedLabels = [matchedLabel.id];
    if (Array.isArray(analysis.labels)) {
      const filtered = analysis.labels.filter((l) => validLabelIds.has(l));
      if (filtered.length > 0) {
        detectedLabels = Array.from(new Set([matchedLabel.id, ...filtered]));
      }
    }

    // Clean Author
    const authorName = String(analysis.authorName || '').trim() || null;
    const authorRole = String(analysis.authorRole || (authorName ? 'Prepared by' : '')).trim() || null;

    // Filter Signatories (Drop anyone who is the author)
    const rawSignatories = Array.isArray(analysis.signatories) ? analysis.signatories : [];
    const canonical = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const cAuthor = canonical(authorName);

    const filteredSignatories = rawSignatories
      .map((s) => ({
        name: String(s.name || '').trim(),
        position: String(s.position || s.role || '').trim(),
        required: s.required !== false,
      }))
      .filter((s) => s.name || s.position)
      .filter((s) => {
        if (!cAuthor) return true;
        const n = canonical(s.name);
        return !(n && (n === cAuthor || n.includes(cAuthor) || cAuthor.includes(n)));
      });

    // 6. Signature Checklist & Summary
    const previousChecklist = docData.signatureChecklist || [];
    const previousByName = new Map(
      previousChecklist.map((s) => [`${s.name}|${s.position}`.toLowerCase(), s])
    );

    const signatureChecklist = filteredSignatories.map((s) => {
      const key = `${s.name}|${s.position}`.toLowerCase();
      const before = previousByName.get(key);
      return {
        name: s.name,
        position: s.position,
        required: s.required,
        status: before?.status || 'pending',
        signedAt: before?.signedAt ?? null,
        signedByName: before?.signedByName ?? null,
        source: 'ai_suggested',
      };
    });

    const signedCount = signatureChecklist.filter((s) => s.status === 'signed').length;
    const requiredTotal = signatureChecklist.filter((s) => s.required).length;
    const requiredPending = signatureChecklist.filter((s) => s.required && s.status !== 'signed').length;
    const progress = requiredTotal === 0 ? 0 : Math.round(((requiredTotal - requiredPending) / requiredTotal) * 100);
    const complete = requiredTotal > 0 && requiredPending === 0;

    const signatureSummary = {
      total: signatureChecklist.length,
      required: requiredTotal,
      signed: signedCount,
      requiredPending,
      progress,
      complete,
      state: signatureChecklist.length === 0
        ? 'no_signatures_detected'
        : complete
          ? 'complete'
          : signedCount > 0
            ? 'partially_signed'
            : 'pending',
    };

    // 7. Auto-fill All Root Document Fields (Summary, Agenda, Subject, Title, DocumentNumber, Date, Labels)
    const autoFilled = {};
    if (analysis.title) {
      autoFilled.title = analysis.title;
    }
    if (analysis.documentNumber) {
      autoFilled.documentNumber = analysis.documentNumber;
    }
    if (analysis.documentDate) {
      autoFilled.documentDate = analysis.documentDate;
    }
    if (analysis.summary) {
      autoFilled.summary = analysis.summary;
    }
    if (analysis.agenda) {
      autoFilled.agenda = analysis.agenda;
    }
    if (analysis.subject) {
      autoFilled.subject = analysis.subject;
    }
    if (detectedLabels.length > 0) {
      autoFilled.labels = detectedLabels;
    }

    const aiSuggestion = {
      documentType: matchedLabel.id,
      documentTypeLabel: matchedLabel.name,
      confidence: labelFromHeuristic ? 0.5 : (typeof analysis.confidence === 'number' ? analysis.confidence : 0.85),
      reason: labelFromHeuristic
        ? 'Guessed from filename/heading keywords — please confirm'
        : (analysis.reason || `Classified by ${analysis._provider || 'AI'} (${analysis._model || ''})`),
      requiresReview: labelFromHeuristic || (typeof analysis.confidence === 'number' && analysis.confidence < 0.75),
    };

    const aiExtraction = {
      title: analysis.title || docData.title,
      documentNumber: analysis.documentNumber || null,
      documentDate: analysis.documentDate || null,
      summary: analysis.summary || null,
      subject: analysis.subject || null,
      agenda: analysis.agenda || null,
      authorName,
      authorRole,
      signatories: filteredSignatories,
    };

    // 8. Update Firestore with complete Phase 2/3 schema
    const updates = {
      ...autoFilled,
      authorName: docData.authorName || authorName,
      authorRole: docData.authorRole || authorRole,
      summary: analysis.summary || docData.summary || 'Summary unavailable',
      extractedText: textContent || analysis.summary || null,
      aiConfidence: aiSuggestion.confidence,
      aiProcessedAt: new Date().toISOString(),
      aiState: 'ready_for_review',
      aiProvider: analysis._provider || null,
      aiModel: analysis._model || null,
      aiError: null,
      aiSuggestion,
      aiExtraction,
      aiSuggestions: {
        title: analysis.title || docData.title,
        documentNumber: analysis.documentNumber || docData.documentNumber || '',
        documentDate: analysis.documentDate || docData.documentDate || '',
        summary: analysis.summary || '',
        agenda: analysis.agenda || '',
        subject: analysis.subject || '',
        labels: detectedLabels,
        signatories: filteredSignatories,
      },
      signatureChecklist,
      signatureSummary,
    };

    await docRef.update(updates);
    console.log(`[AI] Document ${documentId} analyzed & updated successfully!`);

    res.status(200).json({
      success: true,
      documentId,
      provider: analysis._provider,
      model: analysis._model,
      geminiQuota: {
        depleted: isGeminiQuotaDepleted(),
        resetAt: geminiQuotaState.resetAt,
        message: geminiQuotaState.message,
      },
      autoFilled,
      ...updates,
    });
  } catch (err) {
    console.error('[AI] Analysis failed:', err);
    try {
      const { documentId } = req.body || {};
      if (documentId) {
        const db = getFirestore();
        await db.collection('documents').doc(documentId).update({
          aiState: 'failed',
          aiError: err.message,
        });
      }
    } catch (_) {}
    res.status(500).json({ error: 'Analysis failed', message: err.message });
  }
});

/**
 * POST /api/ai/confirmAnalysis
 * Confirm suggestions and apply them to official document metadata
 */
router.post('/confirmAnalysis', async (req, res) => {
  try {
    const { documentId, apply = [], overrides = {} } = req.body;
    if (!documentId) return res.status(400).json({ error: 'documentId is required' });

    const db = getFirestore();
    const docRef = db.collection('documents').doc(documentId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Document not found' });

    const docData = snap.data();
    const suggestion = docData.aiSuggestion || {};
    const extraction = docData.aiExtraction || {};
    const applied = [];
    const updates = { aiState: 'approved', ...overrides };

    // Fetch existing label slugs for resolving label names to slugs
    let labels = [];
    try {
      const labelSnap = await db.collection('documentLabels').get();
      labels = labelSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      // Ignore if documentLabels collection cannot be read
    }

    const resolveSlug = (nameOrSlug) => {
      const val = String(nameOrSlug || '').trim().toLowerCase();
      if (!val) return 'other';
      const match = labels.find((l) => (l.name && l.name.toLowerCase() === val) || l.id.toLowerCase() === val || (l.slug && l.slug.toLowerCase() === val));
      return match ? match.id : nameOrSlug;
    };

    if (apply.includes('documentType')) {
      const typeVal = overrides.documentType !== undefined ? overrides.documentType : (suggestion.documentTypeLabel || suggestion.documentType);
      if (typeVal) {
        updates.labels = [resolveSlug(typeVal)];
        applied.push('documentType');
      }
    }
    if (apply.includes('title')) {
      const val = overrides.title !== undefined ? overrides.title : (extraction.title || docData.title);
      if (val) {
        updates.title = val;
        applied.push('title');
      }
    }
    if (apply.includes('documentNumber')) {
      const val = overrides.documentNumber !== undefined ? overrides.documentNumber : extraction.documentNumber;
      if (val) {
        updates.documentNumber = val;
        applied.push('documentNumber');
      }
    }
    if (apply.includes('documentDate')) {
      const val = overrides.documentDate !== undefined ? overrides.documentDate : extraction.documentDate;
      if (val) {
        updates.documentDate = val;
        applied.push('documentDate');
      }
    }
    if (apply.includes('summary')) {
      const val = overrides.summary !== undefined ? overrides.summary : extraction.summary;
      if (val) {
        updates.summary = val;
        applied.push('summary');
      }
    }
    if (apply.includes('agenda')) {
      const val = overrides.agenda !== undefined ? overrides.agenda : extraction.agenda;
      if (val) {
        updates.agenda = val;
        applied.push('agenda');
      }
    }
    if (apply.includes('subject')) {
      const val = overrides.subject !== undefined ? overrides.subject : extraction.subject;
      if (val) {
        updates.subject = val;
        applied.push('subject');
      }
    }

    updates.verifiedFields = Array.from(new Set([...(docData.verifiedFields || []), ...applied]));

    await docRef.update(updates);
    res.status(200).json({ success: true, applied, updates });
  } catch (err) {
    console.error('[AI] Confirm analysis error:', err);
    res.status(500).json({ error: 'Confirm failed', message: err.message });
  }
});

/**
 * POST /api/ai/recordSignature
 * Tick or untick one signatory in signatureChecklist
 */
router.post('/recordSignature', async (req, res) => {
  try {
    const { documentId, index, signed, signedByName, note } = req.body;
    if (!documentId || typeof index !== 'number') {
      return res.status(400).json({ error: 'documentId and index are required' });
    }

    const db = getFirestore();
    const docRef = db.collection('documents').doc(documentId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Document not found' });

    const docData = snap.data();
    let checklist =
      (Array.isArray(docData.signatureChecklist) && docData.signatureChecklist.length > 0 ? [...docData.signatureChecklist] : null) ||
      (Array.isArray(docData.signatures) && docData.signatures.length > 0 ? [...docData.signatures] : null) ||
      (Array.isArray(docData.aiExtraction?.signatories) && docData.aiExtraction.signatories.length > 0 ? [...docData.aiExtraction.signatories] : null) ||
      (Array.isArray(docData.aiSuggestion?.signatories) ? [...docData.aiSuggestion.signatories] : []);

    if (index < 0 || index >= checklist.length) {
      return res.status(400).json({ error: `Signatory index ${index} out of range (total: ${checklist.length})` });
    }

    const entry = checklist[index];
    const now = new Date().toISOString();
    checklist[index] = {
      ...entry,
      status: signed ? 'signed' : 'pending',
      signedAt: signed ? entry.signedAt || now : null,
      signedByName: signed ? String(signedByName || entry.name || '').trim() : null,
      recordedNote: String(note || '').trim() || null,
    };

    const requiredTotal = checklist.filter((s) => s.required).length;
    const requiredPending = checklist.filter((s) => s.required && s.status !== 'signed').length;
    const signedCount = checklist.filter((s) => s.status === 'signed').length;
    const progress = requiredTotal === 0 ? 0 : Math.round(((requiredTotal - requiredPending) / requiredTotal) * 100);
    const complete = requiredTotal > 0 && requiredPending === 0;

    const signatureSummary = {
      total: checklist.length,
      required: requiredTotal,
      signed: signedCount,
      requiredPending,
      progress,
      complete,
      state: checklist.length === 0
        ? 'no_signatures_detected'
        : complete
          ? 'complete'
          : signedCount > 0
            ? 'partially_signed'
            : 'pending',
    };

    const updates = {
      signatureChecklist: checklist,
      signatures: checklist,
      signatureSummary,
      status: complete ? 'approved' : docData.status || 'pending',
    };

    await docRef.update(updates);
    res.status(200).json({ ok: true, index, progress, complete, signedCount, requiredTotal });
  } catch (err) {
    res.status(500).json({ error: 'recordSignature failed', message: err.message });
  }
});

router.__test = {
  generateAiJson,
  isUsable,
  tryGemini,
  tryOpenRouter,
};

module.exports = router;
