import React, { useState } from 'react';
import BudgetManager from '../BudgetManager/BudgetManagement.jsx';
import BudgetAnalytics from '../BudgetAnalytics/BudgetAnalytics.jsx';
import BudgetForm from '../BudgetForm/BudgetForm.jsx';
import usePermissions from '../../hooks/usePermissions.js';
import { 
  BarChart3, 
  PlusCircle, 
  FileSpreadsheet, 
  ShieldAlert, 
  Sparkles,
  PieChart,
  Wallet
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import styles from './FinanceDashboard.module.css';

/**
 * @component
 * @description Financial Control Center with tabbed navigation:
 * - Budget Details & Analytics (BudgetAnalytics)
 * - New Budget Allocation (BudgetForm)
 * - Manage Budget Logs (BudgetManager)
 *
 * Access levels:
 *  - admin / finance_secretary: full access (analytics, allocation form, and log manager)
 *  - secretary / view-only: analytics tab only
 */
const FinanceDashboard = () => {
  const { canEditFinance } = usePermissions();
  const { theme } = useTheme();
  const isClassic = theme === 'dark';
  const [activeTab, setActiveTab] = useState('analytics'); // 'analytics' | 'allocation' | 'logs'

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
          Visualize fiscal telemetry, allocate institutional funds, and audit real-time budgetary transactions.
        </p>
      </header>

      {/* Tab Navigation Surface */}
      <nav className={styles.tabNavigation} aria-label="Financial Control Center Tabs">
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'analytics' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          <BarChart3 size={17} className={styles.tabIcon} />
          <span className={styles.tabLabel}>Budget Details & Analytics</span>
        </button>

        {canEditFinance && (
          <>
            <button
              type="button"
              className={`${styles.tabButton} ${activeTab === 'allocation' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('allocation')}
            >
              <PlusCircle size={17} className={styles.tabIcon} />
              <span className={styles.tabLabel}>New Budget Allocation</span>
            </button>

            <button
              type="button"
              className={`${styles.tabButton} ${activeTab === 'logs' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              <FileSpreadsheet size={17} className={styles.tabIcon} />
              <span className={styles.tabLabel}>Manage Budget Logs</span>
            </button>
          </>
        )}
      </nav>

      {/* Tab Content Panes */}
      <main className={styles.tabContentArea}>
        {activeTab === 'analytics' && (
          <section className={styles.tabPane} key="analytics">
            <BudgetAnalytics />
          </section>
        )}

        {canEditFinance && activeTab === 'allocation' && (
          <section className={styles.tabPane} key="allocation">
            <BudgetForm onSuccess={() => setActiveTab('logs')} />
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