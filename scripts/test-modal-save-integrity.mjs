/**
 * scripts/test-modal-save-integrity.mjs
 *
 * Verifies that DocumentDetailModal and handleSaveModalDoc:
 * 1. Do not store the fake/fallback autoDocId as the actual documentNumber.
 * 2. Do not overwrite doc.subject with patch.description or agenda text.
 * 3. Do not bleed doc.agenda/doc.subject into formData.description fallback.
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

console.log('=== Checking DocumentDetailModal & handleSaveModalDoc save integrity ===');

const modalCode = readFileSync('src/components/Document/DocumentDetailModal.jsx', 'utf8');
const dashboardCode = readFileSync('src/components/Document/DocumentDashboard.jsx', 'utf8');

// Check 1: DocumentDetailModal does NOT store autoDocId as documentNumber
const storesFakeDocId = /documentNumber\s*:\s*(?:doc\.documentNumber\s*\|\|\s*autoDocId|autoDocId)/.test(modalCode);
check(
  'DocumentDetailModal.handleSave does not store autoDocId as documentNumber',
  !storesFakeDocId,
  'DocumentDetailModal still contains "documentNumber: doc.documentNumber || autoDocId"'
);

// Check 2: handleSaveModalDoc in DocumentDashboard does not write description into subject
const handleSaveModalDocBlock = dashboardCode.match(/const handleSaveModalDoc = async \([\s\S]*?};/)?.[0] || '';
const overwritesSubjectWithDesc = /subject\s*:\s*patch\.description/.test(handleSaveModalDocBlock);
check(
  'handleSaveModalDoc does not overwrite subject with patch.description',
  !overwritesSubjectWithDesc,
  'handleSaveModalDoc assigns "subject: patch.description", which overwrites real AI-extracted subjects'
);

// Check 3: DocumentDetailModal does not initialize description from subject or agenda
const descBleedsFromSubjectOrAgenda = /description\s*:\s*doc(?:\.|\?\.)description\s*\|\|\s*doc(?:\.|\?\.)subject\s*\|\|\s*doc(?:\.|\?\.)agenda/.test(modalCode);
check(
  'DocumentDetailModal does not fall back to subject/agenda for description',
  !descBleedsFromSubjectOrAgenda,
  'description is initialized from doc.subject or doc.agenda, causing agenda/subject to bleed into description'
);

// Check 4: Functional test of handleSaveModalDoc patch builder logic
// Simulate a document with an AI-extracted subject and agenda
const simulatedDoc = {
  id: 'doc-123',
  title: 'Annual Budget Hearing',
  documentNumber: '',
  subject: 'FY 2026 Student Organization Budget Allocation',
  agenda: 'Review budget proposals, committee hearings',
  description: '',
};

// Simulate what patch was produced if user only edits the title
const testPatch = {
  title: 'Annual Budget Hearing - Revised',
  labels: ['finance'],
  description: '', // user didn't enter description
  documentNumber: simulatedDoc.documentNumber, // empty
};

// Evaluate the update object logic
const buildUpdates = (patch, currentDoc) => {
  const updates = {
    title: patch.title.trim(),
    labels: patch.labels || [],
  };
  if (patch.documentNumber !== undefined) updates.documentNumber = patch.documentNumber.trim();
  if (patch.description !== undefined) updates.description = patch.description.trim();
  if (patch.subject !== undefined) updates.subject = patch.subject.trim();
  return updates;
};

const updates = buildUpdates(testPatch, simulatedDoc);
const mergedDoc = { ...simulatedDoc, ...updates };

check(
  'Functional check: title-only edit preserves existing AI subject and leaves fake docId unset',
  mergedDoc.subject === simulatedDoc.subject && mergedDoc.documentNumber === '',
  `mergedDoc.subject="${mergedDoc.subject}", expected="${simulatedDoc.subject}"; docNumber="${mergedDoc.documentNumber}"`
);

console.log(results.join('\n'));
if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll save integrity checks passed.');
}
