import React, { useMemo, useState } from 'react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import styles from './BudgetAnalytics.module.css';
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
  HiX,
  HiClipboardCopy,
  HiCheck,
  HiEye
} from 'react-icons/hi';

const BudgetAnalytics = () => {
  const { budgets, statistics, loading, fetchBudgets } = useFinance();
  const { theme, isLight } = useTheme();
  const isClassic = theme === 'dark';
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCommittee, setFilterCommittee] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [copiedId, setCopiedId] = useState(null);
  const [activeChartTab, setActiveChartTab] = useState('both'); // 'both' | 'category' | 'committee'

  // --- Data Processing for Charts ---
  
  // 1. Prepare Data for Bar Chart (Budget vs Spent by Category)
  const categoryChartData = useMemo(() => {
    if (!budgets.length) return [];
    
    // Group by category
    const grouped = budgets.reduce((acc, curr) => {
      const cat = curr.category || 'Uncategorized';
      if (!acc[cat]) acc[cat] = { name: cat, allocated: 0, spent: 0 };
      acc[cat].allocated += parseFloat(curr.allocated) || 0;
      acc[cat].spent += parseFloat(curr.spent) || 0;
      return acc;
    }, {});

    return Object.values(grouped).sort((a, b) => b.allocated - a.allocated);
  }, [budgets]);

  // 2. Prepare Data for Pie Chart (Distribution by Committee)
  const committeePieData = useMemo(() => {
    if (!budgets.length) return [];

    const grouped = budgets.reduce((acc, curr) => {
      const com = curr.committee || 'General';
      if (!acc[com]) acc[com] = { name: com, value: 0 };
      acc[com].value += parseFloat(curr.allocated) || 0;
      return acc;
    }, {});

    return Object.values(grouped);
  }, [budgets]);

  // --- Filter Logic for Sheet ---
  const filteredBudgets = useMemo(() => {
    return budgets.filter(budget => {
      const matchesSearch = budget.eventName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            budget.resolution?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            budget.category?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCommittee = filterCommittee === 'All' || budget.committee === filterCommittee;
      const matchesStatus = filterStatus === 'All' || budget.status === filterStatus;
      return matchesSearch && matchesCommittee && matchesStatus;
    });
  }, [budgets, searchTerm, filterCommittee, filterStatus]);

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
    const text = `Project: ${budget.eventName} (${budget.resolution || 'N/A'})\nCommittee: ${budget.committee}\nAllocated: ${formatCurrency(budget.allocated)}\nSpent: ${formatCurrency(budget.spent)}\nRemaining: ${formatCurrency(budget.remaining)}\nStatus: ${budget.status}`;
    navigator.clipboard.writeText(text);
    setCopiedId(budget.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const exportToCSV = () => {
    const headers = ['Event Name', 'Category', 'Committee', 'Allocated', 'Spent', 'Remaining', 'Status'];
    const csvContent = [
      headers.join(','),
      ...filteredBudgets.map(b => [
        `"${b.eventName}"`,
        b.category,
        b.committee,
        b.allocated,
        b.spent,
        b.remaining,
        b.status
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Budget_Report_${new Date().toLocaleDateString()}.csv`;
    link.click();
  };
  // Chart Colors (Adaptive: Light mode has Swiss Industrial high contrast; Classic Mode has rich imperial gold and royal maroon)
  const COLORS = useMemo(() => {
    if (isLight) {
      return ['#0A0A0A', '#E61919', '#2563EB', '#16A34A', '#D97706', '#9333EA', '#0891B2'];
    }
    if (isClassic) {
      return ['#D4AF37', '#9E1B29', '#E5B842', '#7A121D', '#F59E0B', '#C93B2B', '#E2D06D'];
    }
    return ['#D94F1F', '#F59E0B', '#3B82F6', '#10B981', '#EC4899', '#8B5CF6', '#06B6D4'];
  }, [isLight, isClassic]);

  if (loading) {
    return (
        <div className={styles.loadingContainer}>
            <div className={styles.spinner}></div>
            <p style={{marginLeft: '10px'}}>Loading financial data...</p>
        </div>
    );
  }

  return (
    <div className={`${styles.container} ${isClassic ? styles.analyticsClassic : ''}`}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h2>
            <HiChartBar style={{marginRight: '0.5rem', verticalAlign: 'middle'}} />
            {isClassic ? 'Institutional Treasury Telemetry' : 'Financial Dashboard'}
          </h2>
          <p className={styles.headerSubtitle}>Overview of fiscal year allocations, budget velocity, and expenditure</p>
        </div>
        <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
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
          <HiCurrencyDollar style={{fontSize: '2rem', color: isLight ? '#0a0a0a' : '#3b82f6', marginBottom: '0.5rem'}} />
          <span className={styles.statLabel}>Total Allocated</span>
          <span className={styles.statValue}>
            {formatCurrency(statistics.totalAllocated)}
          </span>
          <span className={styles.statTrend}>
            {statistics.budgetCount} total budgets created
          </span>
        </div>
        <div className={styles.statCard}>
          <HiTrendingUp style={{fontSize: '2rem', color: isLight ? '#e61919' : '#ef4444', marginBottom: '0.5rem'}} />
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
          <HiCheckCircle style={{fontSize: '2rem', color: isLight ? '#166534' : '#10b981', marginBottom: '0.5rem'}} />
          <span className={styles.statLabel}>Remaining Funds</span>
          <span className={styles.statValue}>
             {formatCurrency(statistics.totalRemaining)}
          </span>
          <span className={`${styles.statTrend} ${styles.trendGood}`}>
             Available for future events
          </span>
        </div>
      </div>

      {/* QoL Chart Mode Controls */}
      <div className={styles.chartControlsBar}>
        <div className={styles.chartControlLabel}>VISUALIZATION ENGINE:</div>
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

      {/* Charts Section */}
      <div className={styles.chartsGrid}>
        {/* Bar Chart */}
        {(activeChartTab === 'both' || activeChartTab === 'category') && (
          <div className={`${styles.chartCard} ${activeChartTab === 'category' ? styles.chartCardFull : ''}`}>
            <div className={styles.chartHeaderBlock}>
              <h3 className={styles.chartTitle}>Allocated vs. Spent (by Category)</h3>
              <span className={styles.chartMetaTag}>FIG 01.1 // METRIC: PHP</span>
            </div>
            <ResponsiveContainer width="100%" height="88%">
              <BarChart
                data={categoryChartData}
                margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
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
                />
                <YAxis 
                  stroke={isLight ? "#64748b" : "#9ca3af"} 
                  fontSize={11} 
                  tickLine={false} 
                  tickFormatter={(val) => `₱${val/1000}k`} 
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
                    textTransform: 'uppercase' 
                  }} 
                />
                <Bar 
                  dataKey="allocated" 
                  name="Allocated" 
                  fill={isLight ? "#0a0a0a" : isClassic ? "#D4AF37" : "#D94F1F"} 
                  radius={isLight ? [0, 0, 0, 0] : [6, 6, 0, 0]} 
                />
                <Bar 
                  dataKey="spent" 
                  name="Spent" 
                  fill={isLight ? "#e61919" : isClassic ? "#9E1B29" : "#F59E0B"} 
                  radius={isLight ? [0, 0, 0, 0] : [6, 6, 0, 0]} 
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Pie Chart */}
        {(activeChartTab === 'both' || activeChartTab === 'committee') && (
          <div className={`${styles.chartCard} ${activeChartTab === 'committee' ? styles.chartCardFull : ''}`}>
            <div className={styles.chartHeaderBlock}>
              <h3 className={styles.chartTitle}>Budget Distribution (by Committee)</h3>
              <span className={styles.chartMetaTag}>FIG 01.2 // SHARE: RATIO</span>
            </div>
            <ResponsiveContainer width="100%" height="88%">
              <PieChart>
                <Pie
                  data={committeePieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={isLight ? 4 : 5}
                  dataKey="value"
                  stroke={isLight ? "#0a0a0a" : "#252525"}
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
                <Legend 
                  verticalAlign="bottom" 
                  height={36} 
                  wrapperStyle={{ 
                    fontFamily: isLight ? 'JetBrains Mono, monospace' : 'inherit', 
                    fontSize: '11px', 
                    textTransform: 'uppercase' 
                  }} 
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Sheets / Data Table Section */}
      <div className={styles.sheetSection}>
        <div className={styles.sheetHeader}>
          <div>
            <h3 className={styles.chartTitle} style={{margin: 0}}>Audit Registry & Ledger</h3>
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
                value={filterCommittee}
                onChange={(e) => setFilterCommittee(e.target.value)}
            >
                <option value="All">All Committees</option>
                <option value="General">General</option>
                <option value="Executive Board">Executive Board</option>
                <option value="Finance Committee">Finance Committee</option>
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
                <th style={{textAlign: 'center'}}>QoL Quick Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredBudgets.length > 0 ? (
                filteredBudgets.map((budget) => (
                  <tr key={budget.id}>
                    <td>
                        <div className={styles.projectName}>{budget.eventName}</div>
                        <div className={styles.projectResolution}>{budget.resolution || 'RES-NONE'}</div>
                    </td>
                    <td>
                      <span className={styles.committeeBadge}>{budget.committee}</span>
                    </td>
                    <td className={styles.monoSums}>{formatCurrency(budget.allocated)}</td>
                    <td className={styles.monoSpent}>{formatCurrency(budget.spent)}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${getStatusClass(budget.status)}`}>
                        {budget.status}
                      </span>
                    </td>
                    <td className={styles.monoDate}>{budget.createdAt ? new Date(budget.createdAt).toLocaleDateString() : '-'}</td>
                    <td style={{textAlign: 'center'}}>
                      <button 
                        type="button"
                        className={styles.copyRowBtn}
                        onClick={() => copyBudgetDetails(budget)}
                        title="Copy row breakdown to clipboard"
                      >
                        {copiedId === budget.id ? (
                          <>
                            <HiCheck size={14} style={{color: '#16a34a'}} />
                            <span style={{color: '#16a34a'}}>COPIED</span>
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
                ))
              ) : (
                <tr>
                  <td colSpan="7" className={styles.emptyTableTd}>
                    <p>NO BUDGET RECORDS MATCH ACTIVE FILTERS.</p>
                    <button 
                      type="button" 
                      className={styles.resetFiltersBtn}
                      onClick={() => { setSearchTerm(''); setFilterCommittee('All'); setFilterStatus('All'); }}
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