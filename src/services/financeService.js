/**
 * financeService.js
 * Core database service and transactional operations for the redesigned Finance module.
 * Enforces atomic updates, append-only ledger entries, and double-entry consistency.
 */

import { db, auth } from '../firebase/firebaseConfig.js';
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
  formatPHP,
  toCentavos,
  fromCentavos,
} from '../utils/financeConstants.js';
import { validateTransactionRules } from '../utils/financeValidation.js';
import {
  computeAuthoritativeFundBalanceCentavos,
  computeDisbursedByAccount,
  computeDisbursedByAllocation,
  computeLedgerNetByAccount,
  computeTransactionBalanceDeltas,
  computeReversalBalanceDeltas,
  inferOrderStorageLocation,
  notifyFinanceUpdated,
} from '../utils/financeLedgerReconciliation.js';
import { computeNextAllocationSpentCentavos } from '../utils/ledgerTxFormHelpers.js';

const BACKEND_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MONGODB_BACKEND_URL) ||
  'http://localhost:3000';

const COLLECTIONS = {
  FUND_ACCOUNTS: 'fundAccounts',
  BUDGET_ALLOCATIONS: 'budgetAllocations',
  TRANSACTIONS: 'transactions',
  IGP_COLLECTIONS: 'igpCollections',
  PRE_ORDER_BATCHES: 'preOrderBatches',
  PRE_ORDER_ENTRIES: 'preOrderEntries',
  LEGACY_FUNDS: 'funds',
  LEGACY_BUDGETS: 'budgets',
};

export const financeService = {
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
          const existingSnap = await tx.get(accRef);
          if (existingSnap.exists()) return;
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
          updates.appropriatedCeilingCentavos = current.balanceCentavos || 0;
          updates.appropriationResolutionRef = current.appropriationResolutionRef || '';
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
   * Update Fiscal Budget (establishes term ceiling and atomically recalculates
   * remaining balanceCentavos against posted PPMP ledger disbursements).
   */
  async updateFiscalBudget(fundAccountId = 'fund_fiscal_year_budget', budgetData, user) {
    const fundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, fundAccountId);
    const { budgetAmount, ceilingAmount, resolutionRef, bankAccountReference, note } = budgetData;
    const finalAmount = budgetAmount !== undefined ? budgetAmount : ceilingAmount;
    const amountCentavos = toCentavos(finalAmount);

    const txSnap = await getDocs(
      query(collection(db, COLLECTIONS.TRANSACTIONS), where('fundAccountId', '==', fundAccountId))
    );
    const accountTxs = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const disbursedCentavos = computeDisbursedByAccount(accountTxs).get(fundAccountId) || 0;
    const remainingBalanceCentavos = Math.max(0, amountCentavos - disbursedCentavos);

    const patch = {
      balanceCentavos: remainingBalanceCentavos,
      appropriatedCeilingCentavos: amountCentavos,
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
    notifyFinanceUpdated({ fundAccountId });
    return true;
  },

  /**
   * Update Fund Balance (for non-fiscal funds e.g. FSG, IGF, IGP)
   */
  async updateFundBalance(fundAccountId, balanceAmount, user, reason = '', storageLocation = undefined) {
    const fundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, fundAccountId);
    const amountCentavos = toCentavos(balanceAmount);
    const isFiscalOrFsg =
      fundAccountId === 'fund_fiscal_year_budget' || fundAccountId === 'fund_fsg_remittance';

    let finalBalanceCentavos = amountCentavos;
    if (isFiscalOrFsg) {
      const txSnap = await getDocs(
        query(collection(db, COLLECTIONS.TRANSACTIONS), where('fundAccountId', '==', fundAccountId))
      );
      const accountTxs = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const disbursedCentavos = computeDisbursedByAccount(accountTxs).get(fundAccountId) || 0;
      finalBalanceCentavos = Math.max(0, amountCentavos - disbursedCentavos);
    }

    const patch = {
      balanceCentavos: finalBalanceCentavos,
      lastReconciliationReason: reason || 'Secretariat Fund Balance Calibration',
      updatedAt: serverTimestamp(),
      updatedBy: user?.userName || user?.displayName || 'Authorized Secretary',
      updatedById: user?.uid || 'officer',
    };
    if (storageLocation !== undefined && String(storageLocation).trim() !== '') {
      patch.bankAccountReference = String(storageLocation).trim();
    }
    if (isFiscalOrFsg) {
      patch.appropriatedCeilingCentavos = amountCentavos;
    }
    await updateDoc(fundRef, patch);
    notifyFinanceUpdated({ fundAccountId });
    return true;
  },

  /**
   * Upload a receipt image/PDF to the dedicated 'Receipts' subfolder in Google Drive
   * (same Google Drive archive used for Documents).
   */
  async uploadReceiptToDrive(file, meta = {}, onProgress = null) {
    if (!file) throw new Error('Receipt file is required.');
    const user = auth?.currentUser;
    if (!user) throw new Error('You must be signed in to upload a receipt to Google Drive.');
    const token = await user.getIdToken();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'Receipts');
    formData.append('documentType', 'receipt');
    formData.append('title', meta.title || `Receipt - ${file.name}`);
    if (meta.office) formData.append('office', meta.office);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && typeof onProgress === 'function') {
          onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
        }
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          try {
            const body = JSON.parse(xhr.responseText);
            const data = body.data || {};
            const fileId = data.fileId || body.fileId;
            const downloadUrl = fileId
              ? `${BACKEND_URL}/api/documents/${fileId}/download?disposition=inline`
              : '';
            resolve({
              fileId,
              filename: data.filename || file.name,
              driveFileId: data.driveFileId || null,
              driveWebViewLink: data.driveWebViewLink || null,
              driveFolderName: data.driveFolderName || 'Receipts',
              driveSyncStatus: data.driveSyncStatus || 'pending',
              downloadUrl,
            });
          } catch (err) {
            reject(new Error(err.message || 'Invalid response from receipt upload server'));
          }
        } else {
          try {
            const errBody = JSON.parse(xhr.responseText);
            reject(new Error(errBody.message || errBody.error || 'Receipt upload failed'));
          } catch {
            reject(new Error(`Receipt upload failed with status ${xhr.status}`));
          }
        }
      });
      xhr.addEventListener('error', () => {
        reject(new Error('Network error uploading receipt to Google Drive backend.'));
      });
      xhr.open('POST', `${BACKEND_URL}/api/documents/upload`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  },

  /**
   * Reconcile a fund account's displayed card balance directly from its posted Append-Only Ledger entries
   * (preserving any historical unlinked `igpCollections` when reconciling `fund_igp_main`).
   */
  async reconcileFundBalanceFromLedger(fundAccountId, user, options = {}) {
    if (!fundAccountId) throw new Error('Fund account ID is required.');
    const { silent = false } = options || {};
    const fundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, fundAccountId);
    const isIgpAccount = fundAccountId === 'fund_igp_main';
    const [fundSnap, txSnap, destSnap, igpSnap] = await Promise.all([
      getDoc(fundRef),
      getDocs(query(collection(db, COLLECTIONS.TRANSACTIONS), where('fundAccountId', '==', fundAccountId))),
      getDocs(
        query(collection(db, COLLECTIONS.TRANSACTIONS), where('transferDestinationAccountId', '==', fundAccountId))
      ),
      isIgpAccount ? getDocs(collection(db, COLLECTIONS.IGP_COLLECTIONS)) : Promise.resolve(null),
    ]);
    const fundData = fundSnap.exists() ? { id: fundAccountId, ...fundSnap.data() } : { id: fundAccountId };
    const seen = new Map();
    txSnap.docs.forEach((d) => seen.set(d.id, { id: d.id, ...d.data() }));
    destSnap.docs.forEach((d) => seen.set(d.id, { id: d.id, ...d.data() }));
    const allTxs = Array.from(seen.values());
    const igpCollections = igpSnap ? igpSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];

    const netMap = computeLedgerNetByAccount(allTxs);
    const ledgerNetCentavos = netMap.get(fundAccountId) || 0;
    const appliedBalanceCentavos = computeAuthoritativeFundBalanceCentavos(fundData, allTxs, igpCollections);

    await updateDoc(fundRef, {
      balanceCentavos: appliedBalanceCentavos,
      lastReconciliationReason: 'Reconciled card balance with Append-Only Financial Ledger',
      updatedAt: serverTimestamp(),
      updatedBy: user?.userName || user?.displayName || 'Authorized Officer',
      updatedById: user?.uid || 'officer',
    });
    if (!silent) {
      notifyFinanceUpdated({ fundAccountId, reconciled: true });
    }
    return { ledgerNetCentavos, appliedBalanceCentavos };
  },

  /**
   * Fetch all IGP collections (used to protect historical unlinked IGP inflows during reconciliation).
   */
  async getIgpCollections() {
    const snap = await getDocs(collection(db, COLLECTIONS.IGP_COLLECTIONS));
    return snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
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
      resolutionDocumentId = null,
      startDate = null,
      endDate = null,
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

    // Rule: Total planned estimations for APPROVED allocations cannot exceed the initial Fiscal Budget or FSG ceiling.
    // FINANCE_CLARIFICATION.MD §3.3-§3.4: Drafts do not count toward the cap until approved.
    if (fundAccountId && allocationData.status !== 'draft') {
      const fundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, fundAccountId);
      const fundSnap = await getDoc(fundRef);
      if (fundSnap.exists()) {
        const fund = fundSnap.data();
        const isFiscalOrFsg =
          fundAccountId === 'fund_fiscal_year_budget' ||
          fundAccountId === 'fund_fsg_remittance';
        const budgetBaseCentavos = isFiscalOrFsg
          ? (fund.appropriatedCeilingCentavos || fund.balanceCentavos || 0)
          : (fund.balanceCentavos || 0);

        if (budgetBaseCentavos > 0) {
          const allocSnap = await getDocs(
            query(
              collection(db, COLLECTIONS.BUDGET_ALLOCATIONS),
              where('fundAccountId', '==', fundAccountId),
              where('status', '==', 'approved')
            )
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
      resolutionDocumentId: resolutionDocumentId || null,
      startDate: startDate || null,
      endDate: endDate || null,
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

    const postedTxSnap = await getDocs(
      query(
        collection(db, COLLECTIONS.TRANSACTIONS),
        where('budgetAllocationId', '==', allocationId),
        where('status', '==', TRANSACTION_STATUSES.POSTED)
      )
    );
    const hasActivePostedTx = postedTxSnap.docs.some(
      (d) => (d.data().transactionType || '').toLowerCase() !== TRANSACTION_TYPES.REVERSAL
    );
    if ((current.spentAmountCentavos || 0) > 0 || hasActivePostedTx) {
      throw new Error(
        'Cannot edit budget allocation: This budget has already been posted to the financial ledger and is locked.'
      );
    }

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
    if (updateData.resolutionDocumentId !== undefined) patch.resolutionDocumentId = updateData.resolutionDocumentId || null;
    if (updateData.startDate !== undefined) patch.startDate = updateData.startDate || null;
    if (updateData.endDate !== undefined) patch.endDate = updateData.endDate || null;
    if (updateData.description !== undefined) patch.description = updateData.description;
    if (updateData.receiptUrl !== undefined) {
      patch.supportingDocumentIds = updateData.receiptUrl ? [updateData.receiptUrl] : [];
    }
    if (updateData.allocatedAmount !== undefined || updateData.allocated !== undefined) {
      const amt = updateData.allocatedAmount !== undefined ? updateData.allocatedAmount : updateData.allocated;
      patch.approvedAmountCentavos = toCentavos(amt);
    }

    // Enforce fiscal/FSG ceiling cap whenever the resulting status is 'approved'
    // (covers both amount edits AND Draft -> Approved promotions without allocatedAmount in updateData)
    const effectiveStatus = patch.status || current.status || 'approved';
    const targetFundId = patch.fundAccountId || current.fundAccountId;
    const effectiveAmountCentavos =
      patch.approvedAmountCentavos !== undefined
        ? patch.approvedAmountCentavos
        : (current.approvedAmountCentavos || 0);

    if (
      targetFundId &&
      effectiveStatus === 'approved' &&
      (patch.approvedAmountCentavos !== undefined ||
        patch.status === 'approved' ||
        patch.fundAccountId !== undefined)
    ) {
      const fundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, targetFundId);
      const fundSnap = await getDoc(fundRef);
      if (fundSnap.exists()) {
        const fund = fundSnap.data();
        const isFiscalOrFsg =
          targetFundId === 'fund_fiscal_year_budget' ||
          targetFundId === 'fund_fsg_remittance';
        const budgetBaseCentavos = isFiscalOrFsg
          ? (fund.appropriatedCeilingCentavos || fund.balanceCentavos || 0)
          : (fund.balanceCentavos || 0);

        if (budgetBaseCentavos > 0) {
          const allocSnap = await getDocs(
            query(
              collection(db, COLLECTIONS.BUDGET_ALLOCATIONS),
              where('fundAccountId', '==', targetFundId),
              where('status', '==', 'approved')
            )
          );
          const otherAllocationsTotal = allocSnap.docs
            .filter((d) => d.id !== allocationId)
            .reduce((sum, d) => sum + (d.data().approvedAmountCentavos || 0), 0);

          if (otherAllocationsTotal + effectiveAmountCentavos > budgetBaseCentavos) {
            const availableCentavos = Math.max(0, budgetBaseCentavos - otherAllocationsTotal);
            throw new Error(
              `Update rejected: Total planned allocations (${formatPHP(otherAllocationsTotal + effectiveAmountCentavos, true)}) would exceed the initial budget (${formatPHP(budgetBaseCentavos, true)}). Available surplus: ${formatPHP(availableCentavos, true)}.`
            );
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
        previousStatus: data.status && data.status !== 'archived' ? data.status : 'approved',
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
   * Restore an archived budget allocation (enforcing fiscal/FSG ceiling cap before restoring to approved)
   */
  async restoreBudgetAllocation(allocationId, user) {
    const allocRef = doc(db, COLLECTIONS.BUDGET_ALLOCATIONS, allocationId);
    const snap = await getDoc(allocRef);
    if (!snap.exists()) {
      throw new Error('Budget allocation not found.');
    }
    const current = snap.data() || {};
    const targetStatus = current.previousStatus === 'draft' ? 'draft' : 'approved';
    const targetFundId = current.fundAccountId || 'fund_fiscal_year_budget';
    const restoreAmountCentavos = current.approvedAmountCentavos || 0;

    if (targetStatus === 'approved' && targetFundId) {
      const fundSnap = await getDoc(doc(db, COLLECTIONS.FUND_ACCOUNTS, targetFundId));
      if (fundSnap.exists()) {
        const fund = fundSnap.data();
        const isFiscalOrFsg =
          targetFundId === 'fund_fiscal_year_budget' ||
          targetFundId === 'fund_fsg_remittance';
        const budgetBaseCentavos = isFiscalOrFsg
          ? (fund.appropriatedCeilingCentavos || fund.balanceCentavos || 0)
          : (fund.balanceCentavos || 0);

        if (budgetBaseCentavos > 0) {
          const allocSnap = await getDocs(
            query(
              collection(db, COLLECTIONS.BUDGET_ALLOCATIONS),
              where('fundAccountId', '==', targetFundId),
              where('status', '==', 'approved')
            )
          );
          const activeAllocated = allocSnap.docs
            .filter((d) => d.id !== allocationId)
            .reduce((sum, d) => sum + (d.data().approvedAmountCentavos || 0), 0);

          if (activeAllocated + restoreAmountCentavos > budgetBaseCentavos) {
            const availableCentavos = Math.max(0, budgetBaseCentavos - activeAllocated);
            throw new Error(
              `Restore rejected: Restoring this allocation (${formatPHP(restoreAmountCentavos, true)}) would exceed the initial budget (${formatPHP(budgetBaseCentavos, true)}). Available surplus: ${formatPHP(availableCentavos, true)}.`
            );
          }
        }
      }
    }

    await updateDoc(allocRef, {
      status: targetStatus,
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
      receiptDriveLink = '',
      receiptFileId = '',
      receiptOrNumber = '',
      receiptDetails = '',
      receiptLabel = '',
      supportingDocumentIds = [],
      custodianUserId = null,
      custodianName = null,
      receiptExceptionReason = null,
      transferDestinationAccountId = null,
      storageLocation = null,
      status = TRANSACTION_STATUSES.POSTED,
    } = txData;

    const amountCentavos = toCentavos(amount);

    // Pre-fetch posted ledger disbursements for this allocation so recording an
    // already-entered PPMP Actual Spent amount never double-counts spentAmountCentavos
    // or falsely triggers a depleted/overspent rejection.
    let ledgerPostedBeforeCentavos = 0;
    if (budgetAllocationId) {
      const allocTxSnap = await getDocs(
        query(
          collection(db, COLLECTIONS.TRANSACTIONS),
          where('budgetAllocationId', '==', budgetAllocationId)
        )
      );
      const allocTxs = allocTxSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      ledgerPostedBeforeCentavos =
        computeDisbursedByAllocation(allocTxs).get(budgetAllocationId) || 0;
    }

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
          remainingAllocCentavos = Math.max(0, approved - ledgerPostedBeforeCentavos);
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
        fundAccountId,
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
        receiptDriveLink,
        receiptOrNumber,
        receiptDetails,
        custodianUserId,
        transferDestinationAccountId,
        availableBalanceCentavos: fundData.balanceCentavos || 0,
        availableAllocationCentavos: remainingAllocCentavos,
        availableLineItemCentavos: remainingLineItemCentavos,
      });

      if (!validation.isValid && status === TRANSACTION_STATUSES.POSTED) {
        throw new Error(`Transaction rejected: ${validation.errors.join(' ')}`);
      }

      let destRef = null;
      let destData = null;
      if (
        status === TRANSACTION_STATUSES.POSTED &&
        String(transactionType || '').toLowerCase() === TRANSACTION_TYPES.TRANSFER
      ) {
        if (!transferDestinationAccountId) {
          throw new Error('Destination fund account is required for a transfer.');
        }
        destRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, transferDestinationAccountId);
        const destSnap = await transaction.get(destRef);
        if (!destSnap.exists()) {
          throw new Error('Destination fund account not found.');
        }
        destData = destSnap.data();
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
        receiptUrl: receiptDriveLink || receiptUrl || '',
        receiptDriveLink: receiptDriveLink || '',
        receiptFileId: receiptFileId || '',
        receiptOrNumber: (receiptOrNumber || '').trim(),
        receiptDetails: (receiptDetails || '').trim(),
        receiptLabel: (receiptLabel || '').trim(),
        supportingDocumentIds,
        custodianUserId,
        custodianName,
        receiptExceptionReason,
        transferDestinationAccountId,
        storageLocation: storageLocation?.trim() || fundData.bankAccountReference || '',
        isOverspent: Boolean(validation.isOverspent),
        warnings: validation.warnings || [],
        createdById: user.uid,
        createdBy: user.userName || user.displayName || 'Authorized Officer',
        createdAt: serverTimestamp(),
        postedAt: status === TRANSACTION_STATUSES.POSTED ? serverTimestamp() : null,
        status,
      };

      transaction.set(newTxRef, transactionPayload);

      // 5. Update Ledger Balances if Posted (Double-entry safe: TRANSFER debits source AND credits destination)
      if (status === TRANSACTION_STATUSES.POSTED) {
        const { sourceDeltaCentavos, destinationDeltaCentavos } =
          computeTransactionBalanceDeltas({
            transactionType,
            amountCentavos,
            transferDestinationAccountId,
          });

        const newBalance = Math.max(0, (fundData.balanceCentavos || 0) + sourceDeltaCentavos);
        const isFiscalOrFsgAccount =
          fundAccountId === 'fund_fiscal_year_budget' ||
          fundAccountId === 'fund_fsg_remittance' ||
          fundData.topLevelCategory === TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET ||
          fundData.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE;
        const fundUpdate = {
          balanceCentavos: newBalance,
          updatedAt: serverTimestamp(),
        };
        // Anchor appropriatedCeilingCentavos if it was 0/unset before the first disbursement
        // so subsequent ledger reconciliations never double-subtract against balanceCentavos.
        if (
          isFiscalOrFsgAccount &&
          (!fundData.appropriatedCeilingCentavos || Number(fundData.appropriatedCeilingCentavos) <= 0) &&
          (fundData.balanceCentavos || 0) > 0
        ) {
          fundUpdate.appropriatedCeilingCentavos = fundData.balanceCentavos;
        }
        transaction.update(fundRef, fundUpdate);

        // Update allocation and sub-line item spent if applicable (without double-counting unposted PPMP spent)
        if (allocRef && allocationData) {
          const newLedgerPosted = ledgerPostedBeforeCentavos + amountCentavos;
          const newSpent = computeNextAllocationSpentCentavos({
            existingSpentCentavos: allocationData.spentAmountCentavos || 0,
            ledgerPostedBeforeCentavos,
            postedAmountCentavos: amountCentavos,
          });
          const allocUpdates = {
            spentAmountCentavos: newSpent,
            ledgerPostedCentavos: newLedgerPosted,
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

        // If transfer, atomically credit destination account (pre-read before writes)
        if (destRef && destData && destinationDeltaCentavos !== 0) {
          transaction.update(destRef, {
            balanceCentavos: Math.max(0, (destData.balanceCentavos || 0) + destinationDeltaCentavos),
            updatedAt: serverTimestamp(),
          });
        }
      }

      return { id: newTxRef.id, refNumber };
    }).then((result) => {
      notifyFinanceUpdated({
        fundAccountId,
        transferDestinationAccountId: transferDestinationAccountId || null,
        refNumber: result.refNumber,
      });
      return result;
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
      if ((orig.transactionType || '').toLowerCase() === TRANSACTION_TYPES.REVERSAL) {
        throw new Error('Reversal entries cannot be reversed.');
      }

      const fundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, orig.fundAccountId);
      const fundSnap = await transaction.get(fundRef);
      if (!fundSnap.exists()) throw new Error('Associated fund account not found.');
      const fundData = fundSnap.data();

      // Firestore requires ALL reads (transaction.get) before ANY writes (set/update).
      let allocRef = null;
      let allocData = null;
      if (orig.budgetAllocationId) {
        allocRef = doc(db, COLLECTIONS.BUDGET_ALLOCATIONS, orig.budgetAllocationId);
        const allocSnap = await transaction.get(allocRef);
        if (allocSnap.exists()) {
          allocData = allocSnap.data();
        }
      }

      const isTransferOrig =
        String(orig.transactionType || '').toLowerCase() === TRANSACTION_TYPES.TRANSFER;
      let destRef = null;
      let destData = null;
      if (isTransferOrig && orig.transferDestinationAccountId) {
        destRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, orig.transferDestinationAccountId);
        const destSnap = await transaction.get(destRef);
        if (!destSnap.exists()) {
          throw new Error('Destination fund account not found for transfer reversal.');
        }
        destData = destSnap.data();
      }

      // Compute exact double-entry inverse deltas (TRANSFER reversal credits source AND debits destination)
      const { sourceDeltaCentavos, destinationDeltaCentavos } =
        computeReversalBalanceDeltas({
          transactionType: orig.transactionType,
          amountCentavos: orig.amountCentavos,
          deltaCentavos: orig.deltaCentavos,
          transferDestinationAccountId: orig.transferDestinationAccountId || null,
        });

      if (
        destRef &&
        destData &&
        destinationDeltaCentavos < 0 &&
        (destData.balanceCentavos || 0) + destinationDeltaCentavos < 0
      ) {
        throw new Error(
          'Cannot reverse transfer: destination fund account has insufficient balance to return transferred funds.'
        );
      }

      // 1. Mark original as reversed
      transaction.update(origRef, {
        status: TRANSACTION_STATUSES.REVERSED,
        reversedAt: serverTimestamp(),
        reversedBy: user?.userName || user?.displayName || 'Authorized Officer',
        reversalReason: reason,
      });

      // 2. Create Reversal Audit Transaction
      const reversalRef = doc(collection(db, COLLECTIONS.TRANSACTIONS));
      transaction.set(reversalRef, {
        refNumber: `REV-${orig.refNumber}`,
        fundAccountId: orig.fundAccountId,
        fundCategory: orig.fundCategory,
        transactionType: TRANSACTION_TYPES.REVERSAL,
        reversedTransactionType: orig.transactionType || null,
        transferDestinationAccountId: orig.transferDestinationAccountId || null,
        expensePurpose: orig.expensePurpose || 'Reversal',
        amountCentavos: orig.amountCentavos,
        description: `Authorized reversal of ${orig.refNumber}: ${reason}`,
        reversalOfTransactionId: originalTxId,
        budgetAllocationId: orig.budgetAllocationId || null,
        lineItemId: orig.lineItemId || null,
        createdById: user?.uid || 'officer',
        createdBy: user?.userName || user?.displayName || 'Authorized Officer',
        createdAt: serverTimestamp(),
        postedAt: serverTimestamp(),
        status: TRANSACTION_STATUSES.POSTED,
      });

      // 3. Update Source Fund Balance (and Destination Fund Balance for TRANSFER reversals)
      transaction.update(fundRef, {
        balanceCentavos: Math.max(0, (fundData.balanceCentavos || 0) + sourceDeltaCentavos),
        updatedAt: serverTimestamp(),
      });

      if (destRef && destData && destinationDeltaCentavos !== 0) {
        transaction.update(destRef, {
          balanceCentavos: Math.max(0, (destData.balanceCentavos || 0) + destinationDeltaCentavos),
          updatedAt: serverTimestamp(),
        });
      }

      // 4. Update Allocation spent and line item spent if applicable (pre-read above)
      if (allocRef && allocData) {
        const newSpent = Math.max(0, (allocData.spentAmountCentavos || 0) - orig.amountCentavos);
        const allocUpdates = {
          spentAmountCentavos: newSpent,
          updatedAt: serverTimestamp(),
        };
        if (allocData.ledgerPostedCentavos !== undefined) {
          allocUpdates.ledgerPostedCentavos = Math.max(
            0,
            Number(allocData.ledgerPostedCentavos || 0) - orig.amountCentavos
          );
        }

        if (Array.isArray(allocData.approvedLineItems)) {
          if (orig.lineItemId) {
            allocUpdates.approvedLineItems = allocData.approvedLineItems.map((li) => {
              if (li.id === orig.lineItemId) {
                const itemPlanned = li.plannedCentavos || toCentavos(li.plannedAmount || li.estimatedCost || 0);
                const itemSpent = Math.max(0, (li.spentCentavos || 0) - orig.amountCentavos);
                return {
                  ...li,
                  spentCentavos: itemSpent,
                  spentAmount: fromCentavos(itemSpent),
                  status: getPPMPStatus(itemSpent, itemPlanned),
                };
              }
              return li;
            });
          } else if (newSpent === 0) {
            allocUpdates.approvedLineItems = allocData.approvedLineItems.map((li) => {
              const itemPlanned = li.plannedCentavos || toCentavos(li.plannedAmount || li.estimatedCost || 0);
              return {
                ...li,
                spentCentavos: 0,
                spentAmount: 0,
                status: getPPMPStatus(0, itemPlanned),
              };
            });
          } else {
            let remainingToDeduct = orig.amountCentavos;
            allocUpdates.approvedLineItems = allocData.approvedLineItems.map((li) => {
              const currentItemSpent = li.spentCentavos || 0;
              if (remainingToDeduct <= 0 || currentItemSpent <= 0) return li;
              const deduct = Math.min(currentItemSpent, remainingToDeduct);
              remainingToDeduct -= deduct;
              const itemPlanned = li.plannedCentavos || toCentavos(li.plannedAmount || li.estimatedCost || 0);
              const itemSpent = currentItemSpent - deduct;
              return {
                ...li,
                spentCentavos: itemSpent,
                spentAmount: fromCentavos(itemSpent),
                status: getPPMPStatus(itemSpent, itemPlanned),
              };
            });
          }
        }

        transaction.update(allocRef, allocUpdates);
      }

      return reversalRef.id;
    }).then((id) => {
      notifyFinanceUpdated({ reversalId: id });
      return id;
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
    if (!String(name || '').trim()) {
      throw new Error('Batch name is required.');
    }
    if (!String(product || '').trim()) {
      throw new Error('Product name is required.');
    }
    if (unitPriceCentavos <= 0) {
      throw new Error('Unit price must be greater than ₱0.00.');
    }

    const docRef = await addDoc(collection(db, COLLECTIONS.PRE_ORDER_BATCHES), {
      name: String(name).trim(),
      product: String(product).trim(),
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
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      throw new Error('Order quantity must be a whole number of at least 1.');
    }
    if (!String(studentName || '').trim()) {
      throw new Error('Student name is required.');
    }
    const paidCentavos = toCentavos(amountPaid);
    if (paidCentavos <= 0) {
      throw new Error('Payment amount must be greater than ₱0.00.');
    }

    return await runTransaction(db, async (transaction) => {
      const batchRef = doc(db, COLLECTIONS.PRE_ORDER_BATCHES, batchId);
      const batchSnap = await transaction.get(batchRef);
      if (!batchSnap.exists()) throw new Error('Batch not found.');
      const batch = batchSnap.data();
      if (batch.status && batch.status !== 'OPEN_FOR_PREORDERS') {
        throw new Error(`Cannot record student payment: batch status is "${batch.status}" (must be OPEN_FOR_PREORDERS).`);
      }

      const igfFundRef = doc(db, COLLECTIONS.FUND_ACCOUNTS, 'fund_igf_main');
      const igfSnap = await transaction.get(igfFundRef);
      const igfStorageLocation = igfSnap.exists()
        ? (igfSnap.data().bankAccountReference || 'Treasury Safe / Cash Box')
        : 'Treasury Safe / Cash Box';

      const totalDueCentavos = (batch.unitPriceCentavos || 0) * qty;

      // Add PreOrderEntry
      const entryRef = doc(collection(db, COLLECTIONS.PRE_ORDER_ENTRIES));
      transaction.set(entryRef, {
        batchId,
        studentId: String(studentId || '').trim(),
        studentName: String(studentName).trim(),
        variant,
        quantity: qty,
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
        storageLocation: igfStorageLocation,
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

      if (igfSnap.exists()) {
        transaction.update(igfFundRef, {
          balanceCentavos: (igfSnap.data().balanceCentavos || 0) + paidCentavos,
          updatedAt: serverTimestamp(),
        });
      }

      return { entryId: entryRef.id, refNumber };
    }).then((result) => {
      notifyFinanceUpdated({ fundAccountId: 'fund_igf_main', refNumber: result.refNumber });
      return result;
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
  async getTransactions() {
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
      const paymentMethod = order.paymentInfo?.paymentMethod || 'Cash';
      const baseStorageLocation = igfSnap.exists()
        ? (igfSnap.data().bankAccountReference || 'Treasury Safe / Cash Box')
        : 'Treasury Safe / Cash Box';
      const storageLocation = inferOrderStorageLocation(order, baseStorageLocation);

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
        paymentMethod,
        storageLocation,
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
        igfStorageLocation: storageLocation,
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
        storageLocation,
        newBalanceCentavos: currentBalanceCentavos + amountCentavos,
      };
    }).then((result) => {
      notifyFinanceUpdated({ fundAccountId: 'fund_igf_main', refNumber: result.refNumber });
      return result;
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
      const paymentMethod = order.paymentInfo?.paymentMethod || 'Cash';
      const storageLocation = inferOrderStorageLocation(
        order,
        igfSnap.data().bankAccountReference || 'Treasury Safe / Cash Box'
      );

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
        paymentMethod,
        storageLocation,
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
    }).then((result) => {
      notifyFinanceUpdated({ fundAccountId: 'fund_igf_main', refNumber: result.refNumber });
      return result;
    });
  },
};

export default financeService;
