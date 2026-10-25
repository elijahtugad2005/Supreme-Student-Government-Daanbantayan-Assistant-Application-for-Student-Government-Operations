import React, { useState, useMemo } from 'react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
import BudgetForm from '../BudgetForm/BudgetForm.jsx';
import financeAuditService from '../../services/financeAuditService.js';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import styles from './BudgetManager.module.css';
import { 
  HiSearch, 
  HiPencil, 
  HiTrash, 
  HiX, 
  HiExclamationCircle,
  HiFilter,
  HiSortAscending,
  HiSortDescending,
  HiCurrencyDollar,
  HiCalendar,
  HiCheckCircle,
  HiClock,
  HiDownload,
  HiChevronDown,
  HiChevronUp,
  HiExternalLink,
  HiInformationCircle,
  HiTag,
  HiUserGroup,
  HiViewGrid,
  HiViewList,
  HiDocumentText
} from 'react-icons/hi';

const BudgetManager = () => {
  const { budgets, deleteBudget, loading } = useFinance();
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const isClassic = theme === 'dark';
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterCommittee, setFilterCommittee] = useState('All');
  const [sortBy, setSortBy] = useState('date'); // 'date', 'amount', 'name', 'spent'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc', 'desc'
  const [expandedRowId, setExpandedRowId] = useState(null);
  
  // State for Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState(null);
  
  // State for Delete Confirmation Modal
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, budget: null });
  const [isDeleting, setIsDeleting] = useState(false);

  // Extract unique categories & committees for filter pills
  const categoriesList = useMemo(() => {
    const set = new Set();
    budgets.forEach(b => { if (b.category) set.add(b.category); });
    return Array.from(set).sort();
  }, [budgets]);

  const committeesList = useMemo(() => {
    const set = new Set();
    budgets.forEach(b => { if (b.committee) set.add(b.committee); });
    return Array.from(set).sort();
  }, [budgets]);

  // Filter and sort budgets
  const filteredBudgets = useMemo(() => {
    let result = budgets.filter(b => {
      const q = searchTerm.toLowerCase();
      const matchesSearch = 
        (b.eventName || '').toLowerCase().includes(q) ||
        (b.resolution || '').toLowerCase().includes(q) ||
        (b.category || '').toLowerCase().includes(q) ||
        (b.committee || '').toLowerCase().includes(q) ||
        (b.description || '').toLowerCase().includes(q);
      
      const matchesStatus = filterStatus === 'All' || b.status === filterStatus;
      const matchesCategory = filterCategory === 'All' || b.category === filterCategory;
      const matchesCommittee = filterCommittee === 'All' || b.committee === filterCommittee;
      
      return matchesSearch && matchesStatus && matchesCategory && matchesCommittee;
    });

    // Sort results
    result.sort((a, b) => {
      let compareA, compareB;
      
      switch(sortBy) {
        case 'amount':
          compareA = parseFloat(a.allocated) || 0;
          compareB = parseFloat(b.allocated) || 0;
          break;
        case 'spent':
          compareA = parseFloat(a.spent) || 0;
          compareB = parseFloat(b.spent) || 0;
          break;
        case 'name':
          compareA = (a.eventName || '').toLowerCase();
          compareB = (b.eventName || '').toLowerCase();
          break;
        case 'date':
        default:
          compareA = new Date(a.createdAt || 0).getTime();
          compareB = new Date(b.createdAt || 0).getTime();
          break;
      }

      if (sortOrder === 'asc') {
        return compareA > compareB ? 1 : -1;
      } else {
        return compareA < compareB ? 1 : -1;
      }
    });

    return result;
  }, [budgets, searchTerm, filterStatus, filterCategory, filterCommittee, sortBy, sortOrder]);

  // Real-time aggregate KPIs for the current filtered view
  const aggregateMetrics = useMemo(() => {
    let totalAlloc = 0;
    let totalSpent = 0;
    let overBudgetCount = 0;

    filteredBudgets.forEach(b => {
      totalAlloc += parseFloat(b.allocated) || 0;
      totalSpent += parseFloat(b.spent) || 0;
      if (b.status === 'Over Budget') overBudgetCount++;
    });

    const remaining = totalAlloc - totalSpent;
    const burnRate = totalAlloc > 0 ? (totalSpent / totalAlloc) * 100 : 0;

    return {
      totalAlloc,
      totalSpent,
      remaining,
      burnRate,
      overBudgetCount
    };
  }, [filteredBudgets]);

  // Export filtered budgets to CSV (Quality of life)
  const handleExportCSV = () => {
    if (filteredBudgets.length === 0) return;

    const headers = [
      'ID',
      'Event / Project Title',
      'Resolution No.',
      'Category',
      'Committee',
      'Allocated (PHP)',
      'Spent (PHP)',
      'Remaining (PHP)',
      'Status',
      'Fiscal Year',
      'Receipt URL',
      'Date Created'
    ];

    const rows = filteredBudgets.map(b => [
      `"${b.id || ''}"`,
      `"${(b.eventName || '').replace(/"/g, '""')}"`,
      `"${(b.resolution || '').replace(/"/g, '""')}"`,
      `"${b.category || ''}"`,
      `"${b.committee || ''}"`,
      parseFloat(b.allocated || 0).toFixed(2),
      parseFloat(b.spent || 0).toFixed(2),
      (parseFloat(b.allocated || 0) - parseFloat(b.spent || 0)).toFixed(2),
      `"${b.status || ''}"`,
      b.fiscalYear || '',
      `"${b.receiptUrl || ''}"`,
      `"${b.createdAt ? new Date(b.createdAt).toLocaleDateString() : ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Budget_Logs_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Handlers ---

  const handleEditClick = (budget) => {
    setSelectedBudget(budget);
    setIsModalOpen(true);
  };

  const handleDeleteClick = (budget) => {
    setDeleteModal({ isOpen: true, budget });
  };

  const confirmDelete = async () => {
    if (!deleteModal.budget) return;
    
    setIsDeleting(true);
    try {
      // Log audit before deletion
      await financeAuditService.logBudgetDeletion(currentUser?.uid || 'guest', {
        id: deleteModal.budget.id,
        title: deleteModal.budget.eventName,
        amount: deleteModal.budget.allocated,
        category: deleteModal.budget.category,
        committee: deleteModal.budget.committee,
        resolution: deleteModal.budget.resolution
      });

      await deleteBudget(deleteModal.budget.id);
      setDeleteModal({ isOpen: false, budget: null });
    } catch (error) {
      console.error('Error deleting budget:', error);
      alert('Failed to delete budget. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedBudget(null);
  };

  const handleFormSuccess = () => {
    handleModalClose();
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const toggleRowExpanded = (id) => {
    setExpandedRowId(prev => prev === id ? null : id);
  };

  // Helper for status colors
  const getStatusColor = (status) => {
    switch(status) {
      case 'Over Budget': return '#fee2e2';
      case 'Fully Spent': return '#dcfce7';
      case 'Almost Spent': return '#fef9c3';
      case 'In Progress': return '#dbeafe';
      case 'On Track': return '#d1fae5';
      default: return '#f1f5f9';
    }
  };
  
  const getStatusTextColor = (status) => {
    switch(status) {
      case 'Over Budget': return '#991b1b';
      case 'Fully Spent': return '#166534';
      case 'Almost Spent': return '#854d0e';
      case 'In Progress': return '#1e40af';
      case 'On Track': return '#065f46';
      default: return '#475569';
    }
  };

  const getStatusIcon = (status) => {
    switch(status) {
      case 'Over Budget': return <HiExclamationCircle style={{marginRight: '4px'}} />;
      case 'Fully Spent': return <HiCheckCircle style={{marginRight: '4px'}} />;
      case 'Almost Spent': return <HiClock style={{marginRight: '4px'}} />;
      case 'In Progress': return <HiClock style={{marginRight: '4px'}} />;
      case 'On Track': return <HiCheckCircle style={{marginRight: '4px'}} />;
      default: return null;
    }
  };

  return (
    <div className={`${styles.container} ${isClassic ? styles.managerClassic : ''}`}>
      
      {/* Header & Quick Actions */}
      <div className={styles.header}>
        <div className={styles.title}>
          <div className={styles.titleBadge}>{isClassic ? 'SSG INSTITUTIONAL AUDIT ARCHIVE' : 'INSTITUTIONAL AUDIT ARCHIVE'}</div>
          <div className={styles.titleRow}>
            <HiCurrencyDollar className={styles.titleIcon} />
            <div>
              <h2>Manage Budget Logs</h2>
              <p className={styles.headerSubtitle}>Monitor ledger appropriations, inspect disbursements, and download ledgers</p>
            </div>
          </div>
        </div>

        {/* Global Export & Tools (QoL) */}
        <div className={styles.headerActions}>
          <button 
            type="button" 
            className={styles.exportBtn}
            onClick={handleExportCSV}
            disabled={filteredBudgets.length === 0}
            title="Export currently filtered budget logs as CSV"
          >
            <HiDownload size={16} /> Export CSV
          </button>
        </div>
      </div>

      {/* Aggregate KPI Summary Bar (Quality of Life) */}
      <div className={styles.kpiBar}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Filtered Allocations</span>
          <span className={styles.kpiValue}>₱{aggregateMetrics.totalAlloc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Actual Disbursed</span>
          <span className={styles.kpiValue}>₱{aggregateMetrics.totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Net Balance</span>
          <span className={`${styles.kpiValue} ${aggregateMetrics.remaining < 0 ? styles.kpiNegative : ''}`}>
            ₱{aggregateMetrics.remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Burn Rate</span>
          <span className={styles.kpiValue}>{aggregateMetrics.burnRate.toFixed(1)}%</span>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className={styles.filtersBar}>
        <div className={styles.searchWrapper}>
          <HiSearch className={styles.searchIcon} size={18} />
          <input 
            type="text" 
            className={styles.searchInput} 
            placeholder="Search by title, resolution, category, or notes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button 
              className={styles.clearSearch}
              onClick={() => setSearchTerm('')}
              title="Clear search"
            >
              <HiX size={16} />
            </button>
          )}
        </div>

        {/* Status Filter */}
        <div className={styles.filterGroup}>
          <HiFilter className={styles.filterIcon} />
          <select 
            className={styles.filterSelect}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            aria-label="Filter by Status"
          >
            <option value="All">All Statuses</option>
            <option value="Not Started">Not Started</option>
            <option value="On Track">On Track</option>
            <option value="In Progress">In Progress</option>
            <option value="Almost Spent">Almost Spent</option>
            <option value="Fully Spent">Fully Spent</option>
            <option value="Over Budget">Over Budget</option>
          </select>
        </div>

        {/* Category Filter (QoL) */}
        {categoriesList.length > 0 && (
          <div className={styles.filterGroup}>
            <HiTag className={styles.filterIcon} />
            <select 
              className={styles.filterSelect}
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              aria-label="Filter by Category"
            >
              <option value="All">All Categories</option>
              {categoriesList.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}

        {/* Committee Filter (QoL) */}
        {committeesList.length > 0 && (
          <div className={styles.filterGroup}>
            <HiUserGroup className={styles.filterIcon} />
            <select 
              className={styles.filterSelect}
              value={filterCommittee}
              onChange={(e) => setFilterCommittee(e.target.value)}
              aria-label="Filter by Committee"
            >
              <option value="All">All Committees</option>
              {committeesList.map(com => (
                <option key={com} value={com}>{com}</option>
              ))}
            </select>
          </div>
        )}

        {/* Sorting Controls */}
        <div className={styles.sortGroup}>
          <button 
            className={`${styles.sortBtn} ${sortBy === 'date' ? styles.active : ''}`}
            onClick={() => handleSort('date')}
            title="Sort by date created"
          >
            <HiCalendar size={15} />
            Date {sortBy === 'date' && (sortOrder === 'asc' ? <HiSortAscending size={13} /> : <HiSortDescending size={13} />)}
          </button>
          <button 
            className={`${styles.sortBtn} ${sortBy === 'amount' ? styles.active : ''}`}
            onClick={() => handleSort('amount')}
            title="Sort by allocated capital"
          >
            <span style={{ fontWeight: 800, fontSize: '0.95rem', lineHeight: 1 }}>₱</span>
            Allocation {sortBy === 'amount' && (sortOrder === 'asc' ? <HiSortAscending size={13} /> : <HiSortDescending size={13} />)}
          </button>
          <button 
            className={`${styles.sortBtn} ${sortBy === 'spent' ? styles.active : ''}`}
            onClick={() => handleSort('spent')}
            title="Sort by disbursed amount"
          >
            Disbursed {sortBy === 'spent' && (sortOrder === 'asc' ? <HiSortAscending size={13} /> : <HiSortDescending size={13} />)}
          </button>
        </div>
      </div>

      {/* Results Summary */}
      {budgets.length > 0 && (
        <div className={styles.resultsSummary}>
          <div>
            Showing <strong>{filteredBudgets.length}</strong> of <strong>{budgets.length}</strong> recorded budget logs
          </div>
          {(searchTerm || filterStatus !== 'All' || filterCategory !== 'All' || filterCommittee !== 'All') && (
            <button 
              className={styles.clearFilters}
              onClick={() => {
                setSearchTerm('');
                setFilterStatus('All');
                setFilterCategory('All');
                setFilterCommittee('All');
              }}
            >
              <HiX size={14} /> Clear all filters
            </button>
          )}
        </div>
      )}

      {/* List of Budgets */}
      <div className={styles.listGrid}>
        {loading ? (
          <div className={styles.loadingState}>
            <div className={styles.spinner}></div>
            <p>Loading ledger entries...</p>
          </div>
        ) : filteredBudgets.length > 0 ? (
          filteredBudgets.map((budget) => {
            const allocated = parseFloat(budget.allocated) || 0;
            const spent = parseFloat(budget.spent) || 0;
            const remaining = allocated - spent;
            const progress = allocated > 0 ? Math.min((spent / allocated) * 100, 100) : 0;
            const isExpanded = expandedRowId === budget.id;

            return (
              <div key={budget.id} className={`${styles.budgetCard} ${isExpanded ? styles.budgetCardExpanded : ''}`}>
                
                {/* Main Row Grid */}
                <div className={styles.cardHeaderRow}>
                  {/* Column 1: Title & Legislative Reference */}
                  <div className={styles.cardMain}>
                    <span className={styles.eventName}>{budget.eventName}</span>
                    <span className={styles.resolution}>
                      {budget.resolution || 'General Appropriation'}
                    </span>
                  </div>

                  {/* Column 2: Category & Committee Badge */}
                  <div className={styles.cardMeta}>
                    <span className={styles.categoryBadge}>{budget.category || 'General'}</span>
                    <span className={styles.committeeLabel}>{budget.committee || 'General'}</span>
                  </div>

                  {/* Column 3: Financial Metrics & Utilization */}
                  <div className={styles.amountCol}>
                    <div className={styles.amount}>
                      ₱{allocated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className={styles.disbursedSubtext}>
                      Spent: ₱{spent.toLocaleString(undefined, { minimumFractionDigits: 2 })} ({progress.toFixed(0)}%)
                    </div>
                  </div>

                  {/* Column 4: Status Badge */}
                  <div className={styles.statusCol}>
                    <span 
                      className={styles.statusBadge}
                      style={{
                        backgroundColor: getStatusColor(budget.status),
                        color: getStatusTextColor(budget.status)
                      }}
                    >
                      {getStatusIcon(budget.status)}
                      {budget.status}
                    </span>
                  </div>

                  {/* Column 5: Actions */}
                  <div className={styles.actions}>
                    <button 
                      className={`${styles.actionBtn} ${styles.expandBtn}`}
                      onClick={() => toggleRowExpanded(budget.id)}
                      title={isExpanded ? 'Collapse Details' : 'Expand Details'}
                    >
                      {isExpanded ? <HiChevronUp size={16} /> : <HiChevronDown size={16} />}
                    </button>
                    <button 
                      className={`${styles.actionBtn} ${styles.editBtn}`}
                      onClick={() => handleEditClick(budget)}
                      title="Edit Budget"
                    >
                      <HiPencil size={15} />
                    </button>
                    <button 
                      className={`${styles.actionBtn} ${styles.deleteBtn}`}
                      onClick={() => handleDeleteClick(budget)}
                      title="Delete Budget"
                    >
                      <HiTrash size={15} />
                    </button>
                  </div>
                </div>

                {/* Utilization mini-meter on card bottom */}
                <div className={styles.cardMeterTrack}>
                  <div 
                    className={styles.cardMeterFill}
                    style={{ 
                      width: `${progress}%`,
                      backgroundColor: budget.status === 'Over Budget' ? '#e61919' : progress > 85 ? '#f59e0b' : '#22c55e'
                    }}
                  />
                </div>

                {/* Expanded Details Drawer (Quality of Life) */}
                {isExpanded && (
                  <div className={styles.detailsDrawer}>
                    <div className={styles.drawerGrid}>
                      <div className={styles.drawerItem}>
                        <span className={styles.drawerLabel}>Remaining Balance</span>
                        <span className={`${styles.drawerValue} ${remaining < 0 ? styles.negativeValue : ''}`}>
                          ₱{remaining.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className={styles.drawerItem}>
                        <span className={styles.drawerLabel}>Fiscal Fiscal Year</span>
                        <span className={styles.drawerValue}>{budget.fiscalYear || 'Current'}</span>
                      </div>
                      <div className={styles.drawerItem}>
                        <span className={styles.drawerLabel}>Date Execution Range</span>
                        <span className={styles.drawerValue}>
                          {budget.startDate ? new Date(budget.startDate).toLocaleDateString() : 'N/A'} — {budget.endDate ? new Date(budget.endDate).toLocaleDateString() : 'N/A'}
                        </span>
                      </div>
                      <div className={styles.drawerItem}>
                        <span className={styles.drawerLabel}>Documentation & Receipts</span>
                        {budget.receiptUrl ? (
                          <a 
                            href={budget.receiptUrl} 
                            target="_blank" 
                            rel="noreferrer" 
                            className={styles.receiptLink}
                          >
                            <HiExternalLink size={14} /> View File / Drive Link
                          </a>
                        ) : (
                          <span className={styles.drawerMuted}>No URL Attached</span>
                        )}
                      </div>
                    </div>

                    {budget.description && (
                      <div className={styles.drawerDescriptionBlock}>
                        <span className={styles.drawerLabel}>Justification & Scope</span>
                        <p className={styles.drawerDescriptionText}>{budget.description}</p>
                      </div>
                    )}
                  </div>
                )}

              </div>
            );
          })
        ) : (
          <div className={styles.emptyState}>
            <HiExclamationCircle className={styles.emptyIcon} />
            <h3>No budget logs found</h3>
            <p>
              {searchTerm || filterStatus !== 'All' || filterCategory !== 'All' || filterCommittee !== 'All'
                ? 'Try adjusting your search criteria or clearing filters' 
                : 'Start by creating your first budget allocation in New Budget Allocation'}
            </p>
          </div>
        )}
      </div>

      {/* --- EDIT MODAL --- */}
      {isModalOpen && (
        <div className={styles.modalOverlay} onClick={handleModalClose}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <BudgetForm 
              editingBudget={selectedBudget} 
              onSuccess={handleFormSuccess}
            />
          </div>
        </div>
      )}

      {/* --- DELETE CONFIRMATION MODAL --- */}
      {deleteModal.isOpen && (
        <div className={styles.modalOverlay} onClick={() => !isDeleting && setDeleteModal({ isOpen: false, budget: null })}>
          <div className={styles.confirmModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.confirmHeader}>
              <HiExclamationCircle className={styles.confirmIcon} />
              <h3>Delete Budget Record</h3>
            </div>
            <div className={styles.confirmBody}>
              <p>Are you sure you want to delete the budget record for:</p>
              <strong>"{deleteModal.budget?.eventName}"</strong>
              <p className={styles.confirmWarning}>This will permanently purge the record from the institutional ledger and audit trail.</p>
            </div>
            <div className={styles.confirmActions}>
              <button 
                className={styles.cancelBtn}
                onClick={() => setDeleteModal({ isOpen: false, budget: null })}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button 
                className={styles.confirmDeleteBtn}
                onClick={confirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <div className={styles.btnSpinner}></div>
                    Deleting...
                  </>
                ) : (
                  <>
                    <HiTrash size={16} />
                    Confirm Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default BudgetManager;