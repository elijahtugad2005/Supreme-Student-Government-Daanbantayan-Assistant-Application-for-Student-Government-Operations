/**
 * financeValidation.js
 * Shared validation logic for fund restrictions and procurement compliance.
 * Implements Rules 1-7 and Addendum policies from FINANCE_MODULE_REDESIGN_SPEC.md.
 */

import {
  TOP_LEVEL_FUNDS,
  EXPENSE_PURPOSES,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  PRE_ORDER_BATCH_STATUSES,
  toCentavos,
} from './financeConstants.js';

export const validateTransactionRules = ({
  fundCategory,
  transactionType,
  expensePurpose,
  amountCentavos,
  allocationId,
  allocationStatus = 'approved',
  lineItemId,
  resolutionRef,
  supportingDocumentIds = [],
  receiptUrl,
  custodianUserId,
  availableBalanceCentavos = 0,
  availableAllocationCentavos = 0,
  availableLineItemCentavos,
}) => {
  const errors = [];
  const missingRequirements = [];
  const warnings = [];
  let isOverspent = false;

  // 1. Amount validation
  if (!amountCentavos || amountCentavos <= 0) {
    errors.push('Transaction amount must be greater than zero.');
  }

  // 2. Rule 2: No informal Fiscal Year Budget or FSG pocket-money usage
  const isFormalFiscal =
    fundCategory === TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET ||
    fundCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE ||
    fundCategory === 'PPMP' ||
    fundCategory === 'FISCAL_YEAR_BUDGET' ||
    fundCategory === 'FSG_REMITTANCE';

  const isPocketMoney =
    expensePurpose === EXPENSE_PURPOSES.EVENT_PREPARATION_CONSUMABLES ||
    expensePurpose?.toLowerCase().includes('pocket') ||
    expensePurpose?.toLowerCase().includes('informal');

  if (isFormalFiscal && isPocketMoney) {
    errors.push(
      'Officer preparation consumables cannot be charged as informal pocket money to Fiscal Year Budget or FSG.'
    );
  }

  const isExpenseOrPayment =
    transactionType === TRANSACTION_TYPES.EXPENSE ||
    transactionType === TRANSACTION_TYPES.PAYMENT ||
    transactionType === 'EXPENSE' ||
    transactionType === 'PAYMENT';

  // 3. Rule 1: Fiscal Year Budget & FSG Document Requirements for Expenses
  if (isFormalFiscal && isExpenseOrPayment) {
    if (!allocationId) {
      errors.push('Choose an approved allocation before recording this expense.');
      missingRequirements.push('Approved Allocation');
    }

    // Restriction: Draft status allocations cannot receive ledger postings
    if (allocationId && allocationStatus === 'draft') {
      errors.push(
        'Cannot post expense against a draft budget allocation. The allocation must be approved in the PPMP Procurement Matrix first.'
      );
    }

    // Restriction: Fully spent/depleted allocations cannot accept additional expenses
    if (allocationId && availableAllocationCentavos !== undefined && availableAllocationCentavos <= 0) {
      errors.push('Cannot post expense against a fully utilized or depleted budget allocation.');
    }

    if (!resolutionRef || resolutionRef.trim() === '') {
      errors.push('A valid budget resolution or approved reference document is required.');
      missingRequirements.push('Resolution Reference');
    }
    if ((!supportingDocumentIds || supportingDocumentIds.length === 0) && !receiptUrl) {
      missingRequirements.push('Supporting Papers / Receipt');
    }

    // FINANCE_CLARIFICATION.MD §3.5: Transparent Overspending
    // Overspending an item or allocation is allowed if fund cash is available.
    // It is warned and flagged with isOverspent: true, not rejected with a hard error.
    if (
      allocationId &&
      availableAllocationCentavos !== undefined &&
      amountCentavos > availableAllocationCentavos
    ) {
      isOverspent = true;
      warnings.push('Expense amount exceeds remaining approved allocation for this activity.');
    }

    if (
      lineItemId &&
      availableLineItemCentavos !== undefined &&
      amountCentavos > availableLineItemCentavos
    ) {
      isOverspent = true;
      warnings.push('Expense amount exceeds remaining planned estimate for this specific PPMP line item.');
    }
  }

  // 4. Rule 4: Balance Checks for Outflows (Cash availability is a hard block)
  const isOutflow =
    isExpenseOrPayment ||
    transactionType === TRANSACTION_TYPES.REFUND ||
    transactionType === 'REFUND';

  if (isOutflow && availableBalanceCentavos !== undefined && amountCentavos > availableBalanceCentavos) {
    errors.push('This fund does not have enough available balance for this expense.');
  }

  // 5. Rule 3: Flexible IGF / IGP Preparation Expense requires Custodian
  if (
    (fundCategory === TOP_LEVEL_FUNDS.IGF || fundCategory === TOP_LEVEL_FUNDS.IGP) &&
    expensePurpose === EXPENSE_PURPOSES.EVENT_PREPARATION_CONSUMABLES
  ) {
    if (!custodianUserId) {
      errors.push('A responsible custodian or officer must be assigned for flexible preparation consumables.');
      missingRequirements.push('Responsible Custodian');
    }
  }

  return {
    isValid: errors.length === 0,
    hasMissingRequirements: missingRequirements.length > 0,
    isOverspent,
    warnings,
    errors,
    missingRequirements,
  };
};

/**
 * Validates dual-approval rules for supplier payments (Addendum: Pre-Order Batch Procurement)
 */
export const validateSupplierPaymentApproval = ({
  createdById,
  approverId,
  approverRole,
  existingApprovals = [],
}) => {
  const errors = [];

  // Creator cannot approve their own entry
  if (createdById && approverId && createdById === approverId) {
    errors.push('Creator cannot approve their own supplier payment entry.');
  }

  // Approver must be budget_officer, finance_secretary, admin, or president
  const eligibleRoles = ['budget_officer', 'finance_secretary', 'admin', 'president'];
  if (!eligibleRoles.includes(approverRole)) {
    errors.push('Only Budget Officer or Finance Secretary can approve supplier payments.');
  }

  // Check if same user already approved
  const alreadyApprovedByUser = existingApprovals.some((a) => a.userId === approverId);
  if (alreadyApprovedByUser) {
    errors.push('This user has already recorded an approval for this payment.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Checks if a batch can be cleared by Audit Secretary
 */
export const validateAuditClearance = ({
  batchStatus,
  hasMissingSupplierReceipts,
  hasUnresolvedFlags,
  pendingPaymentsCount = 0,
}) => {
  const errors = [];

  if (hasMissingSupplierReceipts) {
    errors.push('All supplier payments must have attached receipts before audit clearance.');
  }

  if (pendingPaymentsCount > 0) {
    errors.push('All supplier payments must be fully posted and approved.');
  }

  if (hasUnresolvedFlags) {
    errors.push('All audit flags or discrepancies must be resolved before clearance.');
  }

  return {
    canClear: errors.length === 0,
    errors,
  };
};
