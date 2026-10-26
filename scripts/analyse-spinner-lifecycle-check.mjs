/**
 * scripts/analyse-spinner-lifecycle-check.mjs
 *
 * Verifies that the "Analysing…" spinner lifecycle is strictly bounded:
 * 1. DocumentDashboard clears autoAnalyseId when closing preview/row.
 * 2. DocumentDashboard syncs autoAnalyseId with documents listener: clears when document is no longer processing.
 * 3. Row button does NOT prioritize autoAnalyseId over terminal states (ready_for_review / approved).
 * 4. DocumentAnalysis notifies onAnalyzed immediately if autoAnalysing is passed but analysis is skipped or unnecessary.
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

console.log('=== Checking "Analysing…" spinner lifecycle & autoAnalyseId cleanup ===');

const dashboardCode = readFileSync('src/components/Document/DocumentDashboard.jsx', 'utf8');
const analysisCode = readFileSync('src/components/Document/DocumentAnalysis.jsx', 'utf8');

// Check 1: DocumentDashboard clears autoAnalyseId when closing preview/row
const clearsOnClose = /nextOpen[\s\S]*?} else {[\s\S]{0,120}setAutoAnalyseId\s*\(\s*''\s*\)/.test(dashboardCode);
check(
  'DocumentDashboard clears autoAnalyseId when closing preview/row',
  clearsOnClose,
  'Closing row (nextOpen === false / empty) does not reset autoAnalyseId'
);

// Check 2: DocumentDashboard syncs autoAnalyseId with documents listener (clears on state change or terminal aiState)
const autoSyncWithDocState = /autoAnalyseId[\s\S]{0,120}documents\.find[\s\S]{0,200}setAutoAnalyseId\s*\(\s*''\s*\)/.test(dashboardCode);
check(
  'DocumentDashboard automatically clears autoAnalyseId when document.aiState transitions in Firestore',
  autoSyncWithDocState,
  'No reactive listener found in DocumentDashboard to clear autoAnalyseId when document is no longer processing'
);

// Check 3: Row button prioritizes ready_for_review and approved states over autoAnalyseId spinner
// The buggy pattern: `document.aiState === 'processing' || autoAnalyseId === document.id ? 'Analysing…' : document.aiState === 'ready_for_review' ? ...`
const hasBuggyTernaryOrder = /autoAnalyseId\s*===\s*document\.id\s*\?\s*['"]Analysing/i.test(dashboardCode);
const usesSafeAnalyzingState = /isDocAnalyzing|isAnalyzingDoc/.test(dashboardCode) ||
  (!hasBuggyTernaryOrder && /ready_for_review[\s\S]{0,80}approved[\s\S]{0,80}Analysing/i.test(dashboardCode));
check(
  'Row button prioritizes ready_for_review and approved states over autoAnalyseId spinner',
  usesSafeAnalyzingState,
  'Button evaluates autoAnalyseId before ready_for_review/approved, causing Analysing... on reviewed docs'
);

// Check 4: DocumentAnalysis immediately invokes onAnalyzed if autoAnalysing is passed but document is already analyzed or skipped
const analysisSkipsCleanly = /useEffect\s*\(\s*\(\)\s*=>\s*{[\s\S]{0,400}autoAnalysing[\s\S]{0,400}onAnalyzed\s*\?\.\s*\([\s\S]{0,100}\)[\s\S]{0,300}}\s*,\s*\[autoAnalysing/i.test(analysisCode);
check(
  'DocumentAnalysis invokes onAnalyzed if autoAnalysing is true but analysis is skipped or not required',
  analysisSkipsCleanly,
  'DocumentAnalysis can leave parent autoAnalyseId hanging if autoAnalysing conditions are not met'
);

console.log(results.join('\n'));
if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll spinner lifecycle checks passed.');
}
