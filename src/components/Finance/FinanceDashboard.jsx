import React from 'react';
import BudgetManager from '../BudgetManager/BudgetManagement.jsx';
import BudgetAnalytics from '../BudgetAnalytics/BudgetAnalytics.jsx';
import styles from './FinanceDashboard.module.css';
import BudgetForm from '../BudgetForm/BudgetForm.jsx';
import usePermissions from '../../hooks/usePermissions.js';

/**
 * @component
 * @description Combines Budget Analytics and Budget Management into a single,
 * cohesive Finance dashboard view for easy integration into App.jsx routes.
 *
 * Access levels:
 *  - admin / finance_secretary: full access (view + edit)
 *  - secretary: view-only (analytics only, no form or manager)
 */
const FinanceDashboard = () => {
  const { canEditFinance } = usePermissions();

  return (
    <div className={styles.financeDashboardContainer}>
      <header className={styles.dashboardHeader}>
        <h1 className={styles.mainTitle}>Financial Control Center</h1>
        <p className={styles.subtitle}>
          Visualize, manage, and audit all organizational budget allocations.
        </p>
        {!canEditFinance && (
          <span style={{
            display: 'inline-block',
            marginTop: '0.5rem',
            padding: '0.2rem 0.75rem',
            background: 'rgba(255,200,0,0.15)',
            border: '1px solid rgba(255,200,0,0.4)',
            borderRadius: '999px',
            color: '#f5c400',
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.05em'
          }}>
            👁 View Only
          </span>
        )}
      </header>

      {/* Analytics — visible to everyone with finance access */}
      <section className={styles.analyticsSection}>
        <BudgetAnalytics />
      </section>

      {/* Edit controls — only for admin and finance_secretary */}
      {canEditFinance && (
        <>
          <section className={styles.formSection}>
            <BudgetForm />
          </section>

          <section className={styles.managerSection}>
            <BudgetManager />
          </section>
        </>
      )}
    </div>
  );
};

export default FinanceDashboard;