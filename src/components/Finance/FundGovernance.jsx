import React, { useState } from 'react';
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
} from '../../utils/financeConstants.js';
import BudgetForm from '../BudgetForm/BudgetForm.jsx';
import styles from './FundGovernance.module.css';
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
    recordTransaction,
    reverseTransaction,
    cleanLegacyTestRecords,
    refreshFinanceData,
    loading,
    budgets,
    statistics,
  } = useFinance();
  const { currentUser, userName, userRole } = useAuth();
  const { canEditFinance } = usePermissions();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReversalModalOpen, setIsReversalModalOpen] = useState(false);
  const [selectedTxForReversal, setSelectedTxForReversal] = useState(null);
  const [reversalReason, setReversalReason] = useState('');
  const [isCleaning, setIsCleaning] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Budget Allocation Modal State (Merged Feature)
  const [isAllocationModalOpen, setIsAllocationModalOpen] = useState(false);
  const [selectedAllocationForEdit, setSelectedAllocationForEdit] = useState(null);
  const [defaultAllocationFundId, setDefaultAllocationFundId] = useState('fund_fiscal_year_budget');
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
  });

  const activeFund = fundAccounts.find((a) => a.id === txForm.fundAccountId);

  // Handlers for Budget Allocations
  const handleOpenNewAllocation = (fundId = 'fund_fiscal_year_budget') => {
    setSelectedAllocationForEdit(null);
    setDefaultAllocationFundId(fundId || 'fund_fiscal_year_budget');
    setIsAllocationModalOpen(true);
  };

  const handleEditAllocation = (budget) => {
    setSelectedAllocationForEdit(budget);
    setDefaultAllocationFundId(
      budget.fundAccountId || (budget.isFSG ? 'fund_fsg_remittance' : 'fund_fiscal_year_budget')
    );
    setIsAllocationModalOpen(true);
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
    setIsReversalModalOpen(true);
  };

  const handleConfirmReversal = async () => {
    if (!reversalReason.trim()) {
      alert('A valid reason is required to record a reversal.');
      return;
    }
    try {
      await reverseTransaction(selectedTxForReversal.id, reversalReason);
      setIsReversalModalOpen(false);
      setSelectedTxForReversal(null);
    } catch (err) {
      alert(err.message || 'Failed to reverse transaction.');
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
      });
    } catch (err) {
      setSubmitError(err.message);
    }
  };

  // Clean legacy test records
  const handleCleanLegacy = async () => {
    if (
      window.confirm(
        'Confirm deletion of all legacy test funds and budgets records? (Fresh start transition)'
      )
    ) {
      try {
        setIsCleaning(true);
        await cleanLegacyTestRecords();
        alert('All legacy test records successfully deleted.');
      } catch (err) {
        alert(err.message || 'Error clearing legacy records.');
      } finally {
        setIsCleaning(false);
      }
    }
  };

  // Allocation counts & filtered list
  const filteredBudgets = (budgets || []).filter((b) => {
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

  return (
    <div>
      {/* Action Toolbar */}
      <div className={styles.actionRow}>
        {canEditFinance && (
          <button
            type="button"
            className={styles.allocateToolbarBtn}
            onClick={() => handleOpenNewAllocation('fund_fiscal_year_budget')}
          >
            <HiPlus size={16} /> New Budget Allocation
          </button>
        )}

        {canEditFinance && (
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

        {canEditFinance && (
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={handleCleanLegacy}
            disabled={isCleaning}
          >
            <HiTrash size={16} /> {isCleaning ? 'Cleaning...' : 'Purge Legacy Test Data'}
          </button>
        )}
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

          const balanceCentavos = fund.balanceCentavos || 0;
          const allocatedCentavos = isFiscal
            ? toCentavos(statistics?.fiscalAllocated || 0)
            : isFSG
            ? toCentavos(statistics?.fsgAllocated || 0)
            : 0;
          const surplusCentavos = Math.max(0, balanceCentavos - allocatedCentavos);

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

                <div className={styles.fundBalanceLabel}>Treasury Holding</div>
                <div className={styles.fundBalance}>
                  {formatPHP(balanceCentavos, true)}
                </div>

                {/* Sub-Metrics: Allocated & Available Surplus for Appropriations Funds */}
                {(isFiscal || isFSG) && (
                  <div className={styles.fundCardSubStats}>
                    <div className={styles.fundStatRow}>
                      <span className={styles.fundStatLabel}>
                        {isFiscal ? 'Approved Allocation:' : 'FSG Sub-Allocated:'}
                      </span>
                      <span className={styles.fundStatValue}>
                        {formatPHP(allocatedCentavos, true)}
                      </span>
                    </div>
                    <div className={styles.fundStatRow}>
                      <span className={styles.fundStatLabel}>
                        {isFiscal ? 'Unallocated Surplus:' : 'Available Reserve:'}
                      </span>
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
                  <button
                    type="button"
                    className={styles.quickAllocateBtnMaroon}
                    onClick={() => handleOpenNewAllocation('fund_fiscal_year_budget')}
                  >
                    <HiPlus size={14} /> + Allocate Fiscal Budget
                  </button>
                )}

                {canEditFinance && isFSG && (
                  <button
                    type="button"
                    className={styles.quickAllocateBtnGold}
                    onClick={() => handleOpenNewAllocation('fund_fsg_remittance')}
                  >
                    <HiPlus size={14} /> + Allocate FSG Remittance
                  </button>
                )}

                {canEditFinance && (isIGF || isIGP) && (
                  <button
                    type="button"
                    className={styles.quickTxBtn}
                    onClick={() => {
                      setTxForm((prev) => ({
                        ...prev,
                        fundAccountId: fund.id,
                        expensePurpose: EXPENSE_PURPOSES.EVENT_PREPARATION_CONSUMABLES,
                      }));
                      setIsModalOpen(true);
                    }}
                  >
                    <HiReceiptTax size={14} /> Record {isIGF ? 'IGF' : 'IGP'} Flow
                  </button>
                )}

                <div className={styles.fundMeta}>
                  <span>{fund.bankAccountReference || 'General Holding'}</span>
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
            </div>

            {canEditFinance && (
              <button
                type="button"
                className={styles.allocateToolbarBtn}
                onClick={() =>
                  handleOpenNewAllocation(
                    allocFundFilter !== 'All' ? allocFundFilter : 'fund_fiscal_year_budget'
                  )
                }
              >
                <HiPlus size={16} /> New Allocation
              </button>
            )}
          </div>
        </div>

        {/* KPI Mini-Row */}
        <div className={styles.allocSummaryBar}>
          <div className={styles.allocKpiCard}>
            <span className={styles.allocKpiLabel}>Total Approved</span>
            <span className={styles.allocKpiValue}>
              {formatPHP(toCentavos(statistics?.totalAllocated || 0), true)}
            </span>
          </div>
          <div className={styles.allocKpiCard}>
            <span className={styles.allocKpiLabel}>Fiscal Budget Allotted</span>
            <span className={styles.allocKpiValueMaroon}>
              {formatPHP(toCentavos(statistics?.fiscalAllocated || 0), true)}
            </span>
          </div>
          <div className={styles.allocKpiCard}>
            <span className={styles.allocKpiLabel}>FSG Remittance Allotted</span>
            <span className={styles.allocKpiValueGold}>
              {formatPHP(toCentavos(statistics?.fsgAllocated || 0), true)}
            </span>
          </div>
          <div className={styles.allocKpiCard}>
            <span className={styles.allocKpiLabel}>Total Disbursed</span>
            <span className={styles.allocKpiValueSpent}>
              {formatPHP(toCentavos(statistics?.totalSpent || 0), true)}
            </span>
          </div>
          <div className={styles.allocKpiCard}>
            <span className={styles.allocKpiLabel}>Remaining Available</span>
            <span className={styles.allocKpiValueRemaining}>
              {formatPHP(
                toCentavos((statistics?.totalAllocated || 0) - (statistics?.totalSpent || 0)),
                true
              )}
            </span>
          </div>
        </div>

        {/* Allocations Table */}
        {filteredBudgets.length === 0 ? (
          <div className={styles.emptyAllocationsBox}>
            <p className={styles.emptyAllocText}>
              {allocFundFilter === 'All'
                ? 'No budget allocations created yet. Create an approved appropriation to fund activities and post event expenses.'
                : `No budget allocations found under ${
                    allocFundFilter === 'fund_fsg_remittance' ? 'FSG Remittance' : 'Fiscal Year Budget'
                  }.`}
            </p>
            {canEditFinance && (
              <button
                type="button"
                className={styles.allocateToolbarBtn}
                onClick={() =>
                  handleOpenNewAllocation(
                    allocFundFilter !== 'All' ? allocFundFilter : 'fund_fiscal_year_budget'
                  )
                }
              >
                <HiPlus size={16} /> Create First Allocation
              </button>
            )}
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
                  {canEditFinance && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredBudgets.map((b) => {
                  const isFSG = b.fundAccountId === 'fund_fsg_remittance' || b.isFSG;
                  return (
                    <tr key={b.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary, #0f172a)' }}>
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
                        <span
                          className={`${styles.statusPill} ${
                            b.status === 'On Track'
                              ? styles.statusPosted
                              : b.status === 'Over Budget'
                              ? styles.statusReversed
                              : styles.statusPending
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      {canEditFinance && (
                        <td>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'nowrap' }}>
                            <button
                              type="button"
                              className={styles.postExpenseBtn}
                              title="Post Expense against this Allocation"
                              onClick={() => handleOpenTxForAllocation(b)}
                            >
                              Post Expense
                            </button>
                            <button
                              type="button"
                              className={styles.editAllocBtn}
                              title="Edit Allocation"
                              onClick={() => handleEditAllocation(b)}
                            >
                              <HiPencil size={13} />
                            </button>
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
            {transactions.length} immutable entries recorded
          </span>
        </div>

        {transactions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
            No transactions posted yet. Post a receipt, collection, or authorized expense to build the ledger.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.ledgerTable}>
              <thead>
                <tr>
                  <th>Ref #</th>
                  <th>Date</th>
                  <th>Fund Source</th>
                  <th>Type &amp; Purpose</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Status</th>
                  {canEditFinance && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const isOutflow =
                    tx.transactionType === TRANSACTION_TYPES.EXPENSE ||
                    tx.transactionType === TRANSACTION_TYPES.PAYMENT ||
                    tx.transactionType === TRANSACTION_TYPES.REFUND;

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
                      {canEditFinance && (
                        <td>
                          {tx.status === TRANSACTION_STATUSES.POSTED && (
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
                    <option value={TRANSACTION_TYPES.EXPENSE}>Expense / Disbursement</option>
                    <option value={TRANSACTION_TYPES.RECEIPT}>Fund Receipt / Deposit</option>
                    <option value={TRANSACTION_TYPES.COLLECTION}>Sales Collection</option>
                    <option value={TRANSACTION_TYPES.REFUND}>Refund</option>
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
      {isReversalModalOpen && selectedTxForReversal && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalContent} style={{ maxWidth: '450px' }}>
            <h3
              style={{
                margin: 0,
                fontSize: '1.2rem',
                fontWeight: 600,
                color: '#dc2626',
              }}
            >
              Authorize Transaction Reversal
            </h3>
            <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.5rem' }}>
              Posted transactions cannot be deleted. This action will create a linked compensating
              entry and adjust the fund balance.
            </p>

            <div
              style={{
                margin: '1rem 0',
                padding: '0.75rem',
                background: '#f8fafc',
                borderRadius: '8px',
              }}
            >
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                {selectedTxForReversal.refNumber}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#334155' }}>
                {formatPHP(selectedTxForReversal.amountCentavos, true)} -{' '}
                {selectedTxForReversal.description}
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Reversal Reason &amp; Justification *</label>
              <textarea
                rows="3"
                className={styles.formTextarea}
                placeholder="State why this transaction is being reversed..."
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
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
                onClick={() => setIsReversalModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={handleConfirmReversal}
              >
                Execute Reversal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merged Budget Allocation Modal (BudgetForm) */}
      {isAllocationModalOpen && (
        <div
          className={styles.modalBackdrop}
          onClick={() => {
            setIsAllocationModalOpen(false);
            setSelectedAllocationForEdit(null);
          }}
        >
          <div className={styles.modalLarge} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={() => {
                setIsAllocationModalOpen(false);
                setSelectedAllocationForEdit(null);
              }}
              aria-label="Close Allocation Modal"
            >
              <HiX size={22} />
            </button>
            <BudgetForm
              editingBudget={selectedAllocationForEdit}
              defaultFundAccountId={defaultAllocationFundId}
              onSuccess={() => {
                setIsAllocationModalOpen(false);
                setSelectedAllocationForEdit(null);
                refreshFinanceData();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default FundGovernance;
