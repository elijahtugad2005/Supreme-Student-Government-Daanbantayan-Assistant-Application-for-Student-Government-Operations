// services/documentService.js
// PURPOSE: Phase 1 document repository.
//
// The file and its metadata are deliberately separate:
//   Storage  -> the original binary, addressed documents/{documentId}/{name}
//   Firestore-> documents/{documentId}, the searchable record
//
// This is what lets an administrator file a 10MB scanned resolution instead of
// the 1MB ceiling a Firestore document imposes, and it keeps the searchable
// collection small enough to query cheaply.
//
// Phase 2 (Gemini) will extend the SAME document record with extractedText,
// summary and aiConfidence rather than introducing a second store, so anything
// uploaded now becomes AI-processable later without a migration.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { fileStore } from './fileStore';
import {
  ACCEPTED_FORMATS,
  DOC_STATUS,
  MAX_FILE_BYTES,
  SEED_LABELS,
  isAcceptedFile,
  slugify,
} from '../utils/documentLabels';

export const DOCUMENTS = 'documents';
export const LABELS = 'documentLabels';

/**
 * One Storage path per document, named after the document so the folder is
 * browsable. The id is generated client-side so the file and its metadata can
 * be written together and rolled back together.
 */
const buildPath = (documentId, fileName) =>
  `${DOCUMENTS}/${documentId}/${sanitizeFileName(fileName)}`;

/** Strip anything that would confuse Storage paths or download filenames. */
export const sanitizeFileName = (name) =>
  String(name || 'document')
    .replace(/[^\w.\- ]+/g, '_')
    .trim()
    .slice(0, 120) || 'document';

export const mimeFor = (fileName) =>
  ACCEPTED_FORMATS.find((f) => fileName.toLowerCase().endsWith(f.ext))?.mime || 'application/octet-stream';

// ────────────────────────────────────────────────────────────
// VALIDATION
// ────────────────────────────────────────────────────────────

/**
 * Validate before uploading, so an oversized or unsupported file never reaches
 * Storage and never leaves a half-created record behind.
 */
export const validateFile = (file) => {
  if (!file) return { ok: false, message: 'Choose a file first.' };
  if (!isAcceptedFile(file)) {
    return {
      ok: false,
      message: `Unsupported file type. Accepted: ${ACCEPTED_FORMATS.map((f) => f.ext).join(', ')}`,
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      message: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${
        MAX_FILE_BYTES / 1024 / 1024
      } MB.`,
    };
  }
  if (file.size === 0) return { ok: false, message: 'That file is empty.' };
  return { ok: true };
};

// ────────────────────────────────────────────────────────────
// LABELS
// ────────────────────────────────────────────────────────────

/**
 * Create the starting taxonomy if it is missing.
 *
 * Idempotent and guarded by a module-level promise so a component that mounts
 * twice cannot race and produce duplicate labels.
 */
let seedPromise = null;
export const ensureSeedLabels = () => {
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    try {
      const existing = await getDocs(collection(db, LABELS));
      const present = new Set(existing.docs.map((d) => d.id));

      const missing = SEED_LABELS.filter((l) => !present.has(l.slug));
      await Promise.all(
        missing.map((label) =>
          setDoc(doc(db, LABELS, label.slug), {
            ...label,
            active: true,
            system: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        )
      );
      return missing.length;
    } catch (error) {
      // Let a later attempt retry rather than caching the failure forever.
      seedPromise = null;
      throw error;
    }
  })();

  return seedPromise;
};

export const saveLabel = async ({ slug, name, description, active, aiEnabled }, actor) => {
  const id = slug || slugify(name);
  await setDoc(
    doc(db, LABELS, id),
    {
      slug: id,
      name: name.trim(),
      description: String(description || '').trim(),
      active: active !== false,
      // Phase 2 reads this to decide which labels the classifier may suggest.
      aiEnabled: aiEnabled !== false,
      createdBy: actor?.uid || null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return id;
};

// ────────────────────────────────────────────────────────────
// UPLOAD
// ────────────────────────────────────────────────────────────

/**
 * Store a document: binary in Storage, searchable metadata in Firestore.
 *
 * If the metadata write fails after the file has uploaded, the uploaded object
 * is removed again. A half-created document — a file nobody can find from the
 * list — is worse than a clean failure.
 *
 * @param {Object} p
 * @param {File}   p.file
 * @param {Object} p.metadata title, documentNumber, status, documentDate, office, labels
 * @param {Object} p.actor
 * @param {(pct:number)=>void} [p.onProgress]
 */
/**
 * Turn a raw Storage failure into something actionable.
 *
 * A missing bucket is the confusing case: the browser reports it as a CORS
 * preflight error against firebasestorage.googleapis.com, which reads like a
 * network or origin problem and sends people hunting for CORS headers that are
 * not the issue. The bucket simply does not exist yet.
 */
const describeUploadFailure = (error, fileName) => {
  const code = error?.code || '';
  const message = String(error?.message || '');

  if (code === 'storage/unauthorized' || /403|PERMISSION_DENIED/i.test(message)) {
    const e = new Error(
      'Storage rejected the upload. Sign out and back in so your access token can refresh, ' +
        'then try again.'
    );
    e.code = 'storage/unauthorized';
    return e;
  }

  if (
    code === 'storage/canceled' ||
    /Failed to fetch|NetworkError|ERR_FAILED|CORS/i.test(message)
  ) {
    const e = new Error(
      `Could not reach Cloud Storage for ${fileName}. The usual cause is that no Storage bucket ` +
        'has been created for this project yet — open the Firebase console, Storage, and click ' +
        '"Get started" to create one. Check the bucket name in firebaseConfig.js afterwards.'
    );
    e.code = 'storage/unreachable';
    return e;
  }

  return error;
};

export const uploadDocument = async ({ file, metadata, actor, onProgress }) => {
  const check = validateFile(file);
  if (!check.ok) throw new Error(check.message);
  if (!metadata?.title?.trim()) throw new Error('A title is required.');

  // Pre-generate the id so both writes can target the same document.
  const documentRef = doc(collection(db, DOCUMENTS));
  const documentId = documentRef.id;
  const path = buildPath(documentId, file.name);

  // The store is chosen by config (see services/fileStore), so this call is
  // identical whether the bytes land in IndexedDB or Cloud Storage.
  try {
    await fileStore.put(path, file, onProgress);
  } catch (error) {
    throw describeUploadFailure(error, file.name);
  }

  onProgress?.(100);

  try {
    await setDoc(documentRef, {
      title: metadata.title.trim(),
      documentNumber: metadata.documentNumber?.trim() || '',
      status: metadata.status || DOC_STATUS.DRAFT,
      documentDate: metadata.documentDate || '',
      office: metadata.office?.trim() || '',
      labels: Array.isArray(metadata.labels) ? metadata.labels : [],
      keywords: Array.isArray(metadata.keywords) ? metadata.keywords : [],

      // Where the original lives.
      storagePath: path,
      originalFileName: file.name,
      mimeType: mimeFor(file.name),
      fileSize: file.size,

      createdBy: actor?.uid || null,
      createdByName: actor?.name || 'Unknown',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actor?.uid || null,

      // Phase 2 fills these in. Declared now so the schema does not shift when
      // AI processing arrives, and so "not yet processed" is explicit.
      extractedText: null,
      summary: null,
      aiConfidence: null,
      aiProcessedAt: null,
      aiState: 'not_processed',
    });
  } catch (error) {
    // Roll the binary back so Storage does not accumulate unreachable files.
    await fileStore.delete(path).catch(() => {});
    throw new Error(`Could not save the document record: ${error.message}`);
  }

  return documentId;
};

// ────────────────────────────────────────────────────────────
// READ
// ────────────────────────────────────────────────────────────

export const subscribeToDocuments = (onData, onError) =>
  onSnapshot(
    // Deliberately no orderBy: the dashboard sorts in memory, which avoids a
    // composite index for a collection that will stay small in Phase 1.
    query(collection(db, DOCUMENTS)),
    (snapshot) => onData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );

export const listDocuments = async () => {
  const snapshot = await getDocs(query(collection(db, DOCUMENTS), limit(500)));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const subscribeToLabels = (onData, onError) =>
  onSnapshot(
    query(collection(db, LABELS), orderBy('name')),
    (snapshot) => onData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );

/**
 * Download URL for a document.
 *
 * Fetched on demand rather than stored: download tokens are short-lived, so a
 * cached URL would silently break downloads later.
 */
export const getDocumentUrl = async (document) => {
  if (!document?.storagePath) return null;
  return fileStore.getUrl(document.storagePath);
};

// ────────────────────────────────────────────────────────────
// UPDATE / DELETE
// ────────────────────────────────────────────────────────────

export const updateDocument = async (documentId, patch, actor) => {
  await updateDoc(doc(db, DOCUMENTS, documentId), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: actor?.uid || null,
  });
};

export const getDocument = async (documentId) => {
  const snapshot = await getDoc(doc(db, DOCUMENTS, documentId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
};

/**
 * Delete the record and the original file together.
 *
 * If the Storage delete fails the record is deliberately LEFT in place. Removing
 * the metadata first would hide a file that still exists and cannot be recovered
 * from the UI.
 */
export const deleteDocument = async (documentId) => {
  const ref = doc(db, DOCUMENTS, documentId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return;
  const { storagePath } = snapshot.data();

  if (storagePath) {
    await fileStore.delete(storagePath);
  }
  await deleteDoc(ref);
};

/**
 * Search across the fields the specification calls out. Client-side because the
 * Phase 1 archive is small; Phase 2 can move this to a search index once the
 * collection grows.
 */
export const searchDocuments = (documents, { term = '', status = '', labels = [], office = '' } = {}) => {
  const needle = term.trim().toLowerCase();

  return documents.filter((d) => {
    if (status && d.status !== status) return false;
    if (labels.length && !labels.every((l) => (d.labels || []).includes(l))) return false;
    if (office && d.office !== office) return false;
    if (!needle) return true;

    return [d.title, d.documentNumber, d.originalFileName, d.office, d.summary]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(needle));
  });
};

export const addDocument = addDoc;