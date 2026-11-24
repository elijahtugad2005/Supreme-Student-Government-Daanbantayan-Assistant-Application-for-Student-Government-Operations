/**
 * Verifies backend/utils/startupDiagnostics.js:
 *  - Accurately flags missing required/recommended env vars for deployment
 *  - Accurately reports connected / ready services when configured
 *  - NEVER leaks any secret value, token, password, or private key in console output
 *
 * Run: node scripts/backend-startup-diagnostics-tdd.mjs
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  collectEnvDiagnostics,
  formatEnvDiagnostics,
  runStartupDiagnostics,
} = require('../backend/utils/startupDiagnostics.js');

let failed = 0;
const results = [];
const check = (label, ok, detail = '') => {
  if (ok) results.push(`ok   ${label}`);
  else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// 1. Empty env scenario (fresh deployment platform before env vars are added)
const emptyDiag = collectEnvDiagnostics({}, { firebaseInitialized: false, serviceAccountFileExists: false });
const emptyText = formatEnvDiagnostics(emptyDiag);
check(
  'Empty env flags MONGODB_URI and Firebase credentials as missingRequired',
  emptyDiag.missingRequired.some((s) => s.includes('MONGODB_URI')) &&
    emptyDiag.missingRequired.some((s) => s.includes('FIREBASE_SERVICE_ACCOUNT')),
  JSON.stringify(emptyDiag.missingRequired)
);
check(
  'Empty env flags ALLOWED_ORIGINS, AI keys, and Telegram vars as missingRecommended',
  emptyDiag.missingRecommended.some((s) => s.includes('ALLOWED_ORIGINS')) &&
    emptyDiag.missingRecommended.some((s) => s.includes('GEMINI_API_KEY')) &&
    emptyDiag.missingRecommended.some((s) => s.includes('TELEGRAM_BOT_TOKEN')),
  JSON.stringify(emptyDiag.missingRecommended)
);
check(
  'Formatted output includes [ACTION REQUIRED] and [RECOMMENDED] deployment checklist',
  emptyText.includes('[ACTION REQUIRED]') && emptyText.includes('[RECOMMENDED]')
);

// 2. Full configured env scenario with realistic dummy secrets — MUST NEVER leak any value
const FAKE_SECRETS = {
  MONGODB_URI: 'mongodb+srv://ssguser:SUPER_SECRET_MONGO_PASS_999@cluster0.test.mongodb.net/ssg',
  FIREBASE_SERVICE_ACCOUNT: '{"project_id":"demo","private_key":"TOP_SECRET_FB_KEY_888"}',
  GEMINI_API_KEY: 'AIzaSyFAKE_GEMINI_SECRET_777',
  OPENROUTER_API_KEY: 'sk-or-v1-FAKE_OPENROUTER_SECRET_666',
  TELEGRAM_BOT_TOKEN: '999999:FAKE_TELEGRAM_BOT_SECRET_555',
  TELEGRAM_FACULTY_CHAT_ID: '-1001112223334',
  TELEGRAM_MAYORS_CHAT_ID: '-1005556667778',
  GOOGLE_DRIVE_OAUTH_CLIENT_ID: 'FAKE_GDRIVE_CLIENT_ID_444',
  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: 'FAKE_GDRIVE_CLIENT_SECRET_333',
  GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: 'FAKE_GDRIVE_REFRESH_222',
  PAGE_ACCESS_TOKEN: 'FAKE_PAGE_TOKEN_111',
  VERIFY_TOKEN: 'FAKE_VERIFY_TOKEN_000',
  ALLOWED_ORIGINS: 'https://shirio.example.com',
  NODE_ENV: 'production',
  PORT: '10000',
};

const logs = [];
const mockLogger = {
  log: (m) => logs.push(String(m)),
  warn: (m) => logs.push(String(m)),
  error: (m) => logs.push(String(m)),
};

let reportedMongoStatus = null;
const liveResult = await runStartupDiagnostics({
  env: FAKE_SECRETS,
  firebaseInitialized: true,
  getDatabase: async () => ({
    admin: () => ({ ping: async () => ({ ok: 1 }) }),
  }),
  logger: mockLogger,
  onMongoStatus: (s) => {
    reportedMongoStatus = s;
  },
});

const combinedOutput = logs.join('\n');

check(
  'Configured env reports zero missingRequired and zero missingRecommended',
  liveResult.diag.missingRequired.length === 0 && liveResult.diag.missingRecommended.length === 0,
  `req=${liveResult.diag.missingRequired.length}, rec=${liveResult.diag.missingRecommended.length}`
);
check(
  'Live MongoDB ping reports CONNECTED and updates mongo status callback',
  liveResult.mongoConnected === true &&
    reportedMongoStatus === 'connected' &&
    combinedOutput.includes('Live MongoDB GridFS ping: CONNECTED')
);
check(
  'Configured output shows READY for AI, Telegram, and ENABLED (oauth) for Drive Sync',
  combinedOutput.includes('AI Engine  : READY') &&
    combinedOutput.includes('Telegram   : READY') &&
    combinedOutput.includes('Drive Sync : ENABLED (oauth)')
);

const secretNeedles = [
  'SUPER_SECRET_MONGO_PASS_999',
  'TOP_SECRET_FB_KEY_888',
  'AIzaSyFAKE_GEMINI_SECRET_777',
  'sk-or-v1-FAKE_OPENROUTER_SECRET_666',
  'FAKE_TELEGRAM_BOT_SECRET_555',
  '-1001112223334',
  '-1005556667778',
  'FAKE_GDRIVE_CLIENT_ID_444',
  'FAKE_GDRIVE_CLIENT_SECRET_333',
  'FAKE_GDRIVE_REFRESH_222',
  'FAKE_PAGE_TOKEN_111',
  'FAKE_VERIFY_TOKEN_000',
];

const leaked = secretNeedles.filter((s) => combinedOutput.includes(s));
check(
  'Console output leaks ZERO secret values, tokens, chat IDs, or passwords',
  leaked.length === 0,
  `LEAKED: ${leaked.join(', ')}`
);

// 3. MongoDB ping failure scenario
let failedMongoStatus = null;
const failLogs = [];
const failRes = await runStartupDiagnostics({
  env: { MONGODB_URI: 'mongodb+srv://u:p@badhost' },
  firebaseInitialized: false,
  getDatabase: async () => {
    throw new Error('Server selection timed out');
  },
  logger: {
    log: (m) => failLogs.push(String(m)),
    warn: (m) => failLogs.push(String(m)),
    error: (m) => failLogs.push(String(m)),
  },
  onMongoStatus: (s) => {
    failedMongoStatus = s;
  },
});
check(
  'Failed MongoDB ping logs FAILED cleanly without crashing and sets status=error',
  failRes.mongoConnected === false &&
    failedMongoStatus === 'error' &&
    failLogs.some((l) => l.includes('Live MongoDB GridFS ping: FAILED'))
);

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\n✅ All checks passed.');
}
