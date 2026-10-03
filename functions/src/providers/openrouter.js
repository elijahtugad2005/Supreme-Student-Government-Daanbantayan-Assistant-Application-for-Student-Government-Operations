// providers/openrouter.js
// PURPOSE: OpenRouter transport, interchangeable with Gemini.
//
// OpenRouter exposes an OpenAI-compatible endpoint, so a request is a messages
// array plus temperature. Structured output is requested with
// `response_format: { type: 'json_object' }`, which is widely supported across
// OpenRouter models, and the schema is ALSO spelled out in the system prompt.
//
// That belt-and-braces approach is deliberate. Free and self-hosted models vary
// in how strictly they honour a JSON schema, and a document classifier that
// returns prose instead of JSON would otherwise break the pipeline. The shared
// tolerant parser then recovers the object from whatever comes back.
//
// OpenRouter rate limits are per-model and vary; there is no published
// midnight-reset daily allowance like Gemini's, so no reset time is invented.

import { AiProviderError, PROVIDER, QUOTA_TYPE } from './errors.js';

const BASE = 'https://openrouter.ai/api/v1/chat/completions';

const RETRYABLE = new Set([429, 500, 502, 503, 504, 408]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const backoffMs = (attempt) => Math.min(15_000, 2_000 * 2 ** attempt);

/**
 * One request. Mirrors the shape of gemini.js's generateJson so the fallback
 * runner can treat both providers identically.
 *
 * @param {Object} p
 * @param {string} p.apiKey
 * @param {string} p.model       e.g. "nvidia/nemotron-3-ultra-550b-a55b:free"
 * @param {Array}  p.parts       [{ text }] or [{ image_url: { url } }]
 * @param {string} p.systemInstruction
 * @param {Object} [p.schema]
 */
export const openrouterGenerate = async ({
  apiKey,
  model,
  parts,
  systemInstruction,
  schema,
  temperature = 0.2,
  attempts = 3,
  referer,
  title = 'SSG Document Intelligence',
}) => {
  if (!apiKey) {
    throw new AiProviderError('OPENROUTER_API_KEY is not configured.', {
      provider: PROVIDER.OPENROUTER,
    });
  }

  const content = parts.map((part) => {
    if (part.text) return { type: 'text', text: part.text };
    if (part.inlineData) {
      // OpenRouter takes images as data URLs on the message content.
      return {
        type: 'image_url',
        image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` },
      };
    }
    if (part.image_url) return { type: 'image_url', image_url: part.image_url };
    return { type: 'text', text: String(part.text ?? '') };
  });

  // The schema is repeated in the prompt because json_object alone only
  // guarantees valid JSON, not the right shape.
  const system = schema
    ? `${systemInstruction}\n\nRespond with a single JSON object and nothing else. It must match this schema:\n${JSON.stringify(schema)}`
    : systemInstruction;

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
    temperature,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  };

  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Title': title,
      };
      // OpenRouter attributes usage for free models; both headers are optional.
      if (referer) headers['HTTP-Referer'] = referer;

      const response = await fetch(BASE, { method: 'POST', headers, body: JSON.stringify(body) });

      if (!response.ok) {
        const text = await response.text();
        const retryable = RETRYABLE.has(response.status);
        lastError = new AiProviderError(`OpenRouter responded ${response.status}`, {
          provider: PROVIDER.OPENROUTER,
          status: response.status,
          retryable,
          detail: text.slice(0, 400),
          // A 429 here is a per-model rate limit, not a daily allowance, so it
          // is reported as a short-lived limit with no invented reset time.
          quotaType: response.status === 429 ? QUOTA_TYPE.PER_MINUTE : null,
          resetAt: response.status === 429 ? new Date(Date.now() + 60_000).toISOString() : null,
        });
        if (retryable && attempt < attempts - 1) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }

      const payload = await response.json();
      return parseOpenrouterJson(payload);
    } catch (error) {
      if (error instanceof AiProviderError) {
        if (error.retryable && attempt < attempts - 1) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw error;
      }
      lastError = new AiProviderError(error.message, {
        provider: PROVIDER.OPENROUTER,
        retryable: true,
      });
      if (attempt < attempts - 1) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new AiProviderError('OpenRouter request failed', { provider: PROVIDER.OPENROUTER });
};

/**
 * Pull the JSON object out of a chat completion.
 *
 * Some models wrap JSON in prose or a fence even when told not to, so the same
 * tolerant strategy as the Gemini path is used: strip fences, then fall back to
 * the first balanced object in the text.
 */
export const parseOpenrouterJson = (payload) => {
  const message = payload?.choices?.[0]?.message;
  const text = String(message?.content ?? '').trim();

  if (!text) {
    const reason = payload?.error?.message;
    throw new AiProviderError(
      reason ? `OpenRouter returned an error: ${reason}` : 'OpenRouter returned an empty response.',
      { provider: PROVIDER.OPENROUTER, detail: JSON.stringify(payload?.error || {}).slice(0, 300) }
    );
  }

  const cleaned = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new AiProviderError('OpenRouter returned a response that was not valid JSON.', {
      provider: PROVIDER.OPENROUTER,
      detail: cleaned.slice(0, 300),
    });
  }
};