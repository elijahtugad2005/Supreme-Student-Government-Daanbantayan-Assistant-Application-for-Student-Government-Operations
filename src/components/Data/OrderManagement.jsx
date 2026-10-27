import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../../firebase/firebaseConfig.js';
import { collection, onSnapshot, deleteDoc, doc, updateDoc, getDocs, writeBatch } from 'firebase/firestore';
import { 
  Search, Edit2, Trash2, AlertCircle, Package, Clock, CheckCircle, 
  Check, X, ClockIcon, CreditCard, Truck, FileSpreadsheet, 
  ChevronDown, ChevronUp, MoreVertical, SlidersHorizontal,
  Landmark, Sparkles, RefreshCw, ExternalLink, ShieldCheck, TrendingUp, ArrowRight
} from 'lucide-react';
import PesoSign from '../Common/PesoSign.jsx';
import Order from '../Order/order.jsx';
import SheetSyncPanel from './SheetSyncPanel.jsx';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import financeService from '../../services/financeService.js';
import { fromCentavos, toCentavos, formatPHP } from '../../utils/financeConstants.js';
import styles from './OrderManagement.module.css';

function OrderManagement() {
  const { currentUser, userName, userRole } = useAuth();

  // ========================================
  // STATE MANAGEMENT
  // ========================================
  
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [igfAccount, setIgfAccount] = useState(null);
  const [isSyncingIGF, setIsSyncingIGF] = useState(false);
  const [igfModalOpen, setIgfModalOpen] = useState(false);
  
  // Navigation state
  const [activeSection, setActiveSection] = useState('orders');
  
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

  // SUBSCRIBE TO OFFICIAL IGF FUND ACCOUNT
  // ========================================
  useEffect(() => {
    const unsubscribeIgf = onSnapshot(
      doc(db, 'fundAccounts', 'fund_igf_main'),
      (snapshot) => {
        if (snapshot.exists()) {
          setIgfAccount({ id: snapshot.id, ...snapshot.data() });
        } else {
          setIgfAccount({ id: 'fund_igf_main', balanceCentavos: 0 });
        }
      },
      (error) => {
        console.warn('Error subscribing to IGF account:', error);
      }
    );

    return () => unsubscribeIgf();
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

      // IGF Integration: When order is marked Completed or Paid, auto-sync merchandise proceeds to IGF
      if ((newStatus === 'Completed' || newStatus === 'Paid') && !order.igfSynced) {
        try {
          await financeService.syncOrderRevenueToIGF({
            order: { ...order, docId, orderStatus: newStatus },
            user: currentUser,
            notes: `Merchandise order #${order.orderId} status set to ${newStatus}`
          });
        } catch (syncErr) {
          console.warn('Auto IGF sync notice:', syncErr);
        }
      }

      // If an order that was synced to IGF is Cancelled, reverse the revenue from IGF ledger
      if (newStatus === 'Cancelled' && order.igfSynced) {
        try {
          await financeService.reverseOrderRevenueFromIGF({
            order: { ...order, docId },
            user: currentUser,
            reason: 'Order cancelled by officer'
          });
        } catch (revErr) {
          console.warn('Auto IGF reversal notice:', revErr);
        }
      }
      
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
    // Hoist product snapshot retrieval outside the loop to eliminate N+1 Firestore read storm
    let productsSnapshot = null;
    const hasCompletedOrder = ordersToDelete.some(o => o.orderStatus === 'Completed');
    if (hasCompletedOrder) {
      productsSnapshot = await getDocs(collection(db, 'products'));
    }

    for (const order of ordersToDelete) {
      // Restore stock if order was completed
      if (order.orderStatus === 'Completed' && productsSnapshot) {
        const productId = order.productInfo?.productId;
        const quantity = order.productInfo?.quantity || 0;
        if (productId && quantity > 0) {
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

      // Auto-sync to IGF when marked claimed if not already synced
      if (newClaimed && !order.igfSynced) {
        try {
          await financeService.syncOrderRevenueToIGF({
            order: { ...order, claimed: true, orderStatus: 'Claimed' },
            user: currentUser,
            notes: `Merchandise order #${order.orderId} claimed by student`
          });
        } catch (syncErr) {
          console.warn('IGF sync on claim notice:', syncErr);
        }
      }

      showToast(`Order ${order.orderId} marked as ${newStatus}${newClaimed ? ' & synced to IGF' : ''}.`, 'success');
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
  // IGF REVENUE LINKAGE METRICS
  // ========================================
  const igfMetrics = useMemo(() => {
    const igfBalance = fromCentavos(igfAccount?.balanceCentavos || 0);

    const settledOrders = orders.filter(
      (o) => o.orderStatus !== 'Cancelled' && (o.claimed || o.orderStatus === 'Completed' || o.orderStatus === 'Paid')
    );
    const settledRevenue = settledOrders.reduce((sum, o) => {
      const val = Number(o.productInfo?.totalPrice || o.totalPrice) || 0;
      return sum + val;
    }, 0);

    const syncedOrders = orders.filter((o) => o.igfSynced === true);
    const syncedRevenue = syncedOrders.reduce((sum, o) => {
      const val = Number(o.productInfo?.totalPrice || o.totalPrice) || 0;
      return sum + val;
    }, 0);

    const eligibleOrders = settledOrders.filter((o) => !o.igfSynced);
    const eligibleRevenue = eligibleOrders.reduce((sum, o) => {
      const val = Number(o.productInfo?.totalPrice || o.totalPrice) || 0;
      return sum + val;
    }, 0);

    const syncPercentage = settledRevenue > 0
      ? Math.min(100, Math.round((syncedRevenue / settledRevenue) * 100))
      : (settledOrders.length === 0 ? 100 : 0);

    return {
      igfBalance,
      settledOrders,
      settledRevenue,
      syncedOrders,
      syncedRevenue,
      eligibleOrders,
      eligibleRevenue,
      syncPercentage,
    };
  }, [orders, igfAccount]);

  // Sync single order revenue to IGF
  const handleSyncOrderToIGF = async (order) => {
    if (!order) return;
    setIsSyncingIGF(true);
    showToast(`Linking Order #${order.orderId} revenue to IGF...`, 'info');
    try {
      const res = await financeService.syncOrderRevenueToIGF({
        order,
        user: currentUser,
        notes: `Merchandise order #${order.orderId} profit linked directly to Income Generated Fund.`
      });
      if (res.alreadySynced) {
        showToast(`Order #${order.orderId} is already linked to IGF (${res.refNumber}).`, 'info');
      } else {
        showToast(`✓ Order #${order.orderId} (₱${(Number(order.productInfo?.totalPrice || order.totalPrice) || 0).toFixed(2)}) linked to IGF Fund!`, 'success');
      }
    } catch (err) {
      console.error('Error syncing order to IGF:', err);
      showToast(`Failed to link order to IGF: ${err.message}`, 'error');
    } finally {
      setIsSyncingIGF(false);
    }
  };

  // Batch sync all eligible orders to IGF
  const handleBatchSyncToIGF = async () => {
    if (igfMetrics.eligibleOrders.length === 0) {
      showToast('All completed and claimed merchandise orders are already synced to IGF.', 'info');
      return;
    }
    setIsSyncingIGF(true);
    showToast(`Synchronizing ${igfMetrics.eligibleOrders.length} merchandise orders to IGF...`, 'info');
    try {
      const res = await financeService.batchSyncOrderRevenueToIGF({
        orders: igfMetrics.eligibleOrders,
        user: currentUser,
        notes: 'Batch merchandise sales revenue sync to Income Generated Fund.'
      });
      const totalPHP = fromCentavos(res.totalCentavos || 0);
      showToast(`✓ Successfully synced ${res.count} orders (₱${totalPHP.toLocaleString('en-PH', { minimumFractionDigits: 2 })}) to IGF Treasury!`, 'success');
      setIgfModalOpen(false);
    } catch (err) {
      console.error('Error batch syncing to IGF:', err);
      showToast(`Batch sync error: ${err.message}`, 'error');
    } finally {
      setIsSyncingIGF(false);
    }
  };

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
                  <button className={styles.mobileToolsItem} onClick={() => { setIgfModalOpen(true); setMobileToolsOpen(false); }}>
                    <Landmark size={16} />
                    IGF Revenue Link {igfMetrics.eligibleOrders.length > 0 && `(${igfMetrics.eligibleOrders.length})`}
                  </button>
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
          <div className={`${styles.mobileStatChip} ${styles.mobileStatChipGold}`} onClick={() => setIgfModalOpen(true)}>
            <span className={styles.mobileStatValue}>₱{igfMetrics.igfBalance.toLocaleString('en-PH', { maximumFractionDigits: 0 })}</span>
            <span className={styles.mobileStatLabel}>IGF Fund</span>
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
                        {order.igfSynced && (
                          <span className={styles.igfBadgeSynced} style={{ padding: '0.15rem 0.45rem', fontSize: '0.68rem' }}>
                            <ShieldCheck size={11} /> IGF Synced
                          </span>
                        )}
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

                      {/* Status Selector */}
                      <div className={styles.mobileDetailsSection}>
                        <span className={styles.mobileDetailsSectionTitle}>⚡ Order Status</span>
                        <div style={{ marginTop: '0.4rem' }}>
                          <select
                            className={styles.statusSelect}
                            style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}
                            value={order.orderStatus}
                            onChange={(e) => handleStatusChange(order, e.target.value)}
                          >
                            <option value="Pending">Pending</option>
                            <option value="Paid">Paid</option>
                            <option value="Ongoing">Ongoing</option>
                            <option value="Completed">Completed</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
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
                        {!order.igfSynced && (order.claimed || order.orderStatus === 'Completed' || order.orderStatus === 'Paid') && order.orderStatus !== 'Cancelled' && (
                          <button
                            type="button"
                            className={styles.mobileActionBtn}
                            style={{ background: 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)', color: '#160406', fontWeight: '700' }}
                            onClick={() => handleSyncOrderToIGF(order)}
                            disabled={isSyncingIGF}
                          >
                            <Sparkles size={14} />
                            Link to IGF
                          </button>
                        )}
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
              <PesoSign size={20} />
            </span>
          </div>
          <p className={styles.kpiCardValue}>₱{stats.totalRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className={styles.kpiCardSub}>revenue from claimed orders</p>
        </div>

        {/* 5th KPI Card: Official IGF Fund Balance */}
        <div className={`${styles.kpiCard} ${styles.kpiCardIgf}`}>
          <div className={styles.kpiCardHeader}>
            <span className={styles.kpiCardLabel}>
              IGF Fund
              <span className={styles.igfCardBadge}>Treasury</span>
            </span>
            <span className={styles.kpiCardIcon} style={{ color: '#d4af37' }}>
              <Landmark size={20} />
            </span>
          </div>
          <p className={styles.kpiCardValue}>₱{igfMetrics.igfBalance.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className={styles.kpiCardSub}>
            ₱{igfMetrics.syncedRevenue.toLocaleString('en-PH', { maximumFractionDigits: 0 })} synced • ₱{igfMetrics.eligibleRevenue.toLocaleString('en-PH', { maximumFractionDigits: 0 })} pending
          </p>
        </div>
      </div>

      {/* IGF Merchandise Profit Flow Banner */}
      <div className={styles.igfFlowBanner}>
        <div className={styles.igfFlowHeader}>
          <div className={styles.igfFlowHeaderLeft}>
            <div className={styles.igfFlowIcon}>
              <Landmark size={26} />
            </div>
            <div>
              <div className={styles.igfFlowTitleRow}>
                <h3 className={styles.igfFlowTitle}>Income Generated Fund (IGF) Revenue Linkage</h3>
                <span className={styles.igfCardBadge}>Merchandise Profits</span>
              </div>
              <p className={styles.igfFlowSubtitle}>
                The Income Generated Fund (IGF) derives its profits from SSG merchandise sales, uniforms, and pre-orders. Settled merchandise revenue is credited into the official IGF treasury account.
              </p>
            </div>
          </div>
          <div className={styles.igfFlowActions}>
            <button
              type="button"
              className={styles.igfDetailsActionBtn}
              onClick={() => setIgfModalOpen(true)}
            >
              <FileSpreadsheet size={16} />
              <span>Audit Details</span>
            </button>
            <button
              type="button"
              className={styles.igfSyncActionBtn}
              onClick={handleBatchSyncToIGF}
              disabled={igfMetrics.eligibleOrders.length === 0 || isSyncingIGF}
            >
              {isSyncingIGF ? (
                <>
                  <RefreshCw size={16} className={styles.spinning} />
                  <span>Syncing to IGF...</span>
                </>
              ) : igfMetrics.eligibleOrders.length > 0 ? (
                <>
                  <Sparkles size={16} />
                  <span>Sync Pending ₱{igfMetrics.eligibleRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                </>
              ) : (
                <>
                  <CheckCircle size={16} />
                  <span>All Settled Orders Synced</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Flow Stats Grid */}
        <div className={styles.igfFlowStatsGrid}>
          <div className={styles.igfFlowStatItem}>
            <span className={styles.igfFlowStatLabel}>Live IGF Balance</span>
            <span className={styles.igfFlowStatValue}>₱{igfMetrics.igfBalance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
            <span className={styles.igfFlowStatSub}>SSG Fund Account</span>
          </div>
          <div className={styles.igfFlowStatItem}>
            <span className={styles.igfFlowStatLabel}>Settled Merchandise Sales</span>
            <span className={styles.igfFlowStatValue}>₱{igfMetrics.settledRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
            <span className={styles.igfFlowStatSub}>{igfMetrics.settledOrders.length} paid/claimed orders</span>
          </div>
          <div className={styles.igfFlowStatItem}>
            <span className={styles.igfFlowStatLabel}>Credited to Ledger</span>
            <span className={styles.igfFlowStatValue} style={{ color: '#34d399' }}>₱{igfMetrics.syncedRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
            <span className={styles.igfFlowStatSub}>{igfMetrics.syncedOrders.length} transactions posted</span>
          </div>
          <div className={styles.igfFlowStatItem}>
            <span className={styles.igfFlowStatLabel}>Pending IGF Sync</span>
            <span className={styles.igfFlowStatValue} style={{ color: igfMetrics.eligibleRevenue > 0 ? '#fbbf24' : '#94a3b8' }}>
              ₱{igfMetrics.eligibleRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </span>
            <span className={styles.igfFlowStatSub}>{igfMetrics.eligibleOrders.length} orders awaiting sync</span>
          </div>
        </div>

        {/* Sync Progress Bar */}
        <div className={styles.igfProgressSection}>
          <div className={styles.igfProgressHeader}>
            <span>Ledger Synchronization Progress</span>
            <span><strong>{igfMetrics.syncPercentage}%</strong> of settled revenue credited to IGF</span>
          </div>
          <div className={styles.igfProgressBarTrack}>
            <div className={styles.igfProgressBarFill} style={{ width: `${igfMetrics.syncPercentage}%` }} />
          </div>
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
              className={`${styles.syncToolbarBtn} ${styles.btnSyncIgf}`}
              onClick={() => setIgfModalOpen(true)}
              title="Review merchandise revenue and sync with official SSG IGF fund account"
            >
              <Landmark size={16} />
              <span>IGF Revenue Link</span>
              {igfMetrics.eligibleOrders.length > 0 && (
                <span className={styles.igfPendingPill}>{igfMetrics.eligibleOrders.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`${styles.syncToolbarBtn} ${styles.btnSyncSheet}`}
              onClick={() => setActiveSection('settings')}
              title="Import and dynamically sync orders from Excel or Google Sheets"
            >
              <FileSpreadsheet size={16} />
              Sync Sheet / Excel
            </button>
            {/* Bulk Delete */}
            <button
              type="button"
              className={`${styles.syncToolbarBtn} ${styles.btnBulkDelete}`}
              onClick={openBulkDeleteModal}
              disabled={selectedOrders.length === 0}
              title="Delete selected orders"
            >
              <Trash2 size={16} />
              Delete Selected
            </button>
            <button
              type="button"
              className={`${styles.syncToolbarBtn} ${styles.btnDeleteAll}`}
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
                  <th>IGF Treasury</th>
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <select
                          className={styles.statusSelect}
                          value={order.orderStatus}
                          onChange={(e) => handleStatusChange(order, e.target.value)}
                          title="Change Order Status"
                          style={{
                            backgroundColor: getStatusColor(order.orderStatus),
                            color: getStatusTextColor(order.orderStatus),
                            borderColor: 'transparent'
                          }}
                        >
                          <option value="Pending" style={{ background: '#fff', color: '#1f2937' }}>Pending</option>
                          <option value="Paid" style={{ background: '#fff', color: '#1f2937' }}>Paid</option>
                          <option value="Ongoing" style={{ background: '#fff', color: '#1f2937' }}>Ongoing</option>
                          <option value="Completed" style={{ background: '#fff', color: '#1f2937' }}>Completed</option>
                          <option value="Cancelled" style={{ background: '#fff', color: '#1f2937' }}>Cancelled</option>
                        </select>
                        <span 
                          className={order.claimed ? styles.claimBadgeClaimed : styles.claimBadgeUnclaimed}
                        >
                          {order.claimed ? "Claimed" : "Unclaimed"}
                        </span>
                      </div>
                    </td>
                    <td data-label="Payment">
                      <span className={styles.paymentBadge}>
                        {order.paymentInfo?.paymentMethod}
                      </span>
                    </td>
                    <td data-label="IGF Treasury">
                      {order.igfSynced ? (
                        <span className={styles.igfBadgeSynced} title={`Recorded in IGF ledger: ${order.igfTxRef || 'IGF-ORD'}`}>
                          <ShieldCheck size={13} />
                          <span>IGF Synced</span>
                        </span>
                      ) : (order.claimed || order.orderStatus === 'Completed' || order.orderStatus === 'Paid') && order.orderStatus !== 'Cancelled' ? (
                        <button
                          type="button"
                          className={styles.igfSyncRowBtn}
                          onClick={() => handleSyncOrderToIGF(order)}
                          disabled={isSyncingIGF}
                          title="Credit this merchandise order revenue into IGF Fund Account"
                        >
                          <Sparkles size={12} />
                          <span>Link to IGF</span>
                        </button>
                      ) : (
                        <span className={styles.igfBadgePending}>—</span>
                      )}
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
    <div className={styles.settingsView} style={{ minHeight: 'unset' }}>
      <SheetSyncPanel onSyncCompleted={() => {
        // Switch to orders view after brief delay so user can immediately see synced orders
        setTimeout(() => setActiveSection('orders'), 1200);
      }} />
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
        {activeSection === 'settings' && renderSettingsView()}
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

      {/* IGF REVENUE LINKAGE MODAL */}
      {igfModalOpen && (
        <div className={styles.igfModalOverlay} onClick={() => setIgfModalOpen(false)}>
          <div className={styles.igfModalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.igfModalHeader}>
              <div className={styles.igfModalTitleGroup}>
                <Landmark size={22} style={{ color: '#ffea9f' }} />
                <h3 className={styles.igfModalTitle}>Income Generated Fund (IGF) Revenue Linkage</h3>
              </div>
              <button
                type="button"
                className={styles.igfModalCloseBtn}
                onClick={() => setIgfModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.igfModalBody}>
              <div className={styles.igfModalDescBox}>
                <strong>Why is Order Revenue linked to IGF?</strong>
                <p style={{ margin: '0.35rem 0 0', color: '#cbd5e1' }}>
                  The Student Government's <strong>Income Generated Fund (IGF)</strong> gathers and manages revenue created through commercial operations — such as shirts, student lanyards, uniform accessories, and merchandise. All profits are credited directly into the IGF general ledger to finance student projects, supplies, and official operations.
                </p>
              </div>

              <div className={styles.igfModalGrid}>
                <div className={styles.igfModalCard}>
                  <span className={styles.igfModalCardLabel}>Official IGF Fund Balance</span>
                  <span className={styles.igfModalCardVal}>
                    ₱{igfMetrics.igfBalance.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className={styles.igfModalCardSub}>Active fund balance in Finance</span>
                </div>

                <div className={styles.igfModalCard}>
                  <span className={styles.igfModalCardLabel}>Settled Merchandise Revenue</span>
                  <span className={styles.igfModalCardVal}>
                    ₱{igfMetrics.settledRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className={styles.igfModalCardSub}>{igfMetrics.settledOrders.length} completed & claimed orders</span>
                </div>

                <div className={styles.igfModalCard}>
                  <span className={styles.igfModalCardLabel}>Credited to Ledger</span>
                  <span className={styles.igfModalCardVal} style={{ color: '#34d399' }}>
                    ₱{igfMetrics.syncedRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className={styles.igfModalCardSub}>{igfMetrics.syncedOrders.length} orders safely recorded</span>
                </div>

                <div className={styles.igfModalCard}>
                  <span className={styles.igfModalCardLabel}>Pending Sync to IGF</span>
                  <span className={styles.igfModalCardVal} style={{ color: igfMetrics.eligibleRevenue > 0 ? '#fbbf24' : '#94a3b8' }}>
                    ₱{igfMetrics.eligibleRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className={styles.igfModalCardSub}>{igfMetrics.eligibleOrders.length} orders awaiting ledger post</span>
                </div>
              </div>

              {/* Pending Orders List */}
              <div className={styles.igfModalPendingList}>
                <div className={styles.igfModalListHeader}>
                  {igfMetrics.eligibleOrders.length > 0
                    ? `Eligible Unsynced Orders (${igfMetrics.eligibleOrders.length})`
                    : 'All Merchandise Orders Up to Date'}
                </div>

                {igfMetrics.eligibleOrders.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', color: '#94a3b8' }}>
                    <ShieldCheck size={32} style={{ color: '#10b981', margin: '0 auto 0.5rem', display: 'block' }} />
                    <p style={{ margin: 0, fontWeight: 600, color: '#e2e8f0' }}>All eligible merchandise revenue is synchronized with IGF!</p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>Every settled order is accounted for in the SSG Income Generated Funds ledger.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '220px', overflowY: 'auto' }}>
                    {igfMetrics.eligibleOrders.map((order) => (
                      <div key={order.docId} className={styles.igfModalOrderRow}>
                        <div className={styles.igfModalOrderInfo}>
                          <span className={styles.igfModalOrderId}>{order.orderId} — {order.customerInfo?.fullName}</span>
                          <span className={styles.igfModalOrderDetails}>
                            {order.productInfo?.productName} (x{order.productInfo?.quantity || 1}) • Status: {order.orderStatus} {order.claimed ? '(Claimed)' : ''}
                          </span>
                        </div>
                        <div className={styles.igfModalOrderAction}>
                          <span className={styles.igfModalOrderPrice}>₱{(Number(order.productInfo?.totalPrice || order.totalPrice) || 0).toFixed(2)}</span>
                          <button
                            type="button"
                            className={styles.igfSyncRowBtn}
                            onClick={() => handleSyncOrderToIGF(order)}
                            disabled={isSyncingIGF}
                          >
                            <Sparkles size={12} />
                            Sync
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.igfModalFooter}>
              <button
                type="button"
                className={styles.igfModalCancelBtn}
                onClick={() => setIgfModalOpen(false)}
              >
                Close
              </button>
              {igfMetrics.eligibleOrders.length > 0 && (
                <button
                  type="button"
                  className={styles.igfModalSyncAllBtn}
                  onClick={handleBatchSyncToIGF}
                  disabled={isSyncingIGF}
                >
                  {isSyncingIGF ? (
                    <>
                      <RefreshCw size={16} className={styles.spinning} />
                      <span>Syncing...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      <span>Sync All ({igfMetrics.eligibleOrders.length} Orders • ₱{igfMetrics.eligibleRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })})</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}



    </div>
  );
}

export default OrderManagement;