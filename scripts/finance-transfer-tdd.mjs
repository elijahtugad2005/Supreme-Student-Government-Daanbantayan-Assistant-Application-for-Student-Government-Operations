/**
 * scripts/finance-transfer-tdd.mjs
 *
 * TDD Suite for Critical Fix:
 *   TRANSFER Transactions Duplicate Funds Instead of Moving Them
 *
 * Covers all 5 diagnosed seams:
 *  1. Pure double-entry delta & conservation math (record & reverse TRANSFER)
 *  2. Shared validation rules (validateTransactionRules blocks overdraft, missing destination, self-transfer)
 *  3. Ledger reconciliation (computeLedgerNetByAccount, computeDisbursedByAccount, computeAuthoritativeFundBalanceCentavos)
 *     for posted TRANSFER and reversed TRANSFER across IGF/IGP and Fiscal/FSG
 *  4. Production service wiring in src/services/financeService.js:
 *     - recordTransaction debits source AND credits destination atomically, throws if dest missing
 *     - reverseTransaction pre-reads destRef before writes, credits source AND debits destination atomically,
 *       blocks reversal if destination has insufficient balance, and logs transferDestinationAccountId
 *
 * Run:
 *   node scripts/finance-transfer-tdd.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOP_LEVEL_FUNDS,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
} from '../src/utils/financeConstants.js';
import { validateTransactionRules } from '../src/utils/financeValidation.js';
import {
  computeLedgerNetByAccount,
  computeDisbursedByAccount,
  computeAuthoritativeFundBalanceCentavos,
} from '../src/utils/financeLedgerReconciliation.js';

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

console.log('=== Slice 1: Double-Entry Conservation Math for TRANSFER & Reversal ===');
{
  const reconciliation = await import('../src/utils/financeLedgerReconciliation.js');
  const hasDeltas =
    typeof reconciliation.computeTransactionBalanceDeltas === 'function' &&
    typeof reconciliation.computeReversalBalanceDeltas === 'function';
  check(
    'financeLedgerReconciliation exports computeTransactionBalanceDeltas and computeReversalBalanceDeltas',
    hasDeltas
  );

  if (hasDeltas) {
    // Recording ₱10,000 transfer from fund_igf_main (₱50,000) -> fund_igp_main (₱20,000)
    const postDeltas = reconciliation.computeTransactionBalanceDeltas({
      transactionType: TRANSACTION_TYPES.TRANSFER,
      amountCentavos: 1000000,
      fundAccountId: 'fund_igf_main',
      transferDestinationAccountId: 'fund_igp_main',
    });
    const afterSource = 5000000 + postDeltas.sourceDeltaCentavos;
    const afterDest = 2000000 + postDeltas.destinationDeltaCentavos;
    check(
      'TRANSFER debits source (-₱10,000 -> ₱40,000) and credits destination (+₱10,000 -> ₱30,000), conserving total ₱70,000',
      postDeltas.sourceDeltaCentavos === -1000000 &&
        postDeltas.destinationDeltaCentavos === 1000000 &&
        afterSource === 4000000 &&
        afterDest === 3000000 &&
        afterSource + afterDest === 7000000,
      JSON.stringify({ postDeltas, afterSource, afterDest })
    );

    // Reversing that ₱10,000 transfer restores exact original balances (₱50,000 & ₱20,000)
    const revDeltas = reconciliation.computeReversalBalanceDeltas({
      transactionType: TRANSACTION_TYPES.TRANSFER,
      amountCentavos: 1000000,
      fundAccountId: 'fund_igf_main',
      transferDestinationAccountId: 'fund_igp_main',
    });
    const restoredSource = afterSource + revDeltas.sourceDeltaCentavos;
    const restoredDest = afterDest + revDeltas.destinationDeltaCentavos;
    check(
      'Reversing TRANSFER credits source (+₱10,000 -> ₱50,000) and debits destination (-₱10,000 -> ₱20,000), conserving total ₱70,000',
      revDeltas.sourceDeltaCentavos === 1000000 &&
        revDeltas.destinationDeltaCentavos === -1000000 &&
        restoredSource === 5000000 &&
        restoredDest === 2000000 &&
        restoredSource + restoredDest === 7000000,
      JSON.stringify({ revDeltas, restoredSource, restoredDest })
    );

    // Non-transfer transactions preserve standard deltas
    const expDelta = reconciliation.computeTransactionBalanceDeltas({
      transactionType: TRANSACTION_TYPES.EXPENSE,
      amountCentavos: 50000,
    });
    const colDelta = reconciliation.computeTransactionBalanceDeltas({
      transactionType: TRANSACTION_TYPES.COLLECTION,
      amountCentavos: 50000,
    });
    const revColDelta = reconciliation.computeReversalBalanceDeltas({
      transactionType: TRANSACTION_TYPES.COLLECTION,
      amountCentavos: 50000,
    });
    check(
      'Non-transfer EXPENSE (-), COLLECTION (+), and COLLECTION reversal (-) deltas remain intact',
      expDelta.sourceDeltaCentavos === -50000 &&
        expDelta.destinationDeltaCentavos === 0 &&
        colDelta.sourceDeltaCentavos === 50000 &&
        colDelta.destinationDeltaCentavos === 0 &&
        revColDelta.sourceDeltaCentavos === -50000 &&
        revColDelta.destinationDeltaCentavos === 0
    );
  }
}

console.log('\n=== Slice 2: TRANSFER Validation Guards (Overdraft, Missing Destination, Self-Transfer) ===');
{
  const overdraftTransfer = validateTransactionRules({
    fundAccountId: 'fund_igf_main',
    fundCategory: TOP_LEVEL_FUNDS.IGF,
    transactionType: TRANSACTION_TYPES.TRANSFER,
    amountCentavos: 6000000, // ₱60,000 > ₱50,000 available
    availableBalanceCentavos: 5000000,
    transferDestinationAccountId: 'fund_igp_main',
  });
  check(
    'validateTransactionRules blocks TRANSFER exceeding source availableBalanceCentavos',
    overdraftTransfer.isValid === false &&
      overdraftTransfer.errors.some((e) => /not have enough available balance/i.test(e)),
    JSON.stringify(overdraftTransfer)
  );

  const missingDestTransfer = validateTransactionRules({
    fundAccountId: 'fund_igf_main',
    fundCategory: TOP_LEVEL_FUNDS.IGF,
    transactionType: TRANSACTION_TYPES.TRANSFER,
    amountCentavos: 1000000,
    availableBalanceCentavos: 5000000,
    transferDestinationAccountId: null,
  });
  check(
    'validateTransactionRules blocks TRANSFER without a destination fund account',
    missingDestTransfer.isValid === false &&
      missingDestTransfer.errors.some((e) => /destination/i.test(e)),
    JSON.stringify(missingDestTransfer)
  );

  const selfTransfer = validateTransactionRules({
    fundAccountId: 'fund_igf_main',
    fundCategory: TOP_LEVEL_FUNDS.IGF,
    transactionType: TRANSACTION_TYPES.TRANSFER,
    amountCentavos: 1000000,
    availableBalanceCentavos: 5000000,
    transferDestinationAccountId: 'fund_igf_main',
  });
  check(
    'validateTransactionRules blocks self-transfer (source === destination)',
    selfTransfer.isValid === false &&
      selfTransfer.errors.some((e) => /different|same/i.test(e)),
    JSON.stringify(selfTransfer)
  );

  const validTransfer = validateTransactionRules({
    fundAccountId: 'fund_igf_main',
    fundCategory: TOP_LEVEL_FUNDS.IGF,
    transactionType: TRANSACTION_TYPES.TRANSFER,
    amountCentavos: 1000000,
    availableBalanceCentavos: 5000000,
    transferDestinationAccountId: 'fund_igp_main',
  });
  check(
    'validateTransactionRules allows valid TRANSFER with sufficient balance and distinct destination',
    validTransfer.isValid === true,
    JSON.stringify(validTransfer)
  );
}

console.log('\n=== Slice 3: Ledger Reconciliation Conservation for Posted & Reversed Transfers ===');
{
  const igfAcc = { id: 'fund_igf_main', topLevelCategory: TOP_LEVEL_FUNDS.IGF, balanceCentavos: 4000000 };
  const igpAcc = { id: 'fund_igp_main', topLevelCategory: TOP_LEVEL_FUNDS.IGP, balanceCentavos: 3000000 };
  const fsgAcc = {
    id: 'fund_fsg_remittance',
    topLevelCategory: TOP_LEVEL_FUNDS.FSG_REMITTANCE,
    appropriatedCeilingCentavos: 10000000, // ₱100,000
    balanceCentavos: 9000000,
  };

  // Seed: IGF collected ₱50k, IGP collected ₱20k, then ₱10k transferred IGF -> IGP
  const txsPosted = [
    {
      id: 'tx-1',
      fundAccountId: 'fund_igf_main',
      transactionType: TRANSACTION_TYPES.COLLECTION,
      amountCentavos: 5000000,
      status: TRANSACTION_STATUSES.POSTED,
    },
    {
      id: 'tx-2',
      fundAccountId: 'fund_igp_main',
      transactionType: TRANSACTION_TYPES.COLLECTION,
      amountCentavos: 2000000,
      status: TRANSACTION_STATUSES.POSTED,
    },
    {
      id: 'tx-xfer',
      refNumber: 'TXN-XFER-1',
      fundAccountId: 'fund_igf_main',
      transferDestinationAccountId: 'fund_igp_main',
      transactionType: TRANSACTION_TYPES.TRANSFER,
      amountCentavos: 1000000,
      status: TRANSACTION_STATUSES.POSTED,
    },
  ];

  const netPosted = computeLedgerNetByAccount(txsPosted);
  check(
    'Ledger reconciliation moves ₱10k cleanly (IGF=₱40k, IGP=₱30k, Total=₱70k)',
    netPosted.get('fund_igf_main') === 4000000 &&
      netPosted.get('fund_igp_main') === 3000000 &&
      computeAuthoritativeFundBalanceCentavos(igfAcc, txsPosted) === 4000000 &&
      computeAuthoritativeFundBalanceCentavos(igpAcc, txsPosted) === 3000000,
    JSON.stringify({ igf: netPosted.get('fund_igf_main'), igp: netPosted.get('fund_igp_main') })
  );

  // Reverse the transfer: original marked REVERSED + REVERSAL audit row
  const txsReversed = [
    txsPosted[0],
    txsPosted[1],
    { ...txsPosted[2], status: TRANSACTION_STATUSES.REVERSED },
    {
      id: 'rev-xfer',
      refNumber: 'REV-TXN-XFER-1',
      reversalOfTransactionId: 'tx-xfer',
      reversedTransactionType: TRANSACTION_TYPES.TRANSFER,
      fundAccountId: 'fund_igf_main',
      transferDestinationAccountId: 'fund_igp_main',
      transactionType: TRANSACTION_TYPES.REVERSAL,
      amountCentavos: 1000000,
      status: TRANSACTION_STATUSES.POSTED,
    },
  ];
  const netReversed = computeLedgerNetByAccount(txsReversed);
  check(
    'Ledger reconciliation after TRANSFER reversal restores exact original balances (IGF=₱50k, IGP=₱20k, Total=₱70k)',
    netReversed.get('fund_igf_main') === 5000000 && netReversed.get('fund_igp_main') === 2000000,
    JSON.stringify({ igf: netReversed.get('fund_igf_main'), igp: netReversed.get('fund_igp_main') })
  );

  // Outbound TRANSFER from FSG (₱100k ceiling) -> IGP (₱10k) reduces FSG authoritative balance to ₱90k
  const fsgTransferTxs = [
    {
      id: 'tx-fsg-xfer',
      fundAccountId: 'fund_fsg_remittance',
      transferDestinationAccountId: 'fund_igp_main',
      transactionType: TRANSACTION_TYPES.TRANSFER,
      amountCentavos: 1000000,
      status: TRANSACTION_STATUSES.POSTED,
    },
  ];
  const disbursedMap = computeDisbursedByAccount(fsgTransferTxs);
  const fsgAuthBal = computeAuthoritativeFundBalanceCentavos(fsgAcc, fsgTransferTxs);
  check(
    'computeDisbursedByAccount counts outbound TRANSFER from FSG/Fiscal (disbursed=₱10k -> FSG balance=₱90k)',
    disbursedMap.get('fund_fsg_remittance') === 1000000 && fsgAuthBal === 9000000,
    `disbursed=${disbursedMap.get('fund_fsg_remittance')}, fsgAuthBal=${fsgAuthBal}`
  );
}

console.log('\n=== Slice 4: financeService.js Production Wiring Contracts ===');
{
  const svcSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/services/financeService.js'),
    'utf8'
  );

  // Slice out recordTransaction and reverseTransaction bodies
  const recordIdx = svcSrc.indexOf('async recordTransaction(');
  const reverseIdx = svcSrc.indexOf('async reverseTransaction(');
  const afterReverseIdx = svcSrc.indexOf('async createPreOrderBatch(');
  const recordBody = svcSrc.slice(recordIdx, reverseIdx);
  const reverseBody = svcSrc.slice(reverseIdx, afterReverseIdx);

  check(
    'recordTransaction uses computeTransactionBalanceDeltas (debits source on TRANSFER) and rejects missing destination fund',
    recordBody.includes('computeTransactionBalanceDeltas') &&
      recordBody.includes('transferDestinationAccountId') &&
      /Destination fund account not found/i.test(recordBody),
    'recordTransaction must use computeTransactionBalanceDeltas and throw when destSnap does not exist'
  );

  check(
    'recordTransaction passes fundAccountId and transferDestinationAccountId to validateTransactionRules',
    recordBody.includes('fundAccountId,') &&
      recordBody.includes('transferDestinationAccountId,')
  );

  check(
    'reverseTransaction pre-reads destRef for TRANSFER, uses computeReversalBalanceDeltas, debits destination, and guards destination balance',
    reverseBody.includes('computeReversalBalanceDeltas') &&
      reverseBody.includes('orig.transferDestinationAccountId') &&
      reverseBody.includes('destRef') &&
      /insufficient balance/i.test(reverseBody) &&
      reverseBody.includes('transferDestinationAccountId: orig.transferDestinationAccountId'),
    'reverseTransaction must pre-read destRef, debit destination atomically, guard insufficient balance, and record transferDestinationAccountId'
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
