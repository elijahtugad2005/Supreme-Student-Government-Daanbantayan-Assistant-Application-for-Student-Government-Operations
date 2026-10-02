// services/financeAuditService.js
// PURPOSE: Audit trail service specifically for finance operations
// FEATURES:
//   - Track budget creation, updates, deletions
//   - Track finance dashboard interactions
//   - Log user actions with names instead of UIDs
//   - Integrate with main audit trail

import { db } from '../firebase/firebaseConfig.js';
import { 
  collection, 
  doc, 
  setDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import userManagementService from './userManagementService.js';

// Collection references
const AUDIT_LOGS_COLLECTION = 'audit_logs';

/**
 * Finance Audit Service
 */
export const financeAuditService = {
  
  /**
   * Log budget creation
   * @param {string} userId - User who created the budget
   * @param {Object} budgetData - Budget data that was created
   * @returns {Promise<void>}
   */
  async logBudgetCreation(userId, budgetData) {
    try {
      await userManagementService.logAuditAction(
        'budget_created',
        userId,
        null,
        {
          before: null,
          after: {
            id: budgetData.id,
            title: budgetData.title,
            amount: budgetData.amount,
            category: budgetData.category,
            description: budgetData.description
          }
        },
        {
          module: 'Finance',
          itemType: 'Budget',
          itemId: budgetData.id,
          itemName: budgetData.title,
          notes: `Created budget "${budgetData.title}" with amount $${budgetData.amount}`
        }
      );
    } catch (error) {
      console.error('Error logging budget creation:', error);
    }
  },

  /**
   * Log budget update
   * @param {string} userId - User who updated the budget
   * @param {string} budgetId - ID of the budget
   * @param {Object} oldData - Previous budget data
   * @param {Object} newData - Updated budget data
   * @returns {Promise<void>}
   */
  async logBudgetUpdate(userId, budgetId, oldData, newData) {
    try {
      await userManagementService.logAuditAction(
        'budget_updated',
        userId,
        null,
        {
          before: oldData,
          after: newData
        },
        {
          module: 'Finance',
          itemType: 'Budget',
          itemId: budgetId,
          itemName: newData.title || oldData.title,
          notes: `Updated budget "${newData.title || oldData.title}"`
        }
      );
    } catch (error) {
      console.error('Error logging budget update:', error);
    }
  },

  /**
   * Log budget deletion
   * @param {string} userId - User who deleted the budget
   * @param {Object} budgetData - Budget data that was deleted
   * @returns {Promise<void>}
   */
  async logBudgetDeletion(userId, budgetData) {
    try {
      await userManagementService.logAuditAction(
        'budget_deleted',
        userId,
        null,
        {
          before: budgetData,
          after: null
        },
        {
          module: 'Finance',
          itemType: 'Budget',
          itemId: budgetData.id,
          itemName: budgetData.title,
          notes: `Deleted budget "${budgetData.title}" (Amount: $${budgetData.amount})`
        }
      );
    } catch (error) {
      console.error('Error logging budget deletion:', error);
    }
  },

  /**
   * Log expense creation
   * @param {string} userId - User who created the expense
   * @param {Object} expenseData - Expense data that was created
   * @returns {Promise<void>}
   */
  async logExpenseCreation(userId, expenseData) {
    try {
      await userManagementService.logAuditAction(
        'expense_created',
        userId,
        null,
        {
          before: null,
          after: {
            id: expenseData.id,
            title: expenseData.title,
            amount: expenseData.amount,
            category: expenseData.category,
            description: expenseData.description,
            date: expenseData.date
          }
        },
        {
          module: 'Finance',
          itemType: 'Expense',
          itemId: expenseData.id,
          itemName: expenseData.title,
          notes: `Created expense "${expenseData.title}" with amount $${expenseData.amount}`
        }
      );
    } catch (error) {
      console.error('Error logging expense creation:', error);
    }
  },

  /**
   * Log expense update
   * @param {string} userId - User who updated the expense
   * @param {string} expenseId - ID of the expense
   * @param {Object} oldData - Previous expense data
   * @param {Object} newData - Updated expense data
   * @returns {Promise<void>}
   */
  async logExpenseUpdate(userId, expenseId, oldData, newData) {
    try {
      await userManagementService.logAuditAction(
        'expense_updated',
        userId,
        null,
        {
          before: oldData,
          after: newData
        },
        {
          module: 'Finance',
          itemType: 'Expense',
          itemId: expenseId,
          itemName: newData.title || oldData.title,
          notes: `Updated expense "${newData.title || oldData.title}"`
        }
      );
    } catch (error) {
      console.error('Error logging expense update:', error);
    }
  },

  /**
   * Log expense deletion
   * @param {string} userId - User who deleted the expense
   * @param {Object} expenseData - Expense data that was deleted
   * @returns {Promise<void>}
   */
  async logExpenseDeletion(userId, expenseData) {
    try {
      await userManagementService.logAuditAction(
        'expense_deleted',
        userId,
        null,
        {
          before: expenseData,
          after: null
        },
        {
          module: 'Finance',
          itemType: 'Expense',
          itemId: expenseData.id,
          itemName: expenseData.title,
          notes: `Deleted expense "${expenseData.title}" (Amount: $${expenseData.amount})`
        }
      );
    } catch (error) {
      console.error('Error logging expense deletion:', error);
    }
  },

  /**
   * Log revenue/income creation
   * @param {string} userId - User who created the income
   * @param {Object} incomeData - Income data that was created
   * @returns {Promise<void>}
   */
  async logIncomeCreation(userId, incomeData) {
    try {
      await userManagementService.logAuditAction(
        'income_created',
        userId,
        null,
        {
          before: null,
          after: {
            id: incomeData.id,
            title: incomeData.title,
            amount: incomeData.amount,
            source: incomeData.source,
            description: incomeData.description,
            date: incomeData.date
          }
        },
        {
          module: 'Finance',
          itemType: 'Income',
          itemId: incomeData.id,
          itemName: incomeData.title,
          notes: `Created income "${incomeData.title}" with amount $${incomeData.amount}`
        }
      );
    } catch (error) {
      console.error('Error logging income creation:', error);
    }
  },

  /**
   * Log financial report generation
   * @param {string} userId - User who generated the report
   * @param {Object} reportParams - Report parameters
   * @returns {Promise<void>}
   */
  async logReportGeneration(userId, reportParams) {
    try {
      await userManagementService.logAuditAction(
        'financial_report_generated',
        userId,
        null,
        {
          before: null,
          after: reportParams
        },
        {
          module: 'Finance',
          itemType: 'Report',
          itemId: reportParams.reportId,
          itemName: reportParams.reportType,
          notes: `Generated ${reportParams.reportType} report for period ${reportParams.startDate} to ${reportParams.endDate}`
        }
      );
    } catch (error) {
      console.error('Error logging report generation:', error);
    }
  },

  /**
   * Log data export from finance module
   * @param {string} userId - User who exported data
   * @param {Object} exportParams - Export parameters
   * @returns {Promise<void>}
   */
  async logDataExport(userId, exportParams) {
    try {
      await userManagementService.logAuditAction(
        'financial_data_exported',
        userId,
        null,
        {
          before: null,
          after: exportParams
        },
        {
          module: 'Finance',
          itemType: 'Export',
          itemId: exportParams.exportId || new Date().toISOString(),
          itemName: exportParams.exportType,
          notes: `Exported ${exportParams.dataType} data (${exportParams.recordCount} records) as ${exportParams.format}`
        }
      );
    } catch (error) {
      console.error('Error logging data export:', error);
    }
  },

  /**
   * Log bulk operations in finance
   * @param {string} userId - User who performed bulk operation
   * @param {string} operation - Type of bulk operation
   * @param {Array} items - Items affected by bulk operation
   * @returns {Promise<void>}
   */
  async logBulkOperation(userId, operation, items) {
    try {
      await userManagementService.logAuditAction(
        `bulk_${operation}`,
        userId,
        null,
        {
          before: null,
          after: {
            operation,
            itemCount: items.length,
            items: items.slice(0, 10) // Log first 10 items to avoid huge logs
          }
        },
        {
          module: 'Finance',
          itemType: 'Bulk Operation',
          itemId: new Date().toISOString(),
          itemName: `${operation} (${items.length} items)`,
          notes: `Performed bulk ${operation} on ${items.length} finance items`
        }
      );
    } catch (error) {
      console.error('Error logging bulk operation:', error);
    }
  }
};

export default financeAuditService;