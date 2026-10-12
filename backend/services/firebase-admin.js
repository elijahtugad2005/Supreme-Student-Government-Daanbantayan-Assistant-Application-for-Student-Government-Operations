const admin = require('firebase-admin');
const path = require('path');

let initialized = false;

/**
 * Initialize Firebase Admin SDK
 * Uses service account key for authentication
 */
function initializeFirebaseAdmin() {
  if (initialized) {
    return admin;
  }

  try {
    // Option 1: Use service account file (development)
    const serviceAccountPath = path.join(__dirname, '../firebase-service-account.json');
    
    // Try to load from file first
    let serviceAccount;
    try {
      serviceAccount = require(serviceAccountPath);
      console.log('[Firebase Admin] Loaded service account from file');
    } catch (fileError) {
      // Option 2: Use environment variables (production)
      console.log('[Firebase Admin] Service account file not found, using environment variables');
      
      if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error('Firebase Admin credentials not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY environment variables.');
      }

      serviceAccount = {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        // Private key from env var has escaped newlines, need to unescape
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      };
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: `${serviceAccount.project_id}.appspot.com`
    });

    initialized = true;
    console.log(`[Firebase Admin] Initialized successfully for project: ${serviceAccount.project_id}`);

    return admin;
  } catch (error) {
    console.error('[Firebase Admin] Initialization failed:', error.message);
    throw error;
  }
}

/**
 * Get initialized Firebase Admin instance
 */
function getFirebaseAdmin() {
  if (!initialized) {
    initializeFirebaseAdmin();
  }
  return admin;
}

/**
 * Verify Firebase ID token
 * @param {string} idToken - Firebase ID token from client
 * @returns {Promise<DecodedIdToken>}
 */
async function verifyIdToken(idToken) {
  const admin = getFirebaseAdmin();
  return await admin.auth().verifyIdToken(idToken);
}

/**
 * Get Firestore instance
 */
function getFirestore() {
  const admin = getFirebaseAdmin();
  return admin.firestore();
}

/**
 * Get Storage bucket
 */
function getStorageBucket() {
  const admin = getFirebaseAdmin();
  return admin.storage().bucket();
}

module.exports = {
  initializeFirebaseAdmin,
  getFirebaseAdmin,
  verifyIdToken,
  getFirestore,
  getStorageBucket
};
