# SSG Office Assistant — Student Government Administrative System

A React + Firebase dashboard for running a student government office: classroom rosters, Death Aid collection with a signed remittance trail, and AI-assisted document management.

**Institution:** Cebu Technological University — Daanbantayan Campus

---

## What the system does

### 1. Classroom roster registry

Mayors upload a class list as **CSV, XLSX, XLS, TXT, JPEG or PNG**. The importer finds the **Name** and **Section** columns by content, not position, so it tolerates whatever the registrar's file happens to look like — title rows above the header, extra columns, inconsistent labels (`STUDENT NAME`, `NAMES`, `FULL NAMES`, `SECTION / BLOCK`, `CLASS`, …). Unrecognised columns are ignored and reported back to you.

Duplicates, suspiciously short names, and a section mismatch against the form are flagged before you submit. A submitter can correct their own pending roster, withdraw it, or amend a verified one when students transfer — amendments go back for officer verification rather than silently changing an official list.

Rosters are **versioned**. Verifying a replacement supersedes the previous one and keeps it in history.

### 2. Death Aid collection and remittance

A Mayor marks which students paid, and the system derives the rest — no arithmetic by hand. Each submission gets an ID like `DA-2026-0001` and an append-only audit trail covering who collected, what was reported, what the SSG actually received, and who verified it.

A **discrepancy** never overwrites the reported figure. Both amounts are stored side by side, and the officer who spotted the difference is recorded.

Outstanding balances are **derived** from the latest filing per section, so a debt can never drift out of sync with the collection that created it.

### 3. AI document intelligence

Upload a document and it is read automatically — no button to press. The AI extracts and fills in the title, document number, issuing office, subject and author, then builds a **signature checklist** of the officials who must approve it.

- **An author never signs their own paper.** Names found beside *prepared by*, *drafted by*, *recorded by*, *compiled by* and similar are identified as the author and kept off the approval list.
- **Progress is measured over required signatures only**, so an optional observer cannot hold a document at 80%.
- **100% complete approves the document automatically.** Status cannot be typed in by hand on an unsigned paper.
- Status is one of **Pending**, **Under Review**, **Approved** — all three human-assignable.

Everything the AI produces is a *suggestion*. It is written to separate fields and becomes official only when a person ticks it and presses **Confirm selected**.

### 4. Dynamic per-user access

Roles grant default access. On top of that, an admin can grant or revoke any individual permission for a specific person without inventing a new role. Use it for cover when the workload spikes: hand someone roster verification for a week, then take it back.

### 5. Role-based access control

| Role | Submit roster | View rosters | Verify roster | View rosters registry | Record Death Aid | Accept remittance |
|---|---|---|---|---|---|---|
| admin | yes | yes | yes | yes | yes | yes |
| secretary | yes | yes | yes | yes | yes | yes |
| governor | yes | yes | no | yes | — | yes |
| representative | yes | yes | no | yes | — | yes |
| senator | yes | yes | no | yes | — | — |
| finance_secretary | — | — | — | — | yes | yes |
| member / guest | yes | no | no | no | — | — |

Mayors work as `guest` and need no role setup. A signed-out visitor can still submit a roster.

---

## Setup

### 1. Install

```bash
npm install
cd functions && npm install && cd ..
```

### 2. Configure

Copy the example file and fill in your values:

```bash
copy .env.example .env.local
copy functions\.env.example functions\.env
```

`functions/.env` holds the secrets and must **not** be prefixed with `VITE_`:

```
GEMINI_API_KEY=<your key>
GEMINI_MODEL=gemini-3.8-flash
OPENROUTER_API_KEY=<your key>
OPENROUTER_AI_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
```

> `gemini-2.5-flash` returns HTTP 404 for new Google projects. Use `gemini-3.8-flash`.

Then mirror it so the emulator starts faster and avoids a Secret Manager round trip:

```bash
copy functions\.env functions\.secret.local
```

Both files are gitignored. Never commit a key.

### 3. Run

```bash
npm run dev            # terminal 1 — the app
npm run emulators      # terminal 2 — Firestore, Storage, Auth, Functions
```

Or without the emulators, against real Firebase:

```bash
npm run dev
```

### 4. Verify

```bash
npm run preflight
```

Checks configuration, builds, emulator health, both AI providers, and the whole test suite. It names the broken link rather than letting you discover it as a browser error.

---

## Deployment

```bash
npx firebase deploy --only firestore:rules --project ssg-prototype
npx firebase deploy --only firestore:indexes --project ssg-prototype
npx firebase deploy --only storage:rules --project ssg-prototype
```

**Cloud Functions require the Blaze plan.** A Spark project cannot enable `cloudfunctions.googleapis.com`, so `firebase deploy --only functions` fails with a plan error. Until functions are deployed, the AI runs **only on your own machine** through the emulator.

Once deployed, remove the emulator flag from `.env.local` so production talks to the real backend:

```
VITE_USE_EMULATORS=true
VITE_EMULATOR_SERVICES=firestore,functions
```

---

## Limitations

Read these before trusting the system with real data.

**Access control is inert until the rules are deployed.** `firestore.rules` and `storage.rules` are enforced by the database, not by the UI. Until you run the deploy commands above, every permission check in this codebase is cosmetic.

**Cloud Functions need Blaze.** This is a hard Google limitation, not a configuration error. The AI is unusable for anyone but you until you upgrade.

**Document files are local.** With `VITE_FILE_STORE=local` (the default) binaries are held in **IndexedDB on the device that uploaded them**. They are not shared, are erased by clearing site data, and cannot be recovered. Set `VITE_FILE_STORE=firebase` and create a bucket before using this for real documents.

**Firestore emulator data does not survive a restart.** Roles and everything else vanish, which locks you out until you sign in again. The app auto-provisions a local admin profile when this happens — in development only, never in production.

**The AI needs a shared Firestore.** The Cloud Function reads the document back through the admin SDK, which follows `FIRESTORE_EMULATOR_HOST`. Firestore and Functions must both be emulated locally, or the function will not find documents the browser wrote.

**Rate limits are real.** Gemini's free tier allows roughly 15 requests/minute and 1,500/day, and each document costs up to three. That is about 500 documents a day, analysed sequentially. Gemini's allowance resets at midnight Pacific. The indicator shows the reset time and the day's estimated usage.

**The OpenRouter fallback is best-effort.** It uses a `:free` model whose availability changes without notice, and it intermittently returns prose instead of JSON. The transport retries and falls back, but do not treat it as a guarantee.

**AI output needs review.** The model has been observed computing a date the document never stated and duplicating a meeting date into a second field. Known issues are corrected in code, but classification, signatories and dates must be confirmed by a person before being treated as official.

**No end-to-end browser test has been run.** Everything is verified through scripts against the emulators and live APIs. The final link — a click in a real browser — is unproven.

**One API key is already compromised.** A key was pasted into a development chat and must be treated as exposed. Rotate it.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run preflight` | Full readiness check, names the broken link |
| `npm run dev` | Vite dev server |
| `npm run emulators` | Firestore, Storage, Auth and Functions emulators |
| `npm run build` | Production build |
| `npm run seed:role -- --list` | Show roles in the emulator database |
| `npm run seed:role -- --uid <uid> --role admin` | Grant a role locally |
| `npm run migrate:pdfs` | Move legacy Base64 PDFs into Storage (dry run) |
| `npm run verify:openrouter` | Check the OpenRouter key and model |
| `npm run test:ai` | Prompt and parsing logic |
| `npm run test:quota` | Daily quota and reset-time calculation |
| `npm run test:capacity` | Availability and daily capacity |
| `npm run test:phase3` | Human verification rules |
| `npm run test:fallback` | AI provider fallback policy |
| `npm run test:filestore` | Local IndexedDB file store |
| `npm run test:theme` | Theme token coverage |

Emulator-dependent suites (`test:rules`, `test:documents`, `test:storage-claims`, `test:claims-live`, `test:phase3-live`, `test:migration`) need the emulators running.

---

## Project structure

```
src/
  components/
    ClassUpload.jsx          Roster registry
    DeathAid.jsx             Collection and remittance workflow
    Document/                Document AI (dashboard, analysis panel, status badge)
    UserManagement/          Roles and per-user access
  services/
    documentService.js       Upload, metadata, labels
    documentAiService.js     Callable clients and the rate-limited queue
    fileStore/               Storage abstraction (IndexedDB or Cloud Storage)
    rosterService.js         Roster submit, verify, amend, withdraw
    deathAidService.js       Collections, remittances, outstanding
  utils/
    permissions.js           Roles, permission matrix, access checks
    documentLabels.js        Label taxonomy, document statuses, file rules
    aiCapacity.js            Provider availability and daily capacity
    themeStyles.js           Theme tokens shared by screens
    theme/                   Theme provider
  firebase/
    firebaseConfig.js
    emulators.js             Selective emulator redirection
functions/
  src/
    index.js                 Gemini callables
    prompts.js               Classifier, extractor and summarizer prompts
    gemini.js                Google Gemini transport
    providers/openrouter.js   OpenRouter transport
    ai/fallback.js           Provider fallback policy
scripts/                     Test and migration tooling
Markdownfiles/               Project documentation
```

---

## Documentation

Extended guides live in [`Markdownfiles/`](./Markdownfiles): deployment, database schema, Google OAuth setup, test plan and verification guide.

---

## Contributors

**Elijah Tugad** — Developer & Designer

---

_Last updated: October 2026_
