import React, { useState, useEffect, useMemo } from 'react';
import {
  Coins,
  CupSoda,
  Lock,
  PlusCircle,
  MapPin,
  Calendar,
  User,
  History,
  CheckCircle,
  AlertCircle,
  X,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import {
  createBrowserIgpProjectService,
  LOCKER_BUILDINGS,
  LOCKER_STATUSES,
  IGP_PROJECT_TYPES,
} from '../../services/igpProjectService.js';
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

export default function IgpProjectManager({ user = null, onNavigateToMap = null }) {
  const { currentUser, userName, userRole } = useAuth();
  const effectiveUser = useMemo(() => {
    if (user) return user;
    return {
      uid: currentUser?.uid || '',
      name: userName || currentUser?.displayName || 'Authorized Officer',
      role: userRole || 'officer',
      email: currentUser?.email || '',
    };
  }, [user, currentUser, userName, userRole]);

  const service = useMemo(() => createBrowserIgpProjectService(), []);

  const [activeSubTab, setActiveSubTab] = useState('lockers'); // 'lockers' | 'vending' | 'future' | 'history'
  const [lockers, setLockers] = useState([]);
  const [collections, setCollections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState({ open: false, message: '', type: 'info' });

  // Modals state
  const [vendingModalOpen, setVendingModalOpen] = useState(false);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [rentModalLocker, setRentModalLocker] = useState(null);
  const [detailModalLocker, setDetailModalLocker] = useState(null);

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

  // Summary computations
  const metrics = useMemo(() => {
    let vendingCentavos = 0;
    let lockersCentavos = 0;
    let customCentavos = 0;

    for (const c of collections) {
      if (c.projectType === IGP_PROJECT_TYPES.VENDING_MACHINE) vendingCentavos += c.amountCentavos || 0;
      else if (c.projectType === IGP_PROJECT_TYPES.LOCKER_RENTAL) lockersCentavos += c.amountCentavos || 0;
      else if (c.projectType === IGP_PROJECT_TYPES.FUTURE_IGP) customCentavos += c.amountCentavos || 0;
    }

    const occupied = lockers.filter((l) => l.status === LOCKER_STATUSES.OCCUPIED).length;

    return {
      totalPHP: (vendingCentavos + lockersCentavos + customCentavos) / 100,
      vendingPHP: vendingCentavos / 100,
      lockersPHP: lockersCentavos / 100,
      customPHP: customCentavos / 100,
      occupiedLockers: occupied,
      availableLockers: lockers.length - occupied,
      totalLockers: lockers.length,
    };
  }, [collections, lockers]);

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
        startDate: new Date().toISOString().split('T')[0],
        officerName: '',
      });
      loadData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleReleaseLocker = async (lockerId) => {
    if (!window.confirm(`Vacate Locker ${lockerId}? Unit will be set to Available.`)) return;
    try {
      await service.releaseLockerUnit(lockerId, effectiveUser);
      showToast(`✓ Locker ${lockerId} is now Available.`, 'success');
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

  const hmLockers = lockers.filter((l) => l.buildingName === LOCKER_BUILDINGS.HM);
  const edLockers = lockers.filter((l) => l.buildingName === LOCKER_BUILDINGS.EDUCATION);

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
        <div className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>TOTAL IGP COLLECTIONS</span>
            <Coins size={16} color="#f7d070" />
          </div>
          <div className={styles.metricValue}>₱{metrics.totalPHP.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div className={styles.metricSubtext}>Credited to Custodial Lockbox / IGP Fund</div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>CAMPUS LOCKERS (30 UNITS)</span>
            <Lock size={16} color="#e5c07b" />
          </div>
          <div className={styles.metricValue}>
            {metrics.occupiedLockers} / {metrics.totalLockers}
          </div>
          <div className={styles.metricSubtext}>
            {metrics.availableLockers} Available • ₱{(metrics.lockersPHP || 0).toFixed(2)} Collected
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>VENDING MACHINE PROFIT</span>
            <CupSoda size={16} color="#98c379" />
          </div>
          <div className={styles.metricValue}>₱{metrics.vendingPHP.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div className={styles.metricSubtext}>Physical cash box collections</div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>FUTURE IGP PROJECTS</span>
            <PlusCircle size={16} color="#61afef" />
          </div>
          <div className={styles.metricValue}>₱{metrics.customPHP.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div className={styles.metricSubtext}>Other student enterprise revenues</div>
        </div>
      </div>

      {/* Sub Navigation */}
      <div className={styles.actionNav}>
        <button
          type="button"
          className={`${styles.navButton} ${activeSubTab === 'lockers' ? styles.navButtonActive : ''}`}
          onClick={() => setActiveSubTab('lockers')}
        >
          <Lock size={16} /> Campus Lockers (30 Units)
        </button>
        <button
          type="button"
          className={`${styles.navButton} ${activeSubTab === 'vending' ? styles.navButtonActive : ''}`}
          onClick={() => setActiveSubTab('vending')}
        >
          <CupSoda size={16} /> Vending Machine Collections
        </button>
        <button
          type="button"
          className={`${styles.navButton} ${activeSubTab === 'future' ? styles.navButtonActive : ''}`}
          onClick={() => setActiveSubTab('future')}
        >
          <PlusCircle size={16} /> Record Future IGP Project
        </button>
        <button
          type="button"
          className={`${styles.navButton} ${activeSubTab === 'history' ? styles.navButtonActive : ''}`}
          onClick={() => setActiveSubTab('history')}
        >
          <History size={16} /> Collections Ledger History
        </button>
      </div>

      {/* Lockers Tab */}
      {activeSubTab === 'lockers' && (
        <div className={styles.contentCard}>
          <div className={styles.cardHeaderRow}>
            <div>
              <h3 className={styles.cardTitle}>
                <Lock size={18} color="#f7d070" /> Campus Locker Management System
              </h3>
              <p className={styles.cardDesc}>
                30 student locker units (₱100.00/month). Click any unit to rent, view lease records, or vacate.
              </p>
            </div>
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

          <div className={styles.lockersBankWrap}>
            {/* HM Building Bank */}
            <div className={styles.bankSection}>
              <div className={styles.bankHeader}>
                <span className={styles.bankTitle}>
                  <MapPin size={15} /> Hospitality Management (HM) Building — 15 Units
                </span>
                <span className={styles.cardDesc}>Ground Floor West Wing</span>
              </div>
              <div className={styles.lockersGrid}>
                {hmLockers.map((locker) => (
                  <div
                    key={locker.lockerId}
                    className={`${styles.lockerTile} ${
                      locker.status === LOCKER_STATUSES.OCCUPIED
                        ? styles.lockerTileOccupied
                        : locker.status === LOCKER_STATUSES.MAINTENANCE
                        ? styles.lockerTileMaintenance
                        : styles.lockerTileAvailable
                    }`}
                    onClick={() => {
                      if (locker.status === LOCKER_STATUSES.OCCUPIED) setDetailModalLocker(locker);
                      else setRentModalLocker(locker);
                    }}
                  >
                    <span className={styles.lockerNumber}>{locker.lockerId}</span>
                    <span
                      className={`${styles.lockerBadge} ${
                        locker.status === LOCKER_STATUSES.OCCUPIED
                          ? styles.badgeOccupied
                          : locker.status === LOCKER_STATUSES.MAINTENANCE
                          ? styles.badgeMaintenance
                          : styles.badgeAvailable
                      }`}
                    >
                      {locker.status}
                    </span>
                    <span className={styles.lockerRenterShort}>
                      {locker.currentLease?.renterName || '₱100/mo'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Education Building Bank */}
            <div className={styles.bankSection}>
              <div className={styles.bankHeader}>
                <span className={styles.bankTitle}>
                  <MapPin size={15} /> Education Building — 15 Units
                </span>
                <span className={styles.cardDesc}>Main Corridor Lockers</span>
              </div>
              <div className={styles.lockersGrid}>
                {edLockers.map((locker) => (
                  <div
                    key={locker.lockerId}
                    className={`${styles.lockerTile} ${
                      locker.status === LOCKER_STATUSES.OCCUPIED
                        ? styles.lockerTileOccupied
                        : locker.status === LOCKER_STATUSES.MAINTENANCE
                        ? styles.lockerTileMaintenance
                        : styles.lockerTileAvailable
                    }`}
                    onClick={() => {
                      if (locker.status === LOCKER_STATUSES.OCCUPIED) setDetailModalLocker(locker);
                      else setRentModalLocker(locker);
                    }}
                  >
                    <span className={styles.lockerNumber}>{locker.lockerId}</span>
                    <span
                      className={`${styles.lockerBadge} ${
                        locker.status === LOCKER_STATUSES.OCCUPIED
                          ? styles.badgeOccupied
                          : locker.status === LOCKER_STATUSES.MAINTENANCE
                          ? styles.badgeMaintenance
                          : styles.badgeAvailable
                      }`}
                    >
                      {locker.status}
                    </span>
                    <span className={styles.lockerRenterShort}>
                      {locker.currentLease?.renterName || '₱100/mo'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vending Machine Tab */}
      {activeSubTab === 'vending' && (
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
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => setVendingModalOpen(true)}
            >
              <PlusCircle size={15} /> Log Vendo Collection
            </button>
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
                    </tr>
                  ))}
                {collections.filter((c) => c.projectType === IGP_PROJECT_TYPES.VENDING_MACHINE).length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#9e8e8c' }}>
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
      {activeSubTab === 'future' && (
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
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => setCustomModalOpen(true)}
            >
              <PlusCircle size={15} /> Add Custom IGP Revenue
            </button>
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
                    </tr>
                  ))}
                {collections.filter((c) => c.projectType === IGP_PROJECT_TYPES.FUTURE_IGP).length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#9e8e8c' }}>
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
                {collections.map((c) => (
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
                <label className={styles.fieldLabel}>Rental Duration (Months) *</label>
                <select
                  className={styles.selectInput}
                  value={rentForm.months}
                  onChange={(e) => setRentForm({ ...rentForm, months: parseInt(e.target.value, 10) })}
                >
                  <option value={1}>1 Month — ₱100.00</option>
                  <option value={2}>2 Months — ₱200.00</option>
                  <option value={3}>3 Months — ₱300.00</option>
                  <option value={4}>4 Months — ₱400.00</option>
                  <option value={5}>5 Months (Semester) — ₱500.00</option>
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
                  Confirm Rental &amp; Collect ₱{rentForm.months * 100}.00
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Locker Detail / Vacate Modal */}
      {detailModalLocker && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalBox}>
            <div className={styles.cardHeaderRow}>
              <h4 className={styles.cardTitle}>
                <Lock size={18} color="#e06c75" /> Locker {detailModalLocker.lockerId} (Occupied)
              </h4>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setDetailModalLocker(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.9rem' }}>
              <div>
                <strong>Tenant:</strong> {detailModalLocker.currentLease?.renterName}
              </div>
              <div>
                <strong>Student ID:</strong> {detailModalLocker.currentLease?.studentId}
              </div>
              <div>
                <strong>Program:</strong> {detailModalLocker.currentLease?.program || '—'}
              </div>
              <div>
                <strong>Phone:</strong> {detailModalLocker.currentLease?.phoneNumber || '—'}
              </div>
              <div>
                <strong>Rental Start:</strong> {detailModalLocker.currentLease?.startDate}
              </div>
              <div>
                <strong>Lease Expiry:</strong>{' '}
                <span style={{ color: '#f7d070', fontWeight: 700 }}>
                  {new Date(detailModalLocker.currentLease?.expiryDate).toLocaleDateString()}
                </span>
              </div>
              <div>
                <strong>Recorded By:</strong> {detailModalLocker.currentLease?.recordedBy}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setDetailModalLocker(null)}
              >
                Close
              </button>
              <button
                type="button"
                style={{
                  background: '#7a1c22',
                  color: '#fff',
                  border: '1px solid #9e2a32',
                  padding: '0.55rem 1rem',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                onClick={() => handleReleaseLocker(detailModalLocker.lockerId)}
              >
                Vacate Locker (Return to Available)
              </button>
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
    </div>
  );
}

