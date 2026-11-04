/**
 * Order Status Transition Module
 * Extracted from OrderManagement.jsx to provide a testable seam for order status updates,
 * stock deduction/restoration, and IGF revenue synchronization.
 */

export function normalizeOrderStatusUpper(status) {
  if (typeof status === 'string') return status.trim().toUpperCase();
  if (typeof status === 'boolean' || typeof status === 'number') {
    return String(status).toUpperCase();
  }
  return '';
}

export function computeOrderStatistics(orders = []) {
  const claimedOrders = orders.filter((o) => {
    const raw = normalizeOrderStatusUpper(o.orderStatus);
    return Boolean(o.claimed) || raw === 'CLAIMED' || raw === 'COMPLETED';
  });
  const onlinePaidOrders = orders.filter((o) => {
    const raw = normalizeOrderStatusUpper(o.orderStatus);
    return !o.claimed && raw !== 'CLAIMED' && raw !== 'COMPLETED' && (raw === 'ONLINE PAID' || raw === 'PAID');
  });
  const pendingOrders = orders.filter((o) => {
    const raw = normalizeOrderStatusUpper(o.orderStatus);
    return (
      !o.claimed &&
      raw !== 'CLAIMED' &&
      raw !== 'COMPLETED' &&
      (raw === 'PENDING' || raw === 'UNCLAIMED' || !raw)
    );
  });
  const returnedOrders = orders.filter((o) => {
    const raw = normalizeOrderStatusUpper(o.orderStatus);
    return raw === 'RETURNED';
  });
  const unclaimedOrders = orders.filter((o) => {
    const raw = normalizeOrderStatusUpper(o.orderStatus);
    return !o.claimed && raw !== 'CLAIMED' && raw !== 'COMPLETED';
  });

  const claimedRevenue = claimedOrders.reduce(
    (sum, order) => sum + (Number(order.productInfo?.totalPrice) || 0),
    0
  );
  const onlinePaidRevenue = onlinePaidOrders.reduce(
    (sum, order) => sum + (Number(order.productInfo?.totalPrice) || 0),
    0
  );
  const totalRevenue = claimedRevenue + onlinePaidRevenue;

  return {
    total: orders.length,
    claimed: claimedOrders.length,
    onlinePaid: onlinePaidOrders.length,
    pending: pendingOrders.length,
    returned: returnedOrders.length,
    unclaimed: unclaimedOrders.length,
    totalRevenue,
  };
}

export async function executeOrderStatusUpdate({ docId, newStatus, order, deps }) {
  const {
    currentUser,
    userName,
    showToast,
    syncOrderStockDeduction,
    auditService,
    financeService,
    updateOrderDoc,
  } = deps;

  showToast(`Updating order ${order.orderId}...`, 'info');

  try {
    const oldStatus = order.orderStatus;
    const isClaimAction = newStatus === 'Claimed' || newStatus === 'Completed';
    const isOnlinePaid = newStatus === 'Online Paid' || newStatus === 'Paid';
    const wasOnlinePaid =
      oldStatus === 'Online Paid' ||
      oldStatus === 'Paid' ||
      order.paymentInfo?.paymentMethod === 'Online';
    const wasClaimAction =
      oldStatus === 'Claimed' ||
      oldStatus === 'Completed' ||
      order.claimed ||
      order.stockClaimDeducted;
    const isReturned = newStatus === 'Returned';
    const isPending = newStatus === 'Pending';
    const isCancelled = newStatus === 'Cancelled';

    // 1. Stock handling:
    // When Claimed/Completed: deduct stock from Product Catalog and Inventory Register
    if (isClaimAction && !order.stockClaimDeducted) {
      await syncOrderStockDeduction({ order, deduct: true });
    }

    // When moved to Pending, Online Paid (unclaimed), or Cancelled from a claimed state: restore stock
    if (
      (isCancelled || isPending || (isOnlinePaid && wasClaimAction)) &&
      order.stockClaimDeducted
    ) {
      await syncOrderStockDeduction({ order, deduct: false });
    }

    // When Returned (defective/bad product):
    // Do NOT return bad/defective items into sellable inventory. Log an audit trail entry for quarantine.
    if (isReturned) {
      const performer =
        userName ||
        currentUser?.displayName ||
        currentUser?.email ||
        'Commerce Hub Officer';
      await auditService.logInventoryUpdate(
        performer,
        order.productInfo?.productName || 'Merchandise Item',
        `Order #${order.orderId} returned (bad product): quarantined defective item (revenue reversed from IGF)`
      );
    }

    // 2. IGF Revenue Integration:
    // When Claimed/Completed or Online Paid: proceeds must be recorded into IGF Ledger
    // CRITICAL PRE-EMPTION: If an order was Online Paid or already has an active IGF sync record,
    // completing/claiming it ONLY deducts stock — IGF is NOT re-credited so it won't have duplicate records.
    const isAlreadyInIGF = order.igfSynced === true && !order.igfReversed;
    let igfSynced = order.igfSynced || (isClaimAction && wasOnlinePaid);
    if (
      ((isClaimAction && !wasOnlinePaid) || isOnlinePaid) &&
      !isAlreadyInIGF
    ) {
      try {
        await financeService.syncOrderRevenueToIGF({
          order: { ...order, docId, orderStatus: newStatus },
          user: currentUser,
          notes: `Merchandise order #${order.orderId} status set to ${newStatus}`,
        });
        igfSynced = true;
      } catch (syncErr) {
        console.warn('Auto IGF sync notice:', syncErr);
      }
    }

    // When Cancelled, Pending (Cash on Arrival), or Returned (bad product refund):
    // Reverse proceeds from IGF Ledger if it had synced
    if ((isCancelled || isPending || isReturned) && order.igfSynced) {
      try {
        await financeService.reverseOrderRevenueFromIGF({
          order: { ...order, docId },
          user: currentUser,
          reason: isReturned
            ? `Order #${order.orderId} returned (bad/defective product refund)`
            : `Order #${order.orderId} moved to ${newStatus} by officer`,
        });
        igfSynced = false;
      } catch (revErr) {
        console.warn('Auto IGF reversal notice:', revErr);
      }
    }

    // 3. Update order status in Firestore
    const nowIso = new Date().toISOString();
    const performer =
      userName ||
      currentUser?.displayName ||
      currentUser?.email ||
      'Officer';

    await updateOrderDoc(docId, {
      orderStatus: newStatus,
      claimed: isClaimAction,
      claimedAt: isClaimAction ? nowIso : (order.claimedAt || null),
      claimedBy: isClaimAction ? performer : (order.claimedBy || null),
      stockClaimDeducted: isClaimAction,
      igfSynced: igfSynced ?? false,
      returnedAt: isReturned ? nowIso : order.returnedAt || null,
      updatedAt: nowIso,
    });

    const detailMsg = isClaimAction
      ? isAlreadyInIGF || wasOnlinePaid
        ? ' (Completed: stock decreased; IGF already recorded upon online payment)'
        : ' (Paid & Claimed: stock deducted & IGF synced)'
      : isOnlinePaid
        ? ' (Paid Online: proceeds in IGF, awaiting pickup)'
        : isReturned
          ? ' (Returned: defective product logged & IGF refunded)'
          : isPending
            ? ' (Cash on Arrival: awaiting payment on claim)'
            : '';

    showToast(
      `Order #${order.orderId} status updated to ${newStatus}${detailMsg}.`,
      'success'
    );
  } catch (error) {
    console.error('Error updating order status:', error);
    showToast('Error updating order status: ' + error.message, 'error');
  }
}
