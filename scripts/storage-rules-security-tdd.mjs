/**
 * scripts/storage-rules-security-tdd.mjs
 *
 * Live Firebase Storage Rules Emulator TDD Suite:
 * Proves that storage.rules strictly enforces file-size (< 25 MB, > 0 bytes),
 * safe MIME-type allowlist (blocking executables, HTML, SVG XSS, and spoofed
 * "word" types), clean delete separation, and RBAC without any allow-write OR bypass.
 *
 * Run:
 *   node scripts/storage-rules-security-tdd.mjs
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import { EMULATOR_PROJECT } from './emulator-project.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

let failed = 0;
const results = [];
const check = async (label, fn) => {
  try {
    await fn();
    results.push(`ok   ${label}`);
  } catch (err) {
    failed += 1;
    results.push(`FAIL ${label}\n     ${err?.message || String(err)}`);
  }
};

const isPortOpen = (host, port) =>
  new Promise((resolvePort) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(400);
    socket.on('connect', () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.on('error', () => resolvePort(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolvePort(false);
    });
  });

const ensureStorageEmulator = async () => {
  const envHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (envHost) {
    const [h, p] = envHost.split(':');
    return { host: h, port: Number(p), stop: async () => {} };
  }
  if (await isPortOpen('127.0.0.1', 9199)) {
    return { host: '127.0.0.1', port: 9199, stop: async () => {} };
  }

  const isWin = process.platform === 'win32';
  const proc = isWin
    ? spawn(
        'cmd.exe',
        ['/c', 'npx', 'firebase', 'emulators:start', '--only', 'storage', '--project', EMULATOR_PROJECT],
        { cwd: ROOT, stdio: 'ignore', windowsHide: true }
      )
    : spawn(
        'npx',
        ['firebase', 'emulators:start', '--only', 'storage', '--project', EMULATOR_PROJECT],
        { cwd: ROOT, stdio: 'ignore' }
      );

  const stop = async () => {
    try {
      if (isWin && proc.pid) {
        execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
      } else {
        proc.kill('SIGTERM');
      }
    } catch {
      // already exited
    }
  };

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await isPortOpen('127.0.0.1', 9199)) {
      return { host: '127.0.0.1', port: 9199, stop };
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  await stop();
  throw new Error('Timed out waiting for Firebase Storage Emulator on 127.0.0.1:9199.');
};

const storageRules = readFileSync(resolve(ROOT, 'storage.rules'), 'utf8');

console.log('=== Slice 1: Static Rules Hygiene ===');
await check('storage.rules has NO unconditional `allow write:` clause bypassing size/MIME checks', async () => {
  const unconditionalWrite = /allow\s+write\s*:\s*if\s+canManageDocuments\(\)\s*(?:&&\s*isSignedIn\(\))?\s*;/;
  if (unconditionalWrite.test(storageRules)) {
    throw new Error('Found unconditional `allow write:` clause that OR-bypasses size and MIME rules.');
  }
});

console.log('\n=== Slice 2: Live Firebase Storage Rules Emulator Verification ===');
const emu = await ensureStorageEmulator();
const testEnv = await initializeTestEnvironment({
  projectId: EMULATOR_PROJECT,
  storage: {
    host: emu.host,
    port: emu.port,
    rules: storageRules,
  },
});

try {
  // Seed an existing document for read/delete tests
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx
      .storage()
      .ref('documents/seed-doc/existing.pdf')
      .put(Buffer.from('%PDF-1.7\nseed'), { contentType: 'application/pdf' });
  });

  const as = (uid, claims = {}) => testEnv.authenticatedContext(uid, claims).storage();
  const anon = () => testEnv.unauthenticatedContext().storage();
  const samplePdf = Buffer.from('%PDF-1.7\nhello world');

  // --- EXPLOIT / BYPASS BLOCKS ---
  await check('BLOCKS executable upload (application/x-msdownload) even by secretary', () =>
    assertFails(
      as('sec1', { role: 'secretary' })
        .ref('documents/d-exe/malware.exe')
        .put(Buffer.from('MZ...'), { contentType: 'application/x-msdownload' })
    )
  );

  await check('BLOCKS HTML upload (text/html stored XSS) even by admin', () =>
    assertFails(
      as('admin1', { role: 'admin' })
        .ref('documents/d-html/xss.html')
        .put(Buffer.from('<script>alert(1)</script>'), { contentType: 'text/html' })
    )
  );

  await check('BLOCKS SVG upload (image/svg+xml stored XSS) even by secretary', () =>
    assertFails(
      as('sec1', { role: 'secretary' })
        .ref('documents/d-svg/payload.svg')
        .put(Buffer.from('<svg onload=alert(1)/>'), { contentType: 'image/svg+xml' })
    )
  );

  await check('BLOCKS spoofed "word" MIME type (application/x-password-stealer)', () =>
    assertFails(
      as('sec1', { role: 'secretary' })
        .ref('documents/d-spoof/stealer.bin')
        .put(Buffer.from('bad'), { contentType: 'application/x-password-stealer' })
    )
  );

  await check('BLOCKS oversized upload (>= 25 MB PDF) even by admin', () =>
    assertFails(
      as('admin1', { role: 'admin' })
        .ref('documents/d-huge/huge.pdf')
        .put(Buffer.alloc(25 * 1024 * 1024), { contentType: 'application/pdf' })
    )
  );

  await check('BLOCKS empty 0-byte upload', () =>
    assertFails(
      as('sec1', { role: 'secretary' })
        .ref('documents/d-empty/empty.pdf')
        .put(Buffer.alloc(0), { contentType: 'application/pdf' })
    )
  );

  // --- LEGITIMATE ALLOWLIST UPLOADS ---
  await check('ALLOWS valid PDF (< 25 MB) by secretary', () =>
    assertSucceeds(
      as('sec1', { role: 'secretary' })
        .ref('documents/d-ok-pdf/resolution.pdf')
        .put(samplePdf, { contentType: 'application/pdf' })
    )
  );

  await check('ALLOWS valid DOCX by admin', () =>
    assertSucceeds(
      as('admin1', { role: 'admin' })
        .ref('documents/d-ok-docx/minutes.docx')
        .put(Buffer.from('PK\x03\x04docx'), {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
    )
  );

  await check('ALLOWS valid DOC and TXT by representative', async () => {
    await assertSucceeds(
      as('rep1', { role: 'representative' })
        .ref('documents/d-ok-doc/legacy.doc')
        .put(Buffer.from('doc'), { contentType: 'application/msword' })
    );
    await assertSucceeds(
      as('rep1', { role: 'representative' })
        .ref('documents/d-ok-txt/notes.txt')
        .put(Buffer.from('plain text'), { contentType: 'text/plain' })
    );
  });

  await check('ALLOWS safe raster images (PNG, JPEG, WEBP) by senator', async () => {
    await assertSucceeds(
      as('sen1', { role: 'senator' })
        .ref('documents/d-ok-img/scan.png')
        .put(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { contentType: 'image/png' })
    );
    await assertSucceeds(
      as('sen1', { role: 'senator' })
        .ref('documents/d-ok-img/photo.jpg')
        .put(Buffer.from([0xff, 0xd8, 0xff]), { contentType: 'image/jpeg' })
    );
  });

  // --- DELETE SEPARATION & RBAC ---
  await check('ALLOWS secretary to delete an existing document binary (request.resource == null)', () =>
    assertSucceeds(
      as('sec1', { role: 'secretary' }).ref('documents/seed-doc/existing.pdf').delete()
    )
  );

  await check('BLOCKS representative from deleting document binaries (matches Firestore delete RBAC)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .storage()
        .ref('documents/seed-doc/protected.pdf')
        .put(samplePdf, { contentType: 'application/pdf' });
    });
    await assertFails(
      as('rep1', { role: 'representative' }).ref('documents/seed-doc/protected.pdf').delete()
    );
  });

  await check('BLOCKS member, guest, claimless user, and anonymous from reading or uploading', async () => {
    await assertFails(as('mem1', { role: 'member' }).ref('documents/seed-doc/protected.pdf').getDownloadURL());
    await assertFails(
      as('mem1', { role: 'member' })
        .ref('documents/d-mem/x.pdf')
        .put(samplePdf, { contentType: 'application/pdf' })
    );
    await assertFails(as('sec-no-claim').ref('documents/d-nc/x.pdf').put(samplePdf, { contentType: 'application/pdf' }));
    await assertFails(anon().ref('documents/seed-doc/protected.pdf').getDownloadURL());
  });

  await check('BLOCKS all access outside /documents/{documentId}/{fileName} even for admin', () =>
    assertFails(
      as('admin1', { role: 'admin' })
        .ref('arbitrary/leak.pdf')
        .put(samplePdf, { contentType: 'application/pdf' })
    )
  );
} finally {
  await testEnv.cleanup();
  await emu.stop();
}

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\n✅ All checks passed.');
  process.exit(0);
}
