/**
 * scripts/ledger-tx-modal-tdd.mjs
 *
 * TDD Suite for Streamlined Record Financial Transaction Modal & Receipt Fallback:
 * - Seam A: src/utils/ledgerTxFormHelpers.js
 *     1. deriveAllocationTxDefaults() auto-fills Amount, Resolution Ref & Description from selected PPMP allocation
 *     2. resolveReceiptUploadOutcome() handles Drive synced, GridFS-only (Drive unavailable),
 *        and inline compressed image fallback when backend/Drive is unreachable
 * - Seam B: src/components/Finance/FundGovernance.jsx & FundGovernance.module.css
 *     1. Wires auto-fill into both Budget Allocation dropdown and handleOpenTxForAllocation
 *     2. Uses sticky-footer compact modal layout (zero scrolling to reach Post to Ledger)
 *     3. Progressive disclosure for optional fields (Payee, Depository Location)
 *     4. Removes Unicode emoji icon in receipt header and surfaces graceful Drive-unavailable fallback
 *
 * Run: node scripts/ledger-tx-modal-tdd.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let failed = 0;
const results = [];
const check = (label, ok, detail = '') => {
  if (ok) {
    results.push(`ok   ${label}`);
  } else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
  }
};

console.log('=== Slice 1: Pure Allocation Auto-Fill Helper ===');
let helpers = null;
try {
  helpers = await import('../src/utils/ledgerTxFormHelpers.js');
} catch (err) {
  helpers = null;
  check('src/utils/ledgerTxFormHelpers.js module exists', false, err.message);
}

if (helpers) {
  check(
    'exports deriveAllocationTxDefaults and resolveReceiptUploadOutcome',
    typeof helpers.deriveAllocationTxDefaults === 'function' &&
      typeof helpers.resolveReceiptUploadOutcome === 'function'
  );

  // Raw Firestore allocation (e.g. RESOLUTION FOR COFFEE MAKER, Remaining: ₱100.00)
  const rawAlloc = {
    id: 'alloc-coffee-1',
    activityName: 'RESOLUTION FOR COFFEE MAKER',
    approvedAmountCentavos: 10000,
    spentAmountCentavos: 0,
    resolutionRef: 'RESOLUTION NO. 000',
  };

  const baseForm = {
    fundAccountId: 'fund_fiscal_year_budget',
    budgetAllocationId: '',
    amount: '',
    resolutionRef: '',
    description: '',
    descriptionAutoFilled: false,
  };

  const filled = helpers.deriveAllocationTxDefaults(rawAlloc, baseForm);
  check(
    'selecting allocation auto-fills Amount with exact remaining PHP (100.00)',
    filled.amount === '100.00' && filled.budgetAllocationId === 'alloc-coffee-1',
    `Got amount=${filled.amount}`
  );
  check(
    'selecting allocation auto-fills resolutionRef and description',
    filled.resolutionRef === 'RESOLUTION NO. 000' &&
      filled.description === 'Disbursement for RESOLUTION FOR COFFEE MAKER',
    JSON.stringify(filled)
  );

  // Partially spent allocation where ₱175.50 is ALREADY posted in the ledger -> Remaining: ₱324.50
  const partialAlloc = {
    id: 'alloc-partial-2',
    activityName: 'Intramurals Sound System',
    approvedAmountCentavos: 50000,
    spentAmountCentavos: 17550,
    resolutionRef: 'RES-2026-014',
  };
  const partialPostedMap = new Map([['alloc-partial-2', 17550]]);
  const switched = helpers.deriveAllocationTxDefaults(partialAlloc, filled, partialPostedMap);
  check(
    'when recorded spent is already posted to ledger, auto-fills remaining amount (324.50)',
    switched.amount === '324.50' &&
      switched.amountAutoFillSource === 'remaining' &&
      switched.resolutionRef === 'RES-2026-014' &&
      switched.description === 'Disbursement for Intramurals Sound System',
    JSON.stringify(switched)
  );

  // CRITICAL REGRESSION (User Screenshot): RESOLUTION FOR COFFEE MAKER
  // Approved ₱17,500.00, Disbursed (recorded spent) ₱17,400.00, Remaining ₱100.00, Ledger posted ₱0.00
  // Must auto-fill the unposted disbursed amount (17400.00), NOT remaining (100.00)!
  const coffeeMakerAlloc = {
    id: 'alloc-coffee-real',
    activityName: 'RESOLUTION FOR COFFEE MAKER',
    approvedAmountCentavos: 1750000,
    spentAmountCentavos: 1740000,
    resolutionRef: 'RESOLUTION NO. 000',
  };
  const coffeeFilled = helpers.deriveAllocationTxDefaults(coffeeMakerAlloc, baseForm, new Map());
  check(
    'auto-fills unposted DISBURSED amount (17400.00) instead of remaining (100.00) when recorded spent is not yet on ledger',
    coffeeFilled.amount === '17400.00' &&
      coffeeFilled.amountAutoFillSource === 'disbursed',
    JSON.stringify(coffeeFilled)
  );

  // Partial tranche already on ledger: ₱10,000 posted of ₱17,400 recorded spent -> auto-fills remaining unposted ₱7,400.00
  const coffeePartialLedger = helpers.deriveAllocationTxDefaults(
    coffeeMakerAlloc,
    baseForm,
    new Map([['alloc-coffee-real', 1000000]])
  );
  check(
    'auto-fills remaining unposted disbursed balance (7400.00) after partial ledger posting',
    coffeePartialLedger.amount === '7400.00' &&
      coffeePartialLedger.amountAutoFillSource === 'disbursed',
    JSON.stringify(coffeePartialLedger)
  );

  // Once full ₱17,400.00 IS posted to ledger, subsequent Post Expense auto-fills remaining ₱100.00
  const coffeeAfterLedger = helpers.deriveAllocationTxDefaults(
    coffeeMakerAlloc,
    baseForm,
    new Map([['alloc-coffee-real', 1740000]])
  );
  check(
    'once disbursed ₱17,400.00 is posted to ledger, next auto-fill switches cleanly to remaining ₱100.00',
    coffeeAfterLedger.amount === '100.00' &&
      coffeeAfterLedger.amountAutoFillSource === 'remaining',
    JSON.stringify(coffeeAfterLedger)
  );

  // Allocation 100% spent in BudgetForm (₱17,500 / ₱17,500) with ₱0 on ledger MUST still be postable
  const fullyRecordedUnposted = {
    id: 'alloc-full-unposted',
    activityName: 'Full Unposted Resolution',
    approvedAmountCentavos: 1750000,
    spentAmountCentavos: 1750000,
    status: 'approved',
  };
  const postingState =
    typeof helpers.computeAllocationLedgerPostingState === 'function'
      ? helpers.computeAllocationLedgerPostingState(fullyRecordedUnposted, 0)
      : null;
  check(
    '100% recorded-spent allocation with ₱0 on ledger remains eligible to post ₱17,500.00 without false depletion block',
    Boolean(
      postingState &&
        postingState.canPostToLedger === true &&
        postingState.unpostedDisbursedCentavos === 1750000 &&
        postingState.availableForLedgerPostingCentavos === 1750000
    ),
    JSON.stringify(postingState)
  );

  // Posting the unposted ₱17,400.00 must NOT double-count spentAmountCentavos to ₱34,800.00
  const nextSpentSame =
    typeof helpers.computeNextAllocationSpentCentavos === 'function'
      ? helpers.computeNextAllocationSpentCentavos({
          existingSpentCentavos: 1740000,
          ledgerPostedBeforeCentavos: 0,
          postedAmountCentavos: 1740000,
        })
      : -1;
  const nextSpentAdditional =
    typeof helpers.computeNextAllocationSpentCentavos === 'function'
      ? helpers.computeNextAllocationSpentCentavos({
          existingSpentCentavos: 1740000,
          ledgerPostedBeforeCentavos: 1740000,
          postedAmountCentavos: 10000,
        })
      : -1;
  check(
    'posting unposted ₱17,400.00 keeps spentAmountCentavos at ₱17,400.00 (zero double-counting), and posting +₱100.00 moves it to ₱17,500.00',
    nextSpentSame === 1740000 && nextSpentAdditional === 1750000,
    `nextSpentSame=${nextSpentSame}, nextSpentAdditional=${nextSpentAdditional}`
  );

  // Preserves custom user-typed description when switching allocations
  const withCustomDesc = helpers.deriveAllocationTxDefaults(
    partialAlloc,
    {
      ...filled,
      description: 'Paid supplier invoice #44 directly',
      descriptionAutoFilled: false,
    },
    partialPostedMap
  );
  check(
    'preserves custom user-typed description while still auto-filling remaining amount',
    withCustomDesc.amount === '324.50' &&
      withCustomDesc.description === 'Paid supplier invoice #44 directly',
    JSON.stringify(withCustomDesc)
  );

  // Mapped budget object from handleOpenTxForAllocation (unposted disbursed takes precedence over remaining)
  const mappedCoffeeRow = {
    id: 'alloc-coffee-real',
    eventName: 'RESOLUTION FOR COFFEE MAKER',
    allocated: 17500,
    spent: 17400,
    remaining: 100,
    ledgerPostedCentavos: 0,
    resolution: 'RESOLUTION NO. 000',
  };
  const fromCoffeeRow = helpers.deriveAllocationTxDefaults(mappedCoffeeRow, baseForm);
  check(
    'works with mapped budget row object (unposted spent ₱17,400 -> amount 17400.00)',
    fromCoffeeRow.amount === '17400.00' &&
      fromCoffeeRow.amountAutoFillSource === 'disbursed' &&
      fromCoffeeRow.resolutionRef === 'RESOLUTION NO. 000',
    JSON.stringify(fromCoffeeRow)
  );

  // Mapped budget object with ₱0 spent -> uses remaining ₱2,500.00
  const mappedBudget = {
    id: 'alloc-mapped-3',
    eventName: 'Leadership Seminar',
    allocated: 2500,
    spent: 0,
    remaining: 2500,
    resolution: 'RES-2026-022',
  };
  const fromRow = helpers.deriveAllocationTxDefaults(mappedBudget, baseForm);
  check(
    'works with mapped budget row object (fresh allocation -> amount 2500.00)',
    fromRow.amount === '2500.00' &&
      fromRow.resolutionRef === 'RES-2026-022' &&
      fromRow.description === 'Disbursement for Leadership Seminar',
    JSON.stringify(fromRow)
  );

  // Deselecting allocation resets auto-filled amount cleanly
  const cleared = helpers.deriveAllocationTxDefaults(null, filled);
  check(
    'deselecting allocation clears budgetAllocationId and auto-filled amount',
    cleared.budgetAllocationId === '' && cleared.amount === '',
    JSON.stringify(cleared)
  );

  console.log('\n=== Slice 2: Receipt Upload Resilience When Google Drive Is Unavailable ===');
  const fakeImageFile = { name: 'or-10492.jpg', type: 'image/jpeg', size: 120000 };
  const fakePdfFile = { name: 'invoice.pdf', type: 'application/pdf', size: 120000 };

  // Case 1: Google Drive synced normally
  const driveOk = await helpers.resolveReceiptUploadOutcome({
    file: fakeImageFile,
    meta: { title: 'Receipt' },
    uploadFn: async () => ({
      fileId: 'grid-1',
      filename: 'or-10492.jpg',
      driveWebViewLink: 'https://drive.google.com/file/d/xyz/view',
      downloadUrl: 'https://api.example.com/api/documents/grid-1/download',
    }),
    compressImageFn: async () => 'data:image/jpeg;base64,AAA',
  });
  check(
    'uses Google Drive link when Drive sync succeeds',
    driveOk.ok === true &&
      driveOk.mode === 'drive' &&
      driveOk.receiptDriveLink === 'https://drive.google.com/file/d/xyz/view',
    JSON.stringify(driveOk)
  );

  // Case 2: Backend GridFS succeeds, but Google Drive is disabled/unavailable (no driveWebViewLink)
  const gridfsFallback = await helpers.resolveReceiptUploadOutcome({
    file: fakeImageFile,
    meta: { title: 'Receipt' },
    uploadFn: async () => ({
      fileId: 'grid-2',
      filename: 'or-10492.jpg',
      driveWebViewLink: null,
      driveSyncStatus: 'disabled',
      downloadUrl: 'https://api.example.com/api/documents/grid-2/download',
    }),
    compressImageFn: async () => 'data:image/jpeg;base64,AAA',
  });
  check(
    'falls back cleanly to Document Storage URL when Google Drive is unavailable',
    gridfsFallback.ok === true &&
      gridfsFallback.mode === 'gridfs' &&
      gridfsFallback.receiptUrl === 'https://api.example.com/api/documents/grid-2/download' &&
      /Google Drive/i.test(gridfsFallback.notice),
    JSON.stringify(gridfsFallback)
  );

  // Case 3: Both Google Drive and upload backend throw network error on an image -> inline compressed fallback
  const inlineFallback = await helpers.resolveReceiptUploadOutcome({
    file: fakeImageFile,
    meta: { title: 'Receipt' },
    uploadFn: async () => {
      throw new Error('Network error uploading receipt to Google Drive backend.');
    },
    compressImageFn: async () => 'data:image/jpeg;base64,COMPRESSED_RECEIPT',
  });
  check(
    'attaches compressed receipt image inline when Google Drive & upload backend are unreachable',
    inlineFallback.ok === true &&
      inlineFallback.mode === 'inline_fallback' &&
      inlineFallback.receiptUrl === 'data:image/jpeg;base64,COMPRESSED_RECEIPT' &&
      /Google Drive/i.test(inlineFallback.notice),
    JSON.stringify(inlineFallback)
  );

  // Case 4: Backend unreachable for PDF -> returns actionable recovery guidance without crashing
  const pdfUnavailable = await helpers.resolveReceiptUploadOutcome({
    file: fakePdfFile,
    meta: { title: 'Receipt' },
    uploadFn: async () => {
      throw new Error('Network error');
    },
    compressImageFn: async () => 'data:image/jpeg;base64,SHOULD_NOT_RUN',
  });
  check(
    'gives actionable OR # / details recovery message for PDF when Drive/backend is unreachable',
    pdfUnavailable.ok === false &&
      pdfUnavailable.mode === 'unavailable' &&
      /OR #|receipt details/i.test(pdfUnavailable.error),
    JSON.stringify(pdfUnavailable)
  );
}

console.log('\n=== Slice 3: Per-Allocation Ledger Disbursement & Reversal Tracking ===');
{
  const reconciliation = await import('../src/utils/financeLedgerReconciliation.js');
  const hasFn = typeof reconciliation.computeDisbursedByAllocation === 'function';
  check('financeLedgerReconciliation exports computeDisbursedByAllocation', hasFn);
  if (hasFn) {
    const sampleTxs = [
      // Reversed mis-input ₱100.00 + its reversal entry -> net ₱0
      {
        id: 'tx-692',
        refNumber: 'TXN-846728-692',
        fundAccountId: 'fund_fiscal_year_budget',
        budgetAllocationId: 'alloc-coffee-real',
        transactionType: 'expense',
        amountCentavos: 10000,
        status: 'reversed',
      },
      {
        id: 'rev-692',
        refNumber: 'REV-TXN-846728-692',
        fundAccountId: 'fund_fiscal_year_budget',
        budgetAllocationId: 'alloc-coffee-real',
        transactionType: 'reversal',
        reversalOfTransactionId: 'tx-692',
        amountCentavos: 10000,
        status: 'posted',
      },
      // Active posted ₱17,400.00 on another allocation
      {
        id: 'tx-700',
        refNumber: 'TXN-900000-700',
        fundAccountId: 'fund_fiscal_year_budget',
        budgetAllocationId: 'alloc-other',
        transactionType: 'expense',
        amountCentavos: 1740000,
        status: 'posted',
      },
    ];
    const map = reconciliation.computeDisbursedByAllocation(sampleTxs);
    check(
      'computeDisbursedByAllocation ignores reversed TXN-846728-692 + REV pair (0) and tracks active ₱17,400.00',
      (map.get('alloc-coffee-real') || 0) === 0 && map.get('alloc-other') === 1740000,
      `coffee=${map.get('alloc-coffee-real')}, other=${map.get('alloc-other')}`
    );
  }

  const financeServiceSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/services/financeService.js'),
    'utf8'
  );
  check(
    'financeService.recordTransaction uses computeDisbursedByAllocation & computeNextAllocationSpentCentavos to avoid double-counting',
    financeServiceSrc.includes('computeDisbursedByAllocation') &&
      financeServiceSrc.includes('computeNextAllocationSpentCentavos')
  );
}

console.log('\n=== Slice 4: FundGovernance Modal UX & Impeccable Layout Contracts ===');
{
  const fundGovSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/components/Finance/FundGovernance.jsx'),
    'utf8'
  );
  const fundGovCss = fs.readFileSync(
    path.resolve(__dirname, '../src/components/Finance/FundGovernance.module.css'),
    'utf8'
  );

  check(
    'FundGovernance.jsx imports and uses deriveAllocationTxDefaults and resolveReceiptUploadOutcome',
    fundGovSrc.includes('deriveAllocationTxDefaults') &&
      fundGovSrc.includes('resolveReceiptUploadOutcome')
  );

  check(
    'FundGovernance.jsx uses sticky-footer compact modal classes (txModalDialog, txModalBody, txModalFooter)',
    fundGovSrc.includes('styles.txModalDialog') &&
      fundGovSrc.includes('styles.txModalBody') &&
      fundGovSrc.includes('styles.txModalFooter') &&
      fundGovCss.includes('.txModalDialog') &&
      fundGovCss.includes('.txModalFooter')
  );

  check(
    'FundGovernance.jsx tucks optional fields (Payee / Stored In) behind progressive disclosure (showOptionalTxFields)',
    fundGovSrc.includes('showOptionalTxFields')
  );

  check(
    'FundGovernance.jsx removes Unicode receipt emoji in modal header in favor of real icon',
    !fundGovSrc.includes('🧾 Receipt')
  );

  check(
    'FundGovernance.jsx renders Record Transaction modal via createPortal(document.body) with body scroll lock',
    fundGovSrc.includes('createPortal(') &&
      fundGovSrc.includes('document.body') &&
      fundGovSrc.includes("document.body.style.overflow = 'hidden'")
  );

  const dashboardCss = fs.readFileSync(
    path.resolve(__dirname, '../src/components/Finance/FinanceDashboard.module.css'),
    'utf8'
  );
  check(
    'FinanceDashboard.module.css .tabPane avoids persistent transform/forwards so position:fixed modals stay viewport-centered',
    !/tabPaneFadeIn\s+[^;]*forwards/i.test(dashboardCss)
  );
}

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\n✅ All checks passed.');
  process.exit(0);
}
