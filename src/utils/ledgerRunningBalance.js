/**
 * ledgerRunningBalance.js
 * Pure centavo-accurate utilities for the Append-Only Financial Ledger:
 *  - Multi-select fund pool filtering (PPMP [Fiscal & FSG], IGF, IGP, or any combination)
 *  - Direction filtering (All, Expenses Only, Inflows Only) & reversed-entry toggling
 *  - Chronological running balance trail (Before -> After) per fund account
 *  - Balance Decrement Bridge summary matching computeAuthoritativeFundBalanceCentavos()
 */

import { TOP_LEVEL_FUNDS, TRANSACTION_TYPES, TRANSACTION_STATUSES } from './financeConstants.js';
import {
  computeEffectiveFiscalCeilingCentavos,
  computeReversalBalanceDeltas,
  computeUnlinkedIgpCollectionsCentavos,
  isLegacyBogusFiscalInflow,
} from './financeLedgerReconciliation.js';

export const LEDGER_POOL_KEYS = Object.freeze({
  PPMP: 'PPMP',
  IGF: 'IGF',
  IGP: 'IGP',
});

export const LEDGER_POOL_ORDER = Object.freeze([
  LEDGER_POOL_KEYS.PPMP,
  LEDGER_POOL_KEYS.IGF,
  LEDGER_POOL_KEYS.IGP,
]);

export const LEDGER_POOL_META = Object.freeze({
  [LEDGER_POOL_KEYS.PPMP]: {
    key: LEDGER_POOL_KEYS.PPMP,
    label: 'PPMP',
    fullLabel: 'PPMP (Fiscal & FSG)',
    accountIds: ['fund_fiscal_year_budget', 'fund_fsg_remittance'],
  },
  [LEDGER_POOL_KEYS.IGF]: {
    key: LEDGER_POOL_KEYS.IGF,
    label: 'IGF',
    fullLabel: 'Internally Generated Fund (IGF)',
    accountIds: ['fund_igf_main'],
  },
  [LEDGER_POOL_KEYS.IGP]: {
    key: LEDGER_POOL_KEYS.IGP,
    label: 'IGP',
    fullLabel: 'Income Generating Project (IGP)',
    accountIds: ['fund_igp_main'],
  },
});

export const LEDGER_DIRECTIONS = Object.freeze({
  ALL: 'ALL',
  EXPENSES: 'EXPENSES',
  INFLOWS: 'INFLOWS',
});

const FISCAL_ACCOUNT_IDS = new Set(['fund_fiscal_year_budget', 'fund_fsg_remittance']);

function isFiscalOrFsgAccount(accountOrTx) {
  if (!accountOrTx) return false;
  const id = accountOrTx.fundAccountId || accountOrTx.id;
  const cat = accountOrTx.fundCategory || accountOrTx.topLevelCategory;
  return (
    FISCAL_ACCOUNT_IDS.has(id) ||
    cat === TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET ||
    cat === TOP_LEVEL_FUNDS.FSG_REMITTANCE
  );
}

/**
 * Resolves a transaction or fund account to one of the 3 filterable ledger pools:
 * 'PPMP' (Fiscal Year Budget & FSG Remittance), 'IGF', 'IGP', or 'OTHER'.
 */
export function resolveLedgerPool(accountOrTx) {
  if (!accountOrTx) return 'OTHER';
  if (isFiscalOrFsgAccount(accountOrTx)) return LEDGER_POOL_KEYS.PPMP;

  const id = accountOrTx.fundAccountId || accountOrTx.id;
  const cat = accountOrTx.fundCategory || accountOrTx.topLevelCategory;
  if (id === 'fund_igf_main' || cat === TOP_LEVEL_FUNDS.IGF) {
    return LEDGER_POOL_KEYS.IGF;
  }
  if (id === 'fund_igp_main' || cat === TOP_LEVEL_FUNDS.IGP) {
    return LEDGER_POOL_KEYS.IGP;
  }
  return 'OTHER';
}

/**
 * Toggles a pool key in a multi-select array.
 * Empty array `[]` represents "All Funds".
 * Selecting all 3 pools collapses back to `[]` ("All Funds").
 */
export function toggleLedgerPool(selectedPools = [], poolKey) {
  if (!poolKey || poolKey === 'ALL') return [];
  const validCurrent = (Array.isArray(selectedPools) ? selectedPools : []).filter((k) =>
    LEDGER_POOL_ORDER.includes(k)
  );
  const exists = validCurrent.includes(poolKey);
  const next = exists
    ? validCurrent.filter((k) => k !== poolKey)
    : [...validCurrent, poolKey];

  if (next.length === 0 || next.length >= LEDGER_POOL_ORDER.length) {
    return [];
  }
  return LEDGER_POOL_ORDER.filter((k) => next.includes(k));
}

/**
 * Extracts epoch milliseconds from Firestore Timestamp, Date, ISO string, or number.
 */
function extractTimestampMillis(value) {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value.toMillis === 'function') {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value.toDate === 'function') {
    const d = value.toDate();
    return d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : null;
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function collectReversedKeys(transactions = []) {
  const reversedIds = new Set();
  const reversedRefs = new Set();
  for (const tx of transactions) {
    if ((tx?.status || '').toLowerCase() === TRANSACTION_STATUSES.REVERSED) {
      if (tx.id) reversedIds.add(tx.id);
      if (tx.refNumber) reversedRefs.add(tx.refNumber);
    }
  }
  return { reversedIds, reversedRefs };
}

function isCollectionLikeReversal(tx) {
  const revType = String(tx?.reversedTransactionType || '').toLowerCase();
  return (
    (tx?.transactionType || '').toLowerCase() === TRANSACTION_TYPES.REVERSAL &&
    (revType === TRANSACTION_TYPES.COLLECTION ||
      revType === TRANSACTION_TYPES.RECEIPT ||
      tx?.source === 'MERCHANDISE_ORDER_REVERSAL' ||
      tx?.source === 'IGP_COLLECTION_REVERSAL')
  );
}

/**
 * Computes starting balance (in centavos) per fund account before chronological ledger replay,
 * matching computeAuthoritativeFundBalanceCentavos() in financeLedgerReconciliation.js.
 */
function computeAccountStartingBalances(transactions = [], fundAccounts = [], igpCollections = []) {
  const startMap = new Map();
  const accountList = Array.isArray(fundAccounts) ? fundAccounts.filter(Boolean) : [];
  const txList = Array.isArray(transactions) ? transactions.filter(Boolean) : [];

  for (const acc of accountList) {
    if (!acc.id) continue;
    if (isFiscalOrFsgAccount(acc)) {
      startMap.set(acc.id, computeEffectiveFiscalCeilingCentavos(acc, txList));
      continue;
    }

    const isIgp = acc.id === 'fund_igp_main' || acc.topLevelCategory === TOP_LEVEL_FUNDS.IGP;
    const hasAccountTxs = txList.some(
      (tx) => tx.fundAccountId === acc.id || tx.transferDestinationAccountId === acc.id
    );
    const unlinkedIgp = isIgp
      ? computeUnlinkedIgpCollectionsCentavos(txList, igpCollections)
      : 0;

    if (hasAccountTxs || unlinkedIgp > 0) {
      startMap.set(acc.id, unlinkedIgp);
    } else {
      startMap.set(acc.id, Math.max(0, Number(acc.balanceCentavos || 0)));
    }
  }

  return startMap;
}

/**
 * Computes the signed centavo impact of a single transaction on its source account
 * (and optional destination account for transfers) using the exact same rules as
 * computeDisbursedByAccount() for Fiscal/FSG and computeLedgerNetByAccount() for IGF/IGP.
 */
function resolveLedgerRowImpact(tx, reversedIds, reversedRefs, accountMap) {
  const statusLower = (tx?.status || '').toLowerCase();
  const txType = (tx?.transactionType || '').toLowerCase();
  const amount = Math.max(0, Math.round(Number(tx?.amountCentavos || 0)));
  const sourceAccount = accountMap.get(tx?.fundAccountId) || tx;
  const sourceIsFiscal = isFiscalOrFsgAccount(sourceAccount);

  const isStatusReversed = statusLower === TRANSACTION_STATUSES.REVERSED;
  const origKey = tx?.reversalOfTransactionId;
  const isPairedReversal =
    txType === TRANSACTION_TYPES.REVERSAL &&
    Boolean(origKey && (reversedIds.has(origKey) || reversedRefs.has(origKey)));

  if (statusLower !== TRANSACTION_STATUSES.POSTED) {
    return {
      sourceDeltaCentavos: 0,
      destinationDeltaCentavos: 0,
      isVoidedPair: isStatusReversed,
      isPairedReversal: false,
      isOutflow:
        txType === TRANSACTION_TYPES.EXPENSE ||
        txType === TRANSACTION_TYPES.PAYMENT ||
        txType === TRANSACTION_TYPES.REFUND ||
        txType === TRANSACTION_TYPES.TRANSFER ||
        isCollectionLikeReversal(tx),
    };
  }

  if (isPairedReversal) {
    return {
      sourceDeltaCentavos: 0,
      destinationDeltaCentavos: 0,
      isVoidedPair: true,
      isPairedReversal: true,
      isOutflow: isCollectionLikeReversal(tx),
    };
  }

  if (isLegacyBogusFiscalInflow(tx)) {
    return {
      sourceDeltaCentavos: 0,
      destinationDeltaCentavos: 0,
      isVoidedPair: false,
      isPairedReversal: false,
      isOutflow: false,
    };
  }

  if (sourceIsFiscal) {
    if (
      txType === TRANSACTION_TYPES.EXPENSE ||
      txType === TRANSACTION_TYPES.PAYMENT ||
      txType === TRANSACTION_TYPES.REFUND
    ) {
      return {
        sourceDeltaCentavos: -amount,
        destinationDeltaCentavos: 0,
        isVoidedPair: false,
        isPairedReversal: false,
        isOutflow: true,
      };
    }
    if (txType === TRANSACTION_TYPES.TRANSFER) {
      const destAcc = tx.transferDestinationAccountId
        ? accountMap.get(tx.transferDestinationAccountId)
        : null;
      const destIsFiscal = destAcc ? isFiscalOrFsgAccount(destAcc) : false;
      return {
        sourceDeltaCentavos: -amount,
        destinationDeltaCentavos:
          tx.transferDestinationAccountId && !destIsFiscal ? amount : 0,
        isVoidedPair: false,
        isPairedReversal: false,
        isOutflow: true,
      };
    }
    if (txType === TRANSACTION_TYPES.REVERSAL) {
      const isInflowRev = isCollectionLikeReversal(tx);
      return {
        sourceDeltaCentavos: !isInflowRev && amount > 0 ? amount : 0,
        destinationDeltaCentavos: 0,
        isVoidedPair: false,
        isPairedReversal: false,
        isOutflow: isInflowRev,
      };
    }
    return {
      sourceDeltaCentavos: 0,
      destinationDeltaCentavos: 0,
      isVoidedPair: false,
      isPairedReversal: false,
      isOutflow: false,
    };
  }

  // IGF & IGP (live ledger net)
  if (txType === TRANSACTION_TYPES.RECEIPT || txType === TRANSACTION_TYPES.COLLECTION) {
    return {
      sourceDeltaCentavos: amount,
      destinationDeltaCentavos: 0,
      isVoidedPair: false,
      isPairedReversal: false,
      isOutflow: false,
    };
  }
  if (
    txType === TRANSACTION_TYPES.EXPENSE ||
    txType === TRANSACTION_TYPES.PAYMENT ||
    txType === TRANSACTION_TYPES.REFUND
  ) {
    return {
      sourceDeltaCentavos: -amount,
      destinationDeltaCentavos: 0,
      isVoidedPair: false,
      isPairedReversal: false,
      isOutflow: true,
    };
  }
  if (txType === TRANSACTION_TYPES.ADJUSTMENT) {
    const signed =
      tx.deltaCentavos !== undefined ? Math.round(Number(tx.deltaCentavos)) : amount;
    return {
      sourceDeltaCentavos: signed,
      destinationDeltaCentavos: 0,
      isVoidedPair: false,
      isPairedReversal: false,
      isOutflow: signed < 0,
    };
  }
  if (txType === TRANSACTION_TYPES.TRANSFER) {
    const destAcc = tx.transferDestinationAccountId
      ? accountMap.get(tx.transferDestinationAccountId)
      : null;
    const destIsFiscal = destAcc ? isFiscalOrFsgAccount(destAcc) : false;
    return {
      sourceDeltaCentavos: -amount,
      destinationDeltaCentavos:
        tx.transferDestinationAccountId && !destIsFiscal ? amount : 0,
      isVoidedPair: false,
      isPairedReversal: false,
      isOutflow: true,
    };
  }
  if (txType === TRANSACTION_TYPES.REVERSAL) {
    const revType = String(tx.reversedTransactionType || '').toLowerCase();
    if (revType) {
      const { sourceDeltaCentavos, destinationDeltaCentavos } = computeReversalBalanceDeltas({
        transactionType: revType,
        amountCentavos: amount,
        deltaCentavos: tx.reversedDeltaCentavos,
        transferDestinationAccountId: tx.transferDestinationAccountId || null,
      });
      return {
        sourceDeltaCentavos,
        destinationDeltaCentavos,
        isVoidedPair: false,
        isPairedReversal: false,
        isOutflow: sourceDeltaCentavos < 0,
      };
    }
    return {
      sourceDeltaCentavos: -amount,
      destinationDeltaCentavos: 0,
      isVoidedPair: false,
      isPairedReversal: false,
      isOutflow: true,
    };
  }

  return {
    sourceDeltaCentavos: 0,
    destinationDeltaCentavos: 0,
    isVoidedPair: false,
    isPairedReversal: false,
    isOutflow: false,
  };
}

/**
 * Walks all valid ledger transactions chronologically (oldest -> newest) in integer centavos
 * and annotates every row with its per-account `beforeCentavos` -> `afterCentavos` trail.
 *
 * Returns rows in newest-first order (matching Firestore `createdAt desc`) by default,
 * plus the computed per-account `startingBalances` and `endingBalances` maps.
 */
export function computeLedgerRunningTrail(
  transactions = [],
  fundAccounts = [],
  igpCollections = []
) {
  const txList = Array.isArray(transactions) ? transactions.filter(Boolean) : [];
  const accountList = Array.isArray(fundAccounts) ? fundAccounts.filter(Boolean) : [];
  const accountMap = new Map(accountList.map((a) => [a.id, a]));
  const startingBalances = computeAccountStartingBalances(txList, accountList, igpCollections);
  const runningBalances = new Map(startingBalances);
  const { reversedIds, reversedRefs } = collectReversedKeys(txList);

  // Pair each tx with its original index (input is newest-first, so larger index = older)
  const indexed = txList.map((tx, originalIndex) => ({
    tx,
    originalIndex,
    timestampMs: extractTimestampMillis(tx.createdAt || tx.postedAt || tx.date),
  }));

  // Sort oldest -> newest deterministically
  indexed.sort((a, b) => {
    if (a.timestampMs !== null && b.timestampMs !== null && a.timestampMs !== b.timestampMs) {
      return a.timestampMs - b.timestampMs;
    }
    return b.originalIndex - a.originalIndex;
  });

  const trailByOriginalIndex = new Array(txList.length);

  for (let chronoIndex = 0; chronoIndex < indexed.length; chronoIndex += 1) {
    const { tx, originalIndex } = indexed[chronoIndex];
    const impact = resolveLedgerRowImpact(tx, reversedIds, reversedRefs, accountMap);
    const sourceId = tx.fundAccountId;
    const beforeSource = runningBalances.has(sourceId) ? runningBalances.get(sourceId) : 0;
    const afterSource = beforeSource + impact.sourceDeltaCentavos;
    if (sourceId) {
      runningBalances.set(sourceId, afterSource);
    }

    let destinationTrail = null;
    if (tx.transferDestinationAccountId) {
      const destId = tx.transferDestinationAccountId;
      const beforeDest = runningBalances.has(destId) ? runningBalances.get(destId) : 0;
      const afterDest = beforeDest + impact.destinationDeltaCentavos;
      runningBalances.set(destId, afterDest);
      destinationTrail = {
        accountId: destId,
        pool: resolveLedgerPool(accountMap.get(destId) || { fundAccountId: destId }),
        beforeCentavos: beforeDest,
        afterCentavos: afterDest,
        deltaCentavos: impact.destinationDeltaCentavos,
      };
    }

    trailByOriginalIndex[originalIndex] = {
      tx,
      chronoIndex,
      pool: resolveLedgerPool(accountMap.get(sourceId) || tx),
      beforeCentavos: beforeSource,
      afterCentavos: afterSource,
      effectiveDeltaCentavos: impact.sourceDeltaCentavos,
      isOutflow: impact.isOutflow,
      isVoidedPair: impact.isVoidedPair,
      isPairedReversal: impact.isPairedReversal,
      destinationTrail,
    };
  }

  return {
    rows: trailByOriginalIndex.filter(Boolean),
    startingBalances,
    endingBalances: runningBalances,
  };
}

/**
 * Filters annotated ledger trail rows by:
 *  - `selectedPools`: `[]` for All Funds, or any subset of `['PPMP', 'IGF', 'IGP']`
 *  - `direction`: `'ALL' | 'EXPENSES' | 'INFLOWS'`
 *  - `hideReversed`: hides reversed originals & paired reversal rows for clean decrement view
 *  - `sortOrder`: `'newest' | 'oldest'`
 */
export function filterLedgerTrail(
  trailRows = [],
  {
    selectedPools = [],
    direction = LEDGER_DIRECTIONS.ALL,
    hideReversed = false,
    sortOrder = 'newest',
  } = {}
) {
  const activePools = (Array.isArray(selectedPools) ? selectedPools : []).filter((k) =>
    LEDGER_POOL_ORDER.includes(k)
  );
  const filterByPool = activePools.length > 0 && activePools.length < LEDGER_POOL_ORDER.length;

  const filtered = (Array.isArray(trailRows) ? trailRows : []).filter((row) => {
    if (!row || !row.tx) return false;

    if (hideReversed) {
      const statusLower = (row.tx.status || '').toLowerCase();
      const txType = (row.tx.transactionType || '').toLowerCase();
      if (statusLower === TRANSACTION_STATUSES.REVERSED || row.isPairedReversal) {
        return false;
      }
      if (txType === TRANSACTION_TYPES.REVERSAL && row.effectiveDeltaCentavos === 0) {
        return false;
      }
    }

    const primaryMatches = !filterByPool || activePools.includes(row.pool);
    const destMatches =
      Boolean(row.destinationTrail) &&
      row.destinationTrail.deltaCentavos !== 0 &&
      (!filterByPool || activePools.includes(row.destinationTrail.pool));

    if (!primaryMatches && !destMatches) return false;

    if (direction === LEDGER_DIRECTIONS.EXPENSES) {
      // Only rows that act as outflows on a selected pool
      return primaryMatches && row.isOutflow;
    }

    if (direction === LEDGER_DIRECTIONS.INFLOWS) {
      // Rows that act as inflows on a selected pool (including inbound transfers)
      if (primaryMatches && !row.isOutflow) return true;
      if (destMatches && row.destinationTrail.deltaCentavos > 0) return true;
      return false;
    }

    return true;
  });

  if (sortOrder === 'oldest') {
    return [...filtered].sort((a, b) => a.chronoIndex - b.chronoIndex);
  }
  return [...filtered].sort((a, b) => b.chronoIndex - a.chronoIndex);
}

/**
 * Computes the Balance Decrement Bridge summary for the currently active pool filter:
 *   Starting/Ceiling (+ Inflows) - Expenses = Remaining Balance
 *
 * Also returns per-account snapshots so multi-fund views (e.g. IGF + IGP) remain transparent.
 */
export function computeLedgerBridgeSummary(
  trailResult,
  selectedPools = [],
  fundAccounts = []
) {
  const rows = trailResult?.rows || [];
  const startingBalances = trailResult?.startingBalances || new Map();
  const endingBalances = trailResult?.endingBalances || new Map();
  const activePools = (Array.isArray(selectedPools) ? selectedPools : []).filter((k) =>
    LEDGER_POOL_ORDER.includes(k)
  );
  const filterByPool = activePools.length > 0 && activePools.length < LEDGER_POOL_ORDER.length;

  const accountList = (Array.isArray(fundAccounts) ? fundAccounts.filter(Boolean) : []).filter(
    (acc) => {
      const pool = resolveLedgerPool(acc);
      if (pool === 'OTHER') return false;
      return !filterByPool || activePools.includes(pool);
    }
  );
  const scopedAccountIds = new Set(accountList.map((a) => a.id));

  let startingCentavos = 0;
  let remainingCentavos = 0;
  const perAccountSnapshots = accountList.map((acc) => {
    const start = Math.max(0, startingBalances.get(acc.id) || 0);
    const end = Math.max(0, endingBalances.get(acc.id) ?? start);
    startingCentavos += start;
    remainingCentavos += end;
    return {
      id: acc.id,
      name: acc.name || acc.id,
      pool: resolveLedgerPool(acc),
      startingCentavos: start,
      remainingCentavos: end,
    };
  });

  let inflowsCentavos = 0;
  let expensesCentavos = 0;
  let expenseCount = 0;
  let inflowCount = 0;

  for (const row of rows) {
    if (!row || !row.tx) continue;
    const statusLower = (row.tx.status || '').toLowerCase();
    if (statusLower !== TRANSACTION_STATUSES.POSTED) continue;

    if (scopedAccountIds.has(row.tx.fundAccountId)) {
      const delta = row.effectiveDeltaCentavos;
      if (delta < 0) {
        expensesCentavos += Math.abs(delta);
        expenseCount += 1;
      } else if (delta > 0) {
        const isFiscal = isFiscalOrFsgAccount(row.tx);
        if (isFiscal && (row.tx.transactionType || '').toLowerCase() === TRANSACTION_TYPES.REVERSAL) {
          // Expense reversal on Fiscal reduces disbursed expenses rather than inflating inflows
          expensesCentavos = Math.max(0, expensesCentavos - delta);
        } else {
          inflowsCentavos += delta;
          inflowCount += 1;
        }
      }
    }

    if (
      row.destinationTrail &&
      scopedAccountIds.has(row.destinationTrail.accountId) &&
      row.destinationTrail.deltaCentavos !== 0
    ) {
      const destDelta = row.destinationTrail.deltaCentavos;
      if (destDelta > 0) {
        inflowsCentavos += destDelta;
        inflowCount += 1;
      } else if (destDelta < 0) {
        expensesCentavos += Math.abs(destDelta);
        expenseCount += 1;
      }
    }
  }

  const totalAvailableCentavos = startingCentavos + inflowsCentavos;
  const spentPercent =
    totalAvailableCentavos > 0
      ? Math.min(100, Math.round((expensesCentavos / totalAvailableCentavos) * 1000) / 10)
      : 0;

  const scopeLabel = !filterByPool
    ? 'All Funds (PPMP + IGF + IGP)'
    : activePools.map((k) => LEDGER_POOL_META[k]?.label || k).join(' + ');

  return {
    scopeLabel,
    activePools: filterByPool ? activePools : LEDGER_POOL_ORDER,
    startingCentavos,
    inflowsCentavos,
    totalAvailableCentavos,
    expensesCentavos,
    remainingCentavos,
    expenseCount,
    inflowCount,
    spentPercent,
    perAccountSnapshots,
  };
}

/**
 * Computes per-pool entry counts (respecting direction & hideReversed) for chip badges.
 */
export function computeLedgerPoolCounts(
  trailRows = [],
  { direction = LEDGER_DIRECTIONS.ALL, hideReversed = false } = {}
) {
  const counts = {
    ALL: filterLedgerTrail(trailRows, { selectedPools: [], direction, hideReversed }).length,
    [LEDGER_POOL_KEYS.PPMP]: filterLedgerTrail(trailRows, {
      selectedPools: [LEDGER_POOL_KEYS.PPMP],
      direction,
      hideReversed,
    }).length,
    [LEDGER_POOL_KEYS.IGF]: filterLedgerTrail(trailRows, {
      selectedPools: [LEDGER_POOL_KEYS.IGF],
      direction,
      hideReversed,
    }).length,
    [LEDGER_POOL_KEYS.IGP]: filterLedgerTrail(trailRows, {
      selectedPools: [LEDGER_POOL_KEYS.IGP],
      direction,
      hideReversed,
    }).length,
  };
  return counts;
}
