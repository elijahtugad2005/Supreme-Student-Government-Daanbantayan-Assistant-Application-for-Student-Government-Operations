/**
 * financeLedgerReconciliation.js
 * Shared pure utilities for:
 *  - Filtering legacy bogus '+' inflows on Fiscal Year Budget & FSG Remittance
 *  - Computing live ledger-backed balances for IGF & IGP
 *  - Computing ceiling-minus-disbursed balances for Fiscal Year Budget & FSG Remittance
 *  - Resolving human-readable fund storage locations and receipt labels
 */

import { TOP_LEVEL_FUNDS, TRANSACTION_TYPES, TRANSACTION_STATUSES } from './financeConstants.js';

export const RECEIPT_LABELS = [
  'Food & Meals',
  'Event Preparation Consumables',
  'Office & Activity Supplies',
  'Merchandise & Supplier Production',
  'Equipment & Physical Assets',
  'Transportation & Logistics',
  'Services & Honoraria',
  'Other',
];

/**
 * Returns true if a transaction is a legacy/mistaken '+' inflow (receipt/collection)
 * on Fiscal Year Budget or FSG Remittance (e.g., the old +₱500,000 'Disbursement for INITIAL FISCAL BUDGET' test rows).
 * Fiscal Year Budget and FSG Remittance are set via Edit Budget/Balance and only deplete (-) in the ledger.
 */
export function isLegacyBogusFiscalInflow(tx) {
  if (!tx) return false;
  const isFiscalOrFsg =
    tx.fundAccountId === 'fund_fiscal_year_budget' ||
    tx.fundAccountId === 'fund_fsg_remittance' ||
    tx.fundCategory === TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET ||
    tx.fundCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE;
  if (!isFiscalOrFsg) return false;

  const txType = (tx.transactionType || '').toLowerCase();
  return txType === TRANSACTION_TYPES.RECEIPT || txType === TRANSACTION_TYPES.COLLECTION;
}

/**
 * Checks whether a fund account already has an explicit calibrated ceiling or balance stored.
 */
function hasStoredFiscalCalibration(fund) {
  if (!fund) return false;
  return Number(fund.appropriatedCeilingCentavos || 0) > 0 || Number(fund.balanceCentavos || 0) > 0;
}

/**
 * Filters a transaction list to hide legacy bogus '+' inflows on Fiscal/FSG
 * when no uncalibrated ledger fallback is needed (or when the account already
 * has an explicit calibrated ceiling/balance stored).
 */
export function filterValidLedgerTransactions(transactions = [], fundAccounts = null) {
  if (!Array.isArray(transactions)) return [];
  const accountMap = Array.isArray(fundAccounts)
    ? new Map(fundAccounts.filter(Boolean).map((acc) => [acc.id, acc]))
    : null;

  return transactions.filter((tx) => {
    if (!isLegacyBogusFiscalInflow(tx)) return true;
    if (!accountMap) return false;
    const matched = accountMap.get(tx.fundAccountId);
    // Keep ledger inflows visible when the Fiscal/FSG fund record is uncalibrated (0/0),
    // otherwise filter duplicate bogus inflows so Edit Fiscal Budget remains authoritative.
    return matched ? !hasStoredFiscalCalibration(matched) : false;
  });
}

/**
 * Computes net posted centavos per fundAccountId from ledger transactions.
 * Handles both reversal patterns without double-subtracting:
 *  - reverseTransaction(): marks original status='reversed' AND inserts a REVERSAL row referencing original ID
 *  - reverseOrderRevenueFromIGF(): leaves original status='posted' AND inserts a REVERSAL row (MERCHANDISE_ORDER_REVERSAL)
 * Ignores legacy bogus '+' inflows on Fiscal Year Budget & FSG Remittance.
 */
export function computeLedgerNetByAccount(transactions = []) {
  const netByAccount = new Map();
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return netByAccount;
  }

  const reversedIds = new Set();
  const reversedRefs = new Set();
  for (const tx of transactions) {
    const statusLower = (tx?.status || '').toLowerCase();
    if (statusLower === TRANSACTION_STATUSES.REVERSED) {
      if (tx.id) reversedIds.add(tx.id);
      if (tx.refNumber) reversedRefs.add(tx.refNumber);
    }
  }

  const addDelta = (accountId, deltaCentavos) => {
    if (!accountId || !Number.isFinite(deltaCentavos)) return;
    netByAccount.set(accountId, (netByAccount.get(accountId) || 0) + deltaCentavos);
  };

  for (const tx of transactions) {
    if (!tx || !tx.fundAccountId) continue;
    if (isLegacyBogusFiscalInflow(tx)) continue;

    const statusLower = (tx.status || '').toLowerCase();
    if (statusLower !== TRANSACTION_STATUSES.POSTED) continue;

    const amount = Number(tx.amountCentavos || 0);
    const txType = (tx.transactionType || '').toLowerCase();

    if (txType === TRANSACTION_TYPES.RECEIPT || txType === TRANSACTION_TYPES.COLLECTION) {
      addDelta(tx.fundAccountId, amount);
    } else if (
      txType === TRANSACTION_TYPES.EXPENSE ||
      txType === TRANSACTION_TYPES.PAYMENT ||
      txType === TRANSACTION_TYPES.REFUND
    ) {
      addDelta(tx.fundAccountId, -amount);
    } else if (txType === TRANSACTION_TYPES.ADJUSTMENT) {
      const delta = tx.deltaCentavos !== undefined ? Number(tx.deltaCentavos) : amount;
      addDelta(tx.fundAccountId, delta);
    } else if (txType === TRANSACTION_TYPES.TRANSFER) {
      addDelta(tx.fundAccountId, -amount);
      if (tx.transferDestinationAccountId) {
        addDelta(tx.transferDestinationAccountId, amount);
      }
    } else if (txType === TRANSACTION_TYPES.REVERSAL) {
      const origKey = tx.reversalOfTransactionId;
      const origAlreadyExcluded = origKey && (reversedIds.has(origKey) || reversedRefs.has(origKey));
      if (!origAlreadyExcluded) {
        addDelta(tx.fundAccountId, -amount);
      }
    }
  }

  return netByAccount;
}

/**
 * Computes total posted expense disbursements (in positive centavos) per fundAccountId.
 * Used by SSG Fiscal Year Budget and FSG Remittance so their headline balance equals:
 *   Initial Ceiling (set via Edit Budget/Balance) - Posted Ledger Disbursements
 */
export function computeDisbursedByAccount(transactions = []) {
  const disbursedMap = new Map();
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return disbursedMap;
  }

  for (const tx of transactions) {
    if (!tx || !tx.fundAccountId) continue;
    const statusLower = (tx.status || '').toLowerCase();
    if (statusLower !== TRANSACTION_STATUSES.POSTED) continue;

    const txType = (tx.transactionType || '').toLowerCase();
    if (
      txType === TRANSACTION_TYPES.EXPENSE ||
      txType === TRANSACTION_TYPES.PAYMENT ||
      txType === TRANSACTION_TYPES.REFUND
    ) {
      const amount = Number(tx.amountCentavos || 0);
      disbursedMap.set(tx.fundAccountId, (disbursedMap.get(tx.fundAccountId) || 0) + amount);
    }
  }

  return disbursedMap;
}

/**
 * Resolves the effective initial ceiling (in centavos) for a Fiscal Year Budget or FSG Remittance account:
 *  1. Explicit `appropriatedCeilingCentavos` (> 0) from Edit Fiscal Budget / Calibration
 *  2. Legacy `balanceCentavos` (> 0) if ceiling field was unset
 *  3. Recorded ledger inflows (posted receipt/collection/positive adjustment/inbound transfer)
 *     when both stored fields are 0/unset so ledger-recorded budgets never collapse to ₱0.00.
 */
export function computeEffectiveFiscalCeilingCentavos(fund, transactions = []) {
  if (!fund) return 0;
  if (fund.appropriatedCeilingCentavos !== undefined && Number(fund.appropriatedCeilingCentavos) > 0) {
    return Number(fund.appropriatedCeilingCentavos);
  }
  if (Number(fund.balanceCentavos || 0) > 0) {
    return Number(fund.balanceCentavos);
  }
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return 0;
  }

  let ledgerInflowCentavos = 0;
  for (const tx of transactions) {
    if (!tx) continue;
    const statusLower = (tx.status || '').toLowerCase();
    if (statusLower !== TRANSACTION_STATUSES.POSTED) continue;

    const txType = (tx.transactionType || '').toLowerCase();
    const amount = Number(tx.amountCentavos || 0);
    if (tx.fundAccountId === fund.id) {
      if (txType === TRANSACTION_TYPES.RECEIPT || txType === TRANSACTION_TYPES.COLLECTION) {
        ledgerInflowCentavos += amount;
      } else if (txType === TRANSACTION_TYPES.ADJUSTMENT) {
        const delta = tx.deltaCentavos !== undefined ? Number(tx.deltaCentavos) : amount;
        if (delta > 0) ledgerInflowCentavos += delta;
      }
    } else if (
      txType === TRANSACTION_TYPES.TRANSFER &&
      tx.transferDestinationAccountId === fund.id &&
      amount > 0
    ) {
      ledgerInflowCentavos += amount;
    }
  }

  return Math.max(0, ledgerInflowCentavos);
}

/**
 * Computes the authoritative card display balance (in centavos) for a fund account:
 *  - For Fiscal Year Budget & FSG Remittance: Effective Ceiling - Posted Ledger Disbursements
 *  - For IGF & IGP: Live Ledger Net (+Collections minus -Expenses) if ledger transactions exist for that account,
 *    otherwise fallback to fund.balanceCentavos.
 */
export function computeAuthoritativeFundBalanceCentavos(fund, transactions = []) {
  if (!fund) return 0;
  const isFiscalOrFsg =
    fund.id === 'fund_fiscal_year_budget' ||
    fund.id === 'fund_fsg_remittance' ||
    fund.topLevelCategory === TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET ||
    fund.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE;

  if (isFiscalOrFsg) {
    const ceilingCentavos = computeEffectiveFiscalCeilingCentavos(fund, transactions);
    const disbursedMap = computeDisbursedByAccount(transactions);
    const disbursedCentavos = disbursedMap.get(fund.id) || 0;
    return Math.max(0, ceilingCentavos - disbursedCentavos);
  }

  // IGF & IGP: directly reflect the posted ledger balance
  const hasAccountTxs = Array.isArray(transactions) && transactions.some(
    (tx) => tx?.fundAccountId === fund.id || tx?.transferDestinationAccountId === fund.id
  );
  if (hasAccountTxs) {
    const netMap = computeLedgerNetByAccount(transactions);
    return Math.max(0, netMap.get(fund.id) || 0);
  }
  return Math.max(0, Number(fund.balanceCentavos || 0));
}

/**
 * Determines storage location string for an order synced into IGF.
 */
export function inferOrderStorageLocation(order, fallbackLocation = 'Treasury Safe / Cash Box') {
  const method = (order?.paymentInfo?.paymentMethod || order?.paymentMethod || '').toLowerCase();
  const onlineType = order?.paymentInfo?.onlinePaymentType;
  if (method === 'online') {
    return onlineType ? `GCash / Online Holding (${onlineType})` : 'GCash / Online Holding Account';
  }
  if (method === 'cash') {
    return `${fallbackLocation} (Cash)`;
  }
  return fallbackLocation;
}

/**
 * Determines human-readable storage location for a ledger transaction row.
 */
export function inferTransactionStorageLocation(tx, fundAccount = null) {
  if (tx?.storageLocation && String(tx.storageLocation).trim() !== '') {
    return String(tx.storageLocation).trim();
  }
  const accountRef = fundAccount?.bankAccountReference;
  if (tx?.source === 'MERCHANDISE_ORDER' || tx?.source === 'MERCHANDISE_ORDER_REVERSAL') {
    return inferOrderStorageLocation(
      { paymentMethod: tx.paymentMethod },
      accountRef || 'Treasury Safe / Cash Box'
    );
  }
  if (accountRef) return accountRef;
  if (fundAccount?.holdingType === 'bank') return 'Institutional Bank Account';
  if (fundAccount?.holdingType === 'cash') return 'Treasury Safe / Cash Box';
  return 'General Treasury Holding';
}

/**
 * Dispatches an in-app event so FinanceProvider refreshes immediately after order/IGP/inventory mutations.
 */
export function notifyFinanceUpdated(detail = {}) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('ssg-finance-updated', { detail }));
  }
}
