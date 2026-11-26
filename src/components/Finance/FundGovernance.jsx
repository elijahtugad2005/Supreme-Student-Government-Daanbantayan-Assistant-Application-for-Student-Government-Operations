import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
  computeDisbursedByAllocation,
  computeEffectiveFiscalCeilingCentavos,
  computeAuthoritativeFundBalanceCentavos,
  filterValidLedgerTransactions,
  inferTransactionStorageLocation,
} from '../../utils/financeLedgerReconciliation.js';
import {
  computeAllocationLedgerPostingState,
  deriveAllocationTxDefaults,
  resolveReceiptUploadOutcome,
} from '../../utils/ledgerTxFormHelpers.js';
import {
  LEDGER_POOL_ORDER,
  LEDGER_POOL_META,
  LEDGER_DIRECTIONS,
  toggleLedgerPool,
  computeLedgerRunningTrail,
  filterLedgerTrail,
  computeLedgerBridgeSummary,
  computeLedgerPoolCounts,
} from '../../utils/ledgerRunningBalance.js';
import { driveStore } from '../../services/fileStore/driveStore.js';
import { mongoStore } from '../../services/fileStore/mongoStore.js';
import {
  hasViewableReceipt,
  isDirectBrowserReceiptUrl,
  openReceiptProof,
} from '../../utils/receiptAccessHelpers.js';
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
  HiChevronDown,
  HiChevronUp,
  HiFilter,
  HiArrowRight,
  HiSwitchVertical,
  HiEyeOff,
  HiEye,
  HiFolder,
  HiExternalLink,
} from 'react-icons/hi';

const FundGovernance = () => {
  const {
    fundAccounts,
    budgetAllocations,
    transactions,
    igpCollections = [],
    ledgerBalancesByAccount,
    disbursedByAccount,
    disbursedByAllocation,
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

  const computedDisbursedByAllocation = useMemo(
    () => disbursedByAllocation || computeDisbursedByAllocation(visibleTransactions),
    [disbursedByAllocation, visibleTransactions]
  );

  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [receiptUploadProgress, setReceiptUploadProgress] = useState(0);
  const [receiptUploadNotice, setReceiptUploadNotice] = useState('');
  const [receiptsDriveFolder, setReceiptsDriveFolder] = useState(null);
  const [showOptionalTxFields, setShowOptionalTxFields] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      setReceiptsDriveFolder(null);
      return undefined;
    }
    let alive = true;
    driveStore
      .getFolders({ folder: 'receipts' })
      .then((res) => {
        if (!alive) return;
        setReceiptsDriveFolder(res?.enabled && res.receiptsFolder?.url ? res.receiptsFolder : null);
      })
      .catch(() => {
        if (alive) setReceiptsDriveFolder(null);
      });
    return () => {
      alive = false;
    };
  }, [currentUser]);

  const handleOpenLedgerReceipt = async (tx) => {
    try {
      await openReceiptProof(tx, {
        getBlobUrl: (fileId, opts) => mongoStore.getUrl(fileId, opts),
      });
    } catch (err) {
      setSubmitError(err?.message || 'Could not open receipt file.');
    }
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReversalModalOpen, setIsReversalModalOpen] = useState(false);
  const [selectedTxForReversal, setSelectedTxForReversal] = useState(null);
  const [isSubmittingReversal, setIsSubmittingReversal] = useState(false);
  const [reversalModalError, setReversalModalError] = useState(null);
  const [selectedBudgetForRestore, setSelectedBudgetForRestore] = useState(null);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [isSubmittingRestore, setIsSubmittingRestore] = useState(false);
  const [isSubmittingTx, setIsSubmittingTx] = useState(false);
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

  // QoL Append-Only Financial Ledger Filter & Running Decrement State
  const [ledgerSelectedPools, setLedgerSelectedPools] = useState([]); // [] = All Funds, or subset of ['PPMP', 'IGF', 'IGP']
  const [ledgerDirection, setLedgerDirection] = useState(LEDGER_DIRECTIONS.ALL);
  const [ledgerHideReversed, setLedgerHideReversed] = useState(false);
  const [ledgerSortOrder, setLedgerSortOrder] = useState('newest'); // 'newest' | 'oldest'

  const ledgerTrailResult = useMemo(
    () => computeLedgerRunningTrail(visibleTransactions, fundAccounts, igpCollections),
    [visibleTransactions, fundAccounts, igpCollections]
  );

  const ledgerPoolCounts = useMemo(
    () =>
      computeLedgerPoolCounts(ledgerTrailResult.rows, {
        direction: ledgerDirection,
        hideReversed: ledgerHideReversed,
      }),
    [ledgerTrailResult.rows, ledgerDirection, ledgerHideReversed]
  );

  const filteredLedgerRows = useMemo(
    () =>
      filterLedgerTrail(ledgerTrailResult.rows, {
        selectedPools: ledgerSelectedPools,
        direction: ledgerDirection,
        hideReversed: ledgerHideReversed,
        sortOrder: ledgerSortOrder,
      }),
    [
      ledgerTrailResult.rows,
      ledgerSelectedPools,
      ledgerDirection,
      ledgerHideReversed,
      ledgerSortOrder,
    ]
  );

  const ledgerBridgeSummary = useMemo(
    () => computeLedgerBridgeSummary(ledgerTrailResult, ledgerSelectedPools, fundAccounts),
    [ledgerTrailResult, ledgerSelectedPools, fundAccounts]
  );

  const hasActiveLedgerFilters =
    ledgerSelectedPools.length > 0 ||
    ledgerDirection !== LEDGER_DIRECTIONS.ALL ||
    ledgerHideReversed ||
    ledgerSortOrder !== 'newest';

  const handleResetLedgerFilters = () => {
    setLedgerSelectedPools([]);
    setLedgerDirection(LEDGER_DIRECTIONS.ALL);
    setLedgerHideReversed(false);
    setLedgerSortOrder('newest');
  };

  // Form State for new Transaction
  const [txForm, setTxForm] = useState({
    fundAccountId: 'fund_fiscal_year_budget',
    transactionType: TRANSACTION_TYPES.EXPENSE,
    expensePurpose: EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE,
    amount: '',
    amountAutoFilled: false,
    amountAutoFillSource: '',
    payeeOrPayer: '',
    description: '',
    descriptionAutoFilled: false,
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

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen]);

  const handleOpenRecordModal = () => {
    setSubmitError(null);
    setReceiptUploadNotice('');
    setReceiptUploadProgress(0);
    setShowOptionalTxFields(false);
    setIsModalOpen(true);
  };

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

    const baseTx = {
      fundAccountId: fundId,
      transactionType: TRANSACTION_TYPES.EXPENSE,
      expensePurpose:
        matchedAccount?.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE
          ? EXPENSE_PURPOSES.RESOLUTION_DISBURSEMENT
          : EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE,
      amount: '',
      amountAutoFilled: false,
      payeeOrPayer: '',
      description: '',
      descriptionAutoFilled: false,
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
      storageLocation: matchedAccount?.bankAccountReference || '',
    };

    setTxForm(deriveAllocationTxDefaults(budget, baseTx, computedDisbursedByAllocation));
    setSubmitError(null);
    setReceiptUploadNotice('');
    setReceiptUploadProgress(0);
    setShowOptionalTxFields(false);
    setIsModalOpen(true);
  };

  // Reversal handler
  const handleOpenReversal = (tx) => {
    setSelectedTxForReversal(tx);
    setReversalModalError(null);
    setIsReversalModalOpen(true);
  };

  const handleConfirmReversal = async (reasonText) => {
    const finalReason = typeof reasonText === 'string' ? reasonText : '';
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

  // Submit transaction (locked against double-submit)
  const handleSubmitTx = async (e) => {
    e.preventDefault();
    if (isSubmittingTx) return;
    setSubmitError(null);

    const amountNum = parseFloat(txForm.amount);
    if (!amountNum || amountNum <= 0) {
      setSubmitError('Please enter a valid amount.');
      return;
    }

    try {
      setIsSubmittingTx(true);
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
        amountAutoFilled: false,
        payeeOrPayer: '',
        description: '',
        descriptionAutoFilled: false,
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
      setShowOptionalTxFields(false);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setIsSubmittingTx(false);
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
            onClick={handleOpenRecordModal}
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

          const balanceCentavos = computeAuthoritativeFundBalanceCentavos(fund, visibleTransactions, igpCollections);
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
                className={`${styles.filterPill} ${allocFundFilter === 'All' ? styles.filterPillActive : ''
                  }`}
                onClick={() => setAllocFundFilter('All')}
              >
                All ({budgets.length})
              </button>
              <button
                type="button"
                className={`${styles.filterPill} ${allocFundFilter === 'fund_fiscal_year_budget' ? styles.filterPillActive : ''
                  }`}
                onClick={() => setAllocFundFilter('fund_fiscal_year_budget')}
              >
                🏛️ Fiscal ({fiscalBudgetsCount})
              </button>
              <button
                type="button"
                className={`${styles.filterPill} ${allocFundFilter === 'fund_fsg_remittance' ? styles.filterPillActive : ''
                  }`}
                onClick={() => setAllocFundFilter('fund_fsg_remittance')}
              >
                🤝 FSG ({fsgBudgetsCount})
              </button>
              <button
                type="button"
                className={`${styles.filterPill} ${allocFundFilter === 'archived' ? styles.filterPillActive : ''
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
                  : `No budget allocations found under ${allocFundFilter === 'fund_fsg_remittance' ? 'FSG Remittance' : 'Fiscal Year Budget'
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
                  const postingState = computeAllocationLedgerPostingState(
                    b,
                    computedDisbursedByAllocation
                  );
                  const hasUnpostedDisbursed = postingState.unpostedDisbursedCentavos > 0;
                  const isFullyPosted = !hasUnpostedDisbursed && postingState.remainingAllocCentavos <= 0;
                  const canPostExpense = !isDraft && postingState.canPostToLedger && canPostFinanceLedger;

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
                            className={`${styles.statusPill} ${b.ppmpStatus === PPMP_STATUSES.FRESH
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
                                    : isFullyPosted
                                      ? 'Cannot post expense: Budget is fully posted to the ledger.'
                                      : hasUnpostedDisbursed
                                        ? `Post recorded disbursement (${formatPHP(postingState.unpostedDisbursedCentavos, true)}) to the financial ledger`
                                        : 'Post Expense against this Allocation'
                                }
                                onClick={() => canPostExpense && handleOpenTxForAllocation(b)}
                                disabled={!canPostExpense}
                              >
                                {isFullyPosted ? 'Fully Spent' : isDraft ? 'Draft' : 'Post Expense'}
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
          <div>
            <h2 className={styles.tableTitle}>Append-Only Financial Ledger</h2>
            <p className={styles.ledgerSubCaption}>
              Filter by PPMP, IGF, IGP, or combine multiple pools to trace exact balance decrements.
            </p>
          </div>
          <div className={styles.ledgerHeaderActions}>
            {receiptsDriveFolder?.url && (
              <a
                href={receiptsDriveFolder.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.ledgerDriveLink}
                title="Open shared Google Drive Receipts folder (linked with Inventory)"
              >
                <HiFolder size={14} aria-hidden="true" />
                <span>Receipts Folder (Drive)</span>
                <HiExternalLink size={13} aria-hidden="true" />
              </a>
            )}
            <span className={styles.ledgerEntryCount}>
              {filteredLedgerRows.length === visibleTransactions.length
                ? `${visibleTransactions.length} immutable entries`
                : `Showing ${filteredLedgerRows.length} of ${visibleTransactions.length} entries`}
            </span>
          </div>
        </div>

        {/* QoL Ledger Filter Bar */}
        <div className={styles.ledgerFilterBar} role="region" aria-label="Ledger filters">
          <div className={styles.ledgerFilterGroup}>
            <span className={styles.ledgerFilterLabel}>
              <HiFilter size={13} aria-hidden="true" />
              Fund Pool
            </span>
            <div className={styles.ledgerPoolChips} role="group" aria-label="Filter by fund pool">
              <button
                type="button"
                aria-pressed={ledgerSelectedPools.length === 0}
                className={`${styles.ledgerPoolChip} ${
                  ledgerSelectedPools.length === 0 ? styles.ledgerPoolChipActive : ''
                }`}
                onClick={() => setLedgerSelectedPools([])}
              >
                <span>All Funds</span>
                <span className={styles.ledgerChipCount}>{ledgerPoolCounts.ALL}</span>
              </button>
              {LEDGER_POOL_ORDER.map((poolKey) => {
                const meta = LEDGER_POOL_META[poolKey];
                const isSelected = ledgerSelectedPools.includes(poolKey);
                return (
                  <button
                    key={poolKey}
                    type="button"
                    aria-pressed={isSelected}
                    title={`Toggle ${meta.fullLabel} (select multiple to combine)`}
                    className={`${styles.ledgerPoolChip} ${
                      isSelected ? styles.ledgerPoolChipActive : ''
                    }`}
                    onClick={() =>
                      setLedgerSelectedPools((prev) => toggleLedgerPool(prev, poolKey))
                    }
                  >
                    <span>{meta.label}</span>
                    <span className={styles.ledgerChipCount}>
                      {ledgerPoolCounts[poolKey] || 0}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.ledgerControlsRow}>
            <div
              className={styles.ledgerDirectionGroup}
              role="group"
              aria-label="Filter by transaction direction"
            >
              {[
                { key: LEDGER_DIRECTIONS.ALL, label: 'All' },
                { key: LEDGER_DIRECTIONS.EXPENSES, label: 'Expenses Only' },
                { key: LEDGER_DIRECTIONS.INFLOWS, label: 'Inflows Only' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={ledgerDirection === opt.key}
                  className={`${styles.ledgerDirectionBtn} ${
                    ledgerDirection === opt.key ? styles.ledgerDirectionBtnActive : ''
                  }`}
                  onClick={() => setLedgerDirection(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className={styles.ledgerUtilityBtns}>
              <button
                type="button"
                aria-pressed={ledgerHideReversed}
                className={`${styles.ledgerUtilBtn} ${
                  ledgerHideReversed ? styles.ledgerUtilBtnActive : ''
                }`}
                onClick={() => setLedgerHideReversed((prev) => !prev)}
                title="Hide reversed and voided offset rows for a clean decrement sequence"
              >
                {ledgerHideReversed ? (
                  <HiEyeOff size={14} aria-hidden="true" />
                ) : (
                  <HiEye size={14} aria-hidden="true" />
                )}
                <span>{ledgerHideReversed ? 'Reversed Hidden' : 'Hide Reversed'}</span>
              </button>

              <button
                type="button"
                className={`${styles.ledgerUtilBtn} ${
                  ledgerSortOrder === 'oldest' ? styles.ledgerUtilBtnActive : ''
                }`}
                onClick={() =>
                  setLedgerSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))
                }
                title="Switch between newest-first and chronological countdown order"
              >
                <HiSwitchVertical size={14} aria-hidden="true" />
                <span>{ledgerSortOrder === 'oldest' ? 'Oldest → Newest' : 'Newest First'}</span>
              </button>

              {hasActiveLedgerFilters && (
                <button
                  type="button"
                  className={styles.ledgerResetBtn}
                  onClick={handleResetLedgerFilters}
                >
                  <HiX size={13} aria-hidden="true" />
                  <span>Reset</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Balance Decrement Bridge Strip */}
        <div
          className={styles.ledgerBridgeStrip}
          role="region"
          aria-label="Fund balance decrement summary"
        >
          <div className={styles.ledgerBridgeHeader}>
            <span className={styles.ledgerBridgeScope}>{ledgerBridgeSummary.scopeLabel}</span>
            <span className={styles.ledgerBridgeSpentPct}>
              {ledgerBridgeSummary.spentPercent.toFixed(1)}% utilized
            </span>
          </div>

          <div className={styles.ledgerBridgeEquation}>
            {ledgerBridgeSummary.startingCentavos > 0 && (
              <div className={styles.ledgerBridgeStep}>
                <span className={styles.ledgerBridgeStepLabel}>
                  {ledgerSelectedPools.length === 1 && ledgerSelectedPools[0] === 'PPMP'
                    ? 'Budget Ceiling'
                    : 'Opening / Ceiling'}
                </span>
                <span className={styles.ledgerBridgeValueBase}>
                  {formatPHP(ledgerBridgeSummary.startingCentavos, true)}
                </span>
              </div>
            )}

            {ledgerBridgeSummary.startingCentavos > 0 &&
              ledgerBridgeSummary.inflowsCentavos > 0 && (
                <span className={styles.ledgerBridgeOp} aria-hidden="true">
                  +
                </span>
              )}

            {(ledgerBridgeSummary.inflowsCentavos > 0 ||
              ledgerBridgeSummary.startingCentavos === 0) && (
              <div className={styles.ledgerBridgeStep}>
                <span className={styles.ledgerBridgeStepLabel}>
                  {ledgerBridgeSummary.inflowCount > 0
                    ? `Inflows (${ledgerBridgeSummary.inflowCount})`
                    : 'Total Collections'}
                </span>
                <span className={styles.ledgerBridgeValueIn}>
                  {formatPHP(ledgerBridgeSummary.inflowsCentavos, true)}
                </span>
              </div>
            )}

            <span className={styles.ledgerBridgeOp} aria-hidden="true">
              −
            </span>

            <div className={styles.ledgerBridgeStep}>
              <span className={styles.ledgerBridgeStepLabel}>
                {ledgerBridgeSummary.expenseCount > 0
                  ? `Expenses (${ledgerBridgeSummary.expenseCount})`
                  : 'Expenses'}
              </span>
              <span className={styles.ledgerBridgeValueOut}>
                {formatPHP(ledgerBridgeSummary.expensesCentavos, true)}
              </span>
            </div>

            <span className={styles.ledgerBridgeOp} aria-hidden="true">
              =
            </span>

            <div className={`${styles.ledgerBridgeStep} ${styles.ledgerBridgeStepResult}`}>
              <span className={styles.ledgerBridgeStepLabel}>Remaining Balance</span>
              <span className={styles.ledgerBridgeValueNet}>
                {formatPHP(ledgerBridgeSummary.remainingCentavos, true)}
              </span>
            </div>
          </div>

          <div className={styles.ledgerBridgeMeterTrack} aria-hidden="true">
            <div
              className={styles.ledgerBridgeMeterFill}
              style={{ width: `${Math.min(100, ledgerBridgeSummary.spentPercent)}%` }}
            />
          </div>

          {ledgerBridgeSummary.perAccountSnapshots.length > 1 && (
            <div className={styles.ledgerBridgeBreakdown}>
              {ledgerBridgeSummary.perAccountSnapshots.map((snap) => (
                <span key={snap.id} className={styles.ledgerBridgeSnapChip}>
                  <span className={styles.ledgerBridgeSnapName}>{snap.name}:</span>
                  <span className={styles.ledgerBridgeSnapVal}>
                    {formatPHP(snap.remainingCentavos, true)}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {visibleTransactions.length === 0 ? (
          <div className={styles.ledgerEmptyState}>
            No transactions posted yet. Post an authorized expense or IGF/IGP collection to build the ledger.
          </div>
        ) : filteredLedgerRows.length === 0 ? (
          <div className={styles.ledgerEmptyState}>
            <p className={styles.ledgerEmptyText}>
              No ledger entries match the current filter ({ledgerBridgeSummary.scopeLabel}
              {ledgerDirection === LEDGER_DIRECTIONS.EXPENSES
                ? ' · Expenses Only'
                : ledgerDirection === LEDGER_DIRECTIONS.INFLOWS
                  ? ' · Inflows Only'
                  : ''}
              ).
            </p>
            <button
              type="button"
              className={styles.ledgerResetBtn}
              onClick={handleResetLedgerFilters}
            >
              Show All Entries
            </button>
          </div>
        ) : (
          <div className={styles.ledgerTableWrap}>
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
                  <th>Balance Trail (Before → After)</th>
                  <th>Status</th>
                  {canReverseFinanceLedger && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredLedgerRows.map((row) => {
                  const { tx } = row;
                  const activePoolSet =
                    ledgerSelectedPools.length > 0 ? new Set(ledgerSelectedPools) : null;
                  const isInboundTransferView =
                    Boolean(row.destinationTrail) &&
                    Boolean(activePoolSet) &&
                    !activePoolSet.has(row.pool) &&
                    activePoolSet.has(row.destinationTrail.pool);
                  const displayIsOutflow = isInboundTransferView ? false : row.isOutflow;
                  const displayBeforeCentavos = isInboundTransferView
                    ? row.destinationTrail.beforeCentavos
                    : row.beforeCentavos;
                  const displayAfterCentavos = isInboundTransferView
                    ? row.destinationTrail.afterCentavos
                    : row.afterCentavos;
                  const displayDeltaCentavos = isInboundTransferView
                    ? row.destinationTrail.deltaCentavos
                    : row.effectiveDeltaCentavos;

                  const matchedFundAcc = fundAccounts.find((a) => a.id === tx.fundAccountId);
                  const destFundAcc = row.destinationTrail
                    ? fundAccounts.find((a) => a.id === row.destinationTrail.accountId)
                    : null;
                  const txStorageLocation = inferTransactionStorageLocation(tx, matchedFundAcc);

                  return (
                    <tr
                      key={tx.id}
                      className={row.isVoidedPair ? styles.ledgerRowVoided : undefined}
                    >
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {tx.refNumber || tx.id.slice(0, 8)}
                      </td>
                      <td>
                        {tx.createdAt?.toDate
                          ? tx.createdAt.toDate().toLocaleDateString()
                          : new Date().toLocaleDateString()}
                      </td>
                      <td>
                        <div className={styles.ledgerFundCell}>
                          <span className={styles.ledgerFundName}>
                            {isInboundTransferView && destFundAcc
                              ? destFundAcc.name
                              : TOP_LEVEL_FUND_LABELS[tx.fundCategory] || tx.fundCategory}
                          </span>
                          <span className={styles.ledgerPoolTag}>
                            {isInboundTransferView ? row.destinationTrail.pool : row.pool}
                          </span>
                        </div>
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
                          {isInboundTransferView ? 'Transfer In' : tx.transactionType}
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
                                {tx.receiptLabel}
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
                            {hasViewableReceipt(tx) && (
                              <button
                                type="button"
                                onClick={() => handleOpenLedgerReceipt(tx)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  color: '#38bdf8',
                                  textDecoration: 'underline',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  fontSize: 'inherit',
                                }}
                              >
                                {isDirectBrowserReceiptUrl(tx.receiptDriveLink) ? 'View Receipt (Drive)' : 'View Receipt'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={displayIsOutflow ? styles.amountOut : styles.amountIn}>
                          {displayIsOutflow ? '-' : '+'}
                          {formatPHP(tx.amountCentavos || 0, true)}
                        </span>
                      </td>
                      <td>
                        {row.isVoidedPair ? (
                          <div className={styles.balanceTrailCell}>
                            <span className={styles.balanceTrailVoided}>
                              {formatPHP(displayAfterCentavos, true)}
                            </span>
                            <span className={styles.balanceTrailMeta}>
                              {row.isPairedReversal ? 'Reversal offset (₱0 net)' : 'Voided (₱0 net)'}
                            </span>
                          </div>
                        ) : (
                          <div className={styles.balanceTrailCell}>
                            <div className={styles.balanceTrailLine}>
                              <span className={styles.balanceTrailBefore}>
                                {formatPHP(displayBeforeCentavos, true)}
                              </span>
                              <HiArrowRight
                                size={12}
                                className={
                                  displayDeltaCentavos < 0
                                    ? styles.balanceTrailArrowOut
                                    : styles.balanceTrailArrowIn
                                }
                                aria-hidden="true"
                              />
                              <span
                                className={
                                  displayDeltaCentavos < 0
                                    ? styles.balanceTrailAfterOut
                                    : styles.balanceTrailAfterIn
                                }
                              >
                                {formatPHP(displayAfterCentavos, true)}
                              </span>
                            </div>
                            {!isInboundTransferView &&
                              row.destinationTrail &&
                              row.destinationTrail.deltaCentavos !== 0 && (
                                <span className={styles.balanceTrailMeta}>
                                  {destFundAcc?.name || row.destinationTrail.pool}:{' '}
                                  {formatPHP(row.destinationTrail.beforeCentavos, true)} →{' '}
                                  {formatPHP(row.destinationTrail.afterCentavos, true)}
                                </span>
                              )}
                          </div>
                        )}
                      </td>
                      <td>
                        <span
                          className={`${styles.statusPill} ${tx.status === TRANSACTION_STATUSES.POSTED
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

      {/* Record Transaction Modal — Streamlined Operate Layout (Required Fields First + Sticky Footer) */}
      {isModalOpen && (() => {
        const isFiscalOrFsgSelected =
          activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET ||
          activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE;
        const isIgfOrIgpSelected =
          activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.IGF ||
          activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.IGP;
        const isExpenseFlow =
          txForm.transactionType === TRANSACTION_TYPES.EXPENSE ||
          txForm.transactionType === TRANSACTION_TYPES.PAYMENT;
        const eligibleAllocations = budgetAllocations.filter((alloc) => {
          const postingState = computeAllocationLedgerPostingState(
            alloc,
            computedDisbursedByAllocation
          );
          if (!postingState.canPostToLedger) return false;
          const isFSGAlloc =
            alloc.fundAccountId === 'fund_fsg_remittance' ||
            alloc.fundCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE ||
            alloc.activityName?.toLowerCase().includes('fsg');
          if (activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE) {
            return isFSGAlloc;
          }
          return !isFSGAlloc;
        });

        return createPortal(
          <div
            className={styles.modalBackdrop}
            onClick={() => setIsModalOpen(false)}
          >
            <div
              className={`${styles.modalContent} ${styles.txModalDialog}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="record-tx-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.txModalHeader}>
                <h3 id="record-tx-modal-title" className={styles.txModalTitle}>
                  Record Financial Transaction
                </h3>
                <button
                  type="button"
                  className={styles.txModalCloseBtn}
                  onClick={() => setIsModalOpen(false)}
                  aria-label="Close modal"
                >
                  <HiX size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmitTx} className={styles.txModalForm}>
                <div className={styles.txModalBody}>
                  {submitError && (
                    <div className={styles.validationWarning} style={{ marginBottom: '0.85rem' }}>
                      <HiExclamationCircle size={18} style={{ marginRight: '0.5rem', flexShrink: 0 }} />
                      <span>{submitError}</span>
                    </div>
                  )}

                  {/* Row 1: Fund Source + Allocation Target (Fiscal/FSG) OR Transaction Type (IGF/IGP) */}
                  <div className={styles.txGridTwo}>
                    <div className={styles.txField}>
                      <label className={styles.formLabel}>
                        Fund Source <span className={styles.reqMark}>*</span>
                      </label>
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
                            amount: txForm.amountAutoFilled ? '' : txForm.amount,
                            amountAutoFilled: false,
                            resolutionRef: isFiscalAcc || isFsgAcc ? '' : txForm.resolutionRef,
                            description: txForm.descriptionAutoFilled ? '' : txForm.description,
                            descriptionAutoFilled: false,
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

                    {isFiscalOrFsgSelected ? (
                      <div className={styles.txField}>
                        <label className={styles.formLabel}>
                          Budget Allocation Target <span className={styles.reqMark}>*</span>
                        </label>
                        <select
                          className={styles.formSelect}
                          value={txForm.budgetAllocationId}
                          onChange={(e) => {
                            const selectedAlloc = budgetAllocations.find(
                              (a) => a.id === e.target.value
                            );
                            setTxForm((prev) =>
                              deriveAllocationTxDefaults(
                                selectedAlloc || null,
                                prev,
                                computedDisbursedByAllocation
                              )
                            );
                          }}
                          required
                        >
                          <option value="">-- Choose Approved Allocation --</option>
                          {eligibleAllocations.map((alloc) => {
                            const ps = computeAllocationLedgerPostingState(
                              alloc,
                              computedDisbursedByAllocation
                            );
                            const summary =
                              ps.unpostedDisbursedCentavos > 0
                                ? `To Post: ${formatPHP(ps.unpostedDisbursedCentavos, true)} • Rem: ${formatPHP(ps.remainingAllocCentavos, true)}`
                                : `Rem: ${formatPHP(ps.remainingAllocCentavos, true)}`;
                            return (
                              <option key={alloc.id} value={alloc.id}>
                                {alloc.activityName} ({summary})
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    ) : (
                      <div className={styles.txField}>
                        <label className={styles.formLabel}>
                          Transaction Type <span className={styles.reqMark}>*</span>
                        </label>
                        <select
                          className={styles.formSelect}
                          value={txForm.transactionType}
                          onChange={(e) =>
                            setTxForm({ ...txForm, transactionType: e.target.value })
                          }
                        >
                          <option value={TRANSACTION_TYPES.EXPENSE}>Expense / Disbursement (-)</option>
                          <option value={TRANSACTION_TYPES.COLLECTION}>Sales Collection (+)</option>
                          <option value={TRANSACTION_TYPES.RECEIPT}>Fund Receipt / Deposit (+)</option>
                          <option value={TRANSACTION_TYPES.REFUND}>Refund (-)</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Row 2: Amount (Auto-filled from Allocation) + Resolution Ref (Fiscal/FSG) OR Purpose (IGF/IGP) */}
                  <div className={styles.txGridTwo}>
                    <div className={styles.txField}>
                      <div className={styles.txLabelRow}>
                        <label className={styles.formLabel} style={{ marginBottom: 0 }}>
                          Amount (PHP ₱) <span className={styles.reqMark}>*</span>
                        </label>
                        {txForm.amountAutoFilled && (
                          <span className={styles.autoFillTag}>
                            {txForm.amountAutoFillSource === 'disbursed'
                              ? 'Auto-filled from disbursed'
                              : 'Auto-filled from remaining'}
                          </span>
                        )}
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className={`${styles.formInput} ${styles.txAmountInput}`}
                        placeholder="0.00"
                        value={txForm.amount}
                        onChange={(e) =>
                          setTxForm({
                            ...txForm,
                            amount: e.target.value,
                            amountAutoFilled: false,
                            amountAutoFillSource: '',
                          })
                        }
                        required
                      />
                    </div>

                    {isFiscalOrFsgSelected ? (
                      <div className={styles.txField}>
                        <label className={styles.formLabel}>
                          Budget Resolution Reference <span className={styles.reqMark}>*</span>
                        </label>
                        <input
                          type="text"
                          className={styles.formInput}
                          placeholder={
                            activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE
                              ? 'e.g. FSG-RES-2026-002'
                              : 'e.g. Resolution No. 2026-004'
                          }
                          value={txForm.resolutionRef}
                          onChange={(e) =>
                            setTxForm({ ...txForm, resolutionRef: e.target.value })
                          }
                          required
                        />
                      </div>
                    ) : (
                      <div className={styles.txField}>
                        <label className={styles.formLabel}>
                          Expense Purpose <span className={styles.reqMark}>*</span>
                        </label>
                        <select
                          className={styles.formSelect}
                          value={txForm.expensePurpose}
                          onChange={(e) =>
                            setTxForm({ ...txForm, expensePurpose: e.target.value })
                          }
                        >
                          <option value={EXPENSE_PURPOSES.EVENT_PREPARATION_CONSUMABLES}>
                            Event Preparation Consumables
                          </option>
                          <option value={EXPENSE_PURPOSES.MERCHANDISE_EXPENSE}>
                            Merchandise &amp; Supplier Costs
                          </option>
                          <option value={EXPENSE_PURPOSES.PROJECT_OPERATING_EXPENSE}>
                            Project Operating Expense
                          </option>
                          <option value={EXPENSE_PURPOSES.COLLECTION}>Collection</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Row 3: Description (Compact single-line, auto-filled) + Custodian when required for IGF/IGP */}
                  {isIgfOrIgpSelected &&
                    txForm.expensePurpose === EXPENSE_PURPOSES.EVENT_PREPARATION_CONSUMABLES ? (
                    <div className={styles.txGridTwo}>
                      <div className={styles.txField}>
                        <label className={styles.formLabel}>
                          Responsible Custodian <span className={styles.reqMark}>*</span>
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
                      <div className={styles.txField}>
                        <label className={styles.formLabel}>
                          Description / Justification <span className={styles.reqMark}>*</span>
                        </label>
                        <input
                          type="text"
                          className={styles.formInput}
                          placeholder="Purpose of expense..."
                          value={txForm.description}
                          onChange={(e) =>
                            setTxForm({
                              ...txForm,
                              description: e.target.value,
                              descriptionAutoFilled: false,
                            })
                          }
                          required
                        />
                      </div>
                    </div>
                  ) : (
                    <div className={styles.txField}>
                      <label className={styles.formLabel}>
                        Description / Justification <span className={styles.reqMark}>*</span>
                      </label>
                      <input
                        type="text"
                        className={styles.formInput}
                        placeholder="State the disbursement or transaction purpose..."
                        value={txForm.description}
                        onChange={(e) =>
                          setTxForm({
                            ...txForm,
                            description: e.target.value,
                            descriptionAutoFilled: false,
                          })
                        }
                        required
                      />
                    </div>
                  )}

                  {/* Row 4: Flat Receipt & Proof of Purchase Section (No nested card, resilient when Drive unavailable) */}
                  {isExpenseFlow && (
                    <div className={styles.txReceiptSection}>
                      <div className={styles.txReceiptHeader}>
                        <span className={styles.txReceiptTitle}>
                          <HiDocumentText size={16} aria-hidden="true" />
                          <span>Receipt &amp; Proof of Purchase</span>
                        </span>
                        <span className={styles.txReceiptHint}>
                          Photo, OR #, or Item Details
                        </span>
                      </div>

                      <div className={styles.txGridTwo}>
                        <div className={styles.txField}>
                          <label className={styles.formLabel}>Receipt Category</label>
                          <select
                            className={styles.formSelect}
                            value={txForm.receiptLabel}
                            onChange={(e) =>
                              setTxForm({ ...txForm, receiptLabel: e.target.value })
                            }
                          >
                            {RECEIPT_LABELS.map((lbl) => (
                              <option key={lbl} value={lbl}>
                                {lbl}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className={styles.txField}>
                          <label className={styles.formLabel}>Official Receipt (OR #)</label>
                          <input
                            type="text"
                            className={styles.formInput}
                            placeholder="e.g. OR #10492"
                            value={txForm.receiptOrNumber}
                            onChange={(e) =>
                              setTxForm({ ...txForm, receiptOrNumber: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      <div className={styles.txGridTwo}>
                        <div className={styles.txField} style={{ marginBottom: 0 }}>
                          <label className={styles.formLabel}>Receipt Photo / PDF</label>
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
                              setReceiptUploadNotice('Attaching receipt proof...');
                              try {
                                const itemLabel =
                                  txForm.description?.trim() ||
                                  txForm.receiptDetails?.trim() ||
                                  txForm.receiptLabel ||
                                  'Finance Expense';
                                const outcome = await resolveReceiptUploadOutcome({
                                  file,
                                  meta: {
                                    itemName: itemLabel,
                                    office: 'SSG Finance',
                                    receiptSource: 'Finance',
                                  },
                                  uploadFn: uploadReceiptToDrive,
                                  onProgress: (pct) => setReceiptUploadProgress(pct),
                                });

                                if (outcome.ok) {
                                  setTxForm((prev) => ({
                                    ...prev,
                                    receiptFileId: outcome.receiptFileId,
                                    receiptDriveLink: outcome.receiptDriveLink,
                                    receiptUrl: outcome.receiptUrl,
                                  }));
                                  setReceiptUploadNotice(outcome.notice);
                                } else {
                                  setReceiptUploadNotice('');
                                  setSubmitError(outcome.error);
                                }
                              } finally {
                                setIsUploadingReceipt(false);
                              }
                            }}
                          />
                        </div>

                        <div className={styles.txField} style={{ marginBottom: 0 }}>
                          <label className={styles.formLabel}>Receipt Item Details</label>
                          <input
                            type="text"
                            className={styles.formInput}
                            placeholder="Brief item note if no photo..."
                            value={txForm.receiptDetails}
                            onChange={(e) =>
                              setTxForm({ ...txForm, receiptDetails: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      {isUploadingReceipt && (
                        <div className={styles.txReceiptStatusPending}>
                          Attaching receipt... {receiptUploadProgress}%
                        </div>
                      )}
                      {receiptUploadNotice && !isUploadingReceipt && (
                        <div className={styles.txReceiptStatusOk}>
                          <span>{receiptUploadNotice}</span>
                          {txForm.receiptDriveLink && (
                            <a
                              href={txForm.receiptDriveLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.txDriveLink}
                            >
                              Open in Drive
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Progressive Disclosure for Non-Required Metadata */}
                  <div className={styles.txOptionalSection}>
                    <button
                      type="button"
                      className={styles.txOptionalToggle}
                      onClick={() => setShowOptionalTxFields((v) => !v)}
                      aria-expanded={showOptionalTxFields}
                    >
                      {showOptionalTxFields ? <HiChevronUp size={15} /> : <HiChevronDown size={15} />}
                      <span>
                        Optional details (Payee, Depository Location{isFiscalOrFsgSelected ? ', Purpose' : ''})
                      </span>
                    </button>

                    {showOptionalTxFields && (
                      <div className={styles.txGridTwo} style={{ marginTop: '0.65rem' }}>
                        <div className={styles.txField} style={{ marginBottom: 0 }}>
                          <label className={styles.formLabel}>Payee or Payer</label>
                          <input
                            type="text"
                            className={styles.formInput}
                            placeholder="e.g. Vendor or Officer Name"
                            value={txForm.payeeOrPayer}
                            onChange={(e) =>
                              setTxForm({ ...txForm, payeeOrPayer: e.target.value })
                            }
                          />
                        </div>

                        <div className={styles.txField} style={{ marginBottom: 0 }}>
                          <label className={styles.formLabel}>Stored In (Depository Location)</label>
                          <input
                            type="text"
                            className={styles.formInput}
                            placeholder={activeFund?.bankAccountReference || 'e.g. BDO Institutional Account'}
                            value={txForm.storageLocation}
                            onChange={(e) =>
                              setTxForm({ ...txForm, storageLocation: e.target.value })
                            }
                          />
                        </div>

                        {isFiscalOrFsgSelected && (
                          <div className={styles.txField} style={{ gridColumn: '1 / -1', marginBottom: 0, marginTop: '0.5rem' }}>
                            <label className={styles.formLabel}>Expense Purpose</label>
                            <select
                              className={styles.formSelect}
                              value={txForm.expensePurpose}
                              onChange={(e) =>
                                setTxForm({ ...txForm, expensePurpose: e.target.value })
                              }
                            >
                              {activeFund?.topLevelCategory === TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET ? (
                                <>
                                  <option value={EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE}>
                                    Event Itemized Expense (Approved Resolution Required)
                                  </option>
                                  <option value={EXPENSE_PURPOSES.RESOLUTION_DISBURSEMENT}>
                                    Project Resolution Disbursement
                                  </option>
                                </>
                              ) : (
                                <>
                                  <option value={EXPENSE_PURPOSES.RESOLUTION_DISBURSEMENT}>
                                    FSG Supplemental / Activity Disbursement
                                  </option>
                                  <option value={EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE}>
                                    FSG Itemized Expense
                                  </option>
                                </>
                              )}
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Sticky Action Footer — Always Visible Without Scrolling */}
                <div className={styles.txModalFooter}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => setIsModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={styles.primaryBtn}
                    disabled={isUploadingReceipt || isSubmittingTx}
                  >
                    {isSubmittingTx ? 'Posting...' : 'Post to Ledger'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        );
      })()}

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
        disbursedCentavos={computedDisbursedByAccount.get('fund_fiscal_year_budget') || 0}
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
