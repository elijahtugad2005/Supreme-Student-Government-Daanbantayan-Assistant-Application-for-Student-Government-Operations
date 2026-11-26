import React, { useMemo, useState } from 'react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import {
  FUND_DOMAINS,
  isBudgetFSG,
  isBudgetIGF,
  isBudgetIGP,
  isBudgetPPMP,
} from '../../utils/fundClassifier.js';
import {
  deriveBudgetHealthStatus,
  filterAnalyticsBudgets,
  extractUniqueCommittees,
  buildBudgetCsvContent,
  buildCsvFilename,
  buildIgpEnterpriseChartData,
  buildIgfEnterpriseChartData,
  rollupTopChartBuckets,
} from '../../utils/budgetAnalyticsHelpers.js';
import styles from './BudgetAnalytics.module.css';
import EventExpenseCalendar from './EventExpenseCalendar.jsx';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import {
  HiDownload,
  HiRefresh,
  HiFilter,
  HiSearch,
  HiCurrencyDollar,
  HiTrendingUp,
  HiChartBar,
  HiCheckCircle,
  HiShoppingBag,
  HiArchive,
  HiX,
  HiClipboardCopy,
  HiCheck,
  HiEye
} from 'react-icons/hi';

const BudgetAnalytics = () => {
  const { budgets, statistics, transactions = [], igpCollections = [], loading, fetchBudgets } = useFinance();
  const { theme, isLight } = useTheme();
  const isClassic = theme === 'dark';
  const [searchTerm, setSearchTerm] = useState('');
  const [filterFund, setFilterFund] = useState('All');
  const [filterCommittee, setFilterCommittee] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [copiedId, setCopiedId] = useState(null);
  const [activeChartTab, setActiveChartTab] = useState('both'); // 'both' | 'category' | 'committee'
  const [chartFundDomain, setChartFundDomain] = useState(FUND_DOMAINS.ALL); // 'ALL' | 'PPMP' | 'IGF' | 'IGP'

  // --- Data Processing for Charts ---

  // 1. Prepare Data for Bar Chart (Budget vs Spent by Category, filtered by Fund Domain)
  const categoryChartData = useMemo(() => {
    const scopedBudgets = budgets.filter((b) => {
      if (chartFundDomain === FUND_DOMAINS.ALL) return true;
      if (chartFundDomain === FUND_DOMAINS.PPMP) return isBudgetPPMP(b);
      if (chartFundDomain === FUND_DOMAINS.IGF) return isBudgetIGF(b);
      if (chartFundDomain === FUND_DOMAINS.IGP) return isBudgetIGP(b);
      return true;
    });

    if (!scopedBudgets.length) {
      if (chartFundDomain === FUND_DOMAINS.IGP) {
        return buildIgpEnterpriseChartData(igpCollections);
      }
      if (chartFundDomain === FUND_DOMAINS.IGF) {
        return buildIgfEnterpriseChartData(transactions);
      }
      return [];
    }

    // Group by category
    const grouped = scopedBudgets.reduce((acc, curr) => {
      const cat = curr.category || 'Uncategorized';
      if (!acc[cat]) acc[cat] = { name: cat, allocated: 0, spent: 0 };
      acc[cat].allocated += parseFloat(curr.allocated) || 0;
      acc[cat].spent += parseFloat(curr.spent) || 0;
      return acc;
    }, {});

    return rollupTopChartBuckets(Object.values(grouped), 7);
  }, [budgets, chartFundDomain, igpCollections, transactions]);

  // 2. Prepare Data for Pie Chart (Distribution by Committee / Initiative, filtered by Fund Domain)
  const committeePieData = useMemo(() => {
    const scopedBudgets = budgets.filter((b) => {
      if (chartFundDomain === FUND_DOMAINS.ALL) return true;
      if (chartFundDomain === FUND_DOMAINS.PPMP) return isBudgetPPMP(b);
      if (chartFundDomain === FUND_DOMAINS.IGF) return isBudgetIGF(b);
      if (chartFundDomain === FUND_DOMAINS.IGP) return isBudgetIGP(b);
      return true;
    });

    if (!scopedBudgets.length) {
      if (chartFundDomain === FUND_DOMAINS.IGP) {
        return buildIgpEnterpriseChartData(igpCollections);
      }
      if (chartFundDomain === FUND_DOMAINS.IGF) {
        return buildIgfEnterpriseChartData(transactions);
      }
      return [];
    }

    const grouped = scopedBudgets.reduce((acc, curr) => {
      const com = curr.committee || 'General';
      if (!acc[com]) acc[com] = { name: com, value: 0 };
      acc[com].value += parseFloat(curr.allocated) || 0;
      return acc;
    }, {});

    return rollupTopChartBuckets(Object.values(grouped), 7);
  }, [budgets, chartFundDomain, igpCollections, transactions]);

  const pieTotalValue = useMemo(
    () => committeePieData.reduce((sum, item) => sum + (Number(item?.value) || 0), 0),
    [committeePieData]
  );

  const isEnterpriseDomain =
    chartFundDomain === FUND_DOMAINS.IGF || chartFundDomain === FUND_DOMAINS.IGP;

  const formatAxisCurrency = (val) => {
    const num = Number(val) || 0;
    if (num >= 1000) {
      const k = num / 1000;
      return `₱${Number.isInteger(k) ? k : k.toFixed(1)}k`;
    }
    return `₱${num}`;
  };

  const truncateAxisLabel = (label) => {
    const text = String(label || '');
    return text.length > 15 ? `${text.slice(0, 14)}…` : text;
  };

  const committeeOptions = useMemo(() => extractUniqueCommittees(budgets), [budgets]);

  // --- Filter Logic for Sheet ---
  const filteredBudgets = useMemo(
    () =>
      filterAnalyticsBudgets(budgets, {
        searchTerm,
        filterFund,
        filterCommittee,
        filterStatus,
      }),
    [budgets, searchTerm, filterCommittee, filterStatus, filterFund]
  );

  // --- Helpers ---
  const formatCurrency = (val) => `₱${(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  const getStatusClass = (status) => {
    switch (status) {
      case 'On Track': return styles.statusGreen;
      case 'Fully Spent': return styles.statusBlue;
      case 'Over Budget': return styles.statusRed;
      case 'Almost Spent': return styles.statusYellow;
      default: return styles.statusGray;
    }
  };

  const copyBudgetDetails = (budget) => {
    const healthStatus = deriveBudgetHealthStatus(budget);
    const text = `Project: ${budget.eventName} (${budget.resolution || 'N/A'})\nFund Source: ${budget.fundName || (isBudgetFSG(budget) ? 'FSG Remittance' : 'Fiscal Year Budget')}\nCommittee: ${budget.committee}\nAllocated: ${formatCurrency(budget.allocated)}\nSpent: ${formatCurrency(budget.spent)}\nRemaining: ${formatCurrency(budget.remaining)}\nStatus: ${healthStatus}`;
    navigator.clipboard.writeText(text);
    setCopiedId(budget.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const exportToCSV = () => {
    const csvContent = buildBudgetCsvContent(filteredBudgets);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildCsvFilename(new Date());
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // Chart Colors (Adaptive: Light mode has Swiss Industrial high contrast; Classic Mode has rich imperial gold and royal maroon)
  const COLORS = useMemo(() => {
    if (isLight) {
      return ['#0A0A0A', '#E61919', '#2563EB', '#16A34A', '#D97706', '#9333EA', '#0891B2', '#64748B'];
    }
    if (isClassic) {
      return ['#D4AF37', '#9E1B29', '#E5B842', '#7A121D', '#F59E0B', '#C93B2B', '#E2D06D', '#8B7355'];
    }
    return ['#D94F1F', '#F59E0B', '#3B82F6', '#10B981', '#EC4899', '#8B5CF6', '#06B6D4', '#64748B'];
  }, [isLight, isClassic]);

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p style={{ marginLeft: '10px' }}>Loading financial data...</p>
      </div>
    );
  }

  return (
    <div className={`${styles.container} ${isClassic ? styles.analyticsClassic : ''}`}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h2>
            <HiChartBar style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
            {isClassic ? 'Institutional Treasury Telemetry' : 'Financial Dashboard'}
          </h2>
          <p className={styles.headerSubtitle}>Overview of fiscal year allocations, budget velocity, and expenditure</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={fetchBudgets} className={styles.refreshButton}>
            <HiRefresh size={18} /> Refresh
          </button>
          <button onClick={exportToCSV} className={styles.refreshButton}>
            <HiDownload size={18} /> Export CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <HiCurrencyDollar style={{ fontSize: '2rem', color: isLight ? '#0a0a0a' : '#3b82f6', marginBottom: '0.5rem' }} />
          <span className={styles.statLabel}>Total Allocated</span>
          <span className={styles.statValue}>
            {formatCurrency(statistics.totalAllocated)}
          </span>
          <span className={styles.statTrend}>
            {statistics.budgetCount} total budgets created
          </span>
        </div>
        <div className={styles.statCard}>
          <HiCurrencyDollar style={{ fontSize: '2rem', color: isLight ? '#8b1524' : '#f87171', marginBottom: '0.5rem' }} />
          <span className={styles.statLabel}>Fiscal Year Budget Alloc</span>
          <span className={styles.statValue}>
            {formatCurrency(statistics.fiscalAllocated || 0)}
          </span>
          <span className={styles.statTrend}>
            Annual Institutional Appropriations
          </span>
        </div>
        <div className={styles.statCard}>
          <HiCurrencyDollar style={{ fontSize: '2rem', color: '#d4af37', marginBottom: '0.5rem' }} />
          <span className={styles.statLabel}>FSG Remittance Alloc</span>
          <span className={styles.statValue} style={{ color: '#d4af37' }}>
            {formatCurrency(statistics.fsgAllocated || 0)}
          </span>
          <span className={styles.statTrend}>
            Federation Remittance & Backup
          </span>
        </div>
        <div className={styles.statCard}>
          <HiTrendingUp style={{ fontSize: '2rem', color: isLight ? '#e61919' : '#ef4444', marginBottom: '0.5rem' }} />
          <span className={styles.statLabel}>Total Spent</span>
          <span className={styles.statValue}>
            {formatCurrency(statistics.totalSpent)}
          </span>
          <div className={styles.velocityProgressWrapper}>
            <div
              className={styles.velocityProgressBar}
              style={{ width: `${Math.min(100, (statistics.totalSpent / (statistics.totalAllocated || 1)) * 100)}%` }}
            ></div>
          </div>
        </div>
        <div className={styles.statCard}>
          <HiCheckCircle style={{ fontSize: '2rem', color: isLight ? '#166534' : '#10b981', marginBottom: '0.5rem' }} />
          <span className={styles.statLabel}>Remaining Funds</span>
          <span className={styles.statValue}>
            {formatCurrency(statistics.totalRemaining)}
          </span>
          <span className={`${styles.statTrend} ${styles.trendGood}`}>
            Available for future events
          </span>
        </div>
        <div className={styles.statCard}>
          <HiShoppingBag style={{ fontSize: '2rem', color: isLight ? '#2563eb' : '#60a5fa', marginBottom: '0.5rem' }} />
          <span className={styles.statLabel}>IGF Merchandise Balance</span>
          <span className={styles.statValue} style={{ color: isLight ? '#1d4ed8' : '#93c5fd' }}>
            {formatCurrency(statistics.igfBalance || 0)}
          </span>
          <span className={styles.statTrend}>
            Income Generated Funds (Lanyards & Uniforms)
          </span>
        </div>
        <div className={styles.statCard}>
          <HiArchive style={{ fontSize: '2rem', color: isLight ? '#d97706' : '#fbbf24', marginBottom: '0.5rem' }} />
          <span className={styles.statLabel}>IGP Projects Balance</span>
          <span className={styles.statValue} style={{ color: isLight ? '#b45309' : '#fcd34d' }}>
            {formatCurrency(statistics.igpBalance || 0)}
          </span>
          <span className={styles.statTrend}>
            Vending Machines & Campus Lockers
          </span>
        </div>
      </div>

      {/* QoL Chart Mode & Fund Domain Controls */}
      <div className={styles.chartControlsBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div className={styles.chartControlLabel}>FUND DOMAIN:</div>
          <div className={styles.chartToggleGroup}>
            <button
              type="button"
              className={`${styles.chartToggleBtn} ${chartFundDomain === 'ALL' ? styles.chartToggleActive : ''}`}
              onClick={() => setChartFundDomain('ALL')}
            >
              [ALL FUNDS]
            </button>
            <button
              type="button"
              className={`${styles.chartToggleBtn} ${chartFundDomain === 'PPMP' ? styles.chartToggleActive : ''}`}
              onClick={() => setChartFundDomain('PPMP')}
            >
              [PPMP / FISCAL]
            </button>
            <button
              type="button"
              className={`${styles.chartToggleBtn} ${chartFundDomain === 'IGF' ? styles.chartToggleActive : ''}`}
              onClick={() => setChartFundDomain('IGF')}
            >
              [IGF MERCHANDISE]
            </button>
            <button
              type="button"
              className={`${styles.chartToggleBtn} ${chartFundDomain === 'IGP' ? styles.chartToggleActive : ''}`}
              onClick={() => setChartFundDomain('IGP')}
            >
              [IGP ENTERPRISES]
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div className={styles.chartControlLabel}>VIEW:</div>
          <div className={styles.chartToggleGroup}>
            <button
              type="button"
              className={`${styles.chartToggleBtn} ${activeChartTab === 'both' ? styles.chartToggleActive : ''}`}
              onClick={() => setActiveChartTab('both')}
            >
              [01] DUAL GAUGES
            </button>
            <button
              type="button"
              className={`${styles.chartToggleBtn} ${activeChartTab === 'category' ? styles.chartToggleActive : ''}`}
              onClick={() => setActiveChartTab('category')}
            >
              [02] CATEGORY BAR
            </button>
            <button
              type="button"
              className={`${styles.chartToggleBtn} ${activeChartTab === 'committee' ? styles.chartToggleActive : ''}`}
              onClick={() => setActiveChartTab('committee')}
            >
              [03] COMMITTEE PIE
            </button>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className={styles.chartsGrid}>
        {/* Bar Chart */}
        {(activeChartTab === 'both' || activeChartTab === 'category') && (
          <div className={`${styles.chartCard} ${activeChartTab === 'category' ? styles.chartCardFull : ''}`}>
            <div className={styles.chartHeaderBlock}>
              <h3 className={styles.chartTitle}>
                {isEnterpriseDomain ? 'Revenue vs. Expenses' : 'Allocated vs. Spent'}{' '}
                {chartFundDomain !== 'ALL' ? `(${chartFundDomain})` : '(All Funds)'}
              </h3>
              <span className={styles.chartMetaTag}>FIG 01.1 // METRIC: PHP</span>
            </div>
            {categoryChartData.length === 0 ? (
              <div className={styles.chartEmptyState}>
                No recorded {chartFundDomain !== 'ALL' ? `${chartFundDomain} ` : ''}entries to chart yet.
              </div>
            ) : (
              <div className={styles.chartBody}>
                <ResponsiveContainer width="100%" height={315}>
                  <BarChart
                    data={categoryChartData}
                    margin={{ top: 10, right: 16, left: 6, bottom: 10 }}
                    maxBarSize={44}
                  >
                    <CartesianGrid
                      strokeDasharray={isLight ? "2 2" : "3 3"}
                      vertical={false}
                      stroke={isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.08)"}
                    />
                    <XAxis
                      dataKey="name"
                      stroke={isLight ? "#64748b" : "#9ca3af"}
                      fontSize={11}
                      tickLine={false}
                      interval={0}
                      tickFormatter={truncateAxisLabel}
                    />
                    <YAxis
                      stroke={isLight ? "#64748b" : "#9ca3af"}
                      fontSize={11}
                      tickLine={false}
                      tickFormatter={formatAxisCurrency}
                    />
                    <Tooltip
                      contentStyle={isLight ? {
                        borderRadius: '0px',
                        border: '2px solid #0a0a0a',
                        boxShadow: '3px 3px 0px #0a0a0a',
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '12px',
                        background: '#ffffff',
                        color: '#0a0a0a'
                      } : isClassic ? {
                        borderRadius: '10px',
                        border: '1px solid rgba(212, 175, 55, 0.45)',
                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 0 15px rgba(122, 18, 29, 0.3)',
                        background: '#190507',
                        color: '#ffea9f',
                        padding: '10px 14px'
                      } : {
                        borderRadius: '10px',
                        border: '1px solid rgba(217, 79, 31, 0.45)',
                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                        background: '#252525',
                        color: '#ffffff',
                        padding: '10px 14px'
                      }}
                      itemStyle={{
                        color: isLight ? '#0a0a0a' : isClassic ? '#fff6e5' : '#ffffff',
                        fontSize: '12px',
                        fontWeight: 600,
                        padding: '2px 0'
                      }}
                      labelStyle={{
                        color: isLight ? '#0a0a0a' : isClassic ? '#ffea9f' : '#f5f5dc',
                        fontWeight: 700,
                        marginBottom: '4px',
                        fontSize: '13px'
                      }}
                      formatter={(value) => formatCurrency(value)}
                    />
                    <Legend
                      wrapperStyle={{
                        fontFamily: isLight ? 'JetBrains Mono, monospace' : 'inherit',
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        paddingTop: '6px'
                      }}
                    />
                    <Bar
                      dataKey="allocated"
                      name={isEnterpriseDomain ? 'Inflows' : 'Allocated'}
                      fill={isLight ? "#0a0a0a" : isClassic ? "#D4AF37" : "#D94F1F"}
                      radius={isLight ? [0, 0, 0, 0] : [6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="spent"
                      name={isEnterpriseDomain ? 'Expenses' : 'Spent'}
                      fill={isLight ? "#e61919" : isClassic ? "#9E1B29" : "#F59E0B"}
                      radius={isLight ? [0, 0, 0, 0] : [6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Pie Chart */}
        {(activeChartTab === 'both' || activeChartTab === 'committee') && (
          <div className={`${styles.chartCard} ${activeChartTab === 'committee' ? styles.chartCardFull : ''}`}>
            <div className={styles.chartHeaderBlock}>
              <h3 className={styles.chartTitle}>
                {isEnterpriseDomain ? 'Fund Breakdown' : 'Budget Distribution'}{' '}
                {chartFundDomain !== 'ALL' ? `(${chartFundDomain})` : '(All Funds)'}
              </h3>
              <span className={styles.chartMetaTag}>FIG 01.2 // SHARE: RATIO</span>
            </div>
            {committeePieData.length === 0 ? (
              <div className={styles.chartEmptyState}>
                No distribution breakdown available for this domain yet.
              </div>
            ) : (
              <div className={styles.pieLayout}>
                <div className={styles.pieCanvasWrap}>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={committeePieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={92}
                        paddingAngle={committeePieData.length > 1 ? (isLight ? 3 : 4) : 0}
                        dataKey="value"
                        stroke={isLight ? "#0a0a0a" : "#190507"}
                        strokeWidth={isLight ? 2 : 1}
                      >
                        {committeePieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => formatCurrency(value)}
                        contentStyle={isLight ? {
                          borderRadius: '0px',
                          border: '2px solid #0a0a0a',
                          boxShadow: '3px 3px 0px #0a0a0a',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: '12px',
                          background: '#ffffff',
                          color: '#0a0a0a'
                        } : isClassic ? {
                          borderRadius: '10px',
                          border: '1px solid rgba(212, 175, 55, 0.45)',
                          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 0 15px rgba(122, 18, 29, 0.3)',
                          background: '#190507',
                          color: '#ffea9f',
                          padding: '10px 14px'
                        } : {
                          borderRadius: '10px',
                          border: '1px solid rgba(217, 79, 31, 0.45)',
                          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                          background: '#252525',
                          color: '#ffffff',
                          padding: '10px 14px'
                        }}
                        itemStyle={{
                          color: isLight ? '#0a0a0a' : isClassic ? '#fff6e5' : '#ffffff',
                          fontSize: '12px',
                          fontWeight: 600,
                          padding: '2px 0'
                        }}
                        labelStyle={{
                          color: isLight ? '#0a0a0a' : isClassic ? '#ffea9f' : '#f5f5dc',
                          fontWeight: 700,
                          marginBottom: '4px',
                          fontSize: '13px'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <ul className={styles.pieLegendList} aria-label="Distribution breakdown legend">
                  {committeePieData.map((entry, index) => {
                    const pct = pieTotalValue > 0 ? (entry.value / pieTotalValue) * 100 : 0;
                    return (
                      <li key={`${entry.name}-${index}`} className={styles.pieLegendRow}>
                        <span
                          className={styles.pieLegendDot}
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                          aria-hidden="true"
                        />
                        <span className={styles.pieLegendName} title={entry.name}>
                          {entry.name}
                        </span>
                        <span className={styles.pieLegendAmount}>
                          {formatCurrency(entry.value)}
                        </span>
                        <span className={styles.pieLegendPct}>{pct.toFixed(1)}%</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* PPMP Event Expense Calendar Widget */}
      <EventExpenseCalendar budgets={budgets} transactions={transactions} />

      {/* Sheets / Data Table Section */}
      <div className={styles.sheetSection}>
        <div className={styles.sheetHeader}>
          <div>
            <h3 className={styles.chartTitle} style={{ margin: 0 }}>Audit Registry & Ledger</h3>
            <span className={styles.sheetSubheading}>Showing {filteredBudgets.length} of {budgets.length} entries</span>
          </div>
          <div className={styles.filterControls}>
            <div className={styles.searchContainer}>
              <HiSearch size={16} className={styles.searchIcon} />
              <input
                type="text"
                placeholder="Filter records or resolution..."
                className={styles.searchBar}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  className={styles.clearSearchBtn}
                  onClick={() => setSearchTerm('')}
                  title="Clear search"
                >
                  <HiX size={14} />
                </button>
              )}
            </div>

            <select
              className={styles.filterSelect}
              value={filterFund}
              onChange={(e) => setFilterFund(e.target.value)}
              aria-label="Filter by Fund Source"
            >
              <option value="All">All Fund Sources</option>
              <option value="fund_fiscal_year_budget">🏛️ Fiscal Year Budget</option>
              <option value="fund_fsg_remittance">🤝 FSG Remittance</option>
              <option value="fund_igf_main">👕 Income Generated Funds (IGF)</option>
              <option value="fund_igp_main">🪙 Income-Generating Projects (IGP)</option>
            </select>

            <select
              className={styles.filterSelect}
              value={filterCommittee}
              onChange={(e) => setFilterCommittee(e.target.value)}
            >
              <option value="All">All Committees</option>
              {committeeOptions.map((committee) => (
                <option key={committee} value={committee}>{committee}</option>
              ))}
            </select>

            <select
              className={styles.filterSelect}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="All">All Statuses</option>
              <option value="On Track">On Track</option>
              <option value="Almost Spent">Almost Spent</option>
              <option value="Fully Spent">Fully Spent</option>
              <option value="Over Budget">Over Budget</option>
              <option value="Draft">Draft</option>
            </select>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Event / Project</th>
                <th>Committee</th>
                <th>Allocated</th>
                <th>Spent</th>
                <th>Status</th>
                <th>Date</th>
                <th style={{ textAlign: 'center' }}>QoL Quick Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredBudgets.length > 0 ? (
                filteredBudgets.map((budget) => {
                  const isFSGBudget = isBudgetFSG(budget);
                  const healthStatus = deriveBudgetHealthStatus(budget);
                  return (
                    <tr key={budget.id}>
                      <td>
                        <div className={styles.projectName}>{budget.eventName}</div>
                        <div className={styles.projectResolution}>
                          {budget.resolution || 'RES-NONE'} •{' '}
                          <span style={{
                            color: budget.fundCategory === 'IGF' || budget.fundAccountId === 'fund_igf_main'
                              ? '#10b981'
                              : budget.fundCategory === 'IGP' || budget.fundAccountId === 'fund_igp_main'
                                ? '#f59e0b'
                                : isFSGBudget
                                  ? '#eab308'
                                  : '#3b82f6',
                            fontWeight: 700,
                            fontSize: '0.78rem'
                          }}>
                            {budget.fundCategory === 'IGF' || budget.fundAccountId === 'fund_igf_main'
                              ? '👕 Income Generated Funds (IGF)'
                              : budget.fundCategory === 'IGP' || budget.fundAccountId === 'fund_igp_main'
                                ? '🪙 Income-Generating Projects (IGP)'
                                : isFSGBudget
                                  ? '🤝 FSG Remittance'
                                  : '🏛️ Fiscal Budget'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={styles.committeeBadge}>{budget.committee}</span>
                      </td>
                      <td className={styles.monoSums}>{formatCurrency(budget.allocated)}</td>
                      <td className={styles.monoSpent}>{formatCurrency(budget.spent)}</td>
                      <td>
                        <span className={`${styles.statusBadge} ${getStatusClass(healthStatus)}`}>
                          {healthStatus}
                        </span>
                      </td>
                      <td className={styles.monoDate}>{budget.createdAt ? new Date(budget.createdAt).toLocaleDateString() : '-'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className={styles.copyRowBtn}
                          onClick={() => copyBudgetDetails(budget)}
                          title="Copy row breakdown to clipboard"
                        >
                          {copiedId === budget.id ? (
                            <>
                              <HiCheck size={14} style={{ color: '#16a34a' }} />
                              <span style={{ color: '#16a34a' }}>COPIED</span>
                            </>
                          ) : (
                            <>
                              <HiClipboardCopy size={14} />
                              <span>COPY</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7" className={styles.emptyTableTd}>
                    <p>NO BUDGET RECORDS MATCH ACTIVE FILTERS.</p>
                    <button
                      type="button"
                      className={styles.resetFiltersBtn}
                      onClick={() => { setSearchTerm(''); setFilterFund('All'); setFilterCommittee('All'); setFilterStatus('All'); }}
                    >
                      RESET FILTERS
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BudgetAnalytics;