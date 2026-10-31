import React, { useState, useMemo } from 'react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import usePermissions from '../../hooks/usePermissions.js';
import {
  PROCUREMENT_TYPES,
  PPMP_STATUSES,
  PPMP_STATUS_CONFIG,
  TRANSACTION_TYPES,
  EXPENSE_PURPOSES,
  formatPHP,
  fromCentavos,
  toCentavos,
} from '../../utils/financeConstants.js';
import styles from './PPMPInspectorDrawer.module.css';
import {
  HiX,
  HiLightningBolt,
  HiCheckCircle,
  HiReceiptTax,
  HiClock,
  HiDocumentText,
  HiUser,
  HiTrash,
  HiExclamationCircle,
} from 'react-icons/hi';
import {
  Landmark,
  Layers,
  Building2,
  Boxes,
  PackageCheck,
  Coins,
} from 'lucide-react';

const PPMPInspectorDrawer = ({ item, onClose }) => {
  const {
    fundAccounts = [],
    transactions = [],
    recordTransaction,
    updateBudget,
    deleteBudget,
    restoreBudget,
    refreshFinanceData,
  } = useFinance();
  const { currentUser, userName } = useAuth();
  const { canEditFinance } = usePermissions();

  // Active Disbursement Target (null if closed, or lineItem object, or 'GENERAL')
  const [activeDisburseTarget, setActiveDisburseTarget] = useState(null);
  const [disburseForm, setDisburseForm] = useState({
    amount: '',
    payeeOrPayer: '',
    description: '',
    receiptUrl: '',
  });
  const [disburseError, setDisburseError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successToast, setSuccessToast] = useState(null);

  // Approval flow for Draft allocations
  const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
  const [approvalResolution, setApprovalResolution] = useState(item.resolution || '');
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState(null);

  // Target Fund Account Telemetry (SSG Fiscal Budget or FSG Remittance)
  const targetFundAccountId = item.fundAccountId || (item.isFSG ? 'fund_fsg_remittance' : 'fund_fiscal_year_budget');
  const isFSG = targetFundAccountId === 'fund_fsg_remittance';
  const targetFundAccount = fundAccounts.find((a) => a.id === targetFundAccountId);
  const liquidBalanceCentavos = targetFundAccount?.balanceCentavos || 0;
  const fundDisplayName = isFSG ? 'FSG Remittance' : 'Fiscal Budget';

  // Filter Transactions for this Allocation
  const allocationTransactions = useMemo(() => {
    return (transactions || []).filter(
      (tx) => tx.budgetAllocationId === item.id
    );
  }, [transactions, item.id]);

  // Open inline disbursement
  const handleOpenDisburse = (lineItem = null) => {
    setActiveDisburseTarget(lineItem);
    const linePlanned = lineItem?.plannedAmount !== undefined
      ? lineItem.plannedAmount
      : fromCentavos(lineItem?.plannedCentavos || 0);
    const lineSpent = lineItem?.spentAmount !== undefined
      ? lineItem.spentAmount
      : fromCentavos(lineItem?.spentCentavos || 0);
    const maxVal = lineItem
      ? Math.max(0, linePlanned - lineSpent)
      : (item.remaining || 0);

    setDisburseForm({
      amount: maxVal > 0 ? maxVal.toFixed(2) : '',
      payeeOrPayer: '',
      description: lineItem ? `Disbursement for ${lineItem.name} (${item.eventName})` : `Disbursement for ${item.eventName}`,
      resolutionRef: item.resolution || item.raw?.resolutionRef || `PPMP-RES-${new Date().getFullYear()}-${item.id ? String(item.id).slice(-4) : '2026'}`,
      receiptUrl: '',
    });
    setDisburseError(null);
  };

  // Submit Disbursement
  const handleSubmitDisbursement = async (e) => {
    e.preventDefault();
    setDisburseError(null);
    const amountNum = parseFloat(disburseForm.amount);

    if (isNaN(amountNum) || amountNum <= 0) {
      setDisburseError('Please enter a valid disbursement amount greater than ₱0.');
      return;
    }

    const amountCentavos = toCentavos(amountNum);

    // Validate against liquid balance of fund
    if (amountCentavos > liquidBalanceCentavos) {
      setDisburseError(
        `Insufficient liquid funds in ${fundDisplayName} (${formatPHP(liquidBalanceCentavos, true)} available).`
      );
      return;
    }

    try {
      setIsSubmitting(true);
      const isProject = item.procurementType === PROCUREMENT_TYPES.PROJECT;
      const purpose = isProject
        ? EXPENSE_PURPOSES.PROJECT_OPERATING_EXPENSE
        : EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE;

      await recordTransaction(
        {
          fundAccountId: targetFundAccountId,
          transactionType: TRANSACTION_TYPES.EXPENSE,
          expensePurpose: purpose,
          amount: amountNum,
          payeeOrPayer: disburseForm.payeeOrPayer.trim(),
          description: disburseForm.description.trim(),
          budgetAllocationId: item.id,
          lineItemId: activeDisburseTarget?.id || null,
          resolutionRef: disburseForm.resolutionRef?.trim() || item.resolution || item.raw?.resolutionRef || 'PPMP-DISBURSEMENT',
          receiptUrl: disburseForm.receiptUrl.trim(),
          custodianUserId: currentUser?.uid || '',
          custodianName: userName || '',
        },
        { uid: currentUser?.uid || 'officer', userName }
      );

      setSuccessToast(`Disbursed ${formatPHP(amountCentavos, true)} from ${fundDisplayName}.`);
      setActiveDisburseTarget(null);
      await refreshFinanceData();
      setTimeout(() => setSuccessToast(null), 3500);
    } catch (err) {
      setDisburseError(err.message || 'Error posting disbursement.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveDraft = async (e) => {
    e.preventDefault();
    setApproveError(null);
    if (!approvalResolution.trim()) {
      setApproveError('An official Board Resolution reference is required to approve this allocation.');
      return;
    }
    try {
      setIsApproving(true);
      await updateBudget(item.id, {
        status: 'approved',
        resolution: approvalResolution.trim(),
        resolutionRef: approvalResolution.trim(),
      });
      setSuccessToast(`Allocation approved under Resolution ${approvalResolution.trim()}!`);
      setIsApproveModalOpen(false);
      await refreshFinanceData();
      setTimeout(() => setSuccessToast(null), 3500);
    } catch (err) {
      setApproveError(err.message || 'Error approving allocation.');
    } finally {
      setIsApproving(false);
    }
  };

  const handleDeleteFromDrawer = async () => {
    if (!canEditFinance) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete "${item.eventName}"?\n\nIf expenses have been recorded against it, the record will be safely archived to protect audit integrity.`
    );
    if (!confirmed) return;
    try {
      await deleteBudget(item.id);
      onClose();
      await refreshFinanceData();
    } catch (err) {
      alert(err.message || 'Failed to delete allocation.');
    }
  };

  const handleRestoreFromDrawer = async () => {
    if (!canEditFinance) return;
    const confirmed = window.confirm(
      `Restore "${item.eventName}" back to active procurement?`
    );
    if (!confirmed) return;
    try {
      if (restoreBudget) {
        await restoreBudget(item.id);
      }
      onClose();
      await refreshFinanceData();
    } catch (err) {
      alert(err.message || 'Failed to restore allocation.');
    }
  };

  const isArchived = item.status === 'archived' || item.isArchived;
  const isDraft = item.status === 'draft';
  const isFresh = item.ppmpStatus === PPMP_STATUSES.FRESH;
  const isPartial = item.ppmpStatus === PPMP_STATUSES.PARTIALLY_USED;
  const isDepleted = item.ppmpStatus === PPMP_STATUSES.DEPLETED || (item.remaining || 0) <= 0;

  const badgeStatusClass = isFresh
    ? styles.statusFresh
    : isPartial
    ? styles.statusPartial
    : styles.statusDepleted;

  const dotClass = isFresh
    ? styles.dotFresh
    : isPartial
    ? styles.dotPartial
    : styles.dotDepleted;

  const packageClass =
    item.procurementType === PROCUREMENT_TYPES.PROJECT
      ? styles.packageTagProject
      : item.procurementType === PROCUREMENT_TYPES.MATERIAL_SUPPLY
      ? styles.packageTagMaterial
      : styles.packageTagEvent;

  const packageLabel =
    item.procurementType === PROCUREMENT_TYPES.PROJECT
      ? 'Student Project'
      : item.procurementType === PROCUREMENT_TYPES.MATERIAL_SUPPLY
      ? 'Material & Supply'
      : 'Event & Program';

  const subItems = item.approvedLineItems || [];

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <aside className={styles.drawerPanel} onClick={(e) => e.stopPropagation()}>
        {/* Drawer Header */}
        <header className={styles.drawerHeader}>
          <div className={styles.headerLeft}>
            <div className={styles.tagsRow}>
              <span className={`${styles.packageTag} ${packageClass}`}>
                {packageLabel}
              </span>
              <span className={`${styles.statusBadge} ${badgeStatusClass}`}>
                <span className={`${styles.statusDot} ${dotClass}`} />
                {PPMP_STATUS_CONFIG[item.ppmpStatus]?.label || 'Fresh'}
              </span>
            </div>
            <h2 className={styles.drawerTitle}>{item.eventName}</h2>
            <p className={styles.drawerSubtitle}>
              {item.committee || 'General'} • {item.resolution ? `Resolution: ${item.resolution}` : 'Approved Allocation'}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {canEditFinance && isArchived ? (
              <button
                type="button"
                onClick={handleRestoreFromDrawer}
                style={{
                  background: 'transparent',
                  border: '1px solid #a7f3d0',
                  color: '#059669',
                  borderRadius: '8px',
                  padding: '0.4rem 0.65rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                }}
                title="Restore this archived PPMP item back to active procurement"
              >
                <HiCheckCircle size={15} /> Restore
              </button>
            ) : canEditFinance ? (
              <button
                type="button"
                onClick={handleDeleteFromDrawer}
                style={{
                  background: 'transparent',
                  border: '1px solid #fee2e2',
                  color: '#dc2626',
                  borderRadius: '8px',
                  padding: '0.4rem 0.65rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                }}
                title="Delete or archive this allocation"
              >
                <HiTrash size={15} /> Delete
              </button>
            ) : null}

            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Close Inspector"
            >
              <HiX size={22} />
            </button>
          </div>
        </header>

        {/* Drawer Body */}
        <div className={styles.drawerBody}>
          {/* Draft Notice Alert with Inline Approve Action */}
          {isDraft && (
            <div className={styles.draftAlertBanner}>
              <div style={{ flex: 1 }}>
                <strong>📝 Draft Allocation:</strong> This package is currently in Draft status. Expenses and disbursements cannot be posted against drafts in financial ledgers until approved.
              </div>
              {canEditFinance && (
                <button
                  type="button"
                  className={styles.approveDraftBtn}
                  onClick={() => {
                    setApprovalResolution(item.resolution || `BR-${new Date().getFullYear()}-001`);
                    setApproveError(null);
                    setIsApproveModalOpen(true);
                  }}
                >
                  ✓ Approve Allocation
                </button>
              )}
            </div>
          )}

          {/* Success Toast */}
          {successToast && (
            <div style={{ padding: '0.75rem 1rem', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <HiCheckCircle size={18} /> {successToast}
            </div>
          )}

          {/* Health Summary Card */}
          <section className={styles.healthCard}>
            <div className={styles.healthStatsGrid}>
              <div className={styles.healthStatBlock}>
                <span className={styles.healthStatLabel}>Estimated Plan</span>
                <span className={styles.healthStatValue}>
                  ₱{(item.allocated || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className={styles.healthStatBlock}>
                <span className={styles.healthStatLabel}>Expended</span>
                <span className={styles.healthStatValue}>
                  ₱{(item.spent || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className={styles.healthStatBlock}>
                <span className={styles.healthStatLabel}>Unused Surplus</span>
                <span className={`${styles.healthStatValue} ${isDepleted ? styles.healthStatDepleted : styles.healthStatSurplus}`}>
                  ₱{(item.remaining || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Utilization Meter */}
            <div className={styles.meterWrapper}>
              <div className={styles.meterHeader}>
                <span>Budget Utilization Rate</span>
                <span>{item.utilizationRate || 0}%</span>
              </div>
              <div className={styles.meterTrack}>
                <div
                  className={`${styles.meterFill} ${
                    item.utilizationRate >= 100
                      ? styles.meterFillDanger
                      : item.utilizationRate >= 65
                      ? styles.meterFillWarning
                      : ''
                  }`}
                  style={{ width: `${Math.min(100, item.utilizationRate || 0)}%` }}
                />
              </div>
            </div>

            {/* Price Inflation Overrun Notice */}
            {(item.spent || 0) > (item.allocated || 0) && (
              <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(234, 88, 12, 0.12)', border: '1px solid rgba(234, 88, 12, 0.35)', borderRadius: '8px', fontSize: '0.78rem', color: '#c2410c', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span>📈</span>
                <span><strong>Price Inflation Notice:</strong> Actual expenditures exceed initial planned ceiling by <strong>₱{((item.spent || 0) - (item.allocated || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong> (+{(((item.spent - item.allocated) / (item.allocated || 1)) * 100).toFixed(1)}%). Permitted under market price inflation policy.</span>
              </div>
            )}
          </section>

          {/* Inline Disbursement Form */}
          {activeDisburseTarget !== null && (
            <section className={styles.disbursementCard}>
              <div className={styles.disbursementHeader}>
                <h4 className={styles.disbursementTitle}>
                  <Coins size={16} /> Disburse from {fundDisplayName}
                </h4>
                <button
                  type="button"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}
                  onClick={() => setActiveDisburseTarget(null)}
                >
                  <HiX size={18} />
                </button>
              </div>

              <div style={{ fontSize: '0.78rem', color: '#475569', background: 'rgba(0, 0, 0, 0.03)', padding: '0.5rem', borderRadius: '6px' }}>
                Targeting: <strong>{activeDisburseTarget?.name || item.eventName}</strong> | Available {fundDisplayName} Balance: <strong>{formatPHP(liquidBalanceCentavos, true)}</strong>
              </div>

              {disburseError && (
                <div style={{ padding: '0.65rem', background: '#fee2e2', color: '#991b1b', borderRadius: '8px', fontSize: '0.8rem' }}>
                  {disburseError}
                </div>
              )}

              <form onSubmit={handleSubmitDisbursement} className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Disbursement Amount (₱) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className={styles.formInput}
                    placeholder="0.00"
                    value={disburseForm.amount}
                    onChange={(e) => setDisburseForm({ ...disburseForm, amount: e.target.value })}
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Payee / Supplier / Vendor *</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="e.g. Vending Tech Solutions Ltd / Student Officer"
                    value={disburseForm.payeeOrPayer}
                    onChange={(e) => setDisburseForm({ ...disburseForm, payeeOrPayer: e.target.value })}
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Description &amp; Justification *</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="e.g. Payment for vending hardware installment"
                    value={disburseForm.description}
                    onChange={(e) => setDisburseForm({ ...disburseForm, description: e.target.value })}
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Resolution Reference *</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="e.g. BOR-RES-2026-081 or PPMP-2026-001"
                    value={disburseForm.resolutionRef}
                    onChange={(e) => setDisburseForm({ ...disburseForm, resolutionRef: e.target.value })}
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Receipt / Supporting Doc Link (Optional)</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="https://..."
                    value={disburseForm.receiptUrl}
                    onChange={(e) => setDisburseForm({ ...disburseForm, receiptUrl: e.target.value })}
                  />
                </div>

                <div className={styles.formActions}>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => setActiveDisburseTarget(null)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={styles.confirmDisburseBtn}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Posting...' : `Confirm & Debit ${fundDisplayName}`}
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* Itemized Sub-Line Items List */}
          <section className={styles.sectionBlock}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Layers size={14} /> Itemized Package Components ({subItems.length})
              </h3>
              {canEditFinance && activeDisburseTarget === null && !isArchived && (
                <button
                  type="button"
                  className={styles.disburseLineBtn}
                  onClick={() => handleOpenDisburse(null)}
                  disabled={isDraft || isDepleted || isArchived}
                  title={
                    isDraft
                      ? 'Cannot disburse against draft allocation'
                      : isDepleted
                      ? 'Allocation is fully spent'
                      : 'Disburse General Fund'
                  }
                >
                  <HiLightningBolt size={13} /> {isDraft ? 'Draft (Not Postable)' : isDepleted ? 'Fully Liquidated' : 'Disburse General Fund'}
                </button>
              )}
            </div>

            {subItems.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', background: 'rgba(0, 0, 0, 0.02)', borderRadius: '12px', border: '1px dashed #cbd5e1', fontSize: '0.85rem', color: '#64748b' }}>
                No itemized sub-line items configured for this package.
              </div>
            ) : (
              <div className={styles.subItemsList}>
                {subItems.map((li, idx) => {
                  const liPlanned = li.plannedAmount !== undefined ? li.plannedAmount : fromCentavos(li.plannedCentavos || 0);
                  const liSpent = li.spentAmount !== undefined ? li.spentAmount : fromCentavos(li.spentCentavos || 0);
                  const liRemaining = Math.max(0, liPlanned - liSpent);
                  const liStatus = li.status || (liSpent === 0 ? PPMP_STATUSES.FRESH : (liSpent >= liPlanned ? PPMP_STATUSES.DEPLETED : PPMP_STATUSES.PARTIALLY_USED));

                  const liBadgeClass =
                    liStatus === PPMP_STATUSES.FRESH
                      ? styles.statusFresh
                      : liStatus === PPMP_STATUSES.PARTIALLY_USED
                      ? styles.statusPartial
                      : styles.statusDepleted;

                  const liDotClass =
                    liStatus === PPMP_STATUSES.FRESH
                      ? styles.dotFresh
                      : liStatus === PPMP_STATUSES.PARTIALLY_USED
                      ? styles.dotPartial
                      : styles.dotDepleted;

                  return (
                    <div key={li.id || idx} className={styles.subItemCard}>
                      <div className={styles.subItemCardHeader}>
                        <div>
                          <h4 className={styles.subItemTitle}>{li.name}</h4>
                          <div className={styles.subItemQuantity}>
                            Qty: {li.quantity || 1} • Unit: ₱{(fromCentavos(li.unitCostCentavos || 0) || li.unitCost || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </div>
                        </div>

                        <span className={`${styles.statusBadge} ${liBadgeClass}`}>
                          <span className={`${styles.statusDot} ${liDotClass}`} />
                          {PPMP_STATUS_CONFIG[liStatus]?.shortLabel || 'Fresh'}
                        </span>
                      </div>

                      {/* Amounts Row */}
                      <div className={styles.subItemAmountsRow}>
                        <span>Planned: <strong>₱{liPlanned.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></span>
                        <span>Spent: <strong>₱{liSpent.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></span>
                        {liSpent > liPlanned ? (
                          <span style={{ color: '#ea580c', fontWeight: 700 }} title="Overrun due to real-world price inflation">
                            📈 Overrun: +₱{(liSpent - liPlanned).toLocaleString('en-PH', { minimumFractionDigits: 2 })} (Inflation)
                          </span>
                        ) : (
                          <span>Remaining: <strong style={{ color: liRemaining > 0 ? '#10b981' : '#ef4444' }}>₱{liRemaining.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></span>
                        )}
                      </div>

                      {/* Line Progress */}
                      <div className={styles.meterTrack} style={{ height: '5px' }}>
                        <div
                          className={`${styles.meterFill} ${
                            liStatus === PPMP_STATUSES.DEPLETED
                              ? styles.meterFillDanger
                              : liStatus === PPMP_STATUSES.PARTIALLY_USED
                              ? styles.meterFillWarning
                              : ''
                          }`}
                          style={{ width: `${liPlanned > 0 ? Math.min(100, Math.round((liSpent / liPlanned) * 100)) : 0}%` }}
                        />
                      </div>

                      {/* Action Button */}
                      {canEditFinance && !isArchived && (
                        <div className={styles.subItemActions}>
                          <button
                            type="button"
                            className={styles.disburseLineBtn}
                            onClick={() => handleOpenDisburse(li)}
                            disabled={isDraft || liRemaining <= 0 || isDepleted || isArchived}
                            title={
                              isDraft
                                ? 'Cannot disburse against draft'
                                : liRemaining <= 0
                                ? 'Fully disbursed'
                                : `Disburse from ${isFSG ? 'FSG' : 'BDO'}`
                            }
                          >
                            <HiLightningBolt size={12} />
                            {isDraft ? 'Draft' : liRemaining <= 0 ? 'Fully Disbursed' : `Disburse from ${isFSG ? 'FSG' : 'BDO'}`}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Allocation Disbursements Audit Ledger */}
          <section className={styles.sectionBlock}>
            <h3 className={styles.sectionTitle}>
              <HiDocumentText size={14} /> Allocation Disbursement Ledger ({allocationTransactions.length})
            </h3>

            {allocationTransactions.length === 0 ? (
              <div style={{ padding: '1.25rem', textAlign: 'center', background: 'rgba(0, 0, 0, 0.02)', borderRadius: '10px', fontSize: '0.8rem', color: '#64748b' }}>
                No disbursements posted against this allocation yet. 🟢 Budget is completely fresh in {fundDisplayName}.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle, #e2e8f0)', borderRadius: '10px' }}>
                <table className={styles.txTable}>
                  <thead>
                    <tr>
                      <th>Ref Number</th>
                      <th>Payee / Description</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocationTransactions.map((tx) => (
                      <tr key={tx.id}>
                        <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{tx.refNumber}</td>
                        <td>
                          <div>{tx.payeeOrPayer || 'Official Vendor'}</div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{tx.description}</div>
                        </td>
                        <td style={{ fontWeight: 800, color: '#dc2626' }}>
                          -{formatPHP(tx.amountCentavos, true)}
                        </td>
                        <td>
                          <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: '#059669' }}>
                            {tx.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Approval Modal */}
        {isApproveModalOpen && (
          <div className={styles.approvalModalBackdrop} onClick={() => setIsApproveModalOpen(false)}>
            <div className={styles.approvalModalBox} onClick={(e) => e.stopPropagation()}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', fontWeight: 800, color: '#1e293b' }}>
                ✓ Approve Budget Allocation
              </h4>
              <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '1rem', lineHeight: 1.4 }}>
                Promoting <strong>{item.eventName}</strong> from Draft to Approved. This authorizes official expense and disbursement postings in the financial ledger.
              </p>

              {approveError && (
                <div style={{ padding: '0.5rem 0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                  {approveError}
                </div>
              )}

              <form onSubmit={handleApproveDraft}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                    Official Board Resolution Reference *
                  </label>
                  <input
                    type="text"
                    required
                    className={styles.formInput}
                    placeholder="e.g. BOR-RES-2026-015"
                    value={approvalResolution}
                    onChange={(e) => setApprovalResolution(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button
                    type="button"
                    style={{ padding: '0.5rem 1rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => setIsApproveModalOpen(false)}
                    disabled={isApproving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{ padding: '0.5rem 1rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
                    disabled={isApproving}
                  >
                    {isApproving ? 'Approving...' : 'Confirm Approval'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};

export default PPMPInspectorDrawer;
