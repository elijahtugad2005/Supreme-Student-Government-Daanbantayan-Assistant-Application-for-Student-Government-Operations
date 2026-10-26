/**
 * scripts/gemini-perf-check.mjs
 *
 * Verifies performance optimizations for Gemini:
 * 1. backend/routes/ai.js prefers extracted text over heavy inline multimodal PDF binary when text is available.
 * 2. tryGemini caps maxOutputTokens to 2048 to prevent generation latency blowouts.
 * 3. DocumentAnalysis paces analysis stages smoothly.
 */
import { readFileSync } from 'node:fs';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
  }
};

console.log('=== Checking Gemini latency & summary performance optimizations ===');

const aiRouteCode = readFileSync('backend/routes/ai.js', 'utf8');
const analysisUiCode = readFileSync('src/components/Document/DocumentAnalysis.jsx', 'utf8');

// Check 1: backend/routes/ai.js checks textContent before attaching heavy multimodal inlineData for PDFs
const avoidsUnnecessaryMultimodal = /if\s*\(!textContent\s*\|\|\s*textContent\.trim\(\)\.length\s*<\s*\d+\)[\s\S]{0,100}inlineData/.test(aiRouteCode);
check(
  'backend/routes/ai.js avoids sending heavy multimodal PDF binary when clean text is extracted',
  avoidsUnnecessaryMultimodal,
  'ai.js still attaches heavy inlineData unconditionally before checking textContent'
);

// Check 2: tryGemini uses optimized maxOutputTokens
const usesOptimizedTokens = /maxOutputTokens:\s*2048/.test(aiRouteCode);
check(
  'tryGemini sets maxOutputTokens to 2048 to avoid runaway generation latency',
  usesOptimizedTokens,
  'maxOutputTokens is still 4096 or unoptimized'
);

// Check 3: DocumentAnalysis animation is paced reasonably (>= 1800ms)
const pacedInterval = /setInterval\([\s\S]*?,\s*(?:1[89]\d\d|[2-4]\d\d\d)\)/.test(analysisUiCode);
check(
  'DocumentAnalysis animation intervals are paced reasonably to prevent premature stuck-on-summary state',
  pacedInterval,
  'Interval is still 1100ms or too fast, causing it to idle on Generating Summary stage'
);

console.log(results.join('\n'));
if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll Gemini performance checks passed.');
}
