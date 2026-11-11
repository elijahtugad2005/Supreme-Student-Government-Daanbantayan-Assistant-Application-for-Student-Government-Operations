/**
 * TDD & Bug-Diagnosis Regression Suite for Announcements & Telegram Publishing
 *
 * Seams Under Test:
 * - Seam A: backend/routes/telegram.js (GET /status, POST /send, POST /delete + auth/role guards)
 * - Seam B: src/services/telegramService.js (Render backend proxy client, TelegramPublishError contract)
 * - Seam C: vite.config.js & backend/server.js (No client-side TELEGRAM_ envPrefix, /api/telegram mounted)
 *
 * Run: node scripts/telegram-publishing-tdd.mjs
 */

import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
const require = createRequire(import.meta.url);

let failed = 0;
const results = [];
const check = (label, ok, detail = '') => {
  if (ok) {
    results.push(`ok   ${label}`);
  } else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// Mock Firebase Admin before loading middleware/routes
const mockState = {
  tokens: new Map(),
  users: new Map(),
  telegramCalls: [],
  telegramShouldFailPhoto: false,
  telegramShouldFailText: false,
};

const fbAdminPath = require.resolve('../backend/services/firebase-admin.js');
require.cache[fbAdminPath] = {
  id: fbAdminPath,
  filename: fbAdminPath,
  loaded: true,
  exports: {
    initializeFirebaseAdmin: () => ({}),
    getFirebaseAdmin: () => ({}),
    verifyIdToken: async (token) => {
      const decoded = mockState.tokens.get(token);
      if (!decoded) {
        const err = new Error('Invalid token');
        err.code = 'auth/argument-error';
        throw err;
      }
      return decoded;
    },
    getFirestore: () => ({
      collection(name) {
        if (name === 'users') {
          return {
            doc(uid) {
              return {
                async get() {
                  const data = mockState.users.get(uid);
                  return { exists: Boolean(data), data: () => data };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected collection: ${name}`);
      },
    }),
    getStorageBucket: () => ({}),
  },
};

const authMiddleware = require('../backend/middleware/auth.js');

const runMiddlewareChain = async (middlewares, req) => {
  let statusCode = 200;
  let body = null;
  const res = {
    status(c) {
      statusCode = c;
      return this;
    },
    json(b) {
      body = b;
      return this;
    },
  };
  let idx = 0;
  const next = async (err) => {
    if (err) {
      statusCode = 500;
      body = { error: err.message };
      return;
    }
    const fn = middlewares[idx++];
    if (fn) {
      await fn(req, res, next);
    }
  };
  await next();
  return { statusCode, body };
};

const invokeRoute = async (router, method, path, reqOverrides = {}) => {
  const layer = router?.stack?.find(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
  );
  if (!layer) {
    return { statusCode: 404, body: { error: `Route ${method.toUpperCase()} ${path} not found` }, missingRoute: true };
  }
  const req = {
    headers: {},
    query: {},
    params: {},
    body: {},
    ...reqOverrides,
  };
  const handlers = layer.route.stack.map((s) => s.handle);
  return runMiddlewareChain(handlers, req);
};

// ════════════════════════════════════════════════════════════════════════════
// SLICE 1: Seam A — Backend Telegram Proxy Router (Auth, Status, Send, Delete)
// ════════════════════════════════════════════════════════════════════════════
console.log('=== Slice 1: Seam A — Backend Telegram Proxy Router (Auth, Status, Send, Delete) ===');

mockState.tokens.set('token-press', { uid: 'u-press', email: 'press@ctu.edu.ph' });
mockState.users.set('u-press', { role: 'press_secretary', name: 'Press Sec' });

mockState.tokens.set('token-member', { uid: 'u-member', email: 'member@ctu.edu.ph' });
mockState.users.set('u-member', { role: 'member', name: 'Student Member' });

check(
  'ANNOUNCEMENT_ROLES is exported by backend/middleware/auth.js and excludes member/guest',
  Array.isArray(authMiddleware.ANNOUNCEMENT_ROLES) &&
    authMiddleware.ANNOUNCEMENT_ROLES.includes('press_secretary') &&
    authMiddleware.ANNOUNCEMENT_ROLES.includes('secretary') &&
    authMiddleware.ANNOUNCEMENT_ROLES.includes('creatives') &&
    !authMiddleware.ANNOUNCEMENT_ROLES.includes('member') &&
    !authMiddleware.ANNOUNCEMENT_ROLES.includes('guest')
);

const telegramRoutePath = new URL('../backend/routes/telegram.js', import.meta.url);
check('backend/routes/telegram.js exists', existsSync(telegramRoutePath));

let telegramRouter = null;
if (existsSync(telegramRoutePath)) {
  telegramRouter = require('../backend/routes/telegram.js');
}

if (telegramRouter) {
  // Set synthetic test env vars in process.env (never real secrets)
  process.env.TELEGRAM_BOT_TOKEN = '123456:SYNTHETIC_TEST_TOKEN_XYZ_9876543210';
  process.env.TELEGRAM_FACULTY_CHAT_ID = '-100111222333';
  process.env.TELEGRAM_MAYORS_CHAT_ID = '-100444555666';

  telegramRouter.__setTransportForTest(async ({ method, url, data }) => {
    mockState.telegramCalls.push({ method, url, data });
    if (url.endsWith('/sendMessage')) {
      if (mockState.telegramShouldFailText) {
        const err = new Error('Request failed');
        err.response = {
          status: 401,
          data: { ok: false, description: `Unauthorized for token ${process.env.TELEGRAM_BOT_TOKEN}` },
        };
        throw err;
      }
      return { data: { ok: true, result: { message_id: 777 } } };
    }
    if (url.endsWith('/sendPhoto')) {
      if (mockState.telegramShouldFailPhoto) {
        const err = new Error('Photo upload failed');
        err.response = {
          status: 400,
          data: { ok: false, description: 'Bad photo format' },
        };
        throw err;
      }
      return { data: { ok: true, result: { message_id: 778 } } };
    }
    if (url.endsWith('/deleteMessage')) {
      return { data: { ok: true, result: true } };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });

  const statusRes = await invokeRoute(telegramRouter, 'get', '/status');
  check(
    'GET /api/telegram/status reports boolean readiness without exposing token or chat IDs',
    statusRes.statusCode === 200 &&
      statusRes.body?.configured === true &&
      statusRes.body?.channels?.faculty === true &&
      statusRes.body?.channels?.all_mayors === true &&
      !JSON.stringify(statusRes.body).includes('SYNTHETIC_TEST_TOKEN') &&
      !JSON.stringify(statusRes.body).includes('-100111222333')
  );

  const unauthSend = await invokeRoute(telegramRouter, 'post', '/send', {
    headers: {},
    body: { channel: 'faculty', message: '<b>Test</b>' },
  });
  check('Unauthenticated POST /api/telegram/send returns 401', unauthSend.statusCode === 401);

  const memberSend = await invokeRoute(telegramRouter, 'post', '/send', {
    headers: { authorization: 'Bearer token-member' },
    body: { channel: 'faculty', message: '<b>Test</b>' },
  });
  check('Low-privilege member POST /api/telegram/send returns 403', memberSend.statusCode === 403);

  const sendRes = await invokeRoute(telegramRouter, 'post', '/send', {
    headers: { authorization: 'Bearer token-press' },
    body: {
      channel: 'faculty',
      message: '📢 <b>Assembly</b>\n\nAll faculty invited.',
      imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    },
  });
  check(
    'Authorized officer POST /api/telegram/send dispatches text + photo and returns messageId',
    sendRes.statusCode === 200 &&
      sendRes.body?.messageId === 777 &&
      sendRes.body?.photo?.status === 'sent',
    `got status=${sendRes.statusCode}, body=${JSON.stringify(sendRes.body)}`
  );

  mockState.telegramShouldFailPhoto = true;
  const partialRes = await invokeRoute(telegramRouter, 'post', '/send', {
    headers: { authorization: 'Bearer token-press' },
    body: {
      channel: 'all_mayors',
      message: '📢 <b>Mayors Call</b>',
      imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    },
  });
  mockState.telegramShouldFailPhoto = false;
  check(
    'POST /api/telegram/send returns partial success (photo.status="failed") when photo fails after text succeeds',
    partialRes.statusCode === 200 &&
      partialRes.body?.messageId === 777 &&
      partialRes.body?.photo?.status === 'failed'
  );

  mockState.telegramShouldFailText = true;
  const redactedFailRes = await invokeRoute(telegramRouter, 'post', '/send', {
    headers: { authorization: 'Bearer token-press' },
    body: { channel: 'faculty', message: 'Test' },
  });
  mockState.telegramShouldFailText = false;
  check(
    'POST /api/telegram/send redacts bot token from upstream error descriptions',
    redactedFailRes.statusCode === 502 &&
      !JSON.stringify(redactedFailRes.body).includes('SYNTHETIC_TEST_TOKEN') &&
      JSON.stringify(redactedFailRes.body).includes('[redacted]')
  );

  const delRes = await invokeRoute(telegramRouter, 'post', '/delete', {
    headers: { authorization: 'Bearer token-press' },
    body: { channel: 'faculty', messageId: 777 },
  });
  check(
    'Authorized officer POST /api/telegram/delete removes Telegram message and returns deleted=true',
    delRes.statusCode === 200 && delRes.body?.deleted === true
  );
} else {
  check('Backend Telegram router checks skipped because backend/routes/telegram.js is missing', false);
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2: Seam B — Client Service src/services/telegramService.js (Proxy Client)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 2: Seam B — Client Service src/services/telegramService.js (Proxy Client) ===');

const tgServiceSource = readFileSync(new URL('../src/services/telegramService.js', import.meta.url), 'utf8');
check(
  'src/services/telegramService.js contains NO direct api.telegram.org or TELEGRAM_BOT_API references',
  !tgServiceSource.includes('api.telegram.org') && !tgServiceSource.includes('TELEGRAM_BOT_API')
);

let tgService = {};
try {
  tgService = await import('../src/services/telegramService.js');
} catch (importErr) {
  check('src/services/telegramService.js imports with explicit .js extensions for Node ESM', false, importErr.message);
}
check(
  'telegramService exports checkTelegramStatus and __setTokenProviderForTest',
  typeof tgService.checkTelegramStatus === 'function' &&
    typeof tgService.__setTokenProviderForTest === 'function'
);

if (typeof tgService.__setTokenProviderForTest === 'function') {
  tgService.__setTokenProviderForTest(async () => 'token-press');
}

const fetchedCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  fetchedCalls.push({ url: String(url), options });
  const parsedUrl = new URL(String(url));
  const routePath = parsedUrl.pathname.replace(/^\/api\/telegram/, '') || '/';
  const method = (options.method || 'GET').toLowerCase();
  const headers = {};
  for (const [k, v] of Object.entries(options.headers || {})) {
    headers[k.toLowerCase()] = v;
  }
  const body = options.body ? JSON.parse(options.body) : {};
  const routeRes = await invokeRoute(telegramRouter, method, routePath, {
    headers,
    body,
  });
  return {
    ok: routeRes.statusCode >= 200 && routeRes.statusCode < 300,
    status: routeRes.statusCode,
    async json() {
      return routeRes.body;
    },
  };
};

try {
  // Temporarily clear all_mayors chat ID to verify live status propagation
  const savedMayorsId = process.env.TELEGRAM_MAYORS_CHAT_ID;
  process.env.TELEGRAM_MAYORS_CHAT_ID = '';
  if (typeof tgService.checkTelegramStatus === 'function') {
    await tgService.checkTelegramStatus();
  }
  process.env.TELEGRAM_MAYORS_CHAT_ID = savedMayorsId;

  check(
    'isTelegramReady reflects server-side channel status from GET /api/telegram/status',
    tgService.isTelegramReady('faculty') === true && tgService.isTelegramReady('all_mayors') === false
  );

  const clientSendRes = await tgService.sendAnnouncementToTelegram({
    channel: 'faculty',
    message: '<b>Hello Faculty</b>',
    imageBase64: '',
  });
  const sendFetch = fetchedCalls.find((c) => c.url.endsWith('/api/telegram/send'));
  check(
    'sendAnnouncementToTelegram posts to real /api/telegram/send route with Authorization Bearer token and returns messageId',
    Boolean(sendFetch) &&
      sendFetch.options?.headers?.Authorization === 'Bearer token-press' &&
      clientSendRes?.messageId === 777 &&
      clientSendRes?.photo?.status === 'skipped'
  );

  const clientDelRes = await tgService.deleteTelegramMessage({
    channel: 'faculty',
    messageId: 777,
  });
  const delFetch = fetchedCalls.find((c) => c.url.endsWith('/api/telegram/delete'));
  check(
    'deleteTelegramMessage posts to real /api/telegram/delete route with Authorization Bearer token and returns deleted=true',
    Boolean(delFetch) &&
      delFetch.options?.headers?.Authorization === 'Bearer token-press' &&
      clientDelRes?.deleted === true
  );
} catch (err) {
  check('Client telegramService proxy execution succeeded without throwing', false, err.message);
} finally {
  globalThis.fetch = originalFetch;
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 3: Seam C — vite.config.js & backend/server.js (Build & Mount Seams)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 3: Seam C — vite.config.js & backend/server.js (Build & Mount Seams) ===');

const viteConfigSource = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
check(
  'vite.config.js does NOT expose TELEGRAM_ prefix to client bundle',
  !viteConfigSource.includes("'TELEGRAM_'") && !viteConfigSource.includes('"TELEGRAM_"')
);

const serverSource = readFileSync(new URL('../backend/server.js', import.meta.url), 'utf8');
check(
  'backend/server.js mounts /api/telegram proxy router',
  serverSource.includes("require('./routes/telegram')") &&
    serverSource.includes("app.use('/api/telegram'")
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 4: Seam D — Full ANNOUNCEMENT_ROLES & Firestore Rules RBAC Alignment
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 4: Seam D — Full ANNOUNCEMENT_ROLES & Firestore Rules RBAC Alignment ===');

const requiredAnnouncementRoles = [
  'admin',
  'superadmin',
  'president',
  'vice_president',
  'press_secretary',
  'secretary',
  'general_secretary',
  'creatives',
  'governor',
  'adviser',
];
check(
  'ANNOUNCEMENT_ROLES includes all spec-required announcement officer roles (including superadmin, general_secretary, governor, adviser)',
  requiredAnnouncementRoles.every((r) => authMiddleware.ANNOUNCEMENT_ROLES.includes(r)),
  `missing: ${requiredAnnouncementRoles.filter((r) => !authMiddleware.ANNOUNCEMENT_ROLES.includes(r)).join(', ')}`
);

const firestoreRulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const hasCanManageAnnouncementsHelper = firestoreRulesSource.includes('function canManageAnnouncements()');
const announcementsRuleBlock = firestoreRulesSource.match(/match \/announcements\/\{docId\}\s*\{[\s\S]*?\}/)?.[0] || '';
const newsRuleBlock = firestoreRulesSource.match(/match \/newsArticles\/\{docId\}\s*\{[\s\S]*?\}/)?.[0] || '';
const calendarRuleBlock = firestoreRulesSource.match(/match \/calendarEvents\/\{docId\}\s*\{[\s\S]*?\}/)?.[0] || '';

check(
  'firestore.rules restricts announcements, newsArticles, and calendarEvents writes to canManageAnnouncements() instead of isSignedIn()',
  hasCanManageAnnouncementsHelper &&
    announcementsRuleBlock.includes('allow write: if canManageAnnouncements()') &&
    newsRuleBlock.includes('allow write: if canManageAnnouncements()') &&
    calendarRuleBlock.includes('allow write: if canManageAnnouncements()')
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 5: Seam E — Client Config Hygiene & Announcement UI Reactivity
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 5: Seam E — Client Config Hygiene & Announcement UI Reactivity ===');

const announcementTypesSource = readFileSync(new URL('../src/utils/announcementTypes.js', import.meta.url), 'utf8');
check(
  'src/utils/announcementTypes.js does NOT expose server TELEGRAM_* envKey strings on client',
  !announcementTypesSource.includes('TELEGRAM_CTUDBFACULTIES_CHANNELID') &&
    !announcementTypesSource.includes('TELEGRAM_CTUDBALLMAYORS_CHANNELID') &&
    !announcementTypesSource.includes('envKey:')
);

const announcementComponentSource = readFileSync(new URL('../src/components/Announcement.jsx', import.meta.url), 'utf8');
check(
  'src/components/Announcement.jsx updates React state when checkTelegramStatus() resolves so isTelegramReady re-renders',
  announcementComponentSource.includes('checkTelegramStatus().then(') ||
    announcementComponentSource.includes('await checkTelegramStatus()')
);

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\n✅ All checks passed.');
}
