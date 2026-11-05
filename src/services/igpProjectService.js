/**
 * igpProjectService.js
 * Headless business logic for Income-Generating Projects (IGP):
 * - Vending Machine Collections
 * - Campus Lockers (15 HM + 15 Education = 30 units at ₱100/mo)
 * - Extensible Future IGP Projects
 * Enforces integer centavos math, audit trail logging, and ledger updates.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  query,
  orderBy,
  runTransaction,
} from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig.js';
import { auditService } from './auditService.js';

export const IGP_PROJECT_TYPES = {
  VENDING_MACHINE: 'VENDING_MACHINE',
  LOCKER_RENTAL: 'LOCKER_RENTAL',
  FUTURE_IGP: 'FUTURE_IGP',
};

export const LOCKER_BUILDINGS = {
  HM: 'HM Building',
  EDUCATION: 'Education Building',
};

export const LOCKER_STATUSES = {
  AVAILABLE: 'AVAILABLE',
  OCCUPIED: 'OCCUPIED',
  MAINTENANCE: 'MAINTENANCE',
};

export const INITIAL_LOCKER_UNITS = [
  ...Array.from({ length: 15 }, (_, i) => ({
    lockerId: `HM-L${String(i + 1).padStart(2, '0')}`,
    unitNumber: i + 1,
    buildingName: LOCKER_BUILDINGS.HM,
    buildingId: 'bldg-hm',
    status: LOCKER_STATUSES.AVAILABLE,
    monthlyRatePHP: 100,
    currentLease: null,
    history: [],
  })),
  ...Array.from({ length: 15 }, (_, i) => ({
    lockerId: `ED-L${String(i + 1).padStart(2, '0')}`,
    unitNumber: i + 1,
    buildingName: LOCKER_BUILDINGS.EDUCATION,
    buildingId: 'bldg-educ',
    status: LOCKER_STATUSES.AVAILABLE,
    monthlyRatePHP: 100,
    currentLease: null,
    history: [],
  })),
];

function toCentavosSafe(amountPHP) {
  const num = typeof amountPHP === 'number' ? amountPHP : parseFloat(amountPHP);
  if (Number.isNaN(num) || num < 0) return 0;
  return Math.round(num * 100);
}

function calculateExpiryIso(startDateIso, months) {
  const d = startDateIso ? new Date(startDateIso) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  d.setMonth(d.getMonth() + Math.max(1, parseInt(months, 10) || 1));
  return d.toISOString();
}

export function formatCentavosToPHP(centavos) {
  const c = typeof centavos === 'number' ? centavos : parseInt(centavos, 10);
  if (Number.isNaN(c)) return '0.00';
  return (c / 100).toFixed(2);
}

function buildCollectorInfo(actorUser) {
  return {
    uid: actorUser?.uid || '',
    name: actorUser?.name || actorUser?.displayName || 'Authorized Officer',
    role: actorUser?.role || 'officer',
    email: actorUser?.email || '',
  };
}

function buildLocationInfo(loc) {
  return {
    buildingName: loc?.buildingName || 'Campus Venue',
    buildingId: loc?.buildingId || '',
    specificSpot: loc?.specificSpot || '',
  };
}


export function createIgpProjectService({ db }) {
  if (!db) throw new Error('Database adapter is required for igpProjectService.');

  return {
    async initializeLockerUnitsIfEmpty() {
      const existing = await db.listLockers();
      if (existing.length === 0) {
        for (const unit of INITIAL_LOCKER_UNITS) {
          await db.saveLocker(unit.lockerId, { ...unit, createdAt: new Date().toISOString() });
        }
      }
      return db.listLockers();
    },

    async listLockers() {
      return db.listLockers();
    },

    async listCollections() {
      return db.listCollections();
    },

    async getLocker(lockerId) {
      return db.getLocker(lockerId);
    },

    async recordVendingCollection(collectionData, actorUser) {
      const amountCentavos = toCentavosSafe(collectionData.amountPHP);
      if (amountCentavos <= 0) {
        throw new Error('Vending collection amount must be greater than zero.');
      }

      const nowIso = new Date().toISOString();
      const payload = {
        projectType: IGP_PROJECT_TYPES.VENDING_MACHINE,
        projectName: collectionData.projectName || 'Campus Vending Machine',
        location: buildLocationInfo(collectionData.location),
        amountCentavos,
        collectedBy: buildCollectorInfo(actorUser),
        collectedAt: collectionData.collectedAt || nowIso,
        notes: collectionData.notes || '',
        referenceNumber: collectionData.referenceNumber || '',
        fundSource: 'IGP',
        createdAt: nowIso,
      };

      const saved = await db.addCollection(payload);
      await db.updateIgpFundBalance(amountCentavos);

      if (typeof db.logAudit === 'function') {
        await db.logAudit({
          actionCode: 'IGP',
          projectType: IGP_PROJECT_TYPES.VENDING_MACHINE,
          module: 'Finance & IGP',
          performedBy: payload.collectedBy.name,
          itemName: `Vending Machine (${payload.location.buildingName})`,
          itemType: 'Vending Collection',
          amountPHP: payload.amountCentavos / 100,
          summary: `Collected ₱${formatCentavosToPHP(payload.amountCentavos)} from Vending Machine (${payload.location.buildingName} - ${payload.location.specificSpot})`,
        });
      }

      return saved;
    },

    async rentLockerUnit(lockerId, rentalData, actorUser) {
      const locker = await db.getLocker(lockerId);
      if (!locker) {
        const err = new Error(`Locker ${lockerId} not found.`);
        err.code = 'LOCKER_NOT_FOUND';
        throw err;
      }

      if (locker.status === LOCKER_STATUSES.OCCUPIED) {
        const err = new Error(
          `Locker ${lockerId} is already occupied by ${locker.currentLease?.renterName || 'another student'}.`
        );
        err.code = 'LOCKER_ALREADY_OCCUPIED';
        throw err;
      }

      const months = Math.max(1, parseInt(rentalData.months, 10) || 1);
      const ratePHP = locker.monthlyRatePHP || 100;
      const totalAmountPHP = months * ratePHP;
      const totalPaidCentavos = toCentavosSafe(totalAmountPHP);

      const nowIso = new Date().toISOString();
      const startDate = rentalData.startDate || nowIso.split('T')[0];
      const expiryDate = calculateExpiryIso(startDate, months);

      const lease = {
        renterName: rentalData.renterName || 'Student Renter',
        studentId: rentalData.studentId || '',
        program: rentalData.program || '',
        phoneNumber: rentalData.phoneNumber || '',
        monthlyRatePHP: ratePHP,
        monthsPaid: months,
        totalPaidCentavos,
        startDate,
        expiryDate,
        recordedBy: actorUser?.name || actorUser?.displayName || 'SSG Officer',
        recordedAt: nowIso,
      };

      const updatedLocker = {
        ...locker,
        status: LOCKER_STATUSES.OCCUPIED,
        currentLease: lease,
        updatedAt: nowIso,
      };

      await db.saveLocker(lockerId, updatedLocker);

      // Record financial collection
      await db.addCollection({
        projectType: IGP_PROJECT_TYPES.LOCKER_RENTAL,
        projectName: `Locker Rental: ${lockerId}`,
        lockerId,
        buildingName: locker.buildingName,
        buildingId: locker.buildingId,
        amountCentavos: totalPaidCentavos,
        collectedBy: buildCollectorInfo(actorUser),
        collectedAt: nowIso,
        notes: `Rented ${lockerId} to ${lease.renterName} (${lease.studentId}) for ${months} month(s)`,
        fundSource: 'IGP',
        createdAt: nowIso,
      });

      await db.updateIgpFundBalance(totalPaidCentavos);

      if (typeof db.logAudit === 'function') {
        await db.logAudit({
          actionCode: 'IGP',
          projectType: IGP_PROJECT_TYPES.LOCKER_RENTAL,
          module: 'Finance & IGP',
          performedBy: lease.recordedBy,
          itemName: `Campus Locker (${lockerId})`,
          itemType: 'Locker Rental',
          amountPHP: totalAmountPHP,
          summary: `Rented Locker ${lockerId} (${locker.buildingName}) to ${lease.renterName} for ₱${totalAmountPHP.toFixed(2)} (${months} mo.)`,
        });
      }

      return updatedLocker;
    },

    async releaseLockerUnit(lockerId, actorUser) {
      const locker = await db.getLocker(lockerId);
      if (!locker) {
        throw new Error(`Locker ${lockerId} not found.`);
      }

      const nowIso = new Date().toISOString();
      const prevHistory = Array.isArray(locker.history) ? [...locker.history] : [];
      if (locker.currentLease) {
        prevHistory.unshift({
          ...locker.currentLease,
          releasedAt: nowIso,
          releasedBy: actorUser?.name || actorUser?.displayName || 'Authorized Officer',
        });
      }

      const updated = {
        ...locker,
        status: LOCKER_STATUSES.AVAILABLE,
        currentLease: null,
        history: prevHistory.slice(0, 10),
        updatedAt: nowIso,
      };

      await db.saveLocker(lockerId, updated);

      if (typeof db.logAudit === 'function') {
        await db.logAudit({
          actionCode: 'IGP',
          projectType: IGP_PROJECT_TYPES.LOCKER_RENTAL,
          module: 'Finance & IGP',
          performedBy: actorUser?.name || actorUser?.displayName || 'Authorized Officer',
          itemName: `Campus Locker (${lockerId})`,
          itemType: 'Locker Vacated',
          summary: `Vacated Locker ${lockerId} (${locker.buildingName}) — unit returned to Available.`,
        });
      }

      return updated;
    },

    async recordCustomIgpRevenue(projectData, actorUser) {
      const amountCentavos = toCentavosSafe(projectData.amountPHP);
      if (amountCentavos <= 0) {
        throw new Error('Custom IGP project revenue amount must be greater than zero.');
      }

      const nowIso = new Date().toISOString();
      const payload = {
        projectType: IGP_PROJECT_TYPES.FUTURE_IGP,
        projectName: projectData.projectName || 'Future IGP Initiative',
        location: buildLocationInfo(projectData.location),
        amountCentavos,
        collectedBy: buildCollectorInfo(actorUser),
        collectedAt: projectData.collectedAt || nowIso,
        notes: projectData.notes || '',
        referenceNumber: projectData.referenceNumber || '',
        fundSource: 'IGP',
        createdAt: nowIso,
      };

      const saved = await db.addCollection(payload);
      await db.updateIgpFundBalance(amountCentavos);

      if (typeof db.logAudit === 'function') {
        await db.logAudit({
          actionCode: 'IGP',
          projectType: IGP_PROJECT_TYPES.FUTURE_IGP,
          module: 'Finance & IGP',
          performedBy: payload.collectedBy.name,
          itemName: payload.projectName,
          itemType: 'Future IGP Initiative',
          amountPHP: payload.amountCentavos / 100,
          summary: `Recorded ₱${formatCentavosToPHP(payload.amountCentavos)} for IGP project "${payload.projectName}"`,
        });
      }

      return saved;
    },

    async getIgpSummaryMetrics() {
      const collections = await db.listCollections();
      const lockers = await db.listLockers();

      let vendingCentavos = 0;
      let lockersCentavos = 0;
      let customIgpCentavos = 0;

      for (const col of collections) {
        if (col.projectType === IGP_PROJECT_TYPES.VENDING_MACHINE) {
          vendingCentavos += col.amountCentavos || 0;
        } else if (col.projectType === IGP_PROJECT_TYPES.LOCKER_RENTAL) {
          lockersCentavos += col.amountCentavos || 0;
        } else if (col.projectType === IGP_PROJECT_TYPES.FUTURE_IGP) {
          customIgpCentavos += col.amountCentavos || 0;
        }
      }

      const occupiedCount = lockers.filter((l) => l.status === LOCKER_STATUSES.OCCUPIED).length;
      const totalLockers = lockers.length;

      return {
        totalCollectionsCentavos: vendingCentavos + lockersCentavos + customIgpCentavos,
        totalCollectionsPHP: (vendingCentavos + lockersCentavos + customIgpCentavos) / 100,
        vendingCollectionsPHP: vendingCentavos / 100,
        lockersCollectionsPHP: lockersCentavos / 100,
        customIgpCollectionsPHP: customIgpCentavos / 100,
        occupiedLockers: occupiedCount,
        availableLockers: totalLockers - occupiedCount,
        totalLockers,
      };
    },
  };
}

/**
 * Creates browser Firestore-backed IGP Project Service instance
 */
export function createBrowserIgpProjectService() {
  // Dynamic import or direct references for browser Firestore environment
  const browserDb = {
    async getLocker(id) {
      const snap = await getDoc(doc(db, 'lockers', id));
      return snap.exists() ? snap.data() : null;
    },
    async listLockers() {
      const snap = await getDocs(collection(db, 'lockers'));
      return snap.docs.map((d) => d.data());
    },
    async saveLocker(id, data) {
      await setDoc(doc(db, 'lockers', id), data, { merge: true });
      return data;
    },
    async addCollection(data) {
      const ref = await addDoc(collection(db, 'igpCollections'), data);
      return { id: ref.id, ...data };
    },
    async listCollections() {
      const snap = await getDocs(query(collection(db, 'igpCollections'), orderBy('createdAt', 'desc')));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async getIgpFund() {
      const snap = await getDoc(doc(db, 'fundAccounts', 'fund_igp_main'));
      return snap.exists() ? snap.data() : null;
    },
    async updateIgpFundBalance(deltaCentavos) {
      const fundRef = doc(db, 'fundAccounts', 'fund_igp_main');
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(fundRef);
        const currentBal = snap.exists() ? snap.data().balanceCentavos || 0 : 0;
        const newBal = currentBal + deltaCentavos;
        tx.set(
          fundRef,
          {
            balanceCentavos: newBal,
            topLevelCategory: 'IGP',
            displayName: 'Income-Generating Projects (IGP)',
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        return { balanceCentavos: newBal };
      });
    },
    async logAudit(entry) {
      if (auditService && typeof auditService.log === 'function') {
        await auditService.log(entry);
      }
    },
  };

  return createIgpProjectService({ db: browserDb });
}
