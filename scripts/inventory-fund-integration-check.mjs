/**
 * scripts/inventory-fund-integration-check.mjs
 * TDD Suite for Inventory Procurement & Fund Source Integration (IGF vs IGP)
 * Seams under test:
 * 1. Inventory Fund Validation & Predicates (src/utils/fundClassifier.js & inventoryService)
 * 2. Inventory Procurement & Ledger Debiting (deducts from fund_igf_main or fund_igp_main)
 * 3. Atomic Loan Requisition Check-out & Return (quantity & borrowedCount transactions)
 */

import {
  FUND_DOMAINS,
  isBudgetIGF,
  isBudgetIGP,
  classifyBudgetFund,
} from '../src/utils/fundClassifier.js';
import {
  createInventoryService,
  INVENTORY_FUND_SOURCES,
} from '../src/services/inventoryService.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) {
    results.push(`ok   ${label}`);
  } else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
  }
};

function createFakeDb() {
  const store = {
    inventory: new Map(),
    borrowingLogs: new Map(),
    fundAccounts: new Map([
      ['fund_igf_main', { id: 'fund_igf_main', balanceCentavos: 5000000, displayName: 'IGF' }], // ₱50,000.00
      ['fund_igp_main', { id: 'fund_igp_main', balanceCentavos: 1000000, displayName: 'IGP' }], // ₱10,000.00
    ]),
    financeTransactions: new Map(),
    auditLogs: [],
  };

  return {
    store,
    async getDoc(collectionName, id) {
      return store[collectionName]?.get(id) || null;
    },
    async setDoc(collectionName, id, data) {
      if (!store[collectionName]) store[collectionName] = new Map();
      store[collectionName].set(id, { id, ...data });
      return store[collectionName].get(id);
    },
    async addDoc(collectionName, data) {
      if (!store[collectionName]) store[collectionName] = new Map();
      const id = `${collectionName}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      store[collectionName].set(id, { id, ...data });
      return { id, ...data };
    },
    async updateDoc(collectionName, id, data) {
      const existing = store[collectionName]?.get(id);
      if (!existing) throw new Error(`Document ${id} not found in ${collectionName}`);
      const updated = { ...existing, ...data };
      store[collectionName].set(id, updated);
      return updated;
    },
    async runTransaction(txCallback) {
      const tx = {
        get: async (collectionName, id) => store[collectionName]?.get(id) || null,
        set: async (collectionName, id, data) => {
          if (!store[collectionName]) store[collectionName] = new Map();
          store[collectionName].set(id, { id, ...data });
        },
        update: async (collectionName, id, data) => {
          const item = store[collectionName]?.get(id);
          if (!item) throw new Error(`Transaction item ${id} not found in ${collectionName}`);
          store[collectionName].set(id, { ...item, ...data });
        },
        add: async (collectionName, data) => {
          if (!store[collectionName]) store[collectionName] = new Map();
          const id = `${collectionName}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          store[collectionName].set(id, { id, ...data });
          return id;
        }
      };
      return await txCallback(tx);
    }
  };
}

async function run() {
  console.log('=== Running Inventory Fund Source & TDD Test Suite ===\n');

  // Test 1: Fund Source Definition Constants
  check(
    'INVENTORY_FUND_SOURCES defines IGF and IGP constants',
    INVENTORY_FUND_SOURCES.IGF === 'IGF' && INVENTORY_FUND_SOURCES.IGP === 'IGP'
  );

  const fakeDb = createFakeDb();
  const service = createInventoryService({ db: fakeDb });

  // Test 2: Validation of fund source during item registration
  let invalidFundThrew = false;
  try {
    await service.addInventoryItem({
      name: 'Test Item',
      category: 'Office Supplies',
      quantity: 5,
      amount: 100,
      fundSource: 'GENERAL_FUND', // Invalid! Must be IGF or IGP
    });
  } catch (err) {
    invalidFundThrew = true;
    check('Reject invalid fundSource not in [IGF, IGP]', true);
  }
  if (!invalidFundThrew) {
    check('Reject invalid fundSource not in [IGF, IGP]', false, 'Expected exception for invalid fund source');
  }

  // Test 3: Insufficient Fund Rejection
  let insufficientFundThrew = false;
  try {
    await service.addInventoryItem({
      name: 'Expensive Heavy Machinery',
      category: 'Equipment',
      quantity: 10,
      amount: 2000, // Total = ₱20,000.00 (2,000,000 centavos) > ₱10,000.00 IGP balance
      fundSource: 'IGP',
      storageLocation: 'SSG Warehouse',
    });
  } catch (err) {
    insufficientFundThrew = true;
    check('Reject item procurement if total cost exceeds fund balance', true);
  }
  if (!insufficientFundThrew) {
    check('Reject item procurement if total cost exceeds fund balance', false, 'Expected insufficient funds error');
  }

  // Test 4: Successful Procurement with IGF Debiting & Ledger Recording
  const igfItem = await service.addInventoryItem({
    name: 'A4 Printing Paper Boxes',
    category: 'Office Supplies',
    quantity: 10,
    amount: 250, // Total = ₱2,500.00 (250,000 centavos)
    fundSource: 'IGF',
    storageLocation: 'Cabinet A',
    lastUpdatedBy: 'Finance Officer',
  });

  check('Registered inventory item has fundSource IGF', igfItem.fundSource === 'IGF');
  check('Registered inventory item initializes borrowedCount to 0', igfItem.borrowedCount === 0);
  check('Total quantity is saved correctly', igfItem.quantity === 10);

  // Verify fund account balance updated in store
  const igfAccount = fakeDb.store.fundAccounts.get('fund_igf_main');
  check(
    'IGF Fund Account decremented by ₱2,500.00 (250,000 centavos)',
    igfAccount.balanceCentavos === 5000000 - 250000
  );

  // Verify expense ledger transaction created
  const transactions = Array.from(fakeDb.store.financeTransactions.values());
  const igfTx = transactions.find((t) => t.fundAccountId === 'fund_igf_main');
  check(
    'Finance expense transaction created for IGF procurement',
    Boolean(igfTx) && igfTx.amountCentavos === 250000 && igfTx.fundCategory === 'IGF'
  );

  // Test 5: Successful Procurement with IGP Debiting & Ledger Recording
  const igpItem = await service.addInventoryItem({
    name: 'Heavy Duty Locker Padlocks',
    category: 'Equipment',
    quantity: 20,
    amount: 150, // Total = ₱3,000.00 (300,000 centavos)
    fundSource: 'IGP',
    storageLocation: 'Locker Control Box',
    lastUpdatedBy: 'Project Officer',
  });

  check('Registered inventory item has fundSource IGP', igpItem.fundSource === 'IGP');
  const igpAccount = fakeDb.store.fundAccounts.get('fund_igp_main');
  check(
    'IGP Fund Account decremented by ₱3,000.00 (300,000 centavos)',
    igpAccount.balanceCentavos === 1000000 - 300000
  );

  // Test 6: Atomic Borrow Check-out (borrowedCount increments, available stock managed)
  const borrowRecord = await service.borrowItem({
    itemId: igfItem.id,
    quantityBorrowed: 3,
    borrowerName: 'Maria Santos',
    borrowerEmail: 'maria@example.com',
    purpose: 'SSG Assembly Printing',
    processedBy: 'Custodian Officer',
  });

  const itemAfterBorrow = fakeDb.store.inventory.get(igfItem.id);
  check('Borrow log created with status "borrowed"', borrowRecord.status === 'borrowed' && !borrowRecord.returned);
  check('Physical quantity decremented correctly on borrow', itemAfterBorrow.quantity === 7);
  check('borrowedCount incremented atomically on borrow', itemAfterBorrow.borrowedCount === 3);

  // Test 7: Atomic Return Check-in (borrowedCount decrements, physical stock restored, audit logged)
  await service.returnItem(borrowRecord.id, {
    condition: 'excellent',
    notes: 'Returned all 3 packs undamaged',
    processedBy: 'Custodian Officer',
  });

  const itemAfterReturn = fakeDb.store.inventory.get(igfItem.id);
  const logAfterReturn = fakeDb.store.borrowingLogs.get(borrowRecord.id);
  check('Return updates log status to "returned"', logAfterReturn.returned === true && logAfterReturn.status === 'returned');
  check('Physical quantity restored to 10 on return', itemAfterReturn.quantity === 10);
  check('borrowedCount decremented back to 0 on return', itemAfterReturn.borrowedCount === 0);

  // Test 8: Get Available Balance Helper
  const igfBal = await service.getFundBalance('IGF');
  const igpBal = await service.getFundBalance('IGP');
  check('getFundBalance(IGF) returns balance in PHP', igfBal === 47500); // ₱47,500.00
  check('getFundBalance(IGP) returns balance in PHP', igpBal === 7000);  // ₱7,000.00

  console.log('\n--- Test Results ---');
  results.forEach((r) => console.log(r));

  if (failed > 0) {
    console.error(`\nFAILED: ${failed} checks failed.`);
    process.exit(1);
  } else {
    console.log(`\nSUCCESS: All ${results.length} checks passed cleanly!`);
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

