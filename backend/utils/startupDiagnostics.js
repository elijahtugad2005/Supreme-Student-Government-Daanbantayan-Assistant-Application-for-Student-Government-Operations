// backend/utils/startupDiagnostics.js
// Secret-safe deployment environment & service connection diagnostics.
// Logs ONLY presence (SET / MISSING) and connection status — NEVER logs secret values.

const fs = require('fs');
const path = require('path');

function isSet(env, ...names) {
  return names.some((name) => {
    const val = env[name];
    return typeof val === 'string' && val.trim().length > 0;
  });
}

function statusTag(ok, optional = false) {
  if (ok) return 'SET';
  return optional ? 'NOT SET (optional)' : 'MISSING';
}

/**
 * Collect structured, secret-safe environment diagnostics for backend deployment.
 * @param {Record<string, string | undefined>} [env=process.env]
 * @param {{ firebaseInitialized?: boolean, firebaseError?: string | null, serviceAccountFileExists?: boolean }} [opts]
 */
function collectEnvDiagnostics(env = process.env, opts = {}) {
  const serviceAccountFilePath = path.join(__dirname, '../firebase-service-account.json');
  const hasServiceAccountFile =
    typeof opts.serviceAccountFileExists === 'boolean'
      ? opts.serviceAccountFileExists
      : fs.existsSync(serviceAccountFilePath);

  // 1. Core / CORS
  const nodeEnv = env.NODE_ENV || 'not set (defaults to production behavior)';
  const port = env.PORT || '3000';
  const hasAllowedOrigins = isSet(env, 'ALLOWED_ORIGINS');

  // 2. Firebase Admin
  const hasFirebaseJson = isSet(env, 'FIREBASE_SERVICE_ACCOUNT');
  const hasFirebaseProjectId = isSet(env, 'FIREBASE_PROJECT_ID');
  const hasFirebaseClientEmail = isSet(env, 'FIREBASE_CLIENT_EMAIL');
  const hasFirebasePrivateKey = isSet(env, 'FIREBASE_PRIVATE_KEY');
  const hasFirebaseSplit = hasFirebaseProjectId && hasFirebaseClientEmail && hasFirebasePrivateKey;
  const firebaseConfigured = hasFirebaseJson || hasFirebaseSplit || hasServiceAccountFile;
  const firebaseMode = hasServiceAccountFile
    ? 'file:firebase-service-account.json (dev only — use env vars in cloud deploy)'
    : hasFirebaseJson
      ? 'env:FIREBASE_SERVICE_ACCOUNT'
      : hasFirebaseSplit
        ? 'env:split (FIREBASE_PROJECT_ID + CLIENT_EMAIL + PRIVATE_KEY)'
        : 'not configured';

  // 3. MongoDB GridFS
  const hasMongoUri = isSet(env, 'MONGODB_URI');
  const mongoDbName = env.MONGODB_DATABASE || 'ssg_documents (default)';
  const mongoBucketName = env.MONGODB_BUCKET_NAME || 'documents (default)';

  // 4. Document AI (Gemini + OpenRouter)
  const hasGeminiKey = isSet(env, 'GEMINI_API_KEY');
  const hasOpenRouterKey = isSet(env, 'OPENROUTER_API_KEY');
  const aiConfigured = hasGeminiKey || hasOpenRouterKey;

  // 5. Telegram Broadcasts
  const hasTelegramToken = isSet(env, 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_API');
  const hasFacultyChatId = isSet(env, 'TELEGRAM_FACULTY_CHAT_ID', 'TELEGRAM_CTUDBFACULTIES_CHANNELID');
  const hasMayorsChatId = isSet(env, 'TELEGRAM_MAYORS_CHAT_ID', 'TELEGRAM_CTUDBALLMAYORS_CHANNELID');
  const telegramReady = hasTelegramToken && (hasFacultyChatId || hasMayorsChatId);

  // 6. Google Drive Sync (optional mirror)
  const hasDriveOAuth =
    isSet(env, 'GOOGLE_DRIVE_OAUTH_CLIENT_ID') &&
    isSet(env, 'GOOGLE_DRIVE_OAUTH_CLIENT_SECRET') &&
    isSet(env, 'GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN');
  const hasDriveServiceAccount =
    isSet(env, 'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON', 'GOOGLE_DRIVE_KEY_FILE') &&
    isSet(env, 'GOOGLE_DRIVE_FOLDER_ID');
  const driveMode = hasDriveOAuth ? 'oauth' : hasDriveServiceAccount ? 'service_account' : 'disabled';

  // 7. Legacy Messenger Webhook (optional)
  const hasPageAccessToken = isSet(env, 'PAGE_ACCESS_TOKEN');
  const hasVerifyToken = isSet(env, 'VERIFY_TOKEN');

  // Missing variables checklist for deployment platforms (Render / Railway / Fly.io)
  const missingRequired = [];
  const missingRecommended = [];

  if (!hasFirebaseJson && !hasFirebaseSplit) {
    missingRequired.push('FIREBASE_SERVICE_ACCOUNT (or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY)');
  }
  if (!hasMongoUri) {
    missingRequired.push('MONGODB_URI');
  }
  if (!hasAllowedOrigins) {
    missingRecommended.push('ALLOWED_ORIGINS (comma-separated frontend URLs, e.g. https://your-site.github.io)');
  }
  if (!aiConfigured) {
    missingRecommended.push('GEMINI_API_KEY and/or OPENROUTER_API_KEY (for AI Document Analysis)');
  }
  if (!hasTelegramToken) {
    missingRecommended.push('TELEGRAM_BOT_TOKEN (for Announcement Telegram Broadcasts)');
  }
  if (!hasFacultyChatId) {
    missingRecommended.push('TELEGRAM_FACULTY_CHAT_ID (for Faculty Telegram channel)');
  }
  if (!hasMayorsChatId) {
    missingRecommended.push('TELEGRAM_MAYORS_CHAT_ID (for All Mayors Telegram channel)');
  }

  return {
    core: { nodeEnv, port, hasAllowedOrigins },
    firebase: {
      configured: firebaseConfigured,
      initialized: Boolean(opts.firebaseInitialized),
      error: opts.firebaseError || null,
      mode: firebaseMode,
      hasFirebaseJson,
      hasFirebaseProjectId,
      hasFirebaseClientEmail,
      hasFirebasePrivateKey,
      hasServiceAccountFile,
    },
    mongodb: {
      configured: hasMongoUri,
      database: mongoDbName,
      bucket: mongoBucketName,
    },
    ai: {
      configured: aiConfigured,
      hasGeminiKey,
      geminiModel: env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
      hasOpenRouterKey,
      openRouterModel: env.OPENROUTER_AI_MODEL || 'nvidia/nemotron-3.5-super-vl:free',
    },
    telegram: {
      ready: telegramReady,
      hasTelegramToken,
      hasFacultyChatId,
      hasMayorsChatId,
    },
    drive: {
      enabled: driveMode !== 'disabled',
      mode: driveMode,
      hasFolderId: isSet(env, 'GOOGLE_DRIVE_FOLDER_ID'),
    },
    messengerLegacy: {
      hasPageAccessToken,
      hasVerifyToken,
    },
    missingRequired,
    missingRecommended,
  };
}

/**
 * Format secret-safe startup diagnostics as readable console lines.
 */
function formatEnvDiagnostics(diag) {
  const lines = [
    '',
    '======================================================================',
    '[DeployCheck] Backend Environment & API Key Status (values hidden)',
    '======================================================================',
    `  Server     : PORT=${diag.core.port} | NODE_ENV=${diag.core.nodeEnv}`,
    `  CORS       : ALLOWED_ORIGINS -> ${statusTag(diag.core.hasAllowedOrigins)}`,
    '',
    `  Firebase   : ${diag.firebase.initialized ? 'CONNECTED' : diag.firebase.configured ? 'CONFIGURED (init failed)' : 'MISSING'} [${diag.firebase.mode}]`,
    `               FIREBASE_SERVICE_ACCOUNT=${statusTag(diag.firebase.hasFirebaseJson, diag.firebase.configured)} | SPLIT(PROJECT_ID/EMAIL/KEY)=${statusTag(diag.firebase.hasFirebaseProjectId && diag.firebase.hasFirebaseClientEmail && diag.firebase.hasFirebasePrivateKey, diag.firebase.configured)}`,
    '',
    `  MongoDB    : MONGODB_URI=${statusTag(diag.mongodb.configured)} | DB=${diag.mongodb.database} | BUCKET=${diag.mongodb.bucket}`,
    '',
    `  AI Engine  : ${diag.ai.configured ? 'READY' : 'DISABLED'}`,
    `               GEMINI_API_KEY=${statusTag(diag.ai.hasGeminiKey, diag.ai.hasOpenRouterKey)} (model: ${diag.ai.geminiModel})`,
    `               OPENROUTER_API_KEY=${statusTag(diag.ai.hasOpenRouterKey, diag.ai.hasGeminiKey)} (model: ${diag.ai.openRouterModel})`,
    '',
    `  Telegram   : ${diag.telegram.ready ? 'READY' : 'DISABLED / PARTIAL'}`,
    `               TELEGRAM_BOT_TOKEN=${statusTag(diag.telegram.hasTelegramToken)}`,
    `               TELEGRAM_FACULTY_CHAT_ID=${statusTag(diag.telegram.hasFacultyChatId)}`,
    `               TELEGRAM_MAYORS_CHAT_ID=${statusTag(diag.telegram.hasMayorsChatId)}`,
    '',
    `  Drive Sync : ${diag.drive.enabled ? `ENABLED (${diag.drive.mode})` : 'DISABLED (optional)'} | GOOGLE_DRIVE_FOLDER_ID=${statusTag(diag.drive.hasFolderId, true)}`,
    `  Messenger  : PAGE_ACCESS_TOKEN=${statusTag(diag.messengerLegacy.hasPageAccessToken, true)} | VERIFY_TOKEN=${statusTag(diag.messengerLegacy.hasVerifyToken, true)}`,
  ];

  if (diag.missingRequired.length > 0) {
    lines.push('');
    lines.push('  [ACTION REQUIRED] Set these env vars on your deployment platform:');
    for (const item of diag.missingRequired) {
      lines.push(`    - ${item}`);
    }
  }

  if (diag.missingRecommended.length > 0) {
    lines.push('');
    lines.push('  [RECOMMENDED] Set these env vars to enable all production features:');
    for (const item of diag.missingRecommended) {
      lines.push(`    - ${item}`);
    }
  }

  if (diag.missingRequired.length === 0 && diag.missingRecommended.length === 0) {
    lines.push('');
    lines.push('  [OK] All required and recommended backend env vars are configured.');
  }

  lines.push('======================================================================');
  lines.push('');
  return lines.join('\n');
}

/**
 * Print env diagnostics and run a non-blocking MongoDB ping to confirm live connectivity.
 */
async function runStartupDiagnostics({
  env = process.env,
  firebaseInitialized = false,
  firebaseError = null,
  getDatabase = null,
  logger = console,
  onMongoStatus = null,
} = {}) {
  const diag = collectEnvDiagnostics(env, { firebaseInitialized, firebaseError });
  logger.log(formatEnvDiagnostics(diag));

  if (!diag.mongodb.configured) {
    logger.warn('[DeployCheck] Live MongoDB connection check skipped: MONGODB_URI is MISSING.');
    onMongoStatus?.('not_configured');
    return { diag, mongoConnected: false };
  }

  if (typeof getDatabase === 'function') {
    try {
      const db = await getDatabase();
      await db.admin().ping();
      logger.log(`[DeployCheck] Live MongoDB GridFS ping: CONNECTED (db=${diag.mongodb.database})`);
      onMongoStatus?.('connected');
      return { diag, mongoConnected: true };
    } catch (err) {
      logger.error(`[DeployCheck] Live MongoDB GridFS ping: FAILED (${err.message})`);
      onMongoStatus?.('error');
      return { diag, mongoConnected: false, mongoError: err.message };
    }
  }

  return { diag, mongoConnected: false };
}

module.exports = {
  collectEnvDiagnostics,
  formatEnvDiagnostics,
  runStartupDiagnostics,
};
