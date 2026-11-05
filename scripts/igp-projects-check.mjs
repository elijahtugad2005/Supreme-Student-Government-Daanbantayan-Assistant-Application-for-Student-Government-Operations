/**
 * scripts/igp-projects-check.mjs
 * Vertical-Slice TDD Test Suite for Income-Generating Projects (IGP)
 * Seam: createIgpProjectService
 */
import {
  createIgpProjectService,
  INITIAL_LOCKER_UNITS,
  LOCKER_BUILDINGS,
  LOCKER_STATUSES,
  IGP_PROJECT_TYPES,
} from '../src/services/igpProjectService.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
  }
};

function createFakeEnvironment() {
  const store = {
    collections: new Map(),
    lockers: new Map(),
    fundAccounts: new Map([
      [
        'fund_igp_main',
        {
          id: 'fund_igp_main',
          topLevelCategory: 'IGP',
          displayName: 'Income-Generating Projects (IGP)',
          balanceCentavos: 0,
        },
      ],
    ]),
    auditLogs: [],
  };

  const db = {
    async getLocker(id) {
      return store.lockers.get(id) || null;
    },
    async listLockers() {
      return Array.from(store.lockers.values());
    },
    async saveLocker(id, data) {
      store.lockers.set(id, { id, ...data });
      return store.lockers.get(id);
    },
    async addCollection(data) {
      const id = `IGP-COL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      store.collections.set(id, { id, ...data });
      return store.collections.get(id);
    },
    async deleteCollection(id) {
      return store.collections.delete(id);
    },
    async getCollection(id) {
      return store.collections.get(id) || null;
    },
    async listCollections() {
      return Array.from(store.collections.values());
    },
    async getIgpFund() {
      return store.fundAccounts.get('fund_igp_main');
    },
    async updateIgpFundBalance(deltaCentavos) {
      const fund = store.fundAccounts.get('fund_igp_main');
      fund.balanceCentavos = (fund.balanceCentavos || 0) + deltaCentavos;
      return fund;
    },
    async logAudit(entry) {
      store.auditLogs.push({ ...entry, timestamp: new Date().toISOString() });
    },
  };

  return { store, db };
}

console.log('=== Slice 1: Vending Machine Collection Recording (Location, Collector, Centavos & Ledger) ===');
{
  const { store, db } = createFakeEnvironment();
  const service = createIgpProjectService({ db });

  const actor = {
    uid: 'officer-1',
    name: 'Jane Doe',
    role: 'finance_officer',
    email: 'jane.doe@ctu.edu.ph',
  };

  const record = await service.recordVendingCollection(
    {
      amountPHP: 750.5,
      location: {
        buildingName: 'Student Center',
        buildingId: 'bldg-student-center',
        specificSpot: 'Ground floor near cafeteria',
      },
      collectedAt: '2026-11-04T10:00:00.000Z',
      notes: 'Weekly cash box emptying',
      referenceNumber: 'VND-BOX-01',
    },
    actor
  );

  const fund = await db.getIgpFund();

  check(
    'records vending collection in integer centavos (₱750.50 -> 75050 centavos)',
    record.amountCentavos === 75050,
    JSON.stringify(record)
  );

  check(
    'stores who collected, where collected, and when collected',
    record.collectedBy.uid === 'officer-1' &&
      record.location.buildingName === 'Student Center' &&
      record.location.buildingId === 'bldg-student-center' &&
      record.collectedAt === '2026-11-04T10:00:00.000Z',
    JSON.stringify(record)
  );

  check(
    'credits the IGP Fund balance in centavos',
    fund.balanceCentavos === 75050,
    `Fund balance: ${fund.balanceCentavos}`
  );

  check(
    'logs institutional audit entry for vending collection',
    store.auditLogs.length === 1 &&
      store.auditLogs[0].actionCode === 'IGP' &&
      store.auditLogs[0].projectType === 'VENDING_MACHINE',
    JSON.stringify(store.auditLogs[0])
  );
}

console.log('\n=== Slice 2: Campus Lockers Initialization (Exactly 30 Units: 15 HM + 15 Education) ===');
{
  const { store, db } = createFakeEnvironment();
  const service = createIgpProjectService({ db });

  await service.initializeLockerUnitsIfEmpty();
  const lockers = await service.listLockers();

  const hmLockers = lockers.filter((l) => l.buildingName === LOCKER_BUILDINGS.HM);
  const edLockers = lockers.filter((l) => l.buildingName === LOCKER_BUILDINGS.EDUCATION);

  check('initializes exactly 30 total locker units', lockers.length === 30, `Total: ${lockers.length}`);

  check(
    'allocates 15 units in HM Building (HM-L01 to HM-L15) and 15 in Education (ED-L01 to ED-L15)',
    hmLockers.length === 15 &&
      edLockers.length === 15 &&
      hmLockers[0].lockerId === 'HM-L01' &&
      hmLockers[14].lockerId === 'HM-L15' &&
      edLockers[0].lockerId === 'ED-L01' &&
      edLockers[14].lockerId === 'ED-L15',
    JSON.stringify({ hm: hmLockers.length, ed: edLockers.length })
  );

  check(
    'all units initialized in AVAILABLE status with ₱100/mo base rate and null lease',
    lockers.every(
      (l) => l.status === LOCKER_STATUSES.AVAILABLE && l.monthlyRatePHP === 100 && l.currentLease === null
    ),
    'Failed default status check'
  );
}

console.log('\n=== Slice 3: Monthly Locker Rental Transaction (₱100/mo, Tenant Info & Fund Credit) ===');
{
  const { store, db } = createFakeEnvironment();
  const service = createIgpProjectService({ db });
  await service.initializeLockerUnitsIfEmpty();

  const actor = { uid: 'sec-1', name: 'Mark Ramos', role: 'secretary', email: 'mark@ctu.edu.ph' };

  const rentalResult = await service.rentLockerUnit(
    'HM-L04',
    {
      renterName: 'Juan Dela Cruz',
      studentId: '1334455',
      program: 'BSHM 2-A',
      phoneNumber: '09171234567',
      months: 2, // 2 months = ₱200
      startDate: '2026-11-01',
    },
    actor
  );

  const updatedLocker = await service.getLocker('HM-L04');
  const fund = await db.getIgpFund();

  check(
    'transitions locker status to OCCUPIED and records tenant lease details',
    updatedLocker.status === LOCKER_STATUSES.OCCUPIED &&
      updatedLocker.currentLease.renterName === 'Juan Dela Cruz' &&
      updatedLocker.currentLease.studentId === '1334455' &&
      updatedLocker.currentLease.monthsPaid === 2 &&
      updatedLocker.currentLease.totalPaidCentavos === 20000,
    JSON.stringify(updatedLocker.currentLease)
  );

  check(
    'credits 2 months rental (₱200.00 / 20000 centavos) to IGP Fund',
    fund.balanceCentavos === 20000,
    `Fund balance: ${fund.balanceCentavos}`
  );

  check(
    'calculates expiryDate accurately based on months paid (2026-11-01 + 2 months -> 2027-01-01)',
    updatedLocker.currentLease.expiryDate.startsWith('2027-01-01'),
    `Expiry date: ${updatedLocker.currentLease?.expiryDate}`
  );
}

console.log('\n=== Slice 4: Guard Duplicate Rental of Already Occupied Locker ===');
{
  const { db } = createFakeEnvironment();
  const service = createIgpProjectService({ db });
  await service.initializeLockerUnitsIfEmpty();

  const actor = { uid: 'sec-1', name: 'Mark Ramos', role: 'secretary' };

  await service.rentLockerUnit(
    'ED-L02',
    {
      renterName: 'First Student',
      studentId: '1000001',
      program: 'BSED',
      months: 1,
    },
    actor
  );

  let collisionErr = null;
  try {
    await service.rentLockerUnit(
      'ED-L02',
      {
        renterName: 'Second Student',
        studentId: '1000002',
        program: 'BSED',
        months: 1,
      },
      actor
    );
  } catch (err) {
    collisionErr = err;
  }

  check(
    'throws LOCKER_ALREADY_OCCUPIED when attempting to rent an occupied unit',
    collisionErr !== null && collisionErr.code === 'LOCKER_ALREADY_OCCUPIED',
    JSON.stringify({ code: collisionErr?.code, message: collisionErr?.message })
  );
}

console.log('\n=== Slice 5: Release / Vacate Locker Unit ===');
{
  const { db } = createFakeEnvironment();
  const service = createIgpProjectService({ db });
  await service.initializeLockerUnitsIfEmpty();

  const actor = { uid: 'sec-1', name: 'Mark Ramos', role: 'secretary' };

  await service.rentLockerUnit(
    'HM-L01',
    {
      renterName: 'Student Alpha',
      studentId: '1234567',
      months: 1,
    },
    actor
  );

  const released = await service.releaseLockerUnit('HM-L01', actor);

  check(
    'returns unit to AVAILABLE and archives previous lease in locker history',
    released.status === LOCKER_STATUSES.AVAILABLE &&
      released.currentLease === null &&
      released.history?.length === 1 &&
      released.history[0].renterName === 'Student Alpha',
    JSON.stringify(released)
  );
}

console.log('\n=== Slice 6: Record Future Custom IGP Project Revenue ===');
{
  const { store, db } = createFakeEnvironment();
  const service = createIgpProjectService({ db });

  const actor = { uid: 'admin-1', name: 'Pres. Cruz', role: 'president', email: 'pres@ctu.edu.ph' };

  const customRecord = await service.recordCustomIgpRevenue(
    {
      projectName: 'Campus Printing & Photocopier Kiosk',
      amountPHP: 1250,
      location: {
        buildingName: 'Administration Building',
        buildingId: 'bldg-admin',
        specificSpot: 'SSG Office Counter',
      },
      collectedAt: '2026-11-04T14:00:00.000Z',
      notes: 'Day 1 printing revenue',
      referenceNumber: 'PRN-001',
    },
    actor
  );

  const fund = await db.getIgpFund();

  check(
    'records custom future IGP revenue with custom project name and attributes',
    customRecord.projectType === IGP_PROJECT_TYPES.FUTURE_IGP &&
      customRecord.projectName === 'Campus Printing & Photocopier Kiosk' &&
      customRecord.amountCentavos === 125000 &&
      fund.balanceCentavos === 125000,
    JSON.stringify(customRecord)
  );
}

console.log('\n=== Slice 7: Standards Checks (No float leak in storage, listCollections on service) ===');
{
  const { store, db } = createFakeEnvironment();
  const service = createIgpProjectService({ db });

  const actor = { uid: 'u1', name: 'Officer Test', role: 'officer' };
  const col = await service.recordVendingCollection(
    {
      amountPHP: 150.25,
      location: { buildingName: 'Cafeteria', buildingId: 'bldg-caf', specificSpot: 'Entrance' },
    },
    actor
  );

  const collections = await service.listCollections();

  check(
    'listCollections is exposed on the service instance and returns array',
    Array.isArray(collections) && collections.length === 1,
    JSON.stringify(collections)
  );

  check(
    'stored collection preserves integer centavos without floating precision leaks',
    col.amountCentavos === 15025 && typeof col.amountCentavos === 'number',
    JSON.stringify(col)
  );

  const metrics = await service.getIgpSummaryMetrics();
  check(
    'metrics return totalCollectionsCentavos strictly in centavos integer',
    metrics.totalCollectionsCentavos === 15025 && Number.isInteger(metrics.totalCollectionsCentavos),
    JSON.stringify(metrics)
  );
}

console.log('\n=== Slice 8: Currency Normalization Guarantee (Fix for Cannot read properties of undefined reading toFixed) ===');
{
  const { store, db } = createFakeEnvironment();
  const service = createIgpProjectService({ db });

  // Add raw collection simulating Firestore storage where only amountCentavos is stored
  store.collections.set('raw-col-1', {
    id: 'raw-col-1',
    projectType: IGP_PROJECT_TYPES.VENDING_MACHINE,
    amountCentavos: 25050, // ₱250.50
    // Notice amountPHP is omitted, exactly as stored in Firestore!
  });

  // Add another collection simulating locker rental collection
  store.collections.set('raw-col-2', {
    id: 'raw-col-2',
    projectType: IGP_PROJECT_TYPES.LOCKER_RENTAL,
    amountCentavos: 10000, // ₱100.00
  });

  const list = await service.listCollections();
  check('listCollections returns all items', list.length === 2);
  check(
    'listCollections guarantees amountPHP is defined number on raw Firestore collection',
    typeof list[0].amountPHP === 'number' && !isNaN(list[0].amountPHP),
    `Got: ${list[0]?.amountPHP}`
  );
  check(
    'listCollections accurately converts amountCentavos to amountPHP',
    list[0].amountPHP === 250.5 && typeof list[0].amountPHP.toFixed === 'function' && list[0].amountPHP.toFixed(2) === '250.50',
    `Got: ${list[0]?.amountPHP}`
  );
}

console.log('\n=== Slice 9: Officer Name in Input Forms & fromCentavos Regression Prevention ===');
{
  const { store, db } = createFakeEnvironment();
  const service = createIgpProjectService({ db });

  // 1. Explicit officerName in vending collection
  const vRec = await service.recordVendingCollection(
    {
      amountPHP: 500,
      location: { buildingName: 'Student Center', buildingId: 'bldg-sc', specificSpot: 'Hallway' },
      officerName: 'Sarah Connor (Secretary of Audit)',
    },
    { uid: 'u-default', name: 'Default User', role: 'admin' }
  );

  check(
    'recordVendingCollection respects explicit officerName input',
    vRec.collectedBy.name === 'Sarah Connor (Secretary of Audit)',
    JSON.stringify(vRec.collectedBy)
  );

  // 2. Explicit officerName in custom IGP revenue
  const cRec = await service.recordCustomIgpRevenue(
    {
      projectName: 'T-Shirt Merch Batch 1',
      amountPHP: 1200,
      location: { buildingName: 'Admin Building' },
      officerName: 'John Doe (Finance Secretary)',
    },
    { uid: 'u-default', name: 'Default User', role: 'admin' }
  );

  check(
    'recordCustomIgpRevenue respects explicit officerName input',
    cRec.collectedBy.name === 'John Doe (Finance Secretary)',
    JSON.stringify(cRec.collectedBy)
  );

  // 3. Explicit officerName in locker rental
  await service.initializeLockerUnitsIfEmpty();
  const lRec = await service.rentLockerUnit(
    'HM-L01',
    {
      renterName: 'Alice Student',
      studentId: 'CTU-2026-001',
      months: 1,
      officerName: 'Marcus Wright (Budget Secretary)',
    },
    { uid: 'u-default', name: 'Default User', role: 'admin' }
  );

  check(
    'rentLockerUnit respects explicit officerName input in recordedBy',
    lRec.currentLease.recordedBy === 'Marcus Wright (Budget Secretary)',
    JSON.stringify(lRec.currentLease)
  );
}

console.log('\n=== Slice 10: Vending Machine Collection Deletion & Fund Reversal (Misinput Handling) ===');
{
  const { store, db } = createFakeEnvironment();
  const service = createIgpProjectService({ db });

  const actor = { uid: 'u-auditor', name: 'Marcus Auditor', role: 'auditor' };

  // 1. Record a collection of ₱500.00
  const col = await service.recordVendingCollection(
    {
      amountPHP: 500,
      location: { buildingName: 'Student Center', buildingId: 'bldg-sc', specificSpot: 'Hallway' },
      officerName: 'Marcus Auditor',
    },
    actor
  );

  let fund = await db.getIgpFund();
  check('Initial collection credits IGP fund by 50000 centavos', fund.balanceCentavos === 50000);

  // 2. Delete the misinput collection
  const delResult = await service.deleteVendingCollection(col.id, 'Misinput: duplicate cash count', actor);
  check('deleteVendingCollection returns success', delResult?.success === true && delResult?.deletedId === col.id);

  // 3. Fund balance should be reversed by 50000 centavos (back to 0)
  fund = await db.getIgpFund();
  check('deleteVendingCollection reverses the fund balance back to 0', fund.balanceCentavos === 0, `Got: ${fund.balanceCentavos}`);

  // 4. Collection should be gone from listCollections()
  const remaining = await service.listCollections();
  check('Collection is removed from listCollections()', remaining.some(c => c.id === col.id) === false);

  // 5. Audit log entry recorded
  const lastAudit = store.auditLogs[store.auditLogs.length - 1];
  check(
    'Audit trail records the collection deletion and reversal',
    lastAudit && lastAudit.itemType?.includes('Deletion') && lastAudit.summary?.includes('duplicate cash count'),
    JSON.stringify(lastAudit)
  );

  // 6. Deleting non-existent collection throws error
  let missingError = null;
  try {
    await service.deleteVendingCollection('non-existent-id', 'test', actor);
  } catch (err) {
    missingError = err.message;
  }
  check('Deleting non-existent collection throws error', missingError !== null, missingError);
}

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nAll IGP Project checks passed.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);

