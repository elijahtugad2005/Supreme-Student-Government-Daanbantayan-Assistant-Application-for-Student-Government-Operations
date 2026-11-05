/**
 * src/services/googleSheetsFinanceSyncService.js
 * Multi-Tab Google Sheets Export Service for CTU SSG Institutional Finance Ledger
 * 
 * Reuses Google Identity Services & OAuth Client credentials:
 * VITE_GOOGLE_OAUTH_CLIENT_ID / VITE_GOOGLE_CLIENT_ID
 */

import { formatPHP, toCentavos, fromCentavos } from '../utils/financeConstants.js';
import { auditService } from './auditService.js';

export const GOOGLE_SHEETS_RW_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const GIS_SCRIPT_ID = 'google-identity-services-sdk';
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let tokenSession = {
  accessToken: null,
  expiresAt: 0,
};

export function getConfiguredGoogleClientId() {
  const clientId =
    import.meta.env?.VITE_GOOGLE_OAUTH_CLIENT_ID ||
    import.meta.env?.VITE_GOOGLE_CLIENT_ID ||
    '';
  return String(clientId).trim();
}

export function isGoogleOAuthConfigured() {
  return Boolean(getConfiguredGoogleClientId());
}

export function getGoogleConnectionStatus() {
  const now = Date.now();
  const isConnected = Boolean(tokenSession.accessToken && tokenSession.expiresAt > now + 30_000);
  return {
    configured: isGoogleOAuthConfigured(),
    connected: isConnected,
    expiresAt: isConnected ? tokenSession.expiresAt : null,
  };
}

/**
 * Requests an OAuth 2.0 Access Token with spreadsheet write permissions.
 */
export async function requestGoogleSheetsToken(interactive = true) {
  const clientId = getConfiguredGoogleClientId();
  if (!clientId) {
    throw new Error('Google OAuth Client ID is not configured (VITE_GOOGLE_OAUTH_CLIENT_ID).');
  }

  const now = Date.now();
  if (tokenSession.accessToken && tokenSession.expiresAt > now + 60_000) {
    return tokenSession.accessToken;
  }

  if (typeof window === 'undefined') {
    throw new Error('Google Identity Services requires a browser runtime.');
  }

  await new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const existing = document.getElementById(GIS_SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services SDK.')));
      return;
    }
    const script = document.createElement('script');
    script.id = GIS_SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services SDK.'));
    document.head.appendChild(script);
  });

  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SHEETS_RW_SCOPE,
      prompt: interactive ? 'consent' : '',
      callback: (response) => {
        if (response.error) {
          reject(new Error(`Google authorization error: ${response.error_description || response.error}`));
          return;
        }
        const expiresInSeconds = Number(response.expires_in) || 3600;
        tokenSession = {
          accessToken: response.access_token,
          expiresAt: Date.now() + expiresInSeconds * 1000,
        };
        resolve(response.access_token);
      },
    });

    tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

/**
 * Builds formatted data for Google Sheets v4 multi-tab payload
 */
export function buildFiscalSheetsPayload({ funds = [], budgets = [], transactions = [] }) {
  // Normalize funds in case legacy object { annualBudget, incomeGenerated } or non-array is passed
  const fundsList = Array.isArray(funds)
    ? funds
    : Object.entries(funds || {}).map(([key, val]) => ({
        id: key,
        displayName: key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()),
        balanceCentavos: typeof val === 'number' ? toCentavos(val) : (val?.balanceCentavos || 0),
        bankAccountReference: val?.bankAccountReference || 'General Depository',
        fiscalYear: val?.fiscalYear || '2026–2027',
      }));

  const totalHoldingCentavos = fundsList.reduce((acc, f) => acc + (f.balanceCentavos || 0), 0);
  const totalApprovedAllocCentavos = budgets
    .filter(b => b.status === 'approved')
    .reduce((acc, b) => acc + (b.allocatedCentavos || toCentavos(b.allocatedAmount || 0)), 0);
  const totalSpentCentavos = budgets.reduce((acc, b) => acc + (b.spentCentavos || toCentavos(b.spentAmount || 0)), 0);

  // 1. Summary KPIs
  const summarySheet = {
    name: 'Summary KPIs',
    headers: ['Institutional Metric', 'Amount (PHP)', 'Account / Status Reference', 'Last Synchronized'],
    rows: [
      ['Total Holding Fund Balance', fromCentavos(totalHoldingCentavos).toFixed(2), 'All Depository Accounts', new Date().toISOString()],
      ['Approved Legislative Appropriations', fromCentavos(totalApprovedAllocCentavos).toFixed(2), 'Active PPMP Matrix', new Date().toISOString()],
      ['Total Event Disbursements Spent', fromCentavos(totalSpentCentavos).toFixed(2), 'Audited Ledger Disbursements', new Date().toISOString()],
      ['Remaining Legislative Allocation Surplus', fromCentavos(Math.max(0, totalApprovedAllocCentavos - totalSpentCentavos)).toFixed(2), 'Available PPMP Ceiling', new Date().toISOString()],
    ],
  };

  // 2. General Ledger
  const ledgerSheet = {
    name: 'General Ledger',
    headers: ['Date', 'Transaction ID', 'Type', 'Account / Fund', 'Amount (PHP)', 'Payee / Payer', 'Description', 'Custodian', 'Resolution Ref', 'Audit Overspent'],
    rows: transactions.map(tx => [
      tx.date || (tx.createdAt ? new Date(tx.createdAt).toLocaleDateString('en-PH') : ''),
      tx.referenceNo || tx.id || '',
      tx.transactionType || 'EXPENSE',
      tx.fundAccountId || 'fund_fiscal_year_budget',
      fromCentavos(tx.amountCentavos || toCentavos(tx.amount || 0)).toFixed(2),
      tx.payeeOrPayer || 'N/A',
      tx.description || '',
      tx.custodianName || 'SSG Officer',
      tx.resolutionRef || 'N/A',
      tx.isReversed ? `REVERSED: ${tx.reversalReason || ''}` : tx.isOverspent ? 'YES (FLAGGED)' : 'POSTED',
    ]),
  };

  // 3. Approved Allocations
  const allocationsSheet = {
    name: 'Approved Allocations',
    headers: ['Event / Program Name', 'Resolution Ref', 'Source Fund', 'Allocated (PHP)', 'Disbursed (PHP)', 'Remaining (PHP)', 'Status'],
    rows: budgets.map(b => [
      b.eventName || b.title || 'Event Line Item',
      b.resolution || b.resolutionRef || 'N/A',
      b.fundAccountId || (b.isFSG ? 'fund_fsg_remittance' : 'fund_fiscal_year_budget'),
      fromCentavos(b.allocatedCentavos || toCentavos(b.allocatedAmount || 0)).toFixed(2),
      fromCentavos(b.spentCentavos || toCentavos(b.spentAmount || 0)).toFixed(2),
      fromCentavos(b.remainingCentavos || (b.allocatedCentavos - (b.spentCentavos || 0)) || 0).toFixed(2),
      b.status || 'approved',
    ]),
  };

  // 4. Holding Funds
  const holdingFundsSheet = {
    name: 'Holding Funds',
    headers: ['Fund Identifier', 'Fund Display Name', 'Balance (PHP)', 'Depository Bank Reference', 'Fiscal Term'],
    rows: fundsList.map(f => [
      f.id || '',
      f.displayName || f.name || 'Fund',
      fromCentavos(f.balanceCentavos || toCentavos(f.balance || 0)).toFixed(2),
      f.bankAccountReference || 'General Depository',
      f.fiscalYear || '2026–2027',
    ]),
  };

  return {
    spreadsheetTitle: `CTU_SSG_Finance_Ledger_${new Date().toISOString().slice(0, 10)}`,
    sheets: [summarySheet, ledgerSheet, allocationsSheet, holdingFundsSheet],
  };
}

/**
 * Builds Google Sheets v4 formatting requests to design the table title columns:
 * - Freezes Row 1 header
 * - Sets 36px comfortable title row height
 * - Styles header with CTU Royal Crimson Maroon background (#7a121d) and Imperial Gold bold text (#ffea9f)
 * - Adds a solid Imperial Gold bottom accent border (#d4af37)
 * - Auto-resizes columns to eliminate text truncation
 */
export function buildTitleColumnFormattingRequests({ sheetId = 0, headers = [], totalRows = 1 }) {
  const colCount = Math.max(headers.length, 1);
  return [
    // 1. Freeze top header row & color sheet tab with institutional crimson
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          tabColor: { red: 0.48, green: 0.07, blue: 0.11 },
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        fields: 'gridProperties.frozenRowCount,tabColor',
      },
    },
    // 2. Set Title Row Height to 36px for comfortable visual hierarchy
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: 0,
          endIndex: 1,
        },
        properties: {
          pixelSize: 36,
        },
        fields: 'pixelSize',
      },
    },
    // 3. Title column styling: Royal Crimson Maroon background (#7a121d) with Imperial Gold text (#ffea9f)
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.48, green: 0.07, blue: 0.11 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
            textFormat: {
              foregroundColor: { red: 1.0, green: 0.92, blue: 0.62 },
              bold: true,
              fontSize: 10,
            },
            padding: {
              top: 6,
              bottom: 6,
              left: 10,
              right: 10,
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)',
      },
    },
    // 4. Solid Imperial Gold bottom border under the title columns (#d4af37)
    {
      updateBorders: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
        bottom: {
          style: 'SOLID_MEDIUM',
          color: { red: 0.83, green: 0.69, blue: 0.22 },
        },
      },
    },
    // 5. Auto-resize columns to fit title column headers cleanly
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: colCount,
        },
      },
    },
  ];
}

/**
 * Export full fiscal dataset to Google Sheets via Sheets API v4
 */
export async function exportFiscalPackageToGoogleSheets({
  funds = [],
  budgets = [],
  transactions = [],
  spreadsheetId = null,
  user = null,
}) {
  const accessToken = await requestGoogleSheetsToken(true);
  const payload = buildFiscalSheetsPayload({ funds, budgets, transactions });

  let targetId = spreadsheetId;
  const sheetMap = new Map();

  // 1. Create spreadsheet if not supplied
  if (!targetId) {
    const createRes = await fetch(SHEETS_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        properties: {
          title: `CTU SSG Financial Audit & Ledger - ${new Date().toISOString().slice(0, 10)}`,
        },
        sheets: payload.sheets.map((s) => ({
          properties: { title: s.name },
        })),
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      throw new Error(`Failed to create Google Spreadsheet: ${err.error?.message || createRes.statusText}`);
    }

    const createdData = await createRes.json();
    targetId = createdData.spreadsheetId;
    (createdData.sheets || []).forEach((sh) => {
      if (sh.properties?.title) {
        sheetMap.set(sh.properties.title, sh.properties.sheetId);
      }
    });
  } else {
    // For existing spreadsheets, retrieve tab metadata and sheet IDs
    const metaRes = await fetch(`${SHEETS_API_BASE}/${targetId}?fields=sheets.properties(sheetId,title)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      (metaData.sheets || []).forEach((sh) => {
        if (sh.properties?.title) {
          sheetMap.set(sh.properties.title, sh.properties.sheetId);
        }
      });
    }

    // Auto-create any missing tabs in the existing spreadsheet
    const missingSheets = payload.sheets.filter((s) => !sheetMap.has(s.name));
    if (missingSheets.length > 0) {
      const addSheetRequests = missingSheets.map((s) => ({
        addSheet: { properties: { title: s.name } },
      }));
      const addRes = await fetch(`${SHEETS_API_BASE}/${targetId}:batchUpdate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ requests: addSheetRequests }),
      });
      if (addRes.ok) {
        const addData = await addRes.json();
        (addData.replies || []).forEach((reply) => {
          const props = reply.addSheet?.properties;
          if (props?.title) {
            sheetMap.set(props.title, props.sheetId);
          }
        });
      }
    }
  }

  // 2. Format values for batch update
  const valueRanges = payload.sheets.map((s) => ({
    range: `'${s.name}'!A1`,
    values: [s.headers, ...s.rows],
  }));

  const updateRes = await fetch(`${SHEETS_API_BASE}/${targetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: valueRanges,
    }),
  });

  if (!updateRes.ok) {
    const err = await updateRes.json().catch(() => ({}));
    throw new Error(`Failed to write financial data to Google Sheets: ${err.error?.message || updateRes.statusText}`);
  }

  // 3. Apply professional design formatting to Title Columns across all tabs
  const formattingRequests = [];
  for (const sheet of payload.sheets) {
    const sId = sheetMap.get(sheet.name);
    if (sId !== undefined) {
      const reqs = buildTitleColumnFormattingRequests({
        sheetId: sId,
        headers: sheet.headers,
        totalRows: sheet.rows.length + 1,
      });
      formattingRequests.push(...reqs);
    }
  }

  if (formattingRequests.length > 0) {
    try {
      const formatRes = await fetch(`${SHEETS_API_BASE}/${targetId}:batchUpdate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ requests: formattingRequests }),
      });
      if (!formatRes.ok) {
        console.warn('[FinanceSync] Non-blocking title column formatting notice:', await formatRes.text().catch(() => ''));
      }
    } catch (fmtErr) {
      console.warn('[FinanceSync] Non-blocking formatting notice:', fmtErr.message);
    }
  }

  // 4. Log to Institutional Audit Trail
  try {
    await auditService.log({
      action: 'FINANCE_SHEETS_EXPORT',
      details: `Exported financial package to Google Spreadsheet ${targetId}`,
      entityType: 'finance_ledger',
      entityId: targetId,
      userRole: user?.role || 'admin',
      userName: user?.displayName || user?.email || 'SSG Officer',
      metadata: {
        spreadsheetId: targetId,
        sheetsCount: payload.sheets.length,
        transactionsExported: transactions.length,
      },
    });
  } catch (auditErr) {
    console.warn('[FinanceSync] Non-blocking audit log warning:', auditErr.message);
  }

  return {
    success: true,
    spreadsheetId: targetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${targetId}/edit`,
    sheetsCount: payload.sheets.length,
    timestamp: new Date().toISOString(),
  };
}

export default {
  getConfiguredGoogleClientId,
  isGoogleOAuthConfigured,
  getGoogleConnectionStatus,
  requestGoogleSheetsToken,
  buildFiscalSheetsPayload,
  buildTitleColumnFormattingRequests,
  exportFiscalPackageToGoogleSheets,
};
