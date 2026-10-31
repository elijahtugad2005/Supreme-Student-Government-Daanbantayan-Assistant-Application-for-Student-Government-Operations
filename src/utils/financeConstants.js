/**
 * financeConstants.js
 * Domain models, top-level categories, transaction types, and status enumerations
 * for the SSG Office Assistant Redesigned Finance Module.
 */

export const TOP_LEVEL_FUNDS = {
  FISCAL_YEAR_BUDGET: 'FISCAL_YEAR_BUDGET',
  FSG_REMITTANCE: 'FSG_REMITTANCE',
  IGF: 'IGF', // Income Generated Funds
  IGP: 'IGP', // Income-Generating Projects
};

export const TOP_LEVEL_FUND_LABELS = {
  [TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET]: 'Fiscal Year Budget',
  [TOP_LEVEL_FUNDS.FSG_REMITTANCE]: 'FSG Remittance',
  [TOP_LEVEL_FUNDS.IGF]: 'Income Generated Funds (IGF)',
  [TOP_LEVEL_FUNDS.IGP]: 'Income-Generating Projects (IGP)',
};

export const TRANSACTION_TYPES = {
  RECEIPT: 'receipt',
  COLLECTION: 'collection',
  EXPENSE: 'expense',
  PAYMENT: 'payment',
  REFUND: 'refund',
  TRANSFER: 'transfer',
  REVERSAL: 'reversal',
  ADJUSTMENT: 'adjustment',
};

export const TRANSACTION_STATUSES = {
  DRAFT: 'draft',
  INCOMPLETE: 'incomplete',
  PENDING_REVIEW: 'pending_review',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  POSTED: 'posted',
  REJECTED: 'rejected',
  REVERSED: 'reversed',
};

export const EXPENSE_PURPOSES = {
  EVENT_PREPARATION_CONSUMABLES: 'Event Preparation Consumables',
  MERCHANDISE_EXPENSE: 'Merchandise Expense',
  PROJECT_OPERATING_EXPENSE: 'Project Operating Expense',
  EVENT_ITEMIZED_EXPENSE: 'Event Itemized Expense',
  RESOLUTION_DISBURSEMENT: 'Resolution Disbursement',
  REFUND: 'Refund',
  COLLECTION: 'Collection',
  TRANSFER: 'Transfer',
  OTHER: 'Other',
};

export const PRE_ORDER_BATCH_STATUSES = {
  OPEN_FOR_PREORDERS: 'OPEN_FOR_PREORDERS',
  COLLECTION_CLOSED: 'COLLECTION_CLOSED',
  SUPPLIER_QUOTED: 'SUPPLIER_QUOTED',
  SUPPLIER_PAID: 'SUPPLIER_PAID',
  RECEIVED_FROM_SUPPLIER: 'RECEIVED_FROM_SUPPLIER',
  DISTRIBUTING: 'DISTRIBUTING',
  PENDING_AUDIT_CLEARANCE: 'PENDING_AUDIT_CLEARANCE',
  CLEARED: 'CLEARED',
};

export const PRE_ORDER_BATCH_STATUS_LABELS = {
  [PRE_ORDER_BATCH_STATUSES.OPEN_FOR_PREORDERS]: 'Open for Pre-Orders',
  [PRE_ORDER_BATCH_STATUSES.COLLECTION_CLOSED]: 'Collection Closed',
  [PRE_ORDER_BATCH_STATUSES.SUPPLIER_QUOTED]: 'Supplier Quoted',
  [PRE_ORDER_BATCH_STATUSES.SUPPLIER_PAID]: 'Supplier Paid',
  [PRE_ORDER_BATCH_STATUSES.RECEIVED_FROM_SUPPLIER]: 'Received from Supplier',
  [PRE_ORDER_BATCH_STATUSES.DISTRIBUTING]: 'Distributing Items',
  [PRE_ORDER_BATCH_STATUSES.PENDING_AUDIT_CLEARANCE]: 'Pending Audit Clearance',
  [PRE_ORDER_BATCH_STATUSES.CLEARED]: 'Audit Cleared',
};

/**
 * Currency utilities: Centavo Integer Arithmetic
 */
export const toCentavos = (amount) => {
  if (amount === undefined || amount === null || isNaN(amount)) return 0;
  return Math.round(Number(amount) * 100);
};

export const fromCentavos = (centavos) => {
  if (!centavos || isNaN(centavos)) return 0;
  return Number(centavos) / 100;
};

export const formatPHP = (centavosOrPesos, isCentavos = false) => {
  const value = isCentavos ? fromCentavos(centavosOrPesos) : Number(centavosOrPesos || 0);
  return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * PPMP (Project Procurement Management Plan) Categories
 */
export const PROCUREMENT_TYPES = {
  EVENT: 'EVENT',
  PROJECT: 'PROJECT',
  MATERIAL_SUPPLY: 'MATERIAL_SUPPLY',
};

export const PROCUREMENT_TYPE_LABELS = {
  [PROCUREMENT_TYPES.EVENT]: 'Events & Programs',
  [PROCUREMENT_TYPES.PROJECT]: 'Capital & Student Projects',
  [PROCUREMENT_TYPES.MATERIAL_SUPPLY]: 'Materials & Consumable Supplies',
};

/**
 * PPMP Real-Time Lifecycle Statuses (Secretary Color Indicator Rules)
 */
export const PPMP_STATUSES = {
  FRESH: 'fresh',
  PARTIALLY_USED: 'partially_used',
  DEPLETED: 'depleted',
};

export const PPMP_STATUS_CONFIG = {
  [PPMP_STATUSES.FRESH]: {
    label: 'Fresh / Untouched',
    shortLabel: 'Fresh',
    color: '#10b981', // Emerald green
    badgeClass: 'badgeFresh',
    bg: '#ecfdf5',
    border: '#a7f3d0',
    description: 'Budget planned; ₱0 disbursed from treasury',
  },
  [PPMP_STATUSES.PARTIALLY_USED]: {
    label: 'Partially Used',
    shortLabel: 'In Progress',
    color: '#f59e0b', // Amber orange
    badgeClass: 'badgePartial',
    bg: '#fffbeb',
    border: '#fde68a',
    description: 'Active spending initiated from treasury',
  },
  [PPMP_STATUSES.DEPLETED]: {
    label: 'Depleted / Liquidated',
    shortLabel: 'Depleted',
    color: '#ef4444', // Crimson red
    badgeClass: 'badgeDepleted',
    bg: '#fef2f2',
    border: '#fecaca',
    description: 'Fully disbursed or liquidated to estimated plan',
  },
};

/**
 * Computes dynamic PPMP status based on integer centavos spent vs allocated
 */
export const getPPMPStatus = (spentCentavos = 0, allocatedCentavos = 0) => {
  const spent = Number(spentCentavos) || 0;
  const allocated = Number(allocatedCentavos) || 0;
  if (spent <= 0) return PPMP_STATUSES.FRESH;
  if (allocated <= 0) return PPMP_STATUSES.DEPLETED;
  if (spent >= allocated) return PPMP_STATUSES.DEPLETED;
  return PPMP_STATUSES.PARTIALLY_USED;
};

/**
 * Computes dynamic utilization percentage (0 - 100)
 */
export const getUtilizationRate = (spentCentavos = 0, allocatedCentavos = 0) => {
  const spent = Number(spentCentavos) || 0;
  const allocated = Number(allocatedCentavos) || 0;
  if (allocated <= 0) return spent > 0 ? 100 : 0;
  return Math.min(100, Math.round((spent / allocated) * 100));
};

/**
 * IGP (Income-Generating Projects) Revenue Streams
 * Hardcoded to Locker Rental & Piso Water Vending Machine with extensible custom option
 */
export const IGP_REVENUE_STREAMS = {
  LOCKER_RENTAL: 'LOCKER_RENTAL',
  PISO_WATER: 'PISO_WATER',
  CUSTOM_PROJECT: 'CUSTOM_PROJECT',
};

export const IGP_REVENUE_STREAM_LABELS = {
  [IGP_REVENUE_STREAMS.LOCKER_RENTAL]: 'Locker Rental',
  [IGP_REVENUE_STREAMS.PISO_WATER]: 'Piso Water Vending Machine',
  [IGP_REVENUE_STREAMS.CUSTOM_PROJECT]: 'Custom Revenue Generating Project',
};
