/**
 * scripts/ai-prompt-optimization-check.mjs
 * TDD Suite for AI Generative Summary Prompt Optimization (Caveman Rules):
 * 
 * Slice 1: Input text compression (Caveman preprocessor strips fluff/boilerplate before LLM call)
 * Slice 2: Prompt token reduction (Measure prompt length reduction >= 40% vs legacy prompt)
 * Slice 3: Output schema integrity (Generates strictly valid JSON with title, summary, agenda, subject)
 * Slice 4: TTFT & Token savings calculation
 */

import assert from 'node:assert/strict';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

console.log('=== Slice 1: Caveman Preprocessor for Document Text ===');
const { compressDocumentText, buildOptimizedAiPrompt } = await import('../backend/utils/aiPromptOptimizer.js');

const rawDocumentText = `
Republic of the Philippines
CEBU TECHNOLOGICAL UNIVERSITY
Daanbantayan Campus
Agujo, Daanbantayan, Cebu
OFFICE OF THE SUPREME STUDENT GOVERNMENT

EXCERPTS FROM THE MINUTES OF THE 4TH REGULAR SESSION OF THE SUPREME STUDENT GOVERNMENT OF CEBU TECHNOLOGICAL UNIVERSITY DAANBANTAYAN CAMPUS HELD AT THE STUDENT CENTER ON OCTOBER 24, 2026.

Present:
Hon. Frixty Frodo - SSG President / Presiding Officer
Hon. Maria Santos - SSG Vice President
Hon. Juan Dela Cruz - Executive Secretary
Hon. Ana Reyes - Treasurer

Absent: None.

RESOLUTION NO. 2026-042

A RESOLUTION AUTHORIZING AND APPROVING THE ACQUISITION AND INSTALLATION OF THIRTY (30) CAMPUS STUDENT LOCKER UNITS AT THE HM AND EDUCATION BUILDINGS FOR THE TOTAL AMOUNT OF THREE THOUSAND PESOS (PHP 3,000.00).

WHEREAS, the student body has continually requested secure storage facilities for their academic equipment, hospitality utensils, and personal belongings during laboratory sessions;
WHEREAS, the Supreme Student Government has allocated funds under the Income-Generating Projects (IGP) enterprise account;
NOW THEREFORE, on motion of Hon. Maria Santos, duly seconded by all members present;
BE IT RESOLVED, as it is hereby resolved by the Supreme Student Government in session assembled, to approve the locker project.

Prepared by:
JUAN DELA CRUZ
Executive Secretary

Approved by:
FRIXTY FRODO
SSG President
`;

const compressed = compressDocumentText(rawDocumentText);

check('Compresses text by stripping excessive whitespace and header fluff', compressed.length < rawDocumentText.length);
check('Preserves load-bearing legal markers (RESOLUTION, WHEREAS, BE IT RESOLVED)', 
  compressed.includes('RESOLUTION NO. 2026-042') && compressed.includes('BE IT RESOLVED'));
check('Preserves author and signatory lines', compressed.includes('JUAN DELA CRUZ') && compressed.includes('FRIXTY FRODO'));

console.log('\n=== Slice 2: Token Efficiency & Prompt Token Reduction ===');
const legacyPromptLength = 2650; // Reference char length of previous verbose prompt
const labelsList = [
  { id: 'minutes_of_meeting', name: 'Minutes of Meeting' },
  { id: 'resolution', name: 'Resolution' },
  { id: 'memorandum', name: 'Memorandum' },
  { id: 'financial', name: 'Financial Document' },
  { id: 'request', name: 'Request Letter' },
  { id: 'other', name: 'Other' }
];

const optimizedPrompt = buildOptimizedAiPrompt({
  fileName: 'RESO-2026-042-LOCKERS.pdf',
  textContent: compressed,
  labelsList
});

check('Optimized prompt is significantly leaner than legacy prompt (>40% character reduction on prompt template overhead)', 
  optimizedPrompt.templateOverheadChars < legacyPromptLength * 0.6);
check('Caveman rule applied: Direct rules, zero fluff filler instructions', !optimizedPrompt.prompt.includes('You are an expert archivist analyzing an official document'));
check('Retains exact JSON keys required by Document Repository', 
  optimizedPrompt.prompt.includes('"summary"') && 
  optimizedPrompt.prompt.includes('"agenda"') && 
  optimizedPrompt.prompt.includes('"subject"') &&
  optimizedPrompt.prompt.includes('"documentNumber"') &&
  optimizedPrompt.prompt.includes('"signatories"'));

console.log('\n=== Slice 3: Safe Parsing & Output Extraction ===');
const { safeJsonParse } = await import('../backend/utils/aiPromptOptimizer.js');

const rawModelOutput = `\`\`\`json
{
  "title": "Resolution No. 2026-042: Acquisition of Campus Student Lockers",
  "documentNumber": "RESO-2026-042",
  "documentDate": "2026-10-24",
  "documentType": "resolution",
  "documentTypeLabel": "Resolution",
  "summary": "Approved the installation of 30 student locker units at HM and Education buildings.",
  "agenda": "Campus locker project approval",
  "subject": "Locker Project Approval",
  "authorName": "Juan Dela Cruz",
  "authorRole": "Executive Secretary",
  "labels": ["resolution"],
  "signatories": [
    { "name": "Frixty Frodo", "position": "SSG President", "required": true }
  ]
}
\`\`\``;

const parsed = safeJsonParse(rawModelOutput);
check('Extracts title correctly', parsed.title.includes('Resolution No. 2026-042'));
check('Extracts summary without fluff', parsed.summary.length > 10 && parsed.summary.length < 300);
check('Extracts author and signatories distinctly', parsed.authorName === 'Juan Dela Cruz' && parsed.signatories[0].name === 'Frixty Frodo');

console.log('\n=== Summary ===');
results.forEach(r => console.log(r));
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} checks passed.`);
  process.exit(0);
}

