// Telegram Bot API client for announcement publishing.
//
// The text is sent with parse_mode HTML so the announcement title can be
// bolded. Only the lines the app builds are styled — the manager's own
// writing is HTML-escaped first, so their line breaks, spacing, punctuation
// and emojis arrive exactly as typed.
//
// The bot token and channel IDs are read from the Vite environment. Because
// this runs in the browser, the token ships inside the client bundle — treat
// it as a public value and keep it scoped to the two channels below. A
// server-side proxy is the safe alternative if the token must stay secret.

import { getChannelConfig } from '../utils/announcementTypes';

const TELEGRAM_API = 'https://api.telegram.org';
const BOT_TOKEN_KEY = 'TELEGRAM_BOT_API';

/** Error carrying a message that is safe to show the user. */
export class TelegramPublishError extends Error {
  constructor(userMessage, rawMessage) {
    super(userMessage);
    this.name = 'TelegramPublishError';
    this.userMessage = userMessage;
    this.rawMessage = rawMessage;
  }
}

const readEnv = (key) => {
  try {
    return import.meta.env?.[key] || '';
  } catch {
    return '';
  }
};

export const getBotToken = () => readEnv(BOT_TOKEN_KEY);

export const getChannelId = (channel) => {
  const config = getChannelConfig(channel);
  return config ? readEnv(config.envKey) : '';
};

/** True when both the token and this channel's ID are available. */
export const isTelegramReady = (channel) => Boolean(getBotToken() && getChannelId(channel));

// Strip anything token-shaped so a failed request can never echo the secret.
const redact = (text, token) => {
  let safe = text || '';
  if (token) safe = safe.split(token).join('[redacted]');
  return safe.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[redacted]');
};

/**
 * Post the composed message to the selected Telegram channel.
 * @returns {Promise<object>} the Telegram API result
 * @throws {TelegramPublishError} on config, network or API errors
 */
export async function sendAnnouncementToTelegram({ channel, message, imageBase64 }) {
  const token = getBotToken();

  if (!getChannelConfig(channel)) {
    throw new TelegramPublishError(`"${channel}" is not a known Telegram channel.`);
  }
  if (!token) {
    throw new TelegramPublishError('Telegram is not configured. Add TELEGRAM_BOT_API to your environment.');
  }

  const chatId = getChannelId(channel);
  if (!chatId) {
    throw new TelegramPublishError(
      `No channel ID configured for ${getChannelConfig(channel).label}.`,
    );
  }

  const text = await postToTelegram(token, 'sendMessage', {
    chat_id: chatId,
    text: message,
    // The title is bolded; everything else is escaped so the manager's
    // punctuation and line breaks are delivered as written.
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  // The message id is kept so the message can be removed later if the
  // announcement is deleted.
  const messageId = text?.message_id ?? null;

  // The announcement photo is optional. If it fails the text is already
  // delivered, so this is reported as a partial success rather than a throw.
  if (!imageBase64) {
    return { messageId, photo: { status: 'skipped' } };
  }

  try {
    await postPhotoToTelegram(token, chatId, imageBase64);
    return { messageId, photo: { status: 'sent' } };
  } catch (photoError) {
    return {
      messageId,
      photo: { status: 'failed', error: photoError.userMessage || 'The photo could not be sent.' },
    };
  }
}

/**
 * Remove a previously sent message from a channel.
 *
 * Telegram only lets bots delete messages less than 48 hours old, so an older
 * announcement cannot be un-sent. The error is surfaced rather than swallowed.
 */
export async function deleteTelegramMessage({ channel, messageId }) {
  const token = getBotToken();
  const chatId = getChannelId(channel);

  if (!token || !chatId) {
    return { deleted: false, error: 'Telegram is not configured.' };
  }
  if (!messageId) {
    return { deleted: false, error: 'No Telegram message was recorded for this channel.' };
  }

  try {
    await postToTelegram(token, 'deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    });
    return { deleted: true };
  } catch (error) {
    return { deleted: false, error: error.userMessage || 'The message could not be deleted.' };
  }
}

const postToTelegram = async (token, method, body) => {
  let response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    throw new TelegramPublishError(
      'Could not reach Telegram. Check your internet connection.',
      String(networkError),
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    const description = payload?.description || `Request failed (${response.status}).`;
    throw new TelegramPublishError(redact(description, token), description);
  }

  return payload.result;
};

// "data:image/jpeg;base64,XXXX" -> Blob, decoded in-memory
const dataUrlToBlob = (dataUrl) => {
  const [header, base64] = String(dataUrl).split(',');
  if (!base64) {
    throw new TelegramPublishError('The attached image could not be read.');
  }
  const mime = header.match(/data:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
};

const postPhotoToTelegram = async (token, chatId, imageBase64) => {
  let blob;
  try {
    blob = dataUrlToBlob(imageBase64);
  } catch (error) {
    throw error instanceof TelegramPublishError
      ? error
      : new TelegramPublishError('The attached image could not be read.');
  }

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('photo', blob, `announcement.${blob.type === 'image/png' ? 'png' : 'jpg'}`);

  let response;
  try {
    // No Content-Type header — the browser adds the multipart boundary
    response = await fetch(`${TELEGRAM_API}/bot${token}/sendPhoto`, {
      method: 'POST',
      body: form,
    });
  } catch (networkError) {
    throw new TelegramPublishError(
      'Could not reach Telegram to upload the photo.',
      String(networkError),
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    const description = payload?.description || `Upload failed (${response.status}).`;
    throw new TelegramPublishError(redact(description, token), description);
  }

  return payload.result;
};
