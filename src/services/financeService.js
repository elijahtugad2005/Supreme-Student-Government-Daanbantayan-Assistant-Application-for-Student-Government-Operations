/**
 * financeService.js
 * Core database service and transactional operations for the redesigned Finance module.
 * Enforces atomic updates, append-only ledger entries, and double-entry consistency.
 */

import { db } from '../firebase/firebaseConfig';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore';
import {
  TOP_LEVEL_FUNDS,
  TOP_LEVEL_FUND_LABELS,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  EXPENSE_PURPOSES,
  PROCUREMENT_TYPES,
  PPMP_STATUSES,
  getPPMPStatus,
  getUtilizationRate,
  toCentavos,
  fromCentavos,
} from '../utils/financeConstants';
import { validateTransactionRules } from '../utils/financeValidation';

const COLLECTIONS = {
  FUND_ACCOUNTS: 'fundAccounts',
  BUDGET_ALLOCATIONS: 'budgetAllocations',
  TRANSACTIONS: 'transactions',
  PRE_ORDER_BATCHES: 'preOrderBatches',
  PRE_ORDER_ENTRIES: 'preOrderEntries',
  LEGACY_FUNDS: 'funds',
  LEGACY_BUDGETS: 'budgets',
};

export const financeService = {
  /**
   * Cleans up legacy test records in funds and budgets (Requested by User)
   */
  async cleanLegacyTestRecords() {
    try {
      // 1. Delete legacy funds docs
      const fundsSnap = await getDocs(collection(db, COLLECTIONS.LEGACY_FUNDS));
      for (const d of fundsSnap.docs) {
        await deleteDoc(doc(db, COLLECTIONS.LEGACY_FUNDS, d.id));
      }

      // 2. Delete legacy budgets docs
      const budgetsSnap = await getDocs(collection(db, COLLECTIONS.LEGACY_BUDGETS));
      for (const d of budgetsSnap.docs) {
        await deleteDoc(doc(db, COLLECTIONS.LEGACY_BUDGETS, d.id));
      }
      return { success: true, message: 'Legacy test funds and budgets cleared.' };
    } catch (err) {
      console.error('Error cleaning legacy records:', err);
      throw err;
    }
  },

  /**
   * Initializes or verifies the 4 default top-level fund accounts.
   */
  async ensureDefaultFundAccounts(userId = 'system', userName = 'System Admin') {
    const defaultAccounts = [
      {
        id: 'fund_fiscal_year_budget',
        topLevelCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
        displayName: 'SSG Fiscal Year Budget',
        subcategory: 'Annual General Appropriations',
        fiscalYear: new Date().getFullYear(),
        holdingType: 'bank',
        bankAccountReference: 'BDO Institutional Account ****2005',
        status: 'active',
        balanceCentavos: 0,
        appropriatedCeilingCentavos: 0,
        appropriationResolutionRef: '',
      },
      {
        id: 'fund_fsg_remittance',
        topLevelCategory: TOP_LEVEL_FUNDS.FSG_REMITTANCE,
        displayName: 'FSG Remittance & Supplemental Fund',
        subcategory: 'Federation Remittance Backup',
        fiscalYear: new Date().getFullYear(),
        holdingType: 'bank',
        bankAccountReference: 'BDO Institutional Account ****2005 (Sub-Treasury)',
        status: 'active',
        balanceCentavos: 0,
      },
      {
        id: 'fund_igf_main',
        topLevelCategory: TOP_LEVEL_FUNDS.IGF,
        displayName: 'Income Generated Funds (IGF)',
        subcategory: 'Merchandise, Lanyards & Uniforms',
        fiscalYear: new Date().getFullYear(),
        holdingType: 'cash',
        bankAccountReference: 'Treasury Safe / Cash Box',
        status: 'active',
        balanceCentavos: 0,
      },
      {
        id: 'fund_igp_main',
        topLevelCategory: TOP_LEVEL_FUNDS.IGP,
        displayName: 'Income-Generating Projects (IGP)',
        subcategory: 'Water Vendo & Locker Rentals',
        fiscalYear: new Date().getFullYear(),
        holdingType: 'cash',
        bankAccountReference: 'Custodial Lockbox',
        status: 'active',
        balanceCentavos: 0,
      },
    ];

    const existingAccounts = await this.getFundAccounts();
    const existingMap = new Map(existingAccounts.map((a) => [a.id, a]));

    for (const acc of defaultAccounts) {
      if (!existingMap.has(acc.id)) {
        await runTransaction(db, async (tx) => {
          const accRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, acc.id);
          tx.set(accRef, {
            ...acc,
            createdAt: serverTimestamp(),
            createdBy: userName,
            createdById: userId,
            updatedAt: serverTimestamp(),
          });
        });
      } else {
        // Graceful migration: Update LandBank to BDO if detected, ensure ceiling fields exist
        const current = existingMap.get(acc.id);
        const updates = {};
        if (current.bankAccountReference && current.bankAccountReference.includes('LandBank')) {
          updates.bankAccountReference = acc.bankAccountReference;
        }
        if (acc.id === 'fund_fiscal_year_budget' && current.appropriatedCeilingCentavos === undefined) {
          updates.appropriatedCeilingCentavos = 0;
          updates.appropriationResolutionRef = '';
        }
        if (Object.keys(updates).length > 0) {
          await updateDoc(doc(db, COLLECTIONS.FUND_ACCOUNTS, acc.id), {
            ...updates,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }
  },

  /**
   * Update Fiscal Budget (serves as unified primary balance and PPMP ceiling)
   */
  async updateFiscalBudget(fundAccountId = 'fund_fiscal_year_budget', budgetData, user) {
    const fundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, fundAccountId);
    const { budgetAmount, ceilingAmount, resolutionRef, bankAccountReference, note } = budgetData;
    const finalAmount = budgetAmount !== undefined ? budgetAmount : ceilingAmount;
    const amountCentavos = toCentavos(finalAmount);

    const patch = {
      balanceCentavos: amountCentavos,
      appropriatedCeilingCentavos: amountCentavos, // Unified: primary balance and ceiling are identical
      lastBudgetUpdateNote: note || 'Secretariat Fiscal Budget Calibration',
      updatedAt: serverTimestamp(),
      updatedBy: user?.userName || user?.displayName || 'Authorized Secretary',
      updatedById: user?.uid || 'officer',
    };
    if (resolutionRef !== undefined) {
      patch.appropriationResolutionRef = resolutionRef;
    }
    if (bankAccountReference !== undefined && bankAccountReference.trim() !== '') {
      patch.bankAccountReference = bankAccountReference.trim();
    }
    await updateDoc(fundRef, patch);
    return true;
  },

  /**
   * Update Fund Balance (for non-fiscal funds e.g. FSG, IGF, IGP)
   */
  async updateFundBalance(fundAccountId, balanceAmount, user, reason = '') {
    const fundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, fundAccountId);
    const amountCentavos = toCentavos(balanceAmount);
    const patch = {
      balanceCentavos: amountCentavos,
      lastReconciliationReason: reason || 'Secretariat Fund Balance Calibration',
      updatedAt: serverTimestamp(),
      updatedBy: user?.userName || user?.displayName || 'Authorized Secretary',
      updatedById: user?.uid || 'officer',
    };
    if (fundAccountId === 'fund_fiscal_year_budget') {
      patch.appropriatedCeilingCentavos = amountCentavos;
    }
    await updateDoc(fundRef, patch);
    return true;
  },

  /**
   * Backward-compatible aliases
   */
  async updateFiscalCeiling(fundAccountId = 'fund_fiscal_year_budget', ceilingData, user) {
    return this.updateFiscalBudget(fundAccountId, ceilingData, user);
  },

  async updateFundHoldingBalance(fundAccountId = 'fund_fiscal_year_budget', balanceAmount, user, reason = '') {
    return this.updateFundBalance(fundAccountId, balanceAmount, user, reason);
  },

  /**
   * Get all active fund accounts
   */
  async getFundAccounts() {
    const snap = await getDocs(collection(db, COLLECTIONS.FUND_ACCOUNTS));
    return snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
  },

  /**
   * Get all budget allocations
   */
  async getBudgetAllocations(fundAccountId = null) {
    let q = collection(db, COLLECTIONS.BUDGET_ALLOCATIONS);
    if (fundAccountId) {
      q = query(q, where('fundAccountId', '==', fundAccountId));
    }
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
  },

  /**
   * Create an authorized budget allocation
   */
  async createBudgetAllocation(allocationData, user) {
    const {
      fundAccountId,
      activityName,
      fiscalYear = new Date().getFullYear(),
      approvedAmount,
      approvedLineItems = [],
      resolutionRef,
      supportingDocumentIds = [],
      category = 'Event',
      procurementType = PROCUREMENT_TYPES.EVENT,
      committee = 'General',
    } = allocationData;

    const amountCentavos = toCentavos(approvedAmount);

    // Normalize sub-line items with integer centavos and initial fresh status
    const normalizedLineItems = (approvedLineItems || []).map((li, index) => {
      const unitCost = Number(li.unitCost || li.unitPrice || 0);
      const qty = Number(li.quantity || 1);
      const planned = li.plannedCentavos !== undefined
        ? Number(li.plannedCentavos)
        : (li.plannedAmount !== undefined ? toCentavos(li.plannedAmount) : toCentavos(qty * unitCost));
      const spent = Number(li.spentCentavos || 0);

      return {
        id: li.id || `line_${Date.now()}_${index}`,
        name: (li.name || li.title || li.description || `Item ${index + 1}`).trim(),
        quantity: qty,
        unitCostCentavos: toCentavos(unitCost),
        plannedCentavos: planned,
        spentCentavos: spent,
        status: getPPMPStatus(spent, planned),
        notes: li.notes || '',
      };
    });

    const determinedProcurementType =
      procurementType ||
      (category === 'Project'
        ? PROCUREMENT_TYPES.PROJECT
        : ['Supplies', 'Printing', 'Equipment', 'Material'].includes(category)
        ? PROCUREMENT_TYPES.MATERIAL_SUPPLY
        : PROCUREMENT_TYPES.EVENT);

    // Rule: Total planned estimations cannot exceed the initial Fiscal Budget or FSG pool
    if (fundAccountId) {
      const fundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, fundAccountId);
      const fundSnap = await getDoc(fundRef);
      if (fundSnap.exists()) {
        const fund = fundSnap.data();
        const isFiscal = fundAccountId === 'fund_fiscal_year_budget';
        const budgetBaseCentavos = isFiscal
          ? (fund.appropriatedCeilingCentavos || fund.balanceCentavos || 0)
          : (fund.balanceCentavos || 0);

        if (budgetBaseCentavos > 0) {
          const allocSnap = await getDocs(
            query(collection(db, COLLECTIONS.BUDGET_ALLOCATIONS), where('fundAccountId', '==', fundAccountId))
          );
          const currentTotalAllocated = allocSnap.docs.reduce(
            (sum, d) => sum + (d.data().approvedAmountCentavos || 0),
            0
          );
          if (currentTotalAllocated + amountCentavos > budgetBaseCentavos) {
            const availableCentavos = Math.max(0, budgetBaseCentavos - currentTotalAllocated);
            throw new Error(
              `Allocation rejected: Total planned allocations (${formatPHP(currentTotalAllocated + amountCentavos, true)}) would exceed the initial budget (${formatPHP(budgetBaseCentavos, true)}). Available surplus: ${formatPHP(availableCentavos, true)}.`
            );
          }
        }
      }
    }

    const docRef = await addDoc(collection(db, COLLECTIONS.BUDGET_ALLOCATIONS), {
      fundAccountId,
      activityName,
      fiscalYear,
      category,
      procurementType: determinedProcurementType,
      committee,
      approvedAmountCentavos: amountCentavos,
      spentAmountCentavos: 0,
      committedAmountCentavos: 0,
      approvedLineItems: normalizedLineItems,
      resolutionRef,
      supportingDocumentIds,
      approvedBy: user.userName || user.displayName || 'Authorized Officer',
      approvedById: user.uid,
      approvedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      status: allocationData.status === 'draft' ? 'draft' : 'approved',
      revisionHistory: [],
    });

    return docRef.id;
  },

  /**
   * Update an existing budget allocation
   */
  async updateBudgetAllocation(allocationId, updateData, user) {
    const allocRef = doc(db, COLLECTIONS.BUDGET_ALLOCATIONS, allocationId);
    const snap = await getDoc(allocRef);
    if (!snap.exists()) {
      throw new Error('Budget allocation not found.');
    }
    const current = snap.data();

    const patch = {
      updatedAt: serverTimestamp(),
      updatedBy: user?.userName || user?.displayName || 'Authorized Officer',
      updatedById: user?.uid || 'officer',
    };

    if (updateData.fundAccountId) patch.fundAccountId = updateData.fundAccountId;
    if (updateData.status) patch.status = updateData.status;
    if (updateData.activityName !== undefined) patch.activityName = updateData.activityName;
    if (updateData.eventName !== undefined) patch.activityName = updateData.eventName;
    if (updateData.fiscalYear !== undefined) patch.fiscalYear = Number(updateData.fiscalYear);
    if (updateData.category !== undefined) patch.category = updateData.category;
    if (updateData.procurementType !== undefined) patch.procurementType = updateData.procurementType;
    if (updateData.committee !== undefined) patch.committee = updateData.committee;
    if (updateData.resolution !== undefined) patch.resolutionRef = updateData.resolution;
    if (updateData.resolutionRef !== undefined) patch.resolutionRef = updateData.resolutionRef;
    if (updateData.description !== undefined) patch.description = updateData.description;
    if (updateData.receiptUrl !== undefined) {
      patch.supportingDocumentIds = updateData.receiptUrl ? [updateData.receiptUrl] : [];
    }
    if (updateData.allocatedAmount !== undefined || updateData.allocated !== undefined) {
      const amt = updateData.allocatedAmount !== undefined ? updateData.allocatedAmount : updateData.allocated;
      patch.approvedAmountCentavos = toCentavos(amt);

      const targetFundId = patch.fundAccountId || current.fundAccountId;
      if (targetFundId) {
        const fundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, targetFundId);
        const fundSnap = await getDoc(fundRef);
        if (fundSnap.exists()) {
          const fund = fundSnap.data();
          const isFiscal = targetFundId === 'fund_fiscal_year_budget';
          const budgetBaseCentavos = isFiscal
            ? (fund.appropriatedCeilingCentavos || fund.balanceCentavos || 0)
            : (fund.balanceCentavos || 0);

          if (budgetBaseCentavos > 0) {
            const allocSnap = await getDocs(
              query(collection(db, COLLECTIONS.BUDGET_ALLOCATIONS), where('fundAccountId', '==', targetFundId))
            );
            const otherAllocationsTotal = allocSnap.docs
              .filter((d) => d.id !== allocationId)
              .reduce((sum, d) => sum + (d.data().approvedAmountCentavos || 0), 0);

            if (otherAllocationsTotal + patch.approvedAmountCentavos > budgetBaseCentavos) {
              const availableCentavos = Math.max(0, budgetBaseCentavos - otherAllocationsTotal);
              throw new Error(
                `Update rejected: Total planned allocations (${formatPHP(otherAllocationsTotal + patch.approvedAmountCentavos, true)}) would exceed the initial budget (${formatPHP(budgetBaseCentavos, true)}). Available surplus: ${formatPHP(availableCentavos, true)}.`
              );
            }
          }
        }
      }
    }
    if (updateData.approvedLineItems !== undefined) {
      patch.approvedLineItems = (updateData.approvedLineItems || []).map((li, index) => {
        const unitCost = Number(li.unitCost || li.unitPrice || fromCentavos(li.unitCostCentavos || 0));
        const qty = Number(li.quantity || 1);
        const planned = li.plannedCentavos !== undefined
          ? Number(li.plannedCentavos)
          : (li.plannedAmount !== undefined ? toCentavos(li.plannedAmount) : toCentavos(qty * unitCost));

        const incomingSpent = li.spentCentavos !== undefined
          ? Number(li.spentCentavos)
          : (li.spentAmount !== undefined ? toCentavos(li.spentAmount) : (li.spent !== undefined ? toCentavos(li.spent) : null));

        const existingLine = (current.approvedLineItems || []).find((c) => c.id === li.id);
        const spent = incomingSpent !== null
          ? incomingSpent
          : (existingLine?.spentCentavos || 0);

        return {
          id: li.id || `line_${Date.now()}_${index}`,
          name: (li.name || li.title || li.description || `Item ${index + 1}`).trim(),
          quantity: qty,
          unitCostCentavos: toCentavos(unitCost),
          plannedCentavos: planned,
          spentCentavos: spent,
          status: getPPMPStatus(spent, planned),
          notes: li.notes || '',
        };
      });

      if (updateData.spentAmount === undefined && updateData.spent === undefined) {
        const lineItemsSpentTotal = patch.approvedLineItems.reduce((acc, it) => acc + (it.spentCentavos || 0), 0);
        if (lineItemsSpentTotal > 0) {
          patch.spentAmountCentavos = lineItemsSpentTotal;
        }
      }
    }

    if (updateData.spentAmount !== undefined || updateData.spent !== undefined) {
      const spent = updateData.spentAmount !== undefined ? updateData.spentAmount : updateData.spent;
      patch.spentAmountCentavos = toCentavos(spent);
    }

    // Append to revision history for governance tracking
    const oldRevision = {
      modifiedAt: new Date().toISOString(),
      modifiedBy: user?.userName || user?.displayName || 'Authorized Officer',
      previousAmountCentavos: current.approvedAmountCentavos,
      previousFundAccountId: current.fundAccountId,
      previousActivityName: current.activityName,
    };
    patch.revisionHistory = [...(current.revisionHistory || []), oldRevision];

    await updateDoc(allocRef, patch);
    return allocationId;
  },

  /**
   * Delete or archive a budget allocation
   */
  async deleteBudgetAllocation(allocationId, user) {
    const allocRef = doc(db, COLLECTIONS.BUDGET_ALLOCATIONS, allocationId);
    const snap = await getDoc(allocRef);
    if (!snap.exists()) {
      return true;
    }
    const data = snap.data();
    // Check if there are transactions attached OR recorded spent funds to preserve audit integrity
    const txSnap = await getDocs(
      query(collection(db, COLLECTIONS.TRANSACTIONS), where('budgetAllocationId', '==', allocationId))
    );
    const hasSpent = (data.spentAmountCentavos || 0) > 0 || (data.spent || 0) > 0;
    if (!txSnap.empty || hasSpent) {
      // If transactions or spent disbursements exist, soft delete/archive to protect audit trail
      await updateDoc(allocRef, {
        status: 'archived',
        isActive: false,
        archivedAt: serverTimestamp(),
        archivedBy: user?.userName || user?.displayName || 'Authorized Officer',
        archivedById: user?.uid || 'officer',
      });
    } else {
      await deleteDoc(allocRef);
    }
    return true;
  },

  /**
   * Restore an archived budget allocation
   */
  async restoreBudgetAllocation(allocationId, user) {
    const allocRef = doc(db, COLLECTIONS.BUDGET_ALLOCATIONS, allocationId);
    const snap = await getDoc(allocRef);
    if (!snap.exists()) {
      throw new Error('Budget allocation not found.');
    }
    await updateDoc(allocRef, {
      status: 'approved',
      isActive: true,
      restoredAt: serverTimestamp(),
      restoredBy: user?.userName || user?.displayName || 'Authorized Officer',
      restoredById: user?.uid || 'officer',
    });
    return true;
  },

  /**
   * Record a financial transaction with restriction enforcement & ledger updating
   */
  async recordTransaction(txData, user) {
    const {
      fundAccountId,
      transactionType,
      expensePurpose,
      amount,
      payeeOrPayer = '',
      description = '',
      budgetAllocationId = null,
      lineItemId = null,
      resolutionRef = '',
      receiptUrl = '',
      supportingDocumentIds = [],
      custodianUserId = null,
      custodianName = null,
      receiptExceptionReason = null,
      transferDestinationAccountId = null,
      status = TRANSACTION_STATUSES.POSTED,
    } = txData;

    const amountCentavos = toCentavos(amount);

    return await runTransaction(db, async (transaction) => {
      // 1. Fetch Fund Account
      const fundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, fundAccountId);
      const fundSnap = await transaction.get(fundRef);
      if (!fundSnap.exists()) {
        throw new Error('Fund account not found.');
      }
      const fundData = fundSnap.data();

      // 2. Fetch Allocation if linked
      let allocationData = null;
      let allocRef = null;
      let remainingAllocCentavos = 0;

      if (budgetAllocationId) {
        allocRef = doc(db, COLLECTIONS.BUDGET_ALLOCATIONS, budgetAllocationId);
        const allocSnap = await transaction.get(allocRef);
        if (allocSnap.exists()) {
          allocationData = allocSnap.data();
          const approved = allocationData.approvedAmountCentavos || 0;
          const spent = allocationData.spentAmountCentavos || 0;
          remainingAllocCentavos = approved - spent;
        }
      }

      let remainingLineItemCentavos = undefined;
      if (lineItemId && allocationData && Array.isArray(allocationData.approvedLineItems)) {
        const targetItem = allocationData.approvedLineItems.find((li) => li.id === lineItemId);
        if (targetItem) {
          const planned = targetItem.plannedCentavos || toCentavos(targetItem.plannedAmount || targetItem.estimatedCost || 0);
          const spent = targetItem.spentCentavos || 0;
          remainingLineItemCentavos = Math.max(0, planned - spent);
        }
      }

      // 3. Shared Validation Rules
      const validation = validateTransactionRules({
        fundCategory: fundData.topLevelCategory,
        transactionType,
        expensePurpose,
        amountCentavos,
        allocationId: budgetAllocationId,
        allocationStatus: allocationData?.status || 'approved',
        lineItemId,
        resolutionRef: resolutionRef || allocationData?.resolutionRef,
        supportingDocumentIds,
        receiptUrl,
        custodianUserId,
        availableBalanceCentavos: fundData.balanceCentavos || 0,
        availableAllocationCentavos: remainingAllocCentavos,
        availableLineItemCentavos: remainingLineItemCentavos,
      });

      if (!validation.isValid && status === TRANSACTION_STATUSES.POSTED) {
        throw new Error(`Transaction rejected: ${validation.errors.join(' ')}`);
      }

      // 4. Create Transaction Record
      const newTxRef = doc(collection(db, COLLECTIONS.TRANSACTIONS));
      const refNumber = `TXN-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

      const transactionPayload = {
        refNumber,
        fundAccountId,
        fundCategory: fundData.topLevelCategory,
        transactionType,
        expensePurpose,
        amountCentavos,
        payeeOrPayer,
        description,
        budgetAllocationId,
        lineItemId: lineItemId || null,
        resolutionRef: resolutionRef || allocationData?.resolutionRef || null,
        receiptUrl,
        supportingDocumentIds,
        custodianUserId,
        custodianName,
        receiptExceptionReason,
        transferDestinationAccountId,
        createdById: user.uid,
        createdBy: user.userName || user.displayName || 'Authorized Officer',
        createdAt: serverTimestamp(),
        postedAt: status === TRANSACTION_STATUSES.POSTED ? serverTimestamp() : null,
        status,
      };

      transaction.set(newTxRef, transactionPayload);

      // 5. Update Ledger Balances if Posted
      if (status === TRANSACTION_STATUSES.POSTED) {
        let balanceDelta = 0;
        if (
          transactionType === TRANSACTION_TYPES.RECEIPT ||
          transactionType === TRANSACTION_TYPES.COLLECTION
        ) {
          balanceDelta = amountCentavos;
        } else if (
          transactionType === TRANSACTION_TYPES.EXPENSE ||
          transactionType === TRANSACTION_TYPES.PAYMENT ||
          transactionType === TRANSACTION_TYPES.REFUND
        ) {
          balanceDelta = -amountCentavos;
        }

        const newBalance = (fundData.balanceCentavos || 0) + balanceDelta;
        transaction.update(fundRef, {
          balanceCentavos: newBalance,
          updatedAt: serverTimestamp(),
        });

        // Update allocation and sub-line item spent if applicable
        if (allocRef && allocationData) {
          const newSpent = (allocationData.spentAmountCentavos || 0) + amountCentavos;
          const allocUpdates = {
            spentAmountCentavos: newSpent,
            updatedAt: serverTimestamp(),
          };

          // If lineItemId was specified, update that specific line item's spent and status
          if (lineItemId && Array.isArray(allocationData.approvedLineItems)) {
            allocUpdates.approvedLineItems = allocationData.approvedLineItems.map((li) => {
              if (li.id === lineItemId) {
                const itemPlanned = li.plannedCentavos || toCentavos(li.plannedAmount || li.estimatedCost || 0);
                const itemSpent = (li.spentCentavos || 0) + amountCentavos;
                return {
                  ...li,
                  spentCentavos: itemSpent,
                  status: getPPMPStatus(itemSpent, itemPlanned),
                };
              }
              return li;
            });
          }

          transaction.update(allocRef, allocUpdates);
        }

        // If transfer, atomically credit destination account
        if (transactionType === TRANSACTION_TYPES.TRANSFER && transferDestinationAccountId) {
          const destRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, transferDestinationAccountId);
          const destSnap = await transaction.get(destRef);
          if (destSnap.exists()) {
            const destData = destSnap.data();
            transaction.update(destRef, {
              balanceCentavos: (destData.balanceCentavos || 0) + amountCentavos,
              updatedAt: serverTimestamp(),
            });
          }
        }
      }

      return { id: newTxRef.id, refNumber };
    });
  },

  /**
   * Reverse an existing posted transaction (Rule 7: Corrections & Audit Trail)
   */
  async reverseTransaction(originalTxId, reason, user) {
    return await runTransaction(db, async (transaction) => {
      const origRef = doc(db, COLLECTIONS.TRANSACTIONS, originalTxId);
      const origSnap = await transaction.get(origRef);
      if (!origSnap.exists()) throw new Error('Transaction not found.');

      const orig = origSnap.data();
      if (orig.status === TRANSACTION_STATUSES.REVERSED) {
        throw new Error('Transaction has already been reversed.');
      }
      if (orig.status !== TRANSACTION_STATUSES.POSTED) {
        throw new Error('Only posted transactions can be reversed.');
      }

      const fundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, orig.fundAccountId);
      const fundSnap = await transaction.get(fundRef);
      if (!fundSnap.exists()) throw new Error('Associated fund account not found.');
      const fundData = fundSnap.data();

      // Invert amount effect
      let reverseDelta = 0;
      if (
        orig.transactionType === TRANSACTION_TYPES.RECEIPT ||
        orig.transactionType === TRANSACTION_TYPES.COLLECTION
      ) {
        reverseDelta = -orig.amountCentavos;
      } else {
        reverseDelta = orig.amountCentavos;
      }

      // 1. Mark original as reversed
      transaction.update(origRef, {
        status: TRANSACTION_STATUSES.REVERSED,
        reversedAt: serverTimestamp(),
        reversedBy: user.userName || user.displayName || 'Authorized Officer',
        reversalReason: reason,
      });

      // 2. Create Reversal Audit Transaction
      const reversalRef = doc(collection(db, COLLECTIONS.TRANSACTIONS));
      transaction.set(reversalRef, {
        refNumber: `REV-${orig.refNumber}`,
        fundAccountId: orig.fundAccountId,
        fundCategory: orig.fundCategory,
        transactionType: TRANSACTION_TYPES.REVERSAL,
        amountCentavos: orig.amountCentavos,
        description: `Authorized reversal of ${orig.refNumber}: ${reason}`,
        reversalOfTransactionId: originalTxId,
        createdById: user.uid,
        createdBy: user.userName || user.displayName || 'Authorized Officer',
        createdAt: serverTimestamp(),
        postedAt: serverTimestamp(),
        status: TRANSACTION_STATUSES.POSTED,
      });

      // 3. Update Fund Balance
      transaction.update(fundRef, {
        balanceCentavos: (fundData.balanceCentavos || 0) + reverseDelta,
        updatedAt: serverTimestamp(),
      });

      // 4. Update Allocation spent and line item spent if applicable
      if (orig.budgetAllocationId) {
        const allocRef = doc(db, COLLECTIONS.BUDGET_ALLOCATIONS, orig.budgetAllocationId);
        const allocSnap = await transaction.get(allocRef);
        if (allocSnap.exists()) {
          const allocData = allocSnap.data();
          const newSpent = Math.max(0, (allocData.spentAmountCentavos || 0) - orig.amountCentavos);
          const allocUpdates = {
            spentAmountCentavos: newSpent,
            updatedAt: serverTimestamp(),
          };

          if (orig.lineItemId && Array.isArray(allocData.approvedLineItems)) {
            allocUpdates.approvedLineItems = allocData.approvedLineItems.map((li) => {
              if (li.id === orig.lineItemId) {
                const itemPlanned = li.plannedCentavos || toCentavos(li.plannedAmount || li.estimatedCost || 0);
                const itemSpent = Math.max(0, (li.spentCentavos || 0) - orig.amountCentavos);
                return {
                  ...li,
                  spentCentavos: itemSpent,
                  status: getPPMPStatus(itemSpent, itemPlanned),
                };
              }
              return li;
            });
          }

          transaction.update(allocRef, allocUpdates);
        }
      }

      return reversalRef.id;
    });
  },

  /**
   * Pre-Order Batches & Procurement Workflow (Addendum)
   */
  async createPreOrderBatch(batchData, user) {
    const {
      name,
      product,
      unitPrice,
      preOrderOpenDate = null,
      preOrderCloseDate = null,
      custodianUserId = null,
      custodianName = null,
      fiscalYear = new Date().getFullYear(),
      receiptSubmissionDeadlineDays = null,
      batchClearanceDeadlineDays = null,
    } = batchData;

    const unitPriceCentavos = toCentavos(unitPrice);

    const docRef = await addDoc(collection(db, COLLECTIONS.PRE_ORDER_BATCHES), {
      name,
      product,
      unitPriceCentavos,
      preOrderOpenDate,
      preOrderCloseDate,
      custodianUserId,
      custodianName,
      fiscalYear,
      receiptSubmissionDeadlineDays,
      batchClearanceDeadlineDays,
      status: 'OPEN_FOR_PREORDERS',
      collectedCentavos: 0,
      paidSupplierCentavos: 0,
      committedSupplierCentavos: 0,
      supplierQuotes: [],
      supplierPayments: [],
      auditFlags: [],
      createdById: user.uid,
      createdBy: user.userName || user.displayName,
      createdAt: serverTimestamp(),
    });

    return docRef.id;
  },

  /**
   * Record Student Order & Payment in a Pre-Order Batch
   */
  async recordStudentPreOrderPayment({
    batchId,
    studentId,
    studentName,
    variant = 'Standard',
    quantity = 1,
    amountPaid,
    officerUser,
  }) {
    const paidCentavos = toCentavos(amountPaid);

    return await runTransaction(db, async (transaction) => {
      const batchRef = doc(db, COLLECTIONS.PRE_ORDER_BATCHES, batchId);
      const batchSnap = await transaction.get(batchRef);
      if (!batchSnap.exists()) throw new Error('Batch not found.');
      const batch = batchSnap.data();

      const totalDueCentavos = (batch.unitPriceCentavos || 0) * Number(quantity);

      // Add PreOrderEntry
      const entryRef = doc(collection(db, COLLECTIONS.PRE_ORDER_ENTRIES));
      transaction.set(entryRef, {
        batchId,
        studentId,
        studentName,
        variant,
        quantity: Number(quantity),
        amountDueCentavos: totalDueCentavos,
        amountPaidCentavos: paidCentavos,
        paymentStatus: paidCentavos >= totalDueCentavos ? 'PAID' : 'PARTIAL',
        claimStatus: 'NOT_READY',
        createdAt: serverTimestamp(),
        recordedBy: officerUser.userName || officerUser.displayName,
        recordedById: officerUser.uid,
      });

      // Post IGF Collection Transaction
      const txRef = doc(collection(db, COLLECTIONS.TRANSACTIONS));
      const refNumber = `IGF-${Date.now().toString().slice(-6)}`;
      transaction.set(txRef, {
        refNumber,
        fundAccountId: 'fund_igf_main',
        fundCategory: TOP_LEVEL_FUNDS.IGF,
        transactionType: TRANSACTION_TYPES.COLLECTION,
        expensePurpose: 'Collection',
        amountCentavos: paidCentavos,
        description: `Pre-Order payment: ${studentName} - ${batch.name} (${variant} x${quantity})`,
        batchId,
        preOrderEntryId: entryRef.id,
        createdById: officerUser.uid,
        createdBy: officerUser.userName || officerUser.displayName,
        createdAt: serverTimestamp(),
        postedAt: serverTimestamp(),
        status: TRANSACTION_STATUSES.POSTED,
      });

      // Update Batch & IGF Fund
      transaction.update(batchRef, {
        collectedCentavos: (batch.collectedCentavos || 0) + paidCentavos,
        updatedAt: serverTimestamp(),
      });

      const igfFundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, 'fund_igf_main');
      const igfSnap = await transaction.get(igfFundRef);
      if (igfSnap.exists()) {
        transaction.update(igfFundRef, {
          balanceCentavos: (igfSnap.data().balanceCentavos || 0) + paidCentavos,
          updatedAt: serverTimestamp(),
        });
      }

      return { entryId: entryRef.id, refNumber };
    });
  },

  /**
   * Fetch all pre-order batches
   */
  async getPreOrderBatches() {
    const snap = await getDocs(query(collection(db, COLLECTIONS.PRE_ORDER_BATCHES), orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
  },

  /**
   * Fetch pre-order entries for a batch
   */
  async getBatchEntries(batchId) {
    const q = query(collection(db, COLLECTIONS.PRE_ORDER_ENTRIES), where('batchId', '==', batchId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
  },

  /**
   * Fetch all transactions
   */
  async getTransactions(limitCount = 100) {
    const q = query(collection(db, COLLECTIONS.TRANSACTIONS), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
  },

  /**
   * Sync merchandise order revenue to IGF (Income Generated Fund)
   * Directly links store merchandise earnings into fundAccounts/fund_igf_main
   */
  async syncOrderRevenueToIGF({ order, user, notes = '' }) {
    if (!order) throw new Error('Order is required.');
    if (order.igfSynced) {
      return { success: true, alreadySynced: true, refNumber: order.igfTxRef };
    }

    const rawAmount = Number(order.productInfo?.totalPrice || order.totalPrice || 0);
    const amountCentavos = toCentavos(rawAmount);

    if (amountCentavos <= 0) {
      const orderRef = doc(db, 'orders', order.docId || order.id);
      await updateDoc(orderRef, {
        igfSynced: true,
        igfSyncedAt: new Date().toISOString(),
        igfAmountCentavos: 0,
        updatedAt: new Date().toISOString(),
      });
      return { success: true, refNumber: 'IGF-ORD-FREE', amountCentavos: 0, zeroRevenue: true };
    }

    return await runTransaction(db, async (transaction) => {
      // 1. Transaction-level idempotency lock on order document
      const orderDocId = order.docId || order.id;
      const orderRef = doc(db, 'orders', orderDocId);
      const orderSnap = await transaction.get(orderRef);
      if (orderSnap.exists()) {
        const orderData = orderSnap.data();
        if (orderData.igfSynced === true && !orderData.igfReversed) {
          return {
            success: true,
            alreadySynced: true,
            refNumber: orderData.igfTxRef || order.igfTxRef,
            amountCentavos: orderData.igfAmountCentavos || amountCentavos,
          };
        }
      }

      // 2. Fetch or initialize IGF fund account
      const igfRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, 'fund_igf_main');
      const igfSnap = await transaction.get(igfRef);

      let currentBalanceCentavos = 0;
      if (!igfSnap.exists()) {
        const initialIgf = {
          id: 'fund_igf_main',
          topLevelCategory: TOP_LEVEL_FUNDS.IGF,
          displayName: 'Income Generated Funds (IGF)',
          subcategory: 'Merchandise, Lanyards & Uniforms',
          fiscalYear: new Date().getFullYear(),
          holdingType: 'cash',
          bankAccountReference: 'Treasury Safe / Cash Box',
          status: 'active',
          balanceCentavos: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        transaction.set(igfRef, initialIgf);
      } else {
        currentBalanceCentavos = igfSnap.data().balanceCentavos || 0;
      }

      // 3. Create append-only collection transaction with collision-free unique reference
      const txRef = doc(collection(db, COLLECTIONS.TRANSACTIONS));
      const safeOrderId = (order.orderId || 'ORD').trim();
      const docSuffix = orderDocId ? orderDocId.slice(-6).toUpperCase() : Date.now().toString().slice(-6);
      const refNumber = `IGF-ORD-${safeOrderId}-${docSuffix}`;
      const pName = order.productInfo?.productName || order.productName || 'SSG Merchandise';
      const qty = order.productInfo?.quantity || order.quantity || 1;
      const customer = order.customerInfo?.fullName || order.customerName || 'Customer';

      const transactionPayload = {
        refNumber,
        fundAccountId: 'fund_igf_main',
        fundCategory: TOP_LEVEL_FUNDS.IGF,
        transactionType: TRANSACTION_TYPES.COLLECTION,
        expensePurpose: EXPENSE_PURPOSES.COLLECTION,
        amountCentavos,
        payeeOrPayer: customer,
        description: `Merchandise Sales Revenue: ${order.orderId} - ${pName} (x${qty})`,
        source: 'MERCHANDISE_ORDER',
        orderId: order.orderId,
        orderDocId,
        notes: notes || 'Merchandise profit credited to Income Generated Funds (IGF)',
        createdById: user?.uid || 'order-system',
        createdBy: user?.userName || user?.displayName || 'Order Management',
        createdAt: serverTimestamp(),
        postedAt: serverTimestamp(),
        status: TRANSACTION_STATUSES.POSTED,
      };

      transaction.set(txRef, transactionPayload);

      // 4. Mark the order as synced to IGF
      transaction.update(orderRef, {
        igfSynced: true,
        igfReversed: false,
        igfTxRef: refNumber,
        igfSyncedAt: new Date().toISOString(),
        igfAmountCentavos: amountCentavos,
        updatedAt: new Date().toISOString(),
      });

      // 5. Update the IGF Fund balance atomically
      transaction.update(igfRef, {
        balanceCentavos: currentBalanceCentavos + amountCentavos,
        updatedAt: serverTimestamp(),
      });

      return {
        success: true,
        refNumber,
        amountCentavos,
        newBalanceCentavos: currentBalanceCentavos + amountCentavos,
      };
    });
  },

  /**
   * Batch sync multiple merchandise orders into the IGF ledger
   */
  async batchSyncOrderRevenueToIGF({ orders, user, notes = '' }) {
    if (!orders || !orders.length) return { success: true, count: 0, totalCentavos: 0 };

    const eligibleOrders = orders.filter(
      (o) =>
        !o.igfSynced &&
        o.orderStatus !== 'Cancelled' &&
        (o.claimed || o.orderStatus === 'Completed' || o.orderStatus === 'Paid')
    );

    let count = 0;
    let totalCentavos = 0;
    const errors = [];

    for (const order of eligibleOrders) {
      try {
        const res = await this.syncOrderRevenueToIGF({ order, user, notes });
        if (res.success && !res.alreadySynced) {
          count++;
          totalCentavos += res.amountCentavos || 0;
        }
      } catch (err) {
        console.error(`Failed to sync order ${order.orderId} to IGF:`, err);
        errors.push({ orderId: order.orderId, error: err.message });
      }
    }

    return {
      success: true,
      count,
      totalCentavos,
      errors,
    };
  },

  /**
   * Reverse merchandise revenue from IGF ledger (e.g. order cancelled or refunded)
   */
  async reverseOrderRevenueFromIGF({ order, user, reason = 'Order cancelled or returned' }) {
    if (!order) throw new Error('Order is required.');
    if (!order.igfSynced) {
      return { success: true, message: 'Order was not synced to IGF.' };
    }

    const rawAmount = Number(order.productInfo?.totalPrice || order.totalPrice || 0);
    const amountCentavos = order.igfAmountCentavos || toCentavos(rawAmount);

    if (amountCentavos <= 0) {
      const orderRef = doc(db, 'orders', order.docId || order.id);
      await updateDoc(orderRef, {
        igfSynced: false,
        igfReversed: true,
        updatedAt: new Date().toISOString(),
      });
      return { success: true, message: 'Zero revenue order reversal completed.' };
    }

    return await runTransaction(db, async (transaction) => {
      // 1. Transaction-level idempotency lock on order document
      const orderDocId = order.docId || order.id;
      const orderRef = doc(db, 'orders', orderDocId);
      const orderSnap = await transaction.get(orderRef);
      if (orderSnap.exists()) {
        const orderData = orderSnap.data();
        if (orderData.igfSynced === false || orderData.igfReversed === true) {
          return {
            success: true,
            alreadyReversed: true,
            refNumber: orderData.igfReversalRef || null,
          };
        }
      }

      const igfRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, 'fund_igf_main');
      const igfSnap = await transaction.get(igfRef);
      if (!igfSnap.exists()) {
        throw new Error('IGF Fund Account not found.');
      }

      const currentBalanceCentavos = igfSnap.data().balanceCentavos || 0;

      // 2. Create reversal transaction with collision-free unique reference
      const txRef = doc(collection(db, COLLECTIONS.TRANSACTIONS));
      const safeOrderId = (order.orderId || 'ORD').trim();
      const docSuffix = orderDocId ? orderDocId.slice(-6).toUpperCase() : Date.now().toString().slice(-6);
      const refNumber = `REV-IGF-${safeOrderId}-${docSuffix}`;

      transaction.set(txRef, {
        refNumber,
        reversalOfTransactionId: order.igfTxRef || null,
        fundAccountId: 'fund_igf_main',
        fundCategory: TOP_LEVEL_FUNDS.IGF,
        transactionType: TRANSACTION_TYPES.REVERSAL,
        expensePurpose: EXPENSE_PURPOSES.REFUND || 'Refund',
        amountCentavos,
        payeeOrPayer: order.customerInfo?.fullName || order.customerName || 'Customer',
        description: `Reversal of Merchandise Revenue for Order #${order.orderId}: ${reason}`,
        source: 'MERCHANDISE_ORDER_REVERSAL',
        orderId: order.orderId,
        orderDocId,
        reversalReason: reason,
        createdById: user?.uid || 'order-system',
        createdBy: user?.userName || user?.displayName || 'Order Management',
        createdAt: serverTimestamp(),
        postedAt: serverTimestamp(),
        status: TRANSACTION_STATUSES.POSTED,
      });

      // 3. Update order document
      transaction.update(orderRef, {
        igfSynced: false,
        igfReversed: true,
        igfReversalRef: refNumber,
        igfReversalReason: reason,
        igfReversedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // 4. Decrement IGF Fund balance atomically
      const newBalanceCentavos = Math.max(0, currentBalanceCentavos - amountCentavos);
      transaction.update(igfRef, {
        balanceCentavos: newBalanceCentavos,
        updatedAt: serverTimestamp(),
      });

      return {
        success: true,
        refNumber,
        amountCentavos,
        newBalanceCentavos,
      };
    });
  },
};

export default financeService;
