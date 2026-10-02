import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../../firebase/firebaseConfig.js';
import { collection, onSnapshot, deleteDoc, doc, updateDoc, getDocs, writeBatch } from 'firebase/firestore';
import { Search, Edit2, Trash2, AlertCircle, Package, Clock, CheckCircle, DollarSign, Check, X, ClockIcon, CreditCard, Truck, FileSpreadsheet, ChevronDown, ChevronUp, MoreVertical, SlidersHorizontal } from 'lucide-react';
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

  // Mobile-specific state
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const mobileToolsRef = useRef(null);

  // Close mobile tools on outside click
  useEffect(() => {
    const handleOutside = (e) => {
      if (mobileToolsRef.current && !mobileToolsRef.current.contains(e.target)) {
        setMobileToolsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

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
  // MOBILE CARD TOGGLE
  // ========================================
  const toggleCardExpand = (orderId) => {
    setExpandedOrderId(prev => prev === orderId ? null : orderId);
  };

  const toggleMobileSelect = (docId) => {
    setSelectedOrders(prev =>
      prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]
    );
  };

  // ========================================
  // GET STATUS CHIP COLOR (mobile dark theme)
  // ========================================
  const getMobileStatusStyle = (status) => {
    switch (status) {
      case 'Pending':    return { bg: 'rgba(234,179,8,0.15)',   color: '#fbbf24', border: 'rgba(234,179,8,0.3)' };
      case 'Paid':       return { bg: 'rgba(16,185,129,0.15)',  color: '#34d399', border: 'rgba(16,185,129,0.3)' };
      case 'Ongoing':    return { bg: 'rgba(59,130,246,0.15)',  color: '#60a5fa', border: 'rgba(59,130,246,0.3)' };
      case 'Completed':  return { bg: 'rgba(16,185,129,0.15)',  color: '#34d399', border: 'rgba(16,185,129,0.3)' };
      case 'Claimed':    return { bg: 'rgba(16,185,129,0.2)',   color: '#6ee7b7', border: 'rgba(16,185,129,0.4)' };
      case 'Unclaimed':  return { bg: 'rgba(234,179,8,0.15)',   color: '#fbbf24', border: 'rgba(234,179,8,0.3)' };
      case 'Cancelled':  return { bg: 'rgba(239,68,68,0.15)',   color: '#f87171', border: 'rgba(239,68,68,0.3)' };
      default:           return { bg: 'rgba(148,163,184,0.15)', color: '#94a3b8', border: 'rgba(148,163,184,0.3)' };
    }
  };

  // ========================================
  // RENDER MOBILE ORDERS VIEW
  // ========================================
  const renderMobileOrdersView = () => {
    const STATUS_FILTERS = ['All', 'Pending', 'Paid', 'Ongoing', 'Completed', 'Claimed', 'Unclaimed', 'Cancelled'];

    return (
      <div className={styles.mobileOrdersView}>

        {/* Mobile Header Bar */}
        <div className={styles.mobileHeader}>
          <div className={styles.mobileHeaderLeft}>
            <h2 className={styles.mobileHeaderTitle}>Orders</h2>
            <span className={styles.mobileOrderCount}>{filteredOrders.length}</span>
          </div>
          <div className={styles.mobileHeaderActions}>
            <button
              className={`${styles.mobileIconBtn} ${selectMode ? styles.mobileIconBtnActive : ''}`}
              onClick={() => { setSelectMode(s => !s); setSelectedOrders([]); }}
              title="Select mode"
            >
              <Check size={18} />
            </button>
            <div className={styles.mobileToolsWrapper} ref={mobileToolsRef}>
              <button
                className={`${styles.mobileIconBtn} ${mobileToolsOpen ? styles.mobileIconBtnActive : ''}`}
                onClick={() => setMobileToolsOpen(o => !o)}
                title="More tools"
              >
                <MoreVertical size={18} />
              </button>
              {mobileToolsOpen && (
                <div className={styles.mobileToolsMenu}>
                  <button className={styles.mobileToolsItem} onClick={() => { setActiveSection('settings'); setMobileToolsOpen(false); }}>
                    <FileSpreadsheet size={16} />
                    Sync Sheet / Excel
                  </button>
                  <button
                    className={`${styles.mobileToolsItem} ${styles.mobileToolsItemDanger}`}
                    onClick={() => { openBulkDeleteModal(); setMobileToolsOpen(false); }}
                    disabled={selectedOrders.length === 0}
                  >
                    <Trash2 size={16} />
                    Delete Selected ({selectedOrders.length})
                  </button>
                  <button
                    className={`${styles.mobileToolsItem} ${styles.mobileToolsItemDanger}`}
                    onClick={() => { handleDeleteAllOrders(); setMobileToolsOpen(false); }}
                    disabled={orders.length === 0}
                  >
                    <Trash2 size={16} />
                    Delete All Orders
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Stats Row */}
        <div className={styles.mobileStatsRow}>
          <div className={styles.mobileStatChip}>
            <span className={styles.mobileStatValue}>{stats.total}</span>
            <span className={styles.mobileStatLabel}>Total</span>
          </div>
          <div className={`${styles.mobileStatChip} ${styles.mobileStatChipGreen}`}>
            <span className={styles.mobileStatValue}>{stats.claimed}</span>
            <span className={styles.mobileStatLabel}>Claimed</span>
          </div>
          <div className={`${styles.mobileStatChip} ${styles.mobileStatChipAmber}`}>
            <span className={styles.mobileStatValue}>{stats.unclaimed}</span>
            <span className={styles.mobileStatLabel}>Unclaimed</span>
          </div>
          <div className={`${styles.mobileStatChip} ${styles.mobileStatChipBlue}`}>
            <span className={styles.mobileStatValue}>₱{stats.totalRevenue.toLocaleString('en-PH', { maximumFractionDigits: 0 })}</span>
            <span className={styles.mobileStatLabel}>Revenue</span>
          </div>
        </div>

        {/* Mobile Search */}
        <div className={styles.mobileSearchBar}>
          <Search size={16} className={styles.mobileSearchIcon} />
          <input
            type="text"
            className={styles.mobileSearchInput}
            placeholder="Search orders, names…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          />
          {searchQuery && (
            <button className={styles.mobileSearchClear} onClick={() => setSearchQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* Horizontal Filter Chips */}
        <div className={styles.mobileFilterChips}>
          {STATUS_FILTERS.map(f => (
            <button
              key={f}
              className={`${styles.mobileFilterChip} ${statusFilter === f ? styles.mobileFilterChipActive : ''}`}
              onClick={() => { setStatusFilter(f); setPage(1); }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Payment Filter Pills */}
        <div className={styles.mobilePaymentChips}>
          {['All', 'Cash', 'Online'].map(m => (
            <button
              key={m}
              className={`${styles.mobilePaymentChip} ${paymentFilter === m ? styles.mobilePaymentChipActive : ''}`}
              onClick={() => { setPaymentFilter(m); setPage(1); }}
            >
              {m === 'All' ? '💳 All Methods' : m === 'Cash' ? '💵 Cash' : '📲 Online'}
            </button>
          ))}
        </div>

        {/* Select Mode Banner */}
        {selectMode && selectedOrders.length > 0 && (
          <div className={styles.mobileSelectBanner}>
            <span>{selectedOrders.length} selected</span>
            <button className={styles.mobileSelectBannerBtn} onClick={openBulkDeleteModal}>
              <Trash2 size={14} /> Delete
            </button>
            <button className={styles.mobileSelectBannerClear} onClick={() => setSelectedOrders([])}>
              Clear
            </button>
          </div>
        )}

        {/* Order Cards */}
        {loading ? (
          <div className={styles.mobileEmptyState}>
            <div className={styles.mobileSpinner} />
            <p>Loading orders…</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className={styles.mobileEmptyState}>
            <AlertCircle size={40} />
            <p>{orders.length === 0 ? 'No orders yet.' : 'No orders match your filters.'}</p>
          </div>
        ) : (
          <div className={styles.mobileCardList}>
            {paginatedOrders.map((order) => {
              const isExpanded = expandedOrderId === order.docId;
              const isSelected = selectedOrders.includes(order.docId);
              const statusStyle = getMobileStatusStyle(order.orderStatus);
              const claimStyle = getMobileStatusStyle(order.claimed ? 'Claimed' : 'Unclaimed');

              return (
                <div
                  key={order.docId}
                  className={`${styles.mobileOrderCard} ${isExpanded ? styles.mobileOrderCardExpanded : ''} ${isSelected ? styles.mobileOrderCardSelected : ''}`}
                >
                  {/* Card Header — always visible */}
                  <div
                    className={styles.mobileCardHeader}
                    onClick={() => selectMode ? toggleMobileSelect(order.docId) : toggleCardExpand(order.docId)}
                  >
                    {/* Left: Select checkbox (select mode) or expand indicator */}
                    <div className={styles.mobileCardHeaderLeft}>
                      {selectMode ? (
                        <div className={`${styles.mobileCheckbox} ${isSelected ? styles.mobileCheckboxChecked : ''}`}>
                          {isSelected && <Check size={12} />}
                        </div>
                      ) : (
                        <div className={styles.mobileCardExpandIcon}>
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                      )}
                    </div>

                    {/* Center: Order info */}
                    <div className={styles.mobileCardInfo}>
                      <div className={styles.mobileCardTopRow}>
                        <span className={styles.mobileOrderId}>{order.orderId}</span>
                        <span
                          className={styles.mobileStatusPill}
                          style={{ background: statusStyle.bg, color: statusStyle.color, borderColor: statusStyle.border }}
                        >
                          {order.orderStatus}
                        </span>
                      </div>
                      <div className={styles.mobileCardBottomRow}>
                        <span className={styles.mobileCustomerName}>{order.customerInfo?.fullName}</span>
                        <span className={styles.mobileOrderPrice}>₱{order.productInfo?.totalPrice?.toFixed(2)}</span>
                      </div>
                      <div className={styles.mobileCardMeta}>
                        <span className={styles.mobileProductName}>{order.productInfo?.productName}</span>
                        <span
                          className={styles.mobileClaimPill}
                          style={{ background: claimStyle.bg, color: claimStyle.color }}
                        >
                          {order.claimed ? '✓ Claimed' : '○ Unclaimed'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details — bottom sheet panel */}
                  {isExpanded && (
                    <div className={styles.mobileCardDetails}>
                      <div className={styles.mobileDetailsDivider} />

                      {/* Customer Section */}
                      <div className={styles.mobileDetailsSection}>
                        <span className={styles.mobileDetailsSectionTitle}>👤 Customer</span>
                        <div className={styles.mobileDetailsGrid}>
                          <div className={styles.mobileDetailItem}>
                            <span className={styles.mobileDetailLabel}>Full Name</span>
                            <span className={styles.mobileDetailValue}>{order.customerInfo?.fullName || '—'}</span>
                          </div>
                          <div className={styles.mobileDetailItem}>
                            <span className={styles.mobileDetailLabel}>Email</span>
                            <span className={styles.mobileDetailValue}>{order.customerInfo?.email || '—'}</span>
                          </div>
                          <div className={styles.mobileDetailItem}>
                            <span className={styles.mobileDetailLabel}>Contact</span>
                            <span className={styles.mobileDetailValue}>{order.customerInfo?.contactNumber || '—'}</span>
                          </div>
                          <div className={styles.mobileDetailItem}>
                            <span className={styles.mobileDetailLabel}>Section</span>
                            <span className={styles.mobileDetailValue}>{order.customerInfo?.section || '—'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Product Section */}
                      <div className={styles.mobileDetailsSection}>
                        <span className={styles.mobileDetailsSectionTitle}>📦 Product</span>
                        <div className={styles.mobileDetailsGrid}>
                          <div className={styles.mobileDetailItem}>
                            <span className={styles.mobileDetailLabel}>Name</span>
                            <span className={styles.mobileDetailValue}>{order.productInfo?.productName || '—'}</span>
                          </div>
                          <div className={styles.mobileDetailItem}>
                            <span className={styles.mobileDetailLabel}>Quantity</span>
                            <span className={styles.mobileDetailValue}>{order.productInfo?.quantity}</span>
                          </div>
                          {order.productInfo?.size && order.productInfo.size !== 'N/A' && (
                            <div className={styles.mobileDetailItem}>
                              <span className={styles.mobileDetailLabel}>Size</span>
                              <span className={styles.mobileDetailValue}>{order.productInfo.size}</span>
                            </div>
                          )}
                          {order.productInfo?.color && order.productInfo.color !== 'N/A' && (
                            <div className={styles.mobileDetailItem}>
                              <span className={styles.mobileDetailLabel}>Color</span>
                              <span className={styles.mobileDetailValue}>{order.productInfo.color}</span>
                            </div>
                          )}
                          <div className={styles.mobileDetailItem}>
                            <span className={styles.mobileDetailLabel}>Total Price</span>
                            <span className={`${styles.mobileDetailValue} ${styles.mobileDetailPrice}`}>₱{order.productInfo?.totalPrice?.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Payment Section */}
                      <div className={styles.mobileDetailsSection}>
                        <span className={styles.mobileDetailsSectionTitle}>💳 Payment</span>
                        <div className={styles.mobileDetailsGrid}>
                          <div className={styles.mobileDetailItem}>
                            <span className={styles.mobileDetailLabel}>Method</span>
                            <span className={styles.mobileDetailValue}>{order.paymentInfo?.paymentMethod || '—'}</span>
                          </div>
                          <div className={styles.mobileDetailItem}>
                            <span className={styles.mobileDetailLabel}>Reference</span>
                            <span className={styles.mobileDetailValue}>{order.paymentInfo?.referenceNumber || '—'}</span>
                          </div>
                          <div className={styles.mobileDetailItem}>
                            <span className={styles.mobileDetailLabel}>Date Ordered</span>
                            <span className={styles.mobileDetailValue}>{formatDate(order.dateOrdered)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className={styles.mobileCardActions}>
                        <button
                          className={`${styles.mobileActionBtn} ${order.claimed ? styles.mobileActionBtnAmber : styles.mobileActionBtnGreen}`}
                          onClick={() => toggleClaimStatus(order)}
                        >
                          {order.claimed ? <X size={15} /> : <CheckCircle size={15} />}
                          {order.claimed ? 'Unclaim' : 'Mark Claimed'}
                        </button>
                        <button
                          className={`${styles.mobileActionBtn} ${styles.mobileActionBtnBlue}`}
                          onClick={() => handleEditClick(order)}
                        >
                          <Edit2 size={15} />
                          Edit Order
                        </button>
                        <button
                          className={`${styles.mobileActionBtn} ${styles.mobileActionBtnRed}`}
                          onClick={() => handleDeleteOrder(order.docId, order.orderId, order)}
                        >
                          <Trash2 size={15} />
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Mobile Pagination */}
        {filteredOrders.length > PER_PAGE && (
          <div className={styles.mobilePagination}>
            <button
              className={styles.mobilePaginationBtn}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              ← Prev
            </button>
            <span className={styles.mobilePaginationInfo}>{page} / {totalPages}</span>
            <button
              className={styles.mobilePaginationBtn}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    );
  };

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
          <div className={styles.tableWrapper}>
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedOrders.map((order) => (
                  <tr key={order.docId} className={styles.tableRow}>
                    <td data-label="Select"><input type="checkbox" checked={selectedOrders.includes(order.docId)} onChange={() => toggleSelectOrder(order.docId)} /></td>
                    <td data-label="Order ID" className={styles.orderIdCell}>{order.orderId}</td>
                    <td data-label="Customer">
                      <div className={styles.customerCell}>
                        <span className={styles.customerName}>{order.customerInfo?.fullName}</span>
                        <span className={styles.customerEmail}>{order.customerInfo?.email}</span>
                      </div>
                    </td>
                    <td data-label="Product">
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
                    <td data-label="Quantity" className={styles.quantityCell}>
                      <span>{order.productInfo?.quantity}</span>
                    </td>
                    <td data-label="Total" className={styles.priceCell}>₱{order.productInfo?.totalPrice?.toFixed(2)}</td>
                    <td data-label="Status">
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
                    <td data-label="Payment">
                      <span className={styles.paymentBadge}>
                        {order.paymentInfo?.paymentMethod}
                      </span>
                    </td>
                    <td data-label="Date" className={styles.dateCell}>{formatDate(order.dateOrdered)}</td>
                    <td data-label="Actions" className={styles.actionsCell}>
                      <div className={styles.tableActionsGroup}>
                        <button
                          className={styles.claimBtn}
                          onClick={() => toggleClaimStatus(order)}
                          title={order.claimed ? "Mark as Unclaimed" : "Mark as Claimed"}
                        >
                          {order.claimed ? <X size={14} /> : <CheckCircle size={14} />}
                          {order.claimed ? "Unclaim" : "Claim"}
                        </button>
                        <button
                          className={styles.tableEditBtn}
                          onClick={() => handleEditClick(order)}
                          title="Edit Order"
                        >
                          <Edit2 size={14} />
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        {/* Desktop orders table (hidden on mobile) */}
        {activeSection === 'orders' && (
          <>
            <div className={styles.desktopOnly}>{renderOrdersTableView()}</div>
            <div className={styles.mobileOnly}>{renderMobileOrdersView()}</div>
          </>
        )}
        {activeSection === 'settings' && (
          <div className={styles.settingsView} style={{minHeight:'unset'}}>
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
          <div className={styles.editModalContent} onClick={(e) => e.stopPropagation()}>
            <Order 
              editingOrder={selectedOrder}
              onSuccess={handleFormSuccess}
              onCancel={handleModalClose}
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