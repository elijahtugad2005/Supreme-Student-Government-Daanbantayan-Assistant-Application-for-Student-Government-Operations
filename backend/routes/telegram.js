// backend/routes/telegram.js
// Server-side Telegram Broadcast Proxy for SSG Announcements
// Keeps TELEGRAM_BOT_TOKEN and channel IDs strictly on the server (AGENTS.md compliant).

const express = require('express');
const axios = require('axios');
const router = express.Router();
const {
  authenticate,
  requireRole,
  ANNOUNCEMENT_ROLES,
} = require('../middleware/auth');

const TELEGRAM_API = 'https://api.telegram.org';

const CHANNEL_LABELS = {
  faculty: 'Faculty',
  all_mayors: 'All Mayors',
};

function getBotToken() {
  return (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_API || '').trim();
}

function getChatId(channel) {
  if (channel === 'faculty') {
    return (
      process.env.TELEGRAM_FACULTY_CHAT_ID ||
      process.env.TELEGRAM_CTUDBFACULTIES_CHANNELID ||
      ''
    ).trim();
  }
  if (channel === 'all_mayors') {
    return (
      process.env.TELEGRAM_MAYORS_CHAT_ID ||
      process.env.TELEGRAM_CTUDBALLMAYORS_CHANNELID ||
      ''
    ).trim();
  }
  return '';
}

function redactToken(text, token) {
  let safe = String(text || '');
  if (token) safe = safe.split(token).join('[redacted]');
  return safe.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[redacted]');
}

let customTransport = null;
function setTransportForTest(fn) {
  customTransport = fn;
}

async function callTelegramApi(token, method, payload, isMultipart = false) {
  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  if (customTransport) {
    return customTransport({ method: 'POST', url, data: payload, isMultipart });
  }
  if (isMultipart) {
    const res = await fetch(url, {
      method: 'POST',
      body: payload,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      const err = new Error(json?.description || `Upload failed (${res.status}).`);
      err.response = { status: res.status, data: json };
      throw err;
    }
    return { data: json };
  }
  return axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });
}

function buildPhotoFormData(chatId, imageBase64) {
  const [header, base64] = String(imageBase64 || '').split(',');
  if (!base64) {
    throw new Error('The attached image could not be read.');
  }
  const mime = header.match(/data:(.*?);/)?.[1] || 'image/jpeg';
  const buffer = Buffer.from(base64, 'base64');
  const blob = new Blob([buffer], { type: mime });
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('photo', blob, `announcement.${mime === 'image/png' ? 'png' : 'jpg'}`);
  return form;
}

/**
 * GET /api/telegram/status
 * Reports boolean readiness per channel without revealing tokens or chat IDs.
 */
router.get('/status', (req, res) => {
  const hasToken = Boolean(getBotToken());
  const facultyReady = hasToken && Boolean(getChatId('faculty'));
  const mayorsReady = hasToken && Boolean(getChatId('all_mayors'));
  res.status(200).json({
    success: true,
    ok: true,
    configured: facultyReady || mayorsReady,
    channels: {
      faculty: facultyReady,
      all_mayors: mayorsReady,
    },
  });
});

/**
 * POST /api/telegram/send
 * Dispatches an announcement (HTML text + optional photo) to a configured Telegram channel.
 */
router.post('/send', authenticate, requireRole(ANNOUNCEMENT_ROLES), async (req, res) => {
  const { channel, message, imageBase64 } = req.body || {};

  if (!channel || !CHANNEL_LABELS[channel]) {
    return res.status(400).json({
      success: false,
      ok: false,
      error: `"${channel || ''}" is not a known Telegram channel.`,
    });
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({
      success: false,
      ok: false,
      error: 'Announcement message text is required.',
    });
  }

  const token = getBotToken();
  if (!token) {
    return res.status(503).json({
      success: false,
      ok: false,
      error: 'Telegram is not configured on the server (TELEGRAM_BOT_TOKEN).',
    });
  }

  const chatId = getChatId(channel);
  if (!chatId) {
    return res.status(503).json({
      success: false,
      ok: false,
      error: `No channel ID configured on the server for ${CHANNEL_LABELS[channel]}.`,
    });
  }

  let messageId = null;
  try {
    const response = await callTelegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '❤️ Seen',
              callback_data: 'reaction_heart',
            },
          ],
        ],
      },
    });
    const payload = response?.data;
    if (!payload?.ok) {
      const desc = redactToken(payload?.description || 'Telegram sendMessage failed.', token);
      return res.status(502).json({ success: false, ok: false, error: desc });
    }
    messageId = payload.result?.message_id ?? null;
  } catch (err) {
    const rawDesc = err?.response?.data?.description || err.message || 'Could not reach Telegram.';
    const safeDesc = redactToken(rawDesc, token);
    return res.status(502).json({ success: false, ok: false, error: safeDesc });
  }

  if (!imageBase64) {
    return res.status(200).json({
      success: true,
      ok: true,
      messageId,
      photo: { status: 'skipped' },
    });
  }

  try {
    const form = buildPhotoFormData(chatId, imageBase64);
    await callTelegramApi(token, 'sendPhoto', form, true);
    return res.status(200).json({
      success: true,
      ok: true,
      messageId,
      photo: { status: 'sent' },
    });
  } catch (photoErr) {
    const rawDesc =
      photoErr?.response?.data?.description ||
      photoErr.message ||
      'The photo could not be sent.';
    return res.status(200).json({
      success: true,
      ok: true,
      messageId,
      photo: {
        status: 'failed',
        error: redactToken(rawDesc, token),
      },
    });
  }
});

/**
 * POST /api/telegram/delete
 * Removes a previously sent Telegram message from the target channel.
 */
router.post('/delete', authenticate, requireRole(ANNOUNCEMENT_ROLES), async (req, res) => {
  const { channel, messageId } = req.body || {};

  if (!channel || !CHANNEL_LABELS[channel]) {
    return res.status(400).json({
      success: false,
      ok: false,
      deleted: false,
      error: `"${channel || ''}" is not a known Telegram channel.`,
    });
  }
  if (!messageId) {
    return res.status(200).json({
      success: false,
      ok: false,
      deleted: false,
      error: 'No Telegram message was recorded for this channel.',
    });
  }

  const token = getBotToken();
  const chatId = getChatId(channel);
  if (!token || !chatId) {
    return res.status(200).json({
      success: false,
      ok: false,
      deleted: false,
      error: 'Telegram is not configured on the server.',
    });
  }

  try {
    await callTelegramApi(token, 'deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    });
    return res.status(200).json({ success: true, ok: true, deleted: true });
  } catch (err) {
    const rawDesc =
      err?.response?.data?.description ||
      err.message ||
      'The message could not be deleted.';
    return res.status(200).json({
      success: false,
      ok: false,
      deleted: false,
      error: redactToken(rawDesc, token),
    });
  }
});

router.__setTransportForTest = setTransportForTest;

module.exports = router;

