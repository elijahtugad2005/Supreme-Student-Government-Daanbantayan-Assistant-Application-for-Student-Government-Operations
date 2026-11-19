import React, { useState, useEffect, useMemo } from 'react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import financeAuditService from '../../services/financeAuditService.js';
import styles from './BudgetForm.module.css';
import {
  CostBreakdownPlanner,
  CommitteePicker,
  ResolutionPicker,
  MiniRangeCalendar,
} from './BudgetFormParts.jsx';
import { parseCommittees, joinCommittees, lineTotal } from './budgetFormHelpers.js';
import { 
  HiCurrencyDollar,
  HiClipboardList,
  HiCash,
  HiTag,
  HiUserGroup,
  HiCalendar,
  HiDocumentText,
  HiLink,
  HiSave,
  HiExclamationCircle,
  HiInformationCircle,
  HiOfficeBuilding
} from 'react-icons/hi';
import { fromCentavos, toCentavos, getPPMPStatus } from '../../utils/financeConstants.js';

const QUICK_PRESETS = [
  { label: '₱5,000', value: 5000 },
  { label: '₱10,000', value: 10000 },
  { label: '₱25,000', value: 25000 },
  { label: '₱50,000', value: 50000 },
  { label: '₱100,000', value: 100000 },
];

const BudgetForm = ({ editingBudget = null, defaultFundAccountId = 'fund_fiscal_year_budget', onSuccess = () => {} }) => {
  const { userName, userRole, currentUser } = useAuth();
  const { theme } = useTheme();
  const isClassic = theme === 'dark';
  const { addBudget, updateBudget, funds, statistics, fundAccounts = [] } = useFinance();
  
  // Form state
  const [formData, setFormData] = useState({
    fundAccountId: editingBudget?.fundAccountId || defaultFundAccountId || 'fund_fiscal_year_budget',
    eventName: '',
    allocatedAmount: '',
    spentAmount: '',
    category: 'Event',
    resolution: '',
    resolutionDocumentId: null,
    description: '',
    receiptUrl: '',
    fiscalYear: new Date().getFullYear(),
    startDate: '',
    endDate: '',
    status: editingBudget?.status || 'approved',
  });

  // Committees responsible (Senators, Representatives, Governors, Secretaries, Multimedia & Creatives)
  const [selectedCommittees, setSelectedCommittees] = useState([]);

  // Cost Breakdown Planner rows: quantity x cost per unit = line total
  const newLine = () => ({ description: '', quantity: 1, unitCost: '', spent: '' });
  const [breakdownItems, setBreakdownItems] = useState([newLine()]);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

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
  
  // Overall treasury context: fund accounts calculations
  const fiscalAccount = fundAccounts.find((a) => a.id === 'fund_fiscal_year_budget');
  const fsgAccount = fundAccounts.find((a) => a.id === 'fund_fsg_remittance');

  const fiscalCeiling = fromCentavos(fiscalAccount?.appropriatedCeilingCentavos || 0);
  const fiscalBalance = Math.max(fromCentavos(fiscalAccount?.balanceCentavos || 0), funds?.annualBudget || 0);
  const fsgBalance = Math.max(fromCentavos(fsgAccount?.balanceCentavos || 0), funds?.fsgRemittance || 0);

  const fiscalAllocated = statistics?.fiscalAllocated || 0;
  const fsgAllocated = statistics?.fsgAllocated || 0;

  // Base for fiscal allocations: University Fiscal Allowance ceiling if set, else liquid balance
  const fiscalBudgetBase = fiscalCeiling > 0 ? fiscalCeiling : fiscalBalance;
  const fiscalAvailable = Math.max(0, fiscalBudgetBase - fiscalAllocated);
  const fsgAvailable = Math.max(0, fsgBalance - fsgAllocated);

  const isFSGSelected = formData.fundAccountId === 'fund_fsg_remittance';
  const selectedFundAvailable = isFSGSelected ? fsgAvailable : fiscalAvailable;
  const selectedFundBalance = isFSGSelected ? fsgBalance : fiscalBudgetBase;
  const selectedFundName = isFSGSelected ? 'FSG Remittance & Supplemental Fund' : 'SSG Fiscal Year Budget';

  // Prefill form if editing
  useEffect(() => {
    if (editingBudget) {
      const initialSpent = editingBudget.spent !== undefined && editingBudget.spent !== null ? editingBudget.spent : 0;
      setFormData({
        fundAccountId: editingBudget.fundAccountId || editingBudget.raw?.fundAccountId || 'fund_fiscal_year_budget',
        eventName: editingBudget.eventName || '',
        allocatedAmount: editingBudget.allocated || '',
        spentAmount: initialSpent,
        category: editingBudget.category || 'Event',
        resolution: editingBudget.resolution || '',
        resolutionDocumentId: editingBudget.resolutionDocumentId || null,
        description: editingBudget.description || '',
        receiptUrl: editingBudget.receiptUrl || '',
        fiscalYear: editingBudget.fiscalYear || new Date().getFullYear(),
        startDate: editingBudget.startDate || '',
        endDate: editingBudget.endDate || '',
        status: editingBudget.status || 'approved',
      });

      setSelectedCommittees(parseCommittees(editingBudget.committee));

      if (editingBudget.approvedLineItems && editingBudget.approvedLineItems.length > 0) {
        const mappedItems = editingBudget.approvedLineItems.map((li) => {
          const qty = Number(li.quantity) > 0 ? Number(li.quantity) : 1;
          const planned = li.plannedAmount !== undefined ? Number(li.plannedAmount) : fromCentavos(li.plannedCentavos || 0);
          const unit = li.unitCost !== undefined && Number(li.unitCost) > 0 && Number(li.unitCost) * qty === planned
            ? Number(li.unitCost)
            : planned / qty;
          return {
            id: li.id,
            description: li.name || li.description || '',
            quantity: qty,
            unitCost: unit ? Number(unit.toFixed(2)) : '',
            spent: li.spentAmount !== undefined ? li.spentAmount : fromCentavos(li.spentCentavos || 0),
            spentCentavos: li.spentCentavos || 0,
            status: li.status || 'fresh',
            notes: li.notes || '',
          };
        });
        setBreakdownItems(mappedItems);

        // When loading, synchronize itemized line item expenses to initial spent so it displays properly
        const lineItemsSpentSum = mappedItems.reduce((acc, curr) => acc + (parseFloat(curr.spent) || 0), 0);
        if (lineItemsSpentSum > 0) {
          setFormData(prev => ({
            ...prev,
            spentAmount: lineItemsSpentSum % 1 === 0 ? lineItemsSpentSum.toString() : lineItemsSpentSum.toFixed(2)
          }));
        }
      }
    } else if (defaultFundAccountId) {
      setFormData(prev => ({
        ...prev,
        fundAccountId: defaultFundAccountId,
      }));
    }
  }, [editingBudget, defaultFundAccountId]);

  // Calculate remaining amount
  const calculateRemaining = () => {
    const allocated = parseFloat(formData.allocatedAmount) || 0;
    const spent = parseFloat(formData.spentAmount) || expensesSum || 0;
    return allocated - spent;
  };

  // Determine status based on spending
  const determineStatus = () => {
    const allocated = parseFloat(formData.allocatedAmount) || 0;
    const spent = parseFloat(formData.spentAmount) || expensesSum || 0;
    const remaining = allocated - spent;

    if (spent === 0) return 'Not Started';
    if (remaining < 0) return 'Over Budget (Inflation)';
    if (remaining === 0) return 'Fully Spent';
    if (spent > (allocated * 0.9)) return 'Almost Spent';
    if (spent > (allocated * 0.5)) return 'In Progress';
    return 'On Track';
  };

  // Sum of sub-calculator items (Planned Budget)
  const breakdownSum = useMemo(() => {
    return breakdownItems.reduce((acc, curr) => {
      return acc + lineTotal(curr);
    }, 0);
  }, [breakdownItems]);

  // Sum of sub-calculator items (Expenses / Initial Spent)
  const expensesSum = useMemo(() => {
    return breakdownItems.reduce((acc, curr) => {
      const val = parseFloat(curr.spent) || 0;
      return acc + val;
    }, 0);
  }, [breakdownItems]);

  const allocatedCapital = parseFloat(formData.allocatedAmount) || 0;

  const handleAddBreakdownItem = () => {
    setBreakdownItems(prev => [...prev, newLine()]);
  };

  // Keep the recorded spent amount in step with the planner's actual-spent column
  const syncSpentFromItems = (items, fallback) => {
    const hasAnySpent = items.some(it => it.spent !== '' && it.spent !== undefined && it.spent !== null);
    if (!hasAnySpent) return;
    const sum = items.reduce((acc, curr) => acc + (parseFloat(curr.spent) || 0), 0);
    setFormData(fPrev => ({
      ...fPrev,
      spentAmount: sum > 0 ? (sum % 1 === 0 ? sum.toString() : sum.toFixed(2)) : (fallback === '' ? '' : '0')
    }));
  };

  const handleRemoveBreakdownItem = (index) => {
    const copy = breakdownItems.filter((_, i) => i !== index);
    setBreakdownItems(copy);
    syncSpentFromItems(copy);
  };

  const handleBreakdownChange = (index, field, val) => {
    const copy = [...breakdownItems];
    copy[index] = { ...copy[index], [field]: val };
    setBreakdownItems(copy);
    if (field === 'spent') syncSpentFromItems(copy, val);
  };

  // Quick preset button click
  const handlePresetClick = (amount) => {
    setFormData(prev => ({ ...prev, allocatedAmount: amount }));
    if (errors.allocatedAmount) {
      setErrors(prev => ({ ...prev, allocatedAmount: '' }));
    }
  };

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    const isDraft = formData.status === 'draft';

    if (editingBudget && (editingBudget.isPostedToLedger || (editingBudget.spent || 0) > 0)) {
      newErrors.submit =
        'This budget allocation has already been posted to the financial ledger and can no longer be edited.';
    }
    
    if (!formData.eventName.trim()) {
      newErrors.eventName = 'Event/Project name is required';
    }
    
    const requestedAmount = parseFloat(formData.allocatedAmount) || 0;
    const existingAllocationAmount = editingBudget ? (editingBudget.allocated || 0) : 0;
    const effectiveSurplus = selectedFundAvailable + existingAllocationAmount;

    if (!formData.allocatedAmount || requestedAmount <= 0) {
      newErrors.allocatedAmount = 'Allocated amount must be greater than 0';
    } else if (!isDraft && requestedAmount > effectiveSurplus) {
      newErrors.allocatedAmount = `Cannot allocate ₱${requestedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}. Exceeds available surplus of ₱${effectiveSurplus.toLocaleString(undefined, { minimumFractionDigits: 2 })} in ${selectedFundName}. Allocations are approved estimations that cannot exceed the initial fiscal budget.`;
    }
    
    if (!isDraft && selectedCommittees.length === 0) {
      newErrors.committee = 'Choose at least one committee responsible';
    }

    if (formData.startDate && formData.endDate && new Date(formData.startDate) > new Date(formData.endDate)) {
      newErrors.dates = 'End date cannot be before start date';
    }

    // Planned breakdown cannot exceed allocated capital
    if (allocatedCapital > 0 && breakdownSum > allocatedCapital) {
      newErrors.breakdown = `Planned breakdown (₱${breakdownSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}) exceeds the allocated capital of ₱${allocatedCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}. The planned budget cannot exceed the authorized PPMP allocation.`;
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
      const userSpent = parseFloat(formData.spentAmount);
      const effectiveSpent = expensesSum > 0
        ? expensesSum
        : (!isNaN(userSpent) && userSpent >= 0 ? userSpent : 0);
      const remaining = allocated - effectiveSpent;

      // Normalize valid breakdown items into approvedLineItems
      const validLineItems = (breakdownItems || [])
        .filter((it) => (it.description || it.name || '').trim())
        .map((it, idx) => {
          const qtyVal = Number(it.quantity) > 0 ? Number(it.quantity) : 1;
          const unitVal = parseFloat(it.unitCost) || 0;
          const plannedVal = Math.round(qtyVal * unitVal * 100) / 100;
          const spentVal = parseFloat(it.spent || 0);
          const plannedCentavos = toCentavos(plannedVal);
          const spentCentavos = toCentavos(spentVal);

          return {
            id: it.id || `line_${Date.now()}_${idx}`,
            name: (it.description || it.name || '').trim(),
            quantity: qtyVal,
            unitCost: unitVal,
            plannedAmount: plannedVal,
            spentAmount: spentVal,
            plannedCentavos,
            spentCentavos,
            status: getPPMPStatus(spentCentavos, plannedCentavos),
            notes: it.notes || '',
          };
        });

      const determinedProcurementType =
        formData.category === 'Project'
          ? 'PROJECT'
          : ['Supplies', 'Printing', 'Equipment', 'Material'].includes(formData.category)
          ? 'MATERIAL_SUPPLY'
          : 'EVENT';

      const budgetData = {
        fundAccountId: formData.fundAccountId || 'fund_fiscal_year_budget',
        eventName: formData.eventName.trim(),
        allocated,
        spent: effectiveSpent,
        remaining,
        category: formData.category,
        procurementType: determinedProcurementType,
        committee: joinCommittees(selectedCommittees) || editingBudget?.committee || 'Senators',
        resolution: (formData.resolution || '').trim(),
        resolutionDocumentId: formData.resolutionDocumentId || null,
        description: formData.description.trim(),
        receiptUrl: formData.receiptUrl.trim(),
        approvedLineItems: validLineItems,
        status: formData.status || 'approved',
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
          resolution: editingBudget.resolution,
          fundAccountId: editingBudget.fundAccountId,
        }, {
          id: editingBudget.id,
          title: budgetData.eventName,
          amount: budgetData.allocated,
          category: budgetData.category,
          committee: budgetData.committee,
          resolution: budgetData.resolution,
          fundAccountId: budgetData.fundAccountId,
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
          description: budgetData.description,
          fundAccountId: budgetData.fundAccountId,
        });
      }

      // Reset form if not editing
      if (!editingBudget) {
        setFormData({
          fundAccountId: 'fund_fiscal_year_budget',
          eventName: '',
          allocatedAmount: '',
          spentAmount: '',
          category: 'Event',
          resolution: '',
          resolutionDocumentId: null,
          description: '',
          receiptUrl: '',
          fiscalYear: new Date().getFullYear(),
          startDate: '',
          endDate: '',
          status: 'approved',
        });
        setSelectedCommittees([]);
        setBreakdownItems([newLine()]);
      }

      onSuccess(result);

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
    const spent = parseFloat(formData.spentAmount) || expensesSum || 0;
    if (allocated === 0) return 0;
    return Math.min((spent / allocated) * 100, 100);
  };

  // Status color pill
  const getStatusColor = () => {
    const status = determineStatus();
    if (isClassic) {
      switch(status) {
        case 'Over Budget':
        case 'Over Budget (Inflation)': return '#DC2626';
        case 'Fully Spent': return '#D4AF37';
        case 'Almost Spent': return '#F59E0B';
        case 'In Progress': return '#E5B842';
        case 'On Track': return '#10B981';
        default: return '#7a121d';
      }
    }
    switch(status) {
      case 'Over Budget':
      case 'Over Budget (Inflation)': return '#ea580c';
      case 'Fully Spent': return '#16a34a';
      case 'Almost Spent': return '#f59e0b';
      case 'In Progress': return '#2563eb';
      case 'On Track': return '#059669';
      default: return '#64748b';
    }
  };

  const requestedAmount = parseFloat(formData.allocatedAmount) || 0;
  const existingAllocationAmount = editingBudget ? (editingBudget.allocated || 0) : 0;
  const effectiveSurplus = selectedFundAvailable + existingAllocationAmount;
  const isExceedingSelectedFund = selectedFundBalance > 0 && requestedAmount > effectiveSurplus;

  return (
    <div className={`${styles.container} ${isClassic ? styles.formClassic : ''}`}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerBadge}>{isClassic ? 'SSG APPROPRIATIONS & ALLOCATION CONTROL' : 'FINANCIAL ALLOCATION CONTROL'}</div>
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

        {/* Fund Source Selection (Fiscal Year Budget vs FSG Remittance) */}
        <div className={styles.fundSourceWrapper}>
          <div className={styles.fundSourceHeader}>
            <label className={styles.fundSourceTitle}>
              <HiOfficeBuilding className={styles.labelIcon} />
              Appropriation Fund Source *
            </label>
            <span className={styles.fundSourceHint}>
              Select whether this allocation draws from the official Fiscal Year Budget or the FSG Remittance
            </span>
          </div>

          <div className={styles.fundSourceOptions}>
            {/* Fiscal Year Budget Option */}
            <button
              type="button"
              className={`${styles.fundOptionCard} ${formData.fundAccountId === 'fund_fiscal_year_budget' ? styles.fundOptionActiveMaroon : ''}`}
              onClick={() => {
                setFormData(prev => ({ ...prev, fundAccountId: 'fund_fiscal_year_budget' }));
              }}
            >
              <div className={styles.fundOptionTop}>
                <div className={styles.fundOptionIconCircleMaroon}>
                  <HiOfficeBuilding size={20} />
                </div>
                <div className={styles.fundOptionInfo}>
                  <div className={styles.fundOptionName}>SSG Fiscal Year Budget</div>
                  <div className={styles.fundOptionSub}>Annual General Appropriations</div>
                </div>
                {formData.fundAccountId === 'fund_fiscal_year_budget' && (
                  <span className={styles.fundOptionActivePillMaroon}>Selected</span>
                )}
              </div>
              <div className={styles.fundOptionMetrics}>
                <div className={styles.fundOptionMetricItem}>
                  <span className={styles.fundOptionMetricLabel}>Fund Balance:</span>
                  <span className={styles.fundOptionMetricVal}>₱{fiscalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className={styles.fundOptionMetricItem}>
                  <span className={styles.fundOptionMetricLabel}>Available Surplus:</span>
                  <span className={`${styles.fundOptionMetricVal} ${styles.fundOptionSurplus}`}>
                    ₱{fiscalAvailable.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </button>

            {/* FSG Remittance Option */}
            <button
              type="button"
              className={`${styles.fundOptionCard} ${formData.fundAccountId === 'fund_fsg_remittance' ? styles.fundOptionActiveGold : ''}`}
              onClick={() => {
                setFormData(prev => ({ ...prev, fundAccountId: 'fund_fsg_remittance' }));
              }}
            >
              <div className={styles.fundOptionTop}>
                <div className={styles.fundOptionIconCircleGold}>
                  <HiUserGroup size={20} />
                </div>
                <div className={styles.fundOptionInfo}>
                  <div className={styles.fundOptionName}>FSG Remittance Fund</div>
                  <div className={styles.fundOptionSub}>Federation Remittance & Backup Allocations</div>
                </div>
                {formData.fundAccountId === 'fund_fsg_remittance' && (
                  <span className={styles.fundOptionActivePillGold}>Selected</span>
                )}
              </div>
              <div className={styles.fundOptionMetrics}>
                <div className={styles.fundOptionMetricItem}>
                  <span className={styles.fundOptionMetricLabel}>Fund Balance:</span>
                  <span className={styles.fundOptionMetricVal}>₱{fsgBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className={styles.fundOptionMetricItem}>
                  <span className={styles.fundOptionMetricLabel}>Available Surplus:</span>
                  <span className={`${styles.fundOptionMetricVal} ${styles.fundOptionSurplusGold}`}>
                    ₱{fsgAvailable.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Selected Fund Context & Health Notice */}
        <div className={styles.treasuryContextBanner}>
          <div className={styles.treasuryInfo}>
            <HiInformationCircle className={styles.treasuryIcon} />
            <div>
              <span className={styles.treasuryLabel}>
                Allocating from <strong>{selectedFundName}</strong>:
              </span>
              <span className={styles.treasuryValue}>
                ₱{selectedFundAvailable.toLocaleString(undefined, { minimumFractionDigits: 2 })} unallocated surplus
              </span>
            </div>
          </div>
          {isExceedingSelectedFund && (
            <span className={styles.treasuryWarning}>
              ⚠️ Exceeds fund surplus by ₱{(requestedAmount - effectiveSurplus).toLocaleString(undefined, { minimumFractionDigits: 2 })} (Allocations are planned estimations and cannot exceed official budget)
            </span>
          )}
        </div>

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
              ₱{(parseFloat(formData.spentAmount) || expensesSum || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            {expensesSum > 0 && (
              <span className={styles.previewSyncedTag}>
                ✓ Synced from Planner
              </span>
            )}
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

          {/* Recorded spent: display only, driven by the Cost Breakdown Planner */}
          <div className={styles.formGroup}>
            <span className={styles.label}>
              <HiCash className={styles.labelIcon} />
              Recorded Spent
            </span>
            <output className={styles.readout}>
              ₱{(expensesSum > 0 ? expensesSum : (parseFloat(formData.spentAmount) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <small>Totaled from the Actual spent column in the planner below</small>
            </output>
          </div>

          {/* Committee Responsible */}
          <div className={`${styles.formGroup} ${styles.fullSpan}`}>
            <span className={styles.label}>
              <HiUserGroup className={styles.labelIcon} />
              Committee Responsible *
            </span>
            <CommitteePicker value={selectedCommittees} onChange={(v) => {
              setSelectedCommittees(v);
              if (errors.committee) setErrors(prev => ({ ...prev, committee: '' }));
            }} />
            {errors.committee && <span className={styles.error}>{errors.committee}</span>}
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

        <CostBreakdownPlanner
          items={breakdownItems}
          onChange={handleBreakdownChange}
          onAdd={handleAddBreakdownItem}
          onRemove={handleRemoveBreakdownItem}
          allocatedCapital={allocatedCapital}
          error={errors.breakdown}
        />

        {/* Project dates */}
        <div className={styles.formGroup}>
          <span className={styles.label}>
            <HiCalendar className={styles.labelIcon} />
            Project Dates (Optional)
          </span>
          <MiniRangeCalendar
            startDate={formData.startDate}
            endDate={formData.endDate}
            onChange={({ startDate, endDate }) => {
              setFormData(prev => ({ ...prev, startDate, endDate }));
              if (errors.dates) setErrors(prev => ({ ...prev, dates: '' }));
            }}
          />
          {errors.dates && <span className={styles.error}>{errors.dates}</span>}
        </div>

        {/* Approved resolution (linked from Documents) */}
        <div className={styles.formGroup}>
          <span className={styles.label}>
            <HiDocumentText className={styles.labelIcon} />
            Approved Resolution
          </span>
          <ResolutionPicker
            resolution={formData.resolution}
            documentId={formData.resolutionDocumentId}
            onChange={({ resolution, resolutionDocumentId }) =>
              setFormData(prev => ({ ...prev, resolution, resolutionDocumentId }))
            }
          />
        </div>

        {/* Description / Scope */}
        <div className={styles.formGroup}>
          <label htmlFor="description" className={styles.label}>
            <HiDocumentText className={styles.labelIcon} />
            Budget Justification & Objective (Optional)
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleInputChange}
            className={styles.textarea}
            placeholder="Outline the operational objectives, beneficiaries, and budget justification (Optional)..."
            rows="3"
          />
        </div>

        {/* Receipt / Documentation Link */}
        <div className={styles.formGroup}>
          <label htmlFor="receiptUrl" className={styles.label}>
            <HiLink className={styles.labelIcon} />
            Verification Document / Cloud Drive Link (Optional)
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

        {/* Approval Status Selector (Draft vs Approved) */}
        <div className={styles.formGroup} style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
          <label className={styles.label}>
            <HiTag className={styles.labelIcon} />
            Allocation Approval Status *
          </label>
          <div className={styles.approvalStatusGrid}>
            <div
              className={`${styles.statusCard} ${formData.status !== 'draft' ? styles.statusCardActiveApproved : ''}`}
              onClick={() => setFormData(prev => ({ ...prev, status: 'approved' }))}
              role="button"
              tabIndex={0}
            >
              <div className={styles.statusCardHeader}>
                <span className={styles.statusCardTitle}>✅ Officially Approved</span>
                {formData.status !== 'draft' && <span className={styles.statusBadgeSelected}>Active</span>}
              </div>
              <div className={styles.statusCardSubtitle}>
                Officially authorized package. Eligible for PPMP disbursements and financial ledger expense postings.
              </div>
            </div>

            <div
              className={`${styles.statusCard} ${formData.status === 'draft' ? styles.statusCardActiveDraft : ''}`}
              onClick={() => setFormData(prev => ({ ...prev, status: 'draft' }))}
              role="button"
              tabIndex={0}
            >
              <div className={styles.statusCardHeader}>
                <span className={styles.statusCardTitle}>📝 Draft Proposal</span>
                {formData.status === 'draft' && <span className={styles.statusBadgeDraftSelected}>Draft Active</span>}
              </div>
              <div className={styles.statusCardSubtitle}>
                Internal draft proposal under review. Expenses CANNOT be posted to financial ledgers until approved.
              </div>
            </div>
          </div>
        </div>

        {Object.keys(errors).some((k) => errors[k]) && (
          <div className={styles.errorAlert} role="alert">
            <HiExclamationCircle className={styles.errorIcon} />
            <span>{errors[Object.keys(errors).find((k) => errors[k])]}</span>
          </div>
        )}

        {/* Action Controls */}
        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => onSuccess(null)}
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
    </div>
  );
};

export default BudgetForm;
