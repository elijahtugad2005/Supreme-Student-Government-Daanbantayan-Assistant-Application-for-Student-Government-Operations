/**
 * functions/src/index.js
 *
 * Gemini callables for the document repository.
 *
 * SECURITY MODEL
 *   The API key never leaves this process. The React app calls these callables;
 *   it never talks to Google directly. That is the whole reason this file
 *   exists rather than a fetch() in the browser.
 *
 * AUTHORITY MODEL
 *   The model may only ever write a SUGGESTION. Verified fields are set only by
 *   `confirmAnalysis`, which is a human decision. There is deliberately no code
 *   path by which AI output becomes official without a person acting on it.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { initializeApp, getApps } from 'firebase-admin/app';
import { defineSecret } from 'firebase-functions/params';

/**
 * Admin SDK handles are loaded LAZILY, on first use inside a handler.
 *
 * This is not a micro-optimisation. The Functions emulator gives module
 * initialisation a hard 10-second budget and aborts the whole registration if it
 * is exceeded — leaving "valid functions are: " empty and every callable 404ing.
 * The admin SDK is the heaviest thing this file pulls in, and none of it is
 * needed merely to export the handlers, so it is kept out of startup.
 */
let adminMemo = null;
const admin = async () => {
  if (!adminMemo) {
    if (!getApps().length) initializeApp({
      storageBucket:
        process.env.STORAGE_BUCKET ||
        `${process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'ssg-prototype'}.firebasestorage.app`,
    });
    const [firestore, storage, auth] = await Promise.all([
      import('firebase-admin/firestore'),
      import('firebase-admin/storage'),
      import('firebase-admin/auth'),
    ]);
    adminMemo = { firestore, storage, auth };
  }
  return adminMemo;
};

// The bucket name is needed before any handler runs, and costs nothing to read.
initializeApp({
  storageBucket:
    process.env.STORAGE_BUCKET ||
    `${process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'ssg-prototype'}.firebasestorage.app`,
});

import {
  CLASSIFIER_SCHEMA,
  CONFIDENCE_THRESHOLD,
  EXTRACTOR_PROMPT,
  EXTRACTOR_SCHEMA,
  buildClassifierPrompt,
} from './prompts.js';
import { DOC_STATUS } from './docStatus.js';
import { buildFileParts } from './extract.js';
import { buildApplyPatch, guardRelativeDeadline, mergeVerifiedFields } from './apply.js';
import { GeminiError, generateJson, needsHumanReview } from './gemini.js';
import { openrouterGenerate } from './providers/openrouter.js';
import { AiProviderError, PROVIDER } from './providers/errors.js';
import { describeProviders, runWithFallback } from './ai/fallback.js';

// The bucket must be named explicitly. Left to infer it, the Admin SDK derives
// "<projectId>.appspot.com", which does not match the bucket the web app writes
// to ("<projectId>.firebasestorage.app") — the file upload would then appear to
// have vanished.
initializeApp({
  storageBucket:
    process.env.STORAGE_BUCKET ||
    `${process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'ssg-prototype'}.firebasestorage.app`,
});

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
// gemini-2.5-flash returns HTTP 404 for new Gemini projects ("no longer
// available to new users"), so the default must be the current model or every
// analysis fails out of the box.
const OPENROUTER_API_KEY = defineSecret('OPENROUTER_API_KEY');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const OPENROUTER_MODEL = process.env.OPENROUTER_AI_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free';

/**
 * Providers in preference order. Gemini leads because its structured-output
 * support is the most reliable; OpenRouter is the backup that keeps the system
 * working when Gemini's daily free-tier allowance is exhausted.
 */
const buildProviders = (secrets) => [
  {
    name: PROVIDER.GEMINI,
    model: GEMINI_MODEL,
    configured: Boolean(secrets.gemini),
    generate: (request) => generateJson({ ...request, apiKey: secrets.gemini, model: GEMINI_MODEL }),
  },
  {
    name: PROVIDER.OPENROUTER,
    model: OPENROUTER_MODEL,
    configured: Boolean(secrets.openrouter),
    generate: (request) =>
      openrouterGenerate({
        ...request,
        apiKey: secrets.openrouter,
        model: OPENROUTER_MODEL,
        referer: process.env.OPENROUTER_SITE_URL,
      }),
  },
];

const db = async () => (await admin()).firestore.getFirestore();

/** Firestore server timestamp, resolved lazily for the same reason. */
const now = async () => (await admin()).firestore.FieldValue.serverTimestamp();

/** Mirrors canManageDocuments in firestore.rules. */
const MANAGER_ROLES = ['admin', 'secretary', 'representative', 'senator'];
const VERIFIER_ROLES = ['admin', 'secretary'];

/**
 * Resolve and authorise the caller.
 *
 * The role is read from the ID token's custom claim first, then from the
 * Firestore user document.
 *
 * The claim is checked first for two reasons. It avoids a Firestore round trip
 * on every call, and — more importantly — it is the ONLY source that survives
 * when the function runs in the emulator against an empty emulator Firestore
 * while the browser is signed in against the real project. In that setup the
 * role exists in production Firestore, which the function cannot see.
 *
 * Callables already guarantee `request.auth` is set.
 */
const requireRole = async (request, allowed) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const uid = request.auth.uid;

  const claimRole = request.auth.token?.role || null;
  if (claimRole && allowed.includes(claimRole)) {
    return { uid, role: claimRole, name: request.auth.token?.name || 'Unknown' };
  }

  const snap = await (await db()).collection('users').doc(uid).get();
  const role = snap.exists ? snap.data()?.role || null : null;

  if (!role || !allowed.includes(role)) {
    // The uid is included because, during emulator development, the fix is to
    // seed that user into the emulator Firestore — and the operator needs to
    // know which uid to seed.
    throw new HttpsError(
      'permission-denied',
      `This action requires one of: ${allowed.join(', ')}. ` +
        `Your account (uid ${uid}) has no matching role in the database this function reads. ` +
        'During local development run: npm run seed:role -- --uid ' +
        uid + ' --role admin'
    );
  }
  return { uid, role, name: snap.data()?.name || 'Unknown' };
};

/** Map transport failures onto error codes the client can present sensibly. */
const toHttpsError = (error) => {
  if (error instanceof HttpsError) return error;
  if (error instanceof GeminiError) {
    // Quota details travel to the client so the UI can show WHEN the limit
    // resets instead of a bare "try again later".
    if (error.quotaType) {
      return new HttpsError('resource-exhausted', error.message, {
        quotaType: error.quotaType,
        resetAt: error.resetAt,
      });
    }
    if (error.retryable) {
      return new HttpsError('resource-exhausted', 'Gemini is rate limiting us. Try again shortly.');
    }
    if (error.status === 'blocked') {
      return new HttpsError('failed-precondition', error.message);
    }
    return new HttpsError('internal', error.message);
  }
  if (error?.code === 'FILE_TOO_LARGE_FOR_AI') {
    return new HttpsError('invalid-argument', error.message);
  }
  if (error?.code === 'UNSUPPORTED_FOR_AI' || error?.code === 'UNREADABLE') {
    return new HttpsError('failed-precondition', error.message);
  }
  return new HttpsError('internal', error.message || 'Analysis failed.');
};

/** Load the label vocabulary, including admin-authored descriptions. */
const loadLabels = async () => {
  const snap = await (await db()).collection('documentLabels').get();
  const labels = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return labels.filter((l) => l.active !== false && l.aiEnabled !== false);
};

/** Fetch the original file bytes from Storage. */
const fetchFile = async (doc) => {
  if (!doc?.storagePath) {
    throw new HttpsError('failed-precondition', 'This document has no file attached.');
  }
  const [buffer] = await (await admin()).storage.getStorage().bucket()
    .file(doc.storagePath)
    .download();
  return { buffer, mimeType: doc.mimeType || 'application/pdf', name: doc.originalFileName || 'document' };
};

/**
 * Resolve the file to analyse.
 *
 * The caller may send the bytes with the request. That matters in local storage
 * mode, where the document lives in the browser's IndexedDB and the function has
 * no way to fetch it — and where no Cloud Storage bucket exists at all. Fetching
 * from Storage remains the fallback for production, where the file does live
 * there.
 */
const resolveFile = async (request, doc) => {
  const inline = request.data?.fileContent;
  if (inline?.base64) {
    return {
      buffer: Buffer.from(inline.base64, 'base64'),
      mimeType: inline.mimeType || doc.mimeType || 'application/pdf',
      name: inline.name || doc.originalFileName || 'document',
      from: 'request',
    };
  }
  const fetched = await fetchFile(doc);
  return { ...fetched, from: 'storage' };
};

// Async because the Firestore handle and the timestamp sentinel are both loaded
// lazily on first use.
const writeAudit = async (documentId, entry) => {
  await (await db())
    .collection('documents')
    .doc(documentId)
    .collection('auditLogs')
    .add({ ...entry, at: await now() });
};

// ════════════════════════════════════════════════════════════
// ROLE CLAIMS
//
// WHY THIS EXISTS
//   storage.rules authorises on request.auth.token.role, because Storage rules
//   cannot read Firestore. Firestore rules read the role from the user document,
//   but that is useless to Storage. The role therefore has to be copied onto the
//   ID token as a custom claim.
//
// SECURITY
//   The role is read from users/{uid}.role — the same authoritative source the
//   rest of the app uses — and NEVER from the request body. A caller therefore
//   cannot ask for a role they do not hold: they can only ask for their own role
//   to be refreshed. Escalation would require editing the Firestore user
//   document, which firestore.rules already restricts to admins.
// ════════════════════════════════════════════════════════════

/** Roles that grant nothing and are safe to treat as "no role". */
const ROLE_VALUES = [
  'admin',
  'secretary',
  'finance_secretary',
  'governor',
  'senator',
  'representative',
  'member',
  'guest',
];

const setRoleClaim = async (uid, role) => {
  const user = await (await admin()).auth.getAuth().getUser(uid);
  // Preserving the existing claims keeps unrelated custom claims intact.
  await (await admin()).auth.getAuth().setCustomUserClaims(uid, { ...(user.customClaims || {}), role: role || null });
};

/**
 * Sync the caller's own role onto their token.
 * Safe to call from any signed-in client, on any sign-in path.
 */
export const syncClaims = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const uid = request.auth.uid;
  const snap = await (await db()).collection('users').doc(uid).get();
  const role = snap.exists ? snap.data()?.role : null;

  if (role && !ROLE_VALUES.includes(role)) {
    logger.warn('unknown role on user document', { uid, role });
  }

  // Only write when it differs, so a routine sign-in does not invalidate the
  // caller's existing token and force a refresh for nothing.
  const current = request.auth.token?.role || null;
  if (current === (role || null)) {
    return { ok: true, role: role || null, changed: false };
  }

  await setRoleClaim(uid, role);
  return { ok: true, role: role || null, changed: true };
});

/**
 * Push a role change to another user immediately.
 * Admin-only, so changing someone's role also takes effect for Storage without
 * waiting for their next token refresh.
 */
export const setRoleClaims = onCall(async (request) => {
  const actor = await requireRole(request, ['admin']);
  const { targetUid } = request.data || {};

  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid is required.');
  if (targetUid === actor.uid) {
    throw new HttpsError('failed-precondition', 'You cannot change your own claims.');
  }

  const snap = await (await db()).collection('users').doc(targetUid).get();
  if (!snap.exists) throw new HttpsError('not-found', 'That user has no profile document.');

  const role = snap.data()?.role || null;
  await setRoleClaim(targetUid, role);

  await writeAudit(targetUid, {
    action: 'role_claim_synced',
    performedBy: actor.uid,
    performedByName: actor.name,
    details: { role },
  });

  return { ok: true, role, uid: targetUid };
});

// ════════════════════════════════════════════════════════════
// ANALYZE — classification + extraction + summary, as suggestions
// ════════════════════════════════════════════════════════════════════

export const analyzeDocument = onCall(
  { secrets: [GEMINI_API_KEY, OPENROUTER_API_KEY], timeoutSeconds: 300, memory: '1GiB' },
  async (request) => {
    const actor = await requireRole(request, MANAGER_ROLES);
    const { documentId } = request.data || {};

    if (!documentId) throw new HttpsError('invalid-argument', 'documentId is required.');

    const docRef = (await db()).collection('documents').doc(documentId);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'That document no longer exists.');

    const doc = { id: snap.id, ...snap.data() };

    // Each operation resolves its own provider, so a Gemini quota block on the
    // classify step does not also kill the extraction.
    const providers = buildProviders({
      gemini: GEMINI_API_KEY.value(),
      openrouter: OPENROUTER_API_KEY.value(),
    });

    // Mark as processing so the UI queue reflects reality immediately.
    await docRef.update({
      aiState: 'processing',
      aiError: null,
      aiStartedAt: (await now()),
    });

    try {
      const file = await resolveFile(request, doc);
      const { parts, note } = await buildFileParts(file);
      const labels = await loadLabels();

      if (labels.length === 0) {
        throw new HttpsError('failed-precondition', 'No AI-enabled document labels are configured.');
      }

      // ── 1. Classify ──
      let classification = null;
      let classificationError = null;
      let usedProvider = null;
      try {
        const outcome = await runWithFallback(
          providers,
          {
            parts,
            systemInstruction: buildClassifierPrompt(labels),
            schema: CLASSIFIER_SCHEMA,
          },
          (attempt) => {
            if (attempt.outcome === 'failed') {
              logger.warn('classifier provider failed', {
                documentId,
                provider: attempt.provider,
                error: attempt.error,
              });
            }
          }
        );
        classification = outcome.result;
        usedProvider = outcome.provider;
      } catch (error) {
        // A failed classification must not lose a good extraction, so this is
        // recorded and the run continues.
        classificationError = error.message;
        logger.warn('classification failed', { documentId, error: error.message });
      }

      // ── 2. Extract ──
      const extractionOutcome = await runWithFallback(providers, {
        parts,
        systemInstruction: EXTRACTOR_PROMPT,
        schema: EXTRACTOR_SCHEMA,
      });
      usedProvider = usedProvider || extractionOutcome.provider;

      // A date the model calculated rather than read is discarded here, so a
      // relative deadline can never masquerade as a real one.
      const extraction = guardRelativeDeadline(extractionOutcome.result);

      // ── 3. Summarize ──
      let summary = null;
      try {
        const summaryOutcome = await runWithFallback(providers, {
          parts,
          systemInstruction:
            'Write a concise administrative brief for this official document. Two to four sentences, factual only.',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              actionRequired: { type: 'string' },
            },
            required: ['summary'],
          },
        });
        summary = summaryOutcome.result.summary;
        usedProvider = usedProvider || summaryOutcome.provider;
      } catch (error) {
        logger.warn('summary failed', { documentId, error: error.message });
      }

      // Map the chosen label name back to its stored slug.
      const chosen =
        labels.find(
          (l) => l.name.toLowerCase() === String(classification?.documentType || '').toLowerCase()
        ) || labels.find((l) => l.id === classification?.documentType) || null;

      const confidence = Number(classification?.confidence ?? 0);
      const requiresReview = needsHumanReview(confidence, CONFIDENCE_THRESHOLD);

      const suggested = {
        documentType: chosen ? chosen.id : 'other',
        documentTypeLabel: chosen ? chosen.name : 'Other',
        confidence: Number.isFinite(confidence) ? confidence : 0,
        reason: classification?.reason || null,
        // Below the threshold the UI asks a person rather than offering a
        // suggestion they might rubber-stamp.
        requiresReview,
        error: classificationError,
      };

      // ── Author vs signatory ──
      // The person who prepared a paper does not approve it. The model is told
      // this, but the check is repeated here because a self-signing author in an
      // official record is a real integrity problem, not a cosmetic one.
      const authorName = String(extraction.authorName || extraction.sender || '').trim();
      const authorRole = String(extraction.authorRole || '').trim();
      const canonical = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();

      // ── Normalise signatories ──
      const signatories = (extraction.signatories || [])
        .map((s) => ({
          name: String(s.name || '').trim(),
          position: String(s.position || '').trim(),
          required: s.required !== false,
        }))
        .filter((s) => s.name || s.position)
        .filter((s) => {
          // Drop anyone who is the author, matched loosely: "Dela Cruz, Juan"
          // and "Juan Dela Cruz" are the same person, and a reversed name order
          // would otherwise let them slip onto their own approval list.
          const a = canonical(authorName);
          if (!a) return true;
          const n = canonical(s.name);
          const p = canonical(s.position);
          if (!n) return true;
          if (n === a || p === a) return false;
          if (n.includes(a) || a.includes(n)) return false;
          // Name written surname-first: "Santos, Maria" vs "Maria Santos".
          const [surname, given] = n.split(',').map((x) => x.trim());
          if (surname && given) {
            const flipped = `${given} ${surname}`;
            if (canonical(flipped) === a || a.includes(canonical(flipped))) return false;
          }
          return true;
        })
        .filter((s) => canonical(s.name) !== canonical(authorName) || !authorName);

      // ── Signature checklist ──
      // Built from the signatories the document itself names. Existing statuses
      // are preserved when a document is re-analysed, so a recorded signature is
      // never wiped by a later upload of the same paper.
      const previousChecklist = doc.signatureChecklist || [];
      const previousByName = new Map(
        previousChecklist.map((s) => [`${s.name}|${s.position}`.toLowerCase(), s])
      );

      const signatureChecklist = signatories.map((s) => {
        const key = `${s.name}|${s.position}`.toLowerCase();
        const before = previousByName.get(key);
        return {
          name: s.name,
          position: s.position,
          required: s.required,
          // Keep an existing signature; default to pending for a new one.
          status: before?.status || 'pending',
          signedAt: before?.signedAt ?? null,
          signedByName: before?.signedByName ?? null,
          source: 'ai_suggested',
        };
      });

      const signedCount = signatureChecklist.filter((s) => s.status === 'signed').length;
      const requiredPending = signatureChecklist.filter(
        (s) => s.required && s.status !== 'signed'
      );
      const requiredTotal = signatureChecklist.filter((s) => s.required).length;

      // Progress is measured over REQUIRED signatures only; an optional
      // observer must not hold a document at 80%.
      const signatureProgress =
        requiredTotal === 0
          ? 0
          : Math.round(((requiredTotal - requiredPending.length) / requiredTotal) * 100);

      // Every required signature in means approved. Until then the document
      // cannot claim approval no matter what a person typed.
      const signatureComplete = requiredTotal > 0 && requiredPending.length === 0;

      // Status follows the checklist rather than being hand-editable into
      // "approved" on an unsigned paper.
      const nextStatus = signatureComplete
        ? DOC_STATUS.APPROVED
        : doc.status === DOC_STATUS.UNDER_REVIEW
          ? DOC_STATUS.UNDER_REVIEW
          : DOC_STATUS.PENDING;

      // ── Auto-fill ──
      // Only fills a field that is empty or still holds the filename-derived
      // default. A value a person typed is never overwritten, so automatic
      // filling can never destroy real input.
      const isUntouched = (value) =>
        !value || !String(value).trim() || String(value).trim() === String(doc.originalFileName || '').replace(/\.[^.]+$/, '');

      const autoFilled = {};
      if (isUntouched(doc.title) && extraction.title) {
        autoFilled.title = extraction.title;
      }
      if (!doc.documentNumber && extraction.documentNumber) {
        autoFilled.documentNumber = extraction.documentNumber;
      }
      if (!doc.office && (extraction.organization || extraction.sender)) {
        autoFilled.office = extraction.organization || extraction.sender;
      }
      if (!doc.subject && extraction.subject) {
        autoFilled.subject = extraction.subject;
      }

      // ── Persist ──
      // AI suggestions live under `ai*` keys; `autoFilled` and `signatureChecklist`
      // are factual observations about the paper, not opinions about it.
      await docRef.update({
        aiState: classificationError && !extraction ? 'failed' : 'suggested',
        aiProcessedAt: (await now()),
        aiProcessedBy: actor.uid,
        aiSuggestion: suggested,
        extractedText: null, // retained only if you later decide to store it
        summary,
        aiConfidence: Number.isFinite(confidence) ? confidence : null,
        aiExtraction: { ...extraction, signatories },
        aiSignatures: signatureChecklist.map((s) => ({ ...s, source: 'ai_suggested' })),
        aiReadMode: note,
        aiProvider: usedProvider,
        aiError: classificationError || null,

        signatureChecklist,
        signatureSummary: {
          total: signatureChecklist.length,
          required: requiredTotal,
          signed: signedCount,
          requiredPending: requiredPending.length,
          progress: signatureProgress,
          complete: signatureComplete,
          state: signatureChecklist.length === 0
            ? 'no_signatures_detected'
            : signatureComplete
              ? 'complete'
              : signedCount > 0
                ? 'partially_signed'
                : 'pending',
        },

        // Author recorded separately from the issuing office, and never on the
        // approval list.
        authorName: doc.authorName || authorName || null,
        authorRole: authorRole || null,
        ...(doc.status !== nextStatus ? { status: nextStatus } : {}),

        ...autoFilled,
      });

      await writeAudit(documentId, {
        action: 'signature_checklist_built',
        performedBy: actor.uid,
        performedByName: actor.name,
        details: {
          signatories: signatureChecklist.length,
          autoFilled: Object.keys(autoFilled),
        },
      });

      await writeAudit(documentId, {
        action: 'ai_analysis_completed',
        performedBy: actor.uid,
        performedByName: actor.name,
        details: {
          documentType: suggested.documentType,
          confidence: suggested.confidence,
          requiresReview,
          // Recorded so an auditor can see the backup was used, rather than two
          // providers silently producing the same answer.
          provider: usedProvider,
          providersAvailable: describeProviders(providers).filter((p) => p.configured).length,
          readMode: note,
          fileSource: file.from,
        },
      });

      return {
        ok: true,
        suggestion: suggested,
        extraction,
        summary,
        requiresReview,
        threshold: CONFIDENCE_THRESHOLD,
        provider: usedProvider,
        // Reported so the UI can show what changed without re-reading the doc.
        autoFilled,
        authorName: doc.authorName || autoFilled.authorName || authorName || null,
        authorRole: authorRole || null,
        signatureChecklist,
        signatureSummary: {
          total: signatureChecklist.length,
          required: requiredTotal,
          signed: signedCount,
          requiredPending: requiredPending.length,
          progress: signatureProgress,
          complete: signatureComplete,
          state: signatureChecklist.length === 0
            ? 'no_signatures_detected'
            : signatureComplete
              ? 'complete'
              : signedCount > 0
                ? 'partially_signed'
                : 'pending',
        },
        status: nextStatus,
      };
    } catch (error) {
      logger.error('analyzeDocument failed', { documentId, error: error.message });
      await docRef.update({
        aiState: 'failed',
        aiError: error.message,
        aiProcessedAt: (await now()),
      });
      await writeAudit(documentId, {
        action: 'ai_analysis_failed',
        performedBy: actor.uid,
        details: { error: error.message },
      });
      throw toHttpsError(error);
    }
  }
);

// ════════════════════════════════════════════════════════════
// SIGNATURE — mark one official as having signed (or not)
// ════════════════════════════════════════════════════════════

/**
 * Tick or untick one name on the approval checklist.
 *
 * Progress and status are RECOMPUTED here rather than trusted from the client,
 * because "approved" must never be a value the browser asserted about an
 * unsigned paper. Un-ticking is allowed so a signature recorded in error can be
 * corrected, and it immediately demotes the document out of "approved".
 */
export const recordSignature = onCall(async (request) => {
  const actor = await requireRole(request, MANAGER_ROLES);
  // Named documentId to match every other callable in this file.
  const { documentId, index, signed, signedByName, note } = request.data || {};

  if (!documentId || typeof index !== 'number') {
    throw new HttpsError('invalid-argument', 'documentId and index are required.');
  }
  if (typeof signed !== 'boolean') {
    throw new HttpsError('invalid-argument', 'signed must be true or false.');
  }

  const docRef = (await db()).collection('documents').doc(documentId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That document no longer exists.');

  const doc = snap.data();
  const checklist = Array.isArray(doc.signatureChecklist) ? doc.signatureChecklist : [];

  if (index < 0 || index >= checklist.length) {
    throw new HttpsError('invalid-argument', 'That signatory is no longer on the list.');
  }

  const entry = checklist[index];
  const now = new Date().toISOString();

  checklist[index] = {
    ...entry,
    status: signed ? 'signed' : 'pending',
    // Who put the tick, as well as who the signature belongs to. They are not
    // always the same person — an officer records a signature given in person.
    signedAt: signed ? entry.signedAt || now : null,
    recordedByUid: signed ? actor.uid : null,
    recordedByName: signed ? actor.name : null,
    signatureOnBehalfOf: signed ? String(signedByName || entry.name || '').trim() : null,
    recordedNote: String(note || '').trim() || null,
  };

  // Recompute from the checklist, never from what the caller claims.
  const requiredTotal = checklist.filter((s) => s.required).length;
  const requiredPending = checklist.filter((s) => s.required && s.status !== 'signed').length;
  const signedCount = checklist.filter((s) => s.status === 'signed').length;
  const progress = requiredTotal === 0
    ? 0
    : Math.round(((requiredTotal - requiredPending.length) / requiredTotal) * 100);
  const complete = requiredTotal > 0 && requiredPending.length === 0;

  const status = complete
    ? DOC_STATUS.APPROVED
    : doc.status === DOC_STATUS.UNDER_REVIEW
      ? DOC_STATUS.UNDER_REVIEW
      : DOC_STATUS.PENDING;

  await docRef.update({
    signatureChecklist: checklist,
    signatureSummary: {
      total: checklist.length,
      required: requiredTotal,
      signed: signedCount,
      requiredPending: requiredPending.length,
      progress,
      complete,
      state: checklist.length === 0
        ? 'no_signatures_detected'
        : complete
          ? 'complete'
          : signedCount > 0
            ? 'partially_signed'
            : 'pending',
    },
    status,
  });

  await writeAudit(documentId, {
    action: signed ? 'signature_recorded' : 'signature_removed',
    performedBy: actor.uid,
    performedByName: actor.name,
    details: { index, signatory: entry.name, position: entry.position, progress, status },
  });

  return { ok: true, index, progress, status, complete, signedCount, requiredTotal };
});

// ════════════════════════════════════════════════════════════
// CONFIRM — the human decision that makes a suggestion official
// ════════════════════════════════════════════════════════════

/**
 * Promote AI output into official metadata.
 *
 * `apply` lists which fields the administrator accepted. Anything not listed is
 * left alone, so accepting a classification does not silently overwrite a title
 * someone typed by hand.
 */
export const confirmAnalysis = onCall(async (request) => {
  const actor = await requireRole(request, VERIFIER_ROLES);
  const { documentId, apply, overrides } = request.data || {};

  if (!documentId || !Array.isArray(apply) || apply.length === 0) {
    throw new HttpsError('invalid-argument', 'documentId and a non-empty apply list are required.');
  }

  const docRef = (await db()).collection('documents').doc(documentId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That document no longer exists.');

  const doc = snap.data();
  const suggestion = doc.aiSuggestion || {};
  const extraction = doc.aiExtraction || {};

  const labelSnapshot = await (await db()).collection('documentLabels').get();
  const labels = labelSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

  // The decision rules live in apply.js so they can be tested without deploying.
  const { patch, accepted } = buildApplyPatch({
    apply,
    overrides,
    suggestion,
    extraction,
    labels,
  });

  if (Object.keys(patch).length === 0) {
    throw new HttpsError(
      'failed-precondition',
      'None of the selected fields had a value to apply.'
    );
  }

  await docRef.update({
    ...patch,
    // Provenance: which fields are human-verified, and which came from AI.
    verifiedFields: mergeVerifiedFields(doc.verifiedFields, accepted),
    aiState: 'verified',
    verifiedBy: actor.uid,
    verifiedByName: actor.name,
    verifiedAt: (await now()),
    updatedAt: (await now()),
    updatedBy: actor.uid,
  });

  await writeAudit(documentId, {
    action: 'ai_analysis_confirmed',
    performedBy: actor.uid,
    performedByName: actor.name,
    details: { accepted, confidence: suggestion.confidence },
  });

  return { ok: true, applied: accepted };
});

// ════════════════════════════════════════════════════════════
// CORRECT — record a human disagreeing with the AI
// ════════════════════════════════════════════════════════════

/**
 * A correction is recorded even when the final label matches the AI's, because
 * "the AI was right" and "a person checked and agreed" are different facts.
 */
export const correctClassification = onCall(async (request) => {
  const actor = await requireRole(request, VERIFIER_ROLES);
  const { documentId, labelSlug, reason } = request.data || {};

  if (!documentId || !labelSlug) {
    throw new HttpsError('invalid-argument', 'documentId and labelSlug are required.');
  }

  const docRef = (await db()).collection('documents').doc(documentId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That document no longer exists.');

  const previous = snap.data()?.aiSuggestion?.documentType || null;

  await docRef.update({
    labels: [labelSlug],
    aiState: 'corrected',
    correctedBy: actor.uid,
    correctedByName: actor.name,
    correctedAt: (await now()),
    verifiedFields: mergeVerifiedFields(snap.data()?.verifiedFields, ['documentType']),
    updatedAt: (await now()),
    updatedBy: actor.uid,
  });

  await writeAudit(documentId, {
    action: 'classification_corrected',
    performedBy: actor.uid,
    performedByName: actor.name,
    details: { from: previous, to: labelSlug, reason: String(reason || '').trim() },
  });

  return { ok: true, from: previous, to: labelSlug };
});

// ════════════════════════════════════════════════════════════
// Status probe — lets the UI report the key's health without leaking it
// ════════════════════════════════════════════════════════════

export const aiStatus = onCall(
  { secrets: [GEMINI_API_KEY, OPENROUTER_API_KEY] },
  async () => {
    const gemini = GEMINI_API_KEY.value();
    const openrouter = OPENROUTER_API_KEY.value();

    const providers = describeProviders(buildProviders({ gemini, openrouter }));
    const active = providers.filter((p) => p.configured);

    return {
      // True when at least one provider can answer.
      configured: active.length > 0,
      // The assistant is only fully available when the primary works; the
      // backup alone is still usable, so it is reported separately.
      model: GEMINI_MODEL,
      threshold: CONFIDENCE_THRESHOLD,
      providers,
      fallbackActive: active.length > 0 && !providers.find((p) => p.name === PROVIDER.GEMINI)?.configured,
      // Presence only. The values never leave the function.
      apiKeyHint: gemini ? `${gemini.slice(0, 4)}…` : null,
      openrouterKeyHint: openrouter ? `${openrouter.slice(0, 4)}…` : null,
    };
  }
);