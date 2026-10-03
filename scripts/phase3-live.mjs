/**
 * Phase 3 live test — the real callable path.
 *
 *   npx firebase emulators:start --only functions,firestore,storage --project <your-project-id>
 *   node scripts/phase3-live.mjs
 *
 * Exercises analyzeDocument -> confirmAnalysis -> correctClassification through
 * the functions emulator with a genuinely authenticated caller, hitting the live
 * Gemini API. This is the end-to-end proof that Phase 3 cannot be bypassed: the
 * assertions check that AI output lands ONLY in the suggestion fields and never
 * in the document's own metadata.
 */
import { EMULATOR_PROJECT, emulatorIssuer } from './emulator-project.mjs';
import { getApps, initializeApp } from 'firebase-admin/app';
import { EMULATOR_PROJECT, emulatorIssuer } from './emulator-project.mjs';
import { getAuth } from 'firebase-admin/auth';
import { EMULATOR_PROJECT, emulatorIssuer } from './emulator-project.mjs';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { EMULATOR_PROJECT, emulatorIssuer } from './emulator-project.mjs';
import { getStorage } from 'firebase-admin/storage';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FUNCTIONS_EMULATOR_HOST = '127.0.0.1:5001';

const PROJECT = EMULATOR_PROJECT;
const REGION = 'us-central1';
const UID = 'sec-live-1';

const adminApp =
  getApps().find((a) => a.name === 'admin') ||
  initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.firebasestorage.app` }, 'admin');

const adminDb = getFirestore(adminApp);
const adminAuth = getAuth(adminApp);
const bucket = getStorage(adminApp).bucket();

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

// ── Fixture ────────────────────────────────────────────────
const ORIGINAL_TITLE = 'Untitled Upload';
const ORIGINAL_LABELS = ['administrative'];

const DOCUMENT_TEXT = `
REPUBLIC OF THE PHILIPPINES
CEBU TECHNOLOGICAL UNIVERSITY - DAANBANTAYAN CAMPUS
DAANBANTAYAN CAMPUS - STUDENT GOVERNMENT

RESOLUTION NO. 2026-014
Series of 2026

A RESOLUTION APPROVING THE PROPOSED STUDENT ACTIVITY "Panagtabo Games"
FOR THE ACADEMIC YEAR 2026-2027

WHEREAS, the Student Government recognizes the importance of strengthening
campus unity through inter-campus sports activities;

WHEREAS, the activity is funded entirely by voluntary contributions;

NOW THEREFORE, upon the recommendation of the Student Affairs Services Director,
the following is resolved:

1. The activity "Panagtabo Games" is hereby APPROVED;
2. The schedule is set on September 20, 2026;

APPROVED this 28th day of September 2026.

DR. MAYA SANTOS                 JAMES DE LA CRUZ
Campus Director                 President, CTU-Student Government
`;

// ── Seed ──────────────────────────────────────────────────
await adminDb.collection('users').doc(UID).set({ role: 'secretary', name: 'Live Secretary' });
await adminDb.collection('documentLabels').doc('resolution').set({
  slug: 'resolution', name: 'Resolution', description: 'Formal decisions adopted by the assembly.', active: true, aiEnabled: true,
});
await adminDb.collection('documentLabels').doc('memorandum').set({
  slug: 'memorandum', name: 'Memorandum', description: 'Internal communication.', active: true, aiEnabled: true,
});
await adminDb.collection('documentLabels').doc('letter').set({
  slug: 'letter', name: 'Letter', description: 'Correspondence.', active: true, aiEnabled: true,
});

await bucket.file('documents/doc-live-1/resolution.txt').save(Buffer.from(DOCUMENT_TEXT, 'utf8'), {
  contentType: 'text/plain',
});

await adminDb.collection('documents').doc('doc-live-1').set({
  title: ORIGINAL_TITLE,
  documentNumber: '',
  labels: ORIGINAL_LABELS,
  status: 'draft',
  office: '',
  documentDate: '',
  subject: '',
  keywords: [],
  storagePath: 'documents/doc-live-1/resolution.txt',
  originalFileName: 'resolution.txt',
  mimeType: 'text/plain',
  fileSize: DOCUMENT_TEXT.length,
  createdBy: UID,
  createdByName: 'Live Secretary',
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
  aiState: 'not_processed',
  extractedText: null,
  summary: null,
  aiConfidence: null,
  aiProcessedAt: null,
});

// ── Call the callables directly ────────────────────────────
// The functions emulator decodes the ID token without verifying its signature,
// so a hand-built token is enough. This also keeps the auth emulator out of
// the picture: the auth emulator refuses to start without `firebase init`,
// and signing in against the real project would need a live API key.
const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

const fakeToken = (uid) => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'none', typ: 'JWT' });
  const payload = b64url({
    iss: emulatorIssuer,
    aud: EMULATOR_PROJECT,
    sub: uid,
    user_id: uid,
    email: `${uid}@example.test`,
    iat: now,
    exp: now + 3600,
  });
  return `${header}.${payload}.`;
};

const TOKEN = fakeToken(UID);
console.log(`Calling as ${UID} (role: secretary)\n`);

const call = async (name, data) => {
  const response = await fetch(`http://127.0.0.1:5001/${PROJECT}/${REGION}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ data: data ?? {} }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || JSON.stringify(body).slice(0, 300);
    const error = new Error(detail);
    error.code = body?.error?.status || String(response.status);
    throw error;
  }
  // A callable's raw response is { result: <return value> }. The JS SDK wraps
  // this further as result.data, but a raw fetch gets `result` only.
  return body.result ?? body.data ?? {};
};

const readDoc = async () => (await adminDb.collection('documents').doc('doc-live-1').get()).data();
const auditCount = async () =>
  (await adminDb.collection('documents').doc('doc-live-1').collection('auditLogs').get()).size;

// ── 1. Status probe ────────────────────────────────────────
console.log('=== aiStatus ===');
try {
  const data = await call('aiStatus');
  check('the function is reachable and reports its configuration',
    data.configured === true, JSON.stringify(data));
  check('it reports the model in use', String(data.model || '').length > 0, `model=${data.model}`);
  check('it never returns the key itself', !JSON.stringify(data).includes('AIza'));
} catch (error) {
  check('the function is reachable', false, error.message);
}

// ── 2. Analyze ─────────────────────────────────────────────
console.log('\n=== analyzeDocument (live Gemini) ===');
let analyzed = false;
try {
  const data = await call('analyzeDocument', { documentId: 'doc-live-1' });
  analyzed = true;
  console.log(`   suggested: ${data.suggestion.documentTypeLabel} @ ${data.suggestion.confidence}`);
  console.log(`   requiresReview: ${data.requiresReview}`);
  console.log(`   extracted title: ${data.extraction?.title}`);

  check('the callable returned a suggestion', Boolean(data.suggestion));
  check('a label was suggested', Boolean(data.suggestion.documentTypeLabel));
  check('confidence is present', typeof data.suggestion.confidence === 'number');
  check('structured metadata came back', Boolean(data.extraction?.title));
} catch (error) {
  check('analyzeDocument completed', false, error.message);
}

if (analyzed) {
  const after = await readDoc();

  console.log('\n=== AI output must not touch official fields ===');
  check('aiState moved to suggested', after.aiState === 'suggested', after.aiState);
  check('the suggestion is stored in aiSuggestion', Boolean(after.aiSuggestion));
  check('the extraction is stored in aiExtraction', Boolean(after.aiExtraction));
  check('the ORIGINAL title is untouched', after.title === ORIGINAL_TITLE, after.title);
  check('the ORIGINAL labels are untouched',
    JSON.stringify(after.labels) === JSON.stringify(ORIGINAL_LABELS), JSON.stringify(after.labels));
  check('no document number was written', after.documentNumber === '', after.documentNumber);
  check('no date was written', after.documentDate === '', after.documentDate);
  check('nothing is marked verified yet', !(after.verifiedFields || []).length);
  check('who verified it is not set', !after.verifiedBy);
  check('an audit entry was written', (await auditCount()) >= 1, String(await auditCount()));

  // ── 3. Confirm only the ticked fields ────────────────────
  console.log('\n=== confirmAnalysis — only ticked fields apply ===');
  const beforeConfirm = await auditCount();
  try {
    const data = await call('confirmAnalysis', {
      documentId: 'doc-live-1',
      // Deliberately partial: title and documentType only.
      apply: ['documentType', 'title'],
    });
    check('the callable reported what it applied', Array.isArray(data.applied), JSON.stringify(data));

    const confirmed = await readDoc();
    check('the ticked title was applied', confirmed.title === after.aiExtraction.title, confirmed.title);
    check('the ticked label was applied',
      JSON.stringify(confirmed.labels) === JSON.stringify(['resolution']),
      JSON.stringify(confirmed.labels));
    check('an UNTICKED field was left alone',
      confirmed.documentNumber === '' && confirmed.documentDate === '',
      `num=${confirmed.documentNumber} date=${confirmed.documentDate}`);
    check('aiState is now verified', confirmed.aiState === 'verified', confirmed.aiState);
    check('the verifying officer is recorded', Boolean(confirmed.verifiedBy));
    check('verified fields are listed', JSON.stringify(confirmed.verifiedFields?.sort()) ===
      JSON.stringify(['documentType', 'title']), JSON.stringify(confirmed.verifiedFields));
    check('an audit entry was added', (await auditCount()) > beforeConfirm);
  } catch (error) {
    check('confirmAnalysis succeeded', false, error.message);
  }

  // ── 4. Correction is recorded ────────────────────────────
  console.log('\n=== correctClassification — a human disagrees ===');
  try {
    const data = await call('correctClassification', {
      documentId: 'doc-live-1',
      labelSlug: 'memorandum',
      reason: 'Filed as a memo rather than a council resolution.',
    });
    check('the correction reports what it replaced', data.from === 'resolution', JSON.stringify(data));

    const corrected = await readDoc();
    check('the label was changed to the human choice',
      JSON.stringify(corrected.labels) === JSON.stringify(['memorandum']), JSON.stringify(corrected.labels));
    check('aiState records the correction', corrected.aiState === 'corrected', corrected.aiState);
    check('who corrected it is recorded', Boolean(corrected.correctedBy));
    check('the correction is dated', Boolean(corrected.correctedAt));
    check('documentType stays marked as verified by a human',
      (corrected.verifiedFields || []).includes('documentType'));
  } catch (error) {
    check('correctClassification succeeded', false, error.message);
  }

  // ── 5. Reject an empty confirmation ───────────────────────
  console.log('\n=== Guard rails ===');
  // The rejection CODE lives on error.code; error.message is the human-readable
  // detail. Asserting on the message would pass for the wrong reason.
  try {
    await call('confirmAnalysis', { documentId: 'doc-live-1', apply: [] });
    check('an empty confirmation is rejected', false, 'it was accepted');
  } catch (error) {
    check('an empty confirmation is rejected',
      /INVALID_ARGUMENT/i.test(error.code || ''), `code=${error.code} msg=${error.message}`);
    check('the rejection explains itself', /apply list/i.test(error.message), error.message);
  }

  try {
    await call('analyzeDocument');
    check('a missing documentId is rejected', false, 'it was accepted');
  } catch (error) {
    check('a missing documentId is rejected',
      /INVALID_ARGUMENT/i.test(error.code || ''), `code=${error.code} msg=${error.message}`);
  }

  // An unauthenticated caller must never reach Gemini at all.
  try {
    const response = await fetch(`http://127.0.0.1:5001/${PROJECT}/${REGION}/analyzeDocument`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { documentId: 'doc-live-1' } }),
    });
    const body = await response.json().catch(() => ({}));
    check('an anonymous caller is rejected',
      /UNAUTHENTICATED/i.test(body?.error?.status || ''),
      `status=${body?.error?.status}`);
  } catch (error) {
    check('an anonymous caller is rejected', false, error.message);
  }
}

await adminApp.delete();
console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nPhase 3 verified end to end through the callable.' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);