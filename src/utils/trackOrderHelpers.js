/**
 * src/utils/trackOrderHelpers.js
 * Pure status metadata & timeline state resolver for public order tracking.
 * Covers all officer lifecycle statuses written by OrderManagement.jsx:
 *   Pending | Paid | Online Paid | Ongoing | Completed | Claimed | Returned | Cancelled
 */

const PAID_OR_BEYOND = new Set(['Paid', 'Online Paid', 'Ongoing', 'Completed', 'Claimed']);
const PROCESSING_OR_BEYOND = new Set(['Ongoing', 'Completed', 'Claimed']);
const READY_OR_CLAIMED = new Set(['Completed', 'Claimed']);
const ACTIVE_PLACED = new Set(['Pending', 'Paid', 'Online Paid', 'Ongoing', 'Completed', 'Claimed']);

export function resolveTrackOrderStatusMeta(status) {
  switch (status) {
    case 'Pending':
      return {
        iconKey: 'clock',
        color: '#E66B3D',
        bgColor: '#fffbeb',
        label: 'Pending',
        description: 'Your order has been received and is awaiting payment confirmation.',
        progress: 25,
        isTerminalNegative: false,
      };
    case 'Paid':
      return {
        iconKey: 'creditCard',
        color: '#10b981',
        bgColor: '#ecfdf5',
        label: 'Payment Confirmed',
        description: 'Payment has been confirmed. Your order is being prepared.',
        progress: 50,
        isTerminalNegative: false,
      };
    case 'Online Paid':
      return {
        iconKey: 'creditCard',
        color: '#10b981',
        bgColor: '#ecfdf5',
        label: 'Online Payment Confirmed',
        description: 'Your GCash / PayMaya payment has been verified by the SSG office. Your order is being prepared.',
        progress: 50,
        isTerminalNegative: false,
      };
    case 'Ongoing':
      return {
        iconKey: 'truck',
        color: '#3b82f6',
        bgColor: '#eff6ff',
        label: 'In Progress',
        description: 'Your order is currently being processed and prepared for pickup.',
        progress: 75,
        isTerminalNegative: false,
      };
    case 'Completed':
      return {
        iconKey: 'checkCircle',
        color: '#10b981',
        bgColor: '#ecfdf5',
        label: 'Ready for Pickup',
        description: 'Your order is ready for pickup at the SSG Office.',
        progress: 100,
        isTerminalNegative: false,
      };
    case 'Claimed':
      return {
        iconKey: 'checkCircle',
        color: '#10b981',
        bgColor: '#ecfdf5',
        label: 'Claimed',
        description: 'Your order has been claimed and completed. Thank you for supporting SSG!',
        progress: 100,
        isTerminalNegative: false,
      };
    case 'Returned':
      return {
        iconKey: 'xCircle',
        color: '#ef4444',
        bgColor: '#fef2f2',
        label: 'Returned',
        description: 'This order was marked as returned. Please visit the SSG Office for assistance.',
        progress: 0,
        isTerminalNegative: true,
      };
    case 'Cancelled':
      return {
        iconKey: 'xCircle',
        color: '#ef4444',
        bgColor: '#fef2f2',
        label: 'Cancelled',
        description: 'This order has been cancelled. Please contact support for more information.',
        progress: 0,
        isTerminalNegative: true,
      };
    default:
      return {
        iconKey: 'package',
        color: '#94a3b8',
        bgColor: '#f1f5f9',
        label: status || 'Unknown',
        description: 'Order status information.',
        progress: 25,
        isTerminalNegative: false,
      };
  }
}

export function getTrackOrderTimelineState(status) {
  const placed = ACTIVE_PLACED.has(status);
  const paid = PAID_OR_BEYOND.has(status);
  const processing = PROCESSING_OR_BEYOND.has(status);
  const ready = READY_OR_CLAIMED.has(status);

  return {
    placed,
    paid,
    processing,
    ready,
    paidLabel: paid ? (status === 'Online Paid' ? 'Online Verified' : 'Confirmed') : 'Pending',
    processingLabel: ready ? 'Done' : processing ? 'In Progress' : 'Waiting',
    readyLabel: status === 'Claimed' ? 'Claimed' : ready ? 'Ready' : 'Waiting',
  };
}
