// providers/errors.js
// PURPOSE: One error type for every AI provider.
//
// A single class matters for the fallback logic: the runner needs to recognise
// "this provider is exhausted or broken" and move to the next one. Two separate
// error classes would make every catch site provider-specific and defeat the
// purpose.
//
// The `provider` field records which one failed, so the audit trail can say
// that the backup was used instead of silently producing the same answer.

export const PROVIDER = {
  GEMINI: 'gemini',
  OPENROUTER: 'openrouter',
};

/** Quota kinds, kept provider-agnostic where possible. */
export const QUOTA_TYPE = { PER_MINUTE: 'per_minute', DAILY: 'daily' };

export class AiProviderError extends Error {
  constructor(
    message,
    {
      provider = null,
      status = null,
      retryable = false,
      detail = null,
      quotaType = null,
      resetAt = null,
      // Every provider that was tried, in order. Kept on the error because once
      // it is caught the individual failures are otherwise lost.
      attempts = null,
    } = {}
  ) {
    super(message);
    this.name = 'AiProviderError';
    this.provider = provider;
    this.status = status;
    this.retryable = Boolean(retryable);
    this.detail = detail;
    this.quotaType = quotaType;
    this.resetAt = resetAt;
    this.attempts = attempts;
  }
}

/** Is this failure worth handing to another provider? */
export const isRecoverableByFallback = (error) => {
  if (!error) return false;
  // A programming error will fail identically on the backup, so stop.
  if (error.status === 'invalid_argument') return false;
  return true;
};