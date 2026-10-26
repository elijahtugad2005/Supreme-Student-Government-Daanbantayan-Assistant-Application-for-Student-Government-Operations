/**
 * scripts/double-analysis-check.mjs
 *
 * Verifies that document upload does not trigger double analysis:
 * 1. DocumentDashboard.submitUpload must NOT call analyzeDocumentContent while also setting autoAnalyseId.
 * 2. In-flight analysis deduplication exists so concurrent calls for the same documentId share the same request.
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

console.log('=== Checking for double analysis on upload ===');

const dashboardCode = readFileSync('src/components/Document/DocumentDashboard.jsx', 'utf8');

// Check 1: submitUpload should not call analyzeDocumentContent
const submitUploadBlock = dashboardCode.match(/const submitUpload = async \(\) => {([\s\S]*?)};/)?.[1] || '';

const callsAnalyzeInSubmit = /analyzeDocumentContent\s*\(/.test(submitUploadBlock);
const setsAutoAnalyseInSubmit = /setAutoAnalyseId\s*\(\s*id\s*\)/.test(submitUploadBlock);

check(
  'submitUpload does not both call analyzeDocumentContent and set autoAnalyseId',
  !(callsAnalyzeInSubmit && setsAutoAnalyseInSubmit),
  `callsAnalyzeInSubmit=${callsAnalyzeInSubmit}, setsAutoAnalyseInSubmit=${setsAutoAnalyseInSubmit}`
);

// Check 2: analyzeDocumentContent should not be invoked redundantly in DocumentDashboard
const anyAnalyzeDocContent = /analyzeDocumentContent/.test(dashboardCode);
check(
  'DocumentDashboard does not call redundant analyzeDocumentContent',
  !anyAnalyzeDocContent,
  'DocumentDashboard still contains calls or imports of analyzeDocumentContent'
);

// Check 3: DocumentAnalysis panel handles the single autoAnalysing flow
const analysisCode = readFileSync('src/components/Document/DocumentAnalysis.jsx', 'utf8');
const hasAutoAnalysing = /autoAnalysing/.test(analysisCode);
check('DocumentAnalysis supports autoAnalysing prop', hasAutoAnalysing);

// Check 4: In-flight deduplication exists in documentAiService.js
const aiServiceCode = readFileSync('src/services/documentAiService.js', 'utf8');
const hasInFlightDeduplication = /inFlight|activeAnalyses|pendingAnalyses/.test(aiServiceCode);
check('documentAiService implements in-flight analysis deduplication', hasInFlightDeduplication, 'No in-flight deduplication found in documentAiService.js');

console.log(results.join('\n'));
if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll double-analysis checks passed.');
}
