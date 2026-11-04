/**
 * Vertical-Slice TDD Suite for Centralized Google Sheets Order Sync Orchestrator.
 * Seam: createCentralizedOrderSheetOrchestrator (pre-agreed in CENTRALIZED_GOOGLE_SHEETS_ORDER_SYNC_SPEC.md)
 *
 *   node scripts/centralized-order-sheet-check.mjs
 */
import {
  createCentralizedOrderSheetOrchestrator,
  canManageCentralizedOrderSheet,
  extractSpreadsheetId,
  detectOrderSheetColumnMappings,
  COMMERCE_HUB_ORDER_TEMPLATE_COLUMNS,
} from '../src/components/Data/centralizedOrderSheetOrchestrator.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
  }
};

function createFakeEnvironment({ initialSettings = null, initialOrders = [] } = {}) {
  let settingsDoc = initialSettings ? structuredClone(initialSettings) : null;
  const orders = initialOrders.map((o) => structuredClone(o));
  const auditEntries = [];
  const sheetsStore = new Map();

  const settingsRepo = {
    get: async () => (settingsDoc ? structuredClone(settingsDoc) : null),
    save: async (nextDoc) => {
      settingsDoc = structuredClone(nextDoc);
      return structuredClone(settingsDoc);
    },
  };

  const ordersRepo = {
    listAll: async () => orders.map((o) => structuredClone(o)),
    upsertBatch: async (items) => {
      let created = 0;
      let updated = 0;
      for (const item of items) {
        const idx = orders.findIndex((o) => o.orderId === item.orderId);
        if (idx >= 0) {
          orders[idx] = { ...orders[idx], ...structuredClone(item) };
          updated += 1;
        } else {
          orders.push({ docId: `doc-${orders.length + 1}`, ...structuredClone(item) });
          created += 1;
        }
      }
      return { created, updated };
    },
  };

  const auditLogger = {
    log: async (entry) => {
      auditEntries.push(entry);
    },
  };

  const sheetsGateway = {
    createSpreadsheet: async ({ title, headers, rows = [], validations = {} }) => {
      const spreadsheetId = `sheet-${sheetsStore.size + 1}`;
      const sheetTitle = 'Commerce Hub Orders';
      sheetsStore.set(spreadsheetId, {
        spreadsheetId,
        spreadsheetTitle: title,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        tabs: [
          {
            sheetId: 0,
            sheetTitle,
            headers: [...headers],
            rows: rows.map((r) => [...r]),
            validations: structuredClone(validations),
          },
        ],
      });
      return structuredClone(sheetsStore.get(spreadsheetId));
    },
    getSpreadsheetMetadata: async (spreadsheetId) => {
      const found = sheetsStore.get(spreadsheetId);
      if (!found) {
        const err = new Error('Spreadsheet not found');
        err.status = 404;
        throw err;
      }
      return {
        spreadsheetId: found.spreadsheetId,
        spreadsheetTitle: found.spreadsheetTitle,
        spreadsheetUrl: found.spreadsheetUrl,
        tabs: found.tabs.map((t) => ({ sheetId: t.sheetId, sheetTitle: t.sheetTitle })),
      };
    },
    readTabValues: async (spreadsheetId, sheetTitle) => {
      const found = sheetsStore.get(spreadsheetId);
      const tab = found?.tabs.find((t) => t.sheetTitle === sheetTitle);
      if (!tab) throw new Error(`Tab "${sheetTitle}" not found`);
      return {
        headers: [...tab.headers],
        rows: tab.rows.map((r) => [...r]),
      };
    },
    initializeTemplateOnTab: async ({ spreadsheetId, sheetId, sheetTitle, headers, validations }) => {
      const found = sheetsStore.get(spreadsheetId);
      const tab = found?.tabs.find((t) => t.sheetTitle === sheetTitle || t.sheetId === sheetId);
      if (!tab) throw new Error(`Tab "${sheetTitle}" not found`);
      tab.headers = [...headers];
      tab.validations = structuredClone(validations);
      return structuredClone(tab);
    },
    writeTabUpdates: async ({ spreadsheetId, sheetTitle, rowUpdates = [], appendRows = [] }) => {
      const found = sheetsStore.get(spreadsheetId);
      const tab = found?.tabs.find((t) => t.sheetTitle === sheetTitle);
      if (!tab) throw new Error(`Tab "${sheetTitle}" not found`);
      for (const { rowIndex, values } of rowUpdates) {
        tab.rows[rowIndex] = [...values];
      }
      for (const rowValues of appendRows) {
        tab.rows.push([...rowValues]);
      }
      return { updatedRows: rowUpdates.length, appendedRows: appendRows.length };
    },
  };

  return {
    settingsRepo,
    ordersRepo,
    auditLogger,
    sheetsGateway,
    sheetsStore,
    auditEntries,
    getSettingsState: () => settingsDoc,
    getOrdersState: () => orders,
  };
}

console.log('=== Slice 1: Secretariat-Only Authorization & View-Only Officer Access ===');
{
  const secretariatAndAdminRoles = [
    'secretary',
    'executive_secretary',
    'deputy_secretary',
    'press_secretary',
    'linkages_secretary',
    'finance_secretary',
    'admin',
  ];

  const viewOnlyOrRestrictedRoles = [
    'president',
    'vice_president',
    'auditor',
    'budget_officer',
    'senator',
    'representative',
    'governor',
    'creatives',
    'member',
    'guest',
  ];

  check(
    'grants management authority to all 6 Secretariat roles plus admin',
    secretariatAndAdminRoles.every((role) => canManageCentralizedOrderSheet({ role }) === true),
    secretariatAndAdminRoles
      .map((r) => `${r}:${canManageCentralizedOrderSheet({ role: r })}`)
      .join(', ')
  );

  check(
    'denies management authority to President, VP, Senators, Representatives, Finance non-secretaries, Members, and Guests',
    viewOnlyOrRestrictedRoles.every((role) => canManageCentralizedOrderSheet({ role }) === false) &&
      canManageCentralizedOrderSheet(null) === false,
    viewOnlyOrRestrictedRoles
      .map((r) => `${r}:${canManageCentralizedOrderSheet({ role: r })}`)
      .join(', ')
  );

  const env = createFakeEnvironment({
    initialSettings: {
      spreadsheetId: 'central-sheet-101',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/central-sheet-101/edit',
      spreadsheetTitle: 'SSG Official Orders AY 2026-2027',
      sheetTitle: 'Commerce Hub Orders',
      assignedByName: 'Maria Santos',
      assignedByEmail: 'maria.sec@ctu.edu.ph',
      lastSyncedAt: '2026-11-04T03:00:00.000Z',
    },
  });

  const presidentOrchestrator = createCentralizedOrderSheetOrchestrator({
    actorUser: { uid: 'pres-1', role: 'president', name: 'SSG President', email: 'pres@ctu.edu.ph' },
    ...env,
  });

  const viewState = await presidentOrchestrator.getCentralizedSheetView();
  check(
    'President receives read-only centralized sheet link, owner info, and lastSyncedAt with canManage=false',
    viewState.canManage === false &&
      viewState.sheet?.spreadsheetId === 'central-sheet-101' &&
      viewState.sheet?.assignedByName === 'Maria Santos' &&
      viewState.sheet?.lastSyncedAt === '2026-11-04T03:00:00.000Z',
    JSON.stringify(viewState)
  );

  let rejectedErr = null;
  try {
    await presidentOrchestrator.createTemplateSheet({ title: 'Unauthorized Sheet', mode: 'blank' });
  } catch (err) {
    rejectedErr = err;
  }

  check(
    'blocks non-Secretariat officer (President) from creating/assigning a sheet with SECRETARIAT_AUTH_REQUIRED',
    rejectedErr !== null && rejectedErr.code === 'SECRETARIAT_AUTH_REQUIRED',
    rejectedErr ? `${rejectedErr.code}: ${rejectedErr.message}` : 'Did not throw'
  );
}

console.log('\n=== Slice 2: Create 18-Column Commerce Hub Order Template (Blank & Pre-Filled) ===');
{
  const expected18Headers = [
    'Order ID',
    'Customer',
    'Email',
    'Contact Number',
    'School ID',
    'Program',
    'Year & Section',
    'Product',
    'Size',
    'Color',
    'Quantity',
    'Unit Price',
    'Total',
    'Status',
    'Payment',
    'Reference Number',
    'IGF Treasury (Read-Only)',
    'Date',
  ];

  // 2A: Blank Template
  const blankEnv = createFakeEnvironment();
  const secOrchestrator = createCentralizedOrderSheetOrchestrator({
    actorUser: {
      uid: 'sec-1',
      role: 'secretary',
      name: 'Ana Reyes',
      email: 'ana.reyes@ctu.edu.ph',
    },
    ...blankEnv,
  });

  const createdBlank = await secOrchestrator.createTemplateSheet({
    title: 'CTU-DB Orders Blank Template',
    mode: 'blank',
  });

  const blankSheet = blankEnv.sheetsStore.get(createdBlank.spreadsheetId);
  check(
    'creates blank Google Sheet with exact 18 Commerce Hub atomic column headers in order',
    JSON.stringify(blankSheet?.tabs[0]?.headers) === JSON.stringify(expected18Headers) &&
      blankSheet?.tabs[0]?.rows.length === 0,
    JSON.stringify(blankSheet?.tabs[0])
  );

  check(
    'configures dropdown validations for Status and Payment columns',
    JSON.stringify(blankSheet?.tabs[0]?.validations?.Status) ===
      JSON.stringify(['Pending', 'Online Paid', 'Claimed', 'Completed', 'Returned', 'Cancelled']) &&
      JSON.stringify(blankSheet?.tabs[0]?.validations?.Payment) === JSON.stringify(['Cash', 'Online']),
    JSON.stringify(blankSheet?.tabs[0]?.validations)
  );

  const savedBlankSettings = blankEnv.getSettingsState();
  check(
    'persists centralized sheet metadata in settingsRepo and writes Audit Trail entry',
    savedBlankSettings?.spreadsheetId === createdBlank.spreadsheetId &&
      savedBlankSettings?.isStandardTemplate === true &&
      savedBlankSettings?.assignedByName === 'Ana Reyes' &&
      savedBlankSettings?.assignedByEmail === 'ana.reyes@ctu.edu.ph' &&
      blankEnv.auditEntries.length === 1,
    JSON.stringify({ savedBlankSettings, auditEntries: blankEnv.auditEntries })
  );

  // 2B: Pre-filled Template from Current Orders
  const prefillEnv = createFakeEnvironment({
    initialOrders: [
      {
        orderId: 'ORD-DB-0001',
        orderStatus: 'Claimed',
        igfSynced: true,
        dateOrdered: '2026-10-26T08:29:00.000Z',
        customerInfo: {
          fullName: 'Juan Dela Cruz',
          email: 'juan@ctu.edu.ph',
          phoneNumber: '09171234567',
          schoolID: '1324567',
          bachelorDegree: 'BSIT',
          section: '3A',
        },
        productInfo: {
          productName: 'Unified CTU-DB Lanyard',
          size: 'Regular',
          color: 'Maroon',
          quantity: 2,
          pricePerUnit: 100,
          totalPrice: 200,
        },
        paymentInfo: {
          paymentMethod: 'Online',
          referenceNumber: 'GC-998877',
        },
      },
    ],
  });

  const finSecOrchestrator = createCentralizedOrderSheetOrchestrator({
    actorUser: {
      uid: 'fin-sec-1',
      role: 'finance_secretary',
      name: 'Carlo Mendoza',
      email: 'carlo.fin@ctu.edu.ph',
    },
    ...prefillEnv,
  });

  const createdPrefilled = await finSecOrchestrator.createTemplateSheet({
    title: 'CTU-DB Active Orders Ledger',
    mode: 'prefilled',
  });

  const prefilledSheet = prefillEnv.sheetsStore.get(createdPrefilled.spreadsheetId);
  const firstRow = prefilledSheet?.tabs[0]?.rows?.[0] || [];
  check(
    'pre-fills existing Commerce Hub orders accurately including IGF Synced read-only column',
    prefilledSheet?.tabs[0]?.rows.length === 1 &&
      firstRow[0] === 'ORD-DB-0001' &&
      firstRow[1] === 'Juan Dela Cruz' &&
      firstRow[7] === 'Unified CTU-DB Lanyard' &&
      Number(firstRow[10]) === 2 &&
      Number(firstRow[12]) === 200 &&
      firstRow[13] === 'Claimed' &&
      firstRow[14] === 'Online' &&
      firstRow[15] === 'GC-998877' &&
      firstRow[16] === 'IGF Synced',
    JSON.stringify(firstRow)
  );
}

console.log('\n=== Slice 3: Assign Existing Google Sheet (Tab Picker, Blank Init, Custom Headers & History) ===');
{
  const assignEnv = createFakeEnvironment({
    initialSettings: {
      spreadsheetId: 'old-sheet-001',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/old-sheet-001/edit',
      spreadsheetTitle: '1st Sem Lanyard Orders',
      sheetId: 0,
      sheetTitle: 'Commerce Hub Orders',
      assignedByName: 'Ana Reyes',
      assignedByEmail: 'ana.reyes@ctu.edu.ph',
      assignedAt: '2026-08-15T00:00:00.000Z',
      previousSheets: [],
    },
  });

  // Seed an existing multi-tab Google Sheet in the fake gateway
  assignEnv.sheetsStore.set('existing-sheet-202', {
    spreadsheetId: 'existing-sheet-202',
    spreadsheetTitle: '2nd Sem SSG Workbook',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/existing-sheet-202/edit',
    tabs: [
      {
        sheetId: 11,
        sheetTitle: 'Form Responses 1',
        headers: [
          'Timestamp',
          'Student Name',
          'Email Address',
          'Mobile Number',
          'Student Number',
          'Merchandise',
          'Qty',
          'Total Pay',
          'Mode of Payment',
          'GCash Ref',
        ],
        rows: [
          [
            '2026-11-01 10:00',
            'Liza Soberano',
            'liza@ctu.edu.ph',
            '09181112222',
            '1339988',
            'SSG Polo Shirt',
            '1',
            '350',
            'Online',
            'GC-554433',
          ],
        ],
        validations: {},
      },
      {
        sheetId: 99,
        sheetTitle: 'Blank Orders Tab',
        headers: [],
        rows: [],
        validations: {},
      },
    ],
  });

  const deputyOrchestrator = createCentralizedOrderSheetOrchestrator({
    actorUser: {
      uid: 'dep-1',
      role: 'deputy_secretary',
      name: 'Mark Villanueva',
      email: 'mark.deputy@ctu.edu.ph',
    },
    ...assignEnv,
  });

  // 3A: Inspect URL + Blank Tab Initialization + Previous Sheet History Archive
  const inspected = await deputyOrchestrator.inspectExistingSpreadsheet(
    'https://docs.google.com/spreadsheets/d/existing-sheet-202/edit#gid=99'
  );
  check(
    'extracts spreadsheetId from full Google Sheets URL and lists worksheet tabs',
    inspected.spreadsheetId === 'existing-sheet-202' &&
      inspected.tabs.length === 2 &&
      inspected.tabs[1].sheetTitle === 'Blank Orders Tab',
    JSON.stringify(inspected)
  );

  const blankTabInspection = await deputyOrchestrator.inspectWorksheetTab(
    'existing-sheet-202',
    'Blank Orders Tab'
  );
  check(
    'detects when a selected worksheet tab is blank',
    blankTabInspection.isEmpty === true,
    JSON.stringify(blankTabInspection)
  );

  await deputyOrchestrator.assignExistingSheet({
    urlOrId: 'https://docs.google.com/spreadsheets/d/existing-sheet-202/edit',
    sheetId: 99,
    sheetTitle: 'Blank Orders Tab',
    initializeIfBlank: true,
  });

  const updatedBlankTab = assignEnv.sheetsStore
    .get('existing-sheet-202')
    .tabs.find((t) => t.sheetTitle === 'Blank Orders Tab');
  const settingsAfterBlankAssign = assignEnv.getSettingsState();

  check(
    'initializes 18 Commerce Hub template headers on empty existing tab and archives outgoing sheet in previousSheets',
    updatedBlankTab.headers.length === 18 &&
      updatedBlankTab.headers[0] === 'Order ID' &&
      settingsAfterBlankAssign.spreadsheetId === 'existing-sheet-202' &&
      settingsAfterBlankAssign.previousSheets.length === 1 &&
      settingsAfterBlankAssign.previousSheets[0].spreadsheetId === 'old-sheet-001',
    JSON.stringify({ headersLen: updatedBlankTab.headers.length, settingsAfterBlankAssign })
  );

  // 3B: Inspect & Assign Custom Google Form Tab without breaking custom headers
  const formTabInspection = await deputyOrchestrator.inspectWorksheetTab(
    'existing-sheet-202',
    'Form Responses 1'
  );
  check(
    'dynamically detects column mappings on custom Google Form headers without overwriting them',
    formTabInspection.isEmpty === false &&
      formTabInspection.detectedMappings['customerInfo.fullName'] === 'Student Name' &&
      formTabInspection.detectedMappings['paymentInfo.referenceNumber'] === 'GCash Ref',
    JSON.stringify(formTabInspection)
  );

  await deputyOrchestrator.assignExistingSheet({
    urlOrId: 'existing-sheet-202',
    sheetId: 11,
    sheetTitle: 'Form Responses 1',
    customMappings: formTabInspection.detectedMappings,
  });

  const settingsAfterFormAssign = assignEnv.getSettingsState();
  const formTabAfterAssign = assignEnv.sheetsStore
    .get('existing-sheet-202')
    .tabs.find((t) => t.sheetTitle === 'Form Responses 1');

  check(
    'persists custom Google Form columnMappings in settings while leaving existing Google Form headers intact',
    settingsAfterFormAssign.isStandardTemplate === false &&
      settingsAfterFormAssign.columnMappings['customerInfo.fullName'] === 'Student Name' &&
      formTabAfterAssign.headers[1] === 'Student Name',
    JSON.stringify({ settingsAfterFormAssign, headers: formTabAfterAssign.headers })
  );
}

console.log('\n=== Slice 4: Recording-Only Pull (ORD-DB-#### IDs, Legacy SSGDB-###, & Strict IGF/Stock Protection) ===');
{
  const standardHeaders = [
    'Order ID',
    'Customer',
    'Email',
    'Contact Number',
    'School ID',
    'Program',
    'Year & Section',
    'Product',
    'Size',
    'Color',
    'Quantity',
    'Unit Price',
    'Total',
    'Status',
    'Payment',
    'Reference Number',
    'IGF Treasury (Read-Only)',
    'Date',
  ];

  const pullEnv = createFakeEnvironment({
    initialSettings: {
      spreadsheetId: 'central-orders-404',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/central-orders-404/edit',
      spreadsheetTitle: 'Centralized Orders',
      sheetId: 0,
      sheetTitle: 'Commerce Hub Orders',
      isStandardTemplate: true,
      columnMappings: {
        orderId: 'Order ID',
        'customerInfo.fullName': 'Customer',
        'customerInfo.email': 'Email',
        'customerInfo.phoneNumber': 'Contact Number',
        'customerInfo.schoolID': 'School ID',
        'customerInfo.bachelorDegree': 'Program',
        'customerInfo.section': 'Year & Section',
        'productInfo.productName': 'Product',
        'productInfo.size': 'Size',
        'productInfo.color': 'Color',
        'productInfo.quantity': 'Quantity',
        'productInfo.pricePerUnit': 'Unit Price',
        'productInfo.totalPrice': 'Total',
        orderStatus: 'Status',
        'paymentInfo.paymentMethod': 'Payment',
        'paymentInfo.referenceNumber': 'Reference Number',
        igfSynced: 'IGF Treasury (Read-Only)',
        dateOrdered: 'Date',
      },
    },
    initialOrders: [
      {
        docId: 'doc-5',
        orderId: 'ORD-DB-0005',
        orderStatus: 'Claimed',
        claimed: true,
        claimedBy: 'Officer Kim',
        stockClaimDeducted: true,
        igfSynced: true,
        customerInfo: { fullName: 'Protected Buyer', email: 'pb@ctu.edu.ph', phoneNumber: '09170000001' },
        productInfo: { productName: 'CTU Lanyard', quantity: 1, pricePerUnit: 100, totalPrice: 100 },
        paymentInfo: { paymentMethod: 'Cash', referenceNumber: '' },
      },
      {
        docId: 'doc-9',
        orderId: 'SSGDB-009',
        orderStatus: 'Pending',
        claimed: false,
        stockClaimDeducted: false,
        igfSynced: false,
        customerInfo: { fullName: 'Legacy Buyer', email: 'legacy@ctu.edu.ph', phoneNumber: '09110000000' },
        productInfo: { productName: 'CTU Lanyard', quantity: 1, pricePerUnit: 100, totalPrice: 100 },
        paymentInfo: { paymentMethod: 'Cash', referenceNumber: '' },
      },
      {
        docId: 'doc-6',
        orderId: 'ORD-DB-0006',
        orderStatus: 'Online Paid',
        claimed: false,
        stockClaimDeducted: false,
        igfSynced: true,
        customerInfo: { fullName: 'Online Buyer', email: 'online@ctu.edu.ph', phoneNumber: '09170000006' },
        productInfo: { productName: 'SSG Shirt', quantity: 1, pricePerUnit: 350, totalPrice: 350 },
        paymentInfo: { paymentMethod: 'Online', referenceNumber: 'GC-111' },
      },
      {
        docId: 'doc-7',
        orderId: 'ORD-DB-0007',
        orderStatus: 'Pending',
        claimed: false,
        stockClaimDeducted: false,
        igfSynced: false,
        customerInfo: { fullName: 'Portal Only Student', email: 'portal@ctu.edu.ph' },
        productInfo: { productName: 'CTU Pin', quantity: 1, pricePerUnit: 75, totalPrice: 75 },
        paymentInfo: { paymentMethod: 'Cash' },
      },
    ],
  });

  pullEnv.sheetsStore.set('central-orders-404', {
    spreadsheetId: 'central-orders-404',
    spreadsheetTitle: 'Centralized Orders',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/central-orders-404/edit',
    tabs: [
      {
        sheetId: 0,
        sheetTitle: 'Commerce Hub Orders',
        headers: standardHeaders,
        rows: [
          // Row 1: Stale Pending status trying to downgrade Claimed + IGF Synced order ORD-DB-0005
          ['ORD-DB-0005', 'Protected Buyer', 'pb@ctu.edu.ph', '09998887777', '130005', 'BSIT', '4A', 'CTU Lanyard', 'Regular', 'Maroon', '1', '100', '100', 'Pending', 'Cash', '', 'Pending', '2026-10-26'],
          // Row 2: Legacy SSGDB-009 (unclaimed, safe to update customer phone)
          ['SSGDB-009', 'Legacy Buyer Updated', 'legacy@ctu.edu.ph', '09223334444', '130009', 'BSED', '2B', 'CTU Lanyard', 'Regular', 'Maroon', '1', '100', '100', 'Pending', 'Cash', '', 'Pending', '2026-10-27'],
          // Row 3: Stale Cancelled status trying to overwrite Online Paid + IGF Synced order ORD-DB-0006
          ['ORD-DB-0006', 'Online Buyer', 'online@ctu.edu.ph', '09170000006', '130006', 'BSIT', '3B', 'SSG Shirt', 'L', 'Black', '1', '350', '350', 'Cancelled', 'Online', 'GC-111', 'Pending', '2026-10-28'],
          // Row 4: Brand-new walk-in row with blank Order ID (even if encoder typed Claimed, sheet is recording-only -> Pending, igfSynced=false)
          ['', 'Walk-in Student', 'walkin@ctu.edu.ph', '09334445555', '130088', 'BSHM', '1A', 'CTU Lanyard', 'Regular', 'Maroon', '3', '100', '300', 'Claimed', 'Cash', '', '', '2026-11-04'],
        ],
        validations: {},
      },
    ],
  });

  const execSecOrchestrator = createCentralizedOrderSheetOrchestrator({
    actorUser: {
      uid: 'exec-sec-1',
      role: 'executive_secretary',
      name: 'Bea Alonzo',
      email: 'bea.exec@ctu.edu.ph',
    },
    ...pullEnv,
  });

  const preview = await execSecOrchestrator.previewPullFromSheet();
  check(
    'previewPullFromSheet flags 2 protected IGF/Claimed conflicts, 1 new ORD-DB-0008 walk-in, and 1 legacy SSGDB-009 update',
    preview.toCreate.length === 1 &&
      preview.toCreate[0].orderId === 'ORD-DB-0008' &&
      preview.toUpdate.length === 1 &&
      preview.toUpdate[0].orderId === 'SSGDB-009' &&
      preview.protectedConflicts.length === 2,
    JSON.stringify({
      toCreate: preview.toCreate.map((o) => o.orderId),
      toUpdate: preview.toUpdate.map((o) => o.orderId),
      protectedConflicts: preview.protectedConflicts.map((c) => c.orderId),
    })
  );

  await execSecOrchestrator.commitPullFromSheet(preview);
  const finalOrders = pullEnv.getOrdersState();
  const ord5 = finalOrders.find((o) => o.orderId === 'ORD-DB-0005');
  const ord6 = finalOrders.find((o) => o.orderId === 'ORD-DB-0006');
  const ord7 = finalOrders.find((o) => o.orderId === 'ORD-DB-0007');
  const ord8 = finalOrders.find((o) => o.orderId === 'ORD-DB-0008');
  const ssg9 = finalOrders.find((o) => o.orderId === 'SSGDB-009');

  check(
    'strictly protects Claimed and IGF Synced orders from stale Google Sheet downgrades',
    ord5.orderStatus === 'Claimed' &&
      ord5.claimed === true &&
      ord5.igfSynced === true &&
      ord5.stockClaimDeducted === true &&
      ord6.orderStatus === 'Online Paid' &&
      ord6.igfSynced === true,
    JSON.stringify({ ord5, ord6 })
  );

  check(
    'imports new walk-in row as ORD-DB-0008 in Pending recording-only state (never claiming or syncing IGF via sheet)',
    Boolean(ord8) &&
      ord8.orderStatus === 'Pending' &&
      ord8.claimed === false &&
      ord8.igfSynced === false &&
      ord8.productInfo.quantity === 3 &&
      ord8.productInfo.totalPrice === 300,
    JSON.stringify(ord8)
  );

  check(
    'preserves legacy SSGDB-009 ID on update and never deletes portal-only order ORD-DB-0007 missing from sheet',
    ssg9?.customerInfo?.fullName === 'Legacy Buyer Updated' &&
      ssg9?.customerInfo?.phoneNumber === '09223334444' &&
      Boolean(ord7) &&
      finalOrders.length === 5,
    JSON.stringify({ ssg9, hasOrd7: Boolean(ord7), total: finalOrders.length })
  );
}

console.log('\n=== Slice 5: Two-Way Reconcile, Push App -> Sheet, & HTTP 403 Multi-Secretary Handoff ===');
{
  const standardHeaders = [
    'Order ID',
    'Customer',
    'Email',
    'Contact Number',
    'School ID',
    'Program',
    'Year & Section',
    'Product',
    'Size',
    'Color',
    'Quantity',
    'Unit Price',
    'Total',
    'Status',
    'Payment',
    'Reference Number',
    'IGF Treasury (Read-Only)',
    'Date',
  ];

  const reconcileEnv = createFakeEnvironment({
    initialSettings: {
      spreadsheetId: 'central-orders-505',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/central-orders-505/edit',
      spreadsheetTitle: 'Centralized Orders 505',
      sheetId: 0,
      sheetTitle: 'Commerce Hub Orders',
      isStandardTemplate: true,
      assignedByName: 'Ana Reyes',
      assignedByEmail: 'ana.reyes@ctu.edu.ph',
      columnMappings: {
        orderId: 'Order ID',
        'customerInfo.fullName': 'Customer',
        'customerInfo.email': 'Email',
        'customerInfo.phoneNumber': 'Contact Number',
        'customerInfo.schoolID': 'School ID',
        'customerInfo.bachelorDegree': 'Program',
        'customerInfo.section': 'Year & Section',
        'productInfo.productName': 'Product',
        'productInfo.size': 'Size',
        'productInfo.color': 'Color',
        'productInfo.quantity': 'Quantity',
        'productInfo.pricePerUnit': 'Unit Price',
        'productInfo.totalPrice': 'Total',
        orderStatus: 'Status',
        'paymentInfo.paymentMethod': 'Payment',
        'paymentInfo.referenceNumber': 'Reference Number',
        igfSynced: 'IGF Treasury (Read-Only)',
        dateOrdered: 'Date',
      },
    },
    initialOrders: [
      {
        docId: 'doc-1',
        orderId: 'ORD-DB-0001',
        orderStatus: 'Claimed',
        claimed: true,
        igfSynced: true,
        dateOrdered: '2026-10-26T08:00:00.000Z',
        customerInfo: { fullName: 'Claimed Buyer', email: 'claimed@ctu.edu.ph', phoneNumber: '09171111111' },
        productInfo: { productName: 'CTU Lanyard', size: 'Regular', color: 'Maroon', quantity: 1, pricePerUnit: 100, totalPrice: 100 },
        paymentInfo: { paymentMethod: 'Cash', referenceNumber: '' },
      },
      {
        docId: 'doc-2',
        orderId: 'ORD-DB-0002',
        orderStatus: 'Pending',
        claimed: false,
        igfSynced: false,
        dateOrdered: '2026-10-27T09:00:00.000Z',
        customerInfo: { fullName: 'Portal Student', email: 'portal2@ctu.edu.ph', phoneNumber: '09172222222' },
        productInfo: { productName: 'SSG Shirt', size: 'M', color: 'White', quantity: 1, pricePerUnit: 350, totalPrice: 350 },
        paymentInfo: { paymentMethod: 'Online', referenceNumber: 'GC-202' },
      },
    ],
  });

  reconcileEnv.sheetsStore.set('central-orders-505', {
    spreadsheetId: 'central-orders-505',
    spreadsheetTitle: 'Centralized Orders 505',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/central-orders-505/edit',
    tabs: [
      {
        sheetId: 0,
        sheetTitle: 'Commerce Hub Orders',
        headers: standardHeaders,
        rows: [
          // Row 0: ORD-DB-0001 has stale Pending / Pending in sheet, should be restored to Claimed + IGF Synced
          ['ORD-DB-0001', 'Claimed Buyer', 'claimed@ctu.edu.ph', '09171111111', '', '', '', 'CTU Lanyard', 'Regular', 'Maroon', '1', '100', '100', 'Pending', 'Cash', '', 'Pending', '2026-10-26T08:00:00.000Z'],
          // Row 1: New walk-in with blank Order ID -> should become ORD-DB-0003 in BOTH Firestore AND Google Sheet Row 1!
          ['', 'New Booth Walk-in', 'booth@ctu.edu.ph', '09173333333', '139999', 'BSIT', '2A', 'CTU Pin', 'N/A', 'Gold', '2', '75', '150', 'Pending', 'Cash', '', '', '2026-11-04T04:00:00.000Z'],
        ],
        validations: {},
      },
    ],
  });

  const pressSecOrchestrator = createCentralizedOrderSheetOrchestrator({
    actorUser: {
      uid: 'press-sec-1',
      role: 'press_secretary',
      name: 'Kim Chiu',
      email: 'kim.press@ctu.edu.ph',
    },
    ...reconcileEnv,
  });

  const reconcileRes = await pressSecOrchestrator.reconcileTwoWay();
  const sheetRowsAfter = reconcileEnv.sheetsStore.get('central-orders-505').tabs[0].rows;
  const dbOrdersAfter = reconcileEnv.getOrdersState();

  check(
    'reconcileTwoWay converges Firestore and Google Sheet to 3 identical orders without duplicating blank-ID walk-in',
    dbOrdersAfter.length === 3 &&
      sheetRowsAfter.length === 3 &&
      reconcileRes.createdInApp === 1 &&
      reconcileRes.appendedToSheet === 1,
    JSON.stringify({ reconcileRes, dbLen: dbOrdersAfter.length, sheetLen: sheetRowsAfter.length })
  );

  check(
    'writes generated ORD-DB-0003 back to the walk-in row and restores Claimed + IGF Synced on ORD-DB-0001 in Google Sheet',
    sheetRowsAfter[0][0] === 'ORD-DB-0001' &&
      sheetRowsAfter[0][13] === 'Claimed' &&
      sheetRowsAfter[0][16] === 'IGF Synced' &&
      sheetRowsAfter[1][0] === 'ORD-DB-0003' &&
      sheetRowsAfter[2][0] === 'ORD-DB-0002',
    JSON.stringify(sheetRowsAfter)
  );

  // 5A-2: Push single order update (e.g. Auto-Push when Secretary claims ORD-DB-0002 in Commerce Hub)
  const claimedOrd2 = {
    ...dbOrdersAfter.find((o) => o.orderId === 'ORD-DB-0002'),
    orderStatus: 'Claimed',
    claimed: true,
    igfSynced: true,
  };
  await reconcileEnv.ordersRepo.upsertBatch([claimedOrd2]);
  const singlePushRes = await pressSecOrchestrator.pushSingleOrderUpdate(claimedOrd2);
  const sheetRowsAfterSinglePush = reconcileEnv.sheetsStore.get('central-orders-505').tabs[0].rows;

  check(
    'pushSingleOrderUpdate updates matched row in-place with Claimed + IGF Synced without appending duplicates',
    singlePushRes.updatedInSheet === 1 &&
      singlePushRes.appendedToSheet === 0 &&
      sheetRowsAfterSinglePush.length === 3 &&
      sheetRowsAfterSinglePush[2][0] === 'ORD-DB-0002' &&
      sheetRowsAfterSinglePush[2][13] === 'Claimed' &&
      sheetRowsAfterSinglePush[2][16] === 'IGF Synced',
    JSON.stringify({ singlePushRes, row2: sheetRowsAfterSinglePush[2] })
  );

  // 5B: HTTP 403 Multi-Secretary Handoff Error Enrichment
  const forbiddenGateway = {
    ...reconcileEnv.sheetsGateway,
    readTabValues: async () => {
      const err = new Error('The caller does not have permission');
      err.status = 403;
      throw err;
    },
  };

  const linkagesSecOrchestrator = createCentralizedOrderSheetOrchestrator({
    actorUser: {
      uid: 'link-sec-1',
      role: 'linkages_secretary',
      name: 'Paolo Contis',
      email: 'paolo.linkages@ctu.edu.ph',
    },
    ...reconcileEnv,
    sheetsGateway: forbiddenGateway,
  });

  let handoffError = null;
  try {
    await linkagesSecOrchestrator.previewPullFromSheet();
  } catch (err) {
    handoffError = err;
  }

  check(
    'enriches HTTP 403 error with SHEET_ACCESS_DENIED and owner contact metadata for multi-Secretary handoff UI',
    handoffError !== null &&
      handoffError.code === 'SHEET_ACCESS_DENIED' &&
      handoffError.ownerName === 'Ana Reyes' &&
      handoffError.ownerEmail === 'ana.reyes@ctu.edu.ph' &&
      handoffError.spreadsheetUrl === 'https://docs.google.com/spreadsheets/d/central-orders-505/edit',
    JSON.stringify(handoffError)
  );
}

console.log('\n=== Slice 6: User Link Mistakes (Publish-to-Web /d/e/ URLs, Google Forms Links, Docs/Drive Links) ===');
{
  const captureExtract = (input) => {
    try {
      return { id: extractSpreadsheetId(input), err: null };
    } catch (err) {
      return { id: null, err };
    }
  };

  const pubWeb = captureExtract(
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vR9xyz123456/pubhtml?gid=0&single=true'
  );
  check(
    'rejects "Publish to web" (/spreadsheets/d/e/2PACX...) links with PUBLISHED_WEB_URL_NOT_EDITABLE instead of extracting "e"',
    pubWeb.id === null && pubWeb.err?.code === 'PUBLISHED_WEB_URL_NOT_EDITABLE',
    JSON.stringify({ id: pubWeb.id, code: pubWeb.err?.code, msg: pubWeb.err?.message })
  );

  const formLink = captureExtract(
    'https://docs.google.com/forms/d/e/1FAIpQLSe987654321/viewform?usp=sf_link'
  );
  const docLink = captureExtract(
    'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit'
  );
  const folderLink = captureExtract(
    'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv'
  );
  check(
    'detects Google Forms, Google Docs, and Google Drive folder links with WRONG_GOOGLE_LINK_TYPE and actionable guidance',
    formLink.err?.code === 'WRONG_GOOGLE_LINK_TYPE' &&
      /Google Form/i.test(formLink.err?.message || '') &&
      docLink.err?.code === 'WRONG_GOOGLE_LINK_TYPE' &&
      folderLink.err?.code === 'WRONG_GOOGLE_LINK_TYPE',
    JSON.stringify({
      form: formLink.err?.code,
      doc: docLink.err?.code,
      folder: folderLink.err?.code,
    })
  );

  const plainWord = captureExtract('LanyardMasterlist');
  const emptyInput = captureExtract('   ');
  check(
    'rejects plain words like "LanyardMasterlist" and blank input with INVALID_SHEET_URL while keeping valid IDs working',
    plainWord.err?.code === 'INVALID_SHEET_URL' &&
      emptyInput.err?.code === 'INVALID_SHEET_URL' &&
      captureExtract('existing-sheet-202').id === 'existing-sheet-202',
    JSON.stringify({ plainWord: plainWord.id || plainWord.err?.code, empty: emptyInput.err?.code })
  );
}

console.log('\n=== Slice 7: Column Collision Bug ("Student ID" vs "Order ID") & Duplicate Manual Mapping Guard ===');
{
  const formHeadersWithStudentId = [
    'Timestamp',
    'Full Name',
    'Student ID',
    'Degree Program',
    'Merchandise',
    'Quantity',
    'Mode of Payment',
  ];

  const { resolvedMappings } = detectOrderSheetColumnMappings(formHeadersWithStudentId);
  const mappedCols = Object.values(resolvedMappings);
  const uniqueCols = new Set(mappedCols.map((c) => c.toLowerCase()));

  check(
    'maps "Student ID" exclusively to customerInfo.schoolID without colliding with orderId or productId',
    resolvedMappings['customerInfo.schoolID'] === 'Student ID' &&
      !resolvedMappings.orderId &&
      !resolvedMappings['productInfo.productId'] &&
      mappedCols.length === uniqueCols.size,
    JSON.stringify(resolvedMappings)
  );

  // Manual user mistake: mapping two fields to the same Google Sheet column
  const dupEnv = createFakeEnvironment();
  dupEnv.sheetsStore.set('dup-sheet-707', {
    spreadsheetId: 'dup-sheet-707',
    spreadsheetTitle: 'HM Uniform Responses',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/dup-sheet-707/edit',
    tabs: [
      {
        sheetId: 0,
        sheetTitle: 'Form Responses 1',
        headers: formHeadersWithStudentId,
        rows: [['2026-11-04', 'Bea Alonzo', '1345678', 'BSHM', 'HM Chef Apron', '1', 'Cash']],
        validations: {},
      },
    ],
  });

  const secOrch = createCentralizedOrderSheetOrchestrator({
    actorUser: { uid: 'sec-7', role: 'secretary', name: 'Sec Bea', email: 'bea@ctu.edu.ph' },
    ...dupEnv,
  });

  let dupErr = null;
  try {
    await secOrch.assignExistingSheet({
      urlOrId: 'dup-sheet-707',
      sheetTitle: 'Form Responses 1',
      customMappings: {
        'customerInfo.fullName': 'Full Name',
        'productInfo.productName': 'Full Name', // accidental duplicate dropdown choice!
      },
    });
  } catch (err) {
    dupErr = err;
  }

  check(
    'rejects duplicate manual column mappings in assignExistingSheet with DUPLICATE_COLUMN_MAPPING',
    dupErr !== null &&
      dupErr.code === 'DUPLICATE_COLUMN_MAPPING' &&
      /Full Name/i.test(dupErr.message || ''),
    JSON.stringify({ code: dupErr?.code, message: dupErr?.message })
  );
}

console.log('\n=== Slice 8: Idempotent Repeated Pulls & Reconciles on Google Forms (No Order ID Column) & Blank Walk-Ins ===');
{
  const gformEnv = createFakeEnvironment();
  gformEnv.sheetsStore.set('gform-808', {
    spreadsheetId: 'gform-808',
    spreadsheetTitle: 'EDUC Lanyard Google Form',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/gform-808/edit',
    tabs: [
      {
        sheetId: 0,
        sheetTitle: 'Form Responses 1',
        headers: [
          'Timestamp',
          'Student Name',
          'Email Address',
          'Student ID',
          'Merchandise',
          'Quantity',
          'Total Pay',
          'Mode of Payment',
        ],
        rows: [
          ['2026-11-04 09:00', 'Maria Clara', 'maria@ctu.edu.ph', '1300111', 'EDUC Lanyard', '1', '100', 'Cash'],
        ],
        validations: {},
      },
    ],
  });

  const educSecOrch = createCentralizedOrderSheetOrchestrator({
    actorUser: { uid: 'educ-sec', role: 'secretary', name: 'Sec Maria', email: 'sec.educ@ctu.edu.ph' },
    ...gformEnv,
  });

  await educSecOrch.assignExistingSheet({
    urlOrId: 'gform-808',
    sheetTitle: 'Form Responses 1',
  });

  // Secretary clicks Pull + Commit twice before a new student submits the Google Form
  await educSecOrch.commitPullFromSheet();
  // Now a second student submits the Google Form, and Secretary clicks Pull + Commit again!
  gformEnv.sheetsStore
    .get('gform-808')
    .tabs[0].rows.push([
      '2026-11-04 09:15',
      'Crisostomo Ibarra',
      'ibarra@ctu.edu.ph',
      '1300222',
      'EDUC Lanyard',
      '2',
      '200',
      'Online',
    ]);
  const secondPullRes = await educSecOrch.commitPullFromSheet();
  const ordersAfterTwoPulls = gformEnv.getOrdersState();

  check(
    'repeated Pulls on a Google Form sheet (without Order ID column) do NOT duplicate already-imported rows',
    ordersAfterTwoPulls.length === 2 &&
      secondPullRes.created === 1 &&
      ordersAfterTwoPulls[0].customerInfo.fullName === 'Maria Clara' &&
      ordersAfterTwoPulls[1].customerInfo.fullName === 'Crisostomo Ibarra',
    JSON.stringify({ count: ordersAfterTwoPulls.length, secondPullRes, ordersAfterTwoPulls })
  );

  // Now Secretary clicks Two-Way Reconcile twice on that same Google Form sheet!
  await educSecOrch.reconcileTwoWay();
  await educSecOrch.reconcileTwoWay();
  const ordersAfterReconcile = gformEnv.getOrdersState();
  const sheetRowsAfterReconcile = gformEnv.sheetsStore.get('gform-808').tabs[0].rows;

  check(
    'repeated reconcileTwoWay on a Google Form sheet (no Order ID column) updates rows in place without duplicating rows in App or Sheet',
    ordersAfterReconcile.length === 2 && sheetRowsAfterReconcile.length === 2,
    JSON.stringify({
      appCount: ordersAfterReconcile.length,
      sheetCount: sheetRowsAfterReconcile.length,
      sheetRowsAfterReconcile,
    })
  );
}

console.log('\n=== Slice 9: Human Spreadsheet Entry Errors (Ghost Dropdown Rows, TOTAL Rows, Duplicate Headers, Prices & GCash/Maya) ===');
{
  const messyEnv = createFakeEnvironment();
  const stdHeaders = COMMERCE_HUB_ORDER_TEMPLATE_COLUMNS.map((c) => c.header);

  messyEnv.sheetsStore.set('messy-909', {
    spreadsheetId: 'messy-909',
    spreadsheetTitle: 'HM Booth Masterlist (Messy Human Edits)',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/messy-909/edit',
    tabs: [
      {
        sheetId: 0,
        sheetTitle: 'Commerce Hub Orders',
        headers: stdHeaders,
        rows: [
          // Row 2: Valid student walk-in paying via GCash with messy currency text "₱150 - Paid"
          [
            '',
            'Angela Reyes',
            'angela@ctu.edu.ph',
            '09171112222',
            '1334455',
            'BSHM',
            '2nd Year',
            'HM Chef Apron',
            'M',
            'White',
            '2',
            '₱150 - Paid',
            '',
            'Pending',
            'GCash',
            '',
            'Pending',
            '2026-11-04',
          ],
          // Row 3: Valid student walk-in where officer typed negative typo "-120" in Unit Price and "PayMaya"
          [
            '',
            'Carlo Mendoza',
            '',
            '',
            '1339988',
            'BSED',
            '1st Year',
            'Unified CTU-DB Lanyard',
            'N/A',
            'N/A',
            '1',
            '-120',
            '-120',
            'Pending',
            'PayMaya',
            '',
            'Pending',
            '2026-11-04',
          ],
          // Row 4: Ghost trailing row with ONLY Google Sheet dropdown defaults (Pending / Cash / 1)
          [
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '1',
            '',
            '',
            'Pending',
            'Cash',
            '',
            'Pending',
            '',
          ],
          // Row 5: Pre-dragged booth row with Product filled down ("Unified CTU-DB Lanyard") but NO buyer at all
          [
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            'Unified CTU-DB Lanyard',
            'N/A',
            'N/A',
            '1',
            '100',
            '100',
            'Pending',
            'Cash',
            '',
            'Pending',
            '',
          ],
          // Row 6: Accidentally pasted duplicate header row mid-sheet
          [...stdHeaders],
          // Row 7: Officer's bottom spreadsheet summary row ("TOTAL")
          [
            '',
            'TOTAL',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '25',
            '',
            '₱3,500.00',
            '',
            '',
            '',
            '',
          ],
        ],
        validations: {},
      },
    ],
  });

  const hmSecOrch = createCentralizedOrderSheetOrchestrator({
    actorUser: { uid: 'hm-sec', role: 'secretary', name: 'Sec Angela', email: 'hm.sec@ctu.edu.ph' },
    ...messyEnv,
  });

  await hmSecOrch.assignExistingSheet({
    urlOrId: 'messy-909',
    sheetTitle: 'Commerce Hub Orders',
  });

  const messyPreview = await hmSecOrch.previewPullFromSheet();

  check(
    'skips ghost dropdown rows, blank-buyer booth rows, duplicate header rows, and bottom TOTAL rows instead of importing fake orders',
    messyPreview.toCreate.length === 2 &&
      messyPreview.skippedRows.length === 4 &&
      messyPreview.toCreate.every((o) =>
        ['Angela Reyes', 'Carlo Mendoza'].includes(o.customerInfo?.fullName)
      ),
    JSON.stringify({
      createdNames: messyPreview.toCreate.map((o) => o.customerInfo?.fullName),
      skippedRows: messyPreview.skippedRows,
    })
  );

  const angelaOrder = messyPreview.toCreate.find(
    (o) => o.customerInfo?.fullName === 'Angela Reyes'
  );
  const carloOrder = messyPreview.toCreate.find(
    (o) => o.customerInfo?.fullName === 'Carlo Mendoza'
  );

  check(
    'normalizes GCash/PayMaya to paymentMethod="Online" with onlinePaymentType and clamps negative/annotated prices safely',
    angelaOrder?.paymentInfo?.paymentMethod === 'Online' &&
      angelaOrder?.paymentInfo?.onlinePaymentType === 'GCash' &&
      angelaOrder?.productInfo?.pricePerUnit === 150 &&
      angelaOrder?.productInfo?.totalPrice === 300 &&
      carloOrder?.paymentInfo?.paymentMethod === 'Online' &&
      carloOrder?.paymentInfo?.onlinePaymentType === 'Maya' &&
      carloOrder?.productInfo?.pricePerUnit === 0 &&
      carloOrder?.productInfo?.totalPrice === 0,
    JSON.stringify({ angelaOrder, carloOrder })
  );
}

console.log('\n=== Slice 10: Friendly Plain-English Google API & Network Error Translation (Renamed Tab, 404, 401, 429, Protected Cells, Offline) ===');
{
  function makeFailingOrchestrator(fakeError, activeSettings = null) {
    const baseEnv = createFakeEnvironment({
      initialSettings: activeSettings || {
        spreadsheetId: 'err-sheet-1010',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/err-sheet-1010/edit',
        spreadsheetTitle: 'SSG Orders 2026',
        sheetId: 0,
        sheetTitle: 'Commerce Hub Orders',
        assignedByName: 'Sec Hannah',
        assignedByEmail: 'hannah@ctu.edu.ph',
      },
    });
    const failingGateway = {
      async getSpreadsheetMetadata() {
        throw fakeError;
      },
      async readTabValues() {
        throw fakeError;
      },
      async createSpreadsheet() {
        throw fakeError;
      },
      async initializeTemplateOnTab() {
        throw fakeError;
      },
      async writeTabUpdates() {
        throw fakeError;
      },
    };
    return createCentralizedOrderSheetOrchestrator({
      actorUser: { uid: 'sec-10', role: 'secretary', name: 'Sec Hannah', email: 'hannah@ctu.edu.ph' },
      ...baseEnv,
      sheetsGateway: failingGateway,
    });
  }

  async function captureAsyncErr(fn) {
    try {
      await fn();
      return null;
    } catch (e) {
      return e;
    }
  }

  // 1. Renamed / deleted bottom worksheet tab inside Google Sheets -> HTTP 400 "Unable to parse range"
  const rangeErr = Object.assign(
    new Error("Unable to parse range: 'Commerce Hub Orders'!A1:ZZ5000"),
    { status: 400 }
  );
  const tabRenamedCaught = await captureAsyncErr(() =>
    makeFailingOrchestrator(rangeErr).previewPullFromSheet()
  );

  check(
    'translates HTTP 400 "Unable to parse range" into SHEET_TAB_NOT_FOUND with plain-English guidance to reassign the tab',
    tabRenamedCaught?.code === 'SHEET_TAB_NOT_FOUND' &&
      /renamed or deleted/i.test(tabRenamedCaught?.message || ''),
    JSON.stringify({ code: tabRenamedCaught?.code, message: tabRenamedCaught?.message })
  );

  // 2. Protected cell / locked sheet range -> HTTP 400 "You are trying to edit a protected cell or object"
  const protectedCellErr = Object.assign(
    new Error('You are trying to edit a protected cell or object. Please contact the spreadsheet owner.'),
    { status: 400 }
  );
  const protectedCellCaught = await captureAsyncErr(() =>
    makeFailingOrchestrator(protectedCellErr).pushOrdersToSheet()
  );

  check(
    'translates locked/protected sheet range error into SHEET_RANGE_PROTECTED with plain-English unlock instructions',
    protectedCellCaught?.code === 'SHEET_RANGE_PROTECTED' &&
      /protected|locked/i.test(protectedCellCaught?.message || ''),
    JSON.stringify({ code: protectedCellCaught?.code, message: protectedCellCaught?.message })
  );

  // 3. Deleted / non-existent spreadsheet on inspectExistingSpreadsheet -> HTTP 404
  const notFoundErr = Object.assign(new Error('Requested entity was not found.'), { status: 404 });
  const notFoundCaught = await captureAsyncErr(() =>
    makeFailingOrchestrator(notFoundErr).inspectExistingSpreadsheet(
      'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit'
    )
  );

  check(
    'translates HTTP 404 during inspect or sync into SHEET_NOT_FOUND in plain English',
    notFoundCaught?.code === 'SHEET_NOT_FOUND' &&
      /Trash|deleted|not be found/i.test(notFoundCaught?.message || ''),
    JSON.stringify({ code: notFoundCaught?.code, message: notFoundCaught?.message })
  );

  // 4. Expired 1-hour Google session -> HTTP 401
  const expiredErr = Object.assign(
    new Error('Request had invalid authentication credentials.'),
    { status: 401 }
  );
  const expiredCaught = await captureAsyncErr(() =>
    makeFailingOrchestrator(expiredErr).previewPullFromSheet()
  );

  // 5. Rapid-click rate limit -> HTTP 429
  const rateLimitErr = Object.assign(
    new Error("Quota exceeded for quota metric 'Read requests'"),
    { status: 429 }
  );
  const rateLimitCaught = await captureAsyncErr(() =>
    makeFailingOrchestrator(rateLimitErr).previewPullFromSheet()
  );

  // 6. Campus Wi-Fi offline -> TypeError("Failed to fetch")
  const offlineErr = new TypeError('Failed to fetch');
  const offlineCaught = await captureAsyncErr(() =>
    makeFailingOrchestrator(offlineErr).createTemplateSheet({ title: 'Test Offline' })
  );

  check(
    'translates HTTP 401 (GOOGLE_SESSION_EXPIRED), HTTP 429 (SHEET_RATE_LIMITED), and network drop (NETWORK_OFFLINE) across all actions',
    expiredCaught?.code === 'GOOGLE_SESSION_EXPIRED' &&
      rateLimitCaught?.code === 'SHEET_RATE_LIMITED' &&
      offlineCaught?.code === 'NETWORK_OFFLINE',
    JSON.stringify({
      expired: expiredCaught?.code,
      rateLimit: rateLimitCaught?.code,
      offline: offlineCaught?.code,
    })
  );
}

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nAll centralized order sheet checks passed.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);
