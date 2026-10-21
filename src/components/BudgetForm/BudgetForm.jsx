import React, { useState, useEffect, useMemo } from 'react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import financeAuditService from '../../services/financeAuditService.js';
import styles from './BudgetForm.module.css';
import { 
  HiCurrencyDollar,
  HiClipboardList,
  HiCash,
  HiCreditCard,
  HiTag,
  HiUserGroup,
  HiCalendar,
  HiDocumentText,
  HiLink,
  HiSave,
  HiX,
  HiExclamationCircle,
  HiCheckCircle,
  HiSparkles,
  HiPlus,
  HiTrash,
  HiInformationCircle,
  HiRefresh
} from 'react-icons/hi';

const QUICK_PRESETS = [
  { label: '₱5,000', value: 5000 },
  { label: '₱10,000', value: 10000 },
  { label: '₱25,000', value: 25000 },
  { label: '₱50,000', value: 50000 },
  { label: '₱100,000', value: 100000 },
];

const RESOLUTION_TEMPLATES = [
  'General Student Assembly Assembly Res.',
  'Executive Council Resolution No.',
  'Special Project Appropriations Res.',
  'Emergency Contingency Release Res.'
];

const BudgetForm = ({ editingBudget = null, onSuccess = () => {} }) => {
  const { userName, userRole, currentUser } = useAuth();
  const { addBudget, updateBudget, funds, statistics } = useFinance();
  
  // Form state
  const [formData, setFormData] = useState({
    eventName: '',
    allocatedAmount: '',
    spentAmount: '',
    category: 'Event',
    committee: 'General',
    resolution: '',
    description: '',
    receiptUrl: '',
    fiscalYear: new Date().getFullYear(),
    startDate: '',
    endDate: '',
  });

  // Itemized line-items sub-calculator for planning allocations
  const [showItemizer, setShowItemizer] = useState(false);
  const [breakdownItems, setBreakdownItems] = useState([
    { description: 'Venue / Materials', cost: '' },
    { description: 'Refreshments / Logistics', cost: '' }
  ]);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const [categories] = useState([
    'Event', 
    'Project', 
    'Committee', 
    'Supplies', 
    'Printing', 
    'Prizes & Awards',
    'Transportation',
    'Food & Beverages',
    'Equipment',
    'Miscellaneous'
  ]);
  
  const [committees] = useState([
    'General',
    'Executive Board',
    'Finance Committee',
    'Events Committee',
    'Academic Committee',
    'Sports Committee',
    'Cultural Committee',
    'Public Relations',
    'Secretariat'
  ]);

  // Overall treasury context: total unallocated / free treasury funds
  const totalTreasuryFunds = funds?.totalFunds || funds?.annualBudget || 0;
  const currentTotalAllocated = statistics?.totalAllocated || 0;
  const unallocatedTreasury = Math.max(0, totalTreasuryFunds - currentTotalAllocated);

  // Prefill form if editing
  useEffect(() => {
    if (editingBudget) {
      setFormData({
        eventName: editingBudget.eventName || '',
        allocatedAmount: editingBudget.allocated || '',
        spentAmount: editingBudget.spent || 0,
        category: editingBudget.category || 'Event',
        committee: editingBudget.committee || 'General',
        resolution: editingBudget.resolution || '',
        description: editingBudget.description || '',
        receiptUrl: editingBudget.receiptUrl || '',
        fiscalYear: editingBudget.fiscalYear || new Date().getFullYear(),
        startDate: editingBudget.startDate || '',
        endDate: editingBudget.endDate || '',
      });
    }
  }, [editingBudget]);

  // Calculate remaining amount
  const calculateRemaining = () => {
    const allocated = parseFloat(formData.allocatedAmount) || 0;
    const spent = parseFloat(formData.spentAmount) || 0;
    return allocated - spent;
  };

  // Determine status based on spending
  const determineStatus = () => {
    const allocated = parseFloat(formData.allocatedAmount) || 0;
    const spent = parseFloat(formData.spentAmount) || 0;
    const remaining = allocated - spent;

    if (spent === 0) return 'Not Started';
    if (remaining < 0) return 'Over Budget';
    if (remaining === 0) return 'Fully Spent';
    if (spent > (allocated * 0.9)) return 'Almost Spent';
    if (spent > (allocated * 0.5)) return 'In Progress';
    return 'On Track';
  };

  // Sum of sub-calculator items
  const breakdownSum = useMemo(() => {
    return breakdownItems.reduce((acc, curr) => {
      const val = parseFloat(curr.cost) || 0;
      return acc + val;
    }, 0);
  }, [breakdownItems]);

  // Apply breakdown sum to allocated amount
  const applyBreakdownSum = () => {
    if (breakdownSum > 0) {
      setFormData(prev => ({
        ...prev,
        allocatedAmount: breakdownSum.toFixed(2)
      }));
      if (errors.allocatedAmount) {
        setErrors(prev => ({ ...prev, allocatedAmount: '' }));
      }
    }
  };

  const handleAddBreakdownItem = () => {
    setBreakdownItems(prev => [...prev, { description: '', cost: '' }]);
  };

  const handleRemoveBreakdownItem = (index) => {
    setBreakdownItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleBreakdownChange = (index, field, val) => {
    setBreakdownItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  // Quick preset button click
  const handlePresetClick = (amount) => {
    setFormData(prev => ({ ...prev, allocatedAmount: amount }));
    if (errors.allocatedAmount) {
      setErrors(prev => ({ ...prev, allocatedAmount: '' }));
    }
  };

  // Auto-fill template resolution
  const handleResolutionTemplate = (prefix) => {
    const year = formData.fiscalYear || new Date().getFullYear();
    setFormData(prev => ({
      ...prev,
      resolution: `${prefix} ${year}-${String(Math.floor(Math.random() * 900) + 100)}`
    }));
  };

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.eventName.trim()) {
      newErrors.eventName = 'Event/Project name is required';
    }
    
    if (!formData.allocatedAmount || parseFloat(formData.allocatedAmount) <= 0) {
      newErrors.allocatedAmount = 'Allocated amount must be greater than 0';
    }
    
    if (formData.spentAmount && parseFloat(formData.spentAmount) < 0) {
      newErrors.spentAmount = 'Spent amount cannot be negative';
    }
    
    if (formData.startDate && formData.endDate && new Date(formData.startDate) > new Date(formData.endDate)) {
      newErrors.dates = 'End date cannot be before start date';
    }

    if (formData.spentAmount && parseFloat(formData.spentAmount) > parseFloat(formData.allocatedAmount)) {
      newErrors.overspend = 'Spent amount cannot exceed allocated amount';
    }

    // Validate receipt URL format if provided
    if (formData.receiptUrl && !isValidUrl(formData.receiptUrl)) {
      newErrors.receiptUrl = 'Please enter a valid URL';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Helper function to validate URL
  const isValidUrl = (url) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  // Handle input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear error for this field
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const allocated = parseFloat(formData.allocatedAmount);
      const spent = parseFloat(formData.spentAmount) || 0;
      const remaining = allocated - spent;
      const status = determineStatus();

      const budgetData = {
        eventName: formData.eventName.trim(),
        allocated,
        spent,
        remaining,
        category: formData.category,
        committee: formData.committee,
        resolution: formData.resolution.trim(),
        description: formData.description.trim(),
        receiptUrl: formData.receiptUrl.trim(),
        status,
        fiscalYear: formData.fiscalYear,
        startDate: formData.startDate || null,
        endDate: formData.endDate || null,
        createdBy: userName,
        userRole: userRole,
        isActive: true,
      };

      let result;
      if (editingBudget) {
        // Log budget update audit
        await financeAuditService.logBudgetUpdate(currentUser?.uid || 'guest', editingBudget.id, {
          id: editingBudget.id,
          title: editingBudget.eventName,
          amount: editingBudget.allocated,
          category: editingBudget.category,
          committee: editingBudget.committee,
          resolution: editingBudget.resolution
        }, {
          id: editingBudget.id,
          title: budgetData.eventName,
          amount: budgetData.allocated,
          category: budgetData.category,
          committee: budgetData.committee,
          resolution: budgetData.resolution
        });

        // Update existing budget
        result = await updateBudget(editingBudget.id, budgetData);
      } else {
        // Create new budget
        result = await addBudget(budgetData);

        // Log budget creation audit
        await financeAuditService.logBudgetCreation(currentUser?.uid || 'guest', {
          id: result,
          title: budgetData.eventName,
          amount: budgetData.allocated,
          category: budgetData.category,
          committee: budgetData.committee,
          description: budgetData.description
        });
      }

      // Reset form if not editing
      if (!editingBudget) {
        setFormData({
          eventName: '',
          allocatedAmount: '',
          spentAmount: '',
          category: 'Event',
          committee: 'General',
          resolution: '',
          description: '',
          receiptUrl: '',
          fiscalYear: new Date().getFullYear(),
          startDate: '',
          endDate: '',
        });
        setBreakdownItems([
          { description: 'Venue / Materials', cost: '' },
          { description: 'Refreshments / Logistics', cost: '' }
        ]);
      }

      // Show success modal
      setShowSuccessModal(true);
      
      setTimeout(() => {
        setShowSuccessModal(false);
        onSuccess(result);
      }, 1800);

    } catch (error) {
      console.error('Error saving budget:', error);
      setErrors(prev => ({ 
        ...prev, 
        submit: error.message || 'Failed to save budget. Please try again.' 
      }));
    } finally {
      setLoading(false);
    }
  };

  // Calculate progress percentage
  const calculateProgress = () => {
    const allocated = parseFloat(formData.allocatedAmount) || 0;
    const spent = parseFloat(formData.spentAmount) || 0;
    if (allocated === 0) return 0;
    return Math.min((spent / allocated) * 100, 100);
  };

  // Status color pill
  const getStatusColor = () => {
    const status = determineStatus();
    switch(status) {
      case 'Over Budget': return '#e61919';
      case 'Fully Spent': return '#16a34a';
      case 'Almost Spent': return '#f59e0b';
      case 'In Progress': return '#2563eb';
      case 'On Track': return '#059669';
      default: return '#64748b';
    }
  };

  const requestedAmount = parseFloat(formData.allocatedAmount) || 0;
  const isExceedingTreasury = totalTreasuryFunds > 0 && requestedAmount > unallocatedTreasury && !editingBudget;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerBadge}>FINANCIAL ALLOCATION CONTROL</div>
        <h2 className={styles.title}>
          <HiCurrencyDollar className={styles.titleIcon} />
          {editingBudget ? 'Edit Budget Allocation' : 'New Budget Allocation'}
        </h2>
        <p className={styles.subtitle}>
          {editingBudget ? 'Update budget allocation details for ' + editingBudget.eventName : 'Allocate institutional appropriations for events, projects, or student operations'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        {/* Error Alert */}
        {errors.submit && (
          <div className={styles.errorAlert}>
            <HiExclamationCircle className={styles.errorIcon} />
            {errors.submit}
          </div>
        )}

        {/* Treasury Health & Context Bar (Quality of Life) */}
        {totalTreasuryFunds > 0 && (
          <div className={styles.treasuryContextBanner}>
            <div className={styles.treasuryInfo}>
              <HiInformationCircle className={styles.treasuryIcon} />
              <div>
                <span className={styles.treasuryLabel}>Unallocated Campus Treasury:</span>
                <span className={styles.treasuryValue}>₱{unallocatedTreasury.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
            {isExceedingTreasury && (
              <span className={styles.treasuryWarning}>
                ⚠️ Exceeds unallocated balance by ₱{(requestedAmount - unallocatedTreasury).toLocaleString()}
              </span>
            )}
          </div>
        )}

        {/* Real-time Dynamic Metrics Card */}
        <div className={styles.previewCard}>
          <div className={styles.previewItem}>
            <span className={styles.previewLabel}>Allocated Capital</span>
            <span className={styles.previewValue}>
              ₱{(parseFloat(formData.allocatedAmount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className={styles.previewItem}>
            <span className={styles.previewLabel}>Recorded Spent</span>
            <span className={styles.previewValue}>
              ₱{(parseFloat(formData.spentAmount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className={styles.previewItem}>
            <span className={styles.previewLabel}>Remaining Balance</span>
            <span className={`${styles.previewValue} ${calculateRemaining() < 0 ? styles.negativeValue : ''}`}>
              ₱{calculateRemaining().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className={styles.previewItem}>
            <span className={styles.previewLabel}>Trajectory Status</span>
            <span 
              className={styles.previewStatus}
              style={{ backgroundColor: getStatusColor() }}
            >
              {determineStatus()}
            </span>
          </div>
        </div>

        {/* Real-Time Utilization Progress Bar */}
        <div className={styles.progressSection}>
          <div className={styles.progressHeader}>
            <span className={styles.progressTitle}>Budget Utilization Meter</span>
            <span className={styles.progressPct}>{calculateProgress().toFixed(1)}%</span>
          </div>
          <div className={styles.progressBar}>
            <div 
              className={styles.progressFill}
              style={{ 
                width: `${calculateProgress()}%`,
                backgroundColor: getStatusColor()
              }}
            />
          </div>
        </div>

        {/* Form Inputs Grid */}
        <div className={styles.formGrid}>
          {/* Event/Project Name */}
          <div className={styles.formGroup}>
            <label htmlFor="eventName" className={styles.label}>
              <HiClipboardList className={styles.labelIcon} />
              Event / Project Title *
            </label>
            <input
              type="text"
              id="eventName"
              name="eventName"
              value={formData.eventName}
              onChange={handleInputChange}
              className={`${styles.input} ${errors.eventName ? styles.inputError : ''}`}
              placeholder="e.g., Intramurals 2026, Leadership Summit"
              required
            />
            {errors.eventName && <span className={styles.error}>{errors.eventName}</span>}
          </div>

          {/* Category */}
          <div className={styles.formGroup}>
            <label htmlFor="category" className={styles.label}>
              <HiTag className={styles.labelIcon} />
              Appropriation Category
            </label>
            <select
              id="category"
              name="category"
              value={formData.category}
              onChange={handleInputChange}
              className={styles.select}
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* Allocated Amount with Quick Preset Badges */}
          <div className={styles.formGroup}>
            <div className={styles.labelRow}>
              <label htmlFor="allocatedAmount" className={styles.label}>
                <HiCash className={styles.labelIcon} />
                Allocated Amount (₱) *
              </label>
              <button
                type="button"
                className={styles.toolToggleBtn}
                onClick={() => setShowItemizer(!showItemizer)}
                title="Toggle itemized budget calculator"
              >
                <HiSparkles /> {showItemizer ? 'Hide Itemizer' : 'Itemize Costs'}
              </button>
            </div>

            <div className={styles.currencyInput}>
              <span className={styles.currencySymbol}>₱</span>
              <input
                type="number"
                id="allocatedAmount"
                name="allocatedAmount"
                value={formData.allocatedAmount}
                onChange={handleInputChange}
                className={`${styles.input} ${errors.allocatedAmount ? styles.inputError : ''}`}
                placeholder="0.00"
                min="0"
                step="0.01"
                required
              />
            </div>
            {errors.allocatedAmount && <span className={styles.error}>{errors.allocatedAmount}</span>}

            {/* Quick Preset Buttons (QoL Feature) */}
            <div className={styles.presetsRow}>
              <span className={styles.presetsLabel}>Quick Presets:</span>
              <div className={styles.presetButtons}>
                {QUICK_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`${styles.presetBtn} ${parseFloat(formData.allocatedAmount) === p.value ? styles.presetBtnActive : ''}`}
                    onClick={() => handlePresetClick(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Spent Amount */}
          <div className={styles.formGroup}>
            <label htmlFor="spentAmount" className={styles.label}>
              <HiCreditCard className={styles.labelIcon} />
              Initial Spent / Disbursed Amount (₱)
            </label>
            <div className={styles.currencyInput}>
              <span className={styles.currencySymbol}>₱</span>
              <input
                type="number"
                id="spentAmount"
                name="spentAmount"
                value={formData.spentAmount}
                onChange={handleInputChange}
                className={`${styles.input} ${errors.spentAmount ? styles.inputError : ''}`}
                placeholder="0.00 (leave 0 if fresh allocation)"
                min="0"
                step="0.01"
              />
            </div>
            {errors.spentAmount && <span className={styles.error}>{errors.spentAmount}</span>}
            {errors.overspend && <span className={styles.error}>{errors.overspend}</span>}
          </div>

          {/* Committee */}
          <div className={styles.formGroup}>
            <label htmlFor="committee" className={styles.label}>
              <HiUserGroup className={styles.labelIcon} />
              Sponsoring Committee / Division
            </label>
            <select
              id="committee"
              name="committee"
              value={formData.committee}
              onChange={handleInputChange}
              className={styles.select}
            >
              {committees.map(com => (
                <option key={com} value={com}>{com}</option>
              ))}
            </select>
          </div>

          {/* Fiscal Year */}
          <div className={styles.formGroup}>
            <label htmlFor="fiscalYear" className={styles.label}>
              <HiCalendar className={styles.labelIcon} />
              Fiscal Fiscal Year
            </label>
            <select
              id="fiscalYear"
              name="fiscalYear"
              value={formData.fiscalYear}
              onChange={handleInputChange}
              className={styles.select}
            >
              {[2023, 2024, 2025, 2026, 2027].map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Itemized Line-Items Calculator Drawer (Quality of Life) */}
        {showItemizer && (
          <div className={styles.itemizerDrawer}>
            <div className={styles.itemizerHeader}>
              <div>
                <h4 className={styles.itemizerTitle}>Cost Breakdown Planner</h4>
                <p className={styles.itemizerSubtitle}>Itemize estimated expenses to automatically compute total allocation.</p>
              </div>
              <div className={styles.itemizerSumBlock}>
                <span className={styles.itemizerSumLabel}>Total Computed:</span>
                <span className={styles.itemizerSumValue}>₱{breakdownSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                <button
                  type="button"
                  className={styles.applyBreakdownBtn}
                  onClick={applyBreakdownSum}
                  disabled={breakdownSum === 0}
                >
                  <HiCheckCircle /> Apply To Allocation
                </button>
              </div>
            </div>

            <div className={styles.itemizerList}>
              {breakdownItems.map((item, idx) => (
                <div key={idx} className={styles.itemizerRow}>
                  <input
                    type="text"
                    placeholder="Expense item (e.g. sound system, food packs)"
                    value={item.description}
                    onChange={(e) => handleBreakdownChange(idx, 'description', e.target.value)}
                    className={styles.itemizerInputDesc}
                  />
                  <div className={styles.itemizerCurrencyWrap}>
                    <span>₱</span>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={item.cost}
                      onChange={(e) => handleBreakdownChange(idx, 'cost', e.target.value)}
                      className={styles.itemizerInputCost}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveBreakdownItem(idx)}
                    className={styles.itemizerRemoveBtn}
                    title="Remove item"
                    disabled={breakdownItems.length === 1}
                  >
                    <HiTrash />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddBreakdownItem}
              className={styles.itemizerAddBtn}
            >
              <HiPlus /> Add Expense Line
            </button>
          </div>
        )}

        {/* Date Range Fields */}
        <div className={styles.dateGrid}>
          <div className={styles.formGroup}>
            <label htmlFor="startDate" className={styles.label}>
              Execution Start Date (Optional)
            </label>
            <input
              type="date"
              id="startDate"
              name="startDate"
              value={formData.startDate}
              onChange={handleInputChange}
              className={styles.input}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="endDate" className={styles.label}>
              Target Completion Date (Optional)
            </label>
            <input
              type="date"
              id="endDate"
              name="endDate"
              value={formData.endDate}
              onChange={handleInputChange}
              className={styles.input}
            />
          </div>
        </div>
        {errors.dates && <span className={styles.error}>{errors.dates}</span>}

        {/* Resolution Number with Quick Template Generator */}
        <div className={styles.formGroup}>
          <div className={styles.labelRow}>
            <label htmlFor="resolution" className={styles.label}>
              <HiDocumentText className={styles.labelIcon} />
              Resolution Number / Legislative Reference
            </label>
          </div>
          <input
            type="text"
            id="resolution"
            name="resolution"
            value={formData.resolution}
            onChange={handleInputChange}
            className={styles.input}
            placeholder="e.g., SSG Res. No. 2026-042"
          />
          {/* Quick Resolution Templates (QoL) */}
          <div className={styles.templatePills}>
            <span className={styles.templatePillsLabel}>Insert Template:</span>
            {RESOLUTION_TEMPLATES.map((tmpl, idx) => (
              <button
                key={idx}
                type="button"
                className={styles.templatePillBtn}
                onClick={() => handleResolutionTemplate(tmpl)}
              >
                + {tmpl.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Description / Scope */}
        <div className={styles.formGroup}>
          <label htmlFor="description" className={styles.label}>
            <HiDocumentText className={styles.labelIcon} />
            Budget Justification & Objective
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleInputChange}
            className={styles.textarea}
            placeholder="Outline the operational objectives, beneficiaries, and budget justification..."
            rows="3"
          />
        </div>

        {/* Receipt / Documentation Link */}
        <div className={styles.formGroup}>
          <label htmlFor="receiptUrl" className={styles.label}>
            <HiLink className={styles.labelIcon} />
            Verification Document / Cloud Drive Link
          </label>
          <input
            type="url"
            id="receiptUrl"
            name="receiptUrl"
            value={formData.receiptUrl}
            onChange={handleInputChange}
            className={`${styles.input} ${errors.receiptUrl ? styles.inputError : ''}`}
            placeholder="https://drive.google.com/file/d/... or document reference URL"
          />
          <small className={styles.helperText}>
            Attach cloud folder, scanned canvass sheets, approved resolution PDF, or receipts for transparency.
          </small>
          {errors.receiptUrl && <span className={styles.error}>{errors.receiptUrl}</span>}
        </div>

        {/* Action Controls */}
        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              if (window.confirm('Are you sure you want to discard unsaved budget allocation changes?')) {
                onSuccess(null);
              }
            }}
            disabled={loading}
          >
            Cancel / Back
          </button>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className={styles.spinner}></span>
                {editingBudget ? 'Updating Allocation...' : 'Recording Allocation...'}
              </>
            ) : (
              <>
                <HiSave className={styles.buttonIcon} />
                {editingBudget ? 'Save Allocation Changes' : 'Confirm & Commit Allocation'}
              </>
            )}
          </button>
        </div>
      </form>

      {/* Success Modal */}
      {showSuccessModal && (
        <div className={styles.successModalOverlay}>
          <div className={styles.successModal}>
            <HiCheckCircle className={styles.successIcon} />
            <h3>{editingBudget ? 'Allocation Updated!' : 'Allocation Committed!'}</h3>
            <p>The institutional ledger and audit records have been registered successfully.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetForm;