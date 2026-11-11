// Telegram announcement publishing client (Server-Side Proxy).
//
// All Telegram Bot API calls (`sendMessage`, `sendPhoto`, `deleteMessage`) are
// proxied through the Render Express backend (`/api/telegram/*`) so that
// private bot tokens and channel chat IDs never ship inside the client bundle.

import { getChannelConfig } from '../utils/announcementTypes.js';

const getBackendBaseUrl = () => {
  try {
    const raw =
      import.meta.env?.VITE_MONGODB_BACKEND_URL ||
      import.meta.env?.VITE_BACKEND_URL ||
      import.meta.env?.VITE_BACKEND_API_URL ||
      'http://localhost:3000';
    return String(raw).replace(/\/+$/, '');
  } catch {
    return 'http://localhost:3000';
  }
};

/** Error carrying a message that is safe to show the user. */
export class TelegramPublishError extends Error {
  constructor(userMessage, rawMessage) {
    super(userMessage);
    this.name = 'TelegramPublishError';
    this.userMessage = userMessage;
    this.rawMessage = rawMessage;
  }
}

let customTokenProvider = null;

export function __setTokenProviderForTest(fn) {
  customTokenProvider = fn;
}

const getAuthToken = async () => {
  if (typeof customTokenProvider === 'function') {
    return customTokenProvider();
  }
  try {
    const { auth } = await import('../firebase/firebaseConfig.js');
    if (auth?.currentUser && typeof auth.currentUser.getIdToken === 'function') {
      return await auth.currentUser.getIdToken();
    }
  } catch {
    // Ignore when Firebase client is not initialized
  }
  return '';
};

const buildAuthHeaders = async () => {
  const idToken = await getAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
  };
};

// In-memory readiness cache populated by checkTelegramStatus()
const channelReadinessCache = {
  checked: false,
  configured: true,
  channels: {
    faculty: true,
    all_mayors: true,
  },
};

/**
 * Query the Render backend (`GET /api/telegram/status`) for live boolean
 * channel readiness without exposing tokens or chat IDs.
 */
export async function checkTelegramStatus() {
  try {
    const response = await fetch(`${getBackendBaseUrl()}/api/telegram/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return channelReadinessCache;
    }
    const payload = await response.json();
    if (payload && typeof payload === 'object') {
      channelReadinessCache.checked = true;
      channelReadinessCache.configured = Boolean(payload.configured);
      if (payload.channels && typeof payload.channels === 'object') {
        channelReadinessCache.channels = {
          faculty: Boolean(payload.channels.faculty),
          all_mayors: Boolean(payload.channels.all_mayors),
        };
      }
    }
  } catch {
    // Keep optimistic default if offline so UI does not flash false warnings
  }
  return channelReadinessCache;
}

/** True when the channel is known and configured on the backend. */
export const isTelegramReady = (channel) => {
  const config = getChannelConfig(channel);
  if (!config) return false;
  if (!channelReadinessCache.checked) return true;
  return Boolean(channelReadinessCache.channels[config.value]);
};

/**
 * Post the composed announcement to the selected Telegram channel via the
 * authenticated Render backend proxy (`POST /api/telegram/send`).
 *
 * @returns {Promise<{ messageId: number|null, photo: { status: 'sent'|'skipped'|'failed', error?: string } }>}
 * @throws {TelegramPublishError} on config, auth, network or API errors
 */
export async function sendAnnouncementToTelegram({ channel, message, imageBase64 }) {
  const config = getChannelConfig(channel);
  if (!config) {
    throw new TelegramPublishError(`"${channel}" is not a known Telegram channel.`);
  }

  const headers = await buildAuthHeaders();

  let response;
  try {
    response = await fetch(`${getBackendBaseUrl()}/api/telegram/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        channel: config.value,
        message,
        imageBase64: imageBase64 || '',
      }),
    });
  } catch (networkError) {
    throw new TelegramPublishError(
      'Could not reach the announcement server. Check your internet connection.',
      String(networkError)
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !(payload?.ok || payload?.success)) {
    const errMsg =
      payload?.error ||
      payload?.message ||
      `Telegram broadcast failed (${response.status}).`;
    throw new TelegramPublishError(errMsg, errMsg);
  }

  return {
    messageId: payload.messageId ?? null,
    photo: payload.photo || { status: imageBase64 ? 'sent' : 'skipped' },
  };
}

/**
 * Remove a previously sent message from a channel via `POST /api/telegram/delete`.
 */
export async function deleteTelegramMessage({ channel, messageId }) {
  const config = getChannelConfig(channel);
  if (!config) {
    return { deleted: false, error: `"${channel}" is not a known Telegram channel.` };
  }
  if (!messageId) {
    return { deleted: false, error: 'No Telegram message was recorded for this channel.' };
  }

  const headers = await buildAuthHeaders();

  try {
    const response = await fetch(`${getBackendBaseUrl()}/api/telegram/delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        channel: config.value,
        messageId,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.deleted) {
      return {
        deleted: false,
        error: payload?.error || 'The message could not be deleted.',
      };
    }

    return { deleted: true };
  } catch {
    return { deleted: false, error: 'The message could not be deleted.' };
  }
}
