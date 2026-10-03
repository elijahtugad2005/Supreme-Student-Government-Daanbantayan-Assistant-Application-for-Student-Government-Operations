/**
 * scripts/migrate-legacy-pdfs.mjs
 *
 * One-off migration: legacy `pdfs` collection (PDF stored as Base64 inside a
 * Firestore document)  ->  `documents` collection + a file in Cloud Storage.
 *
 * WHY: a Firestore document caps at 1MB, and Base64 inflates by roughly a third,
 * so the old design could not hold a scanned resolution at all. Storage has no
 * such ceiling.
 *
 * SAFETY DESIGN
 *   - The old documents are NEVER deleted. Each is stamped `migrated` with the
 *     id of the record created from it, so a migration bug can be diagnosed
 *     against the source and the run can be repeated.
 *   - Idempotent. A document already migrated is skipped, so re-running after a
 *     partial failure is safe and does not duplicate anything.
 *   - Dry run by default. Nothing is written unless you pass --write.
 *   - Storage upload happens before the Firestore write, and a failed upload is
 *     recorded rather than swallowed.
 *
 * USAGE
 *   node scripts/migrate-legacy-pdfs.mjs                 # dry run, safe
 *   node scripts/migrate-legacy-pdfs.mjs --write         # perform the migration
 *   node scripts/migrate-legacy-pdfs.mjs --write --limit=20
 *   node scripts/migrate-legacy-pdfs.mjs --write --project=demo-ssg
 *   node scripts/migrate-legacy-pdfs.mjs --write --emulators
 *
 * Against emulators, FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST
 * must be set (see --emulators).
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.some((a) => a === `--${name}`);
const flagValue = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const WRITE = hasFlag('write');
const LIMIT = Number(flagValue('limit', '0')) || 0;
const PROJECT = flagValue('project', 'ssg-prototype');
const USE_EMULATORS = hasFlag('emulators');

if (USE_EMULATORS) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  // host:port only — the Admin SDK rejects a protocol prefix here.
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
}

/**
 * Status values differ between the old and new systems. These map the legacy
 * vocabulary onto the workflow states defined in utils/documentLabels.js, so
 * migrated documents do not land with a status nothing recognises.
 */
const STATUS_MAP = {
  approved: 'approved',
  pending: 'pending_signature',
  completed: 'completed',
  archived: 'archived',
  ongoing: 'under_review',
  draft: 'draft',
};

const labelFor = (category) => {
  const map = {
    Memorandum: 'memorandum',
    Announcement: 'notice',
    Letter: 'letter',
    Report: 'narrative_report',
    Form: 'administrative',
    Guideline: 'administrative',
  };
  return map[category] || 'administrative';
};

/** Turn "data:application/pdf;base64,AAA" into real bytes. */
export const decodeBase64 = (dataUrl) => {
  const comma = String(dataUrl).indexOf(',');
  if (comma === -1) throw new Error('not a data URL');
  return Buffer.from(String(dataUrl).slice(comma + 1), 'base64');
};

/** Keep a filename safe for a Storage path. */
const safeName = (name) =>
  String(name || 'document.pdf').replace(/[^\w.\- ]+/g, '_').trim().slice(0, 120) || 'document.pdf';

export const mapLegacyStatus = (status) => STATUS_MAP[String(status || '').toLowerCase()] || 'draft';

/**
 * Pure transformation of one legacy record into the new document shape, so it can
 * be unit tested without touching Firebase.
 */
export const toDocumentRecord = (legacy, { documentId }) => ({
  title: (legacy.pdfName || legacy.fileName || 'Untitled').trim(),
  documentNumber: '',
  status: mapLegacyStatus(legacy.pdfStatus),
  documentDate: legacy.pdfDate || '',
  office: '',
  labels: [labelFor(legacy.pdfCategory)],
  keywords: [],
  storagePath: `documents/${documentId}/${safeName(legacy.fileName || `${legacy.pdfName || 'document'}.pdf`)}`,
  originalFileName: legacy.fileName || safeName(legacy.pdfName),
  mimeType: 'application/pdf',
  fileSize: legacy.fileSize || 0,
  createdBy: null,
  createdByName: legacy.pdfCreator || 'Unknown',
  // Preserved so the migration is traceable in both directions.
  migratedFrom: {
    collection: 'pdfs',
    id: legacy.id,
    migratedAt: new Date().toISOString(),
  },
  createdAt: legacy.uploadedAt || new Date().toISOString(),
  updatedAt: legacy.lastModified || legacy.uploadedAt || new Date().toISOString(),
  updatedBy: null,
  extractedText: null,
  summary: null,
  aiConfidence: null,
  aiProcessedAt: null,
  aiState: 'not_processed',
});

const run = async () => {
  // Against the emulators no credential is needed, and passing `cert(undefined)`
  // throws. In production the caller must supply a service account.
  const credentialsPath = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH;
  if (USE_EMULATORS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
  } else if (!credentialsPath) {
    throw new Error(
      'Set FIREBASE_SERVICE_ACCOUNT_JSON_PATH to a service account JSON file before migrating production data.'
    );
  }

  const bucketName = flagValue('bucket', `${PROJECT}.firebasestorage.app`);

  // `credential: undefined` is not the same as omitting it — the admin SDK
  // rejects an explicit undefined, so the key is conditionally spread.
  const appOptions = {
    projectId: PROJECT,
    storageBucket: bucketName,
    ...(USE_EMULATORS ? {} : { credential: cert(credentialsPath) }),
  };

  const app = getApps()[0] || initializeApp(appOptions);

  const db = getFirestore(app);
  const bucket = getStorage(app).bucket();

  console.log(`\nLegacy PDF migration — ${WRITE ? 'WRITING' : 'DRY RUN (nothing will change)'}`);
  console.log(`Project: ${PROJECT}${USE_EMULATORS ? ' (emulators)' : ' (production)'}\n`);

  const legacySnapshot = await db.collection('pdfs').get();
  console.log(`Found ${legacySnapshot.size} legacy document(s).`);

  if (legacySnapshot.empty) {
    console.log('Nothing to migrate.');
    return;
  }

  // Already-migrated records are skipped so a re-run is safe.
  const migrated = legacySnapshot.docs.filter((d) => d.data()?.migrated?.documentId);
  const pending = legacySnapshot.docs.filter((d) => !d.data()?.migrated?.documentId);

  if (migrated.length) {
    console.log(`Skipping ${migrated.length} already migrated.`);
  }
  if (!pending.length) {
    console.log('All legacy documents have been migrated.');
    return;
  }

  const targets = LIMIT ? pending.slice(0, LIMIT) : pending;
  const summary = { migrated: 0, skipped: 0, failed: 0, noData: 0, bytes: 0 };

  for (const [index, snap] of targets.entries()) {
    const legacy = { id: snap.id, ...snap.data() };
    const title = legacy.pdfName || legacy.fileName || snap.id;

    if (!legacy.pdfBase64) {
      summary.noData += 1;
      console.log(`  [${index + 1}/${targets.length}] SKIP  ${title} — no Base64 data`);
      // Still stamped, so a re-run does not re-report it and an operator can
      // see at a glance that this record was examined and deliberately skipped.
      if (WRITE) {
        await snap.ref
          .set(
            { migrated: { documentId: null, at: new Date(), status: 'skipped_no_file_data' } },
            { merge: true }
          )
          .catch(() => {});
      }
      continue;
    }

    const record = toDocumentRecord(legacy, { documentId: `migrated-${snap.id}` });

    try {
      const bytes = decodeBase64(legacy.pdfBase64);

      if (!WRITE) {
        summary.skipped += 1;
        summary.bytes += bytes.length;
        console.log(
          `  [${index + 1}/${targets.length}] WOULD MIGRATE  ${title} ` +
            `(${bytes.length} bytes -> ${record.storagePath}) status=${record.status}`
        );
        continue;
      }

      await bucket.file(record.storagePath).save(bytes, {
        contentType: 'application/pdf',
        metadata: { metadata: { migratedFrom: `pdfs/${snap.id}` } },
      });

      const targetId = `migrated-${snap.id}`;
      await db
        .collection('documents')
        .doc(targetId)
        .set({ ...record, migratedFrom: { ...record.migratedFrom, documentId: targetId } });

      // The source is stamped, never removed.
      await snap.ref.set(
        {
          migrated: { documentId: `migrated-${snap.id}`, at: new Date(), status: 'ok' },
        },
        { merge: true }
      );

      summary.migrated += 1;
      summary.bytes += bytes.length;
      console.log(`  [${index + 1}/${targets.length}] MIGRATED  ${title} (${bytes.length} bytes)`);
    } catch (error) {
      summary.failed += 1;
      console.error(`  [${index + 1}/${targets.length}] FAILED   ${title} — ${error.message}`);
      await snap.ref
        .set({ migrated: { at: new Date(), status: 'error', error: error.message } }, { merge: true })
        .catch(() => {});
    }
  }

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`Migrated: ${summary.migrated}   Skipped: ${summary.skipped}   No data: ${summary.noData}   Failed: ${summary.failed}`);
  console.log(`Bytes moved: ${(summary.bytes / 1024 / 1024).toFixed(2)} MB`);
  if (!WRITE) {
    console.log('\nThis was a DRY RUN. Re-run with --write to perform the migration.');
  } else {
    console.log('\nDone. Legacy `pdfs` documents were stamped, not deleted.');
    console.log('Verify the archive in the app, then delete the `pdfs` collection yourself.');
  }
  void Timestamp;
};

// Only execute when run directly, so the helpers above can be imported by tests.
if (process.argv[1] && process.argv[1].includes('migrate-legacy-pdfs')) {
  run().catch((error) => {
    console.error('\nMigration aborted:', error.message);
    process.exit(1);
  });
}