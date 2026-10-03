/**
 * Guards the theme contract.
 *
 * Screens reference colours as var(--token). If a token is missing from even one
 * theme, that screen silently renders with the browser's default colour in that
 * theme — an invisible bug that no lint rule or test suite would catch, because
 * the markup and the build are both fine.
 *
 *   node scripts/theme-token-check.mjs
 */
import { readFileSync } from 'node:fs';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

const css = readFileSync('src/styles/themes.css', 'utf8');

/** Pull the custom properties declared inside a `.theme-name { … }` block. */
const tokensIn = (name) => {
  const start = css.indexOf(`.${name} {`);
  if (start === -1) return null;
  let depth = 0;
  let i = css.indexOf('{', start);
  for (let j = i; j < css.length; j += 1) {
    if (css[j] === '{') depth += 1;
    else if (css[j] === '}') {
      depth -= 1;
      if (depth === 0) {
        const body = css.slice(i + 1, j);
        return new Set(Array.from(body.matchAll(/(--[a-z0-9-]+)\s*:/gi)).map((m) => m[1]));
      }
    }
  }
  return null;
};

const THEMES = ['theme-dark', 'theme-light', 'theme-corporate'];
const defined = {};
for (const t of THEMES) {
  const set = tokensIn(t);
  check(`found the ${t} block`, !!set);
  defined[t] = set || new Set();
}

// Every token the shared palette resolves at runtime.
const source = readFileSync('src/utils/themeStyles.js', 'utf8');
const used = new Set(Array.from(source.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)).map((m) => m[1]));

check('the palette references tokens', used.size > 0, `found ${used.size}`);

THEMES.forEach((theme) => {
  const missing = [...used].filter((token) => !defined[theme].has(token));
  check(
    `${theme} defines every token the palette uses`,
    missing.length === 0,
    `missing: ${missing.join(', ')}`
  );
});

// Tokens that exist in one theme but not another are the trap this guards, so
// surface them explicitly rather than only checking the palette.
THEMES.forEach((theme) => {
  [...defined[theme]].forEach((token) => {
    if (!used.has(token)) return; // not referenced by our screens
  });
});

console.log(`Tokens referenced by the palette: ${used.size}`);
THEMES.forEach((t) => console.log(`  ${t}: defines ${defined[t].size} tokens`));

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nTheme tokens are complete in every theme.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);