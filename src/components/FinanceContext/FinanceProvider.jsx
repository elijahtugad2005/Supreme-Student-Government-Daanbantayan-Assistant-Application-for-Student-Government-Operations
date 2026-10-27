// context/FinanceContext.jsx
import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext/AuthContext';
import financeService from '../../services/financeService';
import {
  TOP_LEVEL_FUNDS,
  TOP_LEVEL_FUND_LABELS,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
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

    // Map budgetAllocations to legacy budget format
    const legacyBudgets = allocations.map((alloc) => {
      const allocated = fromCentavos(alloc.approvedAmountCentavos || 0);
      const spent = fromCentavos(alloc.spentAmountCentavos || 0);
      const remaining = Math.max(0, allocated - spent);
      let status = 'On Track';
      if (spent >= allocated) status = 'Fully Spent';
      else if (spent > allocated * 0.8) status = 'Almost Spent';

      const fund = accounts.find((a) => a.id === alloc.fundAccountId);
      const isFSG = alloc.fundAccountId === 'fund_fsg_remittance';

      return {
        id: alloc.id,
        eventName: alloc.activityName || 'Unnamed Allocation',
        allocated,
        spent,
        remaining,
        category: alloc.category || 'Event',
        committee: alloc.committee || 'General',
        resolution: alloc.resolutionRef || '',
        description: alloc.description || '',
        receiptUrl: (alloc.supportingDocumentIds && alloc.supportingDocumentIds[0]) || '',
        status,
        fiscalYear: alloc.fiscalYear || new Date().getFullYear(),
        fundAccountId: alloc.fundAccountId || 'fund_fiscal_year_budget',
        fundName: fund ? fund.displayName : (isFSG ? 'FSG Remittance & Supplemental Fund' : 'SSG Fiscal Year Budget'),
        fundCategory: fund ? fund.topLevelCategory : (isFSG ? TOP_LEVEL_FUNDS.FSG_REMITTANCE : TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET),
        isFSG,
        createdAt: alloc.createdAt?.toDate?.() || new Date(),
        raw: alloc,
      };
    });

    setBudgets(legacyBudgets);

    // Compute stats
    let totalAlloc = 0;
    let totalSp = 0;
    let fiscalAllocated = 0;
    let fiscalSpent = 0;
    let fsgAllocated = 0;
    let fsgSpent = 0;
    const catMap = {};
    const comMap = {};

    legacyBudgets.forEach((b) => {
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

    setStatistics({
      totalAllocated: totalAlloc,
      totalSpent: totalSp,
      totalRemaining: Math.max(0, totalAlloc - totalSp),
      fiscalAllocated,
      fiscalSpent,
      fiscalRemaining: Math.max(0, fiscalAllocated - fiscalSpent),
      fsgAllocated,
      fsgSpent,
      fsgRemaining: Math.max(0, fsgAllocated - fsgSpent),
      budgetCount: legacyBudgets.length,
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
          committee: budgetData.committee || 'General',
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
      await financeService.updateBudgetAllocation(id, budgetData, user);
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

    // Backward-compatible properties & operations
    budgets,
    funds,
    statistics,
    loading,
    error,
    addBudget,
    updateBudget,
    deleteBudget,
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