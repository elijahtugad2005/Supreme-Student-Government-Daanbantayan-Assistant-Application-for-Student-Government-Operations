import React, { useState, useEffect, useMemo } from 'react';
import {
  Coins,
  CupSoda,
  Lock,
  PlusCircle,
  MapPin,
  History,
  AlertTriangle,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import usePermissions from '../../hooks/usePermissions.js';
import { hasPermission } from '../../utils/permissions.js';
import {
  createBrowserIgpProjectService,
  LOCKER_BUILDINGS,
  LOCKER_STATUSES,
  IGP_PROJECT_TYPES,
} from '../../services/igpProjectService.js';
import { computeIgpCollectionMetrics } from '../../utils/budgetAnalyticsHelpers.js';
import styles from './IgpProjectManager.module.css';

/**
 * Safely formats currency to 2 decimal places, supporting both amountPHP and amountCentavos,
 * preventing any "Cannot read properties of undefined (reading 'toFixed')" runtime errors.
 */
function formatCollectionAmountPHP(c) {
  if (typeof c?.amountPHP === 'number' && !isNaN(c.amountPHP)) {
    return c.amountPHP.toFixed(2);
  }
  if (typeof c?.amountCentavos === 'number' && !isNaN(c.amountCentavos)) {
    return (c.amountCentavos / 100).toFixed(2);
  }
  const parsed = parseFloat(c?.amountPHP);
  if (!isNaN(parsed)) {
    return parsed.toFixed(2);
  }
  return '0.00';
}

export default function IgpProjectManager({ user = null, onNavigateToMap = null, roleMode = 'full' }) {
  const { currentUser, userName, userRole } = useAuth();
  const { canEditFinance: hookCanEditFinance } = usePermissions();
  const isVendingOnly = roleMode === 'vending';
  const isLockersOnly = roleMode === 'lockers';

  const effectiveUser = useMemo(() => {
    if (user) return user;
    return {
      uid: currentUser?.uid || '',
      name: userName || currentUser?.displayName || 'Authorized Officer',
      role: userRole || 'member',
      email: currentUser?.email || '',
    };
  }, [user, currentUser, userName, userRole]);

  const canEditFinance = useMemo(() => {
    return user ? hasPermission(user, 'canEditFinance') : hookCanEditFinance;
  }, [user, hookCanEditFinance]);

  const canManageLockers = useMemo(() => {
    return canEditFinance || isLockersOnly || effectiveUser?.role === 'governor';
  }, [canEditFinance, isLockersOnly, effectiveUser]);

  const canRecordVending = useMemo(() => {
    return canEditFinance || isVendingOnly || effectiveUser?.role === 'representative';
  }, [canEditFinance, isVendingOnly, effectiveUser]);

  const service = useMemo(() => createBrowserIgpProjectService(), []);

  const [activeSubTab, setActiveSubTab] = useState(isVendingOnly ? 'vending' : 'lockers'); // 'lockers' | 'vending' | 'future' | 'history'
  useEffect(() => {
    setActiveSubTab(isVendingOnly ? 'vending' : 'lockers');
  }, [isVendingOnly, isLockersOnly]);
  const [lockers, setLockers] = useState([]);
  const [collections, setCollections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState({ open: false, message: '', type: 'info' });

  // Modals state
  const [vendingModalOpen, setVendingModalOpen] = useState(false);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [rentModalLocker, setRentModalLocker] = useState(null);
  const [detailModalLocker, setDetailModalLocker] = useState(null);
  const [confirmingVacate, setConfirmingVacate] = useState(false);
  const [lockerStatusFilter, setLockerStatusFilter] = useState('ALL');
  const [deleteConfirmModal, setDeleteConfirmModal] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);
  const [priceForm, setPriceForm] = useState({
    scope: 'ALL',
    buildingName: LOCKER_BUILDINGS.HM,
    lockerId: '',
    monthlyRatePHP: '100',
  });

  // Form states
  const [vendingForm, setVendingForm] = useState({
    amountPHP: '',
    buildingName: 'Student Center',
    buildingId: 'bldg-student-center',
    specificSpot: 'Ground Floor Cafeteria Hallway',
    officerName: '',
    notes: '',
    referenceNumber: '',
  });

  const [rentForm, setRentForm] = useState({
    renterName: '',
    studentId: '',
    program: '',
    phoneNumber: '',
    months: 1,
    monthlyRatePHP: 100,
    startDate: new Date().toISOString().split('T')[0],
    officerName: '',
  });

  const [customForm, setCustomForm] = useState({
    projectName: '',
    amountPHP: '',
    buildingName: 'Administration Building',
    buildingId: 'bldg-admin',
    specificSpot: 'SSG Office',
    officerName: '',
    notes: '',
    referenceNumber: '',
  });

  const showToast = (message, type = 'info') => {
    setToast({ open: true, message, type });
    setTimeout(() => setToast({ open: false, message: '', type: 'info' }), 4000);
  };

  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      await service.initializeLockerUnitsIfEmpty();
      const [lList, cList] = await Promise.all([service.listLockers(), service.listCollections()]);
      setLockers(lList);
      setCollections(cList);
    } catch (err) {
      console.error('Error loading IGP data:', err);
      showToast('Error connecting to database: ' + err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [service]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Summary computations (supports both amountCentavos and legacy amountPHP-only records)
  const metrics = useMemo(
    () => computeIgpCollectionMetrics(collections, lockers),
    [collections, lockers]
  );

  const handleVendingSubmit = async (e) => {
    e.preventDefault();
    if (!vendingForm.amountPHP || parseFloat(vendingForm.amountPHP) <= 0) {
      showToast('Please enter a valid collection amount.', 'error');
      return;
    }
    const collectorName = vendingForm.officerName?.trim() || effectiveUser.name || 'Authorized Officer';
    try {
      await service.recordVendingCollection(
        {
          amountPHP: parseFloat(vendingForm.amountPHP),
          location: {
            buildingName: vendingForm.buildingName,
            buildingId: vendingForm.buildingId,
            specificSpot: vendingForm.specificSpot,
          },
          officerName: collectorName,
          notes: vendingForm.notes,
          referenceNumber: vendingForm.referenceNumber,
        },
        effectiveUser
      );
      showToast(`✓ Recorded ₱${parseFloat(vendingForm.amountPHP).toFixed(2)} to IGP Fund by ${collectorName}!`, 'success');
      setVendingModalOpen(false);
      setVendingForm({
        amountPHP: '',
        buildingName: 'Student Center',
        buildingId: 'bldg-student-center',
        specificSpot: 'Ground Floor Cafeteria Hallway',
        officerName: '',
        notes: '',
        referenceNumber: '',
      });
      loadData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleRentSubmit = async (e) => {
    e.preventDefault();
    if (!rentForm.renterName.trim() || !rentForm.studentId.trim()) {
      showToast('Student Renter Name and Student ID are required.', 'error');
      return;
    }
    const officerInCharge = rentForm.officerName?.trim() || effectiveUser.name || 'SSG Officer';
    try {
      await service.rentLockerUnit(
        rentModalLocker.lockerId,
        {
          ...rentForm,
          officerName: officerInCharge,
        },
        effectiveUser
      );
      showToast(`✓ Locker ${rentModalLocker.lockerId} rented to ${rentForm.renterName}!`, 'success');
      setRentModalLocker(null);
      setRentForm({
        renterName: '',
        studentId: '',
        program: '',
        phoneNumber: '',
        months: 1,
        monthlyRatePHP: 100,
        startDate: new Date().toISOString().split('T')[0],
        officerName: '',
      });
      loadData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdateLockerRates = async (e) => {
    e.preventDefault();
    const rateNum = parseFloat(priceForm.monthlyRatePHP);
    if (Number.isNaN(rateNum) || rateNum <= 0) {
      showToast('Please enter a valid monthly rate greater than ₱0.00.', 'error');
      return;
    }
    setIsUpdatingPrice(true);
    try {
      const res = await service.updateLockerRates(
        {
          scope: priceForm.scope,
          buildingName: priceForm.buildingName,
          lockerId: priceForm.lockerId,
          monthlyRatePHP: rateNum,
        },
        effectiveUser
      );
      showToast(
        `Updated ${res.updatedCount} locker unit${res.updatedCount > 1 ? 's' : ''} to ₱${res.monthlyRatePHP.toFixed(2)}/month.`,
        'success'
      );
      setPriceModalOpen(false);
      await loadData();
    } catch (err) {
      showToast(err.message || 'Failed to update locker rates.', 'error');
    } finally {
      setIsUpdatingPrice(false);
    }
  };

  const handleReleaseLocker = async (lockerId) => {
    try {
      await service.releaseLockerUnit(lockerId, effectiveUser);
      showToast(`Locker ${lockerId} is now Available.`, 'success');
      setConfirmingVacate(false);
      setDetailModalLocker(null);
      loadData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleCustomSubmit = async (e) => {
    e.preventDefault();
    if (!customForm.projectName.trim() || !customForm.amountPHP || parseFloat(customForm.amountPHP) <= 0) {
      showToast('Project Name and positive amount are required.', 'error');
      return;
    }
    const collectorName = customForm.officerName?.trim() || effectiveUser.name || 'Authorized Officer';
    try {
      await service.recordCustomIgpRevenue(
        {
          projectName: customForm.projectName,
          amountPHP: parseFloat(customForm.amountPHP),
          location: {
            buildingName: customForm.buildingName,
            buildingId: customForm.buildingId,
            specificSpot: customForm.specificSpot,
          },
          officerName: collectorName,
          notes: customForm.notes,
          referenceNumber: customForm.referenceNumber,
        },
        effectiveUser
      );
      showToast(`✓ Recorded ₱${parseFloat(customForm.amountPHP).toFixed(2)} for ${customForm.projectName}!`, 'success');
      setCustomModalOpen(false);
      setCustomForm({
        projectName: '',
        amountPHP: '',
        buildingName: 'Administration Building',
        buildingId: 'bldg-admin',
        specificSpot: 'SSG Office',
        officerName: '',
        notes: '',
        referenceNumber: '',
      });
      loadData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteVendingCollection = async (e) => {
    e?.preventDefault();
    if (!deleteConfirmModal) return;
    if (!deleteReason.trim()) {
      showToast('Please specify a reason for deleting and reversing this collection.', 'error');
      return;
    }

    setIsDeleting(true);
    try {
      await service.deleteVendingCollection(deleteConfirmModal.id, deleteReason.trim(), effectiveUser);
      showToast('Collection deleted and fund balance reversed successfully.', 'success');
      setDeleteConfirmModal(null);
      setDeleteReason('');
      await loadData();
    } catch (err) {
      console.error('Error deleting collection:', err);
      showToast('Failed to delete collection: ' + err.message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const hmLockers = lockers.filter((l) => l.buildingName === LOCKER_BUILDINGS.HM);
  const edLockers = lockers.filter((l) => l.buildingName === LOCKER_BUILDINGS.EDUCATION);
  const lockerRateSummary = useMemo(() => {
    const rates = lockers.map((l) => Number(l.monthlyRatePHP) || 100);
    if (rates.length === 0) return '₱100.00/month';
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    return min === max
      ? `₱${min.toFixed(2)}/month`
      : `₱${min.toFixed(2)}–₱${max.toFixed(2)}/month`;
  }, [lockers]);

  return (
    <div className={styles.wrapper}>
      {/* Toast */}
      {toast.open && (
        <div className={styles.modalBackdrop} style={{ background: 'transparent', zIndex: 10001, pointerEvents: 'none' }}>
          <div
            style={{
              background: toast.type === 'error' ? '#7a1c22' : '#234a2e',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 8,
              padding: '0.85rem 1.25rem',
              color: '#fff',
              fontSize: '0.9rem',
              fontWeight: 600,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              pointerEvents: 'auto',
            }}
          >
            {toast.message}
          </div>
        </div>
      )}

      {isLoading && (
        <div style={{ padding: '1rem', color: '#888', fontStyle: 'italic' }}>
          Loading IGP financial balances and lockers...
        </div>
      )}
      {/* Overview Cards */}
      <div className={styles.metricsGrid}>
        {!isVendingOnly && !isLockersOnly && (
          <div className={styles.metricCard}>
            <div className={styles.metricHeader}>
              <span>TOTAL IGP COLLECTIONS</span>
              <span className={styles.metricIconWrap}><Coins size={16} /></span>
            </div>
            <div className={styles.metricValue}>₱{metrics.totalPHP.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            <div className={styles.metricSubtext}>Credited to Custodial Lockbox / IGP Fund</div>
          </div>
        )}

        {!isVendingOnly && (
          <div className={styles.metricCard}>
            <div className={styles.metricHeader}>
              <span>CAMPUS LOCKERS ({metrics.totalLockers || 30} UNITS)</span>
              <span className={styles.metricIconWrap}><Lock size={16} /></span>
            </div>
            <div className={styles.metricValue}>
              {metrics.occupiedLockers} / {metrics.totalLockers}
            </div>
            <div className={styles.metricSubtext}>
              {metrics.availableLockers} Available • ₱{(metrics.lockersPHP || 0).toFixed(2)} Collected
            </div>
          </div>
        )}

        {!isLockersOnly && (
          <div className={styles.metricCard}>
            <div className={styles.metricHeader}>
              <span>VENDING MACHINE PROFIT</span>
              <span className={styles.metricIconWrap}><CupSoda size={16} /></span>
            </div>
            <div className={styles.metricValue}>₱{metrics.vendingPHP.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            <div className={styles.metricSubtext}>Physical cash box collections</div>
          </div>
        )}

        {!isVendingOnly && !isLockersOnly && (
          <div className={styles.metricCard}>
            <div className={styles.metricHeader}>
              <span>FUTURE IGP PROJECTS</span>
              <span className={styles.metricIconWrap}><PlusCircle size={16} /></span>
            </div>
            <div className={styles.metricValue}>₱{metrics.customPHP.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            <div className={styles.metricSubtext}>Other student enterprise revenues</div>
          </div>
        )}
      </div>

      {/* Sub Navigation */}
      <div className={styles.actionNav}>
        {!isVendingOnly && (
          <button
            type="button"
            className={`${styles.navButton} ${activeSubTab === 'lockers' ? styles.navButtonActive : ''}`}
            onClick={() => setActiveSubTab('lockers')}
          >
            <Lock size={16} /> Campus Lockers ({metrics.totalLockers || 30} Units)
          </button>
        )}
        {!isLockersOnly && (
          <button
            type="button"
            className={`${styles.navButton} ${activeSubTab === 'vending' ? styles.navButtonActive : ''}`}
            onClick={() => setActiveSubTab('vending')}
          >
            <CupSoda size={16} /> Vending Machine Collections
          </button>
        )}
        {!isVendingOnly && !isLockersOnly && (
          <button
            type="button"
            className={`${styles.navButton} ${activeSubTab === 'future' ? styles.navButtonActive : ''}`}
            onClick={() => setActiveSubTab('future')}
          >
            <PlusCircle size={16} /> Record Future IGP Project
          </button>
        )}
        <button
          type="button"
          className={`${styles.navButton} ${activeSubTab === 'history' ? styles.navButtonActive : ''}`}
          onClick={() => setActiveSubTab('history')}
        >
          <History size={16} /> Collections Ledger History
        </button>
      </div>

      {/* Lockers Tab */}
      {!isVendingOnly && activeSubTab === 'lockers' && (
        <div className={styles.contentCard}>
          <div className={styles.cardHeaderRow}>
            <div>
              <h3 className={styles.cardTitle}>
                <Lock size={18} /> Campus Locker Management System
              </h3>
              <p className={styles.cardDesc}>
                {lockers.length || 30} student locker units ({lockerRateSummary}). Select any unit to assign a rental, inspect active leases, or vacate.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {canManageLockers && (
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={() => {
                    const defaultRate = lockers[0]?.monthlyRatePHP || 100;
                    setPriceForm({
                      scope: 'ALL',
                      buildingName: LOCKER_BUILDINGS.HM,
                      lockerId: lockers[0]?.lockerId || '',
                      monthlyRatePHP: String(defaultRate),
                    });
                    setPriceModalOpen(true);
                  }}
                >
                  <Coins size={15} /> Update Locker Rates
                </button>
              )}
              {onNavigateToMap && (
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => onNavigateToMap('bldg-hm')}
                >
                  <MapPin size={15} /> Locate on Campus Map
                </button>
              )}
            </div>
          </div>

          <div className={styles.lockerToolbar}>
            <div className={styles.filterChipGroup} role="group" aria-label="Filter locker units by status">
              {[
                { key: 'ALL', label: `All (${lockers.length})` },
                { key: LOCKER_STATUSES.AVAILABLE, label: `Available (${metrics.availableLockers})` },
                { key: LOCKER_STATUSES.OCCUPIED, label: `Occupied (${metrics.occupiedLockers})` },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`${styles.filterChip} ${lockerStatusFilter === opt.key ? styles.filterChipActive : ''}`}
                  onClick={() => setLockerStatusFilter(opt.key)}
                  aria-pressed={lockerStatusFilter === opt.key}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className={styles.legendRow} aria-hidden="true">
              <span className={styles.legendItem}>
                <span className={styles.legendDotAvailable} /> Available
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendDotOccupied} /> Occupied
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendDotMaintenance} /> Maintenance
              </span>
            </div>
          </div>

          <div className={styles.lockersBankWrap}>
            {[
              {
                title: 'Hospitality Management (HM) Building — 15 Units',
                subtitle: 'Ground Floor West Wing',
                units: hmLockers,
              },
              {
                title: 'Education Building — 15 Units',
                subtitle: 'Main Corridor Lockers',
                units: edLockers,
              },
            ].map((bank) => {
              const occupiedCount = bank.units.filter((l) => l.status === LOCKER_STATUSES.OCCUPIED).length;
              const visibleUnits =
                lockerStatusFilter === 'ALL'
                  ? bank.units
                  : bank.units.filter((l) => l.status === lockerStatusFilter);

              return (
                <div key={bank.title} className={styles.bankSection}>
                  <div className={styles.bankHeader}>
                    <span className={styles.bankTitle}>
                      <MapPin size={15} /> {bank.title}
                    </span>
                    <div className={styles.bankMetaRight}>
                      <span>{bank.subtitle}</span>
                      <span className={styles.bankOccupancyPill}>
                        {occupiedCount} / {bank.units.length} Occupied
                      </span>
                    </div>
                  </div>
                  <div className={styles.lockersGrid}>
                    {visibleUnits.map((locker) => {
                      const isOccupied = locker.status === LOCKER_STATUSES.OCCUPIED;
                      const isMaint = locker.status === LOCKER_STATUSES.MAINTENANCE;
                      return (
                        <button
                          key={locker.lockerId}
                          type="button"
                          className={`${styles.lockerTile} ${
                            isOccupied
                              ? styles.lockerTileOccupied
                              : isMaint
                              ? styles.lockerTileMaintenance
                              : styles.lockerTileAvailable
                          }`}
                          onClick={() => {
                            setConfirmingVacate(false);
                            if (isOccupied) {
                              setDetailModalLocker(locker);
                            } else if (isMaint) {
                              showToast(`Locker ${locker.lockerId} is under maintenance and cannot be rented.`, 'error');
                            } else if (!canManageLockers) {
                              showToast('View-only access: locker rental requires Finance or Governor authority.', 'error');
                            } else {
                              setRentForm((prev) => ({
                                ...prev,
                                monthlyRatePHP: locker.monthlyRatePHP || 100,
                              }));
                              setRentModalLocker(locker);
                            }
                          }}
                          aria-label={`Locker ${locker.lockerId}, ${locker.status}${
                            locker.currentLease?.renterName ? `, rented by ${locker.currentLease.renterName}` : ''
                          }`}
                        >
                          <div className={styles.lockerVents} aria-hidden="true">
                            <span />
                            <span />
                          </div>
                          <div className={styles.lockerNumberPlate}>
                            <span className={styles.lockerNumber}>{locker.lockerId}</span>
                          </div>
                          <span
                            className={`${styles.lockerBadge} ${
                              isOccupied
                                ? styles.badgeOccupied
                                : isMaint
                                ? styles.badgeMaintenance
                                : styles.badgeAvailable
                            }`}
                          >
                            {locker.status}
                          </span>
                          <span className={styles.lockerRenterShort}>
                            {locker.currentLease?.renterName || `₱${locker.monthlyRatePHP || 100}/mo`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Vending Machine Tab */}
      {!isLockersOnly && activeSubTab === 'vending' && (
        <div className={styles.contentCard}>
          <div className={styles.cardHeaderRow}>
            <div>
              <h3 className={styles.cardTitle}>
                <CupSoda size={18} color="#98c379" /> Campus Vending Machine Collections
              </h3>
              <p className={styles.cardDesc}>
                Log physical coins and bills collected from campus vendo units into the IGP Treasury fund balance.
              </p>
            </div>
            {canRecordVending && (
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => setVendingModalOpen(true)}
              >
                <PlusCircle size={15} /> Log Vendo Collection
              </button>
            )}
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Collection Date</th>
                  <th>Amount</th>
                  <th>Location</th>
                  <th>Collected By</th>
                  <th>Ref #</th>
                  <th>Notes</th>
                  {canEditFinance && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {collections
                  .filter((c) => c.projectType === IGP_PROJECT_TYPES.VENDING_MACHINE)
                  .map((c) => (
                    <tr key={c.id}>
                      <td>{new Date(c.collectedAt).toLocaleString()}</td>
                      <td style={{ fontWeight: 700, color: '#f7d070' }}>₱{formatCollectionAmountPHP(c)}</td>
                      <td>
                        <strong>{c.location?.buildingName}</strong>
                        {c.location?.specificSpot ? ` (${c.location.specificSpot})` : ''}
                      </td>
                      <td>{c.collectedBy?.name || 'Officer'}</td>
                      <td>{c.referenceNumber || '—'}</td>
                      <td>{c.notes || '—'}</td>
                      {canEditFinance && (
                        <td>
                          <button
                            type="button"
                            className={styles.btnDangerSmall}
                            onClick={() => {
                              setDeleteConfirmModal(c);
                              setDeleteReason('');
                            }}
                            title="Delete misinput & reverse funds"
                          >
                            <Trash2 size={13} /> Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                {collections.filter((c) => c.projectType === IGP_PROJECT_TYPES.VENDING_MACHINE).length === 0 && (
                  <tr>
                    <td colSpan={canEditFinance ? 7 : 6} style={{ textAlign: 'center', padding: '2rem', color: '#9e8e8c' }}>
                      No vending machine collections recorded yet. Click "Log Vendo Collection" above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Future IGP Projects Tab */}
      {!isVendingOnly && !isLockersOnly && activeSubTab === 'future' && (
        <div className={styles.contentCard}>
          <div className={styles.cardHeaderRow}>
            <div>
              <h3 className={styles.cardTitle}>
                <PlusCircle size={18} color="#61afef" /> Future &amp; Custom Income-Generating Projects
              </h3>
              <p className={styles.cardDesc}>
                Record revenues from upcoming student ventures (printing kiosks, booth concessions, event equipment rentals) into IGP funds.
              </p>
            </div>
            {canEditFinance && (
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => setCustomModalOpen(true)}
              >
                <PlusCircle size={15} /> Add Custom IGP Revenue
              </button>
            )}
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Project Name</th>
                  <th>Amount</th>
                  <th>Location</th>
                  <th>Collected By</th>
                  <th>Notes</th>
                  {canEditFinance && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {collections
                  .filter((c) => c.projectType === IGP_PROJECT_TYPES.FUTURE_IGP)
                  .map((c) => (
                    <tr key={c.id}>
                      <td>{new Date(c.collectedAt).toLocaleDateString()}</td>
                      <td style={{ fontWeight: 700 }}>{c.projectName}</td>
                      <td style={{ fontWeight: 700, color: '#f7d070' }}>₱{formatCollectionAmountPHP(c)}</td>
                      <td>
                        <strong>{c.location?.buildingName}</strong> ({c.location?.specificSpot})
                      </td>
                      <td>{c.collectedBy?.name || 'Officer'}</td>
                      <td>{c.notes || '—'}</td>
                      {canEditFinance && (
                        <td>
                          <button
                            type="button"
                            className={styles.btnDangerSmall}
                            onClick={() => {
                              setDeleteConfirmModal(c);
                              setDeleteReason('');
                            }}
                            title="Delete misinput & reverse funds"
                          >
                            <Trash2 size={13} /> Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                {collections.filter((c) => c.projectType === IGP_PROJECT_TYPES.FUTURE_IGP).length === 0 && (
                  <tr>
                    <td colSpan={canEditFinance ? 7 : 6} style={{ textAlign: 'center', padding: '2rem', color: '#9e8e8c' }}>
                      No custom IGP project revenues logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* History Ledger Tab */}
      {activeSubTab === 'history' && (
        <div className={styles.contentCard}>
          <div className={styles.cardHeaderRow}>
            <div>
              <h3 className={styles.cardTitle}>
                <History size={18} color="#f7d070" /> Unified IGP Collections Ledger
              </h3>
              <p className={styles.cardDesc}>
                Chronological ledger entries credited to Income-Generating Projects Fund.
              </p>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Category</th>
                  <th>Project</th>
                  <th>Amount</th>
                  <th>Officer</th>
                </tr>
              </thead>
              <tbody>
                {collections
                  .filter((c) => {
                    if (isVendingOnly) return c.projectType === IGP_PROJECT_TYPES.VENDING_MACHINE;
                    if (isLockersOnly) return c.projectType === IGP_PROJECT_TYPES.LOCKER_RENTAL;
                    return true;
                  })
                  .map((c) => (
                  <tr key={c.id}>
                    <td>{new Date(c.collectedAt || c.createdAt).toLocaleString()}</td>
                    <td>
                      <span
                        className={styles.lockerBadge}
                        style={{
                          background:
                            c.projectType === IGP_PROJECT_TYPES.VENDING_MACHINE
                              ? 'rgba(152,195,121,0.15)'
                              : c.projectType === IGP_PROJECT_TYPES.LOCKER_RENTAL
                              ? 'rgba(247,208,112,0.15)'
                              : 'rgba(97,175,239,0.15)',
                          color:
                            c.projectType === IGP_PROJECT_TYPES.VENDING_MACHINE
                              ? '#98c379'
                              : c.projectType === IGP_PROJECT_TYPES.LOCKER_RENTAL
                              ? '#f7d070'
                              : '#61afef',
                        }}
                      >
                        {c.projectType.replace('_', ' ')}
                      </span>
                    </td>
                    <td>{c.projectName}</td>
                    <td style={{ fontWeight: 700, color: '#f7d070' }}>₱{formatCollectionAmountPHP(c)}</td>
                    <td>{c.collectedBy?.name || 'SSG Officer'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rent Locker Modal */}
      {rentModalLocker && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalBox}>
            <div className={styles.cardHeaderRow}>
              <h4 className={styles.cardTitle}>
                <Lock size={18} color="#f7d070" /> Rent Locker {rentModalLocker.lockerId}
              </h4>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setRentModalLocker(null)}
              >
                <X size={16} />
              </button>
            </div>
            <p className={styles.cardDesc}>
              Location: <strong>{rentModalLocker.buildingName}</strong> (Rate: ₱{rentModalLocker.monthlyRatePHP}/month)
            </p>

            <form onSubmit={handleRentSubmit} className={styles.formGrid}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Student Full Name *</label>
                <input
                  type="text"
                  required
                  className={styles.textInput}
                  placeholder="e.g. Maria Santos"
                  value={rentForm.renterName}
                  onChange={(e) => setRentForm({ ...rentForm, renterName: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Student School ID *</label>
                <input
                  type="text"
                  required
                  className={styles.textInput}
                  placeholder="e.g. 1345678"
                  value={rentForm.studentId}
                  onChange={(e) => setRentForm({ ...rentForm, studentId: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Degree Program &amp; Year</label>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="e.g. BSHM 2-A"
                  value={rentForm.program}
                  onChange={(e) => setRentForm({ ...rentForm, program: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Contact Number</label>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="e.g. 09171234567"
                  value={rentForm.phoneNumber}
                  onChange={(e) => setRentForm({ ...rentForm, phoneNumber: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Monthly Rate (₱/Month) *</label>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  required
                  disabled={!canManageLockers}
                  className={styles.textInput}
                  value={rentForm.monthlyRatePHP}
                  onChange={(e) => setRentForm({ ...rentForm, monthlyRatePHP: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Rental Duration (Months) *</label>
                <select
                  className={styles.selectInput}
                  value={rentForm.months}
                  onChange={(e) => setRentForm({ ...rentForm, months: parseInt(e.target.value, 10) })}
                >
                  {[1, 2, 3, 4, 5].map((m) => {
                    const rate = parseFloat(rentForm.monthlyRatePHP) || rentModalLocker.monthlyRatePHP || 100;
                    const subtotal = (m * rate).toFixed(2);
                    return (
                      <option key={m} value={m}>
                        {m} {m === 1 ? 'Month' : m === 5 ? 'Months (Semester)' : 'Months'} — ₱{subtotal}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Assisting Officer Name *</label>
                <input
                  type="text"
                  required
                  className={styles.textInput}
                  placeholder="e.g. Officer Name"
                  value={rentForm.officerName || effectiveUser.name || ''}
                  onChange={(e) => setRentForm({ ...rentForm, officerName: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setRentModalLocker(null)}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary}>
                  Confirm Rental &amp; Collect ₱
                  {(
                    rentForm.months *
                    (parseFloat(rentForm.monthlyRatePHP) || rentModalLocker.monthlyRatePHP || 100)
                  ).toFixed(2)}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Locker Pricing Modal */}
      {priceModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => !isUpdatingPrice && setPriceModalOpen(false)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.cardHeaderRow}>
              <h4 className={styles.cardTitle}>
                <Coins size={18} /> Update Campus Locker Rates
              </h4>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setPriceModalOpen(false)}
                disabled={isUpdatingPrice}
                aria-label="Close pricing modal"
              >
                <X size={16} />
              </button>
            </div>
            <p className={styles.cardDesc}>
              Set a new monthly rental fee across all lockers, a specific building wing, or an individual unit. Existing active leases keep their agreed rate until vacated.
            </p>

            <form onSubmit={handleUpdateLockerRates} className={styles.formGrid}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Update Scope *</label>
                <select
                  className={styles.selectInput}
                  value={priceForm.scope}
                  onChange={(e) => setPriceForm({ ...priceForm, scope: e.target.value })}
                >
                  <option value="ALL">All Campus Lockers ({lockers.length} Units)</option>
                  <option value="BUILDING">Specific Building Wing</option>
                  <option value="SINGLE">Single Locker Unit</option>
                </select>
              </div>

              {priceForm.scope === 'BUILDING' && (
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Target Building *</label>
                  <select
                    className={styles.selectInput}
                    value={priceForm.buildingName}
                    onChange={(e) => setPriceForm({ ...priceForm, buildingName: e.target.value })}
                  >
                    <option value={LOCKER_BUILDINGS.HM}>{LOCKER_BUILDINGS.HM} (15 Units)</option>
                    <option value={LOCKER_BUILDINGS.EDUCATION}>{LOCKER_BUILDINGS.EDUCATION} (15 Units)</option>
                  </select>
                </div>
              )}

              {priceForm.scope === 'SINGLE' && (
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Target Locker Unit *</label>
                  <select
                    className={styles.selectInput}
                    value={priceForm.lockerId}
                    onChange={(e) => {
                      const chosen = lockers.find((l) => l.lockerId === e.target.value);
                      setPriceForm({
                        ...priceForm,
                        lockerId: e.target.value,
                        monthlyRatePHP: chosen ? String(chosen.monthlyRatePHP || 100) : priceForm.monthlyRatePHP,
                      });
                    }}
                  >
                    {lockers.map((l) => (
                      <option key={l.lockerId} value={l.lockerId}>
                        {l.lockerId} — {l.buildingName} (Currently ₱{Number(l.monthlyRatePHP || 100).toFixed(2)}/mo)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>New Monthly Rental Rate (₱) *</label>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  required
                  className={styles.textInput}
                  placeholder="e.g. 150.00"
                  value={priceForm.monthlyRatePHP}
                  onChange={(e) => setPriceForm({ ...priceForm, monthlyRatePHP: e.target.value })}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                  {[50, 75, 100, 120, 150, 200].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`${styles.filterChip} ${
                        parseFloat(priceForm.monthlyRatePHP) === preset ? styles.filterChipActive : ''
                      }`}
                      onClick={() => setPriceForm({ ...priceForm, monthlyRatePHP: String(preset) })}
                    >
                      ₱{preset}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setPriceModalOpen(false)}
                  disabled={isUpdatingPrice}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={isUpdatingPrice}>
                  {isUpdatingPrice
                    ? 'Saving Rates...'
                    : `Apply ₱${(parseFloat(priceForm.monthlyRatePHP) || 0).toFixed(2)}/mo Rate`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Locker Detail / Vacate Modal */}
      {detailModalLocker && (
        <div className={styles.modalBackdrop} onClick={() => setDetailModalLocker(null)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.cardHeaderRow}>
              <h4 className={styles.cardTitle}>
                <Lock size={18} /> Locker {detailModalLocker.lockerId} — Active Lease
              </h4>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setDetailModalLocker(null)}
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>

            <div className={styles.leaseDetailsGrid}>
              <div className={styles.leaseDetailItem}>
                <span className={styles.leaseDetailLabel}>Tenant</span>
                <span className={styles.leaseDetailVal}>{detailModalLocker.currentLease?.renterName || '—'}</span>
              </div>
              <div className={styles.leaseDetailItem}>
                <span className={styles.leaseDetailLabel}>Student ID</span>
                <span className={styles.leaseDetailVal}>{detailModalLocker.currentLease?.studentId || '—'}</span>
              </div>
              <div className={styles.leaseDetailItem}>
                <span className={styles.leaseDetailLabel}>Program</span>
                <span className={styles.leaseDetailVal}>{detailModalLocker.currentLease?.program || '—'}</span>
              </div>
              <div className={styles.leaseDetailItem}>
                <span className={styles.leaseDetailLabel}>Contact</span>
                <span className={styles.leaseDetailVal}>{detailModalLocker.currentLease?.phoneNumber || '—'}</span>
              </div>
              <div className={styles.leaseDetailItem}>
                <span className={styles.leaseDetailLabel}>Rental Start</span>
                <span className={styles.leaseDetailVal}>{detailModalLocker.currentLease?.startDate || '—'}</span>
              </div>
              <div className={styles.leaseDetailItem}>
                <span className={styles.leaseDetailLabel}>Lease Expiry</span>
                <span className={styles.leaseDetailVal} style={{ color: '#ffea9f' }}>
                  {detailModalLocker.currentLease?.expiryDate
                    ? new Date(detailModalLocker.currentLease.expiryDate).toLocaleDateString()
                    : '—'}
                </span>
              </div>
              <div className={styles.leaseDetailItem}>
                <span className={styles.leaseDetailLabel}>Building</span>
                <span className={styles.leaseDetailVal}>{detailModalLocker.buildingName || '—'}</span>
              </div>
              <div className={styles.leaseDetailItem}>
                <span className={styles.leaseDetailLabel}>Recorded By</span>
                <span className={styles.leaseDetailVal}>{detailModalLocker.currentLease?.recordedBy || '—'}</span>
              </div>
            </div>

            {confirmingVacate ? (
              <div className={styles.warningBox}>
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ flex: 1 }}>
                  Vacating <strong>{detailModalLocker.lockerId}</strong> will clear the current tenant lease and mark the locker Available again.
                </div>
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  setConfirmingVacate(false);
                  setDetailModalLocker(null);
                }}
              >
                Close
              </button>
              {canManageLockers && (confirmingVacate ? (
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={() => handleReleaseLocker(detailModalLocker.lockerId)}
                >
                  Confirm Vacate Locker
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={() => setConfirmingVacate(true)}
                >
                  Vacate Locker (Return to Available)
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Vending Modal */}
      {vendingModalOpen && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalBox}>
            <div className={styles.cardHeaderRow}>
              <h4 className={styles.cardTitle}>
                <CupSoda size={18} color="#98c379" /> Record Vending Machine Collection
              </h4>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setVendingModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleVendingSubmit} className={styles.formGrid}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Total Amount Collected (₱) *</label>
                <input
                  type="number"
                  step="0.25"
                  required
                  className={styles.textInput}
                  placeholder="e.g. 850.00"
                  value={vendingForm.amountPHP}
                  onChange={(e) => setVendingForm({ ...vendingForm, amountPHP: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Collected By (Officer Name) *</label>
                <input
                  type="text"
                  required
                  className={styles.textInput}
                  placeholder="e.g. Finance Secretary / Auditor"
                  value={vendingForm.officerName || effectiveUser.name || ''}
                  onChange={(e) => setVendingForm({ ...vendingForm, officerName: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Campus Building / Location *</label>
                <select
                  className={styles.selectInput}
                  value={vendingForm.buildingName}
                  onChange={(e) =>
                    setVendingForm({
                      ...vendingForm,
                      buildingName: e.target.value,
                      buildingId:
                        e.target.value === 'Student Center'
                          ? 'bldg-student-center'
                          : e.target.value === 'HM Building'
                          ? 'bldg-hm'
                          : 'bldg-educ',
                    })
                  }
                >
                  <option value="Student Center">Student Center (Cafeteria)</option>
                  <option value="HM Building">HM Building</option>
                  <option value="Education Building">Education Building</option>
                  <option value="Administration Building">Administration Building</option>
                </select>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Specific Machine Location / Spot</label>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="e.g. Ground Floor beside main entrance"
                  value={vendingForm.specificSpot}
                  onChange={(e) => setVendingForm({ ...vendingForm, specificSpot: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Cash Bag / Seal Reference Number</label>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="e.g. BAG-VND-04"
                  value={vendingForm.referenceNumber}
                  onChange={(e) => setVendingForm({ ...vendingForm, referenceNumber: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Notes / Observation</label>
                <textarea
                  className={styles.textInput}
                  rows={2}
                  placeholder="e.g. Machine working smoothly, coins counted in presence of auditor"
                  value={vendingForm.notes}
                  onChange={(e) => setVendingForm({ ...vendingForm, notes: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setVendingModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary}>
                  Save Collection &amp; Credit IGP Fund
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Future Project Modal */}
      {customModalOpen && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalBox}>
            <div className={styles.cardHeaderRow}>
              <h4 className={styles.cardTitle}>
                <PlusCircle size={18} color="#61afef" /> Record Custom Future IGP Revenue
              </h4>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setCustomModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCustomSubmit} className={styles.formGrid}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Project Name *</label>
                <input
                  type="text"
                  required
                  className={styles.textInput}
                  placeholder="e.g. Student Printing &amp; Copy Service"
                  value={customForm.projectName}
                  onChange={(e) => setCustomForm({ ...customForm, projectName: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Revenue Amount (₱) *</label>
                <input
                  type="number"
                  step="0.25"
                  required
                  className={styles.textInput}
                  placeholder="e.g. 1500.00"
                  value={customForm.amountPHP}
                  onChange={(e) => setCustomForm({ ...customForm, amountPHP: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Collected By (Officer Name) *</label>
                <input
                  type="text"
                  required
                  className={styles.textInput}
                  placeholder="e.g. Officer Name / Custodian"
                  value={customForm.officerName || effectiveUser.name || ''}
                  onChange={(e) => setCustomForm({ ...customForm, officerName: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Building / Venue</label>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="e.g. SSG Office, Admin Bldg"
                  value={customForm.buildingName}
                  onChange={(e) => setCustomForm({ ...customForm, buildingName: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Specific Spot</label>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="e.g. Front Service Counter"
                  value={customForm.specificSpot}
                  onChange={(e) => setCustomForm({ ...customForm, specificSpot: e.target.value })}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Notes</label>
                <textarea
                  className={styles.textInput}
                  rows={2}
                  placeholder="e.g. Proceeds from midterms week printing services"
                  value={customForm.notes}
                  onChange={(e) => setCustomForm({ ...customForm, notes: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setCustomModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary}>
                  Save &amp; Credit IGP Fund
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Collection Confirmation Modal */}
      {deleteConfirmModal && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalBox}>
            <div className={styles.cardHeaderRow}>
              <h4 className={styles.cardTitle} style={{ color: '#e06c75' }}>
                <Trash2 size={18} color="#e06c75" /> Delete Misinput Collection
              </h4>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => {
                  setDeleteConfirmModal(null);
                  setDeleteReason('');
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div className={styles.warningBox}>
              <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Reversal Notice:</strong> Deleting this collection will permanently remove the record and automatically reverse <strong>₱{formatCollectionAmountPHP(deleteConfirmModal)}</strong> from the IGP Treasury fund balance. An immutable audit trail entry will be logged.
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                background: 'rgba(255, 255, 255, 0.03)',
                padding: '0.85rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #382c2a)',
                fontSize: '0.85rem',
              }}
            >
              <div><strong>Project:</strong> {deleteConfirmModal.projectName || 'Campus Vending Machine'}</div>
              <div><strong>Amount to Reverse:</strong> <span style={{ color: '#f7d070', fontWeight: 700 }}>₱{formatCollectionAmountPHP(deleteConfirmModal)}</span></div>
              <div><strong>Location:</strong> {deleteConfirmModal.location?.buildingName || 'Campus Venue'} {deleteConfirmModal.location?.specificSpot ? `(${deleteConfirmModal.location.specificSpot})` : ''}</div>
              <div><strong>Recorded Officer:</strong> {deleteConfirmModal.collectedBy?.name || 'Officer'}</div>
              <div><strong>Date:</strong> {new Date(deleteConfirmModal.collectedAt || deleteConfirmModal.createdAt).toLocaleString()}</div>
            </div>

            <form onSubmit={handleDeleteVendingCollection} className={styles.formGrid}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Reason for Reversal / Deletion *</label>
                <input
                  type="text"
                  required
                  className={styles.textInput}
                  placeholder="e.g. Misinput / Duplicate cash count entry by officer"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => {
                    setDeleteConfirmModal(null);
                    setDeleteReason('');
                  }}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.btnDanger}
                  disabled={!deleteReason.trim() || isDeleting}
                >
                  {isDeleting ? 'Deleting & Reversing...' : 'Confirm Deletion & Reversal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

