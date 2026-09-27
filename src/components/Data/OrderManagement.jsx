import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase/firebaseConfig.js';
import { collection, onSnapshot, deleteDoc, doc, updateDoc, getDocs, writeBatch } from 'firebase/firestore';
import { Search, Edit2, Trash2, AlertCircle, Package, Clock, CheckCircle, DollarSign, Check, X, ClockIcon, CreditCard, Truck, FileSpreadsheet } from 'lucide-react';
import Order from '../Order/order.jsx';
import SheetSyncPanel from './SheetSyncPanel.jsx';
import styles from './OrderManagement.module.css';

function OrderManagement() {
  // ========================================
  // STATE MANAGEMENT
  // ========================================
  
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Navigation state
  const [activeSection, setActiveSection] = useState('dashboard');
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  
  // Toast notification state
  const [toast, setToast] = useState({ isOpen: false, message: '', type: 'success' });
  const showToast = (msg, type = 'success') => {
    setToast({ isOpen: true, message: msg, type });
    setTimeout(() => setToast({ isOpen: false, message: '', type: 'success' }), 3000);
  };
  
  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    orderId: '',
    currentStatus: '',
    newStatus: '',
    order: null,
    docId: ''
  });
  
  // Filter states
  const [statusFilter, setStatusFilter] = useState('All');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Pagination
  const [page, setPage] = useState(1);
  const PER_PAGE = 10;
  const [selectedOrders, setSelectedOrders] = useState([]);

  // ========================================
  const [bulkDeleteModal, setBulkDeleteModal] = useState(false);

  // FETCH ORDERS FROM FIREBASE
  // ========================================
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'orders'),
      (snapshot) => {
        const ordersData = snapshot.docs.map((doc) => ({
          docId: doc.id,
          ...doc.data(),
        }));
        
        // Sort by date (newest first)
        ordersData.sort((a, b) => {
          const dateA = a.dateOrdered?.toDate?.() || new Date(a.createdAt);
          const dateB = b.dateOrdered?.toDate?.() || new Date(b.createdAt);
          return dateB - dateA;
        });

        setOrders(ordersData);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching orders:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // ========================================
  // UPDATE ORDER STATUS
  // ========================================
  const updateOrderStatus = async (docId, newStatus, order) => {
    // Show loading toast (optional)
    showToast(`Updating order ${order.orderId}...`, 'info');

    try {
      const oldStatus = order.orderStatus;
      
      // Handle stock deduction when order is marked as Completed
      if (newStatus === 'Completed' && oldStatus !== 'Completed' && oldStatus !== 'Cancelled') {
        // Deduct stock when completing an order
        const productId = order.productInfo?.productId;
        const quantity = order.productInfo?.quantity || 0;

        if (productId && quantity > 0) {
          // Find the product document
          const productsSnapshot = await getDocs(collection(db, 'products'));
          const productDoc = productsSnapshot.docs.find(
            doc => doc.data().productId === productId
          );

          if (productDoc) {
            const currentStock = productDoc.data().stockAvailable || 0;
            const newStock = currentStock - quantity; // Deduct stock

            if (newStock < 0) {
              showToast(`Cannot complete order: Insufficient stock!`, 'error');
              return;
            }

            await updateDoc(doc(db, 'products', productDoc.id), {
              stockAvailable: newStock,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      // Handle stock restoration when order is cancelled
      if (newStatus === 'Cancelled' && oldStatus !== 'Cancelled') {
        // Only restore stock if order was already completed
        if (oldStatus === 'Completed') {
          const productId = order.productInfo?.productId;
          const quantity = order.productInfo?.quantity || 0;

          if (productId && quantity > 0) {
            // Find the product document
            const productsSnapshot = await getDocs(collection(db, 'products'));
            const productDoc = productsSnapshot.docs.find(
              doc => doc.data().productId === productId
            );

            if (productDoc) {
              const currentStock = productDoc.data().stockAvailable || 0;
              const newStock = currentStock + quantity; // Restore stock

              await updateDoc(doc(db, 'products', productDoc.id), {
                stockAvailable: newStock,
                updatedAt: new Date().toISOString(),
              });
            }
          }
        }
      }

      // Handle stock restoration when changing from Completed to another status
      if (oldStatus === 'Completed' && newStatus !== 'Completed' && newStatus !== 'Cancelled') {
        // Restore stock when un-completing an order
        const productId = order.productInfo?.productId;
        const quantity = order.productInfo?.quantity || 0;

        if (productId && quantity > 0) {
          // Find the product document
          const productsSnapshot = await getDocs(collection(db, 'products'));
          const productDoc = productsSnapshot.docs.find(
            doc => doc.data().productId === productId
          );

          if (productDoc) {
            const currentStock = productDoc.data().stockAvailable || 0;
            const newStock = currentStock + quantity; // Restore stock

            await updateDoc(doc(db, 'products', productDoc.id), {
              stockAvailable: newStock,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      // Update order status
      await updateDoc(doc(db, 'orders', docId), {
        orderStatus: newStatus,
        updatedAt: new Date().toISOString()
      });
      
      // Show success state
      showToast(`Order status updated to ${newStatus}`, 'success');
      
    } catch (error) {
      console.error('Error updating order status:', error);
      
      // Show error state
      showToast('Failed to update order status. Please try again.', 'error');
      
      // No auto‑close needed for toast (handled in showToast)
    }
  };

  // ========================================
  // STATUS CHANGE HANDLERS
  // ========================================
  const handleStatusChange = (order, newStatus) => {
    // Show confirmation modal instead of browser confirm
    setConfirmModal({
      isOpen: true,
      orderId: order.orderId,
      currentStatus: order.orderStatus,
      newStatus: newStatus,
      order: order,
      docId: order.docId
    });
  };
  
  const handleConfirmStatusChange = () => {
    // Close confirmation modal
    setConfirmModal({
      isOpen: false,
      orderId: '',
      currentStatus: '',
      newStatus: '',
      order: null,
      docId: ''
    });
    
    // Proceed with status update
    updateOrderStatus(confirmModal.docId, confirmModal.newStatus, confirmModal.order);
  };
  
  const handleCancelStatusChange = () => {
    // Close confirmation modal
    setConfirmModal({ isOpen: false, orderId: '', currentStatus: '', newStatus: '', order: null, docId: '' });
  };

  // Bulk delete modal state


  // Open bulk delete confirmation modal
  const openBulkDeleteModal = () => {
    if (selectedOrders.length === 0) return;
    setBulkDeleteModal(true);
  };

  // Close bulk delete modal
  const closeBulkDeleteModal = () => {
    setBulkDeleteModal(false);
  };

  // Perform bulk deletion after confirmation
  const handleBulkDelete = async () => {
    const ordersToDelete = orders.filter(o => selectedOrders.includes(o.docId));
    if (ordersToDelete.length === 0) {
      closeBulkDeleteModal();
      return;
    }
    const batch = writeBatch(db);
    for (const order of ordersToDelete) {
      // Restore stock if order was completed
      if (order.orderStatus === 'Completed') {
        const productId = order.productInfo?.productId;
        const quantity = order.productInfo?.quantity || 0;
        if (productId && quantity > 0) {
          const productsSnapshot = await getDocs(collection(db, 'products'));// eslint-disable-next-line no-await-in-loop
          const productDoc = productsSnapshot.docs.find(doc => doc.data().productId === productId);
          if (productDoc) {
            const currentStock = productDoc.data().stockAvailable || 0;
            const newStock = currentStock + quantity;
            await updateDoc(doc(db, 'products', productDoc.id), { stockAvailable: newStock, updatedAt: new Date().toISOString() });
          }
        }
      }
      // Queue order deletion
      const orderRef = doc(db, 'orders', order.docId);
      batch.delete(orderRef);
    }
    await batch.commit();
    setSelectedOrders([]);
    closeBulkDeleteModal();
    showToast(`${ordersToDelete.length} order(s) deleted successfully.`, 'success');
  };

  // Delete all orders instantly
  const handleDeleteAllOrders = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'orders'));
      const deletePromises = snapshot.docs.map((docSnap) => deleteDoc(doc(db, 'orders', docSnap.id)));
      await Promise.all(deletePromises);
      // Clear local state
      setOrders([]);
      setSelectedOrders([]);
    } catch (error) {
      console.error('Error deleting all orders:', error);
    }
  };


  // Toggle select all visible rows
  const toggleSelectAll = (e) => {
    if (e.target.checked) {
      const ids = orders.map((o) => o.docId);
      setSelectedOrders(Array.from(new Set(ids)));
    } else {
      setSelectedOrders([]);
    }
  };

  // Toggle individual row selection
  const toggleSelectOrder = (docId) => {
    setSelectedOrders((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const toggleClaimStatus = async (order) => {
    const newClaimed = !(order.claimed ?? false);
    const newStatus = newClaimed ? 'Claimed' : 'Unclaimed';
    try {
      await updateDoc(doc(db, 'orders', order.docId), {
        claimed: newClaimed,
        orderStatus: newStatus,
        updatedAt: new Date().toISOString(),
      });
      showToast(`Order ${order.orderId} marked as ${newStatus}.`, 'success');
    } catch (err) {
      console.error('Error toggling claim status:', err);
      showToast('Failed to update claim status.', 'error');
    }
  };



  // ========================================
  // FILTER ORDERS (MEMOIZED)
  // ========================================
  const filteredOrders = useMemo(() => {
    let result = orders;

    // Filter by status
    if (statusFilter !== 'All') {
      result = result.filter(order => order.orderStatus === statusFilter);
    }

    // Filter by payment method
    if (paymentFilter !== 'All') {
      result = result.filter(order => order.paymentInfo?.paymentMethod === paymentFilter);
    }

    // Search by order ID or customer name
    if (searchQuery.trim()) {
      result = result.filter(order =>
        order.orderId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.customerInfo?.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.customerInfo?.email?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return result;
  }, [statusFilter, paymentFilter, searchQuery, orders]);

  // ========================================
  // STATISTICS CALCULATION
  // ========================================
  const getStatistics = () => {
    const claimedOrders = orders.filter(o => o.claimed || o.orderStatus === 'Claimed');
    const unclaimedOrders = orders.filter(o => !o.claimed && o.orderStatus !== 'Claimed');

    return {
      total: orders.length,
      claimed: claimedOrders.length,
      unclaimed: unclaimedOrders.length,
      totalRevenue: claimedOrders.reduce((sum, order) => sum + (order.productInfo?.totalPrice || 0), 0),
    };
  };

  const stats = getStatistics();

  // ========================================
  // MODAL HANDLERS
  // ========================================
  const handleEditClick = (order) => {
    setSelectedOrder(order);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedOrder(null);
  };

  const handleFormSuccess = () => {
    handleModalClose();
    // Optional: Add toast notification
  };

  // ========================================
  // DELETE ORDER
  // ========================================
  const handleDeleteOrder = async (docId, orderId, order) => {
    


    try {
      // Restore stock ONLY if order was Completed (stock was already deducted)
      if (order.orderStatus === 'Completed') {
        const productId = order.productInfo?.productId;
        const quantity = order.productInfo?.quantity || 0;

        if (productId && quantity > 0) {
          // Find the product document
          const productsSnapshot = await getDocs(collection(db, 'products'));
          const productDoc = productsSnapshot.docs.find(
            doc => doc.data().productId === productId
          );

          if (productDoc) {
            const currentStock = productDoc.data().stockAvailable || 0;
            const newStock = currentStock + quantity; // Restore stock

            await updateDoc(doc(db, 'products', productDoc.id), {
              stockAvailable: newStock,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      // Delete the order
      await deleteDoc(doc(db, 'orders', docId));

      if (order.orderStatus === 'Completed') {
        showToast('Order deleted. Stock has been restored.', 'success');
      } else {
        showToast('Order deleted successfully.', 'success');
      }
    } catch (error) {
      console.error('Error deleting order:', error);
      showToast('Error deleting order. Please try again.', 'error');
    }
  };

  // ========================================
  // FORMAT DATE
  // ========================================
  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    
    let date;
    if (timestamp.toDate) {
      date = timestamp.toDate();
    } else {
      date = new Date(timestamp);
    }

    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // ========================================
  // GET STATUS STYLE
  // ========================================
  const getStatusColor = (status) => {
    switch (status) {
      case 'Pending': return '#fff3cd';
      case 'Paid': return '#d1e7dd';
      case 'Ongoing': return '#cfe2ff';
      case 'Completed': return '#d1e7dd';
      case 'Claimed': return '#d1e7dd';
      case 'Unclaimed': return '#fff3cd';
      case 'Cancelled': return '#f8d7da';
      default: return '#e2e3e5';
    }
  };

  const getStatusTextColor = (status) => {
    switch (status) {
      case 'Pending': return '#856404';
      case 'Paid': return '#0f5132';
      case 'Ongoing': return '#084298';
      case 'Completed': return '#0f5132';
      case 'Claimed': return '#0f5132';
      case 'Unclaimed': return '#856404';
      case 'Cancelled': return '#842029';
      default: return '#41464b';
    }
  };

  // ========================================
  // PAGINATION
  // ========================================
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PER_PAGE));
  const paginatedOrders = filteredOrders.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ========================================
  // RENDER DASHBOARD VIEW
  // ========================================
  const renderDashboardView = () => (
    <div className={styles.dashboardView}>
      {/* KPI Row */}
      <div className={styles.kpiRow}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiCardHeader}>
            <span className={styles.kpiCardLabel}>Total Orders</span>
            <span className={styles.kpiCardIcon}>
              <Package size={20} />
            </span>
          </div>
          <p className={styles.kpiCardValue}>{stats.total}</p>
          <p className={styles.kpiCardSub}>all time orders</p>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiCardHeader}>
            <span className={styles.kpiCardLabel}>Claimed Orders</span>
            <span className={styles.kpiCardIcon}>
              <CheckCircle size={20} />
            </span>
          </div>
          <p className={styles.kpiCardValue}>{stats.claimed}</p>
          <p className={styles.kpiCardSub}>fulfilled & claimed</p>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiCardHeader}>
            <span className={styles.kpiCardLabel}>Unclaimed Orders</span>
            <span className={styles.kpiCardIcon}>
              <Clock size={20} />
            </span>
          </div>
          <p className={styles.kpiCardValue}>{stats.unclaimed}</p>
          <p className={styles.kpiCardSub}>pending pickup/claim</p>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiCardHeader}>
            <span className={styles.kpiCardLabel}>Claimed Revenue</span>
            <span className={styles.kpiCardIcon}>
              <DollarSign size={20} />
            </span>
          </div>
          <p className={styles.kpiCardValue}>₱{stats.totalRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className={styles.kpiCardSub}>revenue from claimed orders</p>
        </div>
      </div>
    </div>
  );

  // ========================================
  // RENDER ORDERS TABLE VIEW
  // ========================================
  const renderOrdersTableView = () => (
    <div className={styles.ordersView}>
      {/* Toolbar */}
      <div className={styles.productsToolbar}>
        <div className={styles.productsToolbarLeft}>
          <div className={styles.searchWrapper}>
            <Search className={styles.searchIcon} size={16} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search by Order ID, Name, or Email..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className={styles.filterSelect}
          >
            <option value="All">All Status</option>
            <option value="Pending">Pending</option>
            <option value="Paid">Paid</option>
            <option value="Ongoing">Ongoing</option>
            <option value="Completed">Completed</option>
            <option value="Claimed">Claimed</option>
            <option value="Unclaimed">Unclaimed</option>
            <option value="Cancelled">Cancelled</option>
          </select>

          <select
            value={paymentFilter}
            onChange={(e) => { setPaymentFilter(e.target.value); setPage(1); }}
            className={styles.filterSelect}
          >
            <option value="All">All Methods</option>
            <option value="Cash">Cash</option>
            <option value="Online">Online</option>
          </select>
        </div>

        <div className={styles.productsToolbarRight}>
            <button
              type="button"
              className={styles.syncToolbarBtn}
              onClick={() => setActiveSection('settings')}
              title="Import and dynamically sync orders from Excel or Google Sheets"
            >
              <FileSpreadsheet size={16} />
              Sync Sheet / Excel
            </button>
            {/* Bulk Delete */}
            <button
              type="button"
              className={styles.syncToolbarBtn}
              onClick={openBulkDeleteModal}
              disabled={selectedOrders.length === 0}
              title="Delete selected orders"
            >
              <Trash2 size={16} />
              Delete Selected
            </button>
            <button
              type="button"
              className={styles.syncToolbarBtn}
              onClick={handleDeleteAllOrders}
              disabled={orders.length === 0}
              title="Delete all orders"
            >
              <Trash2 size={16} />
              Delete All
            </button>
            {/* Selected count */}
            {selectedOrders.length > 0 && (
              <span className={styles.selectionInfo}>Selected: {selectedOrders.length}</span>
            )}
        </div>
      </div>

      {/* Table */}
      <div className={styles.tableWrapper}>
        {loading ? (
          <div className={styles.emptyState}>
            <p>Loading orders...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className={styles.emptyState}>
            <AlertCircle size={48} style={{ margin: '0 auto 10px', display: 'block', color: '#94a3b8' }} />
            <p>
              {orders.length === 0 
                ? 'No orders yet. Orders will appear here once customers place them.'
                : 'No orders match your filters.'}
            </p>
          </div>
        ) : (
          <table className={styles.orderTable}>
            <thead>
              <tr>
                <th><input type="checkbox" onChange={toggleSelectAll} checked={paginatedOrders.length > 0 && paginatedOrders.every((o) => selectedOrders.includes(o.docId))} /></th>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Total</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Date</th>

              </tr>
            </thead>
            <tbody>
              {paginatedOrders.map((order) => (
                <tr key={order.docId} className={styles.tableRow}>
                  <td><input type="checkbox" checked={selectedOrders.includes(order.docId)} onChange={() => toggleSelectOrder(order.docId)} /></td>
                  <td className={styles.orderIdCell}>{order.orderId}</td>
                  <td>
                    <div className={styles.customerCell}>
                      <span className={styles.customerName}>{order.customerInfo?.fullName}</span>
                      <span className={styles.customerEmail}>{order.customerInfo?.email}</span>
                    </div>
                  </td>
                  <td>
                    <div className={styles.productCell}>
                      <span className={styles.productName}>{order.productInfo?.productName}</span>
                      {(order.productInfo?.size !== 'N/A' || order.productInfo?.color !== 'N/A') && (
                        <span className={styles.productVariant}>
                          {order.productInfo?.size !== 'N/A' && `Size: ${order.productInfo?.size}`}
                          {order.productInfo?.size !== 'N/A' && order.productInfo?.color !== 'N/A' && ' • '}
                          {order.productInfo?.color !== 'N/A' && `Color: ${order.productInfo?.color}`}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={styles.quantityCell}>
                    <span>{order.productInfo?.quantity}</span>
                  </td>
                  <td className={styles.priceCell}>₱{order.productInfo?.totalPrice?.toFixed(2)}</td>
                  <td>
                      <span 
                        className={styles.statusBadge}
                        style={{
                          backgroundColor: getStatusColor(order.orderStatus),
                          color: getStatusTextColor(order.orderStatus)
                        }}
                      >
                        {order.orderStatus}
                      </span>
                      <span 
                        className={order.claimed ? styles.claimBadgeClaimed : styles.claimBadgeUnclaimed}
                      >
                        {order.claimed ? "Claimed" : "Unclaimed"}
                      </span>
                  </td>
                  <td>
                    <span className={styles.paymentBadge}>
                      {order.paymentInfo?.paymentMethod}
                    </span>
                  </td>
                  <td className={styles.dateCell}>{formatDate(order.dateOrdered)}</td>
                  <td>
                    <button
                      className={styles.claimBtn}
                      onClick={() => toggleClaimStatus(order)}
                      title={order.claimed ? "Mark as Unclaimed" : "Mark as Claimed"}
                    >
                      {order.claimed ? <X size={14} /> : <CheckCircle size={14} />}
                      {order.claimed ? "Unclaim" : "Claim"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
{bulkDeleteModal && (
  <div className={styles.modalOverlay}>
    <div className={styles.modalContent}>
      <h3>Confirm Bulk Delete</h3>
      <p>Delete {selectedOrders.length} selected order(s)? This action cannot be undone.</p>
      <div className={styles.modalButtons}>
        <button className={styles.modalButtonCancel} onClick={closeBulkDeleteModal}>Cancel</button>
        <button className={styles.modalButtonConfirm} onClick={handleBulkDelete}>Delete</button>
      </div>
    </div>
  </div>
)}



      {filteredOrders.length > 0 && (
        <div className={styles.pagination}>
          <span className={styles.paginationInfo}>
            Showing {filteredOrders.length === 0 ? 0 : (page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, filteredOrders.length)} of {filteredOrders.length}
          </span>
          <div className={styles.paginationControls}>
            <button
              className={styles.paginationBtn}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              ← Previous
            </button>
            <span className={styles.paginationPage}>{page} / {totalPages}</span>
            <button
              className={styles.paginationBtn}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ========================================
  // RENDER SETTINGS VIEW
  // ========================================
  const renderSettingsView = () => (
    <div className={styles.settingsView}>
      <SheetSyncPanel />
    </div>
  );

  // ========================================
  // RENDER
  // ========================================
  return (
    <div className={styles.container}>
      {toast.isOpen && (
        <div className={styles.toast} data-type={toast.type}>{toast.message}</div>
      )}
      
      {/* Internal Tab Navigation */}
      <div className={styles.omTabNav}>
        <button
          className={`${styles.omTabBtn} ${activeSection === 'dashboard' ? styles.omTabBtnActive : ''}`}
          onClick={() => setActiveSection('dashboard')}
        >
          📊 Dashboard
        </button>
        <button
          className={`${styles.omTabBtn} ${activeSection === 'orders' ? styles.omTabBtnActive : ''}`}
          onClick={() => setActiveSection('orders')}
        >
          📦 Orders
          <span className={styles.omTabBadge}>{orders.length}</span>
        </button>
        <button
          className={`${styles.omTabBtn} ${activeSection === 'settings' ? styles.omTabBtnActive : ''}`}
          onClick={() => setActiveSection('settings')}
        >
          📊 Sheet & Excel Sync
        </button>
      </div>

      <div className={styles.viewContent}>
        {/* Render views based on active section */}
        {activeSection === 'dashboard' && renderDashboardView()}
        {activeSection === 'orders' && renderOrdersTableView()}
        {activeSection === 'settings' && (
          <div className={styles.settingsView}>
            <SheetSyncPanel onSyncCompleted={() => {
              // Switch to orders view after brief delay so user can immediately see synced orders
              setTimeout(() => setActiveSection('orders'), 1200);
            }} />
          </div>
        )}
      </div>

      {/* EDIT MODAL */}
      {isModalOpen && (
        <div className={styles.modalOverlay} onClick={handleModalClose}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <Order 
              editingOrder={selectedOrder}
              onSuccess={handleFormSuccess}
            />
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL */}
      {confirmModal.isOpen && (
        <div className={styles.confirmModalOverlay}>
          <div className={styles.confirmModalContent}>
            <div className={styles.confirmModalIcon}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
            </div>
            <h3 className={styles.confirmModalTitle}>Confirm Status Change</h3>
            <p className={styles.confirmModalMessage}>
              Change order <strong>{confirmModal.orderId}</strong> status to <strong className={styles.confirmStatusBadge}>{confirmModal.newStatus}</strong>?
            </p>
            <div className={styles.confirmModalActions}>
              <button 
                className={styles.confirmCancelBtn}
                onClick={handleCancelStatusChange}
              >
                Cancel
              </button>
              <button 
                className={styles.confirmOkBtn}
                onClick={handleConfirmStatusChange}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}



    </div>
  );
}

export default OrderManagement;