import React, { useMemo, useState } from 'react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
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
  HiCheckCircle
} from 'react-icons/hi';

const BudgetAnalytics = () => {
  const { budgets, statistics, loading, fetchBudgets } = useFinance();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCommittee, setFilterCommittee] = useState('All');

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
                            budget.resolution?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCommittee = filterCommittee === 'All' || budget.committee === filterCommittee;
      return matchesSearch && matchesCommittee;
    });
  }, [budgets, searchTerm, filterCommittee]);

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

  // Chart Colors
  const COLORS = ['#3b82f6', '#10b981', '#E66B3D', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

  if (loading) {
    return (
        <div className={styles.loadingContainer}>
            <div className={styles.spinner}></div>
            <p style={{marginLeft: '10px'}}>Loading financial data...</p>
        </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h2>
            <HiChartBar style={{marginRight: '0.5rem', verticalAlign: 'middle'}} />
            Financial Dashboard
          </h2>
          <p style={{color: '#ffffffff', margin: '5px 0 0 0'}}>Overview of fiscal year allocations</p>
        </div>
        <div style={{display: 'flex', gap: '10px'}}>
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
          <HiCurrencyDollar style={{fontSize: '2rem', color: '#3b82f6', marginBottom: '0.5rem'}} />
          <span className={styles.statLabel}>Total Allocated</span>
          <span className={styles.statValue} style={{color: '#3b82f6'}}>
            {formatCurrency(statistics.totalAllocated)}
          </span>
          <span className={styles.statTrend}>
            {statistics.budgetCount} total budgets created
          </span>
        </div>
        <div className={styles.statCard}>
          <HiTrendingUp style={{fontSize: '2rem', color: '#ef4444', marginBottom: '0.5rem'}} />
          <span className={styles.statLabel}>Total Spent</span>
          <span className={styles.statValue} style={{color: '#ef4444'}}>
             {formatCurrency(statistics.totalSpent)}
          </span>
          <div style={{ width: '100%', height: '6px', background: '#f1f5f9', borderRadius: '4px', marginTop: '5px', overflow: 'hidden' }}>
             <div style={{ width: `${(statistics.totalSpent / statistics.totalAllocated) * 100}%`, height: '100%', background: '#ef4444' }}></div>
          </div>
        </div>
        <div className={styles.statCard}>
          <HiCheckCircle style={{fontSize: '2rem', color: '#10b981', marginBottom: '0.5rem'}} />
          <span className={styles.statLabel}>Remaining Funds</span>
          <span className={styles.statValue} style={{color: '#10b981'}}>
             {formatCurrency(statistics.totalRemaining)}
          </span>
          <span className={`${styles.statTrend} ${styles.trendGood}`}>
             Available for future events
          </span>
        </div>
      </div>

      {/* Charts Section */}
      <div className={styles.chartsGrid}>
        {/* Bar Chart */}
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Allocated vs. Spent (by Category)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={categoryChartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} tickFormatter={(val) => `₱${val/1000}k`} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                formatter={(value) => formatCurrency(value)}
              />
              <Legend />
              <Bar dataKey="allocated" name="Allocated" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="spent" name="Spent" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie Chart */}
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Budget Distribution (by Committee)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={committeePieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
              >
                {committeePieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatCurrency(value)} />
              <Legend verticalAlign="bottom" height={36}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sheets / Data Table Section */}
      <div className={styles.sheetSection}>
        <div className={styles.sheetHeader}>
          <h3 className={styles.chartTitle} style={{margin: 0}}>Budget Details</h3>
          <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
            <div style={{position: 'relative'}}>
                <HiSearch size={16} style={{position: 'absolute', left: '12px', top: '12px', color: '#94a3b8'}} />
                <input 
                    type="text" 
                    placeholder="Search event or resolution..." 
                    className={styles.searchBar}
                    style={{paddingLeft: '35px'}}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <select 
                className={styles.searchBar} 
                style={{width: 'auto'}}
                value={filterCommittee}
                onChange={(e) => setFilterCommittee(e.target.value)}
            >
                <option value="All">All Committees</option>
                <option value="General">General</option>
                <option value="Executive Board">Executive Board</option>
                <option value="Finance Committee">Finance Committee</option>
                {/* Add other committees as needed */}
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
              </tr>
            </thead>
            <tbody>
              {filteredBudgets.length > 0 ? (
                filteredBudgets.map((budget) => (
                  <tr key={budget.id}>
                    <td>
                        <div style={{fontWeight: '600'}}>{budget.eventName}</div>
                        <div style={{fontSize: '0.8rem', color: '#94a3b8'}}>{budget.resolution}</div>
                    </td>
                    <td>{budget.committee}</td>
                    <td style={{fontWeight: '600'}}>{formatCurrency(budget.allocated)}</td>
                    <td style={{color: '#64748b'}}>{formatCurrency(budget.spent)}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${getStatusClass(budget.status)}`}>
                        {budget.status}
                      </span>
                    </td>
                    <td>{budget.createdAt ? new Date(budget.createdAt).toLocaleDateString() : '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" style={{textAlign: 'center', padding: '3rem', color: '#94a3b8'}}>
                    No budget records found.
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