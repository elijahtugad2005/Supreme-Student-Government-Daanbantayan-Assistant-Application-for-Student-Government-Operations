import fs from 'fs';
import path from 'path';

const VAULT_ROOT = path.resolve('Obsidian Documentation');
const ATLAS_ROOT = path.join(VAULT_ROOT, 'db-atlas');
const PLUGIN_DATA_PATH = path.join(VAULT_ROOT, '.obsidian', 'plugins', 'db-atlas', 'data.json');

// =============================================================================
// 5 COLOR-CODED DOMAIN SECTIONS (verified against live codebase /code-review)
// =============================================================================
const SECTION_META = {
  '01-identity-org-audit': {
    code: 'S1',
    title: 'Section 1 · Identity, Organizations & Audit',
    color: '#8B1E3F', // Royal Crimson (CTU Maroon)
    colorLabel: 'Royal Crimson (#8B1E3F)',
  },
  '02-rosters-technocares': {
    code: 'S2',
    title: 'Section 2 · Class Rosters & TechnoCares (Death Aid)',
    color: '#0F766E', // Deep Emerald Teal
    colorLabel: 'Deep Emerald Teal (#0F766E)',
  },
  '03-finance-ppmp-igp': {
    code: 'S3',
    title: 'Section 3 · Centavo Finance, PPMP & IGP',
    color: '#1D4ED8', // Executive Sapphire Blue
    colorLabel: 'Executive Sapphire (#1D4ED8)',
  },
  '04-commerce-inventory-preorders': {
    code: 'S4',
    title: 'Section 4 · Commerce, Inventory, Pre-Orders & Sync',
    color: '#B45309', // Burnished Amber Gold
    colorLabel: 'Burnished Amber Gold (#B45309)',
  },
  '05-documents-comms-campus': {
    code: 'S5',
    title: 'Section 5 · Documents, GridFS/Drive, AI, Comms & Campus',
    color: '#6D28D9', // Imperial Violet Purple
    colorLabel: 'Imperial Violet (#6D28D9)',
  },
};

const COMBINED_FOLDER = '00-all-entities-combined';
const COMBINED_TITLE = 'Master Combined ERD · All 32 Verified Live Entities (Color-Coded by Section)';

// =============================================================================
// CANONICAL REGISTRY OF ALL 32 VERIFIED LIVE ENTITIES
// (31 Firestore collections/subcollections + 1 MongoDB GridFS store)
// Dead/legacy rules matches intentionally excluded:
// budgets, funds, documents/{id}/signatures, documentTemplates, officials,
// approvalWorkflows, financeTransactions.
// =============================================================================
const ENTITIES = {
  // ---------------------------------------------------------------------------
  // SECTION 1: IDENTITY, ORGANIZATIONS & AUDIT (#8B1E3F)
  // ---------------------------------------------------------------------------
  users: {
    section: '01-identity-org-audit',
    techTag: 'tech/firestore',
    description: 'Authenticated accounts, 17-role RBAC assignments, permissionOverrides & Mayor links',
    columns: [
      { name: 'uid', type: 'string', pk: true, desc: 'Firebase Authentication unique user identifier.' },
      { name: 'email', type: 'string', notNull: true, unique: true, desc: 'Institutional or personal email address.' },
      { name: 'name', type: 'string', notNull: true, desc: 'User display name (AuthContext.jsx).' },
      { name: 'studentId', type: 'string', notNull: false, desc: 'Optional CTU Student ID recorded at registration.' },
      { name: 'role', type: 'string', notNull: true, default: 'member', desc: '17-role RBAC designation key (admin, president, secretary, finance_secretary, auditor, senator, governor, member, guest, etc.).' },
      { name: 'provider', type: 'string', notNull: true, default: 'email', desc: 'Auth provider: email or google.' },
      { name: 'photoURL', type: 'string', notNull: false, desc: 'Profile avatar URL.' },
      { name: 'department', type: 'string', notNull: false, desc: 'College or committee affiliation.' },
      { name: 'permissions', type: 'object', notNull: true, desc: 'Default role permission map written at provisioning.' },
      { name: 'permissionOverrides', type: 'object', notNull: false, desc: 'Sparse Admin/President overrides across 16 ALL_PERMISSION_KEYS.' },
      { name: 'mayorOf_rosterId', type: 'string', notNull: false, ref: 'classRosters.id', rel: '>', desc: 'Nested path `mayorOf.rosterId`: active ClassRoster submitted by this Mayor account.' },
      { name: 'isActive', type: 'boolean', notNull: true, default: 'true', desc: 'Active account state (false when suspended).' },
      { name: 'isEmailVerified', type: 'boolean', notNull: false, default: 'false', desc: 'Email verification status flag.' },
      { name: 'deletedBy', type: 'string', notNull: false, ref: 'users.uid', rel: '>', desc: 'Admin UID who deactivated/soft-deleted this account.' },
      { name: 'createdAt', type: 'timestamp', notNull: true, desc: 'Account creation timestamp.' },
      { name: 'lastLoginAt', type: 'timestamp', notNull: false, desc: 'Most recent authenticated session timestamp.' },
    ],
  },
  organizations: {
    section: '01-identity-org-audit',
    techTag: 'tech/firestore',
    description: 'SSG and recognized campus student organizations with termConfigs and section rosters',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Organization document ID (`ssg` or auto-generated).' },
      { name: 'name', type: 'string', notNull: true, desc: 'Official organization display name.' },
      { name: 'type', type: 'string', notNull: true, default: 'custom', desc: 'Organization type: `ssg` or `custom`.' },
      { name: 'description', type: 'string', notNull: false, desc: 'Organization mandate or summary.' },
      { name: 'logo64', type: 'string', notNull: false, desc: 'Base64-encoded organization emblem.' },
      { name: 'sections', type: 'array', notNull: false, desc: 'Configured officer committee/section groups.' },
      { name: 'termConfigs', type: 'object', notNull: false, desc: 'Per-term visual/structural configuration map.' },
      { name: 'createdAt', type: 'timestamp', notNull: true, desc: 'Organization creation timestamp.' },
    ],
  },
  members: {
    section: '01-identity-org-audit',
    techTag: 'tech/firestore',
    description: 'Officer directory profiles scoped by organization and academic term',
    columns: [
      { name: 'docId', type: 'string', pk: true, desc: 'Firestore document ID for the officer profile.' },
      { name: 'id', type: 'string', notNull: false, desc: 'Student/officer institutional ID string.' },
      { name: 'orgId', type: 'string', notNull: true, ref: 'organizations.id', rel: '>', desc: 'Parent campus organization document ID.' },
      { name: 'term', type: 'string', notNull: true, ref: 'terms.id', rel: '>', desc: 'Academic term ID (e.g., `2025-2026`).' },
      { name: 'name', type: 'string', notNull: true, desc: 'Officer full name.' },
      { name: 'position', type: 'string', notNull: true, desc: 'Official position title (President, Senator, Governor, Secretary, etc.).' },
      { name: 'sectionKey', type: 'string', notNull: false, desc: 'Officer directory section grouping key.' },
      { name: 'image64', type: 'string', notNull: false, desc: 'Base64-encoded official portrait.' },
      { name: 'status', type: 'string', notNull: true, default: 'Active', desc: 'Officer directory status (`Active`).' },
      { name: 'createdAt', type: 'timestamp', notNull: true, desc: 'Record creation timestamp.' },
    ],
  },
  terms: {
    section: '01-identity-org-audit',
    techTag: 'tech/firestore',
    description: 'Academic and SSG governance terms (active term tracked via settings/app.currentTerm)',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Academic term identifier matching label (e.g., `2025-2026`).' },
      { name: 'label', type: 'string', notNull: true, unique: true, desc: 'Human-readable academic term label.' },
      { name: 'createdAt', type: 'timestamp', notNull: true, desc: 'Term creation timestamp.' },
    ],
  },
  audit_logs: {
    section: '01-identity-org-audit',
    techTag: 'tech/firestore',
    description: 'Append-only institutional security and operations audit trail (3-letter security codes)',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique audit log document ID.' },
      { name: 'action', type: 'string', notNull: true, desc: '3-letter security code (AAD, ADL, BUP, DAD, IAD, ROL, etc.) or action label.' },
      { name: 'module', type: 'string', notNull: true, desc: 'Functional domain: Finance, Announcements, Inventory, Documents, Commerce, User Mgt.' },
      { name: 'performedBy', type: 'string', notNull: true, desc: 'Display name of initiating officer.' },
      { name: 'userId', type: 'string', notNull: false, ref: 'users.uid', rel: '>', desc: 'Initiating user UID (written by userManagementService).' },
      { name: 'targetUserId', type: 'string', notNull: false, ref: 'users.uid', rel: '>', desc: 'Target user UID for RBAC/account mutations.' },
      { name: 'itemType', type: 'string', notNull: false, desc: 'Affected resource entity category.' },
      { name: 'itemId', type: 'string', notNull: false, desc: 'Affected resource identifier.' },
      { name: 'itemName', type: 'string', notNull: true, desc: 'Affected resource title or reference.' },
      { name: 'summary', type: 'string', notNull: false, desc: 'Human-readable differential action summary.' },
      { name: 'changes', type: 'object', notNull: false, desc: 'Structured diff / metadata payload.' },
      { name: 'timestamp', type: 'timestamp', notNull: true, desc: 'Immutable server timestamp.' },
    ],
  },

  // ---------------------------------------------------------------------------
  // SECTION 2: CLASS ROSTERS & TECHNOCARES (DEATH AID) (#0F766E)
  // ---------------------------------------------------------------------------
  classSections: {
    section: '02-rosters-technocares',
    techTag: 'tech/firestore',
    description: 'Authoritative registry of verified academic sections pointing 1:1 to their active ClassRoster',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Normalized section document ID (`sectionDocId(sectionKey)`).' },
      { name: 'sectionKey', type: 'string', notNull: true, unique: true, desc: 'Canonical composite section key (e.g., `CoTE_BSIT_3A`).' },
      { name: 'college', type: 'string', notNull: true, desc: 'College affiliation.' },
      { name: 'program', type: 'string', notNull: true, desc: 'Degree program title.' },
      { name: 'section', type: 'string', notNull: true, desc: 'Section display label.' },
      { name: 'yearLevel', type: 'int', notNull: true, desc: 'Academic year level (1-4).' },
      { name: 'mayorName', type: 'string', notNull: false, desc: 'Verified Class Mayor display name.' },
      { name: 'currentRosterId', type: 'string', notNull: true, unique: true, ref: 'classRosters.id', rel: '-', desc: '1:1 pointer to the active verified ClassRoster baseline.' },
      { name: 'status', type: 'string', notNull: true, default: 'verified', desc: 'Section registry verification state.' },
      { name: 'updatedAt', type: 'timestamp', notNull: true, desc: 'Last verification timestamp.' },
    ],
  },
  classRosters: {
    section: '02-rosters-technocares',
    techTag: 'tech/firestore',
    description: 'Versioned class student rosters submitted by signed-in non-guest Mayors and verified by Secretariats',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique roster submission document ID.' },
      { name: 'sectionKey', type: 'string', notNull: true, ref: 'classSections.sectionKey', rel: '>', desc: 'Logical section key grouping roster versions under `classSections`.' },
      { name: 'college', type: 'string', notNull: true, desc: 'College affiliation.' },
      { name: 'program', type: 'string', notNull: true, desc: 'Degree program.' },
      { name: 'section', type: 'string', notNull: true, desc: 'Section label (e.g., `BSIT - 1A`).' },
      { name: 'yearLevel', type: 'int', notNull: true, desc: 'Academic year level.' },
      { name: 'studentCount', type: 'int', notNull: true, desc: 'Exact count matching `students.length` (enforced by firestore.rules).' },
      { name: 'students', type: 'array', notNull: true, desc: 'Validated student entries parsed by RosterParser.' },
      { name: 'status', type: 'string', notNull: true, default: 'pending', desc: 'Lifecycle state: `pending`, `verified`, or `correction_requested`.' },
      { name: 'isCurrent', type: 'boolean', notNull: true, default: 'false', desc: 'True for the active verified baseline version.' },
      { name: 'version', type: 'int', notNull: false, desc: 'Monotonic version assigned upon verification.' },
      { name: 'hasTransfers', type: 'boolean', notNull: false, default: 'false', desc: 'Flags transfer amendment awaiting re-verification.' },
      { name: 'mayorUid', type: 'string', notNull: true, ref: 'users.uid', rel: '>', desc: 'Authenticated non-guest Mayor UID owning this submission.' },
      { name: 'mayorName', type: 'string', notNull: false, desc: 'Submitting Mayor display name.' },
      { name: 'verifiedBy', type: 'string', notNull: false, desc: 'Verifying officer display name.' },
      { name: 'submittedAt', type: 'timestamp', notNull: true, desc: 'Submission server timestamp.' },
    ],
  },
  deathAidBeneficiaries: {
    section: '02-rosters-technocares',
    techTag: 'tech/firestore',
    description: 'Officer-published Death Aid and TechnoCare beneficiary drives backed by memorandum proofs',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Beneficiary case document ID (`BEN-YYYY-XXXX-RRR`).' },
      { name: 'beneficiaryId', type: 'string', notNull: true, unique: true, desc: 'Human-readable case code (`BEN-YYYY-XXXX`).' },
      { name: 'aidType', type: 'string', notNull: true, desc: 'Program category: `death_aid` or `technocare`.' },
      { name: 'studentName', type: 'string', notNull: true, desc: 'Beneficiary student full name.' },
      { name: 'studentProgramSection', type: 'string', notNull: false, desc: 'Beneficiary program and section.' },
      { name: 'affectedPersonName', type: 'string', notNull: true, desc: 'Affected student or family member name.' },
      { name: 'memoReference', type: 'string', notNull: false, desc: 'Official SSG memorandum reference number (deathAidService.js).' },
      { name: 'defaultContribution', type: 'float', notNull: true, default: '1', desc: 'Suggested per-student contribution in PHP.' },
      { name: 'memoPhotoDataUrl', type: 'string', notNull: true, desc: 'Uploaded memorandum photo proof.' },
      { name: 'status', type: 'string', notNull: true, default: 'open', desc: 'Drive state: `open` or `closed`.' },
      { name: 'createdByUid', type: 'string', notNull: true, ref: 'users.uid', rel: '>', desc: 'Publishing officer UID.' },
      { name: 'createdAt', type: 'timestamp', notNull: true, desc: 'Creation timestamp.' },
    ],
  },
  deathAidCollections: {
    section: '02-rosters-technocares',
    techTag: 'tech/firestore',
    description: 'Per-section TechnoCares/Death Aid filings cross-checked against verified roster headcounts',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Sequential collection ID (`DA-YYYY-0001`).' },
      { name: 'collectionId', type: 'string', notNull: true, unique: true, desc: 'Formatted collection tracking code.' },
      { name: 'rosterId', type: 'string', notNull: true, ref: 'classRosters.id', rel: '>', desc: 'Verified ClassRoster providing locked enrolledCount (rules-enforced).' },
      { name: 'sectionKey', type: 'string', notNull: true, ref: 'classSections.sectionKey', rel: '>', desc: 'Logical section key linking collection to its academic section.' },
      { name: 'beneficiaryCaseId', type: 'string', notNull: false, ref: 'deathAidBeneficiaries.id', rel: '>', desc: 'Optional link to open beneficiary drive (rules-enforced).' },
      { name: 'enrolledCount', type: 'int', notNull: true, desc: 'Must equal `roster.studentCount` (enforced by firestore.rules).' },
      { name: 'beneficiaryCount', type: 'int', notNull: true, desc: 'Number of paying students.' },
      { name: 'contributionPerStudent', type: 'float', notNull: true, desc: 'Per-student contribution amount in PHP.' },
      { name: 'collectedAmount', type: 'float', notNull: true, desc: '`beneficiaryCount * contributionPerStudent`.' },
      { name: 'expectedCollection', type: 'float', notNull: true, desc: '`enrolledCount * contributionPerStudent`.' },
      { name: 'debtCount', type: 'int', notNull: true, desc: '`enrolledCount - beneficiaryCount`.' },
      { name: 'debtAmount', type: 'float', notNull: true, desc: '`debtCount * contributionPerStudent`.' },
      { name: 'debtRecords', type: 'array', notNull: true, desc: 'Itemized unpaid/absent student records.' },
      { name: 'status', type: 'string', notNull: true, default: 'for_verification', desc: '`for_verification`, `confirmed`, `discrepancy`, or `denied`.' },
      { name: 'recordedByUid', type: 'string', notNull: true, ref: 'users.uid', rel: '>', desc: 'Authenticated non-guest submitter UID (also tracks `mayorUid`, `confirmedByUid`, `deniedByUid`).' },
      { name: 'submittedAt', type: 'timestamp', notNull: true, desc: 'Filing timestamp.' },
    ],
  },
  deathAidRemittances: {
    section: '02-rosters-technocares',
    techTag: 'tech/firestore',
    description: '1:1 physical cash certification records enforcing separation of duties (receivedByUid != recordedByUid)',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Remittance ID identical to `collectionId` (1:1).' },
      { name: 'collectionId', type: 'string', notNull: true, unique: true, ref: 'deathAidCollections.id', rel: '-', desc: '1:1 parent Death Aid collection being verified.' },
      { name: 'sectionKey', type: 'string', notNull: false, desc: 'Denormalized section key snapshot.' },
      { name: 'reportedAmount', type: 'float', notNull: true, desc: 'Reported cash amount from collection.' },
      { name: 'amountReceived', type: 'float', notNull: true, desc: 'Physical cash counted by verifying officer.' },
      { name: 'difference', type: 'float', notNull: true, default: '0', desc: '`amountReceived - reportedAmount` variance.' },
      { name: 'status', type: 'string', notNull: true, desc: '`confirmed` (`difference == 0`), `discrepancy`, or `resolved`.' },
      { name: 'receivedByUid', type: 'string', notNull: true, ref: 'users.uid', rel: '>', desc: 'Verifying officer UID (rules enforce `!= recordedByUid`; also tracks `discrepancyNotedByUid`).' },
      { name: 'receivedAt', type: 'timestamp', notNull: true, desc: 'Verification timestamp.' },
    ],
  },
  deathAidAuditLog: {
    section: '02-rosters-technocares',
    techTag: 'tech/firestore',
    description: 'Append-only TechnoCares/Death Aid lifecycle audit log (field `at`, polymorphic collection/case target)',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Audit log document ID.' },
      { name: 'collectionId', type: 'string', notNull: true, ref: 'deathAidCollections.id', rel: '>', desc: 'Target collection ID (polymorphically also records beneficiary case IDs).' },
      { name: 'action', type: 'string', notNull: true, desc: 'Event code: `collection_recorded`, `remittance_confirmed`, `discrepancy_resolved`, etc.' },
      { name: 'actorUid', type: 'string', notNull: true, ref: 'users.uid', rel: '>', desc: 'Authenticated non-guest actor UID (rules-enforced).' },
      { name: 'actorName', type: 'string', notNull: false, desc: 'Actor display name snapshot.' },
      { name: 'actorRole', type: 'string', notNull: true, desc: 'Actor role snapshot.' },
      { name: 'at', type: 'timestamp', notNull: true, desc: 'Immutable server timestamp (`at` in deathAidService.js).' },
    ],
  },
  deathAidCounters: {
    section: '02-rosters-technocares',
    techTag: 'tech/firestore',
    description: 'Strictly monotonic (+1) yearly sequence counter allocating DA-YYYY-0001 IDs',
    columns: [
      { name: 'year', type: 'int', pk: true, desc: 'Calendar year document ID (e.g., `2026`).' },
      { name: 'count', type: 'int', notNull: true, default: '1', desc: 'Current allocated count (rules enforce `count == prev + 1`).' },
      { name: 'updatedAt', type: 'timestamp', notNull: true, desc: 'Last increment timestamp.' },
    ],
  },

  // ---------------------------------------------------------------------------
  // SECTION 3: CENTAVO FINANCE, PPMP & IGP (#1D4ED8)
  // ---------------------------------------------------------------------------
  fundAccounts: {
    section: '03-finance-ppmp-igp',
    techTag: 'tech/firestore',
    description: 'Four segregated centavo-accurate fund pools (Fiscal Year Budget, FSG Remittance, IGF, IGP)',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Canonical ID (`fund_fiscal_year_budget`, `fund_fsg_remittance`, `fund_igf_main`, `fund_igp_main`).' },
      { name: 'displayName', type: 'string', notNull: true, desc: 'Official fund label.' },
      { name: 'topLevelCategory', type: 'string', notNull: true, desc: '`FISCAL_YEAR_BUDGET`, `FSG_REMITTANCE`, `IGF`, or `IGP`.' },
      { name: 'balanceCentavos', type: 'int', notNull: true, default: '0', desc: 'Integer-centavo fund balance (`1 PHP = 100 centavos`).' },
      { name: 'appropriatedCeilingCentavos', type: 'int', notNull: false, default: '0', desc: 'Annual legislative budget ceiling in centavos.' },
      { name: 'holdingType', type: 'string', notNull: true, desc: '`bank` (BDO Institutional) or `cash` (Treasury Safe / Lockbox).' },
      { name: 'bankAccountReference', type: 'string', notNull: true, desc: 'Account or physical custody reference.' },
      { name: 'fiscalYear', type: 'int', notNull: true, desc: 'Academic fiscal year.' },
      { name: 'status', type: 'string', notNull: false, default: 'active', desc: 'Account lifecycle state.' },
      { name: 'createdById', type: 'string', notNull: false, ref: 'users.uid', rel: '>', desc: 'Initializing officer UID (also tracks `updatedById`).' },
      { name: 'updatedAt', type: 'timestamp', notNull: true, desc: 'Last reconciliation timestamp.' },
    ],
  },
  budgetAllocations: {
    section: '03-finance-ppmp-igp',
    techTag: 'tech/firestore',
    description: 'Resolution-backed PPMP event, project & supply allocations with embedded approvedLineItems',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Allocation document ID.' },
      { name: 'fundAccountId', type: 'string', notNull: true, ref: 'fundAccounts.id', rel: '>', desc: 'Parent fund account (Fiscal Year Budget or FSG Remittance).' },
      { name: 'resolutionDocumentId', type: 'string', notNull: false, ref: 'documents.id', rel: '>', desc: 'Cross-domain FK to legislative approval document in `documents`.' },
      { name: 'activityName', type: 'string', notNull: true, desc: 'Approved event or project title.' },
      { name: 'procurementType', type: 'string', notNull: true, desc: '`EVENT`, `PROJECT`, or `MATERIAL_SUPPLY`.' },
      { name: 'committee', type: 'string', notNull: true, desc: 'Responsible SSG committee.' },
      { name: 'fiscalYear', type: 'int', notNull: true, desc: 'Target fiscal year integer.' },
      { name: 'approvedAmountCentavos', type: 'int', notNull: true, default: '0', desc: 'Allocated ceiling in centavos.' },
      { name: 'committedAmountCentavos', type: 'int', notNull: false, default: '0', desc: 'Encumbered amount in centavos.' },
      { name: 'spentAmountCentavos', type: 'int', notNull: true, default: '0', desc: 'Liquidated spend in centavos.' },
      { name: 'resolutionRef', type: 'string', notNull: false, desc: 'Human-readable legislative resolution number.' },
      { name: 'approvedLineItems', type: 'array', notNull: true, desc: 'Composed PPMP line items (`id`, `name`, `qty`, `unitCostCentavos`, `spentCentavos`).' },
      { name: 'revisionHistory', type: 'array', notNull: true, desc: 'Append-only amendment audit history.' },
      { name: 'status', type: 'string', notNull: true, default: 'approved', desc: '`draft`, `approved`, or `archived`.' },
      { name: 'approvedById', type: 'string', notNull: false, ref: 'users.uid', rel: '>', desc: 'Approving officer UID (also tracks `updatedById`, `archivedById`, `restoredById`).' },
    ],
  },
  transactions: {
    section: '03-finance-ppmp-igp',
    techTag: 'tech/firestore',
    description: 'Append-only centavo financial ledger linking fund pools, PPMP, Orders, Pre-Orders & GridFS receipts',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Transaction document ID.' },
      { name: 'refNumber', type: 'string', notNull: true, unique: true, desc: 'Unique ref (`TXN-...`, `REV-...`, `IGF-ORD-...`, `INV-EXP-IGF-...`).' },
      { name: 'fundAccountId', type: 'string', notNull: true, ref: 'fundAccounts.id', rel: '>', desc: 'Primary debited/credited fund account.' },
      { name: 'transferDestinationAccountId', type: 'string', notNull: false, ref: 'fundAccounts.id', rel: '>', desc: 'Destination fund account for internal transfers.' },
      { name: 'budgetAllocationId', type: 'string', notNull: false, ref: 'budgetAllocations.id', rel: '>', desc: 'Optional PPMP allocation liquidated by this expense.' },
      { name: 'reversalOfTransactionId', type: 'string', notNull: false, unique: true, ref: 'transactions.id', rel: '-', desc: '1:1 self-referential link to original posted transaction being reversed (`financeService.js:913`).' },
      { name: 'orderDocId', type: 'string', notNull: false, ref: 'orders.id', rel: '>', desc: 'Cross-domain FK to merchandise order for IGF sales sync.' },
      { name: 'batchId', type: 'string', notNull: false, ref: 'preOrderBatches.id', rel: '>', desc: 'Cross-domain FK to pre-order batch (`financeService.js:1093`).' },
      { name: 'preOrderEntryId', type: 'string', notNull: false, ref: 'preOrderEntries.id', rel: '>', desc: 'Cross-domain FK to student pre-order entry (`financeService.js:1094`).' },
      { name: 'receiptFileId', type: 'string', notNull: false, ref: 'gridfs_files._id', rel: '>', desc: 'Cross-domain FK to GridFS uploaded receipt file (`FundGovernance.jsx:1334`).' },
      { name: 'transactionType', type: 'string', notNull: true, desc: '`collection`, `expense`, `payment`, `refund`, `transfer`, `reversal`, or `adjustment`.' },
      { name: 'amountCentavos', type: 'int', notNull: true, desc: 'Immutable integer centavo value.' },
      { name: 'source', type: 'string', notNull: true, desc: 'Origin tag (`MERCHANDISE_ORDER`, `INVENTORY_CONSUMABLE_EXPENSE`, `PPMP_DISBURSEMENT`, etc.).' },
      { name: 'status', type: 'string', notNull: true, default: 'posted', desc: '`draft`, `pending_approval`, `posted`, or `reversed`.' },
      { name: 'createdById', type: 'string', notNull: true, ref: 'users.uid', rel: '>', desc: 'Posting officer UID (also tracks `custodianUserId`).' },
      { name: 'postedAt', type: 'timestamp', notNull: true, desc: 'Official ledger posting timestamp.' },
    ],
  },
  lockers: {
    section: '03-finance-ppmp-igp',
    techTag: 'tech/firestore',
    description: '30 dynamically priced Campus Locker units (15 HM Building, 15 Education Building)',
    columns: [
      { name: 'lockerId', type: 'string', pk: true, desc: 'Locker unit document ID (`HM-L01..15` or `ED-L01..15`).' },
      { name: 'unitNumber', type: 'int', notNull: true, desc: 'Numeric locker slot index (1-15).' },
      { name: 'buildingId', type: 'string', notNull: true, desc: 'Building code (`HM` or `ED`).' },
      { name: 'buildingName', type: 'string', notNull: true, desc: 'Building display name (`HM Building` or `Education Building`).' },
      { name: 'monthlyRatePHP', type: 'float', notNull: true, default: '100', desc: 'Configurable monthly rental rate in PHP.' },
      { name: 'status', type: 'string', notNull: true, default: 'AVAILABLE', desc: 'UPPERCASE enum: `AVAILABLE`, `OCCUPIED`, or `MAINTENANCE`.' },
      { name: 'currentLease', type: 'object', notNull: false, desc: 'Active lessee metadata (`renterName`, `studentId`, `paidAmount`, `leaseStart/End`).' },
      { name: 'history', type: 'array', notNull: false, desc: 'Rolling lease history (up to 10 recent entries).' },
      { name: 'updatedAt', type: 'timestamp', notNull: true, desc: 'Last unit update timestamp.' },
    ],
  },
  igpCollections: {
    section: '03-finance-ppmp-igp',
    techTag: 'tech/firestore',
    description: 'Income-Generating Project collections from Water Vending machines & Campus Locker leases',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'IGP collection record ID.' },
      { name: 'lockerId', type: 'string', notNull: false, ref: 'lockers.lockerId', rel: '>', desc: 'Optional locker unit reference for `LOCKER_RENTAL` collections.' },
      { name: 'fundSource', type: 'string', notNull: true, default: 'IGP', desc: 'Fund tag (`IGP`; operationally updates `fundAccounts/fund_igp_main`).' },
      { name: 'projectType', type: 'string', notNull: true, desc: '`VENDING_MACHINE`, `LOCKER_RENTAL`, or `FUTURE_IGP`.' },
      { name: 'projectName', type: 'string', notNull: false, desc: 'Project or machine label.' },
      { name: 'buildingName', type: 'string', notNull: false, desc: 'Building location.' },
      { name: 'amountCentavos', type: 'int', notNull: true, desc: 'Collected amount in integer centavos.' },
      { name: 'amountPHP', type: 'float', notNull: true, desc: 'Collected amount in PHP.' },
      { name: 'collectedBy_uid', type: 'string', notNull: true, ref: 'users.uid', rel: '>', desc: 'Nested path `collectedBy.uid`: recording officer UID (`igpProjectService.js:156`).' },
      { name: 'referenceNumber', type: 'string', notNull: false, desc: 'Receipt or collection batch reference.' },
      { name: 'collectedAt', type: 'timestamp', notNull: true, desc: 'Collection timestamp.' },
    ],
  },

  // ---------------------------------------------------------------------------
  // SECTION 4: COMMERCE, INVENTORY, PRE-ORDERS & SYNC (#B45309)
  // ---------------------------------------------------------------------------
  products: {
    section: '04-commerce-inventory-preorders',
    techTag: 'tech/firestore',
    description: 'Commerce Hub merchandise catalog synced 1:1 bidirectionally with Inventory Management',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Firestore product document ID.' },
      { name: 'productId', type: 'string', notNull: true, unique: true, desc: 'Unique SKU identifier (`PROD-...`) referenced by `orders` and `inventory`.' },
      { name: 'productName', type: 'string', notNull: true, desc: 'Catalog display name.' },
      { name: 'category', type: 'string', notNull: true, desc: 'Lanyard, Uniform, Apparel, or Office Supplies.' },
      { name: 'price', type: 'float', notNull: true, desc: 'Retail unit price in PHP.' },
      { name: 'stockAvailable', type: 'int', notNull: true, default: '0', desc: 'Available sellable units.' },
      { name: 'hasVariations', type: 'boolean', notNull: false, default: 'false', desc: 'Whether size/color variations are active.' },
      { name: 'customVariations', type: 'array', notNull: false, desc: 'Optional size/colorway variation configurations.' },
      { name: 'linkedInventoryId', type: 'string', notNull: false, unique: true, ref: 'inventory.id', rel: '-', desc: '1:1 linked warehouse asset in `inventory`.' },
      { name: 'fundSource', type: 'string', notNull: true, default: 'IGF', desc: 'Originating fund pool (`IGF`).' },
    ],
  },
  orders: {
    section: '04-commerce-inventory-preorders',
    techTag: 'tech/firestore',
    description: 'Student merchandise orders, payment refs, claim states, IGF sync & Google Sheets dedup keys',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Firestore order document ID (aliased `docId` in UI).' },
      { name: 'orderId', type: 'string', notNull: true, unique: true, desc: 'Tracking reference (`ORD-DB-XXXX` or `SSGDB-XXX`).' },
      { name: 'productInfo_productId', type: 'string', notNull: true, ref: 'products.productId', rel: '>', desc: 'Nested path `productInfo.productId`: ordered SKU referencing `products.productId` (`order.jsx:250`).' },
      { name: 'customerInfo', type: 'object', notNull: true, desc: 'Student name, ID, program, year level, address, email, phone.' },
      { name: 'productInfo', type: 'object', notNull: true, desc: 'Product title, selected size/color, unit price, quantity, total.' },
      { name: 'paymentInfo', type: 'object', notNull: true, desc: 'Cash on Claiming vs Digital E-Wallet (GCash/Maya) reference.' },
      { name: 'orderStatus', type: 'string', notNull: true, default: 'Pending', desc: '`Pending`, `Online Paid`, `Claimed`, `Returned`, or `Cancelled`.' },
      { name: 'claimed', type: 'boolean', notNull: true, default: 'false', desc: 'Fulfillment claim flag.' },
      { name: 'stockClaimDeducted', type: 'boolean', notNull: true, default: 'false', desc: 'Idempotency flag preventing double stock deduction.' },
      { name: 'igfSynced', type: 'boolean', notNull: true, default: 'false', desc: 'Marks revenue sync to `fund_igf_main`.' },
      { name: 'igfTxRef', type: 'string', notNull: false, unique: true, ref: 'transactions.refNumber', rel: '-', desc: 'Business-key 1:1 pointer to the current posted IGF collection transaction (`financeService.js:1264`).' },
      { name: 'igfAmountCentavos', type: 'int', notNull: false, default: '0', desc: 'Centavo revenue credited to `fund_igf_main`.' },
      { name: 'sheetSourceKey', type: 'string', notNull: false, desc: 'Deterministic deduplication key for centralized Google Sheets sync.' },
      { name: 'dateOrdered', type: 'timestamp', notNull: true, desc: 'Checkout timestamp.' },
    ],
  },
  inventory: {
    section: '04-commerce-inventory-preorders',
    techTag: 'tech/firestore',
    description: 'SSG physical equipment, office supplies & merchandise warehouse assets',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Inventory item document ID.' },
      { name: 'name', type: 'string', notNull: true, desc: 'Asset designation (e.g., Wireless Microphone Set).' },
      { name: 'category', type: 'string', notNull: true, desc: 'Event Materials, Office Supplies, Merchandise, Equipment.' },
      { name: 'quantity', type: 'int', notNull: true, default: '0', desc: 'Current available units in storage.' },
      { name: 'borrowedCount', type: 'int', notNull: true, default: '0', desc: 'Units currently checked out via `borrowingLogs`.' },
      { name: 'minQuantity', type: 'int', notNull: true, default: '5', desc: 'Minimum stock threshold triggering warning badges.' },
      { name: 'unitPrice', type: 'float', notNull: false, default: '0', desc: 'Unit valuation in PHP.' },
      { name: 'fundSource', type: 'string', notNull: true, default: 'IGF', desc: 'Procurement fund source (`IGF` or `IGP`).' },
      { name: 'storageLocation', type: 'string', notNull: false, desc: 'Physical cabinet or storage room (`InventoryProvider.jsx:205`).' },
      { name: 'linkedProductId', type: 'string', notNull: false, unique: true, ref: 'products.productId', rel: '-', desc: '1:1 catalog SKU link (`products.productId`, `InventoryProvider.jsx:341`).' },
    ],
  },
  borrowingLogs: {
    section: '04-commerce-inventory-preorders',
    techTag: 'tech/firestore',
    description: 'Equipment checkout and return custody tracking logs linked to inventory',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Borrowing log document ID.' },
      { name: 'itemId', type: 'string', notNull: true, ref: 'inventory.id', rel: '>', desc: 'Borrowed inventory asset document ID.' },
      { name: 'itemName', type: 'string', notNull: false, desc: 'Denormalized asset title.' },
      { name: 'borrowerName', type: 'string', notNull: true, desc: 'Full name of borrower.' },
      { name: 'borrowerEmail', type: 'string', notNull: false, desc: 'Borrower contact email.' },
      { name: 'quantityBorrowed', type: 'int', notNull: true, desc: 'Units checked out.' },
      { name: 'status', type: 'string', notNull: true, default: 'borrowed', desc: '`borrowed` or `returned`.' },
      { name: 'returned', type: 'boolean', notNull: false, default: 'false', desc: 'Boolean return flag.' },
      { name: 'expectedReturnDate', type: 'timestamp', notNull: true, desc: 'Scheduled return date.' },
      { name: 'returnDate', type: 'timestamp', notNull: false, desc: 'Verified return timestamp.' },
      { name: 'processedBy', type: 'string', notNull: false, desc: 'Officer name processing custody handoff.' },
    ],
  },
  preOrderBatches: {
    section: '04-commerce-inventory-preorders',
    techTag: 'tech/firestore',
    description: 'IGF pre-order production batches for uniforms, shirts & bulk merchandise runs',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Pre-order batch document ID.' },
      { name: 'name', type: 'string', notNull: true, desc: 'Batch title (e.g., Uniform Batch 1).' },
      { name: 'product', type: 'string', notNull: true, desc: 'Product line label.' },
      { name: 'fiscalYear', type: 'int', notNull: false, desc: 'Fiscal year integer.' },
      { name: 'unitPriceCentavos', type: 'int', notNull: true, desc: 'Unit student price in integer centavos.' },
      { name: 'collectedCentavos', type: 'int', notNull: true, default: '0', desc: 'Total student payments collected in centavos.' },
      { name: 'paidSupplierCentavos', type: 'int', notNull: true, default: '0', desc: 'Total disbursed to supplier in centavos.' },
      { name: 'status', type: 'string', notNull: true, default: 'OPEN_FOR_PREORDERS', desc: '`OPEN_FOR_PREORDERS` -> `SUPPLIER_PAID` -> `DISTRIBUTING` -> `CLEARED`.' },
      { name: 'custodianUserId', type: 'string', notNull: false, ref: 'users.uid', rel: '>', desc: 'Batch custodian officer UID (`financeService.js:1016`).' },
      { name: 'createdById', type: 'string', notNull: true, ref: 'users.uid', rel: '>', desc: 'Batch creator officer UID (`financeService.js:1028`).' },
      { name: 'auditFlags', type: 'array', notNull: false, desc: 'Auditor clearance flags.' },
    ],
  },
  preOrderEntries: {
    section: '04-commerce-inventory-preorders',
    techTag: 'tech/firestore',
    description: 'Per-student payment and fulfillment ledger entries inside a PreOrderBatch',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Pre-order entry document ID.' },
      { name: 'batchId', type: 'string', notNull: true, ref: 'preOrderBatches.id', rel: '>', desc: 'Parent `preOrderBatches` document.' },
      { name: 'studentId', type: 'string', notNull: true, desc: 'Student ID number.' },
      { name: 'studentName', type: 'string', notNull: true, desc: 'Student full name.' },
      { name: 'variant', type: 'string', notNull: false, desc: 'Selected size/variant.' },
      { name: 'quantity', type: 'int', notNull: true, default: '1', desc: 'Ordered quantity.' },
      { name: 'amountDueCentavos', type: 'int', notNull: true, desc: 'Total owed in integer centavos.' },
      { name: 'amountPaidCentavos', type: 'int', notNull: true, default: '0', desc: 'Amount paid so far in centavos.' },
      { name: 'paymentStatus', type: 'string', notNull: true, desc: '`UNPAID`, `PARTIAL`, or `PAID`.' },
      { name: 'claimStatus', type: 'string', notNull: false, desc: 'Fulfillment claim status.' },
      { name: 'recordedById', type: 'string', notNull: true, ref: 'users.uid', rel: '>', desc: 'Recording officer UID (`financeService.js:1078`).' },
    ],
  },
  settings: {
    section: '04-commerce-inventory-preorders',
    techTag: 'tech/firestore',
    description: 'Singleton settings docs (`settings/app` active term & `settings/commerceOrderSheet` Sheets sync)',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Singleton settings key (`app` or `commerceOrderSheet`).' },
      { name: 'currentTerm', type: 'string', notNull: false, unique: true, ref: 'terms.id', rel: '-', desc: 'Active governance term on `settings/app` (`useCurrentTerm.js:56`).' },
      { name: 'spreadsheetId', type: 'string', notNull: false, desc: 'Linked Google Sheets workbook ID (`commerceOrderSheet`).' },
      { name: 'sheetTitle', type: 'string', notNull: false, desc: 'Target sheet tab name (`Commerce Hub Orders`).' },
      { name: 'columnMappings', type: 'object', notNull: false, desc: '18-column schema mapping dictionary.' },
      { name: 'previousSheets', type: 'array', notNull: false, desc: 'Reassignment archive history (up to 15 records).' },
      { name: 'assignedByUid', type: 'string', notNull: false, ref: 'users.uid', rel: '>', desc: 'Secretariat officer UID who assigned the centralized sheet.' },
      { name: 'lastSyncedAt', type: 'timestamp', notNull: false, desc: 'Timestamp of most recent two-way sync.' },
    ],
  },

  // ---------------------------------------------------------------------------
  // SECTION 5: DOCUMENTS, GRIDFS/DRIVE, AI, COMMS & CAMPUS (#6D28D9)
  // ---------------------------------------------------------------------------
  documents: {
    section: '05-documents-comms-campus',
    techTag: 'tech/firestore',
    description: 'Legislative archive metadata with 1:1 GridFS binary link, AI extraction & embedded signatory checklists',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Firestore document metadata ID.' },
      { name: 'title', type: 'string', notNull: true, desc: 'Official resolution, memo, or report title.' },
      { name: 'documentNumber', type: 'string', notNull: false, desc: 'Legislative control number (e.g., Resolution No. 025).' },
      { name: 'status', type: 'string', notNull: true, default: 'pending', desc: 'Workflow state: `pending`, `under_review`, or `approved`.' },
      { name: 'mongoFileId', type: 'string', notNull: false, unique: true, ref: 'gridfs_files._id', rel: '-', desc: '1:1 MongoDB GridFS ObjectId for binary file stream.' },
      { name: 'labels', type: 'array', notNull: true, ref: 'documentLabels.slug', rel: '<>', desc: 'M:N array of controlled taxonomy slugs (`documentLabels.slug`).' },
      { name: 'aiState', type: 'string', notNull: false, desc: 'AI pipeline state (`pending`, `suggested`, `verified`).' },
      { name: 'summary', type: 'string', notNull: false, desc: 'Gemini/OpenRouter generated summary (`backend/routes/ai.js:655`).' },
      { name: 'aiConfidence', type: 'float', notNull: false, desc: 'AI classification confidence score.' },
      { name: 'signatureChecklist', type: 'array', notNull: true, desc: 'Embedded multi-signatory verification entries (mirrored in `signatures[]`).' },
      { name: 'createdBy', type: 'string', notNull: true, ref: 'users.uid', rel: '>', desc: 'Uploading officer UID (also tracks `updatedBy`, `aiProcessedBy`, `verifiedBy`, `correctedBy`).' },
      { name: 'createdAt', type: 'timestamp', notNull: true, desc: 'Archive ingestion timestamp.' },
    ],
  },
  gridfs_files: {
    section: '05-documents-comms-campus',
    techTag: 'tech/mongodb-gridfs',
    description: 'MongoDB GridFS binary store (`documents.files`/`chunks`) mirrored to Google Drive (Documents/Receipts)',
    columns: [
      { name: '_id', type: 'string', pk: true, desc: 'MongoDB GridFS ObjectId.' },
      { name: 'filename', type: 'string', notNull: true, desc: 'Sanitized PDF/DOCX/Image filename.' },
      { name: 'length', type: 'int', notNull: true, desc: 'Binary payload size in bytes.' },
      { name: 'chunkSize', type: 'int', notNull: true, desc: 'GridFS chunk size in bytes.' },
      { name: 'metadata_mimeType', type: 'string', notNull: true, desc: 'Nested `metadata.mimeType` (application/pdf, image/png, etc.).' },
      { name: 'metadata_folder', type: 'string', notNull: true, desc: 'Nested `metadata.folder`: `Documents` or `Receipts`.' },
      { name: 'metadata_driveFileId', type: 'string', notNull: false, desc: 'Nested `metadata.driveFileId`: mirrored Google Drive file ID.' },
      { name: 'metadata_driveSyncStatus', type: 'string', notNull: false, desc: 'Nested `metadata.driveSyncStatus`: `synced`, `pending`, or `failed`.' },
      { name: 'metadata_documentId', type: 'string', notNull: false, desc: 'Nested `metadata.documentId`: back-reference to `documents.id`.' },
      { name: 'metadata_uploadedBy', type: 'string', notNull: false, ref: 'users.uid', rel: '>', desc: 'Nested `metadata.uploadedBy`: uploading officer UID (`backend/routes/documents.js:240`).' },
      { name: 'uploadDate', type: 'timestamp', notNull: true, desc: 'GridFS upload timestamp.' },
    ],
  },
  documentLabels: {
    section: '05-documents-comms-campus',
    techTag: 'tech/firestore',
    description: 'Controlled taxonomy labels used for manual filing and AI document classification',
    columns: [
      { name: 'slug', type: 'string', pk: true, desc: 'Canonical URL-safe label slug (doc ID = `slug`).' },
      { name: 'name', type: 'string', notNull: true, desc: 'Display label name.' },
      { name: 'description', type: 'string', notNull: false, desc: 'Classification scope guidance.' },
      { name: 'system', type: 'boolean', notNull: false, default: 'false', desc: 'Built-in protected taxonomy flag.' },
      { name: 'active', type: 'boolean', notNull: true, default: 'true', desc: 'Whether tag appears in active pickers.' },
      { name: 'aiEnabled', type: 'boolean', notNull: true, default: 'true', desc: 'Included in Gemini/OpenRouter classification prompts.' },
      { name: 'createdBy', type: 'string', notNull: false, ref: 'users.uid', rel: '>', desc: 'Creating officer UID (`documentService.js:144`).' },
    ],
  },
  documentAuditLogs: {
    section: '05-documents-comms-campus',
    techTag: 'tech/firestore',
    description: 'Append-only subcollection (`documents/{id}/auditLogs`) for AI tagging & signatory history',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Subcollection audit entry ID.' },
      { name: 'documentId', type: 'string', notNull: true, ref: 'documents.id', rel: '>', desc: 'Parent `documents` record.' },
      { name: 'action', type: 'string', notNull: true, desc: '`ai_analysis_completed`, `ai_analysis_confirmed`, `signature_recorded`, `classification_corrected`.' },
      { name: 'performedBy', type: 'string', notNull: true, ref: 'users.uid', rel: '>', desc: 'Acting officer UID (`backend/routes/ai.js:924`).' },
      { name: 'performedByName', type: 'string', notNull: false, desc: 'Acting officer display name.' },
      { name: 'details', type: 'object', notNull: false, desc: 'Action metadata payload.' },
      { name: 'at', type: 'timestamp', notNull: true, desc: 'Immutable event timestamp (`backend/routes/ai.js:926`).' },
    ],
  },
  announcements: {
    section: '05-documents-comms-campus',
    techTag: 'tech/firestore',
    description: 'Campus announcements with homepage visibility toggle and Telegram broadcast delivery receipts',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Announcement document ID.' },
      { name: 'title', type: 'string', notNull: true, desc: 'Announcement headline.' },
      { name: 'description', type: 'string', notNull: false, desc: 'Announcement body text.' },
      { name: 'type', type: 'string', notNull: true, desc: 'Announcement classification badge type.' },
      { name: 'category', type: 'string', notNull: true, default: 'General', desc: 'Internal portal filter category.' },
      { name: 'venue', type: 'string', notNull: false, desc: 'Event location / campus hall.' },
      { name: 'eventDate', type: 'string', notNull: false, desc: 'Optional scheduled event date.' },
      { name: 'homepageVisible', type: 'boolean', notNull: true, default: 'false', desc: 'True when visible on CTU-DB public homepage (`Announcement.jsx:430`).' },
      { name: 'telegram', type: 'object', notNull: false, desc: 'Channel broadcast receipt map (`{ faculty, all_mayors }`).' },
      { name: 'createdAt', type: 'timestamp', notNull: true, desc: 'Publication timestamp.' },
    ],
  },
  newsArticles: {
    section: '05-documents-comms-campus',
    techTag: 'tech/firestore',
    description: 'Public campus news, policy updates & highlight stories rendered on Homepage & Announcements',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'News article document ID.' },
      { name: 'title', type: 'string', notNull: true, desc: 'Article headline.' },
      { name: 'description', type: 'string', notNull: true, desc: 'Full article body copy.' },
      { name: 'tag', type: 'string', notNull: true, desc: 'Category tag: `event`, `policy`, or `news`.' },
      { name: 'images', type: 'array', notNull: true, desc: 'Array of base64 data URL gallery images.' },
      { name: 'expiryDate', type: 'string', notNull: false, desc: 'Optional ISO expiration date string.' },
      { name: 'createdAt', type: 'string', notNull: true, desc: 'ISO creation timestamp string.' },
      { name: 'updatedAt', type: 'string', notNull: false, desc: 'ISO last-edit timestamp string.' },
    ],
  },
  calendarEvents: {
    section: '05-documents-comms-campus',
    techTag: 'tech/firestore',
    description: 'Campus Event Calendar entries categorized by Class, Exam, Event, Holiday & Meeting types',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Calendar event document ID.' },
      { name: 'eventName', type: 'string', notNull: true, desc: 'Event title (`InlineQuickEventPopover.jsx:307`).' },
      { name: 'eventType', type: 'string', notNull: true, desc: '`Class`, `Exam`, `Event`, `Holiday`, or `Meeting`.' },
      { name: 'eventDate', type: 'string', notNull: true, desc: 'Primary ISO date string (plus `dates[]`, `startDate`, `endDate`, `isMultiDay`).' },
      { name: 'location', type: 'string', notNull: false, desc: 'Event venue or room.' },
      { name: 'managingOrgTag', type: 'string', notNull: false, desc: 'Managing organization display badge (`InlineQuickEventPopover.jsx:312`).' },
      { name: 'requiresAttendance', type: 'boolean', notNull: false, default: 'false', desc: 'Mandatory attendance indicator.' },
      { name: 'createdBy_uid', type: 'string', notNull: false, ref: 'users.uid', rel: '>', desc: 'Nested path `createdBy.uid`: authoring officer UID (`CalendarWidget.jsx:441`).' },
      { name: 'createdAt', type: 'timestamp', notNull: true, desc: 'Creation timestamp.' },
    ],
  },
  campusMetadata: {
    section: '05-documents-comms-campus',
    techTag: 'tech/firestore',
    description: 'Interactive 2D Campus Map singleton metadata (`campusMetadata/trees` spatial annotations)',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Singleton metadata document ID (`trees`).' },
      { name: 'list', type: 'array', notNull: true, desc: 'Array of campus map tree/spatial marker objects (`CampusMap.jsx:517`).' },
      { name: 'updatedBy', type: 'string', notNull: false, desc: 'Role label string (`admin`, not a UID).' },
      { name: 'updatedAt', type: 'string', notNull: true, desc: 'ISO string of last map edit timestamp.' },
    ],
  },
};

// Lightweight cross-section anchor definitions for focused individual section views (02..05)
const ANCHORS = {
  users: {
    section: '01-identity-org-audit',
    techTag: 'tech/firestore',
    description: '(Section 1 Anchor) Authenticated Firebase users & 17-role RBAC profiles',
    columns: [
      { name: 'uid', type: 'string', pk: true, desc: 'Firebase Authentication unique user identifier.' },
      { name: 'name', type: 'string', notNull: true, desc: 'User display name.' },
      { name: 'email', type: 'string', notNull: true, unique: true, desc: 'Institutional or personal email.' },
      { name: 'role', type: 'string', notNull: true, default: 'member', desc: 'Assigned RBAC role across 17 designations.' },
      { name: 'isActive', type: 'boolean', notNull: true, default: 'true', desc: 'Active account flag.' },
    ],
  },
  terms: {
    section: '01-identity-org-audit',
    techTag: 'tech/firestore',
    description: '(Section 1 Anchor) Academic & SSG governance terms referenced by settings/app',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Academic term ID (e.g., `2025-2026`).' },
      { name: 'label', type: 'string', notNull: true, unique: true, desc: 'Display term label.' },
    ],
  },
  orders: {
    section: '04-commerce-inventory-preorders',
    techTag: 'tech/firestore',
    description: '(Section 4 Anchor) Student merchandise orders linked to IGF revenue postings',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Firestore order document ID.' },
      { name: 'orderId', type: 'string', notNull: true, unique: true, desc: 'Customer order tracking ID (`ORD-DB-XXXX`).' },
      { name: 'orderStatus', type: 'string', notNull: true, default: 'Pending', desc: '`Pending`, `Online Paid`, `Claimed`, `Returned`, `Cancelled`.' },
      { name: 'igfSynced', type: 'boolean', notNull: true, default: 'false', desc: 'Guard flag confirming IGF ledger revenue sync.' },
      { name: 'igfAmountCentavos', type: 'int', notNull: false, default: '0', desc: 'Centavo revenue credited to `fund_igf_main`.' },
    ],
  },
  documents: {
    section: '05-documents-comms-campus',
    techTag: 'tech/firestore',
    description: '(Section 5 Anchor) Legislative resolution records backing PPMP budget allocations',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Firestore document metadata ID.' },
      { name: 'title', type: 'string', notNull: true, desc: 'Official resolution title.' },
      { name: 'documentNumber', type: 'string', notNull: false, desc: 'Legislative control number.' },
      { name: 'status', type: 'string', notNull: true, default: 'pending', desc: '`pending`, `under_review`, or `approved`.' },
    ],
  },
};

// =============================================================================
// FOLDER DEFINITIONS & SPATIAL NON-OVERLAPPING LAYOUTS
// =============================================================================
const FOLDERS = [
  {
    folder: COMBINED_FOLDER,
    title: COMBINED_TITLE,
    isCombined: true,
    // 5 color-coded spatial zones:
    // Zone 1 (Crimson, Top-Center): x 1160..2800, y 40..900
    // Zone 2 (Teal, Top-Left Wing): x 40..980, y 40..1760
    // Zone 3 (Sapphire, Center-Bottom Spine): x 1160..2160, y 1060..2720
    // Zone 4 (Amber, Right Wing): x 2320..3320, y 560..2680
    // Zone 5 (Violet, Bottom-Left Wing): x 40..1020, y 1920..3120
    entries: [
      // --- ZONE 1: IDENTITY, ORGANIZATIONS & AUDIT (#8B1E3F Royal Crimson) ---
      { name: 'terms', x: 1160, y: 40 },
      { name: 'users', x: 1640, y: 40 },
      { name: 'organizations', x: 2140, y: 40 },
      { name: 'members', x: 2640, y: 40 },
      { name: 'audit_logs', x: 1640, y: 560 },

      // --- ZONE 2: CLASS ROSTERS & TECHNOCARES (#0F766E Deep Emerald Teal) ---
      { name: 'classSections', x: 40, y: 40 },
      { name: 'classRosters', x: 540, y: 40 },
      { name: 'deathAidBeneficiaries', x: 40, y: 460 },
      { name: 'deathAidCollections', x: 540, y: 580 },
      { name: 'deathAidAuditLog', x: 40, y: 980 },
      { name: 'deathAidRemittances', x: 540, y: 1160 },
      { name: 'deathAidCounters', x: 40, y: 1360 },

      // --- ZONE 3: CENTAVO FINANCE, PPMP & IGP (#1D4ED8 Executive Sapphire) ---
      { name: 'fundAccounts', x: 1160, y: 1080 },
      { name: 'budgetAllocations', x: 1660, y: 1080 },
      { name: 'transactions', x: 1660, y: 1640 },
      { name: 'lockers', x: 1160, y: 1640 },
      { name: 'igpCollections', x: 1160, y: 2060 },

      // --- ZONE 4: COMMERCE, INVENTORY, PRE-ORDERS & SYNC (#B45309 Amber Gold) ---
      { name: 'settings', x: 2320, y: 560 },
      { name: 'preOrderBatches', x: 2320, y: 980 },
      { name: 'preOrderEntries', x: 2820, y: 980 },
      { name: 'orders', x: 2320, y: 1460 },
      { name: 'inventory', x: 2820, y: 1460 },
      { name: 'products', x: 2320, y: 2040 },
      { name: 'borrowingLogs', x: 2820, y: 2040 },

      // --- ZONE 5: DOCUMENTS, GRIDFS/DRIVE, AI, COMMS & CAMPUS (#6D28D9 Imperial Violet) ---
      { name: 'documents', x: 540, y: 1660 },
      { name: 'gridfs_files', x: 540, y: 2160 },
      { name: 'documentLabels', x: 40, y: 1720 },
      { name: 'documentAuditLogs', x: 40, y: 2120 },
      { name: 'announcements', x: 40, y: 2520 },
      { name: 'calendarEvents', x: 540, y: 2640 },
      { name: 'newsArticles', x: 1160, y: 2560 },
      { name: 'campusMetadata', x: 1660, y: 2560 },
    ],
  },
  {
    folder: '01-identity-org-audit',
    title: SECTION_META['01-identity-org-audit'].title,
    entries: [
      { name: 'terms', x: 40, y: 40 },
      { name: 'users', x: 520, y: 40 },
      { name: 'organizations', x: 1020, y: 40 },
      { name: 'audit_logs', x: 520, y: 560 },
      { name: 'members', x: 1020, y: 420 },
    ],
  },
  {
    folder: '02-rosters-technocares',
    title: SECTION_META['02-rosters-technocares'].title,
    entries: [
      { name: 'users', isAnchor: true, x: 40, y: 40 },
      { name: 'classSections', x: 520, y: 40 },
      { name: 'classRosters', x: 1020, y: 40 },
      { name: 'deathAidBeneficiaries', x: 40, y: 340 },
      { name: 'deathAidCollections', x: 520, y: 480 },
      { name: 'deathAidRemittances', x: 1020, y: 600 },
      { name: 'deathAidAuditLog', x: 40, y: 860 },
      { name: 'deathAidCounters', x: 1020, y: 1020 },
    ],
  },
  {
    folder: '03-finance-ppmp-igp',
    title: SECTION_META['03-finance-ppmp-igp'].title,
    entries: [
      { name: 'users', isAnchor: true, x: 40, y: 40 },
      { name: 'documents', isAnchor: true, x: 520, y: 40 },
      { name: 'orders', isAnchor: true, x: 1020, y: 40 },
      { name: 'fundAccounts', x: 40, y: 340 },
      { name: 'budgetAllocations', x: 520, y: 340 },
      { name: 'transactions', x: 520, y: 880 },
      { name: 'lockers', x: 1020, y: 340 },
      { name: 'igpCollections', x: 1020, y: 760 },
    ],
  },
  {
    folder: '04-commerce-inventory-preorders',
    title: SECTION_META['04-commerce-inventory-preorders'].title,
    entries: [
      { name: 'users', isAnchor: true, x: 40, y: 40 },
      { name: 'terms', isAnchor: true, x: 520, y: 40 },
      { name: 'settings', x: 1020, y: 40 },
      { name: 'products', x: 40, y: 340 },
      { name: 'orders', x: 520, y: 340 },
      { name: 'preOrderBatches', x: 1020, y: 440 },
      { name: 'inventory', x: 40, y: 820 },
      { name: 'borrowingLogs', x: 520, y: 920 },
      { name: 'preOrderEntries', x: 1020, y: 920 },
    ],
  },
  {
    folder: '05-documents-comms-campus',
    title: SECTION_META['05-documents-comms-campus'].title,
    entries: [
      { name: 'users', isAnchor: true, x: 40, y: 40 },
      { name: 'documents', x: 520, y: 40 },
      { name: 'gridfs_files', x: 1020, y: 40 },
      { name: 'announcements', x: 40, y: 340 },
      { name: 'documentAuditLogs', x: 520, y: 520 },
      { name: 'documentLabels', x: 1020, y: 500 },
      { name: 'calendarEvents', x: 40, y: 760 },
      { name: 'newsArticles', x: 520, y: 900 },
      { name: 'campusMetadata', x: 1020, y: 880 },
    ],
  },
];

// Estimate rendered DB Atlas SVG card size to guarantee zero overlaps
const EST_WIDTH = 360;
function estimateHeight(colCount) {
  return 64 + colCount * 24;
}

function checkOverlaps(folderName, placed) {
  const overlaps = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      const horiz = a.x < b.x + EST_WIDTH && a.x + EST_WIDTH > b.x;
      const vert = a.y < b.y + b.h && a.y + a.h > b.y;
      if (horiz && vert) {
        overlaps.push(`${a.name} (${a.x},${a.y}..${a.y + a.h}) overlaps ${b.name} (${b.x},${b.y}..${b.y + b.h})`);
      }
    }
  }
  if (overlaps.length > 0) {
    throw new Error(`Layout overlap in ${folderName}:\n  - ${overlaps.join('\n  - ')}`);
  }
}

// =============================================================================
// GENERATE ALL 6 DB ATLAS FOLDERS (1 COMBINED + 5 DIVIDED SECTIONS)
// =============================================================================
if (!fs.existsSync(ATLAS_ROOT)) {
  fs.mkdirSync(ATLAS_ROOT, { recursive: true });
}
for (const entry of fs.readdirSync(ATLAS_ROOT, { withFileTypes: true })) {
  const full = path.join(ATLAS_ROOT, entry.name);
  if (entry.isFile() && entry.name.endsWith('.md')) {
    fs.unlinkSync(full);
  }
}

// Read existing data.json to preserve user settings (language, viewLocation, etc.)
let existingConfig = null;
if (fs.existsSync(PLUGIN_DATA_PATH)) {
  try {
    existingConfig = JSON.parse(fs.readFileSync(PLUGIN_DATA_PATH, 'utf8'));
  } catch {
    existingConfig = null;
  }
}

const dbFolders = [];
const layouts = {};
let totalNotes = 0;
let combinedEdgeCount = 0;

for (const folderDef of FOLDERS) {
  const relFolder = `db-atlas/${folderDef.folder}`;
  const secDir = path.join(ATLAS_ROOT, folderDef.folder);
  fs.rmSync(secDir, { recursive: true, force: true });
  fs.mkdirSync(secDir, { recursive: true });

  dbFolders.push(relFolder);
  layouts[relFolder] = { tables: {} };

  // Resolve table specs for this folder
  const resolvedTables = folderDef.entries.map((entry) => {
    const spec = entry.isAnchor ? ANCHORS[entry.name] : ENTITIES[entry.name];
    if (!spec) {
      throw new Error(`Unknown ${entry.isAnchor ? 'anchor' : 'entity'} "${entry.name}" in ${relFolder}`);
    }
    return {
      name: entry.name,
      isAnchor: Boolean(entry.isAnchor),
      x: entry.x,
      y: entry.y,
      ...spec,
    };
  });

  // Assert zero overlapping cards
  checkOverlaps(
    relFolder,
    resolvedTables.map((t) => ({ name: t.name, x: t.x, y: t.y, h: estimateHeight(t.columns.length) })),
  );

  // Build intra-folder table -> columns lookup
  const tableColMap = new Map();
  for (const t of resolvedTables) {
    tableColMap.set(t.name, new Set(t.columns.map((c) => c.name)));
  }

  let folderRefs = 0;

  for (const t of resolvedTables) {
    const secInfo = SECTION_META[t.section];
    const techTag = t.techTag || 'tech/firestore';

    let fm = '---\n';
    fm += 'tags:\n';
    fm += '  - ssg-app\n';
    fm += '  - backend\n';
    fm += '  - domain/database\n';
    fm += '  - type/db-atlas-table\n';
    fm += '  - status/production\n';
    fm += `  - ${techTag}\n`;
    fm += `  - erd-section/${t.section}\n`;
    if (folderDef.isCombined) {
      fm += `  - erd-view/combined-master\n`;
    }
    fm += `title: "Table: ${t.name}"\n`;
    fm += `table_color: "${secInfo.color}"\n`;
    fm += `table_description: "${t.description.replace(/"/g, '\\"')}"\n`;

    const renderedCols = [];

    for (const col of t.columns) {
      const cfg = { type: col.type };
      if (col.pk) cfg.pk = true;
      if (col.notNull) cfg.notNull = true;
      if (col.unique) cfg.unique = true;
      if (col.default !== undefined) cfg.default = col.default;

      let activeRef = null;
      let activeRel = null;

      if (col.ref) {
        const [refTable, refCol] = col.ref.split('.');
        const targetExistsHere = tableColMap.has(refTable) && tableColMap.get(refTable).has(refCol);
        if (targetExistsHere) {
          cfg.ref = col.ref;
          if (col.rel) cfg.rel = col.rel;
          activeRef = col.ref;
          activeRel = col.rel || '>';
          folderRefs++;
        } else if (folderDef.isCombined) {
          throw new Error(`Broken FK in combined ERD: ${t.name}.${col.name} -> ${col.ref}`);
        }
      }

      const jsonStr = JSON.stringify(cfg);
      JSON.parse(jsonStr); // assert strict JSON validity
      fm += `col_${col.name}: '${jsonStr}'\n`;
      renderedCols.push({ ...col, activeRef, activeRel });
    }
    fm += '---\n\n';

    let body = `> [!info] 🧠 Neural Synapse Navigation\n`;
    body += `> 📍 **Database Hub:** [[01_Architecture_Database_MOC|🏛️ Architecture & Database]] | 🎨 **Domain Color:** \`${secInfo.colorLabel}\` | 🗺️ **Domain:** ${secInfo.title} | 🏠 **Core:** [[00_VAULT_INDEX|🧠 Master Knowledge Graph]]\n\n`;
    body += `# ${t.name}\n\n`;
    body += `> [!abstract] Table Overview\n`;
    body += `> ${t.description}.\n\n`;
    body += `### Field Specifications\n\n`;

    for (const col of renderedCols) {
      const relLabel = col.activeRel === '-' ? '1:1' : col.activeRel === '<>' ? 'M:N' : col.activeRel === '<' ? '1:N' : 'N:1';
      const constraints = [
        col.pk ? '`PRIMARY KEY`' : '',
        col.unique ? '`UNIQUE`' : '',
        col.notNull ? '`NOT NULL`' : '',
        col.activeRef ? `\`REFERENCES ${col.activeRef} (${relLabel})\`` : col.ref ? `\`CROSS-SECTION REF ${col.ref} (rendered in 00-all-entities-combined)\`` : '',
        col.default !== undefined ? `(Default: \`${col.default}\`)` : '',
      ].filter(Boolean).join(' ');

      body += `## ${col.name}\n`;
      body += `* **Type:** \`${col.type}\`\n`;
      if (constraints) body += `* **Constraints:** ${constraints}\n`;
      body += `* **Description:** ${col.desc}\n\n`;
    }

    fs.writeFileSync(path.join(secDir, `${t.name}.md`), fm + body, 'utf8');
    layouts[relFolder].tables[t.name] = { x: t.x, y: t.y };
    totalNotes++;
  }

  if (folderDef.isCombined) combinedEdgeCount = folderRefs;
  console.log(`Generated ${relFolder}: ${resolvedTables.length} tables, ${folderRefs} FK connections`);
}

// Sanity check: combined folder must contain every single entity in ENTITIES
const allEntityNames = Object.keys(ENTITIES);
const combinedNames = FOLDERS[0].entries.map((e) => e.name);
const missingFromCombined = allEntityNames.filter((n) => !combinedNames.includes(n));
if (missingFromCombined.length > 0) {
  throw new Error(`Entities missing from combined ERD: ${missingFromCombined.join(', ')}`);
}

// Preserve user's existing custom coordinates for 01-identity-org-audit only if exact same table set
if (existingConfig?.layouts?.['db-atlas/01-identity-org-audit']?.tables) {
  const prevTables = existingConfig.layouts['db-atlas/01-identity-org-audit'].tables;
  const expectedKeys = Object.keys(layouts['db-atlas/01-identity-org-audit'].tables).sort();
  const prevKeys = Object.keys(prevTables).sort();
  if (JSON.stringify(expectedKeys) === JSON.stringify(prevKeys)) {
    layouts['db-atlas/01-identity-org-audit'].tables = prevTables;
  }
}

const pluginConfig = {
  settings: {
    dbFolders,
    language: existingConfig?.settings?.language || 'auto',
    viewLocation: existingConfig?.settings?.viewLocation || 'tab',
    newTableTemplate: existingConfig?.settings?.newTableTemplate || '',
  },
  layouts,
  lastFolder: `db-atlas/${COMBINED_FOLDER}`,
};

fs.mkdirSync(path.dirname(PLUGIN_DATA_PATH), { recursive: true });
fs.writeFileSync(PLUGIN_DATA_PATH, JSON.stringify(pluginConfig, null, 2) + '\n', 'utf8');
console.log(
  `Updated DB Atlas plugin config (${dbFolders.length} folders, ${totalNotes} total notes, ${allEntityNames.length} unique live entities, ${combinedEdgeCount} edges in combined ERD).`,
);
