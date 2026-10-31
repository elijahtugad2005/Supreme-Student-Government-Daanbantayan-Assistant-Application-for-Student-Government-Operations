import React, { useState, useMemo } from 'react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
import usePermissions from '../../hooks/usePermissions.js';
import {
  PROCUREMENT_TYPES,
  PROCUREMENT_TYPE_LABELS,
  PPMP_STATUSES,
  PPMP_STATUS_CONFIG,
  formatPHP,
  fromCentavos,
} from '../../utils/financeConstants.js';
import BudgetForm from '../BudgetForm/BudgetForm.jsx';
import PPMPInspectorDrawer from './PPMPInspectorDrawer.jsx';
import styles from './PPMPMatrix.module.css';
import {
  HiPlus,
  HiSearch,
  HiOutlineAdjustments,
  HiCog,
  HiSparkles,
  HiCheckCircle,
  HiCalendar,
  HiFolder,
  HiTag,
  HiEye,
  HiArrowRight,
  HiX,
  HiTrash,
  HiExclamationCircle,
} from 'react-icons/hi';
import {
  Layers,
  Building2,
  PackageCheck,
  Boxes,
  PieChart,
  Landmark,
  Coins,
} from 'lucide-react';

const PPMPMatrix = ({ onSelectPPMPItem = null }) => {
  const {
    budgets = [],
    archivedBudgets = [],
    fundAccounts = [],
    statistics = {},
    loading,
    refreshFinanceData,
    updateFiscalCeiling,
    deleteBudget,
    restoreBudget,
    updateBudget,
  } = useFinance();
  const { canEditFinance } = usePermissions();

  // Filters & Search
  const [activeCategoryTab, setActiveCategoryTab] = useState('ALL'); // 'ALL' | 'EVENT' | 'PROJECT' | 'MATERIAL_SUPPLY'
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'fresh' | 'partially_used' | 'depleted'
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & Drawer State
  const [isAllocationModalOpen, setIsAllocationModalOpen] = useState(false);
  const [selectedAllocationForEdit, setSelectedAllocationForEdit] = useState(null);
  const [isCeilingModalOpen, setIsCeilingModalOpen] = useState(false);
  const [inspectingPPMPItem, setInspectingPPMPItem] = useState(null);
  const [ceilingForm, setCeilingForm] = useState({
    ceilingAmount: '',
    resolutionRef: '',
    bankAccountReference: 'BDO Institutional Account ****2005',
  });
  const [ceilingError, setCeilingError] = useState(null);
  const [isUpdatingCeiling, setIsUpdatingCeiling] = useState(false);

  // Funding Pool Selector (Fiscal Year Budget & FSG Remittance ONLY; IGF & IGP excluded per policy)
  const [activeFundSource, setActiveFundSource] = useState('ALL'); // 'ALL' | 'FISCAL' | 'FSG'

  // Extract Fiscal & FSG Fund Account Telemetry
  const fiscalAccount = fundAccounts.find((a) => a.id === 'fund_fiscal_year_budget');
  const fsgAccount = fundAccounts.find((a) => a.id === 'fund_fsg_remittance');

  const fiscalCeilingCentavos = fiscalAccount?.appropriatedCeilingCentavos || fiscalAccount?.balanceCentavos || 0;
  const fsgBalanceCentavos = fsgAccount?.balanceCentavos || 0;
  const bdoLiquidHoldingCentavos = fiscalAccount?.balanceCentavos || 0;

  // Active Macro Budget Base based on selected funding pool
  const activeMacroCeilingCentavos =
    activeFundSource === 'FISCAL'
      ? fiscalCeilingCentavos
      : activeFundSource === 'FSG'
      ? fsgBalanceCentavos
      : fiscalCeilingCentavos + fsgBalanceCentavos;

  // Filter to active PPMP allocations (Fiscal Year Budget & FSG Remittance ONLY; IGF/IGP strictly excluded)
  const ppmpAllocations = useMemo(() => {
    const sourceList = statusFilter === 'archived' ? (archivedBudgets || []) : (budgets || []);
    return sourceList.filter((b) => {
      // Exclude archived allocations from active view
      if (statusFilter !== 'archived') {
        if (b.status === 'archived' || b.isActive === false || b.raw?.status === 'archived' || b.raw?.isActive === false) {
          return false;
        }
      }
      const fundId = b.fundAccountId || b.raw?.fundAccountId || (b.isFSG ? 'fund_fsg_remittance' : 'fund_fiscal_year_budget');
      // Strictly exclude IGF & IGP
      if (
        fundId === 'fund_igf_main' ||
        fundId === 'fund_igp_water' ||
        b.fundCategory === 'IGF' ||
        b.fundCategory === 'IGP'
      ) {
        return false;
      }
      if (activeFundSource === 'FISCAL') {
        return fundId === 'fund_fiscal_year_budget' && !b.isFSG;
      }
      if (activeFundSource === 'FSG') {
        return fundId === 'fund_fsg_remittance' || b.isFSG;
      }
      return fundId === 'fund_fiscal_year_budget' || fundId === 'fund_fsg_remittance' || b.isFSG;
    });
  }, [budgets, archivedBudgets, activeFundSource, statusFilter]);

  // Keep inspected item synced with live allocation state
  const liveInspectingItem = useMemo(() => {
    if (!inspectingPPMPItem) return null;
    return ppmpAllocations.find((b) => b.id === inspectingPPMPItem.id) || inspectingPPMPItem;
  }, [ppmpAllocations, inspectingPPMPItem]);

  // Aggregate PPMP totals (planned estimations)
  const totalPPMPPlannedCentavos = useMemo(() => {
    return ppmpAllocations.reduce(
      (acc, curr) => acc + (curr.raw?.approvedAmountCentavos || Math.round((curr.allocated || 0) * 100)),
      0
    );
  }, [ppmpAllocations]);

  // Aggregate PPMP spent totals (posted ledger disbursements)
  const totalPPMPSpentCentavos = useMemo(() => {
    return ppmpAllocations.reduce(
      (acc, curr) => acc + (curr.raw?.spentAmountCentavos || Math.round((curr.spent || 0) * 100)),
      0
    );
  }, [ppmpAllocations]);

  const isOverAllocated = activeMacroCeilingCentavos > 0 && totalPPMPPlannedCentavos > activeMacroCeilingCentavos;
  const overAllocatedDeficitCentavos = Math.max(0, totalPPMPPlannedCentavos - activeMacroCeilingCentavos);
  const unprogrammedReserveCentavos = Math.max(
    0,
    activeMacroCeilingCentavos - totalPPMPPlannedCentavos
  );

  const programmingRate = activeMacroCeilingCentavos > 0
    ? Math.round((totalPPMPPlannedCentavos / activeMacroCeilingCentavos) * 100)
    : 0;

  const executionRate = totalPPMPPlannedCentavos > 0
    ? Math.min(100, Math.round((totalPPMPSpentCentavos / totalPPMPPlannedCentavos) * 100))
    : 0;

  // Filtered List
  const filteredItems = useMemo(() => {
    return ppmpAllocations.filter((item) => {
      // Category Tab Filter
      if (activeCategoryTab !== 'ALL' && item.procurementType !== activeCategoryTab) {
        return false;
      }
      // Status Filter
      if (statusFilter !== 'ALL' && item.ppmpStatus !== statusFilter) {
        return false;
      }
      // Search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = (item.eventName || '').toLowerCase().includes(query);
        const matchesCommittee = (item.committee || '').toLowerCase().includes(query);
        const matchesSubItems = (item.approvedLineItems || []).some((li) =>
          (li.name || '').toLowerCase().includes(query)
        );
        return matchesName || matchesCommittee || matchesSubItems;
      }
      return true;
    });
  }, [ppmpAllocations, activeCategoryTab, statusFilter, searchQuery]);

  // Status counts
  const statusCounts = useMemo(() => {
    const counts = { ALL: (budgets || []).length, fresh: 0, partially_used: 0, depleted: 0, archived: (archivedBudgets || []).length };
    (budgets || []).forEach((item) => {
      if (item.status === 'archived' || item.isActive === false) return;
      if (item.ppmpStatus === PPMP_STATUSES.FRESH) counts.fresh += 1;
      else if (item.ppmpStatus === PPMP_STATUSES.PARTIALLY_USED) counts.partially_used += 1;
      else if (item.ppmpStatus === PPMP_STATUSES.DEPLETED) counts.depleted += 1;
    });
    return counts;
  }, [budgets, archivedBudgets]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts = { ALL: ppmpAllocations.length, EVENT: 0, PROJECT: 0, MATERIAL_SUPPLY: 0 };
    ppmpAllocations.forEach((item) => {
      if (item.procurementType === PROCUREMENT_TYPES.PROJECT) counts.PROJECT += 1;
      else if (item.procurementType === PROCUREMENT_TYPES.MATERIAL_SUPPLY) counts.MATERIAL_SUPPLY += 1;
      else counts.EVENT += 1;
    });
    return counts;
  }, [ppmpAllocations]);

  // Ceiling Modal Handlers
  const handleOpenCeilingModal = () => {
    setCeilingForm({
      ceilingAmount: fiscalCeilingCentavos > 0 ? fromCentavos(fiscalCeilingCentavos) : '',
      resolutionRef: fiscalAccount?.appropriationResolutionRef || '',
      bankAccountReference: fiscalAccount?.bankAccountReference || 'BDO Institutional Account ****2005',
    });
    setCeilingError(null);
    setIsCeilingModalOpen(true);
  };

  const handleSaveCeiling = async (e) => {
    e.preventDefault();
    setCeilingError(null);
    const amountNum = parseFloat(ceilingForm.ceilingAmount);
    if (isNaN(amountNum) || amountNum < 0) {
      setCeilingError('Please enter a valid university fiscal budget allowance.');
      return;
    }
    try {
      setIsUpdatingCeiling(true);
      await updateFiscalCeiling({
        ceilingAmount: amountNum,
        resolutionRef: ceilingForm.resolutionRef,
        bankAccountReference: ceilingForm.bankAccountReference,
      });
      setIsCeilingModalOpen(false);
      refreshFinanceData();
    } catch (err) {
      setCeilingError(err.message || 'Error updating fiscal allowance ceiling.');
    } finally {
      setIsUpdatingCeiling(false);
    }
  };

  const handleOpenCreateAllocation = (type = PROCUREMENT_TYPES.EVENT) => {
    setSelectedAllocationForEdit(null);
    setIsAllocationModalOpen(true);
  };

  const handleEditItem = (item) => {
    setSelectedAllocationForEdit(item);
    setIsAllocationModalOpen(true);
  };

  // Delete PPMP Item handler (requested by user)
  const handleDeleteItem = async (item) => {
    if (!canEditFinance) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete the PPMP item "${item.eventName}"?\n\nThis will remove the package from the active PPMP matrix. If expenses have been recorded against it, the record will be safely archived to protect ledger audit integrity.`
    );
    if (!confirmed) return;
    try {
      await deleteBudget(item.id);
      if (inspectingPPMPItem?.id === item.id) {
        setInspectingPPMPItem(null);
      }
      await refreshFinanceData();
    } catch (err) {
      alert(err.message || 'Failed to delete PPMP item.');
    }
  };

  // Restore PPMP Item handler
  const handleRestoreItem = async (item) => {
    if (!canEditFinance) return;
    const confirmed = window.confirm(
      `Restore PPMP item "${item.eventName}" back to active procurement?`
    );
    if (!confirmed) return;
    try {
      if (restoreBudget) {
        await restoreBudget(item.id);
      }
      await refreshFinanceData();
    } catch (err) {
      alert(err.message || 'Failed to restore PPMP item.');
    }
  };

  // Quick Approve draft PPMP item
  const handleQuickApprove = async (item) => {
    const resRef = window.prompt(
      `Approve PPMP item "${item.eventName}"?\n\nEnter official Board Resolution reference:`,
      item.resolution || `BOR-RES-${new Date().getFullYear()}-001`
    );
    if (!resRef || !resRef.trim()) return;
    try {
      await updateBudget(item.id, {
        status: 'approved',
        resolution: resRef.trim(),
        resolutionRef: resRef.trim(),
      });
      await refreshFinanceData();
    } catch (err) {
      alert(err.message || 'Failed to approve item.');
    }
  };

  return (
    <div className={styles.container}>
      {/* ─── Macro Appropriation Telemetry Bar ─── */}
      <section className={styles.telemetryCard}>
        <div className={styles.telemetryHeader}>
          <div>
            <div className={styles.telemetrySuperTag}>
              <Landmark size={14} /> UNIVERSITY FISCAL APPROPRIATION &amp; PPMP TELEMETRY
            </div>
            <h2 className={styles.telemetryTitle}>Project Procurement Management Plan</h2>
            <p className={styles.telemetrySubtitle}>
              Annual macro budget breakdown across Events, Student Projects, and Consumable Supplies. Allocations are approved estimations that cannot exceed the initial fiscal budget.
            </p>
          </div>

          {canEditFinance && activeFundSource !== 'FSG' && (
            <button
              type="button"
              className={styles.configAllowanceBtn}
              onClick={handleOpenCeilingModal}
            >
              <HiCog size={15} />
              {fiscalCeilingCentavos > 0 ? 'Edit Fiscal Budget' : '⚙️ Set Fiscal Budget'}
            </button>
          )}
        </div>

        {/* Over-Allocation Alert Banner */}
        {isOverAllocated && (
          <div className={styles.overallocatedBanner}>
            <HiExclamationCircle size={22} style={{ flexShrink: 0 }} />
            <div>
              <strong>⚠️ OVER-ALLOCATED PPMP PLAN:</strong> Total planned estimations ({formatPHP(totalPPMPPlannedCentavos, true)}) exceed the official budget ({formatPHP(activeMacroCeilingCentavos, true)}) by <strong>{formatPHP(overAllocatedDeficitCentavos, true)}</strong>. Planned allocations only depend on the initial fiscal budget and must stay within the approved university allowance.
            </div>
          </div>
        )}

        {/* KPI Metric Boxes */}
        <div className={styles.kpiGrid}>
          <div className={styles.kpiBox}>
            <span className={styles.kpiLabel}>
              <Landmark size={13} /> {activeFundSource === 'FISCAL' ? 'Initial Fiscal Budget' : activeFundSource === 'FSG' ? 'FSG Remittance Pool' : 'Fiscal & FSG Budget Pool'}
            </span>
            <span className={`${styles.kpiValue} ${styles.kpiValueMaroon}`}>
              {activeMacroCeilingCentavos > 0 ? formatPHP(activeMacroCeilingCentavos, true) : 'Not Configured'}
            </span>
            <span className={styles.kpiMeta}>
              {activeFundSource === 'FSG' ? 'Federation Grant & Remittance Pool' : (fiscalAccount?.bankAccountReference || 'BDO Institutional Account')}
            </span>
          </div>

          <div className={styles.kpiBox}>
            <span className={styles.kpiLabel}>
              <Layers size={13} /> PPMP Programmed (Estimations)
            </span>
            <span className={`${styles.kpiValue} ${isOverAllocated ? styles.kpiValueDanger : ''}`}>
              {formatPHP(totalPPMPPlannedCentavos, true)}
            </span>
            <span className={styles.kpiMeta}>
              {programmingRate}% of initial budget pool
            </span>
          </div>

          <div className={styles.kpiBox}>
            <span className={styles.kpiLabel}>
              <Coins size={13} /> {activeFundSource === 'FSG' ? 'FSG Remittance' : 'Fiscal Budget'}
            </span>
            <span className={`${styles.kpiValue} ${styles.kpiValueGreen}`}>
              {formatPHP(activeFundSource === 'FSG' ? fsgBalanceCentavos : bdoLiquidHoldingCentavos, true)}
            </span>
            <span className={styles.kpiMeta}>
              {activeFundSource === 'FSG' ? 'Available federation remittance' : '2026–2027 Official Fiscal Budget'}
            </span>
          </div>

          <div
            className={styles.kpiBox}
            style={isOverAllocated ? { borderColor: '#fca5a5', background: '#fef2f2' } : {}}
          >
            <span className={styles.kpiLabel} style={isOverAllocated ? { color: '#dc2626' } : {}}>
              {isOverAllocated ? <HiExclamationCircle size={13} /> : <PieChart size={13} />}
              {isOverAllocated ? 'Over-Allocated Deficit' : 'Unprogrammed Reserve'}
            </span>
            <span className={`${styles.kpiValue} ${isOverAllocated ? styles.kpiValueDanger : styles.kpiValueAmber}`}>
              {isOverAllocated
                ? `-${formatPHP(overAllocatedDeficitCentavos, true)}`
                : (activeMacroCeilingCentavos > 0 ? formatPHP(unprogrammedReserveCentavos, true) : '—')}
            </span>
            <span className={styles.kpiMeta} style={isOverAllocated ? { color: '#b91c1c' } : {}}>
              {isOverAllocated ? '⚠️ Estimations exceed official budget' : 'Remaining allowance for additional projects'}
            </span>
          </div>
        </div>

        {/* Global Progress Trackers */}
        <div className={styles.macroMeterWrapper}>
          <div className={styles.macroMeterHeader}>
            <span>PPMP Budget Execution: <strong>{formatPHP(totalPPMPSpentCentavos, true)}</strong> spent of <strong>{formatPHP(totalPPMPPlannedCentavos, true)}</strong> planned estimations</span>
            <span>{executionRate}% Utilized</span>
          </div>
          <div className={styles.progressBarTrack}>
            <div
              className={`${styles.progressBarFill} ${
                executionRate >= 90 ? styles.progressBarFillDanger : executionRate >= 65 ? styles.progressBarFillWarning : ''
              }`}
              style={{ width: `${executionRate}%` }}
            />
          </div>
        </div>
      </section>

      {/* ─── Funding Pool Selector Bar (Fiscal Year Budget & FSG Remittance Only; IGF & IGP Excluded) ─── */}
      <div className={styles.fundFilterTabsBar}>
        <span className={styles.fundFilterLabel}>Funding Pool:</span>
        <button
          type="button"
          className={`${styles.fundFilterTab} ${activeFundSource === 'ALL' ? styles.fundFilterTabActive : ''}`}
          onClick={() => setActiveFundSource('ALL')}
        >
          All PPMP (Fiscal &amp; FSG)
        </button>
        <button
          type="button"
          className={`${styles.fundFilterTab} ${activeFundSource === 'FISCAL' ? styles.fundFilterTabActive : ''}`}
          onClick={() => setActiveFundSource('FISCAL')}
        >
          <Landmark size={13} /> SSG Fiscal Year Budget
        </button>
        <button
          type="button"
          className={`${styles.fundFilterTab} ${activeFundSource === 'FSG' ? styles.fundFilterTabActive : ''}`}
          onClick={() => setActiveFundSource('FSG')}
        >
          <Building2 size={13} /> FSG Remittance Fund
        </button>
      </div>

      {/* ─── Control Bar: Categories, Filters, Search ─── */}
      <div className={styles.controlBar}>
        {/* Category Tabs */}
        <div className={styles.categoryTabsGroup} role="tablist">
          <button
            type="button"
            className={`${styles.categoryTab} ${activeCategoryTab === 'ALL' ? styles.categoryTabActive : ''}`}
            onClick={() => setActiveCategoryTab('ALL')}
          >
            <Layers size={14} /> All Packages ({categoryCounts.ALL})
          </button>
          <button
            type="button"
            className={`${styles.categoryTab} ${activeCategoryTab === PROCUREMENT_TYPES.EVENT ? styles.categoryTabActive : ''}`}
            onClick={() => setActiveCategoryTab(PROCUREMENT_TYPES.EVENT)}
          >
            <Building2 size={14} /> Events &amp; Programs ({categoryCounts.EVENT})
          </button>
          <button
            type="button"
            className={`${styles.categoryTab} ${activeCategoryTab === PROCUREMENT_TYPES.PROJECT ? styles.categoryTabActive : ''}`}
            onClick={() => setActiveCategoryTab(PROCUREMENT_TYPES.PROJECT)}
          >
            <Boxes size={14} /> Student Projects ({categoryCounts.PROJECT})
          </button>
          <button
            type="button"
            className={`${styles.categoryTab} ${activeCategoryTab === PROCUREMENT_TYPES.MATERIAL_SUPPLY ? styles.categoryTabActive : ''}`}
            onClick={() => setActiveCategoryTab(PROCUREMENT_TYPES.MATERIAL_SUPPLY)}
          >
            <PackageCheck size={14} /> Materials &amp; Supplies ({categoryCounts.MATERIAL_SUPPLY})
          </button>
        </div>

        {/* Search & New Allocation Action */}
        <div className={styles.searchAndActionArea}>
          <div className={styles.searchBox}>
            <HiSearch size={16} className={styles.searchIcon} />
            <input
              type="text"
              placeholder="Search package, sub-item..."
              className={styles.searchInput}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {canEditFinance && (
            <button
              type="button"
              className={styles.newAllocationBtn}
              onClick={() => handleOpenCreateAllocation(activeCategoryTab !== 'ALL' ? activeCategoryTab : PROCUREMENT_TYPES.EVENT)}
            >
              <HiPlus size={16} /> + New PPMP Item
            </button>
          )}
        </div>
      </div>

      {/* ─── Status Filter Chips (Secretary Color Indicators) ─── */}
      <div className={styles.statusChipsBar}>
        <span className={styles.statusChipLabel}>Filter Status:</span>
        <button
          type="button"
          className={`${styles.statusFilterChip} ${statusFilter === 'ALL' ? styles.statusFilterChipActive : ''}`}
          onClick={() => setStatusFilter('ALL')}
        >
          All ({statusCounts.ALL})
        </button>
        <button
          type="button"
          className={`${styles.statusFilterChip} ${statusFilter === PPMP_STATUSES.FRESH ? styles.statusFilterChipActive : ''}`}
          onClick={() => setStatusFilter(PPMP_STATUSES.FRESH)}
        >
          <span className={`${styles.statusDot} ${styles.dotFresh}`} />
          Fresh / Untouched ({statusCounts.fresh})
        </button>
        <button
          type="button"
          className={`${styles.statusFilterChip} ${statusFilter === PPMP_STATUSES.PARTIALLY_USED ? styles.statusFilterChipActive : ''}`}
          onClick={() => setStatusFilter(PPMP_STATUSES.PARTIALLY_USED)}
        >
          <span className={`${styles.statusDot} ${styles.dotPartial}`} />
          Partially Used ({statusCounts.partially_used})
        </button>
        <button
          type="button"
          className={`${styles.statusFilterChip} ${statusFilter === PPMP_STATUSES.DEPLETED ? styles.statusFilterChipActive : ''}`}
          onClick={() => setStatusFilter(PPMP_STATUSES.DEPLETED)}
        >
          <span className={`${styles.statusDot} ${styles.dotDepleted}`} />
          Depleted / Liquidated ({statusCounts.depleted})
        </button>

        {statusCounts.archived > 0 && (
          <button
            type="button"
            className={`${styles.statusFilterChip} ${statusFilter === 'archived' ? styles.statusFilterChipActive : ''}`}
            onClick={() => setStatusFilter(statusFilter === 'archived' ? 'ALL' : 'archived')}
            style={{ borderColor: statusFilter === 'archived' ? '#9333ea' : undefined }}
          >
            📦 Archived Records ({statusCounts.archived})
          </button>
        )}
      </div>

      {/* ─── PPMP Matrix Cards Grid ─── */}
      <div className={styles.matrixGrid}>
        {filteredItems.length === 0 ? (
          <div className={styles.emptyState}>
            <Layers size={42} style={{ color: '#94a3b8' }} />
            <h3 className={styles.emptyStateTitle}>No PPMP Items Found</h3>
            <p className={styles.emptyStateDesc}>
              {searchQuery || statusFilter !== 'ALL' || activeCategoryTab !== 'ALL'
                ? 'Try adjusting your filters or search keywords.'
                : 'Start breaking down your university fiscal budget allowance into events, projects, and supplies.'}
            </p>
            {canEditFinance && (
              <button
                type="button"
                className={styles.newAllocationBtn}
                style={{ marginTop: '0.5rem' }}
                onClick={() => handleOpenCreateAllocation(activeCategoryTab !== 'ALL' ? activeCategoryTab : PROCUREMENT_TYPES.EVENT)}
              >
                <HiPlus size={16} /> + Add First PPMP Allocation
              </button>
            )}
          </div>
        ) : (
          filteredItems.map((item) => {
            const isFresh = item.ppmpStatus === PPMP_STATUSES.FRESH;
            const isPartial = item.ppmpStatus === PPMP_STATUSES.PARTIALLY_USED;
            const isDepleted = item.ppmpStatus === PPMP_STATUSES.DEPLETED;

            const badgeStatusClass = isFresh
              ? styles.statusFresh
              : isPartial
              ? styles.statusPartial
              : styles.statusDepleted;

            const dotClass = isFresh
              ? styles.dotFresh
              : isPartial
              ? styles.dotPartial
              : styles.dotDepleted;

            const packageClass =
              item.procurementType === PROCUREMENT_TYPES.PROJECT
                ? styles.packageTagProject
                : item.procurementType === PROCUREMENT_TYPES.MATERIAL_SUPPLY
                ? styles.packageTagMaterial
                : styles.packageTagEvent;

            const packageLabel =
              item.procurementType === PROCUREMENT_TYPES.PROJECT
                ? 'Project'
                : item.procurementType === PROCUREMENT_TYPES.MATERIAL_SUPPLY
                ? 'Material & Supply'
                : 'Event & Program';

            const subItems = item.approvedLineItems || [];
            const subItemsCount = subItems.length;

            return (
              <div key={item.id} className={styles.matrixCard}>
                <div>
                  <div className={styles.cardHeaderTop}>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <span className={`${styles.packageTag} ${packageClass}`}>
                        {packageLabel}
                      </span>
                      {item.status === 'draft' && (
                        <span style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', padding: '0.2rem 0.5rem', borderRadius: '6px', fontWeight: 700, border: '1px solid #cbd5e1' }} title="Draft allocation cannot be posted to financial ledger until approved">
                          📝 Draft
                        </span>
                      )}
                    </div>
                    <span className={`${styles.statusBadge} ${badgeStatusClass}`}>
                      <span className={`${styles.statusDot} ${dotClass}`} />
                      {PPMP_STATUS_CONFIG[item.ppmpStatus]?.shortLabel || 'Fresh'}
                    </span>
                  </div>

                  <h3 className={styles.itemTitle}>{item.eventName}</h3>
                  <div className={styles.itemCommittee}>
                    {item.committee || 'General'} • FY {item.fiscalYear} • {item.isFSG || item.fundAccountId === 'fund_fsg_remittance' ? 'FSG Remittance' : 'Fiscal Budget'}
                  </div>

                  {/* Financial Figures */}
                  <div className={styles.cardFiguresRow}>
                    <div className={styles.figureBlock}>
                      <span className={styles.figureLabel}>Estimated Budget</span>
                      <span className={styles.figureAmount}>
                        ₱{(item.allocated || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className={styles.figureBlock} style={{ textAlign: 'right' }}>
                      <span className={styles.figureLabel}>Remaining Surplus</span>
                      <span className={`${styles.figureRemaining} ${isDepleted ? styles.figureRemainingSpent : ''}`}>
                        ₱{(item.remaining || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {/* Budget Utilization Progress Bar */}
                  <div className={styles.cardMeterContainer}>
                    <div className={styles.meterLabels}>
                      <span>
                        Spent: ₱{(item.spent || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        {(item.spent || 0) > (item.allocated || 0) && (
                          <span style={{ color: '#ea580c', fontWeight: 700, marginLeft: '0.35rem' }} title="Expenses exceed allocation due to real-world price inflation">
                            📈 +₱{((item.spent || 0) - (item.allocated || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })} (Inflation)
                          </span>
                        )}
                      </span>
                      <span>{item.utilizationRate || 0}% Utilized</span>
                    </div>
                    <div className={styles.progressBarTrack} style={{ height: '7px' }}>
                      <div
                        className={`${styles.progressBarFill} ${
                          item.utilizationRate >= 100
                            ? styles.progressBarFillDanger
                            : item.utilizationRate >= 65
                            ? styles.progressBarFillWarning
                            : ''
                        }`}
                        style={{ width: `${Math.min(100, item.utilizationRate || 0)}%` }}
                      />
                    </div>
                  </div>

                  {/* Sub-Line Items Preview */}
                  {subItemsCount > 0 ? (
                    <div className={styles.subItemsPreview}>
                      <div className={styles.subItemsHeader}>
                        <span>Itemized Package ({subItemsCount} components)</span>
                        <span style={{ fontSize: '0.68rem', color: '#64748b' }}>Live Status</span>
                      </div>
                      {subItems.slice(0, 3).map((sub, idx) => (
                        <div key={sub.id || idx} className={styles.subItemRow}>
                          <span className={styles.subItemName} title={sub.name}>
                            <span
                              className={`${styles.statusDot} ${
                                sub.status === PPMP_STATUSES.DEPLETED
                                  ? styles.dotDepleted
                                  : sub.status === PPMP_STATUSES.PARTIALLY_USED
                                  ? styles.dotPartial
                                  : styles.dotFresh
                              }`}
                            />
                            {sub.name}
                          </span>
                          <span className={styles.subItemAmount}>
                            ₱{(sub.plannedAmount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                      {subItemsCount > 3 && (
                        <div style={{ fontSize: '0.72rem', color: '#64748b', textAlign: 'center', paddingTop: '0.2rem' }}>
                          +{subItemsCount - 3} more sub-items...
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={styles.subItemsPreview} style={{ borderStyle: 'dotted', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                        No sub-line items itemized yet. Click edit to break down package costs.
                      </span>
                    </div>
                  )}
                </div>

                {/* Footer Action Buttons */}
                <div className={styles.cardFooterActions}>
                  <button
                    type="button"
                    className={styles.inspectBtn}
                    onClick={() => {
                      if (onSelectPPMPItem) onSelectPPMPItem(item);
                      setInspectingPPMPItem(item);
                    }}
                  >
                    <HiEye size={14} /> Inspect
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {canEditFinance && item.status === 'draft' && (
                      <button
                        type="button"
                        className={styles.quickApproveBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleQuickApprove(item);
                        }}
                        title="Approve this draft allocation"
                      >
                        ✓ Approve
                      </button>
                    )}

                    {canEditFinance && (
                      <button
                        type="button"
                        className={styles.disburseQuickBtn}
                        onClick={() => handleEditItem(item)}
                        title="Edit this allocation package"
                      >
                        Edit <HiArrowRight size={13} />
                      </button>
                    )}

                    {canEditFinance && (item.status === 'archived' || item.isArchived) ? (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestoreItem(item);
                        }}
                        title="Restore this archived PPMP item back to active matrix"
                        style={{ color: '#059669', borderColor: '#a7f3d0', fontSize: '0.72rem', padding: '0.3rem 0.5rem' }}
                      >
                        <HiRefresh size={13} /> Restore
                      </button>
                    ) : canEditFinance ? (
                      <button
                        type="button"
                        className={styles.deleteCardBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteItem(item);
                        }}
                        title="Delete or archive this PPMP item"
                        aria-label="Delete PPMP item"
                      >
                        <HiTrash size={14} />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ─── University Fiscal Budget Allowance Modal ─── */}
      {isCeilingModalOpen && (
        <div className={styles.modalBackdrop || 'modalBackdrop'} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem',
        }} onClick={() => setIsCeilingModalOpen(false)}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '480px',
            width: '100%',
            padding: '1.75rem',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#1e293b' }}>
              🏛️ University Fiscal Budget Allowance
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.35rem', marginBottom: '1.25rem' }}>
              Set the total institutional budget allowance granted by the university for the entire fiscal term. This governs the PPMP ceiling.
            </p>

            {ceilingError && (
              <div style={{ padding: '0.75rem', background: '#fee2e2', color: '#991b1b', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {ceilingError}
              </div>
            )}

            <form onSubmit={handleSaveCeiling}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569', marginBottom: '0.35rem' }}>
                  2026–2027 Fiscal Budget Amount (₱) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem', boxSizing: 'border-box' }}
                  placeholder="e.g. 500000.00"
                  value={ceilingForm.ceilingAmount}
                  onChange={(e) => setCeilingForm({ ...ceilingForm, ceilingAmount: e.target.value })}
                  required
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569', marginBottom: '0.35rem' }}>
                  Institutional Depository Bank Reference *
                </label>
                <input
                  type="text"
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem', boxSizing: 'border-box' }}
                  placeholder="e.g. BDO Institutional Account ****2005"
                  value={ceilingForm.bankAccountReference}
                  onChange={(e) => setCeilingForm({ ...ceilingForm, bankAccountReference: e.target.value })}
                  required
                />
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569', marginBottom: '0.35rem' }}>
                  Board / Administration Resolution Reference
                </label>
                <input
                  type="text"
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem', boxSizing: 'border-box' }}
                  placeholder="e.g. BOR-RES-2026-081"
                  value={ceilingForm.resolutionRef}
                  onChange={(e) => setCeilingForm({ ...ceilingForm, resolutionRef: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  style={{ padding: '0.55rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'transparent', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setIsCeilingModalOpen(false)}
                  disabled={isUpdatingCeiling}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: '0.55rem 1.25rem', borderRadius: '8px', border: 'none', background: '#7a121d', color: '#ffffff', cursor: 'pointer', fontWeight: 700 }}
                  disabled={isUpdatingCeiling}
                >
                  {isUpdatingCeiling ? 'Saving...' : 'Save Fiscal Budget'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Allocation Modal (BudgetForm) ─── */}
      {isAllocationModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
          onClick={() => {
            setIsAllocationModalOpen(false);
            setSelectedAllocationForEdit(null);
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              maxWidth: '960px',
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
              padding: '2rem',
              position: 'relative',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.35)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              style={{
                position: 'absolute',
                top: '1.25rem',
                right: '1.25rem',
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                padding: '0.35rem',
                borderRadius: '8px',
              }}
              onClick={() => {
                setIsAllocationModalOpen(false);
                setSelectedAllocationForEdit(null);
              }}
              aria-label="Close Allocation Modal"
            >
              <HiX size={22} />
            </button>
            <BudgetForm
              editingBudget={selectedAllocationForEdit}
              defaultFundAccountId={activeFundSource === 'FSG' ? 'fund_fsg_remittance' : 'fund_fiscal_year_budget'}
              onSuccess={() => {
                setIsAllocationModalOpen(false);
                setSelectedAllocationForEdit(null);
                refreshFinanceData();
              }}
            />
          </div>
        </div>
      )}

      {/* ─── Sub-Line Item Inspector & Disbursement Drawer (Ticket 04) ─── */}
      {liveInspectingItem && (
        <PPMPInspectorDrawer
          item={liveInspectingItem}
          onClose={() => setInspectingPPMPItem(null)}
        />
      )}
    </div>
  );
};

export default PPMPMatrix;
