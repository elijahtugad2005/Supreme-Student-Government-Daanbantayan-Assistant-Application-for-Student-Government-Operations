// context/FinanceContext.jsx
import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext/AuthContext';
import financeService from '../../services/financeService';
import {
  TOP_LEVEL_FUNDS,
  TOP_LEVEL_FUND_LABELS,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  PROCUREMENT_TYPES,
  PROCUREMENT_TYPE_LABELS,
  PPMP_STATUSES,
  PPMP_STATUS_CONFIG,
  getPPMPStatus,
  getUtilizationRate,
  toCentavos,
  fromCentavos,
  formatPHP,
} from '../../utils/financeConstants';

const FinanceContext = createContext();

export const useFinance = () => {
  const context = useContext(FinanceContext);
  if (!context) {
    throw new Error('useFinance must be used within FinanceProvider');
  }
  return context;
};

export const FinanceProvider = ({ children }) => {
  const { userRole, userName, currentUser } = useAuth();

  // Redesigned Core State
  const [fundAccounts, setFundAccounts] = useState([]);
  const [budgetAllocations, setBudgetAllocations] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [preOrderBatches, setPreOrderBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Backward-compatibility state for legacy views (BudgetAnalytics, etc.)
  const [budgets, setBudgets] = useState([]);
  const [archivedBudgets, setArchivedBudgets] = useState([]);
  const [funds, setFunds] = useState({
    annualBudget: 0,
    incomeGenerated: 0,
    totalFunds: 0,
    lastUpdated: null,
  });
  const [statistics, setStatistics] = useState({
    totalAllocated: 0,
    totalSpent: 0,
    totalRemaining: 0,
    budgetCount: 0,
    categories: {},
    committees: {},
  });

  // Calculate legacy compatible projections from allocations & fundAccounts
  const computeProjections = useCallback((accounts, allocations) => {
    let fiscalBalance = 0;
    let igfBalance = 0;
    let igpBalance = 0;
    let fsgBalance = 0;

    accounts.forEach((acc) => {
      const bal = fromCentavos(acc.balanceCentavos || 0);
      if (acc.topLevelCategory === TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET) fiscalBalance += bal;
      else if (acc.topLevelCategory === TOP_LEVEL_FUNDS.FSG_REMITTANCE) fsgBalance += bal;
      else if (acc.topLevelCategory === TOP_LEVEL_FUNDS.IGF) igfBalance += bal;
      else if (acc.topLevelCategory === TOP_LEVEL_FUNDS.IGP) igpBalance += bal;
    });

    const totalFunds = fiscalBalance + fsgBalance + igfBalance + igpBalance;

    setFunds({
      annualBudget: fiscalBalance,
      incomeGenerated: igfBalance + igpBalance,
      fsgRemittance: fsgBalance,
      totalFunds,
      lastUpdated: new Date(),
    });

    // Map budgetAllocations to legacy budget format with PPMP lifecycle status
    const allMappedBudgets = allocations.map((alloc) => {
      const approvedCentavos = alloc.approvedAmountCentavos !== undefined
        ? Number(alloc.approvedAmountCentavos)
        : toCentavos(alloc.allocated || alloc.allocatedAmount || 0);
      const spentCentavos = alloc.spentAmountCentavos !== undefined
        ? Number(alloc.spentAmountCentavos)
        : toCentavos(alloc.spent || alloc.spentAmount || 0);
      const allocated = fromCentavos(approvedCentavos);
      const spent = fromCentavos(spentCentavos);
      const remaining = Math.max(0, allocated - spent);
      const ppmpStatus = getPPMPStatus(spentCentavos, approvedCentavos);
      const utilizationRate = getUtilizationRate(spentCentavos, approvedCentavos);
      const isArchived = alloc.status === 'archived' || alloc.isActive === false;

      const fund = accounts.find((a) => a.id === alloc.fundAccountId);
      const isFSG = alloc.fundAccountId === 'fund_fsg_remittance';

      const determinedProcurementType =
        alloc.procurementType ||
        (alloc.category === 'Project'
          ? PROCUREMENT_TYPES.PROJECT
          : ['Supplies', 'Printing', 'Equipment', 'Material'].includes(alloc.category)
          ? PROCUREMENT_TYPES.MATERIAL_SUPPLY
          : PROCUREMENT_TYPES.EVENT);

      // Process sub-line items with status
      const mappedLineItems = (alloc.approvedLineItems || []).map((li, idx) => {
        const itemPlannedCentavos =
          li.plannedCentavos !== undefined
            ? Number(li.plannedCentavos)
            : toCentavos(li.plannedAmount || li.estimatedCost || 0);
        const itemSpentCentavos = Number(li.spentCentavos || 0);
        return {
          ...li,
          id: li.id || `line_${idx}`,
          name: li.name || li.title || li.description || `Item ${idx + 1}`,
          plannedAmount: fromCentavos(itemPlannedCentavos),
          spentAmount: fromCentavos(itemSpentCentavos),
          plannedCentavos: itemPlannedCentavos,
          spentCentavos: itemSpentCentavos,
          status: getPPMPStatus(itemSpentCentavos, itemPlannedCentavos),
          utilizationRate: getUtilizationRate(itemSpentCentavos, itemPlannedCentavos),
        };
      });

      return {
        id: alloc.id,
        eventName: alloc.activityName || 'Unnamed Allocation',
        activityName: alloc.activityName || 'Unnamed Allocation',
        allocated,
        spent,
        remaining,
        category: alloc.category || 'Event',
        procurementType: determinedProcurementType,
        committee: alloc.committee || 'General',
        resolution: alloc.resolutionRef || '',
        description: alloc.description || '',
        receiptUrl: (alloc.supportingDocumentIds && alloc.supportingDocumentIds[0]) || '',
        status: alloc.status || 'approved',
        isArchived,
        isActive: alloc.isActive !== false && alloc.status !== 'archived',
        ppmpStatus,
        utilizationRate,
        approvedLineItems: mappedLineItems,
        fiscalYear: alloc.fiscalYear || new Date().getFullYear(),
        fundAccountId: alloc.fundAccountId || 'fund_fiscal_year_budget',
        fundName: fund ? fund.displayName : (isFSG ? 'FSG Remittance & Supplemental Fund' : 'SSG Fiscal Year Budget'),
        fundCategory: fund ? fund.topLevelCategory : (isFSG ? TOP_LEVEL_FUNDS.FSG_REMITTANCE : TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET),
        isFSG,
        createdAt: alloc.createdAt?.toDate?.() || new Date(),
        archivedAt: alloc.archivedAt?.toDate?.() || null,
        archivedBy: alloc.archivedBy || null,
        raw: alloc,
      };
    });

    // Segregate active non-archived budgets from archived ones
    const activeBudgets = allMappedBudgets.filter((b) => !b.isArchived);
    const archivedList = allMappedBudgets.filter((b) => b.isArchived);

    setBudgets(activeBudgets);
    setArchivedBudgets(archivedList);

    // Compute stats on active allocations only
    let totalAlloc = 0;
    let totalSp = 0;
    let fiscalAllocated = 0;
    let fiscalSpent = 0;
    let fsgAllocated = 0;
    let fsgSpent = 0;
    const catMap = {};
    const comMap = {};

    activeBudgets.forEach((b) => {
      totalAlloc += b.allocated;
      totalSp += b.spent;
      if (b.isFSG) {
        fsgAllocated += b.allocated;
        fsgSpent += b.spent;
      } else {
        fiscalAllocated += b.allocated;
        fiscalSpent += b.spent;
      }
      catMap[b.category] = (catMap[b.category] || 0) + b.allocated;
      comMap[b.committee] = (comMap[b.committee] || 0) + b.allocated;
    });

    const fiscalAcc = accounts.find((a) => a.id === 'fund_fiscal_year_budget');
    const fiscalCeiling = fromCentavos(fiscalAcc?.appropriatedCeilingCentavos || 0);
    const fiscalHolding = fromCentavos(fiscalAcc?.balanceCentavos || 0);

    setStatistics({
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
      budgetCount: activeBudgets.length,
      categories: catMap,
      committees: comMap,
    });
  }, []);

  // Fetch all redesigned data
  const refreshFinanceData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Ensure default 4 fund accounts exist
      await financeService.ensureDefaultFundAccounts(currentUser?.uid, userName);

      const [accounts, allocations, txList, batches] = await Promise.all([
        financeService.getFundAccounts(),
        financeService.getBudgetAllocations(),
        financeService.getTransactions(100),
        financeService.getPreOrderBatches(),
      ]);

      setFundAccounts(accounts);
      setBudgetAllocations(allocations);
      setTransactions(txList);
      setPreOrderBatches(batches);

      computeProjections(accounts, allocations);
    } catch (err) {
      console.error('Error refreshing finance data:', err);
      setError('Failed to load financial records. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.uid, userName, computeProjections]);

  // Initial load
  useEffect(() => {
    refreshFinanceData();
  }, [refreshFinanceData]);

  // Add a budget allocation
  const addBudget = async (budgetData) => {
    try {
      const user = { uid: currentUser?.uid || 'anon', userName, userRole };
      // Map to budget allocation schema
      const allocId = await financeService.createBudgetAllocation(
        {
          fundAccountId: budgetData.fundAccountId || 'fund_fiscal_year_budget',
          activityName: budgetData.eventName || budgetData.activityName,
          fiscalYear: budgetData.fiscalYear || new Date().getFullYear(),
          approvedAmount: budgetData.allocatedAmount || budgetData.allocated || 0,
          resolutionRef: budgetData.resolution || '',
          category: budgetData.category || 'Event',
          procurementType: budgetData.procurementType,
          committee: budgetData.committee || 'General',
          status: budgetData.status || 'approved',
          approvedLineItems: budgetData.approvedLineItems || [],
          supportingDocumentIds: budgetData.receiptUrl ? [budgetData.receiptUrl] : [],
        },
        user
      );

      // If initial spent amount was specified, record transaction
      const initialSpent = Number(budgetData.spentAmount || budgetData.spent || 0);
      if (initialSpent > 0) {
        await financeService.recordTransaction(
          {
            fundAccountId: budgetData.fundAccountId || 'fund_fiscal_year_budget',
            transactionType: TRANSACTION_TYPES.EXPENSE,
            expensePurpose: 'Event Itemized Expense',
            amount: initialSpent,
            budgetAllocationId: allocId,
            resolutionRef: budgetData.resolution || '',
            description: `Initial recorded expense for ${budgetData.eventName}`,
            status: TRANSACTION_STATUSES.POSTED,
          },
          user
        );
      }

      await refreshFinanceData();
      return allocId;
    } catch (err) {
      console.error('Error adding budget allocation:', err);
      setError(err.message || 'Failed to add budget allocation.');
      throw err;
    }
  };

  // Update a budget allocation
  const updateBudget = async (id, budgetData) => {
    try {
      const user = { uid: currentUser?.uid || 'anon', userName, userRole };
      await financeService.updateBudgetAllocation(
        id,
        {
          ...budgetData,
          status: budgetData.status,
        },
        user
      );
      await refreshFinanceData();
      return id;
    } catch (err) {
      console.error('Error updating budget allocation:', err);
      setError(err.message || 'Failed to update budget allocation.');
      throw err;
    }
  };

  // Delete a budget allocation
  const deleteBudget = async (id) => {
    try {
      const user = { uid: currentUser?.uid || 'anon', userName, userRole };
      await financeService.deleteBudgetAllocation(id, user);
      await refreshFinanceData();
      return id;
    } catch (err) {
      console.error('Error deleting budget allocation:', err);
      setError(err.message || 'Failed to delete budget allocation.');
      throw err;
    }
  };

  // Restore an archived budget allocation
  const restoreBudget = async (id) => {
    try {
      const user = { uid: currentUser?.uid || 'anon', userName, userRole };
      await financeService.restoreBudgetAllocation(id, user);
      await refreshFinanceData();
      return id;
    } catch (err) {
      console.error('Error restoring budget allocation:', err);
      setError(err.message || 'Failed to restore budget allocation.');
      throw err;
    }
  };

  // Record a transaction
  const recordTransaction = async (txData) => {
    try {
      const user = { uid: currentUser?.uid || 'anon', userName, userRole };
      const res = await financeService.recordTransaction(txData, user);
      await refreshFinanceData();
      return res;
    } catch (err) {
      console.error('Error recording transaction:', err);
      throw err;
    }
  };

  // Reverse transaction
  const reverseTransaction = async (txId, reason) => {
    try {
      const user = { uid: currentUser?.uid || 'anon', userName, userRole };
      const res = await financeService.reverseTransaction(txId, reason, user);
      await refreshFinanceData();
      return res;
    } catch (err) {
      console.error('Error reversing transaction:', err);
      throw err;
    }
  };

  // Clean legacy test records helper
  const cleanLegacyTestRecords = async () => {
    try {
      const res = await financeService.cleanLegacyTestRecords();
      await refreshFinanceData();
      return res;
    } catch (err) {
      console.error('Error cleaning legacy records:', err);
      throw err;
    }
  };

  // Update Fiscal Budget (serves as unified primary balance and PPMP ceiling)
  const updateFiscalBudget = async (budgetData) => {
    try {
      const user = { uid: currentUser?.uid || 'anon', userName, userRole };
      await financeService.updateFiscalBudget('fund_fiscal_year_budget', budgetData, user);
      await refreshFinanceData();
      return true;
    } catch (err) {
      console.error('Error updating fiscal budget in provider:', err);
      throw err;
    }
  };

  // Update Fund Balance (for non-fiscal funds e.g. FSG, IGF, IGP)
  const updateFundBalance = async (fundAccountId, balanceAmount, reason) => {
    try {
      const user = { uid: currentUser?.uid || 'anon', userName, userRole };
      await financeService.updateFundBalance(fundAccountId, balanceAmount, user, reason);
      await refreshFinanceData();
      return true;
    } catch (err) {
      console.error('Error updating fund balance in provider:', err);
      throw err;
    }
  };

  // Backward-compatible wrappers
  const updateFiscalCeiling = async (ceilingData) => {
    return updateFiscalBudget(ceilingData);
  };

  const updateFundHoldingBalance = async (fundAccountId, balanceAmount, reason) => {
    return updateFundBalance(fundAccountId, balanceAmount, reason);
  };

  const value = {
    // Redesigned entities
    fundAccounts,
    budgetAllocations,
    transactions,
    preOrderBatches,
    refreshFinanceData,
    recordTransaction,
    reverseTransaction,
    cleanLegacyTestRecords,
    updateFiscalBudget,
    updateFundBalance,
    updateFiscalCeiling,
    updateFundHoldingBalance,

    // Helpers & Enums
    getPPMPStatus,
    getUtilizationRate,
    PPMP_STATUSES,
    PPMP_STATUS_CONFIG,
    PROCUREMENT_TYPES,
    PROCUREMENT_TYPE_LABELS,

    // Backward-compatible properties & operations
    budgets,
    archivedBudgets,
    funds,
    statistics,
    loading,
    error,
    addBudget,
    updateBudget,
    deleteBudget,
    restoreBudget,
    fetchBudgets: refreshFinanceData,
    fetchFunds: refreshFinanceData,
    getFundUtilizationPercentage: () => {
      if (!funds.totalFunds) return 0;
      return (statistics.totalAllocated / funds.totalFunds) * 100;
    },
    getAvailableFunds: () => {
      return funds.totalFunds - statistics.totalAllocated;
    },
  };

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
};

export default { FinanceContext };