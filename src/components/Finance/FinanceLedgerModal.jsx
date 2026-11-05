import React, { useState } from 'react';
import { HiX, HiExclamation, HiCheckCircle, HiArrowSmLeft, HiShieldCheck } from 'react-icons/hi';
import styles from './FundGovernance.module.css';

/**
 * ReversalModal
 * Replaces window.alert() / window.prompt() with an accessible, role-aware modal dialog.
 */
export const ReversalModal = ({
  isOpen,
  transaction,
  onClose,
  onConfirm,
  isSubmitting = false,
}) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  if (!isOpen || !transaction) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError('A comprehensive justification is required for regulatory audit trail compliance.');
      return;
    }
    onConfirm(reason.trim());
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modalContent} style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.4rem' }}>🔄</span>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#1e293b' }}>
              Reverse Ledger Transaction
            </h3>
          </div>
          <button
            type="button"
            className={styles.modalCloseBtn}
            onClick={onClose}
            aria-label="Close modal"
          >
            <HiX size={20} />
          </button>
        </div>

        <div style={{ padding: '0.875rem', background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '8px', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#92400e', marginBottom: '0.25rem' }}>
            Transaction Reference: #{transaction.id?.slice(0, 8)}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#78350f' }}>
            Amount: <strong>₱{(transaction.amountCentavos ? transaction.amountCentavos / 100 : transaction.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong> · {transaction.description || 'Ledger Entry'}
          </div>
        </div>

        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.25rem', lineHeight: 1.5 }}>
          Ledger entries are immutable. Confirming will append an opposing balancing transaction to preserve institutional double-entry integrity.
        </p>

        {error && (
          <div style={{ padding: '0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Reason for Reversal *</label>
            <textarea
              className={styles.formInput}
              rows={3}
              placeholder="e.g. Inadvertent duplicate entry or erroneous account coding"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.primaryBtn}
              style={{ background: '#dc2626' }}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Recording Reversal...' : 'Confirm Reversal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/**
 * OverspendingNoticeModal
 * Warning dialog informing officers that procurement exceeds line-item allocation.
 */
export const OverspendingNoticeModal = ({
  isOpen,
  warnings = [],
  onClose,
  onProceed,
}) => {
  if (!isOpen) return null;

  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modalContent} style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d97706' }}>
            <HiExclamation size={24} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#1e293b' }}>
              PPMP Overspending Advisory
            </h3>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              FINANCE_CLARIFICATION §3.5 Protocol
            </span>
          </div>
        </div>

        <div style={{ fontSize: '0.875rem', color: '#475569', lineHeight: 1.5, marginBottom: '1.25rem' }}>
          This transaction exceeds the authorized line-item budget allocation. University policy permits processing provided sufficient cash exists in the primary holding account, but it will be flagged for audit review:
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.875rem', marginBottom: '1.5rem' }}>
          {warnings.map((w, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem', color: '#b45309', marginBottom: idx === warnings.length - 1 ? 0 : '0.5rem' }}>
              <span>⚠️</span>
              <span>{w}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>
            Revise Transaction
          </button>
          <button type="button" className={styles.primaryBtn} onClick={onProceed}>
            Acknowledge &amp; Post
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * RestoreAllocationModal
 * Replaces window.confirm() for restoring archived budget allocations.
 */
export const RestoreAllocationModal = ({
  isOpen,
  budget,
  onClose,
  onConfirm,
  isSubmitting = false,
}) => {
  if (!isOpen || !budget) return null;

  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modalContent} style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}>
            <HiArrowSmLeft size={24} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#1e293b' }}>
              Restore Budget Allocation
            </h3>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Return to Active PPMP Matrix
            </span>
          </div>
        </div>

        <p style={{ fontSize: '0.875rem', color: '#475569', lineHeight: 1.5, marginBottom: '1.25rem' }}>
          Are you sure you want to restore <strong>"{budget.eventName}"</strong>? It will return to the active legislative procurement schedule and can draw disbursements.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="button" className={styles.primaryBtn} onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? 'Restoring...' : 'Confirm Restore'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default {
  ReversalModal,
  OverspendingNoticeModal,
  RestoreAllocationModal,
};
