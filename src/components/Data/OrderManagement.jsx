import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../../firebase/firebaseConfig.js';
import { 
  collection, 
  onSnapshot, 
  deleteDoc, 
  doc, 
  updateDoc, 
  getDocs, 
  getDoc,
  addDoc,
  query,
  where,
  serverTimestamp,
  writeBatch 
} from 'firebase/firestore';
import auditService from '../../services/auditService.js';
import { 
  Search, Edit2, Trash2, AlertCircle, Package, Clock, CheckCircle, 
  Check, X, ClockIcon, CreditCard, Truck, FileSpreadsheet, 
  ChevronDown, ChevronUp, MoreVertical, SlidersHorizontal,
  Landmark, Sparkles, RefreshCw, ExternalLink, ShieldCheck, TrendingUp, ArrowRight,
  LayoutDashboard, Banknote, Smartphone, User, Activity, RotateCcw, XCircle
} from 'lucide-react';
import PesoSign from '../Common/PesoSign.jsx';
import Order from '../Order/order.jsx';
import SheetSyncPanel from './SheetSyncPanel.jsx';
import { canManageCentralizedOrderSheet } from './centralizedOrderSheetOrchestrator.js';
import {
  createBrowserCentralizedOrderSheetOrchestrator,
  getGoogleConnectionStatus,
  subscribeToCentralizedOrderSheet,
} from '../../services/googleSheetsOrderSyncService.js';
import {
  executeOrderStatusUpdate,
  normalizeOrderStatusUpper,
  computeOrderStatistics,
} from './orderStatusTransition.js';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import financeService from '../../services/financeService.js';
import { fromCentavos, toCentavos, formatPHP } from '../../utils/financeConstants.js';
import styles from './OrderManagement.module.css';

function OrderManagement() {
  const { currentUser, userName, userRole, userPermissionOverrides } = useAuth();
  const actorUser = useMemo(
    () => ({
      uid: currentUser?.uid || '',
      email: currentUser?.email || '',
      name: userName || currentUser?.displayName || 'SSG Officer',
      role: userRole || '',
      permissionOverrides: userPermissionOverrides || {},
    }),
    [
      currentUser?.uid,
      currentUser?.email,
      currentUser?.displayName,
      userName,
      userRole,
      userPermissionOverrides,
    ]
  );
  const canManageCentralSheet = useMemo(
    () => canManageCentralizedOrderSheet(actorUser),
    [actorUser]
  );

  // ========================================
  // STATE MANAGEMENT
  // ========================================
  
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [igfAccount, setIgfAccount] = useState(null);
  const [isSyncingIGF, setIsSyncingIGF] = useState(false);
  const [igfModalOpen, setIgfModalOpen] = useState(false);
  const [centralSheet, setCentralSheet] = useState(null);
  const [autoPushEnabled, setAutoPushEnabled] = useState(false);

  useEffect(() => {
    const unsub = subscribeToCentralizedOrderSheet((docData) => {
      setCentralSheet(docData);
    });
    return () => unsub();
  }, []);
  
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
        
        // Sort by date (newest first) with robust type handling
        const getOrderTimestamp = (o) => {
          if (o.dateOrdered?.toDate) return o.dateOrdered.toDate().getTime();
          if (o.dateOrdered) return new Date(o.dateOrdered).getTime() || 0;
          if (o.createdAt?.toDate) return o.createdAt.toDate().getTime();
          if (o.createdAt) return new Date(o.createdAt).getTime() || 0;
          return 0;
        };
        ordersData.sort((a, b) => getOrderTimestamp(b) - getOrderTimestamp(a));

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
  // INVENTORY & PRODUCT MANAGEMENT STOCK SYNC
  // Decreases stock across Product Catalog and Inventory Register when claimed
  // Restores stock when an order is unclaimed or cancelled
  // ========================================
  const syncOrderStockDeduction = async ({ order, deduct = true }) => {
    const productId = order.productInfo?.productId;
    const productName = order.productInfo?.productName?.trim();
    const quantity = parseInt(order.productInfo?.quantity || order.quantity) || 1;

    if (quantity <= 0) return { success: true };

    try {
      // 1. Find product in `products` collection
      const productsSnapshot = await getDocs(collection(db, 'products'));
      let productDoc = null;

      if (productId) {
        productDoc = productsSnapshot.docs.find(d => d.data().productId === productId);
      }
      if (!productDoc && productName) {
        const targetName = productName.toLowerCase();
        productDoc = productsSnapshot.docs.find(d => {
          const pName = (d.data().productName || '').toLowerCase();
          return pName === targetName || pName.includes(targetName) || targetName.includes(pName);
        });
      }

      const performer = userName || currentUser?.displayName || currentUser?.email || 'Commerce Hub Officer';

      if (productDoc) {
        const prodData = productDoc.data();
        const currentProdStock = parseInt(prodData.stockAvailable) || 0;
        const newProdStock = deduct 
          ? Math.max(0, currentProdStock - quantity)
          : currentProdStock + quantity;

        await updateDoc(doc(db, 'products', productDoc.id), {
          stockAvailable: newProdStock,
          updatedAt: new Date().toISOString(),
        });

        // 2. Find and update linked inventory item in `inventory` collection
        let invDoc = null;
        if (prodData.linkedInventoryId) {
          try {
            const directSnap = await getDoc(doc(db, 'inventory', prodData.linkedInventoryId));
            if (directSnap.exists()) {
              invDoc = directSnap;
            }
          } catch (e) {
            console.warn('Error reading linked inventory item by ID:', e);
          }
        }

        if (!invDoc && prodData.productId) {
          const invQ = query(collection(db, 'inventory'), where('linkedProductId', '==', prodData.productId));
          const invSnap = await getDocs(invQ);
          if (!invSnap.empty) {
            invDoc = invSnap.docs[0];
          }
        }

        if (!invDoc) {
          const invNameQ = query(collection(db, 'inventory'), where('name', '==', prodData.productName));
          const invNameSnap = await getDocs(invNameQ);
          if (!invNameSnap.empty) {
            invDoc = invNameSnap.docs[0];
          }
        }

        if (invDoc) {
          const currentInvStock = parseInt(invDoc.data().quantity) || 0;
          const newInvStock = deduct
            ? Math.max(0, currentInvStock - quantity)
            : currentInvStock + quantity;

          await updateDoc(doc(db, 'inventory', invDoc.id), {
            quantity: newInvStock,
            updatedAt: serverTimestamp(),
            lastUpdatedBy: performer,
          });

          await auditService.logInventoryUpdate(
            performer,
            invDoc.data().name,
            deduct
              ? `Order #${order.orderId} claimed: deducted ${quantity} units from stock (New Stock: ${newInvStock})`
              : `Order #${order.orderId} claim cancelled: restored ${quantity} units to stock (New Stock: ${newInvStock})`
          );
        } else if (deduct) {
          // If product exists in products but not yet in inventory, auto-create inventory item under IGF
          const newInvRef = await addDoc(collection(db, 'inventory'), {
            name: prodData.productName,
            category: prodData.category || 'Merchandise',
            quantity: newProdStock,
            minQuantity: 5,
            amount: parseFloat(prodData.price) || 0,
            storageLocation: prodData.storageLocation || 'SSG Supply Office',
            unit: prodData.unit || 'pcs',
            description: prodData.description || '',
            supplier: prodData.supplier || 'SSG Operations',
            imageBase64: prodData.imageBase64 || '',
            fundSource: 'IGF',
            source: 'Product Management (IGF)',
            linkedProductId: prodData.productId || null,
            lastUpdatedBy: performer,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          await updateDoc(doc(db, 'products', productDoc.id), {
            linkedInventoryId: newInvRef.id,
            category: prodData.category || 'Merchandise',
            fundSource: 'IGF',
          });

          await auditService.logInventoryAdd(
            performer,
            prodData.productName,
            newProdStock,
            prodData.category || 'Merchandise'
          );
        }

        return { 
          success: true, 
          productId: prodData.productId, 
          newProdStock, 
          inventoryId: invDoc?.id 
        };
      } else if (productName) {
        // Fallback: search directly in inventory if product wasn't cataloged yet
        const invNameQ = query(collection(db, 'inventory'), where('name', '==', productName));
        const invNameSnap = await getDocs(invNameQ);
        if (!invNameSnap.empty) {
          const invDoc = invNameSnap.docs[0];
          const currentInvStock = parseInt(invDoc.data().quantity) || 0;
          const newInvStock = deduct ? Math.max(0, currentInvStock - quantity) : currentInvStock + quantity;
          await updateDoc(doc(db, 'inventory', invDoc.id), {
            quantity: newInvStock,
            updatedAt: serverTimestamp(),
            lastUpdatedBy: performer,
          });
          await auditService.logInventoryUpdate(
            performer,
            invDoc.data().name,
            deduct
              ? `Order #${order.orderId} claimed: deducted ${quantity} units from stock (New Stock: ${newInvStock})`
              : `Order #${order.orderId} claim cancelled: restored ${quantity} units to stock (New Stock: ${newInvStock})`
          );
          return { success: true, inventoryId: invDoc.id };
        }
        return { success: false, reason: 'Product not found in catalog or inventory register' };
      }
      return { success: false, reason: 'No product information specified on order' };
    } catch (err) {
      console.error('Error synchronizing order stock deduction:', err);
      return { success: false, error: err.message };
    }
  };

  // ========================================
  // UPDATE ORDER STATUS
  // ========================================
  const updateOrderStatus = async (docId, newStatus, order) => {
    let persistedFields = null;
    await executeOrderStatusUpdate({
      docId,
      newStatus,
      order,
      deps: {
        currentUser,
        userName,
        showToast,
        syncOrderStockDeduction,
        auditService,
        financeService,
        updateOrderDoc: async (targetId, fields) => {
          persistedFields = fields;
          return updateDoc(doc(db, 'orders', targetId), fields);
        },
      },
    });

    if (
      persistedFields &&
      autoPushEnabled &&
      canManageCentralSheet &&
      centralSheet?.spreadsheetId &&
      getGoogleConnectionStatus().connected
    ) {
      const updatedOrderSnapshot = { ...order, ...persistedFields };
      createBrowserCentralizedOrderSheetOrchestrator(actorUser)
        .pushSingleOrderUpdate(updatedOrderSnapshot)
        .catch((err) => {
          console.warn('[OrderManagement] Auto-push to Google Sheet failed:', err);
        });
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
      // Restore stock across products and inventory if order had deducted stock
      if (order.stockClaimDeducted || order.claimed || order.orderStatus === 'Completed' || order.orderStatus === 'Claimed') {
        try {
          await syncOrderStockDeduction({ order, deduct: false });
        } catch (stockErr) {
          console.warn('Error restoring stock on bulk delete:', stockErr);
        }
      }

      // Reverse revenue from IGF ledger if it was synced
      if (order.igfSynced) {
        try {
          await financeService.reverseOrderRevenueFromIGF({
            order,
            user: currentUser,
            reason: `Order #${order.orderId} bulk deleted by officer`
          });
        } catch (revErr) {
          console.warn('Error reversing IGF revenue on bulk delete:', revErr);
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

  // Delete all orders safely via the confirmation modal with full stock restoration & IGF reversal
  const handleDeleteAllOrders = () => {
    if (orders.length === 0) return;
    setSelectedOrders(orders.map((o) => o.docId));
    setBulkDeleteModal(true);
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
    const rawOrderStatus = normalizeOrderStatusUpper(order.orderStatus);
    const isCurrentlyClaimed = order.claimed === true || rawOrderStatus === 'CLAIMED' || rawOrderStatus === 'COMPLETED';
    const newClaimed = !isCurrentlyClaimed;
    const isOnlinePayment = order.paymentInfo?.paymentMethod === 'Online' || rawOrderStatus === 'ONLINE PAID';
    const newStatus = newClaimed ? 'Claimed' : (isOnlinePayment ? 'Online Paid' : 'Pending');
    showToast(`${newClaimed ? 'Claiming' : 'Unclaiming'} order ${order.orderId}...`, 'info');

    try {
      if (newClaimed) {
        // 1. Deduct stock from Product Management and Inventory Management
        await syncOrderStockDeduction({ order, deduct: true });

        // 2. Sync proceeds to IGF Ledger
        // When Online Paid: money was already recorded in IGF upon payment, so ONLY stock changes on claim/completion (no duplicate IGF entry)
        let igfSynced = order.igfSynced;
        const alreadyInIGF = order.igfSynced === true || Boolean(order.igfTxRef);
        if (!alreadyInIGF && !isOnlinePayment) {
          try {
            await financeService.syncOrderRevenueToIGF({
              order: { ...order, claimed: true, orderStatus: 'Claimed' },
              user: currentUser,
              notes: `Merchandise order #${order.orderId} claimed by student`
            });
            igfSynced = true;
          } catch (syncErr) {
            console.warn('IGF sync on claim notice:', syncErr);
          }
        }

        // 3. Update order in Firestore
        await updateDoc(doc(db, 'orders', order.docId), {
          claimed: true,
          orderStatus: 'Claimed',
          claimedAt: new Date().toISOString(),
          claimedBy: userName || currentUser?.displayName || currentUser?.email || 'Officer',
          stockClaimDeducted: true,
          igfSynced: igfSynced ?? false,
          updatedAt: new Date().toISOString(),
        });

        const claimMsg = (isOnlinePayment || alreadyInIGF)
          ? `Order #${order.orderId} completed: stock deducted from inventory (IGF revenue was already recorded upon online payment).`
          : `Order #${order.orderId} claimed: status updated to Claimed & synced to Inventory/IGF!`;

        showToast(claimMsg, 'success');
      } else {
        // Unclaiming: Restore stock
        if (order.stockClaimDeducted) {
          await syncOrderStockDeduction({ order, deduct: false });
        }

        // Reversal of IGF revenue: only reverse if it was a Cash order returning to Pending.
        // Online Paid orders keep their IGF balance since payment was already received online.
        let igfSynced = order.igfSynced;
        if (order.igfSynced && !isOnlinePayment) {
          try {
            await financeService.reverseOrderRevenueFromIGF({
              order: { ...order, docId: order.docId },
              user: currentUser,
              reason: `Order #${order.orderId} unclaim returned to Pending by officer`
            });
            igfSynced = false;
          } catch (revErr) {
            console.warn('IGF reversal notice:', revErr);
          }
        }

        // Update order in Firestore
        await updateDoc(doc(db, 'orders', order.docId), {
          claimed: false,
          orderStatus: newStatus,
          stockClaimDeducted: false,
          unclaimedAt: new Date().toISOString(),
          igfSynced: igfSynced ?? false,
          updatedAt: new Date().toISOString(),
        });

        const unclaimMsg = isOnlinePayment
          ? `Order #${order.orderId} unclaimed: status returned to Online Paid (awaiting pickup; IGF retained).`
          : `Order #${order.orderId} unclaimed: status returned to Pending (stock restored; IGF reversed).`;

        showToast(unclaimMsg, 'info');
      }
    } catch (err) {
      console.error('Error toggling claim status:', err);
      showToast('Failed to update claim status: ' + err.message, 'error');
    }
  };

  // ========================================
  // FILTER ORDERS (MEMOIZED)
  // ========================================
  const filteredOrders = useMemo(() => {
    let result = orders;

    // Filter by status
    if (statusFilter !== 'All') {
      result = result.filter(order => {
        const rawStatus = normalizeOrderStatusUpper(order.orderStatus);
        const isClaimed = order.claimed === true || rawStatus === 'CLAIMED' || rawStatus === 'COMPLETED';
        const isOnlinePaid = !isClaimed && (rawStatus === 'ONLINE PAID' || rawStatus === 'PAID');
        const isReturned = rawStatus === 'RETURNED';
        const isCancelled = rawStatus === 'CANCELLED';
        const isPending = !isClaimed && !isOnlinePaid && !isReturned && !isCancelled;

        if (statusFilter === 'Claimed') return isClaimed;
        if (statusFilter === 'Completed') return rawStatus === 'COMPLETED' || isClaimed;
        if (statusFilter === 'Online Paid' || statusFilter === 'Paid') return isOnlinePaid;
        if (statusFilter === 'Pending') return isPending;
        if (statusFilter === 'Returned') return isReturned;
        if (statusFilter === 'Cancelled') return isCancelled;
        if (statusFilter === 'Unclaimed') return !isClaimed && !isCancelled && !isReturned;
        return String(order.orderStatus ?? '') === statusFilter;
      });
    }

    // Filter by payment method
    if (paymentFilter !== 'All') {
      result = result.filter(order => order.paymentInfo?.paymentMethod === paymentFilter);
    }

    // Search by order ID or customer name
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(order =>
        String(order.orderId ?? '').toLowerCase().includes(q) ||
        String(order.customerInfo?.fullName ?? '').toLowerCase().includes(q) ||
        String(order.customerInfo?.email ?? '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [statusFilter, paymentFilter, searchQuery, orders]);

  // ========================================
  // STATISTICS CALCULATION
  // ========================================
  const getStatistics = () => computeOrderStatistics(orders);

  const stats = getStatistics();

  // ========================================
  // IGF REVENUE LINKAGE METRICS
  // ========================================
  const igfMetrics = useMemo(() => {
    const igfBalance = fromCentavos(igfAccount?.balanceCentavos || 0);

    const settledOrders = orders.filter((o) => {
      const raw = normalizeOrderStatusUpper(o.orderStatus);
      return (
        raw !== 'CANCELLED' &&
        raw !== 'RETURNED' &&
        (o.claimed ||
          raw === 'COMPLETED' ||
          raw === 'PAID' ||
          raw === 'ONLINE PAID' ||
          raw === 'CLAIMED')
      );
    });
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
      // Restore stock across Product Catalog and Inventory if order had deducted stock
      if (order.stockClaimDeducted || order.claimed || order.orderStatus === 'Completed' || order.orderStatus === 'Claimed') {
        try {
          await syncOrderStockDeduction({ order, deduct: false });
        } catch (stockErr) {
          console.warn('Error restoring stock on order delete:', stockErr);
        }
      }

      // Reverse revenue from IGF ledger if it was synced
      if (order.igfSynced) {
        try {
          await financeService.reverseOrderRevenueFromIGF({
            order: { ...order, docId },
            user: currentUser,
            reason: `Order #${orderId} deleted by officer`
          });
        } catch (revErr) {
          console.warn('Error reversing IGF revenue on delete:', revErr);
        }
      }

      // Delete the order
      await deleteDoc(doc(db, 'orders', docId));

      showToast(`Order #${orderId} deleted. Stock restored to Inventory and Product Management.`, 'success');
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

    if (Number.isNaN(date.getTime())) return 'N/A';

    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDateParts = (timestamp) => {
    if (!timestamp) return { date: 'N/A', time: '' };
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (Number.isNaN(date.getTime())) return { date: 'N/A', time: '' };
    return {
      date: date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      time: date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
  };

  // ========================================
  // GET SEMANTIC STATUS KEY
  // ========================================
  const getStatusKey = (status) => {
    const s = normalizeOrderStatusUpper(status);
    switch (s) {
      case 'PENDING':
      case 'UNCLAIMED':
        return 'pending';
      case 'ONLINE PAID':
      case 'PAID':
      case 'ONGOING':
        return 'online-paid';
      case 'COMPLETED':
      case 'CLAIMED':
        return 'claimed';
      case 'RETURNED':
        return 'returned';
      case 'CANCELLED':
        return 'cancelled';
      default:
        return 'pending';
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
    switch (normalizeOrderStatusUpper(status)) {
      case 'PENDING':      return { bg: 'rgba(234,179,8,0.15)',   color: '#fbbf24', border: 'rgba(234,179,8,0.3)' };
      case 'ONLINE PAID':
      case 'PAID':         return { bg: 'rgba(59,130,246,0.15)',  color: '#60a5fa', border: 'rgba(59,130,246,0.3)' };
      case 'ONGOING':      return { bg: 'rgba(99,102,241,0.15)',  color: '#818cf8', border: 'rgba(99,102,241,0.3)' };
      case 'COMPLETED':    return { bg: 'rgba(16,185,129,0.15)',  color: '#34d399', border: 'rgba(16,185,129,0.3)' };
      case 'CLAIMED':      return { bg: 'rgba(16,185,129,0.2)',   color: '#6ee7b7', border: 'rgba(16,185,129,0.4)' };
      case 'RETURNED':     return { bg: 'rgba(168,85,247,0.18)',  color: '#c084fc', border: 'rgba(168,85,247,0.35)' };
      case 'UNCLAIMED':    return { bg: 'rgba(234,179,8,0.15)',   color: '#fbbf24', border: 'rgba(234,179,8,0.3)' };
      case 'CANCELLED':    return { bg: 'rgba(239,68,68,0.15)',   color: '#f87171', border: 'rgba(239,68,68,0.3)' };
      default:             return { bg: 'rgba(148,163,184,0.15)', color: '#94a3b8', border: 'rgba(148,163,184,0.3)' };
    }
  };

  // ========================================
  // RENDER MOBILE ORDERS VIEW
  // ========================================
  const renderMobileOrdersView = () => {
    const STATUS_FILTERS = ['All', 'Pending', 'Online Paid', 'Claimed', 'Completed', 'Returned', 'Cancelled'];

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
              {m === 'All' ? <><CreditCard size={13} /> All Methods</> : m === 'Cash' ? <><Banknote size={13} /> Cash</> : <><Smartphone size={13} /> Online</>}
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
              const rawOrderStatus = normalizeOrderStatusUpper(order.orderStatus);
              const isClaimed = order.claimed || rawOrderStatus === 'CLAIMED';
              const displayStatus = isClaimed
                ? 'Claimed'
                : (rawOrderStatus === 'UNCLAIMED' ? 'Pending' : (typeof order.orderStatus === 'string' && order.orderStatus ? order.orderStatus : 'Pending'));
              const statusStyle = getMobileStatusStyle(displayStatus);

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
                          {displayStatus}
                        </span>
                      </div>
                      <div className={styles.mobileCardBottomRow}>
                        <span className={styles.mobileCustomerName}>{order.customerInfo?.fullName}</span>
                        <span className={styles.mobileOrderPrice}>₱{order.productInfo?.totalPrice?.toFixed(2)}</span>
                      </div>
                      <div className={styles.mobileCardMeta}>
                        <span className={styles.mobileProductName}>{order.productInfo?.productName}</span>
                        {order.igfSynced && (
                          <span className={styles.igfBadgeSynced} style={{ padding: '0.15rem 0.45rem', fontSize: '0.68rem' }}>
                            <ShieldCheck size={11} /> IGF Synced
                          </span>
                        )}
                        {order.stockClaimDeducted && (
                          <span style={{ fontSize: '0.66rem', color: '#059669', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#10b981' }}></span>
                            Stock Synced
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
                        <span className={styles.mobileDetailsSectionTitle}><User size={13} /> Customer</span>
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
                        <span className={styles.mobileDetailsSectionTitle}><Package size={13} /> Product</span>
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
                        <span className={styles.mobileDetailsSectionTitle}><CreditCard size={13} /> Payment</span>
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
                        <span className={styles.mobileDetailsSectionTitle}><Activity size={13} /> Order Status</span>
                        <div style={{ marginTop: '0.4rem' }}>
                          <select
                            className={styles.statusSelect}
                            style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}
                            value={
                              order.claimed || rawOrderStatus === 'CLAIMED'
                                ? 'Claimed'
                                : (rawOrderStatus === 'ONLINE PAID' || rawOrderStatus === 'PAID'
                                    ? 'Online Paid'
                                    : (rawOrderStatus === 'RETURNED'
                                        ? 'Returned'
                                        : (rawOrderStatus === 'UNCLAIMED' ? 'Pending' : (typeof order.orderStatus === 'string' && order.orderStatus ? order.orderStatus : 'Pending'))))
                            }
                            onChange={(e) => handleStatusChange(order, e.target.value)}
                          >
                            <option value="Pending">Pending (Cash on Arrival)</option>
                            <option value="Online Paid">Online Paid (Unclaimed)</option>
                            <option value="Claimed">Claimed (Paid & Fulfilled)</option>
                            <option value="Completed">Completed</option>
                            <option value="Returned">Returned (Bad Product)</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className={styles.mobileCardActions}>
                        <button
                          className={`${styles.mobileActionBtn} ${isClaimed ? styles.mobileActionBtnAmber : styles.mobileActionBtnGreen}`}
                          onClick={() => toggleClaimStatus(order)}
                        >
                          {isClaimed ? <X size={15} /> : <CheckCircle size={15} />}
                          {isClaimed ? 'Unclaim' : 'Mark Claimed'}
                        </button>
                        {!order.igfSynced && (isClaimed || order.orderStatus === 'Completed' || order.orderStatus === 'Paid' || order.orderStatus === 'Online Paid') && order.orderStatus !== 'Cancelled' && order.orderStatus !== 'Returned' && (
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
      {/* Operational Quick-Filter KPI Strip */}
      <div className={styles.ordersQuickStrip}>
        <button
          type="button"
          className={`${styles.quickStatCard} ${statusFilter === 'All' ? styles.quickStatCardActive : ''}`}
          onClick={() => { setStatusFilter('All'); setPage(1); }}
        >
          <div className={styles.quickStatIcon}><Package size={16} /></div>
          <div className={styles.quickStatBody}>
            <span className={styles.quickStatLabel}>All Orders</span>
            <span className={styles.quickStatVal}>{stats.total}</span>
          </div>
        </button>

        <button
          type="button"
          className={`${styles.quickStatCard} ${styles.quickStatGreen} ${statusFilter === 'Claimed' ? styles.quickStatCardActive : ''}`}
          onClick={() => { setStatusFilter(statusFilter === 'Claimed' ? 'All' : 'Claimed'); setPage(1); }}
        >
          <div className={styles.quickStatIcon}><CheckCircle size={16} /></div>
          <div className={styles.quickStatBody}>
            <span className={styles.quickStatLabel}>Claimed & Fulfilled</span>
            <span className={styles.quickStatVal}>{stats.claimed}</span>
          </div>
        </button>

        <button
          type="button"
          className={`${styles.quickStatCard} ${styles.quickStatAmber} ${statusFilter === 'Pending' ? styles.quickStatCardActive : ''}`}
          onClick={() => { setStatusFilter(statusFilter === 'Pending' ? 'All' : 'Pending'); setPage(1); }}
        >
          <div className={styles.quickStatIcon}><Clock size={16} /></div>
          <div className={styles.quickStatBody}>
            <span className={styles.quickStatLabel}>Unclaimed / Pending</span>
            <span className={styles.quickStatVal}>{stats.unclaimed}</span>
          </div>
        </button>

        <div className={`${styles.quickStatCard} ${styles.quickStatStatic}`}>
          <div className={styles.quickStatIcon}><PesoSign size={16} /></div>
          <div className={styles.quickStatBody}>
            <span className={styles.quickStatLabel}>Claimed Revenue</span>
            <span className={styles.quickStatVal}>₱{stats.totalRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>

        <button
          type="button"
          className={`${styles.quickStatCard} ${styles.quickStatGold}`}
          onClick={() => setIgfModalOpen(true)}
          title="Open IGF Treasury Audit & Sync"
        >
          <div className={styles.quickStatIcon}><Landmark size={16} /></div>
          <div className={styles.quickStatBody}>
            <span className={styles.quickStatLabel}>IGF Fund Ledger</span>
            <span className={styles.quickStatVal}>₱{igfMetrics.igfBalance.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </button>
      </div>

      {/* Centralized Google Sheet Status Strip (Visible to all Commerce Hub officers) */}
      {centralSheet?.spreadsheetId && (
        <div className={styles.centralSheetStrip}>
          <div className={styles.centralSheetLeft}>
            <FileSpreadsheet size={16} />
            <span className={styles.centralSheetName}>
              Centralized Sheet: <strong>{centralSheet.spreadsheetTitle}</strong>
            </span>
            <span className={styles.centralSheetMeta}>
              Tab: {centralSheet.sheetTitle} • Owner: {centralSheet.assignedByName || 'SSG Secretariat'}
              {centralSheet.lastSyncedAt
                ? ` • Synced ${new Date(centralSheet.lastSyncedAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}`
                : ''}
            </span>
            {!canManageCentralSheet && (
              <span className={styles.centralSheetReadOnlyTag}>View-Only</span>
            )}
            {canManageCentralSheet && autoPushEnabled && (
              <span className={styles.centralSheetAutoTag}>Auto-Push ON</span>
            )}
          </div>
          <div className={styles.centralSheetRight}>
            <a
              href={centralSheet.spreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.centralSheetLinkBtn}
            >
              <span>Open Google Sheet</span>
              <ExternalLink size={13} />
            </a>
            {canManageCentralSheet && (
              <button
                type="button"
                className={styles.centralSheetSyncShortcut}
                onClick={() => setActiveSection('settings')}
              >
                <RefreshCw size={13} />
                <span>Secretariat Sync</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className={styles.productsToolbar}>
        <div className={styles.productsToolbarLeft}>
          <div className={styles.searchWrapper}>
            <Search className={styles.searchIcon} size={16} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search by Order ID, Student Name, or Email..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            />
            {searchQuery && (
              <button
                type="button"
                className={styles.searchClearBtn}
                onClick={() => { setSearchQuery(''); setPage(1); }}
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className={styles.filterSelect}
            aria-label="Filter by order status"
          >
            <option value="All">All Statuses</option>
            <option value="Pending">Pending (Cash on Arrival)</option>
            <option value="Online Paid">Online Paid (Unclaimed)</option>
            <option value="Claimed">Claimed (Fulfilled)</option>
            <option value="Completed">Completed</option>
            <option value="Returned">Returned (Bad Product)</option>
            <option value="Cancelled">Cancelled</option>
          </select>

          <select
            value={paymentFilter}
            onChange={(e) => { setPaymentFilter(e.target.value); setPage(1); }}
            className={styles.filterSelect}
            aria-label="Filter by payment method"
          >
            <option value="All">All Payment Methods</option>
            <option value="Cash">Cash (Via Officer)</option>
            <option value="Online">Online (e-Wallet)</option>
          </select>
        </div>

        <div className={styles.productsToolbarRight}>
          {selectedOrders.length > 0 && (
            <span className={styles.selectionInfo}>{selectedOrders.length} selected</span>
          )}
          <button
            type="button"
            className={`${styles.syncToolbarBtn} ${styles.btnSyncIgf}`}
            onClick={() => setIgfModalOpen(true)}
            title="Review merchandise revenue and sync with official SSG IGF fund account"
          >
            <Landmark size={15} />
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
            <FileSpreadsheet size={15} />
            <span>Sync Sheet / Excel</span>
          </button>
          <button
            type="button"
            className={`${styles.syncToolbarBtn} ${styles.btnBulkDelete}`}
            onClick={openBulkDeleteModal}
            disabled={selectedOrders.length === 0}
            title="Delete selected orders"
          >
            <Trash2 size={15} />
            <span>Delete Selected</span>
          </button>
          <button
            type="button"
            className={`${styles.syncToolbarBtn} ${styles.btnDeleteAll}`}
            onClick={handleDeleteAllOrders}
            disabled={orders.length === 0}
            title="Delete all orders"
          >
            <Trash2 size={15} />
            <span>Delete All</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className={styles.tableWrapper}>
        {loading ? (
          <div className={styles.emptyState}>
            <div className={styles.mobileSpinner} style={{ margin: '0 auto 0.75rem' }} />
            <p>Loading merchandise orders...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className={styles.emptyState}>
            <AlertCircle size={40} className={styles.emptyStateIcon} />
            <p>
              {orders.length === 0 
                ? 'No orders recorded yet. Orders will appear here once students submit reservations or sheets are synced.'
                : 'No orders match your current search or filter criteria.'}
            </p>
          </div>
        ) : (
          <table className={styles.orderTable}>
            <colgroup>
              <col className={styles.colSelect} />
              <col className={styles.colOrderId} />
              <col className={styles.colCustomer} />
              <col className={styles.colProduct} />
              <col className={styles.colQty} />
              <col className={styles.colTotal} />
              <col className={styles.colStatus} />
              <col className={styles.colPayment} />
              <col className={styles.colIgf} />
              <col className={styles.colDate} />
              <col className={styles.colActions} />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all orders on this page"
                    onChange={toggleSelectAll}
                    checked={paginatedOrders.length > 0 && paginatedOrders.every((o) => selectedOrders.includes(o.docId))}
                  />
                </th>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Total</th>
                <th>Status</th>
                <th>Payment</th>
                <th>IGF Treasury</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedOrders.map((order) => {
                const rawOrderStatus = normalizeOrderStatusUpper(order.orderStatus);
                const safeStatusStr = typeof order.orderStatus === 'string' && order.orderStatus ? order.orderStatus : 'Pending';
                const effectiveStatusValue =
                  order.claimed || rawOrderStatus === 'CLAIMED'
                    ? 'Claimed'
                    : (rawOrderStatus === 'ONLINE PAID' || rawOrderStatus === 'PAID'
                        ? 'Online Paid'
                        : (rawOrderStatus === 'RETURNED'
                            ? 'Returned'
                            : (rawOrderStatus === 'UNCLAIMED' ? 'Pending' : safeStatusStr)));
                const statusKey = getStatusKey(effectiveStatusValue);
                const isRowClaimed = order.claimed || rawOrderStatus === 'CLAIMED' || rawOrderStatus === 'COMPLETED';
                const paymentMethodStr = order.paymentInfo?.paymentMethod || 'Cash';
                const isOnlineMethod = String(paymentMethodStr).toUpperCase().includes('ONLINE');
                const dateParts = formatDateParts(order.dateOrdered);
                const totalVal = Number(order.productInfo?.totalPrice ?? order.totalPrice) || 0;
                const isSelected = selectedOrders.includes(order.docId);

                return (
                  <tr
                    key={order.docId}
                    className={`${styles.tableRow} ${isSelected ? styles.tableRowSelected : ''}`}
                  >
                    <td data-label="Select" className={styles.selectCell}>
                      <input
                        type="checkbox"
                        aria-label={`Select order ${order.orderId}`}
                        checked={isSelected}
                        onChange={() => toggleSelectOrder(order.docId)}
                      />
                    </td>
                    <td data-label="Order ID" className={styles.orderIdCell}>
                      <span className={styles.orderIdBadge}>{order.orderId}</span>
                    </td>
                    <td data-label="Customer">
                      <div className={styles.customerCell}>
                        <span className={styles.customerName} title={order.customerInfo?.fullName}>
                          {order.customerInfo?.fullName || '—'}
                        </span>
                        <span className={styles.customerEmail} title={order.customerInfo?.email}>
                          {order.customerInfo?.email || (order.customerInfo?.section ? `Sec: ${order.customerInfo.section}` : '—')}
                        </span>
                      </div>
                    </td>
                    <td data-label="Product">
                      <div className={styles.productCell}>
                        <span className={styles.productName} title={order.productInfo?.productName}>
                          {order.productInfo?.productName || '—'}
                        </span>
                        {(order.productInfo?.size && order.productInfo?.size !== 'N/A') ||
                         (order.productInfo?.color && order.productInfo?.color !== 'N/A') ? (
                          <span className={styles.productVariant}>
                            {order.productInfo?.size && order.productInfo?.size !== 'N/A' && `Size: ${order.productInfo.size}`}
                            {order.productInfo?.size && order.productInfo?.size !== 'N/A' && order.productInfo?.color && order.productInfo?.color !== 'N/A' && ' • '}
                            {order.productInfo?.color && order.productInfo?.color !== 'N/A' && `Color: ${order.productInfo.color}`}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td data-label="Quantity" className={styles.quantityCell}>
                      <span className={styles.qtyPill}>{order.productInfo?.quantity ?? 1}</span>
                    </td>
                    <td data-label="Total" className={styles.priceCell}>
                      ₱{totalVal.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td data-label="Status" className={styles.statusCell}>
                      <select
                        className={styles.statusSelect}
                        data-status={statusKey}
                        value={effectiveStatusValue}
                        onChange={(e) => handleStatusChange(order, e.target.value)}
                        title={`Order Status: ${effectiveStatusValue} — Click to update`}
                      >
                        <option value="Pending">Pending · Cash</option>
                        <option value="Online Paid">Online Paid</option>
                        <option value="Claimed">Claimed · Paid</option>
                        <option value="Completed">Completed</option>
                        <option value="Returned">Returned</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </td>
                    <td data-label="Payment" className={styles.paymentCell}>
                      <div className={styles.paymentStack}>
                        <span
                          className={styles.paymentBadge}
                          data-method={isOnlineMethod ? 'online' : 'cash'}
                        >
                          {isOnlineMethod ? <Smartphone size={11} /> : <Banknote size={11} />}
                          <span>{paymentMethodStr}</span>
                        </span>
                        {order.paymentInfo?.referenceNumber && order.paymentInfo.referenceNumber !== 'N/A' && (
                          <span className={styles.paymentRef} title={`Ref: ${order.paymentInfo.referenceNumber}`}>
                            #{order.paymentInfo.referenceNumber}
                          </span>
                        )}
                      </div>
                    </td>
                    <td data-label="IGF Treasury" className={styles.igfCell}>
                      {order.igfSynced ? (
                        <span className={styles.igfBadgeSynced} title={`Recorded in IGF ledger: ${order.igfTxRef || 'IGF-ORD'}`}>
                          <ShieldCheck size={13} />
                          <span>IGF Synced</span>
                        </span>
                      ) : (
                        (order.claimed ||
                          rawOrderStatus === 'COMPLETED' ||
                          rawOrderStatus === 'PAID' ||
                          rawOrderStatus === 'ONLINE PAID' ||
                          rawOrderStatus === 'CLAIMED') &&
                        rawOrderStatus !== 'CANCELLED' &&
                        rawOrderStatus !== 'RETURNED'
                      ) ? (
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
                        <span className={styles.igfBadgePending}>Unsettled</span>
                      )}
                    </td>
                    <td data-label="Date" className={styles.dateCell}>
                      <div className={styles.dateStack}>
                        <span className={styles.datePrimary}>{dateParts.date}</span>
                        {dateParts.time && <span className={styles.dateSecondary}>{dateParts.time}</span>}
                      </div>
                    </td>
                    <td data-label="Actions" className={styles.actionsCell}>
                      <div className={styles.tableActionsGroup}>
                        <button
                          type="button"
                          className={styles.claimBtn}
                          data-claimed={isRowClaimed ? 'true' : 'false'}
                          onClick={() => toggleClaimStatus(order)}
                          title={isRowClaimed ? 'Mark order as Unclaimed' : 'Mark order as Claimed & Fulfilled'}
                        >
                          {isRowClaimed ? <X size={13} /> : <CheckCircle size={13} />}
                          <span>{isRowClaimed ? 'Unclaim' : 'Claim'}</span>
                        </button>
                        <button
                          type="button"
                          className={styles.tableEditBtn}
                          onClick={() => handleEditClick(order)}
                          title="Edit Order Details"
                        >
                          <Edit2 size={13} />
                          <span>Edit</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
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
    <div className={styles.settingsView} style={{ minHeight: 'unset' }}>
      <SheetSyncPanel
        centralSheet={centralSheet}
        autoPushEnabled={autoPushEnabled}
        onToggleAutoPush={setAutoPushEnabled}
        onSyncCompleted={() => {
          // Switch to orders view after brief delay so user can immediately see synced orders
          setTimeout(() => setActiveSection('orders'), 1200);
        }}
      />
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
          <LayoutDashboard size={15} />
          <span>Dashboard</span>
        </button>
        <button
          className={`${styles.omTabBtn} ${activeSection === 'orders' ? styles.omTabBtnActive : ''}`}
          onClick={() => setActiveSection('orders')}
        >
          <Package size={15} />
          <span>Orders</span>
          <span className={styles.omTabBadge}>{orders.length}</span>
        </button>
        <button
          className={`${styles.omTabBtn} ${activeSection === 'settings' ? styles.omTabBtnActive : ''}`}
          onClick={() => setActiveSection('settings')}
        >
          <FileSpreadsheet size={15} />
          <span>Sheet & Excel Sync</span>
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
            <div className={styles.confirmCalloutBox}>
              {confirmModal.newStatus === 'Claimed' || confirmModal.newStatus === 'Completed' ? (
                confirmModal.currentStatus === 'Online Paid' || confirmModal.order?.paymentInfo?.paymentMethod === 'Online' ? (
                  <span><Package size={15} className={styles.inlineIcon} /> <strong>Online Paid Order Completed:</strong> Only the physical inventory & product stock will decrease. The IGF Ledger is <strong>not</strong> re-credited, preventing duplicate records.</span>
                ) : (
                  <span><Package size={15} className={styles.inlineIcon} /> <strong>Cash Order Paid & Claimed:</strong> Stock will be decreased in Inventory/Products and cash proceeds recorded in the IGF Ledger.</span>
                )
              ) : confirmModal.newStatus === 'Online Paid' ? (
                <span><CreditCard size={15} className={styles.inlineIcon} /> <strong>Paid Online (Unclaimed):</strong> Payment is received and recorded in IGF Ledger. Stock remains available/reserved until student pickup.</span>
              ) : confirmModal.newStatus === 'Pending' ? (
                <span><Clock size={15} className={styles.inlineIcon} /> <strong>Cash on Arrival/Claiming:</strong> Unpaid and unclaimed. Stock remains in inventory, and any previous IGF credit is reversed.</span>
              ) : confirmModal.newStatus === 'Returned' ? (
                <span><RotateCcw size={15} className={styles.inlineIcon} /> <strong>Defective Product Returned:</strong> Returned due to bad product. Proceeds will be reversed/refunded from IGF Ledger, and the item logged as a defective return.</span>
              ) : confirmModal.newStatus === 'Cancelled' ? (
                <span><XCircle size={15} className={styles.inlineIcon} /> <strong>Order Cancelled:</strong> Reserved stock is restored, and any credited IGF revenue is reversed.</span>
              ) : null}
            </div>
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