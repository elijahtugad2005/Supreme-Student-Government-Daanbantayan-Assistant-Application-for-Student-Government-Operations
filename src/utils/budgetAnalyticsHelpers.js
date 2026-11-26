// utils/budgetAnalyticsHelpers.js
// PURPOSE: Pure, testable aggregation and filtering seams for Financial Analytics,
// PPMP Matrix KPIs, and IGP telemetry.

import { isBudgetFSG, isBudgetIGF, isBudgetIGP } from './fundClassifier.js';

/**
 * Compute authoritative FinanceProvider KPI statistics from active budgets:
 *  - Excludes unapproved `draft` budgets from allocated/spent/reserve totals.
 *  - Strictly segregates FSG, IGF, and IGP so enterprise funds NEVER leak into
 *    `fiscalAllocated`, `fiscalSpent`, or `fiscalUnallocatedReserve`.
 */
export function computeBudgetStatistics(
  activeBudgets = [],
  { fiscalCeiling = 0, fiscalHolding = 0, igfBalance = 0, igpBalance = 0 } = {}
) {
  let totalAlloc = 0;
  let totalSp = 0;
  let fiscalAllocated = 0;
  let fiscalSpent = 0;
  let fsgAllocated = 0;
  let fsgSpent = 0;
  let approvedCount = 0;
  const catMap = {};
  const comMap = {};

  for (const b of activeBudgets || []) {
    if (!b) continue;
    const statusLower = String(b.status || '').toLowerCase();
    if (statusLower === 'draft' || statusLower === 'archived' || b.isArchived) {
      continue;
    }

    const allocated = Number(b.allocated) || 0;
    const spent = Number(b.spent) || 0;
    approvedCount += 1;
    totalAlloc += allocated;
    totalSp += spent;

    if (isBudgetFSG(b)) {
      fsgAllocated += allocated;
      fsgSpent += spent;
    } else if (!isBudgetIGF(b) && !isBudgetIGP(b)) {
      fiscalAllocated += allocated;
      fiscalSpent += spent;
    }

    const cat = b.category || 'Uncategorized';
    const com = b.committee || 'General';
    catMap[cat] = (catMap[cat] || 0) + allocated;
    comMap[com] = (comMap[com] || 0) + allocated;
  }

  return {
    totalAllocated: totalAlloc,
    totalSpent: totalSp,
    totalRemaining: Math.max(0, totalAlloc - totalSp),
    fiscalAllocated,
    fiscalSpent,
    fiscalRemaining: Math.max(0, fiscalAllocated - fiscalSpent),
    fiscalCeiling,
    fiscalHolding,
    fiscalUnallocatedReserve: Math.max(0, fiscalCeiling - fiscalAllocated),
    fsgAllocated,
    fsgSpent,
    fsgRemaining: Math.max(0, fsgAllocated - fsgSpent),
    igfBalance,
    igpBalance,
    budgetCount: approvedCount,
    categories: catMap,
    committees: comMap,
  };
}

/**
 * Derive human-readable budget utilization health status used by BudgetAnalytics
 * filters and status pills (matches 'On Track', 'Almost Spent', 'Fully Spent',
 * 'Over Budget', and 'Draft').
 */
export function deriveBudgetHealthStatus(budget = {}) {
  const rawStatus = String(budget?.status || '').toLowerCase();
  if (rawStatus === 'draft') return 'Draft';
  if (rawStatus === 'archived' || budget?.isArchived) return 'Archived';

  const allocated = Number(budget?.allocated) || 0;
  const spent = Number(budget?.spent) || 0;
  if (allocated <= 0) return spent > 0 ? 'Over Budget' : 'On Track';
  if (spent > allocated) return 'Over Budget';
  if (spent >= allocated) return 'Fully Spent';
  if (spent / allocated >= 0.8) return 'Almost Spent';
  return 'On Track';
}

/**
 * Filter BudgetAnalytics rows safely (null-safe search + utilization health status).
 */
export function filterAnalyticsBudgets(
  budgets = [],
  { searchTerm = '', filterFund = 'All', filterCommittee = 'All', filterStatus = 'All' } = {}
) {
  const needle = String(searchTerm || '').toLowerCase().trim();
  return (budgets || []).filter((budget) => {
    if (!budget) return false;
    const matchesSearch =
      !needle ||
      String(budget.eventName || '').toLowerCase().includes(needle) ||
      String(budget.resolution || '').toLowerCase().includes(needle) ||
      String(budget.category || '').toLowerCase().includes(needle);

    const matchesCommittee =
      filterCommittee === 'All' || (budget.committee || 'General') === filterCommittee;

    const healthStatus = deriveBudgetHealthStatus(budget);
    const matchesStatus = filterStatus === 'All' || healthStatus === filterStatus;

    const isFSG = isBudgetFSG(budget);
    const isIGF = isBudgetIGF(budget);
    const isIGP = isBudgetIGP(budget);
    const isFiscal =
      (!isFSG && !isIGF && !isIGP) || budget.fundAccountId === 'fund_fiscal_year_budget';

    let matchesFund = true;
    if (filterFund === 'fund_fiscal_year_budget') matchesFund = isFiscal;
    else if (filterFund === 'fund_fsg_remittance') matchesFund = isFSG;
    else if (filterFund === 'fund_igf_main') matchesFund = isIGF;
    else if (filterFund === 'fund_igp_main') matchesFund = isIGP;

    return matchesSearch && matchesCommittee && matchesStatus && matchesFund;
  });
}

/**
 * Derive sorted unique committee list dynamically from actual budgets.
 */
export function extractUniqueCommittees(budgets = []) {
  const set = new Set();
  for (const b of budgets || []) {
    const com = String(b?.committee || '').trim();
    if (com) set.add(com);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function escapeCsvCell(value) {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Build RFC-4180 compliant CSV content for BudgetAnalytics exports.
 */
export function buildBudgetCsvContent(rows = []) {
  const headers = [
    'Event Name',
    'Fund Source',
    'Category',
    'Committee',
    'Allocated',
    'Spent',
    'Remaining',
    'Status',
  ];
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...(rows || []).map((b) =>
      [
        b?.eventName || 'Unnamed Allocation',
        b?.fundName || (isBudgetFSG(b) ? 'FSG Remittance' : 'Fiscal Year Budget'),
        b?.category || 'Uncategorized',
        b?.committee || 'General',
        Number(b?.allocated) || 0,
        Number(b?.spent) || 0,
        Number(b?.remaining) || 0,
        deriveBudgetHealthStatus(b),
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];
  return lines.join('\n');
}

/**
 * Build ISO-date CSV filename without OS-illegal slashes.
 */
export function buildCsvFilename(date = new Date()) {
  const isoDate = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
  return `Budget_Report_${isoDate}.csv`;
}

/**
 * Resolve centavo amount from an IGP collection record, supporting legacy `amountPHP`-only docs.
 */
export function resolveCollectionCentavos(collection = {}) {
  if (
    collection?.amountCentavos !== undefined &&
    collection?.amountCentavos !== null &&
    Number.isFinite(Number(collection.amountCentavos))
  ) {
    return Math.round(Number(collection.amountCentavos));
  }
  if (
    collection?.amountPHP !== undefined &&
    collection?.amountPHP !== null &&
    Number.isFinite(Number(collection.amountPHP))
  ) {
    return Math.round(Number(collection.amountPHP) * 100);
  }
  return 0;
}

/**
 * Build real IGP enterprise chart buckets from live `igpCollections` (never fabricated ratios).
 */
export function buildIgpEnterpriseChartData(igpCollections = []) {
  const grouped = new Map();
  const labels = {
    vending_machine: 'Vending Machines',
    locker_rental: 'Campus Lockers',
    future_igp: 'Custom IGP Projects',
  };

  for (const c of igpCollections || []) {
    if (!c) continue;
    const centavos = resolveCollectionCentavos(c);
    if (centavos <= 0) continue;
    const name = labels[c.projectType] || c.projectName || 'Other IGP';
    grouped.set(name, (grouped.get(name) || 0) + centavos);
  }

  return Array.from(grouped.entries())
    .map(([name, centavos]) => {
      const php = Math.round(centavos) / 100;
      return { name, allocated: php, spent: 0, value: php };
    })
    .sort((a, b) => b.allocated - a.allocated);
}

/**
 * Normalizes an IGF ledger transaction into a clean product/expense category bucket
 * instead of creating one chart bar/slice per individual merchandise order ID.
 * Examples:
 *  - "Merchandise Sales Revenue: SSGDB-001 - CTU UNIFORMS (x1)" -> "CTU Uniforms"
 *  - "Merchandise Sales Revenue: ORD-DB-0001 - Unified CTU-DB Lanyard (CoEd, CoTE) (x1)" -> "Unified CTU-DB Lanyard (CoEd, CoTE)"
 *  - receiptLabel: "Food & Meals" -> "Food & Meals"
 */
export function normalizeIgfTransactionBucket(tx = {}) {
  const explicitLabel = String(tx?.receiptLabel || tx?.category || '').trim();
  if (explicitLabel) return explicitLabel;

  let raw = String(tx?.productName || tx?.description || '').trim();
  if (!raw) return 'IGF Merchandise';

  // Strip common merchandise sync prefixes & unique order IDs
  raw = raw
    .replace(/^merchandise\s+sales\s+revenue\s*:\s*/i, '')
    .replace(/^online\s+checkout\s+order\s*#?[\w-]+\s*[-–:]*\s*/i, '')
    .replace(/^order\s*#?[\w-]+\s*[-–:]*\s*/i, '')
    .replace(/^(?:ORD|SSG)[A-Z0-9-]*\s*[-–:]\s*/i, '')
    .replace(/\s*\((?:gcash|maya|online)\s+ref:[^)]*\)\s*$/i, '')
    .replace(/\s*\(x\d+\)\s*$/i, '')
    .replace(/\s+x\d+\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) return 'IGF Merchandise';

  // Convert pure ALL-CAPS strings (e.g. "CTU UNIFORMS") to clean Title Case while keeping acronyms
  if (raw === raw.toUpperCase() && /[A-Z]{4,}/.test(raw)) {
    const acronyms = new Set(['CTU', 'SSG', 'IGF', 'IGP', 'FSG', 'PPMP', 'COED', 'COTE', 'BSIT', 'BSHM', 'DB']);
    raw = raw
      .split(' ')
      .map((word) => {
        const clean = word.replace(/[^A-Z0-9]/g, '');
        if (acronyms.has(clean)) return word;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }

  return raw;
}

/**
 * Caps chart data arrays to `maxBuckets` top entries by value/allocated,
 * rolling remaining tail entries into a single "Other" bucket while conserving exact totals.
 */
export function rollupTopChartBuckets(items = [], maxBuckets = 7) {
  const sorted = [...(items || [])]
    .filter(Boolean)
    .sort((a, b) => (Number(b.value ?? b.allocated) || 0) - (Number(a.value ?? a.allocated) || 0));

  if (sorted.length <= maxBuckets) return sorted;

  const top = sorted.slice(0, maxBuckets);
  const rest = sorted.slice(maxBuckets);

  let otherAllocatedCentavos = 0;
  let otherSpentCentavos = 0;
  let otherValueCentavos = 0;

  for (const item of rest) {
    otherAllocatedCentavos += Math.round((Number(item.allocated) || 0) * 100);
    otherSpentCentavos += Math.round((Number(item.spent) || 0) * 100);
    otherValueCentavos += Math.round((Number(item.value ?? item.allocated) || 0) * 100);
  }

  top.push({
    name: `Other (${rest.length})`,
    allocated: otherAllocatedCentavos / 100,
    spent: otherSpentCentavos / 100,
    value: otherValueCentavos / 100,
  });

  return top;
}

/**
 * Build real IGF enterprise chart buckets from live posted `fund_igf_main` ledger transactions.
 * Groups individual merchandise orders by normalized product/category name and rolls up long tails.
 */
export function buildIgfEnterpriseChartData(transactions = [], { maxBuckets = 7 } = {}) {
  const grouped = new Map();

  for (const tx of transactions || []) {
    if (!tx) continue;
    if (tx.fundAccountId !== 'fund_igf_main' && tx.fundCategory !== 'IGF') continue;
    const status = String(tx.status || '').toLowerCase();
    const txType = String(tx.transactionType || '').toLowerCase();
    if (status === 'reversed' || txType === 'reversal') continue;

    const centavos = Math.abs(Number(tx.amountCentavos) || 0);
    if (centavos <= 0) continue;

    const label = normalizeIgfTransactionBucket(tx);
    const key = label.toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, { name: label, inflowCentavos: 0, outflowCentavos: 0 });
    }
    const entry = grouped.get(key);
    const isInflow = txType === 'collection' || txType === 'receipt' || txType === 'income';
    if (isInflow) entry.inflowCentavos += centavos;
    else entry.outflowCentavos += centavos;
  }

  const buckets = Array.from(grouped.values()).map(({ name, inflowCentavos, outflowCentavos }) => {
    const allocated = Math.round(inflowCentavos) / 100;
    const spent = Math.round(outflowCentavos) / 100;
    return { name, allocated, spent, value: allocated || spent };
  });

  return rollupTopChartBuckets(buckets, maxBuckets);
}

/**
 * Filter a budget list to PPMP-eligible (Fiscal / FSG) allocations matching `activeFundSource`
 * ('ALL' | 'FISCAL' | 'FSG'). Strictly excludes IGF and IGP enterprise budgets.
 */
export function filterPpmpEligibleBudgets(
  sourceList = [],
  { activeFundSource = 'ALL', includeArchived = false } = {}
) {
  return (sourceList || []).filter((b) => {
    if (!b) return false;
    if (!includeArchived) {
      if (
        b.status === 'archived' ||
        b.isActive === false ||
        b.isArchived === true ||
        b.raw?.status === 'archived' ||
        b.raw?.isActive === false
      ) {
        return false;
      }
    }
    if (isBudgetIGF(b) || isBudgetIGP(b)) return false;

    const fundId =
      b.fundAccountId ||
      b.raw?.fundAccountId ||
      (b.isFSG ? 'fund_fsg_remittance' : 'fund_fiscal_year_budget');
    if (fundId === 'fund_igf_main' || fundId === 'fund_igp_main') return false;

    if (activeFundSource === 'FISCAL') {
      return fundId === 'fund_fiscal_year_budget' && !isBudgetFSG(b);
    }
    if (activeFundSource === 'FSG') {
      return fundId === 'fund_fsg_remittance' || isBudgetFSG(b);
    }
    return fundId === 'fund_fiscal_year_budget' || fundId === 'fund_fsg_remittance' || isBudgetFSG(b);
  });
}

/**
 * Compute PPMP Matrix status pill counts strictly scoped to `activeFundSource`
 * and excluding IGF/IGP enterprise records.
 */
export function computePpmpStatusCounts(
  budgets = [],
  archivedBudgets = [],
  activeFundSource = 'ALL'
) {
  const activeScoped = filterPpmpEligibleBudgets(budgets, {
    activeFundSource,
    includeArchived: false,
  });
  const archivedScoped = filterPpmpEligibleBudgets(archivedBudgets, {
    activeFundSource,
    includeArchived: true,
  });

  const counts = {
    ALL: activeScoped.length,
    fresh: 0,
    partially_used: 0,
    depleted: 0,
    archived: archivedScoped.length,
  };

  for (const item of activeScoped) {
    if (item.ppmpStatus === 'fresh') counts.fresh += 1;
    else if (item.ppmpStatus === 'partially_used') counts.partially_used += 1;
    else if (item.ppmpStatus === 'depleted') counts.depleted += 1;
  }

  return counts;
}

/**
 * Compute IGP Project Manager summary metrics supporting both `amountCentavos`
 * and legacy `amountPHP`-only collection documents.
 */
export function computeIgpCollectionMetrics(collections = [], lockers = []) {
  let vendingCentavos = 0;
  let lockersCentavos = 0;
  let customCentavos = 0;

  for (const c of collections || []) {
    if (!c) continue;
    const centavos = resolveCollectionCentavos(c);
    if (c.projectType === 'vending_machine') vendingCentavos += centavos;
    else if (c.projectType === 'locker_rental') lockersCentavos += centavos;
    else if (c.projectType === 'future_igp') customCentavos += centavos;
  }

  const occupied = (lockers || []).filter((l) => l?.status === 'occupied').length;
  const totalLockers = (lockers || []).length;

  return {
    totalPHP: (vendingCentavos + lockersCentavos + customCentavos) / 100,
    vendingPHP: vendingCentavos / 100,
    lockersPHP: lockersCentavos / 100,
    customPHP: customCentavos / 100,
    occupiedLockers: occupied,
    availableLockers: totalLockers - occupied,
    totalLockers,
  };
}
