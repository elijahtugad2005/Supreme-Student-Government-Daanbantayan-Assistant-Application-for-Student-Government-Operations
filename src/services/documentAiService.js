// services/documentAiService.js
// PURPOSE: Phase 2/3 client side of document AI.
//
// The browser NEVER calls Gemini. It calls the Cloud Function, which holds the
// key. This module owns that boundary plus the pacing.
//
// WHY A QUEUE: the Gemini free tier allows roughly 15 requests per minute, and
// each analysed document costs up to three requests (classify, extract,
// summarize). Firing a button per document would exceed that within seconds, so
// work is serialised with a gap between items. Without this, batch analysis
// fails with 429s that look like a broken integration rather than a quota.

import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app';
import { GEMINI_LIMITS, recordUsage } from '../utils/aiCapacity';

const FUNCTIONS_REGION = 'us-central1';

const callable = (name) => {
  const fns = getFunctions(getApp(), FUNCTIONS_REGION);
  return httpsCallable(fns, name);
};

/**
 * Milliseconds to wait before starting the next document.
 *
 * Three requests per document against a 15/minute ceiling works out at roughly
 * five documents per minute. 12s between items leaves headroom for retries.
 */
export const QUEUE_INTERVAL_MS = 12_000;

/** Files the function cannot read; not worth queueing. */
export const AI_UNSUPPORTED = ['application/msword'];

export const aiSupported = (document) =>
  !!document?.storagePath &&
  !AI_UNSUPPORTED.includes(document?.mimeType) &&
  !String(document?.originalFileName || '').toLowerCase().endsWith('.doc');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Quota state.
 *
 * Gemini's free tier enforces a DAILY allowance that can be exhausted in one
 * afternoon and does not clear until midnight Pacific. Without a record of
 * that, the UI would keep offering an "Analyse" button that is guaranteed to
 * fail, and each press spends another request.
 *
 * Persisted so a page reload does not lose it.
 */
const QUOTA_KEY = 'ssg.ai.quota';

export const readQuota = () => {
  try {
    const raw = localStorage.getItem(QUOTA_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (!state?.resetAt) return null;
    // Discard once it has passed, so a stale block cannot disable the button
    // forever after the reset.
    if (Date.now() >= new Date(state.resetAt).getTime()) {
      localStorage.removeItem(QUOTA_KEY);
      return null;
    }
    return state;
  } catch {
    return null;
  }
};

const writeQuota = (state) => {
  try {
    if (state) localStorage.setItem(QUOTA_KEY, JSON.stringify(state));
    else localStorage.removeItem(QUOTA_KEY);
  } catch {
    /* private browsing — the in-memory state still applies for this session */
  }
};

/** Subscribe to quota changes so every mounted panel updates together. */
const quotaListeners = new Set();
export const onQuotaChange = (listener) => {
  quotaListeners.add(listener);
  return () => quotaListeners.delete(listener);
};
const notify = (state) => quotaListeners.forEach((l) => l(state));

/** Seconds until the daily allowance resets, or null if not blocked. */
export const secondsUntilReset = (quota = readQuota()) => {
  if (!quota?.resetAt) return null;
  const remaining = Math.ceil((new Date(quota.resetAt).getTime() - Date.now()) / 1000);
  return remaining > 0 ? remaining : null;
};

export const formatWait = (seconds) => {
  if (seconds === null || seconds === undefined) return '';
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (hours < 1) return `${mins}m`;
  return `${hours}h ${mins}m`;
};

/**
 * Read a quota failure out of a callable error and persist it.
 * A per-minute limit is deliberately NOT persisted — it clears in seconds and
 * blocking the button for a minute would be worse than letting them retry.
 */
export const captureQuotaError = (error) => {
  const quotaType = error?.details?.quotaType || error?.customData?.quotaType;
  const resetAt = error?.details?.resetAt || error?.customData?.resetAt;
  if (!quotaType || !resetAt) return null;

  const state = { quotaType, resetAt, at: new Date().toISOString() };
  if (quotaType === 'daily') {
    writeQuota(state);
    notify(state);
  }
  return state;
};

export const clearQuota = () => {
  writeQuota(null);
  notify(null);
};

/** Report whether an error is a quota problem, without persisting it. */
export const isQuotaError = (error) =>
  Boolean(error?.details?.quotaType || error?.customData?.quotaType);

/**
 * Largest ORIGINAL file whose content can travel inside a callable request.
 *
 * HTTP functions cap the request body at 10MB and base64 inflates by a third, so
 * the real ceiling is roughly 7MB of original file. Anything larger is not sent
 * inline; the function falls back to fetching it from Cloud Storage, which is
 * the production path.
 */
export const MAX_INLINE_BYTES = 6 * 1024 * 1024;

/** Read a File as base64, in chunks so a large file does not blow the call stack. */
const fileToBase64 = async (file) => {
  if (typeof file.arrayBuffer !== 'function') return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000; // String.fromCharCode's practical argument limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

/**
 * Analyse a document, carrying the file content inline when possible.
 *
 * In LOCAL storage mode the bytes live in IndexedDB, not Cloud Storage, so the
 * function cannot fetch them — and no production bucket exists yet. Passing the
 * content with the request removes that dependency and keeps analysis working
 * before any bucket is provisioned.
 */
export const analyzeDocumentContent = async (documentId, file) => {
  let inline = null;

  if (file && file.size <= MAX_INLINE_BYTES) {
    const base64 = await fileToBase64(file);
    if (base64) {
      inline = { base64, mimeType: file.type || 'application/octet-stream', name: file.name };
    }
  }

  try {
    const { data } = await callable('analyzeDocument')({
      documentId,
      ...(inline ? { fileContent: inline } : {}),
    });
    return data;
  } catch (error) {
    captureQuotaError(error);
    throw error;
  }
};

/**
 * Report whether the AI service has a key, without revealing it.
 *
 * THREE outcomes, not two:
 *   { ok: true,  configured: boolean, ... }  the callable answered
 *   { ok: false, error: string }             the callable could not be reached
 *   null                                      still probing
 *
 * The middle case matters: "cannot reach the service" is not "no key
 * configured", and conflating them sends people to edit an environment file
 * that is already correct.
 */
export const checkAiStatus = async () => {
  try {
    const { data } = await callable('aiStatus')();
    return { ok: true, ...data };
  } catch (error) {
    return { ok: false, error: error?.message || 'Unknown error' };
  }
};

export const analyzeOne = async (documentId) => {
  // Refuse before spending a request on a known-blocked day.
  if (secondsUntilReset() !== null) {
    const err = new Error("Gemini's daily allowance is used up. Try again after the reset.");
    err.quotaBlocked = true;
    throw err;
  }
  try {
    const { data } = await callable('analyzeDocument')({ documentId });
    return data;
  } catch (error) {
    captureQuotaError(error);
    throw error;
  }
};

/**
 * Promote AI output to official metadata.
 * @param {Array<string>} apply which suggested fields to accept
 * @param {Object} overrides corrected values for fields the admin changed
 */
export const confirmAnalysis = async (documentId, apply, overrides = {}) => {
  const { data } = await callable('confirmAnalysis')({ documentId, apply, overrides });
  return data;
};

/**
 * Tick or untick one signatory.
 *
 * Progress and the resulting status are recomputed by the function, so the UI
 * never asserts "approved" on the strength of a local click.
 */
export const recordSignature = async (documentId, index, signed, options = {}) => {
  const { data } = await callable('recordSignature')({
    documentId,
    index,
    signed,
    signedByName: options.signedByName,
    note: options.note,
  });
  return data;
};

export const correctClassification = async (documentId, labelSlug, reason) => {
  const { data } = await callable('correctClassification')({ documentId, labelSlug, reason });
  return data;
};

/**
 * Progress states for a single item, so the UI can show what is happening
 * rather than an opaque spinner.
 */
export const ITEM_STATE = {
  QUEUED: 'queued',
  ANALYZING: 'analyzing',
  DONE: 'done',
  FAILED: 'failed',
  UNSUPPORTED: 'unsupported',
};

/**
 * Run a list of documents through analysis, one at a time.
 *
 * Deliberately sequential and abortable: a burst would breach the free-tier
 * rate limit, and a failure on one document must not abandon the rest.
 *
 * @param {Array} documents
 * @param {(update: {id: string, state: string, result?: object, error?: string}) => void} onUpdate
 * @param {{ intervalMs?: number, signal?: AbortSignal }} [options]
 */
export const runAnalysisQueue = async (documents, onUpdate, options = {}) => {
  const intervalMs = options.intervalMs ?? QUEUE_INTERVAL_MS;

  for (const [index, document] of documents.entries()) {
    if (options.signal?.aborted) break;

    if (!aiSupported(document)) {
      onUpdate({
        id: document.id,
        state: ITEM_STATE.UNSUPPORTED,
        error: 'This file type cannot be read by the AI. Convert it to PDF or DOCX.',
      });
      continue;
    }

    onUpdate({ id: document.id, state: ITEM_STATE.ANALYZING });
    try {
      const result = await analyzeOne(document.id);
      // Counted only on success, so a quota failure does not consume the
      // document from the day's allowance in the local estimate.
      recordUsage(1, GEMINI_LIMITS.requestsPerDocument);
      onUpdate({ id: document.id, state: ITEM_STATE.DONE, result });
    } catch (error) {
      onUpdate({ id: document.id, state: ITEM_STATE.FAILED, error: error.message });
    }

    // Wait between items, but not after the last one.
    const isLast = index === documents.length - 1;
    if (!isLast && !options.signal?.aborted) await sleep(intervalMs);
  }
};