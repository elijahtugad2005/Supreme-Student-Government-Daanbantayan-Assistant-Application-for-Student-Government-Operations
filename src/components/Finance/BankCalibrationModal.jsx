import React, { useState } from 'react';
import { HiX } from 'react-icons/hi';
import styles from './FundGovernance.module.css';

/**
 * BankCalibrationModal
 * Reusable modal for institutional depository calibrations:
 * - Fiscal Budget Calibration (Annual Appropriation ceiling & bank account reference)
 * - Holding Fund Balance Calibration (FSG, IGF, IGP holding account balance & reconciliation notes)
 */
export const BankCalibrationModal = ({
  isOpen,
  mode = 'fiscal', // 'fiscal' | 'fund'
  fund = null,
  initialValues = {},
  isSaving = false,
  error = null,
  onClose,
  onSubmit,
}) => {
  const [fiscalForm, setFiscalForm] = useState(() => ({
    budgetAmount: initialValues.budgetAmount || '',
    bankAccountReference: initialValues.bankAccountReference || 'BDO Institutional Account ****2005',
    resolutionRef: initialValues.resolutionRef || '',
    note: initialValues.note || '',
  }));

  const [fundBalanceInput, setFundBalanceInput] = useState(
    initialValues.fundBalance || ''
  );
  const [fundBalanceReason, setFundBalanceReason] = useState(
    initialValues.fundBalanceReason || ''
  );

  if (!isOpen) return null;

  const handleFiscalSubmit = (e) => {
    e.preventDefault();
    onSubmit(fiscalForm);
  };

  const handleFundSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      balance: fundBalanceInput,
      reason: fundBalanceReason,
    });
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={styles.modalContent}
        style={{ maxWidth: mode === 'fiscal' ? '540px' : '480px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#1e293b' }}>
            {mode === 'fiscal'
              ? '🏛️ Edit 2026–2027 Fiscal Budget'
              : `💰 Edit Fund Balance (${fund?.displayName || 'Fund'})`}
          </h3>
          <button
            type="button"
            className={styles.modalCloseBtn}
            style={{ position: 'static' }}
            onClick={onClose}
            aria-label="Close modal"
          >
            <HiX size={20} />
          </button>
        </div>

        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.2rem', marginBottom: '1.25rem' }}>
          {mode === 'fiscal'
            ? 'Calibrate and update the primary Fiscal Budget. This establishes the institutional operating balance and the ceiling for the PPMP procurement schedule.'
            : 'Calibrate and update the current balance available for this fund source.'}
        </p>

        {error && (
          <div style={{ padding: '0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {mode === 'fiscal' ? (
          <form onSubmit={handleFiscalSubmit}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>2026–2027 Fiscal Budget Amount (₱) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={styles.formInput}
                placeholder="e.g. 500000.00"
                value={fiscalForm.budgetAmount}
                onChange={(e) => setFiscalForm({ ...fiscalForm, budgetAmount: e.target.value })}
                required
              />
              <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem', display: 'block' }}>
                The total approved fiscal budget allocation for this term.
              </span>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Institutional Depository Bank Reference *</label>
              <input
                type="text"
                className={styles.formInput}
                placeholder="e.g. BDO Institutional Account ****2005"
                value={fiscalForm.bankAccountReference}
                onChange={(e) => setFiscalForm({ ...fiscalForm, bankAccountReference: e.target.value })}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Board / Administration Resolution Reference</label>
              <input
                type="text"
                className={styles.formInput}
                placeholder="e.g. BOR-RES-2026-081 / Office of Student Affairs Memo"
                value={fiscalForm.resolutionRef}
                onChange={(e) => setFiscalForm({ ...fiscalForm, resolutionRef: e.target.value })}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Reconciliation / Audit Note</label>
              <input
                type="text"
                className={styles.formInput}
                placeholder="e.g. Annual university appropriation calibration"
                value={fiscalForm.note}
                onChange={(e) => setFiscalForm({ ...fiscalForm, note: e.target.value })}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={onClose}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.primaryBtn}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Fiscal Budget'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleFundSubmit}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Fund Balance (₱) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={styles.formInput}
                placeholder="0.00"
                value={fundBalanceInput}
                onChange={(e) => setFundBalanceInput(e.target.value)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Reconciliation Note / Deposit Reference</label>
              <input
                type="text"
                className={styles.formInput}
                placeholder="e.g. Remittance deposit / Cash count reconciliation"
                value={fundBalanceReason}
                onChange={(e) => setFundBalanceReason(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={onClose}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.primaryBtn}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Update Fund Balance'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default BankCalibrationModal;

