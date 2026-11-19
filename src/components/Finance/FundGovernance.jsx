import React, { useState, useEffect, useMemo } from 'react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import usePermissions from '../../hooks/usePermissions.js';
import {
  TOP_LEVEL_FUNDS,
  TOP_LEVEL_FUND_LABELS,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  EXPENSE_PURPOSES,
  formatPHP,
  fromCentavos,
  toCentavos,
  PPMP_STATUSES,
} from '../../utils/financeConstants.js';
import {
  RECEIPT_LABELS,
  computeLedgerNetByAccount,
  computeDisbursedByAccount,
  computeEffectiveFiscalCeilingCentavos,
  computeAuthoritativeFundBalanceCentavos,
  filterValidLedgerTransactions,
  inferTransactionStorageLocation,
} from '../../utils/financeLedgerReconciliation.js';
import styles from './FundGovernance.module.css';
import BankCalibrationModal from './BankCalibrationModal.jsx';
import { ReversalModal, RestoreAllocationModal } from './FinanceLedgerModal.jsx';
import {
  HiPlus,
  HiRefresh,
  HiShieldCheck,
  HiExclamationCircle,
  HiCash,
  HiDocumentText,
  HiReceiptTax,
  HiTrash,
  HiX,
  HiPencil,
} from 'react-icons/hi';

const FundGovernance = () => {
  const {
    fundAccounts,
    budgetAllocations,
    transactions,
    ledgerBalancesByAccount,
    disbursedByAccount,
    recordTransaction,
    reverseTransaction,
    refreshFinanceData,
    updateFiscalBudget,
    updateFundBalance,
    reconcileFundBalance,
    uploadReceiptToDrive,
    loading,
    budgets,
    archivedBudgets = [],
    restoreBudget,
    statistics,
  } = useFinance();
  const { currentUser, userName, userRole } = useAuth();
  const { canEditFinance, canPostFinanceLedger, canReverseFinanceLedger } = usePermissions();

  useEffect(() => {
    refreshFinanceData();
  }, [refreshFinanceData]);

  const visibleTransactions = useMemo(
    () => filterValidLedgerTransactions(transactions, fundAccounts),
    [transactions, fundAccounts]
  );

  const computedLedgerByAccount = useMemo(
    () => ledgerBalancesByAccount || computeLedgerNetByAccount(visibleTransactions),
    [ledgerBalancesByAccount, visibleTransactions]
  );

  const computedDisbursedByAccount = useMemo(
    () => disbursedByAccount || computeDisbursedByAccount(visibleTransactions),
    [disbursedByAccount, visibleTransactions]
  );

  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [receiptUploadProgress, setReceiptUploadProgress] = useState(0);
  const [receiptUploadNotice, setReceiptUploadNotice] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReversalModalOpen, setIsReversalModalOpen] = useState(false);
  const [selectedTxForReversal, setSelectedTxForReversal] = useState(null);
  const [isSubmittingReversal, setIsSubmittingReversal] = useState(false);
  const [reversalModalError, setReversalModalError] = useState(null);
  const [selectedBudgetForRestore, setSelectedBudgetForRestore] = useState(null);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [isSubmittingRestore, setIsSubmittingRestore] = useState(false);
  const [reversalReason, setReversalReason] = useState('');
  const [isCleaning, setIsCleaning] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Unified Fiscal Budget Modal State (Serves as primary balance & PPMP ceiling)
  const [isFiscalBudgetModalOpen, setIsFiscalBudgetModalOpen] = useState(false);
  const [fiscalBudgetForm, setFiscalBudgetForm] = useState({
    budgetAmount: '',
    resolutionRef: '',
    bankAccountReference: 'BDO Institutional Account ****2005',
    note: '',
  });
  const [fiscalBudgetError, setFiscalBudgetError] = useState(null);
  const [isSavingFiscalBudget, setIsSavingFiscalBudget] = useState(false);

  // Fund Balance Calibration Modal State for Non-Fiscal Funds (FSG, IGF, IGP)
  const [isFundBalanceModalOpen, setIsFundBalanceModalOpen] = useState(false);
  const [selectedFundForBalance, setSelectedFundForBalance] = useState(null);
  const [fundBalanceInput, setFundBalanceInput] = useState('');
  const [fundBalanceReason, setFundBalanceReason] = useState('');
  const [fundBalanceError, setFundBalanceError] = useState(null);
  const [isSavingFundBalance, setIsSavingFundBalance] = useState(false);
  const [allocFundFilter, setAllocFundFilter] = useState('All'); // 'All' | 'fund_fiscal_year_budget' | 'fund_fsg_remittance'

  // Form State for new Transaction
  const [txForm, setTxForm] = useState({
    fundAccountId: 'fund_fiscal_year_budget',
    transactionType: TRANSACTION_TYPES.EXPENSE,
    expensePurpose: EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE,
    amount: '',
    payeeOrPayer: '',
    description: '',
    budgetAllocationId: '',
    resolutionRef: '',
    custodianUserId: currentUser?.uid || '',
    custodianName: userName || '',
    receiptUrl: '',
    receiptDriveLink: '',
    receiptFileId: '',
    receiptOrNumber: '',
    receiptDetails: '',
    receiptLabel: RECEIPT_LABELS[0],
    storageLocation: '',
  });

  const activeFund = fundAccounts.find((a) => a.id === txForm.fundAccountId);

  // Handlers for Unified Fiscal Budget (edits the initial term ceiling directly)
  const handleOpenFiscalBudgetModal = (fund) => {
    const ceilingCentavos =
      fund.appropriatedCeilingCentavos !== undefined && fund.appropriatedCeilingCentavos > 0
        ? fund.appropriatedCeilingCentavos
        : (fund.balanceCentavos || 0);
    const amt = ceilingCentavos ? (ceilingCentavos / 100).toString() : '';
    setFiscalBudgetForm({
      budgetAmount: amt,
      resolutionRef: fund.appropriationResolutionRef || '',
      bankAccountReference: fund.bankAccountReference || 'BDO Institutional Account ****2005',
      note: fund.lastBudgetUpdateNote || '',
    });
    setFiscalBudgetError(null);
    setIsFiscalBudgetModalOpen(true);
  };

  const handleSaveFiscalBudget = async (e) => {
    e.preventDefault();
    setFiscalBudgetError(null);
    const amountNum = parseFloat(fiscalBudgetForm.budgetAmount);
    if (isNaN(amountNum) || amountNum < 0) {
      setFiscalBudgetError('Please enter a valid fiscal budget amount (₱0.00 or greater).');
      return;
    }
    try {
      setIsSavingFiscalBudget(true);
      await updateFiscalBudget({
        budgetAmount: amountNum,
        resolutionRef: fiscalBudgetForm.resolutionRef,
        bankAccountReference: fiscalBudgetForm.bankAccountReference,
        note: fiscalBudgetForm.note,
      });
      setIsFiscalBudgetModalOpen(false);
    } catch (err) {
      setFiscalBudgetError(err.message || 'Error updating fiscal budget.');
    } finally {
      setIsSavingFiscalBudget(false);
    }
  };

  // Handlers for Non-Fiscal Fund Balance (FSG)
  const handleOpenFundBalanceModal = (fund) => {
    setSelectedFundForBalance(fund);
    const baseCentavos =
      fund.appropriatedCeilingCentavos !== undefined && fund.appropriatedCeilingCentavos > 0
        ? fund.appropriatedCeilingCentavos
        : (fund.balanceCentavos || 0);
    setFundBalanceInput(baseCentavos ? (baseCentavos / 100).toString() : '0');
    setFundBalanceReason('');
    setFundBalanceError(null);
    setIsFundBalanceModalOpen(true);
  };

  const handleSaveFundBalance = async (e) => {
    e.preventDefault();
    setFundBalanceError(null);
    const amountNum = parseFloat(fundBalanceInput);
    if (isNaN(amountNum) || amountNum < 0) {
      setFundBalanceError('Please enter a valid balance amount (₱0.00 or greater).');
      return;
    }
    try {
      setIsSavingFundBalance(true);
      await updateFundBalance(
        selectedFundForBalance.id,
        amountNum,
        fundBalanceReason.trim() || 'Fund Balance Calibration'
      );
      setIsFundBalanceModalOpen(false);
    } catch (err) {
      setFundBalanceError(err.message || 'Error updating fund balance.');
    } finally {
      setIsSavingFundBalance(false);
    }
  };

  const handleOpenTxForAllocation = (budget) => {
    const fundId =
      budget.fundAccountId || (budget.isFSG ? 'fund_fsg_remittance' : 'fund_fiscal_year_budget');
    const matchedAccount = fundAccounts.find((a) => a.id === fundId);

    setTxForm({
      fundAccountId: fundId,
      transactionType: TRANSACTION_TYPES.EXPENSE,
      expensePurpose:
        matchedAccount?.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE
          ? EXPENSE_PURPOSES.RESOLUTION_DISBURSEMENT
          : EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE,
      amount: '',
      payeeOrPayer: '',
      description: `Disbursement for ${budget.eventName}`,
      budgetAllocationId: budget.id,
      resolutionRef: budget.resolution || budget.raw?.resolutionRef || '',
      custodianUserId: currentUser?.uid || '',
      custodianName: userName || '',
      receiptUrl: '',
    });
    setSubmitError(null);
    setIsModalOpen(true);
  };

  // Reversal handler
  const handleOpenReversal = (tx) => {
    setSelectedTxForReversal(tx);
    setReversalReason('');
    setReversalModalError(null);
    setIsReversalModalOpen(true);
  };

  const handleConfirmReversal = async (reasonText) => {
    const finalReason = typeof reasonText === 'string' ? reasonText : reversalReason;
    if (!finalReason || !finalReason.trim()) {
      setReversalModalError('A valid reason is required to record a reversal.');
      return;
    }
    try {
      setIsSubmittingReversal(true);
      await reverseTransaction(selectedTxForReversal.id, finalReason.trim());
      setIsReversalModalOpen(false);
      setSelectedTxForReversal(null);
    } catch (err) {
      setReversalModalError(err.message || 'Failed to reverse transaction.');
    } finally {
      setIsSubmittingReversal(false);
    }
  };

  // Submit transaction
  const handleSubmitTx = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    const amountNum = parseFloat(txForm.amount);
    if (!amountNum || amountNum <= 0) {
      setSubmitError('Please enter a valid amount.');
      return;
    }

    try {
      await recordTransaction({
        ...txForm,
        amount: amountNum,
      });
      setIsModalOpen(false);
      // Reset form
      setTxForm({
        fundAccountId: 'fund_fiscal_year_budget',
        transactionType: TRANSACTION_TYPES.EXPENSE,
        expensePurpose: EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE,
        amount: '',
        payeeOrPayer: '',
        description: '',
        budgetAllocationId: '',
        resolutionRef: '',
        custodianUserId: currentUser?.uid || '',
        custodianName: userName || '',
        receiptUrl: '',
        receiptDriveLink: '',
        receiptFileId: '',
        receiptOrNumber: '',
        receiptDetails: '',
        receiptLabel: RECEIPT_LABELS[0],
        storageLocation: '',
      });
      setReceiptUploadNotice('');
      setReceiptUploadProgress(0);
    } catch (err) {
      setSubmitError(err.message);
    }
  };

  // Allocation counts & filtered list
  const isViewingArchived = allocFundFilter === 'archived';
  const filteredBudgets = isViewingArchived
    ? (archivedBudgets || [])
    : (budgets || []).filter((b) => {
        if (allocFundFilter === 'fund_fiscal_year_budget') {
          return !b.isFSG && b.fundAccountId !== 'fund_fsg_remittance';
        }
        if (allocFundFilter === 'fund_fsg_remittance') {
          return b.isFSG || b.fundAccountId === 'fund_fsg_remittance';
        }
        return true;
      });

  const fiscalBudgetsCount = (budgets || []).filter(
    (b) => !b.isFSG && b.fundAccountId !== 'fund_fsg_remittance'
  ).length;
  const fsgBudgetsCount = (budgets || []).filter(
    (b) => b.isFSG || b.fundAccountId === 'fund_fsg_remittance'
  ).length;

  // Real-time KPI summaries calculated from budgets with fallback to statistics
  const totalAllocatedSum = (budgets || []).reduce((acc, b) => acc + (b.allocated || 0), 0);
  const totalSpentSum = (budgets || []).reduce((acc, b) => acc + (b.spent || 0), 0);
  const fiscalAllocatedSum = (budgets || [])
    .filter((b) => !b.isFSG && b.fundAccountId !== 'fund_fsg_remittance')
    .reduce((acc, b) => acc + (b.allocated || 0), 0);
  const fsgAllocatedSum = (budgets || [])
    .filter((b) => b.isFSG || b.fundAccountId === 'fund_fsg_remittance')
    .reduce((acc, b) => acc + (b.allocated || 0), 0);
  const remainingSum = Math.max(0, totalAllocatedSum - totalSpentSum);

  const displayTotalAllocated = (statistics && statistics.totalAllocated > 0)
    ? statistics.totalAllocated
    : totalAllocatedSum;
  const displayFiscalAllocated = (statistics && statistics.fiscalAllocated > 0)
    ? statistics.fiscalAllocated
    : fiscalAllocatedSum;
  const displayFsgAllocated = (statistics && statistics.fsgAllocated > 0)
    ? statistics.fsgAllocated
    : fsgAllocatedSum;
  const displayTotalSpent = (statistics && statistics.totalSpent > 0)
    ? statistics.totalSpent
    : totalSpentSum;
  const displayRemaining = (statistics && statistics.totalAllocated > 0)
    ? Math.max(0, (statistics.totalAllocated || 0) - (statistics.totalSpent || 0))
    : remainingSum;

  return (
    <div>
      {/* Action Toolbar */}
      <div className={styles.actionRow}>
        {canPostFinanceLedger && (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => setIsModalOpen(true)}
          >
            <HiReceiptTax size={16} /> Record Transaction
          </button>
        )}

        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => refreshFinanceData()}
          disabled={loading}
        >
          <HiRefresh size={16} /> Refresh Telemetry
        </button>
      </div>

      {/* 4 Official Top-Level Fund Category Cards with Inline Allocations & Surplus */}
      <div className={styles.fundCardsGrid}>
        {fundAccounts.map((fund) => {
          let badgeClass = styles.badgeFiscal;
          let isFiscal = fund.topLevelCategory === TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET;
          let isFSG = fund.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE;
          let isIGF = fund.topLevelCategory === TOP_LEVEL_FUNDS.IGF;
          let isIGP = fund.topLevelCategory === TOP_LEVEL_FUNDS.IGP;

          if (isFSG) badgeClass = styles.badgeFSG;
          else if (isIGF) badgeClass = styles.badgeIGF;
          else if (isIGP) badgeClass = styles.badgeIGP;

          const balanceCentavos = computeAuthoritativeFundBalanceCentavos(fund, visibleTransactions);
          const ceilingCentavos =
            isFiscal || isFSG
              ? computeEffectiveFiscalCeilingCentavos(fund, visibleTransactions)
              : balanceCentavos;
          const disbursedCentavos = computedDisbursedByAccount.get(fund.id) || 0;
          const storageLabel =
            fund.bankAccountReference ||
            (isFiscal
              ? 'BDO Institutional Account ****2005'
              : isFSG
              ? 'BDO Institutional Account ****2005 (Sub-Treasury)'
              : isIGF
              ? 'Treasury Safe / Cash Box'
              : 'Custodial Lockbox');
          const allocatedCentavos = isFiscal
            ? toCentavos(displayFiscalAllocated)
            : isFSG
            ? toCentavos(displayFsgAllocated)
            : 0;
          const surplusCentavos = Math.max(0, ceilingCentavos - allocatedCentavos);

          return (
            <div key={fund.id} className={styles.fundCard}>
              <div>
                <div className={styles.cardHeader}>
                  <div className={`${styles.fundIconBadge} ${badgeClass}`}>₱</div>
                  <span className={styles.fundCategoryTag}>
                    {fund.holdingType || 'Fund Account'}
                  </span>
                </div>
                <h3 className={styles.fundTitle}>{fund.displayName}</h3>
                <p className={styles.fundSub}>{fund.subcategory}</p>

                <div className={styles.fundBalanceLabel}>
                  {isFiscal ? 'Fiscal Budget' : 'Fund Balance'}
                </div>
                <div className={styles.fundBalance}>
                  {formatPHP(balanceCentavos, true)}
                </div>

                {/* Sub-Metrics for Fiscal Year Budget (2026-2027 Indicator & PPMP Earmarks) */}
                {isFiscal && (() => {
                  const unallocatedReserveCentavos = Math.max(0, ceilingCentavos - allocatedCentavos);

                  return (
                    <div className={styles.fundCardSubStats}>
                      <div className={styles.fundStatRow}>
                        <span className={styles.fundStatLabel}>Academic Term:</span>
                        <span className={styles.fundStatValue} style={{ fontWeight: 800, color: '#7a121d' }}>
                          2026–2027 Fiscal Budget
                        </span>
                      </div>
                      <div className={styles.fundStatRow}>
                        <span className={styles.fundStatLabel}>Stored In:</span>
                        <span className={styles.fundStatValue}>{storageLabel}</span>
                      </div>
                      <div className={styles.fundStatRow}>
                        <span className={styles.fundStatLabel}>Initial Fiscal Ceiling:</span>
                        <span className={styles.fundStatValue}>
                          {formatPHP(ceilingCentavos, true)}
                        </span>
                      </div>
                      <div className={styles.fundStatRow}>
                        <span className={styles.fundStatLabel}>PPMP Programmed:</span>
                        <span className={styles.fundStatValue}>
                          {formatPHP(allocatedCentavos, true)}
                        </span>
                      </div>
                      <div className={styles.fundStatRow}>
                        <span className={styles.fundStatLabel}>Released to Ledger:</span>
                        <span className={styles.fundStatValue} style={{ color: disbursedCentavos > 0 ? '#ef4444' : undefined }}>
                          {disbursedCentavos > 0 ? `-${formatPHP(disbursedCentavos, true)}` : formatPHP(0, true)}
                        </span>
                      </div>
                      <div className={styles.fundStatRow}>
                        <span className={styles.fundStatLabel}>Unprogrammed Reserve:</span>
                        <span className={`${styles.fundStatValue} ${styles.fundStatSurplus}`}>
                          {formatPHP(unallocatedReserveCentavos, true)}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Sub-Metrics for FSG Remittance */}
                {isFSG && (
                  <div className={styles.fundCardSubStats}>
                    <div className={styles.fundStatRow}>
                      <span className={styles.fundStatLabel}>Stored In:</span>
                      <span className={styles.fundStatValue}>{storageLabel}</span>
                    </div>
                    <div className={styles.fundStatRow}>
                      <span className={styles.fundStatLabel}>Initial FSG Balance:</span>
                      <span className={styles.fundStatValue}>
                        {formatPHP(ceilingCentavos, true)}
                      </span>
                    </div>
                    <div className={styles.fundStatRow}>
                      <span className={styles.fundStatLabel}>FSG Sub-Allocated:</span>
                      <span className={styles.fundStatValue}>
                        {formatPHP(allocatedCentavos, true)}
                      </span>
                    </div>
                    <div className={styles.fundStatRow}>
                      <span className={styles.fundStatLabel}>Released to Ledger:</span>
                      <span className={styles.fundStatValue} style={{ color: disbursedCentavos > 0 ? '#ef4444' : undefined }}>
                        {disbursedCentavos > 0 ? `-${formatPHP(disbursedCentavos, true)}` : formatPHP(0, true)}
                      </span>
                    </div>
                    <div className={styles.fundStatRow}>
                      <span className={styles.fundStatLabel}>Available Reserve:</span>
                      <span className={`${styles.fundStatValue} ${styles.fundStatSurplus}`}>
                        {formatPHP(surplusCentavos, true)}
                      </span>
                    </div>
                  </div>
                )}

                {/* IGF / IGP Operational Notes */}
                {(isIGF || isIGP) && (
                  <div className={styles.fundCardSubStats}>
                    <div className={styles.fundStatRow}>
                      <span className={styles.fundStatLabel}>Stored In:</span>
                      <span className={styles.fundStatValue}>{storageLabel}</span>
                    </div>
                    <div className={styles.fundStatRow}>
                      <span className={styles.fundStatLabel}>Disbursement Mode:</span>
                      <span className={styles.fundStatValue}>
                        {isIGF ? 'Flexible Prep & Batch' : 'Consumables & Projects'}
                      </span>
                    </div>
                    <div className={styles.fundStatRow}>
                      <span className={styles.fundStatLabel}>Revenue Inflow:</span>
                      <span className={styles.fundStatValue}>
                        {isIGF ? 'Merch Pre-Orders' : 'Project Sales'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Fund Action & Meta Footer */}
              <div>
                {canEditFinance && isFiscal && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '0.85rem' }}>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem', justifyContent: 'center', fontWeight: 600 }}
                      onClick={() => handleOpenFiscalBudgetModal(fund)}
                    >
                      <HiPencil size={14} /> Edit Fiscal Budget
                    </button>
                  </div>
                )}

                {canEditFinance && isFSG && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '0.85rem' }}>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      style={{ padding: '0.45rem 0.75rem', fontSize: '0.78rem', justifyContent: 'center' }}
                      onClick={() => handleOpenFundBalanceModal(fund)}
                    >
                      <HiPencil size={13} /> Edit Fund Balance
                    </button>
                  </div>
                )}

                {canPostFinanceLedger && (isIGF || isIGP) && (
                  <button
                    type="button"
                    className={styles.quickTxBtn}
                    onClick={() => {
                      setSubmitError(null);
                      setReceiptUploadNotice('');
                      setReceiptUploadProgress(0);
                      setTxForm((prev) => ({
                        ...prev,
                        fundAccountId: fund.id,
                        transactionType: TRANSACTION_TYPES.EXPENSE,
                        expensePurpose: EXPENSE_PURPOSES.EVENT_PREPARATION_CONSUMABLES,
                        storageLocation: storageLabel,
                        budgetAllocationId: '',
                      }));
                      setIsModalOpen(true);
                    }}
                  >
                    <HiReceiptTax size={14} /> Record {isIGF ? 'IGF' : 'IGP'} Flow
                  </button>
                )}

                <div className={styles.fundMeta}>
                  <span>{storageLabel}</span>
                  <span>FY {fund.fiscalYear}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Authorized Budget Allocations (Merged Feature Section) */}
      <div className={styles.tableCard} style={{ marginBottom: '2.5rem' }}>
        <div className={styles.sectionHeaderRow}>
          <div>
            <div className={styles.sectionSuperTag}>APPROPRIATIONS GOVERNANCE</div>
            <h2 className={styles.tableTitle}>Authorized Budget Allocations</h2>
            <p className={styles.sectionDescription}>
              Approved legislative appropriations drawn from Fiscal Year Budget &amp; FSG Remittance that govern event disbursements.
            </p>
          </div>

          <div className={styles.headerRightActions}>
            <div className={styles.filterPillsGroup}>
              <button
                type="button"
                className={`${styles.filterPill} ${
                  allocFundFilter === 'All' ? styles.filterPillActive : ''
                }`}
                onClick={() => setAllocFundFilter('All')}
              >
                All ({budgets.length})
              </button>
              <button
                type="button"
                className={`${styles.filterPill} ${
                  allocFundFilter === 'fund_fiscal_year_budget' ? styles.filterPillActive : ''
                }`}
                onClick={() => setAllocFundFilter('fund_fiscal_year_budget')}
              >
                🏛️ Fiscal ({fiscalBudgetsCount})
              </button>
              <button
                type="button"
                className={`${styles.filterPill} ${
                  allocFundFilter === 'fund_fsg_remittance' ? styles.filterPillActive : ''
                }`}
                onClick={() => setAllocFundFilter('fund_fsg_remittance')}
              >
                🤝 FSG ({fsgBudgetsCount})
              </button>
              <button
                type="button"
                className={`${styles.filterPill} ${
                  allocFundFilter === 'archived' ? styles.filterPillActive : ''
                }`}
                onClick={() => setAllocFundFilter('archived')}
              >
                📁 Archived ({archivedBudgets.length})
              </button>
            </div>
          </div>
        </div>

        {/* KPI Mini-Row */}
        <div className={styles.allocSummaryBar}>
          <div className={styles.allocKpiCard}>
            <span className={styles.allocKpiLabel}>Total Approved</span>
            <span className={styles.allocKpiValue}>
              {formatPHP(toCentavos(displayTotalAllocated), true)}
            </span>
          </div>
          <div className={styles.allocKpiCard}>
            <span className={styles.allocKpiLabel}>Fiscal Budget Allotted</span>
            <span className={styles.allocKpiValueMaroon}>
              {formatPHP(toCentavos(displayFiscalAllocated), true)}
            </span>
          </div>
          <div className={styles.allocKpiCard}>
            <span className={styles.allocKpiLabel}>FSG Remittance Allotted</span>
            <span className={styles.allocKpiValueGold}>
              {formatPHP(toCentavos(displayFsgAllocated), true)}
            </span>
          </div>
          <div className={styles.allocKpiCard}>
            <span className={styles.allocKpiLabel}>Total Disbursed</span>
            <span className={styles.allocKpiValueSpent}>
              {formatPHP(toCentavos(displayTotalSpent), true)}
            </span>
          </div>
          <div className={styles.allocKpiCard}>
            <span className={styles.allocKpiLabel}>Remaining Available</span>
            <span className={styles.allocKpiValueRemaining}>
              {formatPHP(toCentavos(displayRemaining), true)}
            </span>
          </div>
        </div>

        {/* Allocations Table */}
        {filteredBudgets.length === 0 ? (
          <div className={styles.emptyAllocationsBox}>
            <p className={styles.emptyAllocText}>
              {allocFundFilter === 'archived'
                ? 'No archived budget allocations.'
                : allocFundFilter === 'All'
                ? 'No budget allocations synchronized yet. Program allocations inside the PPMP Procurement Matrix.'
                : `No budget allocations found under ${
                    allocFundFilter === 'fund_fsg_remittance' ? 'FSG Remittance' : 'Fiscal Year Budget'
                  }.`}
            </p>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Allocations are programmed and managed inside the PPMP Procurement Matrix tab.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.ledgerTable}>
              <thead>
                <tr>
                  <th>Allocation / Activity</th>
                  <th>Fund Source</th>
                  <th>Approved Amount</th>
                  <th>Disbursed</th>
                  <th>Remaining</th>
                  <th>Status</th>
                  {(canPostFinanceLedger || canEditFinance) && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredBudgets.map((b) => {
                  const isFSG = b.fundAccountId === 'fund_fsg_remittance' || b.isFSG;
                  const isDraft = b.status === 'draft';
                  const isFullySpent = b.remaining <= 0;
                  const canPostExpense = !isDraft && !isFullySpent && canPostFinanceLedger;

                  return (
                    <tr key={b.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: '#ffffff' }}>
                          {b.eventName}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: '0.4rem',
                            marginTop: '0.2rem',
                            alignItems: 'center',
                          }}
                        >
                          <span className={styles.categoryPill}>{b.category}</span>
                          {b.resolution && (
                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                              Res: {b.resolution}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={isFSG ? styles.badgeFSGText : styles.badgeFiscalText}>
                          {isFSG ? '🤝 FSG Remittance' : '🏛️ Fiscal Budget'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {formatPHP(toCentavos(b.allocated), true)}
                      </td>
                      <td style={{ color: '#dc2626' }}>
                        {formatPHP(toCentavos(b.spent), true)}
                      </td>
                      <td
                        style={{
                          fontWeight: 600,
                          color: b.remaining < 0 ? '#dc2626' : '#16a34a',
                        }}
                      >
                        {formatPHP(toCentavos(b.remaining), true)}
                      </td>
                      <td>
                        {b.isArchived ? (
                          <span className={styles.statusReversed} title="Archived allocation">
                            📁 Archived
                          </span>
                        ) : isDraft ? (
                          <span className={styles.statusDraftBadge} title="Draft allocation cannot be posted to financial ledger until approved">
                            📝 Draft
                          </span>
                        ) : (
                          <span
                            className={`${styles.statusPill} ${
                              b.ppmpStatus === PPMP_STATUSES.FRESH
                                ? styles.statusFreshPill
                                : b.ppmpStatus === PPMP_STATUSES.DEPLETED
                                ? styles.statusReversed
                                : styles.statusPosted
                            }`}
                          >
                            {b.ppmpStatus === PPMP_STATUSES.FRESH
                              ? 'Planned'
                              : b.ppmpStatus === PPMP_STATUSES.DEPLETED
                              ? 'Fully Spent'
                              : 'Partially Spent'}
                          </span>
                        )}
                      </td>
                      {(canPostFinanceLedger || canEditFinance) && (
                        <td>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'nowrap', alignItems: 'center' }}>
                            {b.isArchived ? (
                              <button
                                type="button"
                                className={styles.postExpenseBtn}
                                style={{ background: '#3b82f6', borderColor: '#2563eb' }}
                                title="Restore this archived allocation back to active PPMP matrix"
                                onClick={() => {
                                  setSelectedBudgetForRestore(b);
                                  setIsRestoreModalOpen(true);
                                }}
                              >
                                Restore
                              </button>
                            ) : canPostFinanceLedger ? (
                              <button
                                type="button"
                                className={canPostExpense ? styles.postExpenseBtn : styles.postExpenseBtnDisabled}
                                title={
                                  isDraft
                                    ? 'Cannot post expense: Allocation is currently in Draft status.'
                                    : isFullySpent
                                    ? 'Cannot post expense: Budget is fully utilized or spent.'
                                    : 'Post Expense against this Allocation'
                                }
                                onClick={() => canPostExpense && handleOpenTxForAllocation(b)}
                                disabled={!canPostExpense}
                              >
                                {isFullySpent ? 'Fully Spent' : isDraft ? 'Draft' : 'Post Expense'}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Append-Only Transaction Ledger */}
      <div className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <h2 className={styles.tableTitle}>Append-Only Financial Ledger</h2>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            {visibleTransactions.length} immutable entries recorded
          </span>
        </div>

        {visibleTransactions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
            No transactions posted yet. Post an authorized expense or IGF/IGP collection to build the ledger.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.ledgerTable}>
              <thead>
                <tr>
                  <th>Ref #</th>
                  <th>Date</th>
                  <th>Fund Source</th>
                  <th>Stored In</th>
                  <th>Type &amp; Purpose</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Status</th>
                  {(canReverseFinanceLedger || canEditFinance) && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {visibleTransactions.map((tx) => {
                  const isOutflow =
                    tx.transactionType === TRANSACTION_TYPES.EXPENSE ||
                    tx.transactionType === TRANSACTION_TYPES.PAYMENT ||
                    tx.transactionType === TRANSACTION_TYPES.REFUND;
                  const matchedFundAcc = fundAccounts.find((a) => a.id === tx.fundAccountId);
                  const txStorageLocation = inferTransactionStorageLocation(tx, matchedFundAcc);

                  return (
                    <tr key={tx.id}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {tx.refNumber || tx.id.slice(0, 8)}
                      </td>
                      <td>
                        {tx.createdAt?.toDate
                          ? tx.createdAt.toDate().toLocaleDateString()
                          : new Date().toLocaleDateString()}
                      </td>
                      <td>
                        <span style={{ fontWeight: 500 }}>
                          {TOP_LEVEL_FUND_LABELS[tx.fundCategory] || tx.fundCategory}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                          {txStorageLocation}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{tx.expensePurpose}</div>
                        <div
                          style={{
                            fontSize: '0.75rem',
                            color: '#64748b',
                            textTransform: 'capitalize',
                          }}
                        >
                          {tx.transactionType}
                        </div>
                      </td>
                      <td>
                        <div>{tx.description}</div>
                        {tx.resolutionRef && (
                          <div style={{ fontSize: '0.75rem', color: '#2563eb' }}>
                            Res: {tx.resolutionRef}
                          </div>
                        )}
                        {(tx.receiptLabel || tx.receiptOrNumber || tx.receiptDetails || tx.receiptDriveLink || tx.receiptUrl) && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.25rem', fontSize: '0.74rem' }}>
                            {tx.receiptLabel && (
                              <span style={{ padding: '0.1rem 0.45rem', borderRadius: '999px', background: 'rgba(212, 175, 55, 0.16)', color: '#fbbf24' }}>
                                🏷️ {tx.receiptLabel}
                              </span>
                            )}
                            {tx.receiptOrNumber && (
                              <span style={{ color: '#cbd5e1' }}>
                                OR #: {tx.receiptOrNumber}
                              </span>
                            )}
                            {tx.receiptDetails && (
                              <span style={{ color: '#94a3b8' }}>
                                • {tx.receiptDetails}
                              </span>
                            )}
                            {(tx.receiptDriveLink || tx.receiptUrl) && (
                              <a
                                href={tx.receiptDriveLink || tx.receiptUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#38bdf8', textDecoration: 'underline', fontWeight: 600 }}
                              >
                                📎 View Receipt (Drive)
                              </a>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={isOutflow ? styles.amountOut : styles.amountIn}>
                          {isOutflow ? '-' : '+'}
                          {formatPHP(tx.amountCentavos || 0, true)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`${styles.statusPill} ${
                            tx.status === TRANSACTION_STATUSES.POSTED
                              ? styles.statusPosted
                              : tx.status === TRANSACTION_STATUSES.REVERSED
                              ? styles.statusReversed
                              : styles.statusPending
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>
                      {canReverseFinanceLedger && (
                        <td>
                          {tx.status === TRANSACTION_STATUSES.POSTED &&
                            (tx.transactionType || '').toLowerCase() !== TRANSACTION_TYPES.REVERSAL && (
                            <button
                              type="button"
                              className={styles.secondaryBtn}
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                              onClick={() => handleOpenReversal(tx)}
                            >
                              Reverse
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Transaction Modal */}
      {isModalOpen && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalContent}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>
                Record Financial Transaction
              </h3>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                onClick={() => setIsModalOpen(false)}
              >
                <HiX size={20} />
              </button>
            </div>

            {submitError && (
              <div className={styles.validationWarning}>
                <HiExclamationCircle size={18} style={{ marginRight: '0.5rem' }} />
                {submitError}
              </div>
            )}

            <form onSubmit={handleSubmitTx}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Fund Source</label>
                <select
                  className={styles.formSelect}
                  value={txForm.fundAccountId}
                  onChange={(e) => {
                    const chosenAcc = fundAccounts.find((a) => a.id === e.target.value);
                    const isFsgAcc = chosenAcc?.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE;
                    const isFiscalAcc = chosenAcc?.topLevelCategory === TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET;

                    setTxForm({
                      ...txForm,
                      fundAccountId: e.target.value,
                      budgetAllocationId: '',
                      storageLocation: chosenAcc?.bankAccountReference || '',
                      transactionType:
                        isFiscalAcc || isFsgAcc
                          ? TRANSACTION_TYPES.EXPENSE
                          : txForm.transactionType,
                      expensePurpose: isFiscalAcc
                        ? EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE
                        : isFsgAcc
                        ? EXPENSE_PURPOSES.RESOLUTION_DISBURSEMENT
                        : EXPENSE_PURPOSES.EVENT_PREPARATION_CONSUMABLES,
                    });
                  }}
                >
                  {fundAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.displayName} ({formatPHP(acc.balanceCentavos || 0, true)})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Transaction Type</label>
                  <select
                    className={styles.formSelect}
                    value={txForm.transactionType}
                    onChange={(e) =>
                      setTxForm({ ...txForm, transactionType: e.target.value })
                    }
                  >
                    <option value={TRANSACTION_TYPES.EXPENSE}>Expense / Disbursement (-)</option>
                    {(activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.IGF ||
                      activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.IGP) && (
                      <>
                        <option value={TRANSACTION_TYPES.COLLECTION}>Sales Collection (+)</option>
                        <option value={TRANSACTION_TYPES.RECEIPT}>Fund Receipt / Deposit (+)</option>
                        <option value={TRANSACTION_TYPES.REFUND}>Refund (-)</option>
                      </>
                    )}
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Amount (PHP ₱)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className={styles.formInput}
                    placeholder="0.00"
                    value={txForm.amount}
                    onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Expense Purpose</label>
                <select
                  className={styles.formSelect}
                  value={txForm.expensePurpose}
                  onChange={(e) =>
                    setTxForm({ ...txForm, expensePurpose: e.target.value })
                  }
                >
                  {activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET && (
                    <>
                      <option value={EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE}>
                        Event Itemized Expense (Approved Resolution Required)
                      </option>
                      <option value={EXPENSE_PURPOSES.RESOLUTION_DISBURSEMENT}>
                        Project Resolution Disbursement
                      </option>
                    </>
                  )}
                  {activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE && (
                    <>
                      <option value={EXPENSE_PURPOSES.RESOLUTION_DISBURSEMENT}>
                        FSG Supplemental / Activity Disbursement
                      </option>
                      <option value={EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE}>
                        FSG Itemized Expense
                      </option>
                    </>
                  )}
                  {(activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.IGF ||
                    activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.IGP) && (
                    <>
                      <option value={EXPENSE_PURPOSES.EVENT_PREPARATION_CONSUMABLES}>
                        Event Preparation Consumables (Officer Flexible)
                      </option>
                      <option value={EXPENSE_PURPOSES.MERCHANDISE_EXPENSE}>
                        Merchandise &amp; Supplier Costs
                      </option>
                      <option value={EXPENSE_PURPOSES.PROJECT_OPERATING_EXPENSE}>
                        Project Operating Expense
                      </option>
                      <option value={EXPENSE_PURPOSES.COLLECTION}>Collection</option>
                    </>
                  )}
                </select>
              </div>

              {/* Conditional Resolution & Allocation for Fiscal Year Budget and FSG Remittance */}
              {(activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET ||
                activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE) && (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>
                      Budget Allocation Target <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <select
                      className={styles.formSelect}
                      value={txForm.budgetAllocationId}
                      onChange={(e) => {
                        const selectedAlloc = budgetAllocations.find(
                          (a) => a.id === e.target.value
                        );
                        setTxForm({
                          ...txForm,
                          budgetAllocationId: e.target.value,
                          resolutionRef: selectedAlloc?.resolutionRef || txForm.resolutionRef,
                        });
                      }}
                      required
                    >
                      <option value="">-- Choose Approved Activity Allocation --</option>
                      {budgetAllocations
                        .filter((alloc) => {
                          // Only postable allocations: not draft and remaining budget > 0
                          const isDraft = alloc.status === 'draft';
                          const remaining =
                            (alloc.approvedAmountCentavos || 0) - (alloc.spentAmountCentavos || 0);
                          if (isDraft || remaining <= 0) return false;

                          const isFSGAlloc =
                            alloc.fundAccountId === 'fund_fsg_remittance' ||
                            alloc.fundCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE ||
                            alloc.activityName?.toLowerCase().includes('fsg');
                          if (activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE) {
                            return isFSGAlloc;
                          }
                          return !isFSGAlloc;
                        })
                        .map((alloc) => (
                          <option key={alloc.id} value={alloc.id}>
                            {alloc.activityName} (Remaining:{' '}
                            {formatPHP(
                              (alloc.approvedAmountCentavos || 0) -
                                (alloc.spentAmountCentavos || 0),
                              true
                            )}
                            )
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>
                      Budget Resolution Reference <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder={
                        activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE
                          ? 'e.g. FSG Sub-Allocation Res. No. 2026-002'
                          : 'e.g. Resolution No. 2026-004-SSG'
                      }
                      value={txForm.resolutionRef}
                      onChange={(e) =>
                        setTxForm({ ...txForm, resolutionRef: e.target.value })
                      }
                      required
                    />
                  </div>
                </>
              )}

              {/* Custodian for Flexible IGF / IGP Preparation Expenses */}
              {(activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.IGF ||
                activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.IGP) &&
                txForm.expensePurpose === EXPENSE_PURPOSES.EVENT_PREPARATION_CONSUMABLES && (
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>
                      Responsible Officer / Custodian <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="Officer Name"
                      value={txForm.custodianName}
                      onChange={(e) =>
                        setTxForm({ ...txForm, custodianName: e.target.value })
                      }
                      required
                    />
                  </div>
                )}

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Stored In (Holding / Depository Location)</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder={activeFund?.bankAccountReference || 'e.g. Treasury Safe / Cash Box or GCash / Online Holding'}
                  value={txForm.storageLocation}
                  onChange={(e) =>
                    setTxForm({ ...txForm, storageLocation: e.target.value })
                  }
                />
              </div>

              {/* Receipt & Proof of Purchase (Google Drive 'Receipts' Folder or OR # & Details) */}
              {(txForm.transactionType === TRANSACTION_TYPES.EXPENSE ||
                txForm.transactionType === TRANSACTION_TYPES.PAYMENT) && (
                <div
                  style={{
                    padding: '0.85rem 1rem',
                    marginBottom: '1rem',
                    borderRadius: '10px',
                    border: '1px solid rgba(212, 175, 55, 0.35)',
                    background: 'rgba(212, 175, 55, 0.06)',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', marginBottom: '0.55rem' }}>
                    🧾 Receipt &amp; Proof of Purchase (Required for Expenses — Uploads to Google Drive &rarr; Receipts)
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div className={styles.formGroup} style={{ marginBottom: '0.6rem' }}>
                      <label className={styles.formLabel}>Receipt Label / Category</label>
                      <select
                        className={styles.formSelect}
                        value={txForm.receiptLabel}
                        onChange={(e) => setTxForm({ ...txForm, receiptLabel: e.target.value })}
                      >
                        {RECEIPT_LABELS.map((lbl) => (
                          <option key={lbl} value={lbl}>
                            {lbl}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.formGroup} style={{ marginBottom: '0.6rem' }}>
                      <label className={styles.formLabel}>Official Receipt (OR #) — Optional if Picture Uploaded</label>
                      <input
                        type="text"
                        className={styles.formInput}
                        placeholder="e.g. OR #10492"
                        value={txForm.receiptOrNumber}
                        onChange={(e) => setTxForm({ ...txForm, receiptOrNumber: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup} style={{ marginBottom: '0.6rem' }}>
                    <label className={styles.formLabel}>Receipt Item Details (e.g. Cooked chicken for lunch during event prep)</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="Describe the purchased item or receipt details if no picture is available..."
                      value={txForm.receiptDetails}
                      onChange={(e) => setTxForm({ ...txForm, receiptDetails: e.target.value })}
                    />
                  </div>

                  <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                    <label className={styles.formLabel}>
                      Upload Receipt Picture / PDF (Synced to Google Drive &rarr; Receipts folder)
                    </label>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className={styles.formInput}
                      disabled={isUploadingReceipt}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setSubmitError(null);
                        setIsUploadingReceipt(true);
                        setReceiptUploadProgress(0);
                        setReceiptUploadNotice('Uploading receipt to Google Drive (Receipts folder)...');
                        try {
                          const res = await uploadReceiptToDrive(
                            file,
                            {
                              title: `Receipt_${txForm.receiptLabel || 'Expense'}_${file.name}`,
                              office: 'SSG Finance',
                            },
                            (pct) => setReceiptUploadProgress(pct)
                          );
                          const link = res.driveWebViewLink || res.downloadUrl || '';
                          setTxForm((prev) => ({
                            ...prev,
                            receiptFileId: res.fileId || '',
                            receiptDriveLink: res.driveWebViewLink || '',
                            receiptUrl: link,
                          }));
                          setReceiptUploadNotice(
                            res.driveWebViewLink
                              ? `✓ Uploaded "${res.filename}" to Google Drive → Receipts folder!`
                              : `✓ Uploaded "${res.filename}" (queued for Google Drive → Receipts)`
                          );
                        } catch (uploadErr) {
                          setReceiptUploadNotice('');
                          setSubmitError(uploadErr.message || 'Receipt upload failed.');
                        } finally {
                          setIsUploadingReceipt(false);
                        }
                      }}
                    />
                    {isUploadingReceipt && (
                      <div style={{ fontSize: '0.76rem', marginTop: '0.3rem', color: '#fbbf24' }}>
                        Uploading receipt... {receiptUploadProgress}%
                      </div>
                    )}
                    {receiptUploadNotice && !isUploadingReceipt && (
                      <div style={{ fontSize: '0.76rem', marginTop: '0.3rem', color: '#4ade80' }}>
                        {receiptUploadNotice}{' '}
                        {txForm.receiptDriveLink && (
                          <a
                            href={txForm.receiptDriveLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#38bdf8', marginLeft: '0.35rem', textDecoration: 'underline' }}
                          >
                            Open in Google Drive
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Payee or Payer</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="e.g. Student Body / Vendor Name"
                  value={txForm.payeeOrPayer}
                  onChange={(e) =>
                    setTxForm({ ...txForm, payeeOrPayer: e.target.value })
                  }
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Description &amp; Justification</label>
                <textarea
                  rows="3"
                  className={styles.formTextarea}
                  placeholder="State the business purpose..."
                  value={txForm.description}
                  onChange={(e) =>
                    setTxForm({ ...txForm, description: e.target.value })
                  }
                  required
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.75rem',
                  marginTop: '1.5rem',
                }}
              >
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.primaryBtn}>
                  Post to Ledger
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Authorized Reversal Modal */}
      {/* Reversal Confirmation Modal (Accessible & Alertbox-Free) */}
      <ReversalModal
        isOpen={isReversalModalOpen}
        transaction={selectedTxForReversal}
        isSubmitting={isSubmittingReversal}
        externalError={reversalModalError}
        onClose={() => {
          setIsReversalModalOpen(false);
          setSelectedTxForReversal(null);
        }}
        onConfirm={handleConfirmReversal}
      />

      {/* Restore Allocation Modal */}
      <RestoreAllocationModal
        isOpen={isRestoreModalOpen}
        budget={selectedBudgetForRestore}
        isSubmitting={isSubmittingRestore}
        onClose={() => {
          setIsRestoreModalOpen(false);
          setSelectedBudgetForRestore(null);
        }}
        onConfirm={async () => {
          if (!selectedBudgetForRestore) return;
          try {
            setIsSubmittingRestore(true);
            await restoreBudget(selectedBudgetForRestore.id);
            setIsRestoreModalOpen(false);
            setSelectedBudgetForRestore(null);
          } finally {
            setIsSubmittingRestore(false);
          }
        }}
      />

      {/* Unified Fiscal Budget Modal */}
      <BankCalibrationModal
        isOpen={isFiscalBudgetModalOpen}
        mode="fiscal"
        initialValues={fiscalBudgetForm}
        isSaving={isSavingFiscalBudget}
        error={fiscalBudgetError}
        onClose={() => setIsFiscalBudgetModalOpen(false)}
        onSubmit={async (formData) => {
          setFiscalBudgetError(null);
          const amountNum = parseFloat(formData.budgetAmount);
          if (isNaN(amountNum) || amountNum < 0) {
            setFiscalBudgetError('Please enter a valid budget amount (₱0.00 or greater).');
            return;
          }
          if (!formData.bankAccountReference || !formData.bankAccountReference.trim()) {
            setFiscalBudgetError('Institutional Depository Bank Reference is required.');
            return;
          }
          try {
            setIsSavingFiscalBudget(true);
            await updateFiscalBudget({
              budgetAmount: amountNum,
              resolutionRef: formData.resolutionRef,
              bankAccountReference: formData.bankAccountReference,
              note: formData.note,
            });
            setIsFiscalBudgetModalOpen(false);
          } catch (err) {
            setFiscalBudgetError(err.message || 'Error updating fiscal budget.');
          } finally {
            setIsSavingFiscalBudget(false);
          }
        }}
      />

      {/* Non-Fiscal Fund Balance Modal (FSG, IGF, IGP) */}
      <BankCalibrationModal
        isOpen={isFundBalanceModalOpen && !!selectedFundForBalance}
        mode="fund"
        fund={selectedFundForBalance}
        initialValues={{
          fundBalance: fundBalanceInput,
          fundBalanceReason: fundBalanceReason,
          storageLocation: selectedFundForBalance?.bankAccountReference || '',
        }}
        isSaving={isSavingFundBalance}
        error={fundBalanceError}
        onClose={() => setIsFundBalanceModalOpen(false)}
        onSubmit={async ({ balance, reason, storageLocation }) => {
          setFundBalanceError(null);
          const amountNum = parseFloat(balance);
          if (isNaN(amountNum) || amountNum < 0) {
            setFundBalanceError('Please enter a valid balance amount (₱0.00 or greater).');
            return;
          }
          try {
            setIsSavingFundBalance(true);
            await updateFundBalance(
              selectedFundForBalance.id,
              amountNum,
              reason?.trim() || 'Fund Balance Calibration',
              storageLocation
            );
            setIsFundBalanceModalOpen(false);
          } catch (err) {
            setFundBalanceError(err.message || 'Error updating fund balance.');
          } finally {
            setIsSavingFundBalance(false);
          }
        }}
      />
    </div>
  );
};

export default FundGovernance;
