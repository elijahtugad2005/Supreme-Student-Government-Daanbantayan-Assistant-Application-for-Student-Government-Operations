import React, { useState } from 'react';
import BudgetManager from '../BudgetManager/BudgetManagement.jsx';
import BudgetAnalytics from '../BudgetAnalytics/BudgetAnalytics.jsx';
import FundGovernance from './FundGovernance.jsx';
import PreOrderBatchManager from './PreOrderBatchManager.jsx';
import usePermissions from '../../hooks/usePermissions.js';
import { 
  BarChart3, 
  FileSpreadsheet, 
  ShieldAlert, 
  Wallet, 
  Coins, 
  PackageCheck 
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import styles from './FinanceDashboard.module.css';

/**
 * @component
 * @description Financial Control Center with tabbed navigation:
 * - Fund Accounts, Budget Allocations & Ledger (FundGovernance)
 * - Pre-Order Procurement Batches (PreOrderBatchManager)
 * - Budget Details & Analytics (BudgetAnalytics)
 * - Manage Budget Allocations (BudgetManager)
 */
const FinanceDashboard = () => {
  const { canEditFinance } = usePermissions();
  const { theme } = useTheme();
  const isClassic = theme === 'dark';
  const [activeTab, setActiveTab] = useState('funds'); // 'funds' | 'batches' | 'analytics' | 'logs'

  return (
    <div className={`${styles.financeDashboardContainer} ${isClassic ? styles.financeClassic : ''}`}>
      {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}
      {/* Control Center Header */}
      <header className={styles.dashboardHeader}>
        <div className={styles.headerTop}>
          <div className={styles.eyebrowBadge}>
            <Wallet size={13} />
            <span>{isClassic ? 'SSG TREASURY & FISCAL GOVERNANCE' : 'Treasury & Fiscal Governance'}</span>
          </div>
          {!canEditFinance && (
            <span className={styles.viewOnlyBadge}>
              <ShieldAlert size={13} /> View-Only Mode
            </span>
          )}
        </div>

        <h1 className={styles.mainTitle}>Financial Control Center</h1>
        <p className={styles.subtitle}>
          Track institutional funds, allocate fiscal & FSG budgets, restrict disbursements by policy, manage pre-orders, and audit real-time ledger entries.
        </p>
      </header>

      {/* Tab Navigation Surface */}
      <nav className={styles.tabNavigation} aria-label="Financial Control Center Tabs">
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'funds' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('funds')}
        >
          <Coins size={17} className={styles.tabIcon} />
          <span className={styles.tabLabel}>Fund Accounts & Ledger</span>
        </button>

        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'batches' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('batches')}
        >
          <PackageCheck size={17} className={styles.tabIcon} />
          <span className={styles.tabLabel}>IGF Pre-Order Batches</span>
        </button>

        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'analytics' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          <BarChart3 size={17} className={styles.tabIcon} />
          <span className={styles.tabLabel}>Budget Details & Analytics</span>
        </button>

        {canEditFinance && (
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === 'logs' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <FileSpreadsheet size={17} className={styles.tabIcon} />
            <span className={styles.tabLabel}>Manage Budget Allocations</span>
          </button>
        )}
      </nav>

      {/* Tab Content Panes */}
      <main className={styles.tabContentArea}>
        {activeTab === 'funds' && (
          <section className={styles.tabPane} key="funds">
            <FundGovernance />
          </section>
        )}

        {activeTab === 'batches' && (
          <section className={styles.tabPane} key="batches">
            <PreOrderBatchManager />
          </section>
        )}

        {activeTab === 'analytics' && (
          <section className={styles.tabPane} key="analytics">
            <BudgetAnalytics />
          </section>
        )}

        {canEditFinance && activeTab === 'logs' && (
          <section className={styles.tabPane} key="logs">
            <BudgetManager />
          </section>
        )}
      </main>
    </div>
  );
};

export default FinanceDashboard;