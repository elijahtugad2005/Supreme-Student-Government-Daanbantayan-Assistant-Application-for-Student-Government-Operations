/**
 * backend/scripts/delete-documents.js
 * 
 * Safely find and delete documents from Firestore and MongoDB GridFS.
 * Uses Firebase Admin SDK to bypass client-side permission restrictions.
 * 
 * Usage:
 *   node backend/scripts/delete-documents.js --list
 *   node backend/scripts/delete-documents.js --clean-local   (deletes RESO-002 and MOM-6th)
 *   node backend/scripts/delete-documents.js --id <docId>
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getFirestore } = require('../services/firebase-admin');
const { deleteFileFromGridFS } = require('../utils/gridfs');

async function run() {
  const args = process.argv.slice(2);
  const db = getFirestore();
  const col = db.collection('documents');

  if (args.includes('--list') || args.length === 0) {
    console.log('Fetching documents from Firestore...');
    const snap = await col.get();
    console.log(`\nFound ${snap.size} total document(s) in Firestore:`);
    console.log('------------------------------------------------------------');
    snap.forEach((doc) => {
      const d = doc.data();
      console.log(`ID:           ${doc.id}`);
      console.log(`Title:        ${d.title}`);
      console.log(`Doc Number:   ${d.documentNumber || '—'}`);
      console.log(`Storage Type: ${d.storageType || '(undefined - legacy local)'}`);
      console.log(`Storage Path: ${d.storagePath || '—'}`);
      console.log(`Mongo File ID:${d.mongoFileId || '—'}`);
      console.log(`Status:       ${d.status}`);
      console.log(`Created:      ${d.createdAt ? d.createdAt.toDate().toISOString() : '—'}`);
      console.log('------------------------------------------------------------');
    });

    if (args.length === 0) {
      console.log('\nOptions:');
      console.log('  node backend/scripts/delete-documents.js --clean-local');
      console.log('  node backend/scripts/delete-documents.js --id <docId>');
    }
    return;
  }

  if (args.includes('--clean-local')) {
    console.log('Searching for legacy local documents (RESO-002 and MOM-6th)...');
    const snap = await col.get();
    const targets = [];
    snap.forEach((doc) => {
      const d = doc.data();
      const title = (d.title || '').toLowerCase();
      if (
        title.includes('reso') ||
        title.includes('mom') ||
        d.storageType === undefined ||
        d.storageType === 'local'
      ) {
        targets.push({ id: doc.id, title: d.title, mongoFileId: d.mongoFileId });
      }
    });

    if (targets.length === 0) {
      console.log('No matching local documents found.');
      return;
    }

    console.log(`Found ${targets.length} matching document(s) to remove:`);
    for (const t of targets) {
      console.log(` - Deleting "${t.title}" (ID: ${t.id})...`);
      if (t.mongoFileId) {
        try {
          await deleteFileFromGridFS(t.mongoFileId);
          console.log(`   Deleted MongoDB GridFS file: ${t.mongoFileId}`);
        } catch (err) {
          console.log(`   (GridFS cleanup note: ${err.message})`);
        }
      }
      await col.doc(t.id).delete();
      console.log(`   Deleted from Firestore successfully.`);
    }
    console.log('\nAll targeted legacy local documents have been removed.');
    return;
  }

  const idIndex = args.indexOf('--id');
  if (idIndex !== -1 && args[idIndex + 1]) {
    const docId = args[idIndex + 1];
    console.log(`Deleting document with ID: ${docId}...`);
    const docRef = col.doc(docId);
    const snap = await docRef.get();
    if (!snap.exists) {
      console.error(`Document with ID ${docId} does not exist in Firestore.`);
      process.exit(1);
    }
    const d = snap.data();
    if (d.mongoFileId) {
      try {
        await deleteFileFromGridFS(d.mongoFileId);
        console.log(`Deleted MongoDB GridFS file: ${d.mongoFileId}`);
      } catch (err) {
        console.log(`(GridFS cleanup note: ${err.message})`);
      }
    }
    await docRef.delete();
    console.log(`Successfully deleted "${d.title}" (${docId}) from Firestore.`);
  }
}

run().catch((err) => {
  console.error('Error running delete-documents script:', err);
  process.exit(1);
});
