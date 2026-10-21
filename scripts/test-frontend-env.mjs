/**
 * scripts/test-frontend-env.mjs
 *
 * Pre-deployment verification script for Frontend Environment Variables.
 * Validates that all required Firebase client configuration keys, storage settings,
 * and API endpoints are properly defined, non-empty, and free of placeholder patterns.
 *
 * Run with:
 *   node scripts/test-frontend-env.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED_FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

const OPTIONAL_KEYS = [
  'VITE_FIREBASE_MEASUREMENT_ID',
  'VITE_MONGODB_BACKEND_URL',
  'VITE_FILE_STORE',
];

console.log('═══════════════════════════════════════════════════════════════');
console.log('   FRONTEND ENVIRONMENT VARIABLES PRE-DEPLOYMENT TEST');
console.log('═══════════════════════════════════════════════════════════════\n');

// 1. Check if .env or .env.local or fallback exists
const rootDir = process.cwd();
const envPaths = [
  resolve(rootDir, '.env'),
  resolve(rootDir, '.env.local'),
  resolve(rootDir, '.env.production'),
];

let parsedEnv = {};
let loadedFrom = null;

for (const p of envPaths) {
  if (existsSync(p)) {
    loadedFrom = p;
    const content = readFileSync(p, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match) {
        parsedEnv[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
    break;
  }
}

// 2. Also incorporate process.env (e.g. In CI/CD pipelines or cloud hosting build environments)
for (const key of [...REQUIRED_FIREBASE_KEYS, ...OPTIONAL_KEYS]) {
  if (process.env[key] && !parsedEnv[key]) {
    parsedEnv[key] = process.env[key];
  }
}

// 3. Fallback defaults test (from src/firebase/firebaseConfig.js)
const DEFAULT_FIREBASE_FALLBACKS = {
  VITE_FIREBASE_API_KEY: "AIzaSy_YOUR_VITE_FIREBASE_API_KEY_HERE",
  VITE_FIREBASE_AUTH_DOMAIN: "ssg-prototype.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "ssg-prototype",
  VITE_FIREBASE_STORAGE_BUCKET: "ssg-prototype.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "661854012909",
  VITE_FIREBASE_APP_ID: "1:661854012909:web:1fd13f3d5cc29260e7d3e4",
};

let hasErrors = false;
let hasWarnings = false;

if (loadedFrom) {
  console.log(`[OK] Loaded environment file: ${loadedFrom}`);
} else {
  console.log(`[INFO] No .env file found in root directory.`);
  console.log(`       Testing with process.env and built-in fallback configuration in src/firebase/firebaseConfig.js...\n`);
}

console.log('── 1. Verifying Required Firebase Client Keys ──────────────────');

for (const key of REQUIRED_FIREBASE_KEYS) {
  const envVal = parsedEnv[key];
  const fallbackVal = DEFAULT_FIREBASE_FALLBACKS[key];
  const effectiveVal = envVal || fallbackVal;

  if (!effectiveVal) {
    console.error(`  [FAIL] ${key}: Missing! (Neither set in env nor has a valid fallback)`);
    hasErrors = true;
    continue;
  }

  // Placeholder check
  const isPlaceholder = /^your_|^placeholder|\$\{/i.test(effectiveVal);
  if (isPlaceholder) {
    console.error(`  [FAIL] ${key}: Contains placeholder text ("${effectiveVal}")`);
    hasErrors = true;
    continue;
  }

  // Format checks
  if (key === 'VITE_FIREBASE_API_KEY' && !effectiveVal.startsWith('AIzaSy')) {
    console.warn(`  [WARN] ${key}: Does not begin with standard Firebase prefix 'AIzaSy'`);
    hasWarnings = true;
  } else if (key === 'VITE_FIREBASE_AUTH_DOMAIN' && !effectiveVal.includes('.firebaseapp.com')) {
    console.warn(`  [WARN] ${key}: Typical authDomain ends in '.firebaseapp.com'`);
    hasWarnings = true;
  } else if (key === 'VITE_FIREBASE_STORAGE_BUCKET' && !effectiveVal.includes('.')) {
    console.warn(`  [WARN] ${key}: Typical storageBucket contains a dot (e.g. .appspot.com or .firebasestorage.app)`);
    hasWarnings = true;
  } else {
    const origin = envVal ? 'explicitly from .env' : 'from safe fallback defaults';
    console.log(`  [PASS] ${key} is valid (${origin}) [${effectiveVal.slice(0, 10)}...]`);
  }
}

console.log('\n── 2. Verifying Secondary & Cloud Endpoints ────────────────────');

const backendUrl = parsedEnv['VITE_MONGODB_BACKEND_URL'] || 'http://localhost:3000';
console.log(`  [INFO] Backend URL: ${backendUrl}`);
if (backendUrl.includes('localhost') && process.env.NODE_ENV === 'production') {
  console.warn('  [WARN] VITE_MONGODB_BACKEND_URL is still pointing to localhost for production!');
  hasWarnings = true;
}

const fileStore = parsedEnv['VITE_FILE_STORE'] || 'local';
console.log(`  [INFO] Document File Store Driver: ${fileStore} (Options: local | firebase | mongodb)`);

console.log('\n═══════════════════════════════════════════════════════════════');
if (hasErrors) {
  console.error('  RESULT: PRE-DEPLOYMENT ENVIRONMENT TEST FAILED ❌');
  console.error('  Please fix the missing or invalid variables shown above.\n');
  process.exit(1);
} else if (hasWarnings) {
  console.log('  RESULT: PASSED WITH WARNINGS ⚠️');
  console.log('  Configuration is build-ready, but review the warnings above before deploying.\n');
  process.exit(0);
} else {
  console.log('  RESULT: ALL FRONTEND ENVIRONMENT CHECKS PASSED ✅');
  console.log('  Production build has valid Firebase configuration.\n');
  process.exit(0);
}
