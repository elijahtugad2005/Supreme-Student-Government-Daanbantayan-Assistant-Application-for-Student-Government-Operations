import React, { useState, useMemo } from 'react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
import BudgetForm from '../BudgetForm/BudgetForm.jsx';
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
  HiClock
} from 'react-icons/hi';

const BudgetManager = () => {
  const { budgets, deleteBudget, loading } = useFinance();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [sortBy, setSortBy] = useState('date'); // 'date', 'amount', 'name'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc', 'desc'
  
  // State for Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState(null);
  
  // State for Delete Confirmation Modal
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, budget: null });
  const [isDeleting, setIsDeleting] = useState(false);

  // Filter and sort budgets
  const filteredBudgets = useMemo(() => {
    let result = budgets.filter(b => {
      const matchesSearch = 
        b.eventName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.resolution?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = filterStatus === 'All' || b.status === filterStatus;
      
      return matchesSearch && matchesStatus;
    });

    // Sort results
    result.sort((a, b) => {
      let compareA, compareB;
      
      switch(sortBy) {
        case 'amount':
          compareA = parseFloat(a.allocated) || 0;
          compareB = parseFloat(b.allocated) || 0;
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
  }, [budgets, searchTerm, filterStatus, sortBy, sortOrder]);

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
    <div className={styles.container}>
      
      {/* Header & Filters */}
      <div className={styles.header}>
        <div className={styles.title}>
          <HiCurrencyDollar className={styles.titleIcon} />
          <div>
            <h2>Manage Budget Logs</h2>
            <p style={{color: '#64748b', margin: '4px 0 0'}}>View, edit, or remove allocations</p>
          </div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className={styles.filtersBar}>
        <div className={styles.searchWrapper}>
          <HiSearch className={styles.searchIcon} size={18} />
          <input 
            type="text" 
            className={styles.searchInput} 
            placeholder="Search by event or resolution..."
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

        <div className={styles.filterGroup}>
          <HiFilter className={styles.filterIcon} />
          <select 
            className={styles.filterSelect}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="All">All Status</option>
            <option value="Not Started">Not Started</option>
            <option value="On Track">On Track</option>
            <option value="In Progress">In Progress</option>
            <option value="Almost Spent">Almost Spent</option>
            <option value="Fully Spent">Fully Spent</option>
            <option value="Over Budget">Over Budget</option>
          </select>
        </div>

        <div className={styles.sortGroup}>
          <button 
            className={`${styles.sortBtn} ${sortBy === 'date' ? styles.active : ''}`}
            onClick={() => handleSort('date')}
            title="Sort by date"
          >
            <HiCalendar size={16} />
            Date {sortBy === 'date' && (sortOrder === 'asc' ? <HiSortAscending size={14} /> : <HiSortDescending size={14} />)}
          </button>
          <button 
            className={`${styles.sortBtn} ${sortBy === 'amount' ? styles.active : ''}`}
            onClick={() => handleSort('amount')}
            title="Sort by amount"
          >
            <HiCurrencyDollar size={16} />
            Amount {sortBy === 'amount' && (sortOrder === 'asc' ? <HiSortAscending size={14} /> : <HiSortDescending size={14} />)}
          </button>
        </div>
      </div>

      {/* Results Summary */}
      {budgets.length > 0 && (
        <div className={styles.resultsSummary}>
          Showing <strong>{filteredBudgets.length}</strong> of <strong>{budgets.length}</strong> budgets
          {(searchTerm || filterStatus !== 'All') && (
            <button 
              className={styles.clearFilters}
              onClick={() => {
                setSearchTerm('');
                setFilterStatus('All');
              }}
            >
              <HiX size={14} /> Clear filters
            </button>
          )}
        </div>
      )}

      {/* List of Budgets */}
      <div className={styles.listGrid}>
        {loading ? (
          <div className={styles.loadingState}>
            <div className={styles.spinner}></div>
            <p>Loading budget logs...</p>
          </div>
        ) : filteredBudgets.length > 0 ? (
          filteredBudgets.map((budget) => (
            <div key={budget.id} className={styles.budgetCard}>
              
              {/* Column 1: Name & Resolution */}
              <div className={styles.cardMain}>
                <span className={styles.eventName}>{budget.eventName}</span>
                <span className={styles.resolution}>
                  {budget.resolution || 'No Resolution No.'}
                </span>
              </div>

              {/* Column 2: Category & Committee */}
              <div className={styles.cardMeta}>
                <span style={{fontWeight: 600}}>{budget.category}</span>
                <span style={{fontSize: '0.8rem'}}>{budget.committee}</span>
              </div>

              {/* Column 3: Amount */}
              <div className={styles.amount}>
                ₱{parseFloat(budget.allocated).toLocaleString()}
              </div>

              {/* Column 4: Status */}
              <div>
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
                  className={`${styles.actionBtn} ${styles.editBtn}`}
                  onClick={() => handleEditClick(budget)}
                  title="Edit Budget"
                >
                  <HiPencil size={16} />
                </button>
                <button 
                  className={`${styles.actionBtn} ${styles.deleteBtn}`}
                  onClick={() => handleDeleteClick(budget)}
                  title="Delete Budget"
                >
                  <HiTrash size={16} />
                </button>
              </div>

            </div>
          ))
        ) : (
          <div className={styles.emptyState}>
            <HiExclamationCircle className={styles.emptyIcon} />
            <h3>No budget logs found</h3>
            <p>
              {searchTerm || filterStatus !== 'All' 
                ? 'Try adjusting your search or filters' 
                : 'Start by creating your first budget allocation'}
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
              <h3>Delete Budget</h3>
            </div>
            <div className={styles.confirmBody}>
              <p>Are you sure you want to delete the budget for:</p>
              <strong>"{deleteModal.budget?.eventName}"</strong>
              <p className={styles.confirmWarning}>This action cannot be undone.</p>
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
                    Delete Budget
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