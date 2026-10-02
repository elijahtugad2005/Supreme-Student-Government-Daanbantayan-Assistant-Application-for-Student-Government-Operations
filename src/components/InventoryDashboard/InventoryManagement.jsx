// components/InventoryManagement/InventoryManagement.jsx
import React, { useState } from 'react';
import { useInventory } from '../../components/InventoryContext/InventoryProvider';
import { useAuth } from '../AuthContext/AuthContext';
import styles from './InventoryManagement.module.css';

const InventoryManagement = () => {
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

  const [openDialog, setOpenDialog] = useState(false);
  const [openBorrowDialog, setOpenBorrowDialog] = useState(false);
  const [openReturnDialog, setOpenReturnDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedBorrowLog, setSelectedBorrowLog] = useState(null);
  const [tabValue, setTabValue] = useState(0);
  const [borrowForm, setBorrowForm] = useState({
    itemId: '',
    quantityBorrowed: 1,
    borrowerName: '',
    borrowerEmail: '',
    purpose: '',
    expectedReturnDate: '',
  });
  const [returnForm, setReturnForm] = useState({
    notes: '',
    condition: 'good',
  });

  const [formData, setFormData] = useState({
    name: '',
    category: '',
    quantity: 0,
    storageLocation: '',
    amount: 0,
    receipt: '',
    description: '',
    minQuantity: 5,
  });

  // Check if user has admin/secretary/representative permissions
  const canEdit = ['admin', 'secretary', 'representative'].includes(userRole);

  const handleOpenDialog = (item = null) => {
    if (item) {
      setFormData({
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        storageLocation: item.storageLocation,
        amount: item.amount,
        receipt: item.receipt || '',
        description: item.description || '',
        minQuantity: item.minQuantity || 5,
      });
      setSelectedItem(item);
    } else {
      setFormData({
        name: '',
        category: '',
        quantity: 0,
        storageLocation: '',
        amount: 0,
        receipt: '',
        description: '',
        minQuantity: 5,
      });
      setSelectedItem(null);
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setSelectedItem(null);
  };

  const handleOpenBorrowDialog = (item) => {
    setSelectedItem(item);
    setBorrowForm({
      itemId: item.id,
      quantityBorrowed: 1,
      borrowerName: '',
      borrowerEmail: '',
      purpose: '',
      expectedReturnDate: '',
    });
    setOpenBorrowDialog(true);
  };

  const handleOpenReturnDialog = (log) => {
    setSelectedBorrowLog(log);
    setReturnForm({
      notes: '',
      condition: 'good',
    });
    setOpenReturnDialog(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const itemData = {
        ...formData,
        quantity: parseInt(formData.quantity),
        amount: parseFloat(formData.amount),
        minQuantity: parseInt(formData.minQuantity),
        lastUpdatedBy: userName,
      };

      if (selectedItem) {
        await updateInventoryItem(selectedItem.id, itemData);
      } else {
        await addInventoryItem(itemData);
      }
      handleCloseDialog();
    } catch (error) {
      console.error('Error saving item:', error);
      alert('Error saving item: ' + error.message);
    }
  };

  const handleBorrowSubmit = async (e) => {
    e.preventDefault();
    try {
      if (borrowForm.quantityBorrowed > selectedItem?.quantity) {
        alert('Cannot borrow more than available quantity');
        return;
      }
      await borrowItem({
        ...borrowForm,
        itemName: selectedItem.name,
        borrowedBy: userName,
        processedBy: userName,
      });
      setOpenBorrowDialog(false);
      setSelectedItem(null);
    } catch (error) {
      console.error('Error borrowing item:', error);
      alert('Error borrowing item: ' + error.message);
    }
  };

  const handleReturnSubmit = async (e) => {
    e.preventDefault();
    try {
      await returnItem(selectedBorrowLog.id, returnForm);
      setOpenReturnDialog(false);
      setSelectedBorrowLog(null);
    } catch (error) {
      console.error('Error returning item:', error);
      alert('Error returning item: ' + error.message);
    }
  };

  const handleReceiptUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const base64 = await convertImageToBase64(file);
        setFormData({ ...formData, receipt: base64 });
      } catch (error) {
        console.error('Error converting image:', error);
        alert('Error uploading receipt: ' + error.message);
      }
    }
  };

  const getLowStockItems = () => {
    return inventory.filter(item => item.quantity <= (item.minQuantity || 5));
  };

  const getTotalValue = () => {
    return inventory.reduce((sum, item) => sum + (item.amount || 0) * (item.quantity || 0), 0);
  };

  const getActiveBorrowings = () => {
    return borrowedItems.filter(item => !item.returned).length;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Not specified';
    if (timestamp.toDate) {
      return timestamp.toDate().toLocaleDateString();
    }
    return new Date(timestamp).toLocaleDateString();
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP'
    }).format(amount);
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <h1 className={styles.title}>
          <span className={styles.titleIcon}>📦</span>
          Inventory Management System
        </h1>
        <p className={styles.subtitle}>
          Welcome, <span className={styles.userName}>{userName}</span>! Manage your inventory, track items, and monitor stock levels.
        </p>
      </header>

      {/* Stats Cards */}
      <div className={styles.statsContainer}>
        <div className={styles.statCard}>
          <div className={styles.statContent}>
            <span className={styles.statLabel}>Total Items</span>
            <span className={styles.statValue}>{inventory.length}</span>
          </div>
        </div>
        <div className={`${styles.statCard} ${styles.warningCard}`}>
          <div className={styles.statContent}>
            <span className={styles.statLabel}>Low Stock Items</span>
            <span className={styles.statValue}>{getLowStockItems().length}</span>
          </div>
        </div>
        <div className={`${styles.statCard} ${styles.infoCard}`}>
          <div className={styles.statContent}>
            <span className={styles.statLabel}>Active Borrowings</span>
            <span className={styles.statValue}>{getActiveBorrowings()}</span>
          </div>
        </div>
        <div className={`${styles.statCard} ${styles.successCard}`}>
          <div className={styles.statContent}>
            <span className={styles.statLabel}>Total Value</span>
            <span className={styles.statValue}>{formatCurrency(getTotalValue())}</span>
          </div>
        </div>
      </div>

      {/* Low Stock Warning */}
      {getLowStockItems().length > 0 && (
        <div className={styles.alertWarning}>
          <strong>⚠️ Low Stock Alert:</strong> {getLowStockItems().length} items are below minimum stock level.
        </div>
      )}

      {/* Tabs Navigation */}
      <div className={styles.tabsContainer}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tabValue === 0 ? styles.activeTab : ''}`}
            onClick={() => setTabValue(0)}
          >
            <span className={styles.tabIcon}>📋</span>
            Inventory Items
          </button>
          <button
            className={`${styles.tab} ${tabValue === 1 ? styles.activeTab : ''}`}
            onClick={() => setTabValue(1)}
          >
            <span className={styles.tabIcon}>📚</span>
            Borrowing History
          </button>
          {canEdit && (
            <button
              className={`${styles.tab} ${tabValue === 2 ? styles.activeTab : ''}`}
              onClick={() => setTabValue(2)}
            >
              <span className={styles.tabIcon}>🏷️</span>
              Categories
            </button>
          )}
        </div>
      </div>

      {/* Add Item Button */}
      {canEdit && tabValue === 0 && (
        <div className={styles.actionBar}>
          <button
            className={styles.primaryButton}
            onClick={() => handleOpenDialog()}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add New Item
          </button>
        </div>
      )}

      {/* Inventory Table */}
      {tabValue === 0 && (
        <div className={styles.tableContainer}>
          {loading ? (
            <div className={styles.loadingContainer}>
              <div className={styles.spinner}></div>
              <p>Loading inventory...</p>
            </div>
          ) : inventory.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>📦</span>
              <h3>No inventory items found</h3>
              <p>Add your first item to get started!</p>
              {canEdit && (
                <button
                  className={styles.primaryButton}
                  onClick={() => handleOpenDialog()}
                >
                  Add First Item
                </button>
              )}
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Item Name</th>
                  <th>Category</th>
                  <th className={styles.textRight}>Quantity</th>
                  <th className={styles.textRight}>Price</th>
                  <th>Storage Location</th>
                  <th>Status</th>
                  <th className={styles.textCenter}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item) => (
                  <tr key={item.id} className={item.quantity <= (item.minQuantity || 5) ? styles.lowStockRow : ''}>
                    <td>
                      <div className={styles.itemName}>
                        <strong>{item.name}</strong>
                        {item.description && (
                          <small className={styles.itemDescription}>
                            {item.description.substring(0, 60)}...
                          </small>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={styles.categoryBadge}>
                        {item.category}
                      </span>
                    </td>
                    <td className={styles.textRight}>
                      <div className={styles.quantityCell}>
                        <span>{item.quantity} pcs</span>
                        {item.quantity <= (item.minQuantity || 5) && (
                          <span className={styles.warningIcon}>⚠️</span>
                        )}
                      </div>
                    </td>
                    <td className={styles.textRight}>
                      {formatCurrency(item.amount || 0)}
                    </td>
                    <td>{item.storageLocation}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${item.quantity > 0 ? styles.statusInStock : styles.statusOutOfStock}`}>
                        {item.quantity > 0 ? 'In Stock' : 'Out of Stock'}
                      </span>
                    </td>
                    <td className={styles.textCenter}>
                      <div className={styles.actionButtons}>
                        {/* Borrow */}
                        <button
                          className={styles.actionButton}
                          onClick={() => handleOpenBorrowDialog(item)}
                          disabled={item.quantity === 0}
                          title={item.quantity === 0 ? 'Out of stock' : 'Borrow item'}
                          aria-label="Borrow item"
                        >
                          <svg className={styles.actionIcon} xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          <span>Borrow</span>
                        </button>

                        {canEdit && (
                          <>
                            <div className={styles.actionDivider} />

                            {/* Edit */}
                            <button
                              className={`${styles.actionButton} ${styles.editButton}`}
                              onClick={() => handleOpenDialog(item)}
                              title="Edit item"
                              aria-label="Edit item"
                            >
                              <svg className={styles.actionIcon} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              <span>Edit</span>
                            </button>

                            {/* Delete */}
                            <button
                              className={`${styles.actionButton} ${styles.deleteButton}`}
                              onClick={() => {
                                if (window.confirm(`Delete "${item.name}"? This cannot be undone.`)) {
                                  deleteInventoryItem(item.id);
                                }
                              }}
                              title="Delete item"
                              aria-label="Delete item"
                            >
                              <svg className={styles.actionIcon} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                              <span>Delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Borrowing History Table */}
      {tabValue === 1 && (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item Name</th>
                <th>Borrower</th>
                <th>Borrow Date</th>
                <th>Expected Return</th>
                <th>Quantity</th>
                <th>Purpose</th>
                <th>Status</th>
                <th className={styles.textCenter}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {borrowedItems.length === 0 ? (
                <tr>
                  <td colSpan="8" className={styles.textCenter}>
                    <div className={styles.emptyState}>
                      <span className={styles.emptyIcon}>📚</span>
                      <p>No borrowing history found</p>
                    </div>
                  </td>
                </tr>
              ) : (
                borrowedItems.map((log) => (
                  <tr key={log.id}>
                    <td>{log.itemName}</td>
                    <td>{log.borrowerName}</td>
                    <td>{formatDate(log.borrowDate)}</td>
                    <td>{log.expectedReturnDate ? new Date(log.expectedReturnDate).toLocaleDateString() : 'Not specified'}</td>
                    <td>{log.quantityBorrowed} pcs</td>
                    <td>{log.purpose}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${log.returned ? styles.statusReturned : styles.statusBorrowed}`}>
                        {log.returned ? '✅ Returned' : '⏳ Borrowed'}
                      </span>
                    </td>
                    <td className={styles.textCenter}>
                      {!log.returned && (
                        <button
                          className={styles.successButton}
                          onClick={() => handleOpenReturnDialog(log)}
                          title="Mark as returned"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          Mark Returned
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Categories Tab */}
      {tabValue === 2 && canEdit && (
        <div className={styles.categoriesContainer}>
          <div className={styles.categoriesList}>
            {categories.map((category) => (
              <div key={category} className={styles.categoryItem}>
                <span className={styles.categoryIcon}>🏷️</span>
                <span className={styles.categoryName}>{category}</span>
                <button className={styles.deleteCategoryButton}>🗑️</button>
              </div>
            ))}
          </div>
          <div className={styles.addCategoryForm}>
            <input
              type="text"
              placeholder="Add new category..."
              className={styles.categoryInput}
            />
            <button className={styles.primaryButton}>Add Category</button>
          </div>
        </div>
      )}

      {/* Add/Edit Item Dialog */}
      {openDialog && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>{selectedItem ? 'Edit Inventory Item' : 'Add New Inventory Item'}</h2>
              <button className={styles.closeButton} onClick={handleCloseDialog}>
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <label htmlFor="name">Item Name *</label>
                  <input
                    type="text"
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className={styles.formInput}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="category">Category *</label>
                  <select
                    id="category"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    required
                    className={styles.formSelect}
                  >
                    <option value="">Select a category</option>
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="quantity">Quantity *</label>
                  <input
                    type="number"
                    id="quantity"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    required
                    min="0"
                    className={styles.formInput}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="amount">Price (₱) *</label>
                  <input
                    type="number"
                    id="amount"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    required
                    min="0"
                    step="0.01"
                    className={styles.formInput}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="storageLocation">Storage Location *</label>
                  <input
                    type="text"
                    id="storageLocation"
                    value={formData.storageLocation}
                    onChange={(e) => setFormData({ ...formData, storageLocation: e.target.value })}
                    required
                    className={styles.formInput}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="minQuantity">Minimum Quantity Alert</label>
                  <input
                    type="number"
                    id="minQuantity"
                    value={formData.minQuantity}
                    onChange={(e) => setFormData({ ...formData, minQuantity: e.target.value })}
                    min="0"
                    className={styles.formInput}
                  />
                  <small className={styles.helperText}>Low stock alert threshold</small>
                </div>
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="description">Description</label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows="3"
                  className={styles.formTextarea}
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.fileUploadLabel}>
                  <span className={styles.fileUploadButton}>📎 Upload Receipt (Optional)</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleReceiptUpload}
                    className={styles.fileInput}
                  />
                </label>
                {formData.receipt && (
                  <span className={styles.fileUploadStatus}>✓ Receipt uploaded</span>
                )}
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.secondaryButton} onClick={handleCloseDialog}>
                  Cancel
                </button>
                <button type="submit" className={styles.primaryButton}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  {selectedItem ? 'Save Changes' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Borrow Item Dialog */}
      {openBorrowDialog && selectedItem && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Borrow Item: {selectedItem.name}</h2>
              <button className={styles.closeButton} onClick={() => setOpenBorrowDialog(false)}>
                &times;
              </button>
            </div>
            <form onSubmit={handleBorrowSubmit} className={styles.form}>
              <div className={styles.formGroup}>
                <label htmlFor="borrowerName">Borrower Name *</label>
                <input
                  type="text"
                  id="borrowerName"
                  value={borrowForm.borrowerName}
                  onChange={(e) => setBorrowForm({ ...borrowForm, borrowerName: e.target.value })}
                  required
                  className={styles.formInput}
                />
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="borrowerEmail">Borrower Email *</label>
                <input
                  type="email"
                  id="borrowerEmail"
                  value={borrowForm.borrowerEmail}
                  onChange={(e) => setBorrowForm({ ...borrowForm, borrowerEmail: e.target.value })}
                  required
                  className={styles.formInput}
                />
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="quantityBorrowed">Quantity to Borrow *</label>
                <input
                  type="number"
                  id="quantityBorrowed"
                  value={borrowForm.quantityBorrowed}
                  onChange={(e) => setBorrowForm({ ...borrowForm, quantityBorrowed: e.target.value })}
                  required
                  min="1"
                  max={selectedItem.quantity}
                  className={styles.formInput}
                />
                <small className={styles.helperText}>
                  Available: {selectedItem.quantity} pieces
                </small>
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="purpose">Purpose *</label>
                <input
                  type="text"
                  id="purpose"
                  value={borrowForm.purpose}
                  onChange={(e) => setBorrowForm({ ...borrowForm, purpose: e.target.value })}
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
                  onChange={(e) => setBorrowForm({ ...borrowForm, expectedReturnDate: e.target.value })}
                  className={styles.formInput}
                />
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => setOpenBorrowDialog(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={borrowForm.quantityBorrowed > selectedItem.quantity}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Confirm Borrow
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Return Item Dialog */}
      {openReturnDialog && selectedBorrowLog && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Return Item: {selectedBorrowLog.itemName}</h2>
              <button className={styles.closeButton} onClick={() => setOpenReturnDialog(false)}>
                &times;
              </button>
            </div>
            <form onSubmit={handleReturnSubmit} className={styles.form}>
              <div className={styles.formGroup}>
                <label htmlFor="condition">Condition on Return</label>
                <select
                  id="condition"
                  value={returnForm.condition}
                  onChange={(e) => setReturnForm({ ...returnForm, condition: e.target.value })}
                  className={styles.formSelect}
                >
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="poor">Poor</option>
                  <option value="damaged">Damaged</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="notes">Return Notes</label>
                <textarea
                  id="notes"
                  value={returnForm.notes}
                  onChange={(e) => setReturnForm({ ...returnForm, notes: e.target.value })}
                  rows="3"
                  className={styles.formTextarea}
                  placeholder="Any notes about the return condition or issues..."
                />
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => setOpenReturnDialog(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.successButton}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Confirm Return
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryManagement;