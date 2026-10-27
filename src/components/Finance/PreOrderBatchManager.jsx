import React, { useState } from 'react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import usePermissions from '../../hooks/usePermissions.js';
import {
  PRE_ORDER_BATCH_STATUSES,
  PRE_ORDER_BATCH_STATUS_LABELS,
  formatPHP,
  fromCentavos,
} from '../../utils/financeConstants.js';
import financeService from '../../services/financeService.js';
import styles from './FundGovernance.module.css';
import {
  HiPlus,
  HiShoppingBag,
  HiCheckCircle,
  HiExclamationCircle,
  HiClipboardCheck,
  HiX,
  HiUserGroup,
} from 'react-icons/hi';

const PreOrderBatchManager = () => {
  const { preOrderBatches, refreshFinanceData } = useFinance();
  const { currentUser, userName, userRole } = useAuth();
  const { canEditFinance, canAuditFinance } = usePermissions();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState(null);

  // Form State for creating batch
  const [batchForm, setBatchForm] = useState({
    name: '',
    product: '',
    unitPrice: '',
    custodianName: userName || '',
  });

  // Form State for student order entry
  const [orderForm, setOrderForm] = useState({
    studentId: '',
    studentName: '',
    variant: 'Standard',
    quantity: 1,
    amountPaid: '',
  });

  const [submitting, setSubmitting] = useState(false);

  const handleCreateBatch = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await financeService.createPreOrderBatch(
        {
          name: batchForm.name,
          product: batchForm.product,
          unitPrice: parseFloat(batchForm.unitPrice),
          custodianUserId: currentUser?.uid,
          custodianName: batchForm.custodianName,
        },
        { uid: currentUser?.uid, userName, displayName: userName }
      );
      await refreshFinanceData();
      setIsCreateModalOpen(false);
      setBatchForm({ name: '', product: '', unitPrice: '', custodianName: userName || '' });
    } catch (err) {
      alert(err.message || 'Error creating batch.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!selectedBatch) return;
    try {
      setSubmitting(true);
      await financeService.recordStudentPreOrderPayment({
        batchId: selectedBatch.id,
        studentId: orderForm.studentId,
        studentName: orderForm.studentName,
        variant: orderForm.variant,
        quantity: parseInt(orderForm.quantity, 10),
        amountPaid: parseFloat(orderForm.amountPaid),
        officerUser: { uid: currentUser?.uid, userName, displayName: userName },
      });
      await refreshFinanceData();
      setIsOrderModalOpen(false);
      setOrderForm({ studentId: '', studentName: '', variant: 'Standard', quantity: 1, amountPaid: '' });
      alert('Student pre-order payment recorded and posted to IGF collections.');
    } catch (err) {
      alert(err.message || 'Error recording order payment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className={styles.actionRow}>
        {canEditFinance && (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => setIsCreateModalOpen(true)}
          >
            <HiPlus size={16} /> New Pre-Order Batch
          </button>
        )}
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <h2 className={styles.tableTitle}>IGF Pre-Order Batches & Procurement Runs</h2>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            {preOrderBatches.length} active runs
          </span>
        </div>

        {preOrderBatches.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
            No pre-order batches configured yet. Create one for lanyards, uniforms, or merchandise.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
            {preOrderBatches.map((batch) => (
              <div key={batch.id} className={styles.fundCard}>
                <div className={styles.cardHeader}>
                  <div className={`${styles.fundIconBadge} ${styles.badgeIGF}`}>
                    <HiShoppingBag size={20} />
                  </div>
                  <span className={styles.statusPill} style={{ background: '#e0f2fe', color: '#0369a1' }}>
                    {PRE_ORDER_BATCH_STATUS_LABELS[batch.status] || batch.status}
                  </span>
                </div>

                <h3 className={styles.fundTitle}>{batch.name}</h3>
                <p className={styles.fundSub}>Product: {batch.product} | Unit: {formatPHP(batch.unitPriceCentavos, true)}</p>

                <div style={{ margin: '1rem 0', background: '#f8fafc', padding: '0.75rem', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.35rem' }}>
                    <span>Collected from Students:</span>
                    <strong style={{ color: '#16a34a' }}>{formatPHP(batch.collectedCentavos || 0, true)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.35rem' }}>
                    <span>Committed Supplier Cost:</span>
                    <span>{formatPHP(batch.committedSupplierCentavos || 0, true)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem' }}>
                    <span>Paid to Supplier:</span>
                    <span>{formatPHP(batch.paidSupplierCentavos || 0, true)}</span>
                  </div>
                </div>

                <div className={styles.fundMeta}>
                  <span>Custodian: {batch.custodianName || 'SSG Treasury'}</span>
                  {canEditFinance && (
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                      onClick={() => {
                        setSelectedBatch(batch);
                        setOrderForm((prev) => ({
                          ...prev,
                          amountPaid: fromCentavos(batch.unitPriceCentavos),
                        }));
                        setIsOrderModalOpen(true);
                      }}
                    >
                      <HiPlus size={12} /> Record Payment
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Batch Modal */}
      {isCreateModalOpen && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalContent} style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Create Pre-Order Batch</h3>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setIsCreateModalOpen(false)}>
                <HiX size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateBatch}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Batch Name *</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="e.g. Official SSG Lanyard 2026 Batch 1"
                  value={batchForm.name}
                  onChange={(e) => setBatchForm({ ...batchForm, name: e.target.value })}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Product Name *</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="e.g. Lanyard / Polo Shirt"
                  value={batchForm.product}
                  onChange={(e) => setBatchForm({ ...batchForm, product: e.target.value })}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Unit Price (PHP ₱) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className={styles.formInput}
                  placeholder="e.g. 150.00"
                  value={batchForm.unitPrice}
                  onChange={(e) => setBatchForm({ ...batchForm, unitPrice: e.target.value })}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Responsible Custodian</label>
                <input
                  type="text"
                  className={styles.formInput}
                  value={batchForm.custodianName}
                  onChange={(e) => setBatchForm({ ...batchForm, custodianName: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" className={styles.secondaryBtn} onClick={() => setIsCreateModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.primaryBtn} disabled={submitting}>
                  {submitting ? 'Creating...' : 'Initialize Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Student Order Payment Modal */}
      {isOrderModalOpen && selectedBatch && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalContent} style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Record Student Payment</h3>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setIsOrderModalOpen(false)}>
                <HiX size={20} />
              </button>
            </div>

            <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', background: '#f8fafc', borderRadius: '8px', fontSize: '0.85rem' }}>
              <div>Batch: <strong>{selectedBatch.name}</strong></div>
              <div>Unit Price: <strong>{formatPHP(selectedBatch.unitPriceCentavos, true)}</strong></div>
            </div>

            <form onSubmit={handleRecordPayment}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Student ID Number *</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="e.g. 2026-10492"
                  value={orderForm.studentId}
                  onChange={(e) => setOrderForm({ ...orderForm, studentId: e.target.value })}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Student Full Name *</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="Juan Dela Cruz"
                  value={orderForm.studentName}
                  onChange={(e) => setOrderForm({ ...orderForm, studentName: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Variant / Size</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="Standard / M / L"
                    value={orderForm.variant}
                    onChange={(e) => setOrderForm({ ...orderForm, variant: e.target.value })}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Quantity</label>
                  <input
                    type="number"
                    min="1"
                    className={styles.formInput}
                    value={orderForm.quantity}
                    onChange={(e) => {
                      const qty = parseInt(e.target.value, 10) || 1;
                      setOrderForm({
                        ...orderForm,
                        quantity: qty,
                        amountPaid: fromCentavos(selectedBatch.unitPriceCentavos * qty),
                      });
                    }}
                    required
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Amount Paid (PHP ₱) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className={styles.formInput}
                  value={orderForm.amountPaid}
                  onChange={(e) => setOrderForm({ ...orderForm, amountPaid: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" className={styles.secondaryBtn} onClick={() => setIsOrderModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.primaryBtn} disabled={submitting}>
                  {submitting ? 'Posting...' : 'Post Collection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PreOrderBatchManager;
