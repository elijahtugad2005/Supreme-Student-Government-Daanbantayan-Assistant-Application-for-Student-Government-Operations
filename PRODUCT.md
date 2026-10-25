# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary Operators**: Supreme Student Government (SSG) Executive Officers (Admin, Secretary, Governor, Representative, Senator, Finance Secretary) at Cebu Technological University — Daanbantayan Campus.
- **Submitters**: Class Mayors / Section Representatives (working as guest or member without requiring heavy credential onboarding) submitting classroom rosters and collection filings.

## Product Purpose

SSG Office Assistant centralizes student government administrative operations into a single tamper-resistant digital workspace. It replaces chaotic paper-based submissions, manual arithmetic errors in welfare funds, and untracked document routings with an automated, auditable, and verifiable institutional system.

## Positioning

Unlike generic spreadsheet-sharing or standard form builders, SSG Office Assistant enforces signed, dual-entry financial accountability (never overwriting reported numbers with received cash), version-controlled student registries with tolerant document parsing, and human-in-the-loop AI document intelligence with strict conflict-of-interest prevention (authors cannot sign their own papers).

## Operating Context

- **Environment**: University campus student government office, mobile and desktop web browsers, often handling intermittent campus network connectivity.
- **Documents & Artifacts**: Class lists in diverse formats (CSV, XLSX, XLS, TXT, scanned JPEG/PNG), Death Aid collection breakdown sheets, official student government resolutions, memorandums, and communications requiring multi-officer signatures.
- **Rituals**: Semesterly roster enrollment and transfers, welfare/death-aid fund collections per section, regular executive meetings, and official document approvals.

## Capabilities and Constraints

- **Classroom Roster Registry**: Content-based tabular and OCR file ingestion tolerating messy registrar headings; automatic duplicate and section mismatch detection; immutable versioning when amending verified rosters.
- **Death Aid Financial Workflow**: Automatic calculation of expected dues based on active rosters; dual-entry recording (reported vs actual cash received) with variance tracking; discrepancy audit logging; dedicated denial/disclosure flows for student input errors.
- **AI Document Intelligence**: Automated metadata and signature checklist extraction; non-signing author detection; required-only completion logic; human confirmation gates prior to persisting official data.
- **Granular Permissions & Dynamic Access**: Role-based access control with administrative capability to grant or revoke specific per-user overrides for temporary workload spikes.
- **Technical Constraints**: Client-side React 19 + Firebase (Firestore rules security, Cloud Storage with access verification, Firebase Auth, and Node Cloud Functions).

## Brand Commitments

- **Institution**: Cebu Technological University — Daanbantayan Campus (Supreme Student Government).
- **Tone & Voice**: Authoritative, transparent, institutional, professional, and audit-ready.
- **Visual Identity**: CTU / SSG gold and blue accents, high-contrast clarity for scanning tabular data, and prominent status indicators for pending actions and discrepancies.

## Evidence on Hand

- Tested and running Firestore rules and security contracts (`firestore.rules`, `storage.rules`).
- Complete role permission matrix defined in `src/utils/permissions.js`.
- Verified calculation utilities and automated test suites (`test:death-aid`, `test:roster-import`, `test:rules`).
- Real-world campus office documentation standards and document workflow schemas in `src/services/`.

## Product Principles

1. **Dual Truth Over Silent Overwrite**: When reported data differs from verified reality (e.g., cash collected vs cash remitted), preserve both numbers side-by-side with an immutable officer audit trail.
2. **Tolerance at the Boundary, Rigor in the Core**: Accept varied, messy input formats from students, but validate, version, and strictly verify before entering official university records.
3. **AI as Advisor, Human as Authority**: AI assists by extracting metadata and proposing checklists, but never independently finalizes or signs official campus documents.
4. **Instant Actionability & Visual Clarity**: Operational tasks, pending verifications, and financial discrepancies must be immediately identifiable through unambiguous visual cues and status indicators.

## Accessibility & Inclusion

- Responsive design supporting mobile use by students and desktop widescreen workstations in the SSG office.
- High-contrast visual cues for status badges (warning, verified, pending, denied).
- Accessible keyboard navigation and semantic HTML for form validations, dialog modals, and audit tables.
