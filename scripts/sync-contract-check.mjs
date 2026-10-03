/**
 * Regression guard for the Sheet Sync crash.
 *
 * `syncSourceToFirestore` takes ONE options object. It used to be called with
 * four positional arguments, which made every named parameter undefined and
 * threw "Cannot read properties of undefined (reading 'collection')" on
 * `mappingConfig.collection` before any sheet was ever parsed.
 *
 * This asserts the contract survives future edits, without needing a real
 * Google Sheet or file: `syncSourceToFirestore` validates its source only AFTER
 * reading `mappingConfig.collection`, so a valid contract reaches the source
 * check and a broken one dies on the property access instead.
 *
 *   npx firebase emulators:start --only firestore --project <your-project-id>
 *   node scripts/sync-contract-check.mjs
 */
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import { syncSourceToFirestore } from '../src/components/Data/sheetSyncService.js';
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import { readFileSync } from 'node:fs';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

const mappingConfig = { collection: 'orders', keyField: 'ssgdbId' };

// The emulator-backed Firestore read at the top of the function needs a live db.
const testEnv = await initializeTestEnvironment({
  projectId: EMULATOR_PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
});
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await ctx.firestore().collection('orders').doc('SSGDB-001').set({ orderId: 'SSGDB-001' });
});

// Source 12345 is neither a string nor a File, so a correct call reaches the
// source check and throws that specific error.
const EXPECTED = /Invalid data source provided/;
const CONTRACT_BREAK = /reading 'collection'/;

let correctError = null;
try {
  await testEnv.withSecurityRulesDisabled(async () => {
    await syncSourceToFirestore({
      source: 12345,
      mappingConfig,
      customMappings: null,
      callbacks: {},
    });
  });
} catch (e) {
  correctError = e.message;
}

check(
  'options-object call reaches the source check (mappingConfig is read)',
  EXPECTED.test(correctError || ''),
  `got: ${correctError}`
);
check(
  'options-object call never dereferences an undefined .collection',
  !CONTRACT_BREAK.test(correctError || ''),
  `got: ${correctError}`
);

// Reproduce the historical bug to prove the test can tell the two apart.
let brokenError = null;
try {
  await testEnv.withSecurityRulesDisabled(async () => {
    await syncSourceToFirestore(12345, mappingConfig, null, {});
  });
} catch (e) {
  brokenError = e.message;
}
check(
  'old positional style still reproduces the reported crash (test is meaningful)',
  CONTRACT_BREAK.test(brokenError || ''),
  `got: ${brokenError}`
);

await testEnv.cleanup();
console.log(results.join('\n'));
console.log(failed === 0 ? '\nSync call contract is intact.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);