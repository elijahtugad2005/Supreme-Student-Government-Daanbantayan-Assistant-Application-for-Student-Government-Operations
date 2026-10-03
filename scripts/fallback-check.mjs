/**
 * Tests the AI fallback policy offline.
 *
 *   npm run test:fallback
 *
 * The policy is the important part: a daily quota block MUST fall through to
 * the backup, but a malformed request must NOT, or a real bug would hide behind
 * a provider switch.
 */
import { runWithFallback, describeProviders } from '../functions/src/ai/fallback.js';
import { AiProviderError, PROVIDER, isRecoverableByFallback } from '../functions/src/providers/errors.js';
import { parseOpenrouterJson } from '../functions/src/providers/openrouter.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

const gemini = {
  name: PROVIDER.GEMINI,
  model: 'gemini-3.8-flash',
  configured: true,
  generate: async () => ({ documentType: 'Resolution', confidence: 0.96, reason: 'via gemini' }),
};

const openrouter = {
  name: PROVIDER.OPENROUTER,
  model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  configured: true,
  generate: async () => ({ documentType: 'Resolution', confidence: 0.81, reason: 'via openrouter' }),
};

const failing = (name, error) => ({
  name,
  configured: true,
  generate: async () => {
    throw error;
  },
});

console.log('=== Provider order ===');
{
  let r = await runWithFallback([gemini, openrouter], {});
  check('the primary is used when it works', r.provider === PROVIDER.GEMINI, r.provider);
  check('the primary result is returned unchanged', r.result.confidence === 0.96);
  check('no fallback was attempted', r.attempts.length === 1, JSON.stringify(r.attempts));
}

console.log('\n=== A daily quota block falls through ===');
{
  const quotaError = new AiProviderError('daily allowance used up', {
    provider: PROVIDER.GEMINI,
    status: 429,
    quotaType: 'daily',
    resetAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const r = await runWithFallback([failing(PROVIDER.GEMINI, quotaError), openrouter], {});
  check('the backup answered', r.provider === PROVIDER.OPENROUTER, r.provider);
  check('the backup result is returned', r.result.reason === 'via openrouter');
  check('both attempts are recorded for the audit', r.attempts.length === 2, JSON.stringify(r.attempts));
  check('the failed attempt is labelled', r.attempts[0].outcome === 'failed');
}

console.log('\n=== A malformed response falls through ===');
{
  const bad = new AiProviderError('not valid JSON', { provider: PROVIDER.GEMINI });
  const r = await runWithFallback([failing(PROVIDER.GEMINI, bad), openrouter], {});
  check('the backup answered', r.provider === PROVIDER.OPENROUTER, r.provider);
}

console.log('\n=== A bug in our request does NOT fall through ===');
{
  const invalid = new AiProviderError('bad schema', {
    provider: PROVIDER.GEMINI,
    status: 'invalid_argument',
  });
  let r = null;
  try {
    r = await runWithFallback([failing(PROVIDER.GEMINI, invalid), openrouter], {});
  } catch (e) {
    r = null;
  }
  check('the error is raised instead of being masked by the backup', r === null);
  check('invalid-argument is not recoverable by fallback',
    isRecoverableByFallback(invalid) === false);
}

console.log('\n=== Both providers failing ===');
{
  const e1 = new AiProviderError('gemini down', { provider: PROVIDER.GEMINI, status: 503 });
  const e2 = new AiProviderError('openrouter down', { provider: PROVIDER.OPENROUTER, status: 503 });
  let caught = null;
  try {
    await runWithFallback([failing(PROVIDER.GEMINI, e1), failing(PROVIDER.OPENROUTER, e2)], {});
  } catch (e) {
    caught = e;
  }
  check('a combined error is raised', Boolean(caught));
  check('the message names both providers', /gemini/i.test(caught.message) && /openrouter/i.test(caught.message), caught?.message);
  check('both attempts are attached for debugging', Array.isArray(caught?.attempts) && caught.attempts.length === 2);
}

console.log('\n=== Unconfigured providers are skipped, not failed ===');
{
  const unconfigured = { ...gemini, configured: false };
  const r = await runWithFallback([unconfigured, openrouter], {});
  check('a provider with no key is skipped', r.provider === PROVIDER.OPENROUTER, r.provider);
  check('it does not count as a failed attempt', r.attempts.length === 1);
}

{
  let caught = null;
  try {
    await runWithFallback([{ ...gemini, configured: false }], {});
  } catch (e) {
    caught = e;
  }
  check('no usable provider says so clearly',
    /No AI provider is configured/i.test(caught?.message || ''), caught?.message);
}

console.log('\n=== Quota survives a total failure ===');
{
  const quota = new AiProviderError('daily', {
    provider: PROVIDER.GEMINI,
    quotaType: 'daily',
    resetAt: '2026-10-04T07:00:00.000Z',
  });
  let caught = null;
  try {
    await runWithFallback([failing(PROVIDER.GEMINI, quota), failing(PROVIDER.OPENROUTER, new AiProviderError('x'))], {});
  } catch (e) {
    caught = e;
  }
  check('the reset time is preserved so the UI can explain', caught?.resetAt === '2026-10-04T07:00:00.000Z', caught?.resetAt);
}

console.log('\n=== Status reporting ===');
{
  const described = describeProviders([gemini, { ...openrouter, configured: false }]);
  check('each provider is described', described.length === 2);
  check('configuration state is reported', described[0].configured === true && described[1].configured === false);
  check('models are reported', described[0].model === 'gemini-3.8-flash');
}

console.log('\n=== OpenRouter response parsing ===');
{
  const ok = parseOpenrouterJson({ choices: [{ message: { content: '{"documentType":"Notice"}' } }] });
  check('clean JSON parses', ok.documentType === 'Notice');
  const fenced = parseOpenrouterJson({ choices: [{ message: { content: '```json\n{"documentType":"Letter"}\n```' } }] });
  check('fenced JSON parses', fenced.documentType === 'Letter');
  const prose = parseOpenrouterJson({ choices: [{ message: { content: 'Sure! {"documentType":"Memo"} hope that helps' } }] });
  check('JSON inside prose is recovered', prose.documentType === 'Memo');

  let caught = null;
  try {
    parseOpenrouterJson({ choices: [{ message: { content: 'I cannot help.' } }] });
  } catch (e) {
    caught = e;
  }
  check('prose with no JSON raises a clear error', /not valid JSON/i.test(caught?.message || ''));
  check('the error is tagged to OpenRouter', caught?.provider === PROVIDER.OPENROUTER);

  caught = null;
  try {
    parseOpenrouterJson({ choices: [], error: { message: 'No credits' } });
  } catch (e) {
    caught = e;
  }
  check('an empty response is reported', caught !== null);
}

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nFallback policy is correct.' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);