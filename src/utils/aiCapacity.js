// utils/aiCapacity.js
// PURPOSE: Availability and daily capacity for the Gemini assistant.
//
// HONESTY NOTE
//   Google does not report how much of the free-tier allowance is left. These
//   figures are the PUBLISHED limits combined with a LOCAL count of what this
//   browser has analysed today. That is an estimate, not a quota readout, and
//   the UI says so. Sharing or another device would not be counted.

/**
 * Published free-tier limits for Gemini 2.5 Flash.
 * See https://ai.google.dev/gemini-api/docs/rate-limits
 */
export const GEMINI_LIMITS = {
  requestsPerMinute: 15,
  requestsPerDay: 1500,
  /**
   * Each document costs up to three requests: classify, extract, summarize.
   * Failures (a classifier that times out) cost fewer.
   */
  requestsPerDocument: 3,
};

/** The real ceiling: how many documents one day of quota can pay for. */
export const MAX_DOCUMENTS_PER_DAY = Math.floor(
  GEMINI_LIMITS.requestsPerDay / GEMINI_LIMITS.requestsPerDocument
);

const USAGE_KEY = 'ssg.ai.usage';

/**
 * The day key is the PACIFIC calendar date, not the UTC or browser-local one.
 *
 * Gemini's daily allowance resets at midnight Pacific. Counting on UTC days
 * would reset the counter at 08:00 for users in the Philippines (UTC+8), so a
 * "full" day could be cut short and the next one over-counted. Aligning to the
 * same boundary the quota uses keeps the two in step.
 *
 * en-CA formats as YYYY-MM-DD.
 */
const PACIFIC_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const pacificDayKey = (now = new Date()) => PACIFIC_DAY.format(now);

const todayKey = (now = new Date()) => pacificDayKey(now);

/**
 * Documents analysed today, per browser.
 * Stored as a dated record so a new day starts from zero without any cleanup
 * cron, and a stale day is simply ignored.
 */
export const getUsage = (now = new Date()) => {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return { day: todayKey(now), documents: 0, requests: 0 };
    const parsed = JSON.parse(raw);
    if (parsed.day !== todayKey(now)) {
      return { day: todayKey(now), documents: 0, requests: 0 };
    }
    return {
      day: parsed.day,
      documents: Number(parsed.documents) || 0,
      requests: Number(parsed.requests) || 0,
    };
  } catch {
    return { day: todayKey(now), documents: 0, requests: 0 };
  }
};

export const recordUsage = (documents = 1, requests = 0, now = new Date()) => {
  const current = getUsage(now);
  const next = {
    day: current.day,
    documents: current.documents + documents,
    requests: current.requests + requests,
  };
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(next));
  } catch {
    /* private browsing — counting is best-effort */
  }
  return next;
};

export const resetUsage = () => {
  try {
    localStorage.removeItem(USAGE_KEY);
  } catch {
    /* nothing to clear */
  }
};

/** Human label for a provider name. */
export const providerLabel = (name) => {
  if (name === 'gemini') return 'Google Gemini';
  if (name === 'openrouter') return 'OpenRouter';
  return name || 'unknown';
};

/**
 * Decide whether the assistant can be used right now, and say why not.
 *
 * @param {Object} p
 * @param {Object|null} p.probe  result of the aiStatus call:
 *   null                  = still checking, so no verdict yet
 *   { ok:false, error }   = the service could not be reached
 *   { ok:true, configured }= the service answered
 * @param {Object|null} p.quota    the blocked-quota record, if any
 * @param {number} [p.waitSeconds] remaining wait for a per-minute limit
 * @returns {{state: 'checking'|'available'|'limited'|'unavailable',
 *            label: string, reason: string|null, resetAt: string|null,
 *            remainingDocuments: number}}
 */
export const resolveAvailability = ({ probe, quota, waitSeconds = 0 }) => {
  // Still asking. Saying "unavailable" here would flash a false warning on
  // every page load before the first answer arrives.
  if (probe === null || probe === undefined) {
    return {
      state: 'checking',
      label: 'Checking Assistant…',
      reason: null,
      resetAt: null,
      remainingDocuments: 0,
    };
  }

  // The service did not answer. Blaming the API key here is wrong — the key may
  // be perfectly configured, and the real problem is that the callable is not
  // deployed or not reachable.
  if (probe.ok === false) {
    return {
      state: 'unavailable',
      label: 'Assistant not Available',
      reason:
        'Could not reach the AI service. Deploy it with "firebase deploy --only functions", ' +
        'or start the emulator with "npm run emulators" during development.',
      resetAt: null,
      remainingDocuments: 0,
    };
  }

  // Only blame the key when the service answered and said so.
  if (probe.configured !== true) {
    return {
      state: 'unavailable',
      label: 'Assistant not Available',
      reason: 'No GEMINI_API_KEY is configured for the AI service.',
      resetAt: null,
      remainingDocuments: 0,
    };
  }

  if (quota?.quotaType === 'daily' && quota.resetAt && new Date(quota.resetAt) > new Date()) {
    return {
      state: 'unavailable',
      label: 'Assistant not Available',
      reason: 'The daily free-tier allowance is used up.',
      resetAt: quota.resetAt,
      remainingDocuments: 0,
    };
  }

  if (quota?.quotaType === 'per_minute' && waitSeconds > 0) {
    return {
      state: 'limited',
      label: 'Assistant not Available',
      reason: `Too many requests in a short time. Free again in about ${Math.ceil(waitSeconds / 60) || 1} minute(s).`,
      resetAt: quota.resetAt,
      remainingDocuments: 0,
    };
  }

  return {
    state: 'available',
    label: 'Assistant is Available',
    reason: null,
    resetAt: null,
    remainingDocuments: MAX_DOCUMENTS_PER_DAY,
  };
};

/** How many documents are left today, on the local estimate. */
export const remainingToday = (usage) => {
  const used = Number(usage?.documents) || 0;
  return Math.max(0, MAX_DOCUMENTS_PER_DAY - used);
};

/** 0-100, for the capacity bar. */
export const usagePercent = (usage) => {
  const used = Number(usage?.documents) || 0;
  return Math.min(100, Math.round((used / MAX_DOCUMENTS_PER_DAY) * 100));
};

/** "of about 500 documents" wording that makes the estimate explicit. */
export const capacityLabel = (usage) => {
  const used = Number(usage?.documents) || 0;
  return `${used} of about ${MAX_DOCUMENTS_PER_DAY} documents today`;
};
