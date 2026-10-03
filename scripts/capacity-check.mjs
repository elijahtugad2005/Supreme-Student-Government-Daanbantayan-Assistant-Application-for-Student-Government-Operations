/**
 * Tests availability and daily-capacity logic, offline.
 *
 *   npm run test:capacity
 *
 * The important behaviour is precedence: a hard blocker must beat a soft one,
 * and a spent daily allowance must never read as "available".
 */

// Minimal localStorage stand-in so the module can be exercised in Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const {
  MAX_DOCUMENTS_PER_DAY,
  GEMINI_LIMITS,
  capacityLabel,
  getUsage,
  pacificDayKey,
  recordUsage,
  remainingToday,
  resetUsage,
  resolveAvailability,
  usagePercent,
} = await import('../src/utils/aiCapacity.js');

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

const MIN = 60_000;

console.log('=== The capacity ceiling ===');
check('the limits are the published free-tier ones',
  GEMINI_LIMITS.requestsPerMinute === 15 && GEMINI_LIMITS.requestsPerDay === 1500);
check('a document costs up to three requests', GEMINI_LIMITS.requestsPerDocument === 3);
check('the daily document ceiling is 1500 / 3', MAX_DOCUMENTS_PER_DAY === 500, String(MAX_DOCUMENTS_PER_DAY));

console.log('\n=== Counting usage, resetting each day ===');
resetUsage();
check('a fresh day starts at zero', getUsage().documents === 0);

recordUsage(1, GEMINI_LIMITS.requestsPerDocument);
recordUsage(1, GEMINI_LIMITS.requestsPerDocument);
recordUsage(1, GEMINI_LIMITS.requestsPerDocument);
check('three analyses are counted', getUsage().documents === 3, String(getUsage().documents));
check('requests are tracked too', getUsage().requests === 9, String(getUsage().requests));

const yesterday = new Date(Date.now() - 24 * 60 * MIN);
const today = new Date();
recordUsage(1, 3, today);
check('a record stamped yesterday does not count today', getUsage(yesterday).documents === 0);
check('the day key is the Pacific day', getUsage().day === pacificDayKey(today));
check('a future day starts from zero', getUsage(twoDaysAhead()).documents === 0);

/** Two days ahead, so the Pacific day differs whatever the local offset is. */
function twoDaysAhead() {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d;
}

resetUsage();
recordUsage(MAX_DOCUMENTS_PER_DAY);
check('remaining drops to zero at the ceiling', remainingToday(getUsage()) === 0);
check('the bar reads 100%', usagePercent(getUsage()) === 100);
check('the label says it is an estimate',
  /about 500/.test(capacityLabel(getUsage())), capacityLabel(getUsage()));

resetUsage();
recordUsage(250);
check('remaining is half the ceiling', remainingToday(getUsage()) === 250);
check('the bar reads 50%', usagePercent(getUsage()) === 50);

resetUsage();
recordUsage(9999);
check('the bar never exceeds 100%', usagePercent(getUsage()) === 100);
check('remaining never goes negative', remainingToday(getUsage()) === 0);

console.log('\n=== Availability precedence ===');
const ok = { probe: { ok: true, configured: true }, quota: null };
let a = resolveAvailability(ok);
check('a configured, unblocked service is available',
  a.state === 'available' && a.label === 'Assistant is Available', JSON.stringify(a));

// The case that produced the wrong answer: the callable could not be reached.
a = resolveAvailability({ probe: { ok: false, error: 'Failed to fetch' }, quota: null });
check('an unreachable service is unavailable',
  a.state === 'unavailable' && a.label === 'Assistant not Available');
check('it does NOT blame the API key when the service is unreachable',
  !/GEMINI_API_KEY/i.test(a.reason), a.reason);
check('the reason says how to fix it', /deploy --only functions|emulators/i.test(a.reason));

a = resolveAvailability({ probe: null, quota: null });
check('while still probing the state is "checking"', a.state === 'checking', a.state);
check('"checking" does not claim the key is missing',
  !/GEMINI_API_KEY/i.test(a.reason || ''), a.reason);

a = resolveAvailability({ probe: { ok: true, configured: false }, quota: null });
check('a service that answered without a key is unavailable',
  a.state === 'unavailable' && /GEMINI_API_KEY/i.test(a.reason), a.reason);

const future = new Date(Date.now() + 6 * 60 * MIN).toISOString();
a = resolveAvailability({
  probe: { ok: true, configured: true },
  quota: { quotaType: 'daily', resetAt: future },
});
check('a spent daily allowance is unavailable',
  a.state === 'unavailable' && a.label === 'Assistant not Available');
check('the daily reason is stated', /daily free-tier/i.test(a.reason));
check('the reset time is carried through', a.resetAt === future);

a = resolveAvailability({
  probe: { ok: true, configured: true },
  quota: { quotaType: 'daily', resetAt: new Date(Date.now() - MIN).toISOString() },
});
check('an EXPIRED daily block no longer blocks',
  a.state === 'available', JSON.stringify(a.state));

a = resolveAvailability({
  probe: { ok: true, configured: true },
  quota: { quotaType: 'per_minute', resetAt: future },
  waitSeconds: 90,
});
check('a per-minute limit is "limited", not "unavailable"',
  a.state === 'limited' && a.label === 'Assistant not Available', a.state);

a = resolveAvailability({
  probe: { ok: true, configured: true },
  quota: { quotaType: 'per_minute', resetAt: future },
  waitSeconds: 0,
});
check('an elapsed per-minute limit recovers', a.state === 'available', a.state);

// A hard blocker must win over a soft one.
a = resolveAvailability({
  probe: { ok: true, configured: false },
  quota: { quotaType: 'per_minute', resetAt: future },
  waitSeconds: 90,
});
check('a missing key outranks a rate limit', /GEMINI_API_KEY/i.test(a.reason));

a = resolveAvailability({
  probe: { ok: false, error: 'unreachable' },
  quota: { quotaType: 'daily', resetAt: future },
});
check('"not deployed" outranks the daily block', /deploy/i.test(a.reason));

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nCapacity and availability are correct.' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);