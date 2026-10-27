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
