// Centralized configuration for announcement classification and Telegram
// publishing. The emoji + title pairing lives here only — components read
// from this map instead of hardcoding labels.
//
// The type decides the opening emoji + title of the Telegram message and
// nothing else. It never adds dates, venues, signatures or wording.

export const ANNOUNCEMENT_TYPES = {
  event: { value: 'event', emoji: '🎉', title: 'EVENT', label: '🎉 Event' },
  announcement: { value: 'announcement', emoji: '📢', title: 'ANNOUNCEMENT', label: '📢 Announcement' },
  memo: { value: 'memo', emoji: '📝', title: 'MEMO', label: '📝 Memo' },
  lost_found: { value: 'lost_found', emoji: '🔎', title: 'LOST & FOUND', label: '🔎 Lost & Found' },
  merchandise: { value: 'merchandise', emoji: '🛍️', title: 'MERCHANDISE AVAILABILITY', label: '🛍️ Merchandise Availability' },
  death_aid: { value: 'death_aid', emoji: '🕊️', title: 'DEATH AID', label: '🕊️ Death Aid' },
};

// Order the dropdown is rendered in
export const ANNOUNCEMENT_TYPE_VALUES = [
  'event',
  'announcement',
  'memo',
  'lost_found',
  'merchandise',
  'death_aid',
];

// Telegram destinations. Completely independent of the announcement type:
// the type picks the emoji + title, the channel picks where it is sent.
export const TELEGRAM_CHANNELS = {
  faculty: {
    value: 'faculty',
    label: 'Faculty',
    envKey: 'TELEGRAM_CTUDBFACULTIES_CHANNELID',
  },
  all_mayors: {
    value: 'all_mayors',
    label: 'All Mayors',
    envKey: 'TELEGRAM_CTUDBALLMAYORS_CHANNELID',
  },
};

export const getTypeConfig = (value) => ANNOUNCEMENT_TYPES[value] || null;

export const getChannelConfig = (value) => TELEGRAM_CHANNELS[value] || null;

/** UI-only option that fans out to every real channel. */
export const BOTH_CHANNELS = 'both';

/** Expand a channel selection into the concrete destinations to send to. */
export const resolveChannels = (selection) => {
  if (selection === BOTH_CHANNELS) return Object.keys(TELEGRAM_CHANNELS);
  return selection && TELEGRAM_CHANNELS[selection] ? [selection] : [];
};

/**
 * Per-channel Telegram records, normalised for both the old single-channel
 * shape ({ channel, message }) and the newer { channels: {...} } map, so
 * announcements published before this change can still be cleaned up.
 */
export function normalizeTelegramRecords(telegram) {
  if (!telegram) return {};

  if (telegram.channels && typeof telegram.channels === 'object') {
    return telegram.channels;
  }
  if (telegram.channel) {
    return {
      [telegram.channel]: {
        status: telegram.status,
        messageId: telegram.messageId ?? null,
        publishedAt: telegram.publishedAt || '',
        error: telegram.error || '',
      },
    };
  }
  return {};
}

/**
 * Escape text for Telegram's HTML parse mode. Applied to the manager's own
 * writing so their `<`, `>` and `&` show up exactly as typed instead of being
 * swallowed as markup — only the lines we control get any styling.
 */
export const escapeHtml = (text) =>
  String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Split an announcement into the three lines Telegram receives.
 * Shared by the outgoing message and the on-screen preview so what you see
 * and what gets sent cannot drift apart.
 */
export function buildTelegramMessageParts(type, content, title = '') {
  const config = getTypeConfig(type);
  return {
    prefix: config ? `${config.emoji} ${config.title}` : '',
    title: typeof title === 'string' ? title.trim() : '',
    body: typeof content === 'string' ? content : '',
  };
}

/**
 * Build the final Telegram message:
 *   type emoji + title
 *   announcement title (bold)
 *   the manager's own text exactly as written
 *
 * No dates, venues, signatures or wording are added automatically.
 */
export function buildTelegramMessage(type, content, title = '') {
  const { prefix, title: safeTitle, body } = buildTelegramMessageParts(type, content, title);
  const chunks = [];

  if (prefix) chunks.push(escapeHtml(prefix));
  if (safeTitle) chunks.push(`<b>${escapeHtml(safeTitle)}</b>`);
  if (body.trim()) chunks.push(escapeHtml(body));

  return chunks.join('\n\n');
}
