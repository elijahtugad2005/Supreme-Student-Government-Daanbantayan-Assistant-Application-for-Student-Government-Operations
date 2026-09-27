
import React, { useState, useContext, useEffect } from 'react';
import { db } from '../../firebase/firebaseConfig';
import { collection, addDoc, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import {useFinance} from '../FinanceContext/FinanceProvider.jsx';
import { useAuth } from '../AuthContext/AuthContext.jsx';
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
  HiCheckCircle
} from 'react-icons/hi';

const BudgetForm = ({ editingBudget = null, onSuccess = () => {} }) => {
  const { userName, userRole } = useAuth();
  const { addBudget, updateBudget } = useFinance();
  
  // Form state
  const [formData, setFormData] = useState({
    eventName: '',
    allocatedAmount: '',
    spentAmount: '',
    category: 'Event',
    committee: 'General',
    resolution: '',
    description: '',
    receiptUrl: '', // Changed from receipt to receiptUrl
    fiscalYear: new Date().getFullYear(),
    startDate: '',
    endDate: '',
  });

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

  // Prefill form if editing
  useEffect(() => {
    if (editingBudget) {
      setFormData({
        eventName: editingBudget.eventName || '',
        allocatedAmount: editingBudget.allocated || 0,
        spentAmount: editingBudget.spent || 0,
        category: editingBudget.category || 'Event',
        committee: editingBudget.committee || 'General',
        resolution: editingBudget.resolution || '',
        description: editingBudget.description || '',
        receiptUrl: editingBudget.receiptUrl || '', // Updated field name
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
    } catch (error) {
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
        // Update existing budget
        result = await updateBudget(editingBudget.id, budgetData);
      } else {
        // Create new budget
        result = await addBudget(budgetData);
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
      }

      // Show success modal instead of alert
      setShowSuccessModal(true);
      
      // Auto-close modal and call success callback after 2 seconds
      setTimeout(() => {
        setShowSuccessModal(false);
        onSuccess(result);
      }, 2000);

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

  // Get status color
  const getStatusColor = () => {
    const status = determineStatus();
    switch(status) {
      case 'Over Budget': return '#e74c3c';
      case 'Fully Spent': return '#27ae60';
      case 'Almost Spent': return '#f39c12';
      case 'In Progress': return '#3498db';
      case 'On Track': return '#2ecc71';
      default: return '#95a5a6';
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>
          <HiCurrencyDollar className={styles.titleIcon} />
          {editingBudget ? 'Edit Budget Allocation' : 'New Budget Allocation'}
        </h2>
        <p className={styles.subtitle}>
          {editingBudget ? 'Update budget details for ' + editingBudget.eventName : 'Allocate budget for events, projects, or committees'}
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

        {/* Quick Stats Preview */}
        <div className={styles.previewCard}>
          <div className={styles.previewItem}>
            <span className={styles.previewLabel}>Allocated</span>
            <span className={styles.previewValue}>
              ₱{(parseFloat(formData.allocatedAmount) || 0).toLocaleString()}
            </span>
          </div>
          <div className={styles.previewItem}>
            <span className={styles.previewLabel}>Spent</span>
            <span className={styles.previewValue}>
              ₱{(parseFloat(formData.spentAmount) || 0).toLocaleString()}
            </span>
          </div>
          <div className={styles.previewItem}>
            <span className={styles.previewLabel}>Remaining</span>
            <span className={`${styles.previewValue} ${calculateRemaining() < 0 ? styles.negativeValue : ''}`}>
              ₱{calculateRemaining().toLocaleString()}
            </span>
          </div>
          <div className={styles.previewItem}>
            <span className={styles.previewLabel}>Status</span>
            <span 
              className={styles.previewStatus}
              style={{ backgroundColor: getStatusColor() }}
            >
              {determineStatus()}
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className={styles.progressSection}>
          <div className={styles.progressHeader}>
            <span>Budget Utilization</span>
            <span>{calculateProgress().toFixed(1)}%</span>
          </div>
          <div className={styles.progressBar}>
            <div 
              className={styles.progressFill}
              style={{ 
                width: `${calculateProgress()}%`,
                backgroundColor: getStatusColor()
              }}
            ></div>
          </div>
        </div>

        {/* Form Grid */}
        <div className={styles.formGrid}>
          {/* Event/Project Name */}
          <div className={styles.formGroup}>
            <label htmlFor="eventName" className={styles.label}>
              <HiClipboardList className={styles.labelIcon} />
              Event/Project Name *
            </label>
            <input
              type="text"
              id="eventName"
              name="eventName"
              value={formData.eventName}
              onChange={handleInputChange}
              className={`${styles.input} ${errors.eventName ? styles.inputError : ''}`}
              placeholder="Enter event or project name"
              required
            />
            {errors.eventName && <span className={styles.error}>{errors.eventName}</span>}
          </div>

          {/* Allocated Amount */}
          <div className={styles.formGroup}>
            <label htmlFor="allocatedAmount" className={styles.label}>
              <HiCash className={styles.labelIcon} />
              Allocated Amount (₱) *
            </label>
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
          </div>

          {/* Spent Amount */}
          <div className={styles.formGroup}>
            <label htmlFor="spentAmount" className={styles.label}>
              <HiCreditCard className={styles.labelIcon} />
              Spent Amount (₱)
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
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
            {errors.spentAmount && <span className={styles.error}>{errors.spentAmount}</span>}
            {errors.overspend && <span className={styles.error}>{errors.overspend}</span>}
          </div>

          {/* Category */}
          <div className={styles.formGroup}>
            <label htmlFor="category" className={styles.label}>
              <HiTag className={styles.labelIcon} />
              Category
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

          {/* Committee */}
          <div className={styles.formGroup}>
            <label htmlFor="committee" className={styles.label}>
              <HiUserGroup className={styles.labelIcon} />
              Committee
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
              Fiscal Year
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

        {/* Date Range */}
        <div className={styles.dateGrid}>
          <div className={styles.formGroup}>
            <label htmlFor="startDate" className={styles.label}>
              Start Date (Optional)
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
              End Date (Optional)
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

        {/* Resolution Number */}
        <div className={styles.formGroup}>
          <label htmlFor="resolution" className={styles.label}>
            <HiDocumentText className={styles.labelIcon} />
            Resolution Number/Name
          </label>
          <input
            type="text"
            id="resolution"
            name="resolution"
            value={formData.resolution}
            onChange={handleInputChange}
            className={styles.input}
            placeholder="e.g., Resolution No. 2024-001"
          />
        </div>

        {/* Description */}
        <div className={styles.formGroup}>
          <label htmlFor="description" className={styles.label}>
            <HiDocumentText className={styles.labelIcon} />
            Description
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleInputChange}
            className={styles.textarea}
            placeholder="Brief description of the event/project..."
            rows="3"
          />
        </div>

        {/* Receipt URL */}
        <div className={styles.formGroup}>
          <label htmlFor="receiptUrl" className={styles.label}>
            <HiLink className={styles.labelIcon} />
            Receipt/Document URL
          </label>
          <input
            type="url"
            id="receiptUrl"
            name="receiptUrl"
            value={formData.receiptUrl}
            onChange={handleInputChange}
            className={`${styles.input} ${errors.receiptUrl ? styles.inputError : ''}`}
            placeholder="https://drive.google.com/file/d/... or any receipt URL"
          />
          <small className={styles.helperText}>
            Optional: Paste a link to the receipt (Google Drive, Dropbox, etc.)
          </small>
          {errors.receiptUrl && <span className={styles.error}>{errors.receiptUrl}</span>}
        </div>

        {/* Form Actions */}
        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              if (window.confirm('Are you sure you want to cancel? Unsaved changes will be lost.')) {
                onSuccess(null);
              }
            }}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className={styles.spinner}></span>
                {editingBudget ? 'Updating...' : 'Saving...'}
              </>
            ) : (
              <>
                <HiSave className={styles.buttonIcon} />
                {editingBudget ? 'Update Budget' : 'Save Budget Allocation'}
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
            <h3>{editingBudget ? 'Budget Updated!' : 'Budget Created!'}</h3>
            <p>Your changes have been saved successfully.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetForm;