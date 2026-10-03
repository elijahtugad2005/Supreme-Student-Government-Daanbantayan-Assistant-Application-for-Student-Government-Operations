// ai/fallback.js
// PURPOSE: Run one AI operation against a primary provider and, if it fails,
// retry it on a backup.
//
// WHY A RUNNER RATHER THAN AD-HOC try/catch AT EACH CALL SITE
//   There are three operations (classify, extract, summarize) across several
//   callables. Sprinkling fallback logic through all of them guarantees they
//   drift apart. Centralising it means the policy is written once and applies
//   identically everywhere.
//
// POLICY
//   - Providers are tried in the order configured. A provider with no key is
//     skipped silently, not reported as an error.
//   - A daily quota exhaustion DOES fall back: that is the whole reason for a
//     backup, since it lasts until midnight Pacific.
//   - A malformed response falls back, because the backup may be stricter.
//   - An invalid-argument error does NOT fall back: it is a bug in our request,
//     and the second provider would reject it identically. Hiding that behind a
//     provider switch would make a real defect look like a flaky network.
//
// The provider that succeeded is returned so the caller can record which one
// actually answered.

import { AiProviderError, PROVIDER } from '../providers/errors.js';

/**
 * @param {Array<{name: string, configured: boolean, generate: Function}>} providers
 *        Ordered most-preferred first.
 * @param {Object} request passed straight through to each provider's generate()
 * @param {(record: {provider: string, outcome: string, error?: string}) => void} [onAttempt]
 * @returns {Promise<{result: Object, provider: string, attempts: Array}>}
 */
export const runWithFallback = async (providers, request, onAttempt) => {
  const usable = providers.filter((p) => p && p.configured);
  const attempts = [];
  const failures = [];
  let quotaInfo = null;

  if (usable.length === 0) {
    throw new AiProviderError(
      'No AI provider is configured. Set GEMINI_API_KEY and/or OPENROUTER_API_KEY.',
      { provider: null }
    );
  }

  for (const [index, provider] of usable.entries()) {
    const isLast = index === usable.length - 1;
    try {
      const result = await provider.generate(request);
      attempts.push({ provider: provider.name, outcome: 'ok' });
      onAttempt?.({ provider: provider.name, outcome: 'ok' });
      return { result, provider: provider.name, attempts };
    } catch (error) {
      failures.push(`${provider.name}: ${error?.message || 'unknown'}`);
      const record = {
        provider: provider.name,
        outcome: 'failed',
        error: error?.message || 'Unknown error',
      };
      attempts.push(record);
      onAttempt?.(record);

      // Quota information is the most useful thing to carry out of a total
      // failure, but it may come from an EARLIER provider than the last one to
      // fail. Taking it only from the final error would lose the "resets at
      // midnight" message whenever the backup failed for a different reason.
      if (error?.quotaType && !quotaInfo) {
        quotaInfo = { quotaType: error.quotaType, resetAt: error.resetAt ?? null };
      }

      // A bug in our request will fail the same way on every provider.
      if (error?.status === 'invalid_argument') throw error;

      if (isLast) {
        throw new AiProviderError(
          `All configured AI providers failed. ${failures.join(' | ')}`,
          {
            provider: provider.name,
            status: error?.status ?? null,
            quotaType: quotaInfo?.quotaType ?? null,
            resetAt: quotaInfo?.resetAt ?? null,
            detail: error?.detail ?? null,
            attempts,
          }
        );
      }
    }
  }

  // Unreachable: the loop either returns or throws.
  throw new AiProviderError('No AI provider produced a result.', { provider: null });
};

/** Which providers are usable, for the status endpoint. */
export const describeProviders = (providers) =>
  providers.map((p) => ({
    name: p.name,
    configured: Boolean(p.configured),
    model: p.model ?? null,
  }));

export { PROVIDER };