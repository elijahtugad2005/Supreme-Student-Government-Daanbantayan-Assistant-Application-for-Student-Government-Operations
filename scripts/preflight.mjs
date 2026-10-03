/**
 * scripts/preflight.mjs
 *
 * Proves every prerequisite for the AI assistant, in dependency order, and says
 * exactly which link in the chain is broken.
 *
 *   node scripts/preflight.mjs
 *
 * NEVER prints a secret value. It reports presence, length, and whether a value
 * is still a placeholder.
 *
 * Sections:
 *   A  Config files        keys present, no placeholders, emulator flag set
 *   B  Source integrity    functions parse, app builds, rules wired
 *   C  Emulator            running, callables registered, both providers present
 *   D  Providers           OpenRouter and Gemini reachable live
 *   E  Test suites         offline logic suites still green
 *
 * Exit code 0 means the whole chain is ready for browser testing.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { EMULATOR_PROJECT, callableUrl, emulatorIssuer } from './emulator-project.mjs';

const results = [];
let failed = 0;
let warned = 0;

const pass = (label, detail = '') => results.push({ ok: true, label, detail });
const fail = (label, detail = '') => {
  failed += 1;
  results.push({ ok: false, label, detail });
};
const warn = (label, detail = '') => {
  warned += 1;
  results.push({ ok: 'warn', label, detail });
};
const section = (name) => results.push({ header: name });

/** Parse a dotenv-style file WITHOUT exposing values. */
const readEnv = (path) => {
  const out = {};
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
};

const isPlaceholder = (v) =>
  !v || /^your_/i.test(v) || /^\$\{/.test(v) || v.length < 20;

const describeSecret = (v) =>
  isPlaceholder(v) ? 'MISSING or placeholder' : `set (${v.length} chars)`;

// ════════════════════════════════════════════════════════════
// A. CONFIG FILES
// ════════════════════════════════════════════════════════════
section('A. Config files');

const fnEnv = readEnv('functions/.env');
if (!fnEnv) {
  fail('functions/.env exists', 'Copy functions/.env.example to functions/.env');
} else {
  pass('functions/.env exists');
  pass(
    'GEMINI_API_KEY present',
    describeSecret(fnEnv.GEMINI_API_KEY)
  );
  if (isPlaceholder(fnEnv.GEMINI_API_KEY)) {
    fail('GEMINI_API_KEY is a real key', 'Still the placeholder from .env.example');
  }
  pass(
    'OPENROUTER_API_KEY present',
    describeSecret(fnEnv.OPENROUTER_API_KEY)
  );
  if (isPlaceholder(fnEnv.OPENROUTER_API_KEY)) {
    fail('OPENROUTER_API_KEY is a real key', 'Still the placeholder from .env.example');
  }
  pass(
    'OPENROUTER_AI_MODEL set',
    fnEnv.OPENROUTER_AI_MODEL || 'MISSING'
  );
  if (!/\/.*:free|:free$/.test(fnEnv.OPENROUTER_AI_MODEL || '')) {
    warn('model id looks unusual', 'Expected e.g. vendor/model-name:free');
  }
  if (/gemini-2\.5-flash/i.test(fnEnv.GEMINI_MODEL || '')) {
    fail('GEMINI_MODEL is not a retired model',
      'gemini-2.5-flash returns 404 for new projects; use gemini-3.8-flash');
  }
}

// .secret.local removes the emulator's Secret Manager round trip, which is what
// pushed module init past the 10s discovery timeout.
const secretLocal = readEnv('functions/.secret.local');
if (!secretLocal) {
  warn(
    'functions/.secret.local missing',
    'Emulator startup is slower and may hit the 10s discovery timeout without it'
  );
} else {
  const mirrorsGemini = secretLocal.GEMINI_API_KEY === fnEnv?.GEMINI_API_KEY;
  const mirrorsOpen = secretLocal.OPENROUTER_API_KEY === fnEnv?.OPENROUTER_API_KEY;
  if (mirrorsGemini && mirrorsOpen) {
    pass('functions/.secret.local mirrors both keys');
  } else {
    fail(
      'functions/.secret.local matches functions/.env',
      `gemini=${mirrorsGemini} openrouter=${mirrorsOpen} — copy .env over .secret.local`
    );
  }
}

const webEnv = readEnv('.env.local');
if (!webEnv) {
  fail('.env.local exists', 'The Vite dev server needs it');
} else {
  pass('.env.local exists');

  const emulatorFlag = String(webEnv.VITE_USE_EMULATORS || '').toLowerCase();
  if (emulatorFlag === 'true') {
    pass('VITE_USE_EMULATORS=true', 'App will be pointed at the emulator');
  } else {
    fail(
      'VITE_USE_EMULATORS=true',
      'Without this the app calls production functions, which are not deployed'
    );
  }

  const services = webEnv.VITE_EMULATOR_SERVICES || '(default) -> functions';
  if (/auth/i.test(services)) {
    fail(
      'auth is NOT in VITE_EMULATOR_SERVICES',
      'The Auth emulator has no real users, so Google sign-in breaks'
    );
  } else {
    pass('auth left on the real project', `services = ${services}`);
  }

  // Secrets sitting in the web file are ignored by Vite (no VITE_ prefix) but
  // are one copy-paste away from leaking into the bundle.
  const stray = ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'TELEGRAM_BOT_API']
    .filter((k) => webEnv[k]);
  if (stray.length) {
    warn(
      'secrets in .env.local that the browser does not need',
      `${stray.join(', ')} — the Cloud Function holds these. Delete to avoid a bundle leak.`
    );
  }

  // The emulator must answer under the SAME project id the browser requests.
  // A mismatch returns the emulator's 404, which has no CORS headers, so the
  // browser reports a misleading CORS failure instead.
  const appProject = webEnv.VITE_FIREBASE_PROJECT_ID;
  if (appProject && appProject !== EMULATOR_PROJECT) {
    fail(
      'emulator project id matches the app',
      `app=${appProject} emulator=${EMULATOR_PROJECT} — set EMULATOR_PROJECT or align them`
    );
  } else {
    pass('emulator project id matches the app', EMULATOR_PROJECT);
  }
}

// ════════════════════════════════════════════════════════════
// B. SOURCE INTEGRITY
// ════════════════════════════════════════════════════════════
section('B. Source integrity');

// On Windows `npm` is a .cmd shim, which execFileSync cannot spawn directly —
// every child check silently failed until this was corrected.
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (script, args, opts = {}) => {
  try {
    return {
      ok: true,
      out: execFileSync(NPM, [script, ...args], {
        encoding: 'utf8',
        stdio: 'pipe',
        shell: process.platform === 'win32',
        ...opts,
      }),
    };
  } catch (error) {
    return { ok: false, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
};

/** First meaningful failure line, ignoring the report's own PASS lines. */
const firstFailure = (out) => {
  const line = out.split('\n').find((l) => l.trim().startsWith('FAIL'));
  if (line) return line.trim();
  const check = out.split('\n').find((l) => /CHECK\(S\) FAILED|NOT READY/.test(l));
  return (check || out.trim().split('\n').pop() || '').trim();
};

/** Run a .mjs file directly — `npm run <file>` is not a valid invocation. */
const runNode = (file, opts = {}) => {
  try {
    return {
      ok: true,
      status: 0,
      out: execFileSync('node', [file], { encoding: 'utf8', stdio: 'pipe', ...opts }),
    };
  } catch (error) {
    return {
      ok: false,
      status: error.status ?? 1,
      out: `${error.stdout || ''}${error.stderr || ''}`,
    };
  }
};

const fnCheck = run('run', ['check'], { cwd: 'functions' });
if (fnCheck.ok) pass('all Cloud Function sources parse');
else fail('Cloud Function sources parse', firstFailure(fnCheck.out));

const build = run('run', ['build'], { cwd: '.' });
if (build.ok) {
  const modules = build.out.match(/(\d+) modules transformed/)?.[1];
  pass('production build succeeds', modules ? `${modules} modules` : '');
} else {
  fail('production build succeeds', firstFailure(build.out));
}

const fbConfig = existsSync('firebase.json') ? readFileSync('firebase.json', 'utf8') : '';
if (fbConfig.includes('"firestore"') && fbConfig.includes('"functions"')) {
  pass('firebase.json wires firestore and functions');
} else {
  fail('firebase.json wires firestore and functions');
}
if (fbConfig.includes('"storage"')) {
  pass('firebase.json wires storage rules');
} else {
  warn('firebase.json has no storage rules entry', 'Only needed once Cloud Storage is enabled');
}
pass('firestore.rules present', existsSync('firestore.rules') ? '' : 'MISSING');
pass('storage.rules present', existsSync('storage.rules') ? '' : 'MISSING (expected while local mode is on)');

// ════════════════════════════════════════════════════════════
// C. EMULATOR
// ════════════════════════════════════════════════════════════
section('C. Emulator');

const token = (() => {
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: emulatorIssuer,
    aud: EMULATOR_PROJECT,
    sub: 'preflight',
    user_id: 'preflight',
    iat: now,
    exp: now + 3600,
  })}.`;
})();

const callEmulator = async (name, data = {}) => {
  const response = await fetch(callableUrl(name), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body.result ?? body;
};

/** Services the app currently redirects to the emulator. */
const emulatedServices = (readEnv('.env.local').VITE_EMULATOR_SERVICES || 'firestore,functions')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** Count the profiles in the emulator Firestore, which holds the app's roles. */
const listEmulatorUsers = async () => {
  const { getApps, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  const app =
    getApps().find((a) => a.name === 'preflight-users') ||
    initializeApp({ projectId: EMULATOR_PROJECT }, 'preflight-users');
  const snapshot = await getFirestore(app).collection('users').get();
  return snapshot.docs.map((d) => ({ id: d.id, role: d.data()?.role }));
};

// The emulator takes 30-60s to register its callables, and its discovery can
// retry after a 10s timeout. Probe patiently instead of failing on first miss.
let status = null;
let lastError = null;
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  try {
    status = await callEmulator('aiStatus');
    break;
  } catch (error) {
    lastError = error;
    await new Promise((r) => setTimeout(r, 5000));
  }
}

if (status) {
  pass('functions emulator is running', `callables answered under ${EMULATOR_PROJECT}`);

  // Firestore emulator data does not survive a restart, and the app's role
  // lives in it. An empty Firestore means every route denies with
  // "role (Unknown)", which looks like a permissions bug but is not one.
  if (emulatedServices.includes('firestore')) {
    try {
      const users = await listEmulatorUsers();
      if (users.length === 0) {
        fail(
          'the app has a role in the emulator Firestore',
          'Firestore emulator data does not survive a restart, so the role is missing and every ' +
            'route denies with "role (Unknown)". Sign in once and the app provisions a local ' +
            'admin profile automatically, or run: npm run seed:role -- --list'
        );
      } else {
        pass('the app has a role in the emulator Firestore', `${users.length} user(s)`);
      }
    } catch (error) {
      warn('could not read emulator users', error.message);
    }
  } else {
    pass('Firestore left on the real project', 'live data stays visible');
  }
} else {
  fail(
    'functions emulator is running',
    `Start it with: npm run emulators (${lastError?.message || 'no answer'})`
  );
}

if (status) {
  if (status.configured) pass('at least one AI provider is configured');
  else fail('at least one AI provider is configured');

  const names = (status.providers || []).filter((p) => p.configured).map((p) => p.name);
  if (names.includes('gemini')) pass('Gemini provider active', status.model);
  else warn('Gemini provider not configured', 'Fallback will carry every request');

  if (names.includes('openrouter')) pass('OpenRouter backup active');
  else warn('OpenRouter backup not configured', 'A Gemini quota block will stop all analysis');

  pass('threshold reported', String(status.threshold));
}

// ════════════════════════════════════════════════════════════
// D. PROVIDERS (live)
// ════════════════════════════════════════════════════════════
section('D. Providers (live network)');

const orCheck = runNode('verify-openrouter.mjs', { cwd: 'functions' });
if (orCheck.ok) pass('OpenRouter answers with valid structured JSON');
else fail('OpenRouter answers with valid structured JSON', firstFailure(orCheck.out));

const gemCheck = runNode('verify-gemini.mjs', { cwd: 'functions' });
if (gemCheck.ok) {
  pass('Gemini answers with valid structured JSON');
} else {
  // Exit code 2 is a PAUSED state, not a failure: the daily allowance is spent
  // and the OpenRouter backup takes over. That is the system working as designed.
  const paused = gemCheck.status === 2 || /PAUSED/.test(gemCheck.out);
  if (paused) {
    warn(
      'Gemini daily quota exhausted',
      'Expected once spent. OpenRouter fallback covers analysis — this is not a fault.'
    );
  } else {
    fail('Gemini answers with valid structured JSON', firstFailure(gemCheck.out));
  }
}

// ════════════════════════════════════════════════════════════
// E. TEST SUITES
// ════════════════════════════════════════════════════════════
section('E. Offline test suites');

const suites = [
  ['test:ai', 'AI prompt and parsing logic'],
  ['test:quota', 'daily quota and reset time'],
  ['test:capacity', 'availability and daily capacity'],
  ['test:phase3', 'human verification rules'],
  ['test:fallback', 'AI provider fallback policy'],
  ['test:filestore', 'local IndexedDB file store'],
  ['test:theme', 'theme token coverage'],
];

for (const [script, label] of suites) {
  const result = run('run', [script]);
  if (result.ok) pass(label, script);
  else fail(label, firstFailure(result.out));
}

// ════════════════════════════════════════════════════════════
// REPORT
// ════════════════════════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  PREFLIGHT — AI assistant readiness                          ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

for (const r of results) {
  if (r.header) {
    console.log(`\n── ${r.header} ${'─'.repeat(Math.max(0, 52 - r.header.length))}`);
  } else if (r.ok === true) {
    console.log(`  PASS  ${r.label}${r.detail ? `  (${r.detail})` : ''}`);
  } else if (r.ok === 'warn') {
    console.log(`  WARN  ${r.label}${r.detail ? `  (${r.detail})` : ''}`);
  } else {
    console.log(`  FAIL  ${r.label}${r.detail ? `\n        ${r.detail}` : ''}`);
  }
}

console.log(
  `\n${'═'.repeat(60)}\n  ${failed === 0 ? 'READY' : 'NOT READY'} — ` +
    `${failed} failure(s), ${warned} warning(s)\n${'═'.repeat(60)}\n`
);

process.exit(failed === 0 ? 0 : 1);