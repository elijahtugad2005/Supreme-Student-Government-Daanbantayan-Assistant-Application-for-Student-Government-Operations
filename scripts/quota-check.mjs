/**
 * Tests daily-quota detection and reset-time calculation, offline.
 *
 *   node scripts/quota-check.mjs
 *
 * The DST-safe Pacific midnight maths is the part most likely to be wrong, and
 * a wrong reset time would tell an officer their AI is unavailable for the wrong
 * number of hours.
 */
import {
  QUOTA_TYPE,
  classifyQuota,
  nextPacificMidnight,
  parseRetryDelay,
  quotaMessage,
} from '../functions/src/gemini.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

const DAILY_BODY = JSON.stringify({
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message: "You exceeded your current quota, please check your plan and billing details.",
  },
});

const PER_MINUTE_BODY = JSON.stringify({
  error: {
    code: 429,
    message: 'Resource has been exhausted (e.g. check quota).',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.RetryInfo',
        retryDelay: '42s',
      },
    ],
  },
});

console.log('=== Telling daily apart from per-minute ===');
const daily = classifyQuota(429, DAILY_BODY);
check('a quota-exceeded body is daily', daily.quotaType === QUOTA_TYPE.DAILY, daily.quotaType);
check('daily returns an absolute reset time', Boolean(daily.resetAt));
check('daily reset is in the future',
  new Date(daily.resetAt).getTime() > Date.now(), daily.resetAt);

const perMinute = classifyQuota(429, PER_MINUTE_BODY);
check('a short retryDelay means per-minute', perMinute.quotaType === QUOTA_TYPE.PER_MINUTE, perMinute.quotaType);
check('a short delay resets quickly',
  new Date(perMinute.resetAt).getTime() - Date.now() < 120_000,
  perMinute.resetAt);

// Anything ambiguous must default to DAILY. Guessing "per-minute" when the real
// cause is a daily cap means retrying for hours.
const ambiguous = classifyQuota(429, JSON.stringify({ error: { message: 'limit reached' } }));
check('an ambiguous 429 defaults to daily', ambiguous.quotaType === QUOTA_TYPE.DAILY, ambiguous.quotaType);

check('a non-429 is not a quota problem', classifyQuota(500, DAILY_BODY).quotaType === null);
check('a 200 is not a quota problem', classifyQuota(200, DAILY_BODY).quotaType === null);

console.log('\n=== Parsing the retry delay ===');
check('"42s" parses to 42', parseRetryDelay(PER_MINUTE_BODY) === 42);
check('"1.5s" rounds to 2', parseRetryDelay(JSON.stringify({
  error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1.5s' }] },
})) === 2);
check('a missing delay returns null', parseRetryDelay(JSON.stringify({ error: {} })) === null);
check('garbage returns null instead of throwing', parseRetryDelay('not json') === null);

console.log('\n=== Pacific midnight reset ===');
// The reset must land on 00:00 in America/Los_Angeles for any input.
const ptMidnight = (date) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .format(date)
    .replace(/^24:/, '00:');

const samples = [
  ['mid-PT morning', new Date('2026-10-05T17:00:00Z')], // 10:00 PDT
  ['mid-PT evening', new Date('2026-10-06T05:00:00Z')], // 22:00 PDT
  ['late PT night', new Date('2026-10-06T07:30:00Z')], // 00:30 PDT
  ['just before PT midnight', new Date('2026-10-06T06:59:00Z')],
  ['midnight PT exactly', new Date('2026-10-06T07:00:00Z')],
  ['winter PST', new Date('2026-01-05T05:00:00Z')], // 21:00 PST, 3h before DST gap
  ['across spring-forward', new Date('2026-03-08T09:00:00Z')], // DST starts Mar 8 2026
  ['across fall-back', new Date('2026-11-01T08:00:00Z')], // DST ends Nov 1 2026
];

for (const [label, input] of samples) {
  const next = nextPacificMidnight(input.getTime());
  const clock = ptMidnight(next);
  const delta = next.getTime() - input.getTime();
  const isMidnight = clock.startsWith('00:00:00');
  const isFuture = delta > 0;
  const withinADay = delta <= 86_400_000 + 3_600_000; // allow for a DST hour
  check(
    `reset from ${label} is the next PT midnight`,
    isMidnight && isFuture && withinADay,
    `clock=${clock} delta=${Math.round(delta / 60_000)}min`
  );
}

console.log('\n=== Messages ===');
const dailyMsg = quotaMessage(QUOTA_TYPE.DAILY, daily.resetAt);
check('the daily message names the reset time', /\d/.test(dailyMsg) && /resets/i.test(dailyMsg), dailyMsg);
check('the daily message explains the block', /allowance/i.test(dailyMsg), dailyMsg);
const perMinMsg = quotaMessage(QUOTA_TYPE.PER_MINUTE, perMinMsg_at());
function perMinMsg_at() {
  return new Date().toISOString();
}
check('the per-minute message suggests retrying', /try again/i.test(perMinMsg), perMinMsg);
check('a message with no time still reads sensibly',
  /reset/i.test(quotaMessage(QUOTA_TYPE.DAILY, null)));

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nQuota handling is correct.' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);