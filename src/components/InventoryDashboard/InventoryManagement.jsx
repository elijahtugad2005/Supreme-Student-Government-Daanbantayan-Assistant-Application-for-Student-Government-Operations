import React, { useState, useMemo, useCallback, memo, useEffect } from 'react';
import { useInventory } from '../../components/InventoryContext/InventoryProvider';
import { useAuth } from '../AuthContext/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import auditService from '../../services/auditService';
import {
  Package,
  AlertTriangle,
  Clock,
  Coins,
  Plus,
  Search,
  Filter,
  ArrowDownToLine,
  Edit3,
  Trash2,
  CheckCircle2,
  Check,
  Paperclip,
  X,
  Tag,
  Layers,
  History,
  Sparkles,
  ShieldCheck,
  FileText
} from 'lucide-react';
import styles from './InventoryManagement.module.css';

const InventoryManagement = () => {
  const { theme } = useTheme();
  const isClassic = theme === 'dark';

  const {
    inventory,
    categories,
    loading,
    borrowedItems,
    addInventoryItem,
    updateInventoryItem,
    deleteInventoryItem,
    borrowItem,
    returnItem,
    convertImageToBase64,
  } = useInventory();

  const { userName, userRole } = useAuth();

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [stockFilter, setStockFilter] = useState('ALL'); // 'ALL' | 'LOW' | 'OUT' | 'IN'

  // Dialog & Modal state
  const [openDialog, setOpenDialog] = useState(false);
  const [openBorrowDialog, setOpenBorrowDialog] = useState(false);
  const [openReturnDialog, setOpenReturnDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedBorrowLog, setSelectedBorrowLog] = useState(null);
  const [tabValue, setTabValue] = useState(0); // 0: Inventory Items, 1: Borrowing History, 2: Categories

  // Category creation local state
  const [newCategoryInput, setNewCategoryInput] = useState('');

  // Toast / feedback message state
  const [toastMsg, setToastMsg] = useState(null);
  const showToast = useCallback((text) => {
    setToastMsg(text);
    setTimeout(() => setToastMsg(null), 3200);
  }, []);

  // Role permissions based on access tiers
  const HIGHER_ACCESS_ROLES = [
    'admin',
    'president',
    'vice_president',
    'secretary',
    'executive_secretary',
    'press_secretary',
    'linkages_secretary',
    'deputy_secretary',
    'finance_secretary',
    'auditor',
    'budget_officer',
  ];

  const MEDIUM_ACCESS_ROLES = [
    'senator',
    'representative',
  ];

  // Higher + Medium access can Add, Update, Edit, and issue Borrow requisitions
  const canEdit = HIGHER_ACCESS_ROLES.includes(userRole) || MEDIUM_ACCESS_ROLES.includes(userRole);

  // Higher access only can permanently Delete items
  const canDelete = HIGHER_ACCESS_ROLES.includes(userRole);

  const handleOpenDialog = useCallback((item = null) => {
    setSelectedItem(item);
    setOpenDialog(true);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setOpenDialog(false);
    setSelectedItem(null);
  }, []);

  const handleOpenBorrowDialog = useCallback((item) => {
    setSelectedItem(item);
    setOpenBorrowDialog(true);
  }, []);

  const handleOpenReturnDialog = useCallback((log) => {
    setSelectedBorrowLog(log);
    setOpenReturnDialog(true);
  }, []);

  const handleDeleteItem = useCallback((item) => {
    if (window.confirm(`Permanently remove "${item.name}" from the inventory register?`)) {
      deleteInventoryItem(item.id);
      // Audit Trail: Log Inventory Deletion (IDL) - Zero UID
      auditService.logInventoryDelete(userName || 'Authorized Officer', item.name);
      showToast(`Removed "${item.name}"`);
    }
  }, [deleteInventoryItem, userName, showToast]);

  const handleSaveItem = useCallback(async (formValues) => {
    try {
      const itemData = {
        ...formValues,
        quantity: parseInt(formValues.quantity) || 0,
        amount: parseFloat(formValues.amount) || 0,
        minQuantity: parseInt(formValues.minQuantity) || 5,
        lastUpdatedBy: userName || 'Officer',
      };

      if (selectedItem) {
        await updateInventoryItem(selectedItem.id, itemData);

        // Audit Trail: Log Inventory Update (IUP) - Zero UID & Compact summary
        const diffs = [];
        if (selectedItem.quantity !== itemData.quantity) {
          diffs.push(`Stock: ${selectedItem.quantity} → ${itemData.quantity}`);
        }
        if (selectedItem.category !== itemData.category) {
          diffs.push(`Category: "${itemData.category}"`);
        }
        if (selectedItem.storageLocation !== itemData.storageLocation) {
          diffs.push(`Location: "${itemData.storageLocation || 'N/A'}"`);
        }
        const summary = diffs.length > 0 
          ? `Updated ${diffs.join(', ')}`
          : `Updated record details for "${itemData.name}"`;

        await auditService.logInventoryUpdate(userName || 'Authorized Officer', itemData.name, summary);
        showToast(`Item "${formValues.name}" successfully updated`);
      } else {
        await addInventoryItem(itemData);

        // Audit Trail: Log Inventory Add (IAD) - Zero UID
        await auditService.logInventoryAdd(
          userName || 'Authorized Officer',
          itemData.name,
          itemData.quantity,
          itemData.category
        );
        showToast(`Item "${formValues.name}" added to inventory`);
      }
      handleCloseDialog();
    } catch (error) {
      console.error('Error saving item:', error);
      alert('Error saving item: ' + error.message);
    }
  }, [selectedItem, userName, updateInventoryItem, addInventoryItem, handleCloseDialog, showToast]);

  const handleBorrowSubmit = useCallback(async (borrowValues) => {
    try {
      if (borrowValues.quantityBorrowed > (selectedItem?.quantity || 0)) {
        alert('Cannot borrow more than available stock quantity');
        return;
      }
      await borrowItem({
        ...borrowValues,
        itemName: selectedItem.name,
        borrowedBy: userName || 'Officer',
        processedBy: userName || 'Officer',
      });
      showToast(`Logged borrow requisition for ${selectedItem.name}`);
      setOpenBorrowDialog(false);
      setSelectedItem(null);
    } catch (error) {
      console.error('Error borrowing item:', error);
      alert('Error borrowing item: ' + error.message);
    }
  }, [selectedItem, userName, borrowItem, showToast]);

  const handleReturnSubmit = useCallback(async (returnValues) => {
    try {
      await returnItem(selectedBorrowLog.id, {
        ...returnValues,
        returnedDate: new Date(),
        processedBy: userName || 'Officer',
      });
      showToast(`Confirmed return of ${selectedBorrowLog.itemName}`);
      setOpenReturnDialog(false);
      setSelectedBorrowLog(null);
    } catch (error) {
      console.error('Error returning item:', error);
      alert('Error returning item: ' + error.message);
    }
  }, [selectedBorrowLog, userName, returnItem, showToast]);

  // Metrics
  const lowStockCount = useMemo(() => {
    return inventory.filter(item => item.quantity <= (item.minQuantity || 5)).length;
  }, [inventory]);

  const totalValue = useMemo(() => {
    return inventory.reduce((sum, item) => sum + (item.amount || 0) * (item.quantity || 0), 0);
  }, [inventory]);

  const activeBorrowingsCount = useMemo(() => {
    return borrowedItems.filter(item => !item.returned).length;
  }, [borrowedItems]);

  const formatDate = useCallback((timestamp) => {
    if (!timestamp) return 'Not specified';
    if (timestamp.toDate) {
      return timestamp.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, []);

  const formatCurrency = useCallback((amount) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
    }).format(amount);
  }, []);

  // Filtered inventory items
  const filteredInventory = useMemo(() => {
    return inventory.filter(item => {
      const matchesSearch =
        !searchTerm.trim() ||
        item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.storageLocation?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCategory =
        selectedCategory === 'ALL' || item.category === selectedCategory;

      const matchesStock =
        stockFilter === 'ALL' ||
        (stockFilter === 'LOW' && item.quantity > 0 && item.quantity <= (item.minQuantity || 5)) ||
        (stockFilter === 'OUT' && item.quantity === 0) ||
        (stockFilter === 'IN' && item.quantity > (item.minQuantity || 5));

      return matchesSearch && matchesCategory && matchesStock;
    });
  }, [inventory, searchTerm, selectedCategory, stockFilter]);

  return (
    <div className={`${styles.container} ${isClassic ? styles.inventoryClassic : ''}`}>
      {/* Top Decorative Tribal Band (Classic Maroon Gold Theme Only) */}
      {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}

      {/* Toast Feedback */}
      {toastMsg && (
        <div className={styles.toastMessage}>
          <CheckCircle2 size={16} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Control Center Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.eyebrowBadge}>
            <Sparkles size={13} />
            <span>{isClassic ? 'SSG INSTITUTIONAL ASSET VAULT' : 'Institutional Asset Vault'}</span>
          </div>
          <h1 className={styles.title}>Inventory Management</h1>
          <p className={styles.subtitle}>
            Monitor university property, custody tracking, and supply replenishment telemetry for SSG CTU Daanbantayan.
          </p>
        </div>

        {canEdit && tabValue === 0 && (
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => handleOpenDialog()}
            >
              <Plus size={16} strokeWidth={2.4} />
              <span>Add Inventory Item</span>
            </button>
          </div>
        )}
      </header>

      {/* Metric Cards Bento Grid (Interactive 1-Click Filters) */}
      <div className={styles.statsContainer}>
        {/* Total Assets - Reset to All */}
        <button
          type="button"
          className={`${styles.statCard} ${styles.statCardClickable} ${tabValue === 0 && stockFilter === 'ALL' ? styles.statCardActive : ''}`}
          onClick={() => {
            setTabValue(0);
            setStockFilter('ALL');
          }}
          aria-pressed={tabValue === 0 && stockFilter === 'ALL'}
          title="Show all inventory assets"
        >
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Total Asset Types</span>
            <div className={`${styles.statIconBadge} ${styles.badgePrimary}`}>
              <Package size={18} />
            </div>
          </div>
          <div className={styles.statValue}>{inventory.length}</div>
          <div className={styles.statCaption}>
            {tabValue === 0 && stockFilter === 'ALL' ? '● Showing all items' : 'Click to view all items'}
          </div>
        </button>

        {/* Low Stock Attention - 1-Click Low-Stock Filter */}
        <button
          type="button"
          className={`${styles.statCard} ${styles.statCardClickable} ${lowStockCount > 0 ? styles.statCardWarning : ''} ${tabValue === 0 && stockFilter === 'LOW' ? styles.statCardActiveWarning : ''}`}
          onClick={() => {
            setTabValue(0);
            setStockFilter(prev => prev === 'LOW' ? 'ALL' : 'LOW');
          }}
          aria-pressed={tabValue === 0 && stockFilter === 'LOW'}
          title="Toggle low stock filter"
        >
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Low Stock Alerts</span>
            <div className={`${styles.statIconBadge} ${styles.badgeWarning}`}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <div className={styles.statValue}>{lowStockCount}</div>
          <div className={styles.statCaption}>
            {tabValue === 0 && stockFilter === 'LOW'
              ? '● Filter Active (Click to reset)'
              : lowStockCount > 0 ? 'Click to filter low stock items' : 'All stock levels healthy'}
          </div>
        </button>

        {/* Active Custody / Borrowings - Quick jump to Custody Tab */}
        <button
          type="button"
          className={`${styles.statCard} ${styles.statCardClickable} ${tabValue === 1 ? styles.statCardActiveInfo : ''}`}
          onClick={() => setTabValue(1)}
          aria-pressed={tabValue === 1}
          title="Jump to Requisition & Borrowing tab"
        >
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Active Custody</span>
            <div className={`${styles.statIconBadge} ${styles.badgeInfo}`}>
              <Clock size={18} />
            </div>
          </div>
          <div className={styles.statValue}>{activeBorrowingsCount}</div>
          <div className={styles.statCaption}>
            {tabValue === 1 ? '● Requisition tab active' : 'Click to inspect custody logs'}
          </div>
        </button>

        {/* Total Assessed Value */}
        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Total Asset Valuation</span>
            <div className={`${styles.statIconBadge} ${styles.badgeSuccess}`}>
              <Coins size={18} />
            </div>
          </div>
          <div className={`${styles.statValue} ${styles.statValueCurrency}`}>
            {formatCurrency(totalValue)}
          </div>
          <div className={styles.statCaption}>Institutional capitalized value</div>
        </div>
      </div>

      {/* Tabs Navigation Surface */}
      <nav className={styles.tabsContainer} aria-label="Inventory Sections">
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tabValue === 0 ? styles.activeTab : ''}`}
            onClick={() => setTabValue(0)}
          >
            <Layers size={17} className={styles.tabIcon} />
            <span>Stock Inventory ({inventory.length})</span>
          </button>

          <button
            type="button"
            className={`${styles.tab} ${tabValue === 1 ? styles.activeTab : ''}`}
            onClick={() => setTabValue(1)}
          >
            <History size={17} className={styles.tabIcon} />
            <span>Requisition & Borrowing ({borrowedItems.length})</span>
          </button>

          {canEdit && (
            <button
              type="button"
              className={`${styles.tab} ${tabValue === 2 ? styles.activeTab : ''}`}
              onClick={() => setTabValue(2)}
            >
              <Tag size={17} className={styles.tabIcon} />
              <span>Asset Categories</span>
            </button>
          )}
        </div>
      </nav>

      {/* TAB 0: INVENTORY ITEMS */}
      {tabValue === 0 && (
        <section className={styles.tabSection}>
          {/* Search, Filter, and View Controls */}
          <div className={styles.filterBar}>
            <div className={styles.searchBox}>
              <Search size={16} className={styles.searchIcon} />
              <input
                type="text"
                placeholder="Search item name, location, or tag..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={styles.searchInput}
              />
              {searchTerm && (
                <button
                  type="button"
                  className={styles.clearSearchBtn}
                  onClick={() => setSearchTerm('')}
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className={styles.filterControls}>
              {/* Category Select */}
              <div className={styles.selectWrapper}>
                <Filter size={14} className={styles.selectIcon} />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className={styles.filterSelect}
                  aria-label="Filter by Category"
                >
                  <option value="ALL">All Categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Stock Level Select */}
              <select
                value={stockFilter}
                onChange={(e) => setStockFilter(e.target.value)}
                className={styles.filterSelect}
                aria-label="Filter by Stock Condition"
              >
                <option value="ALL">All Stock Levels</option>
                <option value="IN">In Stock</option>
                <option value="LOW">Low Stock</option>
                <option value="OUT">Out of Stock</option>
              </select>
            </div>
          </div>

          {/* Items Table Container */}
          <div className={styles.tableContainer}>
            {loading ? (
              <div className={styles.loadingContainer}>
                <div className={styles.spinner} />
                <p>Synchronizing asset registry...</p>
              </div>
            ) : filteredInventory.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconCircle}>
                  <Package size={32} />
                </div>
                <h3>No inventory records found</h3>
                <p>
                  {searchTerm || selectedCategory !== 'ALL' || stockFilter !== 'ALL'
                    ? 'No items match your active filter parameters. Try clearing your search.'
                    : 'Your inventory register is currently empty. Add your first item to start tracking.'}
                </p>
                {canEdit && !searchTerm && (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => handleOpenDialog()}
                  >
                    <Plus size={16} /> Add First Item
                  </button>
                )}
              </div>
            ) : (
              <div className={styles.tableResponsive}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Item Description</th>
                      <th>Category</th>
                      <th className={styles.textRight}>Available Stock</th>
                      <th className={styles.textRight}>Unit Valuation</th>
                      <th>Storage Location</th>
                      <th>Stock Status</th>
                      <th className={styles.textCenter}>Management</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInventory.map((item) => (
                      <InventoryRow
                        key={item.id}
                        item={item}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        onBorrow={handleOpenBorrowDialog}
                        onEdit={handleOpenDialog}
                        onDelete={handleDeleteItem}
                        formatCurrency={formatCurrency}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB 1: BORROWING & CUSTODY HISTORY */}
      {tabValue === 1 && (
        <section className={styles.tabSection}>
          <div className={styles.tableContainer}>
            <div className={styles.tableResponsive}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Item Requisitioned</th>
                    <th>Borrower Name</th>
                    <th>Custody Date</th>
                    <th>Expected Return</th>
                    <th className={styles.textRight}>Quantity</th>
                    <th>Official Purpose</th>
                    <th>Return Status</th>
                    <th className={styles.textCenter}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {borrowedItems.length === 0 ? (
                    <tr>
                      <td colSpan="8" className={styles.textCenter}>
                        <div className={styles.emptyState}>
                          <div className={styles.emptyIconCircle}>
                            <History size={32} />
                          </div>
                          <h3>No borrowing logs recorded</h3>
                          <p>All assets are currently in repository storage.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    borrowedItems.map((log) => (
                      <BorrowLogRow
                        key={log.id}
                        log={log}
                        onReturn={handleOpenReturnDialog}
                        formatDate={formatDate}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* TAB 2: CATEGORIES MANAGEMENT */}
      {tabValue === 2 && canEdit && (
        <section className={styles.tabSection}>
          <div className={styles.categoriesCard}>
            <div className={styles.categoryCardHeader}>
              <div>
                <h3 className={styles.categoryCardTitle}>Designated Inventory Categories</h3>
                <p className={styles.categoryCardSubtitle}>
                  Organize institutional hardware, materials, and consumables under structured classifications.
                </p>
              </div>
            </div>

            <div className={styles.categoriesGrid}>
              {categories.map((cat) => (
                <div key={cat} className={styles.categoryTagPill}>
                  <Tag size={15} className={styles.categoryTagIcon} />
                  <span className={styles.categoryTagName}>{cat}</span>
                </div>
              ))}
            </div>

            <div className={styles.addCategoryRow}>
              <input
                type="text"
                placeholder="Enter new category classification..."
                value={newCategoryInput}
                onChange={(e) => setNewCategoryInput(e.target.value)}
                className={styles.categoryInput}
              />
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => {
                  if (newCategoryInput.trim()) {
                    showToast(`Classification "${newCategoryInput}" added`);
                    setNewCategoryInput('');
                  }
                }}
              >
                <Plus size={16} /> Add Category
              </button>
            </div>
          </div>
        </section>
      )}

      {/* DIALOG: ADD / EDIT ITEM */}
      {openDialog && (
        <AssetDialog
          isOpen={openDialog}
          item={selectedItem}
          categories={categories}
          isClassic={isClassic}
          onClose={handleCloseDialog}
          onSave={handleSaveItem}
          convertImageToBase64={convertImageToBase64}
        />
      )}

      {/* DIALOG: BORROW ITEM */}
      {openBorrowDialog && selectedItem && (
        <BorrowDialog
          isOpen={openBorrowDialog}
          item={selectedItem}
          isClassic={isClassic}
          onClose={() => {
            setOpenBorrowDialog(false);
            setSelectedItem(null);
          }}
          onSubmit={handleBorrowSubmit}
        />
      )}

      {/* DIALOG: RETURN ITEM */}
      {openReturnDialog && selectedBorrowLog && (
        <ReturnDialog
          isOpen={openReturnDialog}
          log={selectedBorrowLog}
          isClassic={isClassic}
          onClose={() => {
            setOpenReturnDialog(false);
            setSelectedBorrowLog(null);
          }}
          onSubmit={handleReturnSubmit}
        />
      )}
    </div>
  );
};

// ==========================================
// MEMOIZED HIGH-PERFORMANCE TABLE ROW COMPONENTS
// Eliminates re-rendering 100+ DOM nodes on scroll/keystrokes
// ==========================================

const InventoryRow = memo(function InventoryRow({
  item,
  canEdit,
  canDelete,
  onBorrow,
  onEdit,
  onDelete,
  formatCurrency,
}) {
  const isLow = item.quantity <= (item.minQuantity || 5) && item.quantity > 0;
  const isOut = item.quantity === 0;

  return (
    <tr className={isLow ? styles.lowStockRow : isOut ? styles.outOfStockRow : ''}>
      <td>
        <div className={styles.itemNameWrapper}>
          <span className={styles.itemNameText}>{item.name}</span>
          {item.description && (
            <span className={styles.itemDescriptionText}>
              {item.description}
            </span>
          )}
        </div>
      </td>
      <td>
        <span className={styles.categoryBadge}>
          {item.category || 'General'}
        </span>
      </td>
      <td className={styles.textRight}>
        <div className={styles.quantityCell}>
          <span className={styles.quantityNum}>{item.quantity}</span>
          <span className={styles.quantityUnit}>units</span>
          {isLow && (
            <span className={styles.lowStockIndicator} title="Below minimum stock threshold">
              <AlertTriangle size={13} />
            </span>
          )}
        </div>
      </td>
      <td className={styles.textRight}>
        <span className={styles.priceNum}>{formatCurrency(item.amount || 0)}</span>
      </td>
      <td>
        <span className={styles.locationTag}>{item.storageLocation || 'Unassigned'}</span>
      </td>
      <td>
        <span className={`${styles.statusBadge} ${isOut ? styles.statusOut : isLow ? styles.statusLow : styles.statusIn}`}>
          <span className={styles.statusDot} />
          {isOut ? 'Depleted' : isLow ? 'Low Stock' : 'In Stock'}
        </span>
      </td>
      <td className={styles.textCenter}>
        <div className={styles.actionButtons}>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.borrowBtn}`}
            onClick={() => onBorrow(item)}
            disabled={isOut}
            title={isOut ? 'Depleted - cannot borrow' : 'Issue borrow requisition'}
          >
            <ArrowDownToLine size={14} />
            <span>Borrow</span>
          </button>

          {canEdit && (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.editBtn}`}
              onClick={() => onEdit(item)}
              title="Edit asset details"
            >
              <Edit3 size={14} />
              <span>Edit</span>
            </button>
          )}

          {canDelete && (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.deleteBtn}`}
              onClick={() => onDelete(item)}
              title="Delete item (Higher Access only)"
            >
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

const BorrowLogRow = memo(function BorrowLogRow({
  log,
  onReturn,
  formatDate,
}) {
  return (
    <tr>
      <td>
        <strong>{log.itemName}</strong>
      </td>
      <td>
        <div className={styles.borrowerInfo}>
          <span>{log.borrowerName || log.borrowedBy || 'Student'}</span>
          {log.borrowerEmail && (
            <small className={styles.borrowerEmail}>{log.borrowerEmail}</small>
          )}
        </div>
      </td>
      <td>{formatDate(log.borrowDate)}</td>
      <td>{log.expectedReturnDate ? formatDate(log.expectedReturnDate) : 'Open term'}</td>
      <td className={styles.textRight}>
        <strong>{log.quantityBorrowed || 1}</strong> pcs
      </td>
      <td>
        <span className={styles.purposeText}>{log.purpose || 'Institutional Activity'}</span>
      </td>
      <td>
        <span className={`${styles.statusBadge} ${log.returned ? styles.statusReturned : styles.statusBorrowed}`}>
          <span className={styles.statusDot} />
          {log.returned ? 'Returned' : 'In Custody'}
        </span>
      </td>
      <td className={styles.textCenter}>
        {!log.returned ? (
          <button
            type="button"
            className={styles.returnActionBtn}
            onClick={() => onReturn(log)}
            title="Process check-in return"
          >
            <Check size={14} />
            <span>Mark Returned</span>
          </button>
        ) : (
          <span className={styles.completedCheck}>
            <ShieldCheck size={15} /> Cleared
          </span>
        )}
      </td>
    </tr>
  );
});

// ==========================================
// MEMOIZED HIGH-PERFORMANCE DIALOG SUBCOMPONENTS
// Isolates form states from the root dashboard to ensure 0ms typing latency
// ==========================================

const AssetDialog = memo(function AssetDialog({
  isOpen,
  item,
  categories,
  isClassic,
  onClose,
  onSave,
  convertImageToBase64,
}) {
  const [formData, setFormData] = useState(() => ({
    name: item?.name || '',
    category: item?.category || categories?.[0] || '',
    quantity: item?.quantity ?? 0,
    storageLocation: item?.storageLocation || '',
    amount: item?.amount ?? 0,
    receipt: item?.receipt || '',
    description: item?.description || '',
    minQuantity: item?.minQuantity ?? 5,
  }));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name || '',
        category: item.category || categories?.[0] || '',
        quantity: item.quantity ?? 0,
        storageLocation: item.storageLocation || '',
        amount: item.amount ?? 0,
        receipt: item.receipt || '',
        description: item.description || '',
        minQuantity: item.minQuantity ?? 5,
      });
    } else {
      setFormData({
        name: '',
        category: categories?.[0] || '',
        quantity: 0,
        storageLocation: '',
        amount: 0,
        receipt: '',
        description: '',
        minQuantity: 5,
      });
    }
  }, [item, categories]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleReceiptUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const base64 = await convertImageToBase64(file);
        setFormData((prev) => ({ ...prev, receipt: base64 }));
      } catch (error) {
        console.error('Error converting image:', error);
        alert('Error uploading receipt: ' + error.message);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSave(formData);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={`${styles.modalOverlay} ${isClassic ? styles.modalOverlayClassic : ''}`}
      onClick={onClose}
    >
      <div
        className={`${styles.modal} ${isClassic ? styles.modalClassic : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2>{item ? 'Modify Asset Specification' : 'Register New Asset'}</h2>
            <p className={styles.modalSubtitle}>Fill in official details to catalog this item</p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label htmlFor="name">Item Designation *</label>
              <input
                type="text"
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                required
                placeholder="e.g. Wireless Microphone Set"
                className={styles.formInput}
                autoFocus
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="category">Category Classification *</label>
              <select
                id="category"
                value={formData.category}
                onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
                required
                className={styles.formSelect}
              >
                <option value="">Select category...</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="quantity">Quantity in Stock *</label>
              <input
                type="number"
                id="quantity"
                value={formData.quantity}
                onChange={(e) => setFormData((prev) => ({ ...prev, quantity: e.target.value }))}
                required
                min="0"
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="amount">Unit Valuation (₱) *</label>
              <input
                type="number"
                id="amount"
                value={formData.amount}
                onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))}
                required
                min="0"
                step="0.01"
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="storageLocation">Storage Location / Cabinet *</label>
              <input
                type="text"
                id="storageLocation"
                value={formData.storageLocation}
                onChange={(e) => setFormData((prev) => ({ ...prev, storageLocation: e.target.value }))}
                required
                placeholder="e.g. SSG Storage Cabinet B3"
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="minQuantity">Minimum Stock Alert Threshold</label>
              <input
                type="number"
                id="minQuantity"
                value={formData.minQuantity}
                onChange={(e) => setFormData((prev) => ({ ...prev, minQuantity: e.target.value }))}
                min="0"
                className={styles.formInput}
              />
              <small className={styles.helperText}>Triggers warning badge when units fall below this level</small>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="description">Asset Description & Specs</label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              rows="3"
              placeholder="Include model serial numbers, hardware condition, and packaging notes..."
              className={styles.formTextarea}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.fileUploadLabel}>
              <span className={styles.fileUploadButton}>
                <Paperclip size={15} /> Upload Receipt or Invoice (Optional)
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handleReceiptUpload}
                className={styles.fileInput}
              />
            </label>
            {formData.receipt && (
              <span className={styles.fileUploadStatus}>
                <CheckCircle2 size={14} /> Receipt document attached
              </span>
            )}
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className={styles.primaryButton} disabled={submitting}>
              <Check size={16} />
              <span>{submitting ? 'Saving...' : item ? 'Update Asset Record' : 'Save New Item'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

const BorrowDialog = memo(function BorrowDialog({
  isOpen,
  item,
  isClassic,
  onClose,
  onSubmit,
}) {
  const [borrowForm, setBorrowForm] = useState(() => ({
    itemId: item?.id || '',
    quantityBorrowed: 1,
    borrowerName: '',
    borrowerEmail: '',
    purpose: '',
    expectedReturnDate: '',
  }));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (item) {
      setBorrowForm({
        itemId: item.id || '',
        quantityBorrowed: 1,
        borrowerName: '',
        borrowerEmail: '',
        purpose: '',
        expectedReturnDate: '',
      });
    }
  }, [item]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (borrowForm.quantityBorrowed > (item?.quantity || 0)) {
      alert('Cannot borrow more than available stock quantity');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(borrowForm);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !item) return null;

  return (
    <div
      className={`${styles.modalOverlay} ${isClassic ? styles.modalOverlayClassic : ''}`}
      onClick={onClose}
    >
      <div
        className={`${styles.modal} ${isClassic ? styles.modalClassic : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2>Borrow Requisition: {item.name}</h2>
            <p className={styles.modalSubtitle}>Currently available: {item.quantity} units</p>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label htmlFor="borrowerName">Borrower Full Name *</label>
              <input
                type="text"
                id="borrowerName"
                value={borrowForm.borrowerName}
                onChange={(e) => setBorrowForm((prev) => ({ ...prev, borrowerName: e.target.value }))}
                required
                placeholder="e.g. Maria Santos"
                className={styles.formInput}
                autoFocus
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="borrowerEmail">Borrower University Email</label>
              <input
                type="email"
                id="borrowerEmail"
                value={borrowForm.borrowerEmail}
                onChange={(e) => setBorrowForm((prev) => ({ ...prev, borrowerEmail: e.target.value }))}
                placeholder="e.g. maria.santos@ctu.edu.ph"
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="quantityBorrowed">Quantity to Borrow *</label>
              <input
                type="number"
                id="quantityBorrowed"
                value={borrowForm.quantityBorrowed}
                onChange={(e) =>
                  setBorrowForm((prev) => ({ ...prev, quantityBorrowed: parseInt(e.target.value) || 1 }))
                }
                min="1"
                max={item.quantity}
                required
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="expectedReturnDate">Expected Return Date</label>
              <input
                type="date"
                id="expectedReturnDate"
                value={borrowForm.expectedReturnDate}
                onChange={(e) => setBorrowForm((prev) => ({ ...prev, expectedReturnDate: e.target.value }))}
                className={styles.formInput}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="purpose">Official Purpose / Committee Event *</label>
            <input
              type="text"
              id="purpose"
              value={borrowForm.purpose}
              onChange={(e) => setBorrowForm((prev) => ({ ...prev, purpose: e.target.value }))}
              required
              placeholder="e.g. College Days Stage Setup"
              className={styles.formInput}
            />
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={submitting || borrowForm.quantityBorrowed > item.quantity || item.quantity === 0}
            >
              <Check size={16} /> {submitting ? 'Confirming...' : 'Confirm Custody'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

const ReturnDialog = memo(function ReturnDialog({
  isOpen,
  log,
  isClassic,
  onClose,
  onSubmit,
}) {
  const [returnForm, setReturnForm] = useState(() => ({
    notes: '',
    condition: 'good',
  }));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(returnForm);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !log) return null;

  return (
    <div
      className={`${styles.modalOverlay} ${isClassic ? styles.modalOverlayClassic : ''}`}
      onClick={onClose}
    >
      <div
        className={`${styles.modal} ${isClassic ? styles.modalClassic : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2>Process Return: {log.itemName}</h2>
            <p className={styles.modalSubtitle}>Borrower: {log.borrowerName || 'Student'}</p>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="condition">Asset Return Condition</label>
            <select
              id="condition"
              value={returnForm.condition}
              onChange={(e) => setReturnForm((prev) => ({ ...prev, condition: e.target.value }))}
              className={styles.formSelect}
            >
              <option value="excellent">Excellent — Like New</option>
              <option value="good">Good — Fully Functional</option>
              <option value="fair">Fair — Minor Cosmetic Wear</option>
              <option value="poor">Poor — Needs Inspection</option>
              <option value="damaged">Damaged — Needs Maintenance</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="notes">Inspection Notes</label>
            <textarea
              id="notes"
              value={returnForm.notes}
              onChange={(e) => setReturnForm((prev) => ({ ...prev, notes: e.target.value }))}
              rows="3"
              className={styles.formTextarea}
              placeholder="State any issues, missing cables, or general condition..."
            />
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className={styles.primaryButton} disabled={submitting}>
              <Check size={16} /> {submitting ? 'Processing...' : 'Confirm Check-In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

export default InventoryManagement;