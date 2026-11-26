/**
 * backend/middleware/webhookSecurity.js
 * Constant-time webhook authentication guards for:
 *  - Meta / Messenger webhook handshake (GET /webhook) & payload HMAC (POST /webhook)
 *  - Telegram Bot API secret token header (POST /telegram-webhook)
 *
 * Fail-closed in production (`NODE_ENV === 'production'`) when secrets are unconfigured
 * so unauthenticated callers cannot spoof webhook events.
 */

const crypto = require('crypto');

function safeTimingEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies Meta/Messenger GET /webhook handshake token safely (never matches undefined === undefined).
 */
function verifyHandshakeToken(mode, providedToken, expectedToken) {
  if (mode !== 'subscribe') return false;
  if (!expectedToken || !providedToken) return false;
  return safeTimingEqual(String(providedToken), String(expectedToken));
}

/**
 * Middleware: verifies Meta X-Hub-Signature-256 HMAC against META_APP_SECRET.
 */
function createMetaWebhookGuard({
  getSecret = () => process.env.META_APP_SECRET,
  isProduction = () => process.env.NODE_ENV === 'production',
} = {}) {
  return (req, res, next) => {
    const secret = getSecret();
    if (!secret) {
      if (isProduction()) {
        return res.status(403).json({
          success: false,
          error: 'Webhook signature verification is not configured.',
        });
      }
      return next();
    }

    const signature = req.headers?.['x-hub-signature-256'];
    const rawBody = req.rawBody;
    if (!signature || !rawBody) {
      return res.status(401).json({
        success: false,
        error: 'Missing webhook signature.',
      });
    }

    const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    if (!safeTimingEqual(String(signature), expected)) {
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook signature.',
      });
    }
    return next();
  };
}

/**
 * Middleware: verifies Telegram X-Telegram-Bot-Api-Secret-Token header against TELEGRAM_WEBHOOK_SECRET.
 */
function createTelegramWebhookGuard({
  getSecret = () => process.env.TELEGRAM_WEBHOOK_SECRET,
  isProduction = () => process.env.NODE_ENV === 'production',
} = {}) {
  return (req, res, next) => {
    const secret = getSecret();
    if (!secret) {
      if (isProduction()) {
        return res.status(403).json({
          success: false,
          error: 'Telegram webhook secret is not configured.',
        });
      }
      return next();
    }

    const provided = req.headers?.['x-telegram-bot-api-secret-token'];
    if (!provided || !safeTimingEqual(String(provided), String(secret))) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Telegram webhook secret token.',
      });
    }
    return next();
  };
}

module.exports = {
  safeTimingEqual,
  verifyHandshakeToken,
  createMetaWebhookGuard,
  createTelegramWebhookGuard,
};
