/**
 * functions/src/gemini.js
 *
 * Thin transport over the Gemini REST API.
 *
 * Kept dependency-free and separate from the callables so the prompt/schema
 * work can be tested without a network call, and so swapping models or moving
 * to the official SDK touches one file.
 */
import { MAX_INPUT_CHARS } from './prompts.js';
import { AiProviderError, PROVIDER, QUOTA_TYPE } from './providers/errors.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// One error type for every provider, tagged with this one, so the fallback
// runner can tell a Gemini failure from an OpenRouter failure.
export class GeminiError extends AiProviderError {}

// QUOTA_TYPE now lives in providers/errors.js so both transports share it.
// Re-exported here because the quota helpers below — and their tests — import it
// from this module.
export { QUOTA_TYPE };

/** Retried on 429 and 5xx. The free tier is rate limited, so this is load-bearing. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Backoff for a retryable failure.
 *
 * A 503 "high demand" from the free tier typically clears in tens of seconds,
 * so it needs a much longer pause than a momentary 429. Short 1–2 second waits
 * just burned the retry budget while the capacity problem persisted.
 */
const backoffMs = (attempt, status) =>
  status === 503 ? Math.min(30_000, 5_000 * 2 ** attempt) : Math.min(8_000, 1_000 * 2 ** attempt);

/**
 * Gemini enforces two independent limits and they need opposite handling:
 *
 *   per-minute  ~15 rpm. Clears in seconds. Retry with a short backoff.
 *   daily       ~1500/day on the free tier. Clearing it takes hours, so
 *               retrying just burns more of the quota. Fail fast instead and
 *               tell the caller when it resets.
 *
 * Telling these apart matters: without it a daily exhaustion shows up as a
 * burst of pointless retries and a vague error.
 */
const DAILY_QUOTA_PATTERN =
  /exceeded your current quota|daily limit|requests per day|per 24 hours|quota exceeded for/i;
const PER_MINUTE_PATTERN = /rate limit|requests per minute|too many requests/i;

/**
 * Extract a retry delay, in seconds, from a Google API error payload.
 * Google returns google.rpc.RetryInfo with a "45s" style duration string.
 */
export const parseRetryDelay = (bodyText) => {
  try {
    const parsed = JSON.parse(bodyText);
    const details = parsed?.error?.details || [];
    const retryInfo = details.find((d) => d?.['@type']?.includes('RetryInfo'));
    const raw = retryInfo?.retryDelay;
    if (!raw) return null;
    const match = String(raw).match(/^([\d.]+)s?$/);
    return match ? Math.round(Number(match[1])) : null;
  } catch {
    return null;
  }
};

/**
 * Midnight Pacific, when Gemini's daily allowance resets.
 *
 * Implemented as a forward search rather than "now minus time-of-day, plus
 * 24 hours". That arithmetic is wrong twice a year: on the daylight-saving
 * fall-back the local day is 25 hours long, so the naive answer lands on the
 * PREVIOUS day's 23:00 and a correction step then walks it back past "now".
 * Stepping forward to the next actual midnight is correct on both 23- and 25-hour
 * days.
 *
 * A 15-minute step is finer than any US Pacific offset change, which is always a
 * whole hour, so the search cannot step over the target.
 */
export const nextPacificMidnight = (from = Date.now()) => {
  const PT = 'America/Los_Angeles';
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PT,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const secondsIntoDay = (date) => {
    const parts = {};
    for (const { type, value } of formatter.formatToParts(date)) parts[type] = value;
    return (Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  };

  const STEP_MS = 15 * 60 * 1000;
  const MAX_MS = 30 * 60 * 60 * 1000; // a Pacific day is never longer than 25h

  // Start just after `from`, then SNAP to the quarter-hour grid. Without the
  // alignment a `from` of 06:59 steps to 07:14, 07:29, 07:44 and never lands on
  // the 07:00 midnight it was one minute away from.
  let candidate = Math.ceil((from + 1) / STEP_MS) * STEP_MS;
  for (; candidate - from <= MAX_MS; candidate += STEP_MS) {
    if (secondsIntoDay(candidate) === 0) return new Date(candidate);
  }

  // Unreachable for America/Los_Angeles, but never return a past date.
  return new Date(Math.ceil((from + 1) / STEP_MS) * STEP_MS + 86_400_000);
};

/** Classify a 429 body into a quota type and an absolute reset time. */
export const classifyQuota = (status, bodyText) => {
  if (status !== 429) return { quotaType: null, resetAt: null };

  const text = String(bodyText || '');
  const retryDelay = parseRetryDelay(text);

  const isDaily = DAILY_QUOTA_PATTERN.test(text);
  const isPerMinute = !isDaily && PER_MINUTE_PATTERN.test(text);

  // A per-minute limit can carry a short retry delay. Anything without one and
  // not obviously per-minute is treated as daily, because guessing wrong the
  // other way means retrying for hours.
  const looksShortLived = retryDelay !== null && retryDelay <= 120;
  const quotaType = isDaily ? QUOTA_TYPE.DAILY : isPerMinute || looksShortLived ? QUOTA_TYPE.PER_MINUTE : QUOTA_TYPE.DAILY;

  const resetAt = quotaType === QUOTA_TYPE.DAILY
    ? nextPacificMidnight().toISOString()
    : new Date(Date.now() + (retryDelay ?? 60) * 1000).toISOString();

  return { quotaType, resetAt };
};

/** A human-readable message for a quota failure. */
export const quotaMessage = (quotaType, resetAt) => {
  const when = resetAt ? new Date(resetAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  if (quotaType === QUOTA_TYPE.DAILY) {
    return when
      ? `Gemini's daily free-tier allowance is used up. It resets at ${when}. Analysis is paused until then.`
      : "Gemini's daily free-tier allowance is used up. It resets at midnight Pacific.";
  }
  return when
    ? `Gemini's request rate is too high. Try again from ${when}.`
    : "Gemini's request rate is too high. Wait a moment and try again.";
};

/**
 * One generation request.
 *
 * Asks for JSON matching `schema`. Gemini honours `responseMimeType` plus
 * `responseSchema` far more reliably than an instruction to "reply with JSON",
 * which is why the schema travels with the request rather than in the prompt.
 *
 * @param {Object} p
 * @param {string} p.apiKey
 * @param {string} p.model
 * @param {Array<{text?: string, inlineData?: {mimeType: string, data: string}}>} p.parts
 * @param {string} p.systemInstruction
 * @param {Object} [p.schema]
 * @param {number} [p.attempts]
 */
export const generateJson = async ({
  apiKey,
  model,
  parts,
  systemInstruction,
  schema,
  temperature = 0.2,
  attempts = 5,
}) => {
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY is not configured on the function.');

  const body = {
    contents: [{ role: 'user', parts }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature,
      maxOutputTokens: 4096,
      ...(schema
        ? { responseMimeType: 'application/json', responseSchema: schema }
        : { responseMimeType: 'application/json' }),
    },
  };

  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        const quota = classifyQuota(response.status, text);
        const retryable = RETRYABLE.has(response.status);

        lastError = new GeminiError(
          quota.quotaType ? quotaMessage(quota.quotaType, quota.resetAt) : `Gemini responded ${response.status}`,
          {
            status: response.status,
            retryable,
            detail: text.slice(0, 400),
            quotaType: quota.quotaType,
            resetAt: quota.resetAt,
          }
        );

        // A daily exhaustion will not clear within this invocation. Retrying
        // only consumes more of the allowance and delays the message the user
        // actually needs to see.
        if (quota.quotaType === QUOTA_TYPE.DAILY) throw lastError;

        if (retryable && attempt < attempts - 1) {
          // Linear backoff: enough to clear a short rate-limit window without
          // stalling a queue behind a long sleep.
          await sleep(backoffMs(attempt, response.status));
          continue;
        }
        throw lastError;
      }

      const payload = await response.json();
      return parseModelJson(payload);
    } catch (error) {
      if (error instanceof GeminiError) {
        if (error.retryable && attempt < attempts - 1) {
          await sleep(backoffMs(attempt, 500));
          continue;
        }
        throw error;
      }
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(backoffMs(attempt, 500));
        continue;
      }
      throw error;
    }
  }

  throw lastError || new GeminiError('Gemini request failed');
};

/**
 * Pull the JSON payload out of a Gemini response.
 *
 * The model may still wrap JSON in prose or a code fence despite the schema, so
 * the fence is stripped and the first balanced object is used as a fallback
 * rather than failing the whole document.
 */
export const parseModelJson = (payload) => {
  const candidates = payload?.candidates || [];
  const text = candidates[0]?.content?.parts?.map((p) => p.text).join('') || '';

  if (!text.trim()) {
    const blocked = payload?.promptFeedback?.blockReason;
    throw new GeminiError(
      blocked
        ? `Gemini declined to process the document (${blocked}).`
        : 'Gemini returned an empty response.',
      { status: payload?.promptFeedback?.blockReason ? 'blocked' : 200 }
    );
  }

  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through to the thrown error below */
      }
    }
    throw new GeminiError('Gemini returned a response that was not valid JSON.', {
      detail: cleaned.slice(0, 300),
    });
  }
};

/**
 * Reduce extracted text to something a request can carry.
 *
 * Character-capped rather than token-capped to avoid pulling in a tokenizer; the
 * limit is set well below the model's context window, and administrative
 * documents are far smaller in practice.
 */
export const truncateForModel = (text) => {
  const value = String(text || '');
  if (value.length <= MAX_INPUT_CHARS) return value;
  return `${value.slice(0, MAX_INPUT_CHARS)}\n\n[content truncated]`;
};

/**
 * Decide whether the model's classification is trustworthy enough to suggest.
 * Exported so the client and the function agree on the same threshold.
 */
export const needsHumanReview = (confidence, threshold) => {
  const value = Number(confidence);
  if (!Number.isFinite(value)) return true;
  return value < threshold;
};