// scripts/emulator-project.mjs
// PURPOSE: Single source of truth for the emulator's project id.
//
// WHY THIS EXISTS
//   The emulator must be addressed by the SAME project id the app uses. It used
//   to be hardcoded as `demo-ssg` across a dozen test scripts, so changing the
//   emulator to `ssg-prototype` silently broke every one of them — and the
//   browser, which then requested the wrong path and got a 404 reported as a
//   CORS error.
//
// HOW IT RESOLVES
//   Reads VITE_FIREBASE_PROJECT_ID from .env.local, so the tests follow the app
//   automatically. Falls back to the emulator's own project, then to demo-ssg.

import { readFileSync, existsSync } from 'node:fs';

/** Parse a dotenv file without exposing any values. */
const readEnv = (path) => {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
};

/**
 * Resolve the project id, preferring an explicit override so a test run can be
 * pointed elsewhere without editing files:
 *   $env:EMULATOR_PROJECT = 'other-project'
 */
export const EMULATOR_PROJECT =
  process.env.EMULATOR_PROJECT ||
  readEnv('.env.local').VITE_FIREBASE_PROJECT_ID ||
  'demo-ssg';

export const EMULATOR_BUCKET = `${EMULATOR_PROJECT}.firebasestorage.app`;

export const EMULATOR_FUNCTIONS_ORIGIN = 'http://127.0.0.1:5001';

/** Base URL for a callable on the functions emulator. */
export const callableUrl = (name, region = 'us-central1') =>
  `${EMULATOR_FUNCTIONS_ORIGIN}/${EMULATOR_PROJECT}/${region}/${name}`;

/** Issuer/audience a hand-built emulator token must carry. */
export const emulatorIssuer = `https://securetoken.google.com/${EMULATOR_PROJECT}`;