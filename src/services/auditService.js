// services/auditService.js
// PURPOSE: Centralized Institutional Audit Trail Service
// FEATURES:
//   - Standardized 3-letter security codes (AAD, ADL, IAD, IUP, IDL, DAD, DDL, CDL, etc.)
//   - Zero UID leakage (records human-readable actor names and timestamps only)
//   - Compact, high-readability differential summaries (no raw JSON clutter)
//   - Backward-compatible mapping for legacy audit entries

import { db } from '../firebase/firebaseConfig.js';
import { 
  collection, 
  doc, 
  setDoc, 
  serverTimestamp 
} from 'firebase/firestore';

const AUDIT_LOGS_COLLECTION = 'audit_logs';

/**
 * Standardized 3-Letter Security Codes Catalog with Colors & Categorization
 */
export const AUDIT_CODE_DEFINITIONS = {
  // Announcements (Add and Delete only)
  AAD: {
    code: 'AAD',
    module: 'Announcements',
    label: 'Announcement Added',
    description: 'New campus bulletin or dispatch published',
    color: '#10B981', // Emerald Green
    bg: 'rgba(16, 185, 129, 0.15)',
    border: 'rgba(16, 185, 129, 0.35)'
  },
  ADL: {
    code: 'ADL',
    module: 'Announcements',
    label: 'Announcement Deleted',
    description: 'Campus bulletin or dispatch permanently removed',
    color: '#EF4444', // Red
    bg: 'rgba(239, 68, 68, 0.15)',
    border: 'rgba(239, 68, 68, 0.35)'
  },

  // Inventory (All CRUD: Add, Update, Delete)
  IAD: {
    code: 'IAD',
    module: 'Inventory',
    label: 'Inventory Added',
    description: 'New equipment, supply, or asset registered in system',
    color: '#10B981',
    bg: 'rgba(16, 185, 129, 0.15)',
    border: 'rgba(16, 185, 129, 0.35)'
  },
  IUP: {
    code: 'IUP',
    module: 'Inventory',
    label: 'Inventory Updated',
    description: 'Asset specification, condition, or stock quantity altered',
    color: '#3B82F6', // Sky Blue
    bg: 'rgba(59, 130, 246, 0.15)',
    border: 'rgba(59, 130, 246, 0.35)'
  },
  IDL: {
    code: 'IDL',
    module: 'Inventory',
    label: 'Inventory Deleted',
    description: 'Asset record decommissioned and removed from registry',
    color: '#EF4444',
    bg: 'rgba(239, 68, 68, 0.15)',
    border: 'rgba(239, 68, 68, 0.35)'
  },

  // Documents (Add and Delete only)
  DAD: {
    code: 'DAD',
    module: 'Documents',
    label: 'Document Added',
    description: 'Official file, resolution, or memorandum uploaded',
    color: '#10B981',
    bg: 'rgba(16, 185, 129, 0.15)',
    border: 'rgba(16, 185, 129, 0.35)'
  },
  DDL: {
    code: 'DDL',
    module: 'Documents',
    label: 'Document Deleted',
    description: 'Document permanently deleted from institutional archive',
    color: '#EF4444',
    bg: 'rgba(239, 68, 68, 0.15)',
    border: 'rgba(239, 68, 68, 0.35)'
  },

  // Commerce (Deletions only)
  CDL: {
    code: 'CDL',
    module: 'Commerce Hub',
    label: 'Commerce Deletion',
    description: 'Store product, catalog item, or order record purged',
    color: '#F43F5E', // Rose Crimson
    bg: 'rgba(244, 63, 94, 0.15)',
    border: 'rgba(244, 63, 94, 0.35)'
  },

  // Budget & Finance Operations
  BAD: {
    code: 'BAD',
    module: 'Finance',
    label: 'Budget Added',
    description: 'New fiscal allocation or department budget created',
    color: '#10B981',
    bg: 'rgba(16, 185, 129, 0.15)',
    border: 'rgba(16, 185, 129, 0.35)'
  },
  BUP: {
    code: 'BUP',
    module: 'Finance',
    label: 'Budget Updated',
    description: 'Allocation adjustments or budget metadata revised',
    color: '#3B82F6',
    bg: 'rgba(59, 130, 246, 0.15)',
    border: 'rgba(59, 130, 246, 0.35)'
  },
  BDL: {
    code: 'BDL',
    module: 'Finance',
    label: 'Budget Deleted',
    description: 'Budget line item or allocation allocation removed',
    color: '#EF4444',
    bg: 'rgba(239, 68, 68, 0.15)',
    border: 'rgba(239, 68, 68, 0.35)'
  },
  EAD: {
    code: 'EAD',
    module: 'Finance',
    label: 'Expense Added',
    description: 'Expenditure disbursed or disbursement voucher filed',
    color: '#F59E0B', // Amber
    bg: 'rgba(245, 158, 11, 0.15)',
    border: 'rgba(245, 158, 11, 0.35)'
  },
  EDL: {
    code: 'EDL',
    module: 'Finance',
    label: 'Expense Deleted',
    description: 'Disbursement transaction cancelled or removed',
    color: '#EF4444',
    bg: 'rgba(239, 68, 68, 0.15)',
    border: 'rgba(239, 68, 68, 0.35)'
  },

  // Identity & User Security
  UAD: {
    code: 'UAD',
    module: 'User Management',
    label: 'User Provisioned',
    description: 'New officer or institutional account onboarded',
    color: '#8B5CF6', // Purple
    bg: 'rgba(139, 92, 246, 0.15)',
    border: 'rgba(139, 92, 246, 0.35)'
  },
  UUP: {
    code: 'UUP',
    module: 'User Management',
    label: 'User Modified',
    description: 'Account profile details or status modified',
    color: '#F59E0B',
    bg: 'rgba(245, 158, 11, 0.15)',
    border: 'rgba(245, 158, 11, 0.35)'
  },
  UDL: {
    code: 'UDL',
    module: 'User Management',
    label: 'User Deactivated',
    description: 'User access revoked or account deleted',
    color: '#EF4444',
    bg: 'rgba(239, 68, 68, 0.15)',
    border: 'rgba(239, 68, 68, 0.35)'
  },
  ROL: {
    code: 'ROL',
    module: 'Security & Access',
    label: 'Role Elevation',
    description: 'Executive role or permission overrides altered',
    color: '#14B8A6', // Teal
    bg: 'rgba(20, 184, 166, 0.15)',
    border: 'rgba(20, 184, 166, 0.35)'
  }
};

/**
 * Legacy action code mapping for backward compatibility with existing DB entries
 */
const LEGACY_CODE_MAP = {
  budget_created: 'BAD',
  budget_updated: 'BUP',
  budget_deleted: 'BDL',
  expense_created: 'EAD',
  expense_updated: 'BUP',
  expense_deleted: 'EDL',
  income_created: 'BAD',
  user_created: 'UAD',
  user_updated: 'UUP',
  user_deleted: 'UDL',
  role_changed: 'ROL',
  permissions_changed: 'ROL',
  permission_overrides_changed: 'ROL'
};

/**
 * Normalizes any action string into a valid 3-letter code
 */
export const normalizeAuditCode = (rawAction) => {
  if (!rawAction) return 'GEN';
  const upper = rawAction.toUpperCase();
  if (AUDIT_CODE_DEFINITIONS[upper]) return upper;
  if (LEGACY_CODE_MAP[rawAction.toLowerCase()]) return LEGACY_CODE_MAP[rawAction.toLowerCase()];
  return 'GEN';
};

/**
 * Resolves full code meta
 */
export const getAuditCodeMeta = (actionCode) => {
  const code = normalizeAuditCode(actionCode);
  return AUDIT_CODE_DEFINITIONS[code] || {
    code: code || 'GEN',
    module: 'System',
    label: code || 'System Event',
    description: 'General system operation recorded',
    color: '#64748B',
    bg: 'rgba(100, 116, 139, 0.15)',
    border: 'rgba(100, 116, 139, 0.35)'
  };
};

/**
 * Core Audit Service Object
 */
export const auditService = {
  /**
   * Universal logging engine
   */
  async log({
    actionCode,
    module,
    performedBy,
    itemName,
    itemType = null,
    summary = ''
  }) {
    try {
      const code = normalizeAuditCode(actionCode);
      const meta = getAuditCodeMeta(code);
      const logRef = doc(collection(db, AUDIT_LOGS_COLLECTION));

      // Resolve human readable performer name - zero UID exposure
      const performerClean = (typeof performedBy === 'string' && performedBy.trim()) 
        ? performedBy.trim() 
        : 'Authorized Officer';

      const entry = {
        action: code,
        module: module || meta.module,
        performedBy: performerClean,
        itemName: itemName || 'Institutional Resource',
        itemType: itemType || meta.module,
        summary: summary || meta.description,
        timestamp: serverTimestamp()
      };

      await setDoc(logRef, entry);
    } catch (error) {
      console.error('[auditService] Logging failed:', error);
      // Fail silently to never block active user CRUD flows
    }
  },

  // ─── ANNOUNCEMENT LOGS (Add and Delete ONLY) ──────────────────────────
  async logAnnouncementAdd(performerName, title, category = 'General') {
    return this.log({
      actionCode: 'AAD',
      module: 'Announcements',
      performedBy: performerName,
      itemName: title,
      itemType: 'Campus Dispatch',
      summary: `+ Published announcement: "${title}" [${category}]`
    });
  },

  async logAnnouncementDelete(performerName, title) {
    return this.log({
      actionCode: 'ADL',
      module: 'Announcements',
      performedBy: performerName,
      itemName: title,
      itemType: 'Campus Dispatch',
      summary: `- Deleted announcement: "${title}"`
    });
  },

  // ─── INVENTORY LOGS (All CRUD Operations) ─────────────────────────────
  async logInventoryAdd(performerName, itemName, quantity, category) {
    const qtyText = quantity ? ` (Qty: ${quantity})` : '';
    const catText = category ? ` [${category}]` : '';
    return this.log({
      actionCode: 'IAD',
      module: 'Inventory',
      performedBy: performerName,
      itemName,
      itemType: 'Equipment/Asset',
      summary: `+ Registered new asset "${itemName}"${qtyText}${catText}`
    });
  },

  async logInventoryUpdate(performerName, itemName, changeNotes) {
    return this.log({
      actionCode: 'IUP',
      module: 'Inventory',
      performedBy: performerName,
      itemName,
      itemType: 'Equipment/Asset',
      summary: changeNotes || `Modified asset record "${itemName}"`
    });
  },

  async logInventoryDelete(performerName, itemName) {
    return this.log({
      actionCode: 'IDL',
      module: 'Inventory',
      performedBy: performerName,
      itemName,
      itemType: 'Equipment/Asset',
      summary: `- Decommissioned and removed asset "${itemName}"`
    });
  },

  // ─── DOCUMENTS LOGS (Add and Delete ONLY) ──────────────────────────────
  async logDocumentAdd(performerName, docTitle, category) {
    const catText = category ? ` [${category}]` : '';
    return this.log({
      actionCode: 'DAD',
      module: 'Documents',
      performedBy: performerName,
      itemName: docTitle,
      itemType: 'Official Archive',
      summary: `+ Stored document "${docTitle}"${catText}`
    });
  },

  async logDocumentDelete(performerName, docTitle) {
    return this.log({
      actionCode: 'DDL',
      module: 'Documents',
      performedBy: performerName,
      itemName: docTitle,
      itemType: 'Official Archive',
      summary: `- Permanently purged document "${docTitle}"`
    });
  },

  // ─── COMMERCE LOGS (Deletions ONLY) ────────────────────────────────────
  async logCommerceDelete(performerName, itemTitle, itemType = 'Product Catalog', reason = '') {
    const reasonText = reason ? ` | Reason: ${reason}` : '';
    return this.log({
      actionCode: 'CDL',
      module: 'Commerce Hub',
      performedBy: performerName,
      itemName: itemTitle,
      itemType,
      summary: `- Purged ${itemType.toLowerCase()} "${itemTitle}"${reasonText}`
    });
  }
};

export default auditService;
