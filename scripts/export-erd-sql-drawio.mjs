// Exports the Obsidian DB Atlas ERD (single source of truth) to:
//   1. Draw.io-friendly SQL      -> Paperworks/Manuscript/Figures/ERD/ssg_erd_drawio_import.sql
//   2. Annotated reference DDL   -> Paperworks/Manuscript/Figures/ERD/ssg_erd_reference_postgres.sql
//   3. Relationship peer review  -> Paperworks/Manuscript/Figures/ERD/ERD_RELATIONSHIP_PEER_REVIEW.md
//   4. Native Draw.io diagram    -> scripts/ERD final.drawio (6 pages: combined + 5 sections)
//
// Run after `node scripts/generate-db-atlas-notes.mjs`.
import fs from 'fs';
import path from 'path';

const VAULT = path.resolve('Obsidian Documentation');
const ATLAS = path.join(VAULT, 'db-atlas');
const PLUGIN_DATA = path.join(VAULT, '.obsidian', 'plugins', 'db-atlas', 'data.json');
const OUT_DIR = path.resolve('Paperworks', 'Manuscript', 'Figures', 'ERD');
const DRAWIO_OUT = path.resolve('scripts', 'ERD final.drawio');
const COMBINED = 'db-atlas/00-all-entities-combined';

const PAGE_TITLES = {
  'db-atlas/00-all-entities-combined': '00 · Master Combined ERD (32 Entities)',
  'db-atlas/01-identity-org-audit': 'S1 · Identity, Organizations & Audit',
  'db-atlas/02-rosters-technocares': 'S2 · Class Rosters & TechnoCares',
  'db-atlas/03-finance-ppmp-igp': 'S3 · Centavo Finance, PPMP & IGP',
  'db-atlas/04-commerce-inventory-preorders': 'S4 · Commerce, Inventory & Pre-Orders',
  'db-atlas/05-documents-comms-campus': 'S5 · Documents, GridFS, AI & Campus',
};

const SECTION_LEGEND = [
  ['#8B1E3F', 'S1 · Identity, Organizations & Audit'],
  ['#0F766E', 'S2 · Class Rosters & TechnoCares'],
  ['#1D4ED8', 'S3 · Centavo Finance, PPMP & IGP'],
  ['#B45309', 'S4 · Commerce, Inventory & Pre-Orders'],
  ['#6D28D9', 'S5 · Documents, GridFS, AI & Campus'],
];

// -----------------------------------------------------------------------------
// PEER REVIEW REGISTER — one entry per relationship drawn in the combined ERD.
// enf: RULES   = enforced by firestore.rules
//      SERVICE = written/validated by the service layer only
//      LOGICAL = nested path, array, polymorphic, business-key, or cross-datastore
//                reference (rendered dashed; not enforceable as a strict FK)
// -----------------------------------------------------------------------------
const REVIEW = {
  'users.mayorOf_rosterId': { enf: 'LOGICAL', ev: 'rosterService.js:105-117', note: 'Nested `mayorOf.rosterId`, written best-effort after roster submission.' },
  'users.deletedBy': { enf: 'SERVICE', ev: 'userManagementService.js:185', note: 'Self-reference to the deactivating admin.' },
  'members.orgId': { enf: 'SERVICE', ev: 'MemberDashboard.jsx:170', note: '' },
  'members.term': { enf: 'SERVICE', ev: 'MemberDashboard.jsx:169', note: 'Term ID string such as `2025-2026`.' },
  'audit_logs.userId': { enf: 'SERVICE', ev: 'userManagementService.js:588', note: 'Only user-management audit writes carry UIDs; auditService.js writes names only.' },
  'audit_logs.targetUserId': { enf: 'SERVICE', ev: 'userManagementService.js:589', note: '' },
  'classSections.currentRosterId': { enf: 'RULES', ev: 'rosterService.js:179; firestore.rules:203', note: 'One active baseline per section (1:1).' },
  'classRosters.sectionKey': { enf: 'LOGICAL', ev: 'rosterService.js:72, 97-101', note: '`classSections` is written only on verification, so a first-time pending roster exists before its section row.' },
  'classRosters.mayorUid': { enf: 'RULES', ev: 'rosterService.js:50, 75; firestore.rules:153', note: 'Submission rejected without a signed-in non-guest UID.' },
  'deathAidBeneficiaries.createdByUid': { enf: 'SERVICE', ev: 'deathAidService.js:75', note: 'Code falls back to `null` if no officer object is passed.' },
  'deathAidCollections.rosterId': { enf: 'RULES', ev: 'deathAidService.js:312, 349; firestore.rules:364', note: 'Authoritative headcount link (enrolledCount == roster.studentCount).' },
  'deathAidCollections.sectionKey': { enf: 'LOGICAL', ev: 'deathAidService.js:161, 351', note: 'Denormalized section key; the enforced link is `rosterId`.' },
  'deathAidCollections.beneficiaryCaseId': { enf: 'RULES', ev: 'deathAidService.js:361; firestore.rules:379', note: '' },
  'deathAidCollections.recordedByUid': { enf: 'RULES', ev: 'deathAidService.js:377; firestore.rules:383', note: '' },
  'deathAidRemittances.collectionId': { enf: 'RULES', ev: 'deathAidService.js:520; firestore.rules:439', note: 'Remittance doc ID equals collection ID (strict 1:1).' },
  'deathAidRemittances.receivedByUid': { enf: 'RULES', ev: 'deathAidService.js:512; firestore.rules:434, 447', note: 'Separation of duties: must differ from recordedByUid.' },
  'deathAidAuditLog.collectionId': { enf: 'LOGICAL', ev: 'deathAidService.js:216, 243, 259', note: 'Polymorphic: also stores beneficiary case IDs, so it cannot be a strict FK.' },
  'deathAidAuditLog.actorUid': { enf: 'RULES', ev: 'deathAidService.js:218; firestore.rules:470', note: '' },
  'fundAccounts.createdById': { enf: 'SERVICE', ev: 'financeService.js:122', note: '' },
  'budgetAllocations.fundAccountId': { enf: 'SERVICE', ev: 'financeService.js:420', note: '' },
  'budgetAllocations.resolutionDocumentId': { enf: 'SERVICE', ev: 'financeService.js:349, 431, 489', note: 'Cross-domain: PPMP allocation backed by a legislative resolution.' },
  'budgetAllocations.approvedById': { enf: 'SERVICE', ev: 'financeService.js:436', note: '' },
  'transactions.fundAccountId': { enf: 'SERVICE', ev: 'financeService.js:907, 1086', note: '' },
  'transactions.transferDestinationAccountId': { enf: 'SERVICE', ev: 'financeService.js:273, 663', note: 'Second FK to the same parent table (transfers).' },
  'transactions.budgetAllocationId': { enf: 'SERVICE', ev: 'financeService.js:685, 914', note: '' },
  'transactions.reversalOfTransactionId': { enf: 'SERVICE', ev: 'financeService.js:913 vs 1387', note: 'DATA BUG: order reversals (1387) store the refNumber instead of the transaction doc ID.' },
  'transactions.orderDocId': { enf: 'SERVICE', ev: 'financeService.js:1249, 1399', note: 'Collection and its reversal both point to the same order, so N:1 is correct.' },
  'transactions.batchId': { enf: 'SERVICE', ev: 'financeService.js:1093', note: '' },
  'transactions.preOrderEntryId': { enf: 'SERVICE', ev: 'financeService.js:1094', note: 'An entry can receive several partial payments (N:1).' },
  'transactions.receiptFileId': { enf: 'LOGICAL', ev: 'financeService.js:655; FundGovernance.jsx:1334', note: 'Cross-datastore (Firestore to MongoDB). ConsumableExpenseDialog.jsx:93 writes a Drive ID instead.' },
  'transactions.createdById': { enf: 'SERVICE', ev: 'financeService.js:916, 1095, 1251', note: 'DATA BUG: falls back to sentinel strings `officer` / `order-system` that are not UIDs.' },
  'igpCollections.lockerId': { enf: 'SERVICE', ev: 'igpProjectService.js:236-237', note: 'Only for LOCKER_RENTAL collections.' },
  'igpCollections.collectedBy_uid': { enf: 'LOGICAL', ev: 'igpProjectService.js:86-91, 156', note: 'Nested `collectedBy.uid`.' },
  'products.linkedInventoryId': { enf: 'SERVICE', ev: 'ProductManagement.jsx:744, 820-833', note: 'Mirror of inventory.linkedProductId (1:1).' },
  'orders.productInfo_productId': { enf: 'LOGICAL', ev: 'order.jsx:72, 250', note: 'Nested `productInfo.productId` (SKU). Falls back to the doc ID for legacy products without a productId field.' },
  'orders.igfTxRef': { enf: 'LOGICAL', ev: 'financeService.js:1264', note: 'Business-key pointer to the current IGF posting (1:1); the enforced link is transactions.orderDocId.' },
  'inventory.linkedProductId': { enf: 'SERVICE', ev: 'ProductManagement.jsx:735; InventoryProvider.jsx:341', note: 'Targets the SKU `products.productId`, not the doc ID.' },
  'borrowingLogs.itemId': { enf: 'SERVICE', ev: 'InventoryProvider.jsx:379, 446', note: '' },
  'preOrderBatches.custodianUserId': { enf: 'SERVICE', ev: 'financeService.js:1016', note: '' },
  'preOrderBatches.createdById': { enf: 'SERVICE', ev: 'financeService.js:1028', note: '' },
  'preOrderEntries.batchId': { enf: 'SERVICE', ev: 'financeService.js:1067', note: '' },
  'preOrderEntries.recordedById': { enf: 'SERVICE', ev: 'financeService.js:1078', note: '' },
  'settings.currentTerm': { enf: 'SERVICE', ev: 'useCurrentTerm.js:34, 56', note: 'Only on the `settings/app` singleton.' },
  'settings.assignedByUid': { enf: 'SERVICE', ev: 'centralizedOrderSheetOrchestrator.js:793, 890', note: 'Writes an empty string when no actor is present (treat as NULL).' },
  'documents.mongoFileId': { enf: 'LOGICAL', ev: 'documentService.js:228, 254', note: 'Cross-datastore (Firestore to MongoDB GridFS), strict 1:1.' },
  'documents.labels': { enf: 'LOGICAL', ev: 'documentService.js:248', note: 'Array of slugs (M:N). Normalized as `documentLabelAssignments` in SQL.' },
  'documents.createdBy': { enf: 'SERVICE', ev: 'documentService.js:260', note: 'Code falls back to `null` if no actor is passed.' },
  'gridfs_files.metadata_uploadedBy': { enf: 'LOGICAL', ev: 'backend/routes/documents.js:240', note: 'Nested GridFS metadata, cross-datastore (MongoDB to Firestore users).' },
  'documentLabels.createdBy': { enf: 'SERVICE', ev: 'documentService.js:144', note: '' },
  'documentAuditLogs.documentId': { enf: 'RULES', ev: 'firestore.rules:528; backend/routes/ai.js:922', note: 'Subcollection parent path `documents/{id}/auditLogs`.' },
  'documentAuditLogs.performedBy': { enf: 'SERVICE', ev: 'backend/routes/ai.js:924', note: '' },
  'calendarEvents.createdBy_uid': { enf: 'LOGICAL', ev: 'CalendarWidget.jsx:441-446', note: 'Nested `createdBy.uid`; omitted when events are created from Announcement.jsx.' },
};

// -----------------------------------------------------------------------------
// 1. PARSE DB ATLAS NOTES
// -----------------------------------------------------------------------------
function parseNote(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) throw new Error(`No frontmatter in ${file}`);
  const fm = fmMatch[1];
  const body = raw.slice(fmMatch[0].length);
  const color = (fm.match(/^table_color:\s*"([^"]+)"/m) || [])[1];
  const description = ((fm.match(/^table_description:\s*"(.*)"$/m) || [])[1] || '').replace(/\\"/g, '"');
  const section = (fm.match(/erd-section\/([\w-]+)/) || [])[1];
  const descs = {};
  for (const m of body.matchAll(/^## (\S+)\r?\n[\s\S]*?\* \*\*Description:\*\* (.*)$/gm)) descs[m[1]] = m[2].trim();
  const columns = [...fm.matchAll(/^col_([A-Za-z0-9_]+):\s*'(.+)'$/gm)].map((m) => ({
    name: m[1],
    ...JSON.parse(m[2]),
    desc: descs[m[1]] || '',
  }));
  return { name: path.basename(file, '.md'), color, description, section, columns };
}

const pluginData = JSON.parse(fs.readFileSync(PLUGIN_DATA, 'utf8'));
const folders = pluginData.settings.dbFolders;
const pages = folders.map((folder) => {
  const dir = path.join(VAULT, folder);
  const tables = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseNote(path.join(dir, f)));
  const layout = pluginData.layouts[folder]?.tables || {};
  for (const t of tables) {
    if (!layout[t.name]) throw new Error(`No layout for ${folder}/${t.name}`);
    t.x = layout[t.name].x;
    t.y = layout[t.name].y;
  }
  return { folder, title: PAGE_TITLES[folder] || folder, tables };
});

const combined = pages.find((p) => p.folder === COMBINED);
if (!combined) throw new Error('Combined folder missing from data.json');
const byName = new Map(combined.tables.map((t) => [t.name, t]));

// -----------------------------------------------------------------------------
// 2. AUTOMATED PEER REVIEW (fails the run on any structural defect)
// -----------------------------------------------------------------------------
const errors = [];
const edges = [];
for (const t of combined.tables) {
  for (const c of t.columns) {
    if (!c.ref) continue;
    const [rt, rc] = c.ref.split('.');
    const target = byName.get(rt);
    const targetCol = target?.columns.find((x) => x.name === rc);
    const key = `${t.name}.${c.name}`;
    const rel = c.rel || '>';
    if (!targetCol) { errors.push(`${key} -> ${c.ref}: target missing`); continue; }
    if (!targetCol.pk && !targetCol.unique) errors.push(`${key} -> ${c.ref}: target is neither PK nor UNIQUE`);
    if (rel === '-' && !c.pk && !c.unique) errors.push(`${key}: 1:1 relationship but FK column is not UNIQUE`);
    if (rel !== '<>' && c.type !== targetCol.type) errors.push(`${key}: type ${c.type} != ${targetCol.type}`);
    if (rel === '<>' && c.type !== 'array') errors.push(`${key}: M:N must come from an array column`);
    if (!REVIEW[key]) errors.push(`${key}: no peer-review entry`);
    edges.push({ key, from: t.name, fromCol: c.name, to: rt, toCol: rc, rel, notNull: Boolean(c.notNull), review: REVIEW[key] || {} });
  }
}
for (const key of Object.keys(REVIEW)) {
  if (!edges.some((e) => e.key === key)) errors.push(`Review entry ${key} has no matching relationship in the ERD`);
}
for (const p of pages) {
  if (p.folder === COMBINED) continue;
  for (const t of p.tables) {
    for (const c of t.columns) {
      if (c.ref && !edges.some((e) => e.key === `${t.name}.${c.name}` && `${e.to}.${e.toCol}` === c.ref)) {
        errors.push(`${p.folder}: ${t.name}.${c.name} not present in combined ERD`);
      }
    }
  }
}
if (errors.length) {
  console.error('PEER REVIEW FAILED:\n  - ' + errors.join('\n  - '));
  process.exit(1);
}

// -----------------------------------------------------------------------------
// 3. SQL OUTPUT
// -----------------------------------------------------------------------------
const SIMPLE_TYPE = { string: 'VARCHAR(255)', int: 'INT', float: 'NUMERIC', boolean: 'BOOLEAN', timestamp: 'TIMESTAMP', object: 'JSON', array: 'JSON' };
const LONG_TEXT = /(64|DataUrl|description|summary|caseSummary)$/i;
const refType = (t, c) => (t === 'string' && LONG_TEXT.test(c) ? 'TEXT' : SIMPLE_TYPE[t] || 'VARCHAR(255)');

const JUNCTION = {
  name: 'documentLabelAssignments',
  note: 'Normalizes the documents.labels[] array (M:N documents <-> documentLabels).',
};

// 3a. Draw.io-friendly: one column per line, no comments, no defaults, no ALTER TABLE.
let drawioSql = '';
for (const t of combined.tables) {
  const lines = t.columns.map((c) => `  ${c.name} ${SIMPLE_TYPE[c.type] || 'VARCHAR(255)'}`);
  const pk = t.columns.filter((c) => c.pk).map((c) => c.name);
  lines.push(`  PRIMARY KEY (${pk.join(', ')})`);
  for (const e of edges.filter((x) => x.from === t.name && x.rel !== '<>')) {
    lines.push(`  FOREIGN KEY (${e.fromCol}) REFERENCES ${e.to}(${e.toCol})`);
  }
  drawioSql += `CREATE TABLE ${t.name} (\n${lines.join(',\n')}\n);\n\n`;
}
drawioSql += `CREATE TABLE ${JUNCTION.name} (\n  documentId VARCHAR(255),\n  labelSlug VARCHAR(255),\n  PRIMARY KEY (documentId, labelSlug),\n  FOREIGN KEY (documentId) REFERENCES documents(id),\n  FOREIGN KEY (labelSlug) REFERENCES documentLabels(slug)\n);\n`;

// 3b. Annotated PostgreSQL reference DDL.
const q = (s) => `"${s}"`;
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
function sqlDefault(c) {
  if (c.default === undefined) return '';
  if (c.type === 'boolean') return ` DEFAULT ${String(c.default).toUpperCase()}`;
  if (c.type === 'int' || c.type === 'float') return ` DEFAULT ${Number(c.default)}`;
  return ` DEFAULT ${sqlStr(c.default)}`;
}
const sectionOf = (name) => byName.get(name)?.section || '';
let refSql = `-- =============================================================================
-- CTU-Daanbantayan SSG Office Assistant - Logical Relational Model (PostgreSQL)
-- Generated by scripts/export-erd-sql-drawio.mjs from Obsidian DB Atlas
-- (db-atlas/00-all-entities-combined). DO NOT EDIT BY HAND.
--
-- The production system runs on Cloud Firestore + MongoDB GridFS (NoSQL).
-- This DDL is a relational representation of the same logical schema for
-- documentation and diagramming. Foreign keys marked LOGICAL are nested paths,
-- arrays, polymorphic, business-key or cross-datastore references that the
-- source datastores cannot enforce as strict constraints.
--
-- Entities: ${combined.tables.length} live + 1 junction | Relationships: ${edges.length}
-- =============================================================================\n\n`;
let currentSection = '';
for (const t of combined.tables) {
  if (t.section !== currentSection) {
    currentSection = t.section;
    refSql += `-- -----------------------------------------------------------------------------\n-- SECTION ${currentSection}\n-- -----------------------------------------------------------------------------\n\n`;
  }
  const lines = t.columns.map((c) => {
    let l = `  ${q(c.name)} ${refType(c.type, c.name)}`;
    if (c.notNull || c.pk) l += ' NOT NULL';
    if (c.unique && !c.pk) l += ' UNIQUE';
    l += sqlDefault(c);
    return l;
  });
  lines.push(`  CONSTRAINT ${q(`pk_${t.name}`)} PRIMARY KEY (${t.columns.filter((c) => c.pk).map((c) => q(c.name)).join(', ')})`);
  refSql += `CREATE TABLE ${q(t.name)} (\n${lines.join(',\n')}\n);\n`;
  refSql += `COMMENT ON TABLE ${q(t.name)} IS ${sqlStr(t.description)};\n\n`;
}
refSql += `CREATE TABLE ${q(JUNCTION.name)} (\n  "documentId" VARCHAR(255) NOT NULL,\n  "labelSlug" VARCHAR(255) NOT NULL,\n  CONSTRAINT "pk_documentLabelAssignments" PRIMARY KEY ("documentId", "labelSlug")\n);\nCOMMENT ON TABLE ${q(JUNCTION.name)} IS ${sqlStr(JUNCTION.note)};\n\n`;
refSql += `-- =============================================================================\n-- FOREIGN KEYS (added after all tables to support circular references)\n-- =============================================================================\n\n`;
for (const e of edges) {
  const card = e.rel === '-' ? '1:1' : e.rel === '<>' ? 'M:N' : 'N:1';
  refSql += `-- [${card}] [${e.review.enf}] ${e.review.ev}${e.review.note ? ` | ${e.review.note}` : ''}\n`;
  if (e.rel === '<>') {
    refSql += `ALTER TABLE "documentLabelAssignments" ADD CONSTRAINT "fk_dla_document" FOREIGN KEY ("documentId") REFERENCES "documents" ("id");\n`;
    refSql += `ALTER TABLE "documentLabelAssignments" ADD CONSTRAINT "fk_dla_label" FOREIGN KEY ("labelSlug") REFERENCES "documentLabels" ("slug");\n\n`;
  } else {
    refSql += `ALTER TABLE ${q(e.from)} ADD CONSTRAINT ${q(`fk_${e.from}_${e.fromCol}`)} FOREIGN KEY (${q(e.fromCol)}) REFERENCES ${q(e.to)} (${q(e.toCol)});\n\n`;
  }
}

// -----------------------------------------------------------------------------
// 4. PEER REVIEW REPORT
// -----------------------------------------------------------------------------
const enfCount = edges.reduce((a, e) => ((a[e.review.enf] = (a[e.review.enf] || 0) + 1), a), {});
const relCount = edges.reduce((a, e) => ((a[e.rel] = (a[e.rel] || 0) + 1), a), {});
const crossDomain = edges.filter((e) => sectionOf(e.from) !== sectionOf(e.to)).length;
let md = `# ERD Relationship Peer Review

> Generated by \`scripts/export-erd-sql-drawio.mjs\` from the DB Atlas combined ERD. Do not edit by hand.

| Metric | Value |
| :--- | :--- |
| Live entities | ${combined.tables.length} (+1 SQL junction table \`documentLabelAssignments\`) |
| Relationships | ${edges.length} (${crossDomain} cross-domain, ${edges.length - crossDomain} intra-domain) |
| Cardinality | N:1 = ${relCount['>'] || 0}, 1:1 = ${relCount['-'] || 0}, M:N = ${relCount['<>'] || 0} |
| Enforcement | RULES = ${enfCount.RULES || 0}, SERVICE = ${enfCount.SERVICE || 0}, LOGICAL = ${enfCount.LOGICAL || 0} |

**Automated checks passed:** every FK target exists and is a PK or UNIQUE column; every 1:1 FK column is UNIQUE; FK and target types match; every relationship has a review entry with source evidence; every section-page relationship exists in the combined ERD.

**Enforcement legend:** RULES = checked by \`firestore.rules\` · SERVICE = written by the service layer only · LOGICAL = nested, array, polymorphic, business-key, or cross-datastore reference (dashed line in Draw.io).

| # | From | To | Card. | FK Required | Enforcement | Evidence | Review Note |
| :-: | :--- | :--- | :-: | :-: | :-: | :--- | :--- |
`;
edges.forEach((e, i) => {
  const card = e.rel === '-' ? '1:1' : e.rel === '<>' ? 'M:N' : 'N:1';
  md += `| ${i + 1} | \`${e.from}.${e.fromCol}\` | \`${e.to}.${e.toCol}\` | ${card} | ${e.notNull ? 'Yes' : 'No'} | ${e.review.enf} | ${e.review.ev} | ${e.review.note || '—'} |\n`;
});

// -----------------------------------------------------------------------------
// 5. NATIVE DRAW.IO DIAGRAM
// -----------------------------------------------------------------------------
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const html = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const W = 360;
const HEADER = 30;
const ROW = 22;

function rowLabel(c, isFk) {
  const badge = c.pk && isFk ? 'PK,FK' : c.pk ? 'PK' : isFk ? 'FK' : c.unique ? 'UQ' : '';
  const name = c.name.padEnd(29, ' ');
  const text = `${badge.padEnd(6, ' ')}${name}${c.type}${c.notNull && !c.pk ? ' *' : ''}`;
  return html(text).replace(/ /g, '&nbsp;');
}
function arrows(e) {
  const parentEnd = e.notNull ? 'ERmandOne' : 'ERzeroToOne';
  if (e.rel === '-') return { start: 'ERzeroToOne', end: parentEnd };
  if (e.rel === '<>') return { start: 'ERzeroToMany', end: 'ERzeroToMany' };
  return { start: 'ERzeroToMany', end: parentEnd };
}

function buildPage(page, pIdx) {
  const cells = [];
  const pre = `p${pIdx}`;
  const rowIds = new Map();
  const pageEdgeKeys = new Set();
  for (const t of page.tables) for (const c of t.columns) if (c.ref) pageEdgeKeys.add(`${t.name}.${c.name}`);
  const fkCols = new Set([...pageEdgeKeys]);

  let maxX = 0;
  for (const t of page.tables) {
    const tid = `${pre}-t-${t.name}`;
    const h = HEADER + t.columns.length * ROW;
    maxX = Math.max(maxX, t.x + W);
    const style = `swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=${HEADER};horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;html=1;rounded=1;arcSize=3;fontSize=13;fillColor=${t.color};strokeColor=${t.color};fontColor=#FFFFFF;swimlaneFillColor=#FFFFFF;`;
    cells.push(`<mxCell id="${tid}" value="${xml(t.name)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${t.x}" y="${t.y}" width="${W}" height="${h}" as="geometry"/></mxCell>`);
    t.columns.forEach((c, i) => {
      const rid = `${tid}-${c.name}`;
      rowIds.set(`${t.name}.${c.name}`, rid);
      const isFk = fkCols.has(`${t.name}.${c.name}`);
      const fontStyle = c.pk ? 5 : isFk ? 2 : 0;
      const rstyle = `text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=8;spacingRight=4;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;html=1;fontSize=11;fontFamily=Courier New;fontColor=#1F2937;fontStyle=${fontStyle};`;
      cells.push(`<mxCell id="${rid}" value="${xml(rowLabel(c, isFk))}" style="${rstyle}" vertex="1" parent="${tid}"><mxGeometry y="${HEADER + i * ROW}" width="${W}" height="${ROW}" as="geometry"/></mxCell>`);
    });
  }

  let eIdx = 0;
  for (const t of page.tables) {
    for (const c of t.columns) {
      if (!c.ref) continue;
      const e = edges.find((x) => x.key === `${t.name}.${c.name}`);
      const { start, end } = arrows(e);
      const dashed = e.review.enf === 'LOGICAL' ? 'dashed=1;dashPattern=6 4;' : '';
      const style = `edgeStyle=entityRelationEdgeStyle;html=1;rounded=0;startArrow=${start};endArrow=${end};startFill=0;endFill=0;strokeWidth=1.5;strokeColor=${t.color};${dashed}`;
      const src = rowIds.get(`${t.name}.${c.name}`);
      const tgt = rowIds.get(c.ref);
      if (!src || !tgt) throw new Error(`Unresolved edge on ${page.folder}: ${t.name}.${c.name} -> ${c.ref}`);
      cells.push(`<mxCell id="${pre}-e-${eIdx++}" style="${style}" edge="1" parent="1" source="${src}" target="${tgt}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
    }
  }

  // Title and legend
  cells.push(`<mxCell id="${pre}-title" value="${xml(`<b>${html(page.title)}</b><br><font style=&quot;font-size:12px&quot;>CTU-Daanbantayan SSG Office Assistant · ${page.tables.length} tables · ${eIdx} relationships · source: Obsidian DB Atlas</font>`)}" style="text;html=1;fontSize=22;align=left;verticalAlign=top;fontColor=#111827;" vertex="1" parent="1"><mxGeometry x="40" y="-100" width="1400" height="70" as="geometry"/></mxCell>`);
  const lx = maxX + 120;
  let ly = 40;
  cells.push(`<mxCell id="${pre}-lg-h" value="Legend" style="text;html=1;fontSize=16;fontStyle=1;align=left;" vertex="1" parent="1"><mxGeometry x="${lx}" y="${ly}" width="320" height="30" as="geometry"/></mxCell>`);
  ly += 36;
  SECTION_LEGEND.forEach(([color, label], i) => {
    cells.push(`<mxCell id="${pre}-lg-s${i}" value="${xml(label)}" style="rounded=1;arcSize=10;html=1;fillColor=${color};strokeColor=${color};fontColor=#FFFFFF;fontStyle=1;fontSize=12;align=left;spacingLeft=10;" vertex="1" parent="1"><mxGeometry x="${lx}" y="${ly}" width="320" height="28" as="geometry"/></mxCell>`);
    ly += 34;
  });
  const notes = [
    'PK = primary key (bold underline) · FK = foreign key (italic) · UQ = unique · * = required',
    'Solid line = enforced FK (firestore.rules or service layer)',
    'Dashed line = logical reference (nested path, array, polymorphic, business key, or cross-datastore)',
    "Crow's foot = many · single bar = exactly one · circle = optional (zero)",
    'Line color = color of the table that holds the foreign key',
  ];
  notes.forEach((n, i) => {
    cells.push(`<mxCell id="${pre}-lg-n${i}" value="${xml(n)}" style="text;html=1;whiteSpace=wrap;fontSize=11;align=left;verticalAlign=top;fontColor=#374151;" vertex="1" parent="1"><mxGeometry x="${lx}" y="${ly + 6}" width="320" height="34" as="geometry"/></mxCell>`);
    ly += 38;
  });

  return `  <diagram id="${pre}" name="${xml(page.title)}">\n    <mxGraphModel dx="1600" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n        ${cells.join('\n        ')}\n      </root>\n    </mxGraphModel>\n  </diagram>`;
}

const drawio = `<mxfile host="app.diagrams.net" agent="export-erd-sql-drawio.mjs" version="24.0.0">\n${pages.map(buildPage).join('\n')}\n</mxfile>\n`;

// -----------------------------------------------------------------------------
// 6. WRITE OUTPUTS
// -----------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'ssg_erd_drawio_import.sql'), drawioSql, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'ssg_erd_reference_postgres.sql'), refSql, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'ERD_RELATIONSHIP_PEER_REVIEW.md'), md, 'utf8');
fs.writeFileSync(DRAWIO_OUT, drawio, 'utf8');

console.log(`Peer review passed: ${combined.tables.length} entities, ${edges.length} relationships (${crossDomain} cross-domain).`);
console.log(`Cardinality: N:1=${relCount['>'] || 0}, 1:1=${relCount['-'] || 0}, M:N=${relCount['<>'] || 0}`);
console.log(`Enforcement: RULES=${enfCount.RULES || 0}, SERVICE=${enfCount.SERVICE || 0}, LOGICAL=${enfCount.LOGICAL || 0}`);
console.log(`Draw.io pages: ${pages.map((p) => `${p.title} [${p.tables.length}]`).join(' | ')}`);
