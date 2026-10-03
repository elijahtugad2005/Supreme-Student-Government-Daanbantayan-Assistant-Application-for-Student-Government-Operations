// firebase/emulators.js
// PURPOSE: Optionally point the app at the local Firebase emulators.
//
// WHY THIS FILE EXISTS
//   Without it, the app always calls the REAL production endpoints. The Gemini
//   callables would hit
//     https://us-central1-<project>.cloudfunctions.net/aiStatus
//   which returns 404 until `firebase deploy --only functions` has been run.
//   That 404 surfaces as "Could not reach the AI service", and starting the
//   emulators does not help — the app was never told to look at them.
//
//   Firestore and Storage reached production fine, which is why the mismatch was
//   easy to miss: everything else worked while only the AI was broken.
//
// USAGE
//   VITE_USE_EMULATORS=true  -> connect to localhost
//   unset or false           -> talk to production (default)
//
//   Set it in .env.local alongside:
//     npm run emulators

import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { initializeApp, getApps, getApp } from 'firebase/app';

const EMULATORS = {
  auth: 'http://127.0.0.1:9099',
  firestore: { host: '127.0.0.1', port: 8080 },
  storage: { host: '127.0.0.1', port: 9199 },
  functions: { host: '127.0.0.1', port: 5001 },
};

let connected = false;

/**
 * Which services may be redirected.
 *
 * DEFAULT: firestore and functions.
 *
 * `functions` alone is not enough when the AI is in play. The browser writes
 * documents to Firestore and the Cloud Function reads them back through the
 * admin SDK, which follows FIRESTORE_EMULATOR_HOST. With Firestore left on
 * production, the function looks in the emulator's Firestore, finds nothing,
 * and reports "That document no longer exists" for a document the user can see.
 * The two must share one Firestore.
 *
 * `auth` is deliberately excluded: the Auth emulator knows nothing about real
 * accounts, so Google sign-in would break.
 *
 * Opt out entirely for the features that work against production data:
 *   VITE_EMULATOR_SERVICES=functions
 */
const DEFAULT_SERVICES = ['firestore', 'functions'];

const selectedServices = () => {
  const explicit = import.meta.env?.VITE_EMULATOR_SERVICES;
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return DEFAULT_SERVICES;
};

const shouldConnect = (service) => selectedServices().includes(service);

/** True when the app has been pointed at the emulators. */
export const usingEmulators = () =>
  String(import.meta.env?.VITE_USE_EMULATORS || '').toLowerCase() === 'true';

/** Services currently redirected — useful for the startup log. */
export const emulatorServices = () => selectedServices();

/**
 * Connect the selected Firebase services to their local emulator.
 * Safe to call more than once — each connector is guarded.
 */
export const connectToEmulators = () => {
  if (connected) return;
  connected = true;

  const app = getApps().length ? getApp() : initializeApp();

  if (shouldConnect('auth')) {
    try {
      connectAuthEmulator(getAuth(app), EMULATORS.auth, { disableWarnings: true });
    } catch {
      /* already connected */
    }
  }

  if (shouldConnect('firestore')) {
    try {
      // A second call throws; the emulator logs its own warning.
      connectFirestoreEmulator(getFirestore(app), EMULATORS.firestore.host, EMULATORS.firestore.port);
    } catch {
      /* already connected */
    }
  }

  if (shouldConnect('storage')) {
    try {
      connectStorageEmulator(getStorage(app), EMULATORS.storage.host, EMULATORS.storage.port);
    } catch {
      /* already connected */
    }
  }

  if (shouldConnect('functions')) {
    try {
      const region = import.meta.env?.VITE_FUNCTIONS_REGION || 'us-central1';
      connectFunctionsEmulator(
        getFunctions(app, region),
        EMULATORS.functions.host,
        EMULATORS.functions.port
      );
    } catch {
      /* already connected */
    }
  }
};
