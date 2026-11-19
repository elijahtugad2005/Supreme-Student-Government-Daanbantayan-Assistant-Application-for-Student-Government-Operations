import React, { useState, useEffect, useMemo } from 'react';
import { X, Check, CheckCircle2, Paperclip, AlertCircle } from 'lucide-react';
import { RECEIPT_LABELS } from '../../utils/financeLedgerReconciliation.js';
import styles from './InventoryManagement.module.css';

const ConsumableExpenseDialog = ({
  isOpen,
  fundBalances,
  isClassic,
  userName,
  uploadReceiptToDrive,
  onClose,
  onSave,
}) => {
  const [formData, setFormData] = useState({
    fundSource: 'IGF',
    name: '',
    receiptLabel: 'Food & Meals',
    quantity: 1,
    unitCost: '',
    receiptOrNumber: '',
    receiptDetails: '',
    receiptDriveLink: '',
    receiptFileId: '',
  });
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        fundSource: 'IGF',
        name: '',
        receiptLabel: 'Food & Meals',
        quantity: 1,
        unitCost: '',
        receiptOrNumber: '',
        receiptDetails: '',
        receiptDriveLink: '',
        receiptFileId: '',
      });
      setError('');
      setUploadingReceipt(false);
      setUploadProgress(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const totalCost = useMemo(() => {
    const q = Math.max(1, parseInt(formData.quantity, 10) || 1);
    const u = parseFloat(formData.unitCost) || 0;
    return Math.round(q * u * 100) / 100;
  }, [formData.quantity, formData.unitCost]);

  const selectedFundBalance =
    formData.fundSource === 'IGP' ? fundBalances.IGP || 0 : fundBalances.IGF || 0;
  const isInsufficient = totalCost > selectedFundBalance;

  const hasReceiptProof = Boolean(
    formData.receiptDriveLink.trim() ||
      formData.receiptOrNumber.trim() ||
      formData.receiptDetails.trim()
  );

  const handleDriveUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploadingReceipt(true);
    setUploadProgress(15);
    try {
      const uploaded = await uploadReceiptToDrive(
        file,
        {
          title: formData.name || file.name,
          orNumber: formData.receiptOrNumber,
          label: formData.receiptLabel,
        },
        (pct) => setUploadProgress(pct)
      );
      setFormData((prev) => ({
        ...prev,
        receiptDriveLink: uploaded.driveWebViewLink || '',
        receiptFileId: uploaded.driveFileId || '',
      }));
    } catch (err) {
      setError(err.message || 'Failed to upload receipt to Google Drive Receipts folder.');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!formData.name.trim()) {
      setError('Please enter the food, snack, or consumable item name.');
      return;
    }
    if (totalCost <= 0) {
      setError('Unit cost must be greater than ₱0.00.');
      return;
    }
    if (isInsufficient) {
      setError(
        `Insufficient ${formData.fundSource} balance (Available: ₱${selectedFundBalance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}).`
      );
      return;
    }
    if (!hasReceiptProof) {
      setError(
        'Please upload a receipt photo/PDF to Google Drive OR enter the Official Receipt (OR #) / item details.'
      );
      return;
    }

    setSubmitting(true);
    try {
      await onSave({
        ...formData,
        recordedBy: userName || 'Authorized Officer',
      });
    } catch (err) {
      setError(err.message || 'Failed to record consumable expense.');
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
            <h2>Record Consumable / Food Expense</h2>
            <p className={styles.modalSubtitle}>
              Log student snacks, event meals (e.g. Chooks-to-Go lunch), or non-borrowable supplies directly to the Finance Ledger
            </p>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGrid}>
            <div className={styles.formGroup} style={{ gridColumn: 'span 2' }}>
              <label>Expense Fund Source *</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '6px' }}>
                {['IGF', 'IGP'].map((src) => {
                  const active = formData.fundSource === src;
                  const bal = src === 'IGP' ? fundBalances.IGP || 0 : fundBalances.IGF || 0;
                  const accent = src === 'IGF' ? '#d97706' : '#059669';
                  return (
                    <label
                      key={src}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        padding: '12px',
                        borderRadius: '8px',
                        border: active ? `2px solid ${accent}` : '1px solid rgba(255,255,255,0.15)',
                        background: active
                          ? src === 'IGF'
                            ? 'rgba(217, 119, 6, 0.08)'
                            : 'rgba(5, 150, 105, 0.08)'
                          : 'rgba(255,255,255,0.03)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="radio"
                        name="expenseFundSource"
                        value={src}
                        checked={active}
                        onChange={() => setFormData((prev) => ({ ...prev, fundSource: src }))}
                        style={{ marginTop: '3px' }}
                      />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.92rem', color: accent }}>
                          {src === 'IGF' ? 'IGF — Income Generated Fund' : 'IGP — Income-Generating Projects'}
                        </div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: accent, marginTop: '4px' }}>
                          Available: ₱{bal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {totalCost > 0 && (
                <div
                  style={{
                    marginTop: '10px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: isInsufficient ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.1)',
                    border: `1px solid ${isInsufficient ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.3)'}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.85rem',
                  }}
                >
                  <span>
                    Total Expense: <strong>₱{totalCost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong>{' '}
                    (deducted from <strong>{formData.fundSource}</strong>)
                  </span>
                  {isInsufficient ? (
                    <span style={{ color: '#ef4444', fontWeight: 700 }}>
                      Insufficient {formData.fundSource} Balance
                    </span>
                  ) : (
                    <span style={{ color: '#10b981', fontWeight: 600 }}>
                      Balance Sufficient (₱{(selectedFundBalance - totalCost).toLocaleString('en-PH', { minimumFractionDigits: 2 })} remaining)
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="expName">Food / Snack / Consumable Item *</label>
              <input
                type="text"
                id="expName"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                required
                placeholder="e.g. Chooks-to-Go Lunch, Student Snacks"
                className={styles.formInput}
                autoFocus
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="expLabel">Expense Category / Receipt Label *</label>
              <select
                id="expLabel"
                value={formData.receiptLabel}
                onChange={(e) => setFormData((prev) => ({ ...prev, receiptLabel: e.target.value }))}
                className={styles.formSelect}
              >
                {RECEIPT_LABELS.map((lbl) => (
                  <option key={lbl} value={lbl}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="expQty">Quantity *</label>
              <input
                type="number"
                id="expQty"
                min="1"
                value={formData.quantity}
                onChange={(e) => setFormData((prev) => ({ ...prev, quantity: e.target.value }))}
                required
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="expUnitCost">Unit Cost (₱) *</label>
              <input
                type="number"
                id="expUnitCost"
                min="0.01"
                step="0.01"
                value={formData.unitCost}
                onChange={(e) => setFormData((prev) => ({ ...prev, unitCost: e.target.value }))}
                required
                placeholder="e.g. 280.00"
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="expOrNumber">Official Receipt (OR #)</label>
              <input
                type="text"
                id="expOrNumber"
                value={formData.receiptOrNumber}
                onChange={(e) => setFormData((prev) => ({ ...prev, receiptOrNumber: e.target.value }))}
                placeholder="Optional if uploading receipt photo"
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="expDetails">Receipt Details / Breakdown</label>
              <input
                type="text"
                id="expDetails"
                value={formData.receiptDetails}
                onChange={(e) => setFormData((prev) => ({ ...prev, receiptDetails: e.target.value }))}
                placeholder="e.g. 2 whole roasted chicken + rice for event crew"
                className={styles.formInput}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.fileUploadLabel}>
              <span className={styles.fileUploadButton}>
                <Paperclip size={15} />
                {uploadingReceipt
                  ? `Uploading to Google Drive Receipts (${uploadProgress}%)...`
                  : 'Upload Receipt Photo / PDF (Google Drive → Receipts)'}
              </span>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={handleDriveUpload}
                disabled={uploadingReceipt}
                className={styles.fileInput}
              />
            </label>
            {formData.receiptDriveLink && (
              <span className={styles.fileUploadStatus}>
                <CheckCircle2 size={14} /> Saved to Google Drive Receipts:{' '}
                <a
                  href={formData.receiptDriveLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#38bdf8', textDecoration: 'underline', marginLeft: '4px' }}
                >
                  View Receipt
                </a>
              </span>
            )}
          </div>

          {error && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.14)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                color: '#fca5a5',
                fontSize: '0.85rem',
              }}
            >
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onClose}
              disabled={submitting || uploadingReceipt}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={submitting || uploadingReceipt}
            >
              <Check size={16} />
              <span>{submitting ? 'Recording Expense...' : 'Record Expense to Ledger'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ConsumableExpenseDialog;
