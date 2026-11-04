/**
 * Browser Adapter for Centralized Google Sheets Order Sync.
 * Connects Google Identity Services (OAuth 2.0 Token Client), Google Sheets REST API v4,
 * Firestore (`settings/commerceOrderSheet` & `orders`), and Institutional Audit Trail
 * into `createCentralizedOrderSheetOrchestrator`.
 *
 * SECURITY INVARIANT (AGENTS.md):
 * Client-side browser code reads ONLY the public OAuth Client ID (`VITE_GOOGLE_OAUTH_CLIENT_ID`).
 * Client secrets are NEVER read, bundled, or referenced in browser code.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig.js';
import { auditService } from './auditService.js';
import { createCentralizedOrderSheetOrchestrator } from '../components/Data/centralizedOrderSheetOrchestrator.js';

export const GOOGLE_SHEETS_RW_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const GIS_SCRIPT_ID = 'google-identity-services-sdk';
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let gisLoadPromise = null;
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

function loadGoogleIdentityScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Identity Services requires a browser environment.'));
  }
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve(window.google);
  }
  if (gisLoadPromise) {
    return gisLoadPromise;
  }

  gisLoadPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(GIS_SCRIPT_ID);
    if (existing) {
      if (window.google?.accounts?.oauth2) {
        resolve(window.google);
        return;
      }
      // Remove stale or previously failed script tag so retry actually reloads
      existing.remove();
    }

    const script = document.createElement('script');
    script.id = GIS_SCRIPT_ID;
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) {
        resolve(window.google);
      } else {
        gisLoadPromise = null;
        reject(new Error('Google Identity Services loaded without OAuth2 Token Client.'));
      }
    };
    script.onerror = () => {
      gisLoadPromise = null;
      const err = new Error(
        'Cannot load Google Sign-In right now. Check your Wi-Fi connection or disable any strict ad-blocker on this page, then try again.'
      );
      err.code = 'NETWORK_OFFLINE';
      reject(err);
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

export async function connectGoogleSheetsAccount({ prompt = 'consent', loginHint = '' } = {}) {
  const clientId = getConfiguredGoogleClientId();
  if (!clientId) {
    const err = new Error(
      'Google OAuth Client ID is not configured. Set VITE_GOOGLE_OAUTH_CLIENT_ID in your local environment and restart the dev server.'
    );
    err.code = 'MISSING_CLIENT_ID';
    throw err;
  }

  const googleObj = await loadGoogleIdentityScript();

  return new Promise((resolve, reject) => {
    const tokenClient = googleObj.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SHEETS_RW_SCOPE,
      hint: loginHint || undefined,
      callback: (response) => {
        if (response?.error) {
          const rawCode = String(response.error);
          if (rawCode === 'access_denied') {
            const err = new Error(
              'Google Sign-In was declined (Error 403: access_denied). Either the popup was cancelled, the Google Sheets permission box was left unchecked, or your Gmail needs to be added under Google Cloud Console → Audience → Test Users.'
            );
            err.code = 'OAUTH_ACCESS_DENIED';
            reject(err);
            return;
          }
          if (rawCode === 'interaction_required' || rawCode === 'login_required') {
            const err = new Error(
              'Please click "Connect Google Account" (or "Reconnect Google") first so Google can verify your session.'
            );
            err.code = 'GOOGLE_SESSION_EXPIRED';
            reject(err);
            return;
          }
          const err = new Error(
            response.error_description || `Google authorization failed (${rawCode}).`
          );
          err.code = rawCode;
          reject(err);
          return;
        }
        const expiresInSec = Number(response?.expires_in) || 3600;
        tokenSession = {
          accessToken: response.access_token,
          expiresAt: Date.now() + expiresInSec * 1000,
        };
        resolve({
          accessToken: tokenSession.accessToken,
          expiresAt: tokenSession.expiresAt,
        });
      },
      error_callback: (errResp) => {
        const type = errResp?.type || 'popup_closed';
        if (type === 'popup_failed_to_open') {
          const err = new Error(
            'Your browser blocked the Google Sign-In popup window. Click the popup-blocked icon in your browser address bar to allow popups for this site, then click "Connect Google Account".'
          );
          err.code = 'OAUTH_POPUP_BLOCKED';
          reject(err);
          return;
        }
        if (type === 'popup_closed') {
          const err = new Error(
            'The Google Sign-In window was closed before finishing. Click "Connect Google Account" whenever you are ready to continue.'
          );
          err.code = 'OAUTH_POPUP_CLOSED';
          reject(err);
          return;
        }
        const err = new Error(`Google Sign-In error: ${errResp?.message || type}`);
        err.code = type;
        reject(err);
      },
    });

    tokenClient.requestAccessToken({ prompt });
  });
}

export function disconnectGoogleSheetsAccount() {
  const tokenToRevoke = tokenSession.accessToken;
  tokenSession = { accessToken: null, expiresAt: 0 };
  if (tokenToRevoke && typeof window !== 'undefined' && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(tokenToRevoke, () => {});
    } catch {
      // Ignore revoke network errors when clearing session
    }
  }
}

async function ensureValidAccessToken({ loginHint = '' } = {}) {
  const status = getGoogleConnectionStatus();
  if (status.connected && tokenSession.accessToken) {
    return tokenSession.accessToken;
  }
  try {
    const fresh = await connectGoogleSheetsAccount({ prompt: '', loginHint });
    return fresh.accessToken;
  } catch (err) {
    if (
      err?.code === 'OAUTH_POPUP_BLOCKED' ||
      err?.code === 'OAUTH_POPUP_CLOSED' ||
      err?.code === 'GOOGLE_SESSION_EXPIRED'
    ) {
      const sessionErr = new Error(
        'Your Google Sheets session is not connected yet (or expired after 1 hour). Click "Connect Google Account" at the top right, then run your sync action again.'
      );
      sessionErr.code = 'GOOGLE_SESSION_EXPIRED';
      throw sessionErr;
    }
    throw err;
  }
}

function columnIndexToLetter(zeroBasedIndex) {
  let n = Math.max(0, Number(zeroBasedIndex) || 0) + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters || 'A';
}

function quoteSheetTitleForA1(sheetTitle) {
  const clean = String(sheetTitle || 'Sheet1').replace(/'/g, "''");
  return `'${clean}'`;
}

async function sheetsFetch(path, { method = 'GET', body = null, loginHint = '' } = {}) {
  const accessToken = await ensureValidAccessToken({ loginHint });
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${SHEETS_API_BASE}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    // Clear expired/revoked token so next retry triggers fresh consent
    tokenSession = { accessToken: null, expiresAt: 0 };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const apiMessage =
      payload?.error?.message || `Google Sheets API request failed (HTTP ${response.status}).`;
    const err = new Error(apiMessage);
    err.status = response.status;
    err.details = payload?.error || null;
    throw err;
  }

  return payload;
}

function buildTemplateFormattingRequests({ sheetId = 0, headers = [], validations = {} }) {
  const colCount = Math.max(headers.length, 1);
  const requests = [
    // 1. Freeze Row 1 header
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // 2. Royal Maroon & Gold header bar styling
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
            backgroundColor: { red: 0.36, green: 0.05, blue: 0.09 },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            textFormat: {
              foregroundColor: { red: 0.98, green: 0.87, blue: 0.58 },
              bold: true,
              fontSize: 10,
            },
          },
        },
        fields:
          'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
  ];

  // 3. Dropdown validations on Status and Payment columns
  for (const [headerLabel, allowedValues] of Object.entries(validations || {})) {
    const colIdx = headers.findIndex(
      (h) => String(h || '').trim().toLowerCase() === String(headerLabel).trim().toLowerCase()
    );
    if (colIdx >= 0 && Array.isArray(allowedValues) && allowedValues.length > 0) {
      requests.push({
        setDataValidation: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: 1500,
            startColumnIndex: colIdx,
            endColumnIndex: colIdx + 1,
          },
          rule: {
            condition: {
              type: 'ONE_OF_LIST',
              values: allowedValues.map((v) => ({ userEnteredValue: String(v) })),
            },
            showCustomUi: true,
            strict: false,
          },
        },
      });
    }
  }

  // 4. Auto-resize columns to fit header labels cleanly
  requests.push({
    autoResizeDimensions: {
      dimensions: {
        sheetId,
        dimension: 'COLUMNS',
        startIndex: 0,
        endIndex: colCount,
      },
    },
  });

  return requests;
}

export function createBrowserSheetsGateway({ loginHint = '' } = {}) {
  return {
    async createSpreadsheet({
      title,
      sheetTitle = 'Commerce Hub Orders',
      headers = [],
      rows = [],
      validations = {},
    }) {
      const created = await sheetsFetch('', {
        method: 'POST',
        loginHint,
        body: {
          properties: { title },
          sheets: [
            {
              properties: {
                title: sheetTitle,
                gridProperties: {
                  rowCount: Math.max(1500, rows.length + 100),
                  columnCount: Math.max(18, headers.length),
                },
              },
            },
          ],
        },
      });

      const spreadsheetId = created.spreadsheetId;
      const createdTabProps = created.sheets?.[0]?.properties || {};
      const createdSheetId = createdTabProps.sheetId ?? 0;
      const createdSheetTitle = createdTabProps.title || sheetTitle;

      const valuesMatrix = [headers, ...rows];
      const rangeA1 = `${quoteSheetTitleForA1(createdSheetTitle)}!A1`;
      await sheetsFetch(
        `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          loginHint,
          body: { values: valuesMatrix },
        }
      );

      const requests = buildTemplateFormattingRequests({
        sheetId: createdSheetId,
        headers,
        validations,
      });
      await sheetsFetch(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
        method: 'POST',
        loginHint,
        body: { requests },
      });

      return {
        spreadsheetId,
        spreadsheetTitle: created.properties?.title || title,
        spreadsheetUrl:
          created.spreadsheetUrl ||
          `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        tabs: [{ sheetId: createdSheetId, sheetTitle: createdSheetTitle }],
      };
    },

    async getSpreadsheetMetadata(spreadsheetId) {
      const data = await sheetsFetch(
        `/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)`,
        { method: 'GET', loginHint }
      );
      return {
        spreadsheetId: data.spreadsheetId,
        spreadsheetTitle: data.properties?.title || 'Untitled Spreadsheet',
        spreadsheetUrl:
          data.spreadsheetUrl ||
          `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
        tabs: (data.sheets || []).map((s) => ({
          sheetId: s.properties?.sheetId ?? 0,
          sheetTitle: s.properties?.title || 'Sheet1',
        })),
      };
    },

    async readTabValues(spreadsheetId, sheetTitle) {
      const range = `${quoteSheetTitleForA1(sheetTitle)}!A1:ZZ5000`;
      const data = await sheetsFetch(
        `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
        { method: 'GET', loginHint }
      );
      const values = Array.isArray(data?.values) ? data.values : [];
      return {
        headers: values[0] || [],
        rows: values.slice(1),
      };
    },

    async initializeTemplateOnTab({ spreadsheetId, sheetId, sheetTitle, headers, validations }) {
      const rangeA1 = `${quoteSheetTitleForA1(sheetTitle)}!A1`;
      await sheetsFetch(
        `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          loginHint,
          body: { values: [headers] },
        }
      );

      const requests = buildTemplateFormattingRequests({
        sheetId,
        headers,
        validations,
      });
      await sheetsFetch(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
        method: 'POST',
        loginHint,
        body: { requests },
      });
    },

    async writeTabUpdates({ spreadsheetId, sheetTitle, rowUpdates = [], appendRows = [] }) {
      const quotedTab = quoteSheetTitleForA1(sheetTitle);

      if (rowUpdates.length > 0) {
        const batchData = rowUpdates.map(({ rowIndex, values }) => ({
          range: `${quotedTab}!A${rowIndex + 2}`,
          values: [values],
        }));

        await sheetsFetch(`/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
          method: 'POST',
          loginHint,
          body: {
            valueInputOption: 'USER_ENTERED',
            data: batchData,
          },
        });
      }

      if (appendRows.length > 0) {
        const maxCols = Math.max(1, ...appendRows.map((r) => (Array.isArray(r) ? r.length : 1)));
        const endColLetter = columnIndexToLetter(maxCols - 1);
        const appendRange = `${quotedTab}!A1:${endColLetter}1`;
        await sheetsFetch(
          `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          {
            method: 'POST',
            loginHint,
            body: {
              values: appendRows,
            },
          }
        );
      }

      return {
        updatedRows: rowUpdates.length,
        appendedRows: appendRows.length,
      };
    },
  };
}

export function subscribeToCentralizedOrderSheet(onChange, onError) {
  const settingsRef = doc(db, 'settings', 'commerceOrderSheet');
  return onSnapshot(
    settingsRef,
    (snap) => {
      onChange(snap.exists() ? snap.data() : null);
    },
    (err) => {
      console.error('[googleSheetsOrderSyncService] Settings subscription error:', err);
      if (onError) onError(err);
    }
  );
}

export function createBrowserCentralizedOrderSheetOrchestrator(actorUser) {
  const settingsRef = doc(db, 'settings', 'commerceOrderSheet');

  const settingsRepo = {
    async get() {
      const snap = await getDoc(settingsRef);
      return snap.exists() ? snap.data() : null;
    },
    async save(nextDoc) {
      // Overwrite full settings document so switching from an 18-col template to a custom Google Form
      // cleanly replaces nested `columnMappings` without retaining stale keys from `{ merge: true }`
      await setDoc(settingsRef, nextDoc);
      return nextDoc;
    },
  };

  const ordersRepo = {
    async listAll() {
      const snap = await getDocs(collection(db, 'orders'));
      const list = snap.docs.map((d) => ({ docId: d.id, ...d.data() }));
      list.sort((a, b) => {
        const tA = new Date(a.dateOrdered || a.createdAt || 0).getTime() || 0;
        const tB = new Date(b.dateOrdered || b.createdAt || 0).getTime() || 0;
        return tB - tA;
      });
      return list;
    },
    async upsertBatch(items) {
      const existingSnap = await getDocs(collection(db, 'orders'));
      const existingByOrderId = new Map();
      existingSnap.docs.forEach((d) => {
        const data = d.data();
        if (data?.orderId) {
          existingByOrderId.set(String(data.orderId).trim().toUpperCase(), d.id);
        }
      });

      const BATCH_SIZE = 400;
      let created = 0;
      let updated = 0;
      const nowIso = new Date().toISOString();

      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = items.slice(i, i + BATCH_SIZE);

        for (const item of chunk) {
          const payload = { ...item };
          const explicitDocId = payload.docId;
          delete payload.docId;

          const normKey = String(payload.orderId || '')
            .trim()
            .toUpperCase();
          const targetDocId = explicitDocId || existingByOrderId.get(normKey);

          if (targetDocId) {
            const ref = doc(db, 'orders', targetDocId);
            batch.set(ref, { ...payload, updatedAt: nowIso }, { merge: true });
            updated += 1;
          } else {
            const ref = doc(collection(db, 'orders'));
            batch.set(ref, {
              ...payload,
              createdAt: payload.createdAt || nowIso,
              updatedAt: nowIso,
            });
            if (normKey) {
              existingByOrderId.set(normKey, ref.id);
            }
            created += 1;
          }
        }

        await batch.commit();
      }

      return { created, updated };
    },
  };

  const sheetsGateway = createBrowserSheetsGateway({
    loginHint: actorUser?.email || '',
  });

  return createCentralizedOrderSheetOrchestrator({
    actorUser,
    settingsRepo,
    ordersRepo,
    sheetsGateway,
    auditLogger: auditService,
  });
}

