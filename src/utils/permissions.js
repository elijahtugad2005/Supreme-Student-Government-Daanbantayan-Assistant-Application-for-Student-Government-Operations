// utils/permissions.js
// PURPOSE: Centralized permission checking utility
// USAGE: Import and use to check user permissions throughout the app

/**
 * Permission configuration for each role
 */
// ────────────────────────────────────────────────────────────
// DEATH AID
//
// Split into three deliberate tiers:
//   canSubmitDeathAid  the Mayor marks their students paid and files a collection
//   canViewOwnDeathAid read back collections they filed (needed for the audit trail)
//   canManageDeathAid  accept physical remittance and confirm — officers only,
//                      because a Mayor must never confirm their own money
// ────────────────────────────────────────────────────────────

/** Every signed-in role may file a collection for a section they own. */
export const canSubmitDeathAidFor = (role) => isSignedInRole(role);

/**
 * Roles allowed to accept a remittance and record themselves as the verifier.
 *
 * Deliberately an allowlist: any role not named here — including Members,
 * Guests, Senators and anyone whose only extra right is `canManageCreatives` —
 * is excluded automatically, because creators are not in the list. That keeps
 * the "except Creatives" exclusion from needing a separate deny rule that could
 * drift out of sync with this list.
 *
 * NOTE: this is intentionally WIDER than isOfficer() (admin/secretary), which
 * still governs roster verification and the section registry.
 */
export const DEATH_AID_MANAGER_ROLES = [
  'admin',
  'president',
  'vice_president',
  'secretary',
  'executive_secretary',
  'press_secretary',
  'linkages_secretary',
  'deputy_secretary',
  'finance_secretary',
  'auditor',
  'budget_officer',
  'governor',
  'representative',
  'senator',
];

export const canManageDeathAid = (user) =>
  DEATH_AID_MANAGER_ROLES.includes(user?.role);

export const canSubmitDeathAid = (user) => !!user?.role;

export const canViewOwnDeathAid = (user) => !!user?.role;

/**
 * Collection status lifecycle.
 */
export const DEATH_AID_COLLECTION_STATUS = {
  FOR_VERIFICATION: 'for_verification',
  CONFIRMED: 'confirmed',
  DISCREPANCY: 'discrepancy',
};

export const DEATH_AID_REMITTANCE_STATUS = {
  CONFIRMED: 'confirmed',
  DISCREPANCY: 'discrepancy',
  RESOLVED: 'resolved',
};

export const DEATH_AID_DEBT_TYPES = {
  NAMED: 'named',
  ANONYMOUS: 'anonymous',
  ABSENT: 'absent',
  LEFT_EARLY: 'left_early',
};

export const DEATH_AID_DEBT_TYPE_LABELS = {
  [DEATH_AID_DEBT_TYPES.NAMED]: 'Named student',
  [DEATH_AID_DEBT_TYPES.ANONYMOUS]: 'Not identified',
  [DEATH_AID_DEBT_TYPES.ABSENT]: 'Absent on collection day',
  [DEATH_AID_DEBT_TYPES.LEFT_EARLY]: 'Left after class',
};

export const DEATH_AID_STATUS_LABELS = {
  [DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION]: 'For Verification',
  [DEATH_AID_COLLECTION_STATUS.CONFIRMED]: 'Confirmed',
  [DEATH_AID_COLLECTION_STATUS.DISCREPANCY]: 'Discrepancy',
};

export const isSignedInRole = (role) => !!role;

export const ROLE_PERMISSIONS = {
  // ========================================================
  // EXECUTIVE LEADERSHIP (HIGHER ACCESS / GENERAL ACCESS)
  // ========================================================
  admin: {
    name: 'Administrator (President)',
    category: 'Executive Council',
    accessTier: 'Higher Access',
    description: 'General Access: Edit, update, and delete all operations in the Sidebar',
    permissions: {
      canManageProducts: true,
      canManageOrders: true,
      canManageUsers: true,
      canViewAnalytics: true,
      canViewFinance: true,
      canEditFinance: true,
      canExportData: true,
      canSendNotifications: true,
      canConfigureSystem: true,
      canDeleteData: true,
      canManageCreatives: true,
      canSubmitRoster: true,
      canViewRosters: true,
      canManageRosters: true
    }
  },

  president: {
    name: 'President',
    category: 'Executive Council',
    accessTier: 'Higher Access',
    description: 'General Access: Edit, update, and delete all operations across the system',
    permissions: {
      canManageProducts: true,
      canManageOrders: true,
      canManageUsers: true,
      canViewAnalytics: true,
      canViewFinance: true,
      canEditFinance: true,
      canExportData: true,
      canSendNotifications: true,
      canConfigureSystem: true,
      canDeleteData: true,
      canManageCreatives: true,
      canSubmitRoster: true,
      canViewRosters: true,
      canManageRosters: true
    }
  },

  vice_president: {
    name: 'Vice President',
    category: 'Executive Council',
    accessTier: 'Higher Access',
    description: 'Higher Access to Documents, Inventory, Finance, Audit Trail, and Commerce Hub',
    permissions: {
      canManageProducts: true,  // Inventory (Add, Edit, Delete)
      canManageOrders: true,    // Commerce Hub (Orders full access)
      canManageUsers: false,    // President/Admin only
      canViewAnalytics: true,
      canViewFinance: true,     // Finance full
      canEditFinance: true,
      canExportData: true,      // Documents
      canSendNotifications: true,
      canConfigureSystem: false,
      canDeleteData: true,      // Higher Access delete privilege
      canManageCreatives: true,
      canSubmitRoster: true,
      canViewRosters: true,
      canManageRosters: true
    }
  },

  // ========================================================
  // SECRETARIAT (HIGHER ACCESS TO DOCS, INVENTORY, SECTIONS)
  // ========================================================
  secretary: {
    name: 'Secretary (General)',
    category: 'Secretariat',
    accessTier: 'Higher Access',
    description: 'Higher Access to Documents, Inventory, and Sections & Contributions',
    permissions: {
      canManageProducts: true,
      canManageOrders: true,
      canManageUsers: false,
      canViewAnalytics: true,
      canViewFinance: true,     // view-only finance
      canEditFinance: false,
      canExportData: true,
      canSendNotifications: true,
      canConfigureSystem: false,
      canDeleteData: true,
      canManageCreatives: false,
      canSubmitRoster: true,
      canViewRosters: true,
      canManageRosters: true
    }
  },

  executive_secretary: {
    name: 'Executive Secretary',
    category: 'Secretariat',
    accessTier: 'Higher Access',
    description: 'Higher Access: Documents, Inventory, Sections & Contributions (Full CRUD)',
    permissions: {
      canManageProducts: true,
      canManageOrders: true,
      canManageUsers: false,
      canViewAnalytics: true,
      canViewFinance: true,
      canEditFinance: false,
      canExportData: true,
      canSendNotifications: true,
      canConfigureSystem: false,
      canDeleteData: true,
      canManageCreatives: false,
      canSubmitRoster: true,
      canViewRosters: true,
      canManageRosters: true
    }
  },

  press_secretary: {
    name: 'Press Secretary',
    category: 'Secretariat',
    accessTier: 'Higher Access',
    description: 'Higher Access: Documents, Inventory, Sections & Contributions, Announcements',
    permissions: {
      canManageProducts: true,
      canManageOrders: false,
      canManageUsers: false,
      canViewAnalytics: true,
      canViewFinance: false,
      canEditFinance: false,
      canExportData: true,
      canSendNotifications: true,
      canConfigureSystem: false,
      canDeleteData: true,
      canManageCreatives: true,
      canSubmitRoster: true,
      canViewRosters: true,
      canManageRosters: true
    }
  },

  linkages_secretary: {
    name: 'Secretary on Linkages',
    category: 'Secretariat',
    accessTier: 'Higher Access',
    description: 'Higher Access: Documents, Inventory, Sections & Contributions (External liaison)',
    permissions: {
      canManageProducts: true,
      canManageOrders: false,
      canManageUsers: false,
      canViewAnalytics: true,
      canViewFinance: false,
      canEditFinance: false,
      canExportData: true,
      canSendNotifications: true,
      canConfigureSystem: false,
      canDeleteData: true,
      canManageCreatives: false,
      canSubmitRoster: true,
      canViewRosters: true,
      canManageRosters: true
    }
  },

  deputy_secretary: {
    name: 'Deputy Secretary',
    category: 'Secretariat',
    accessTier: 'Higher Access',
    description: 'Higher Access: Documents, Inventory, Sections & Contributions (Full operations)',
    permissions: {
      canManageProducts: true,
      canManageOrders: false,
      canManageUsers: false,
      canViewAnalytics: true,
      canViewFinance: false,
      canEditFinance: false,
      canExportData: true,
      canSendNotifications: true,
      canConfigureSystem: false,
      canDeleteData: true,
      canManageCreatives: false,
      canSubmitRoster: true,
      canViewRosters: true,
      canManageRosters: true
    }
  },

  // ========================================================
  // FINANCE & AUDIT (HIGHER ACCESS TO FINANCE, INVENTORY, DOCS, COMMERCE, AUDIT)
  // ========================================================
  finance_secretary: {
    name: 'Finance Secretary',
    category: 'Treasury & Audit',
    accessTier: 'Higher Access',
    description: 'Higher Access: Finance, Inventory, Documents, Commerce Hub, and Audit Trail',
    permissions: {
      canManageProducts: true,  // Inventory (Higher Access)
      canManageOrders: true,    // Commerce Hub (Higher Access)
      canManageUsers: false,
      canViewAnalytics: true,
      canViewFinance: true,     // Finance (Higher Access)
      canEditFinance: true,     // Edit Finance
      canExportData: true,      // Documents (Higher Access)
      canSendNotifications: false,
      canConfigureSystem: false,
      canDeleteData: true,      // Higher Access delete privilege
      canManageCreatives: false,
      canSubmitRoster: true,
      canViewRosters: false,
      canManageRosters: false
    }
  },

  auditor: {
    name: 'Auditor',
    category: 'Treasury & Audit',
    accessTier: 'Higher Access',
    description: 'Higher Access: Finance, Inventory, Documents, Commerce Hub, and Audit Trail',
    permissions: {
      canManageProducts: true,
      canManageOrders: true,
      canManageUsers: false,
      canViewAnalytics: true,
      canViewFinance: true,
      canEditFinance: true,
      canExportData: true,
      canSendNotifications: false,
      canConfigureSystem: false,
      canDeleteData: true,
      canManageCreatives: false,
      canSubmitRoster: true,
      canViewRosters: false,
      canManageRosters: false
    }
  },

  budget_officer: {
    name: 'Budget Officer',
    category: 'Treasury & Audit',
    accessTier: 'Higher Access',
    description: 'Higher Access: Finance, Inventory, Documents, Commerce Hub, and Audit Trail',
    permissions: {
      canManageProducts: true,
      canManageOrders: true,
      canManageUsers: false,
      canViewAnalytics: true,
      canViewFinance: true,
      canEditFinance: true,
      canExportData: true,
      canSendNotifications: false,
      canConfigureSystem: false,
      canDeleteData: true,
      canManageCreatives: false,
      canSubmitRoster: true,
      canViewRosters: false,
      canManageRosters: false
    }
  },

  // ========================================================
  // LEGISLATIVE BODY (MEDIUM ACCESS: ADD & UPDATE, NO DELETE)
  // ========================================================
  senator: {
    name: 'Senator',
    category: 'Legislative Body',
    accessTier: 'Medium Access',
    description: 'Medium Access: Documents, Inventory, Sections, Announcements, Commerce (Cannot delete)',
    permissions: {
      canManageProducts: true,  // Inventory (Add, Update, Borrow)
      canManageOrders: true,    // Commerce Hub (Handle orders)
      canManageUsers: false,
      canViewAnalytics: false,
      canViewFinance: false,
      canEditFinance: false,
      canExportData: true,      // Documents
      canSendNotifications: true, // Announcements
      canConfigureSystem: false,
      canDeleteData: false,     // CANNOT DELETE
      canManageCreatives: true,
      canSubmitRoster: true,
      canViewRosters: true,
      canManageRosters: false
    }
  },

  representative: {
    name: 'Representative',
    category: 'Legislative Body',
    accessTier: 'Medium Access',
    description: 'Medium Access: Documents, Inventory, Sections, Announcements, Commerce (Cannot delete)',
    permissions: {
      canManageProducts: true,  // Inventory (Add, Update, Borrow)
      canManageOrders: true,    // Commerce Hub (Handle orders)
      canManageUsers: false,
      canViewAnalytics: false,
      canViewFinance: false,
      canEditFinance: false,
      canExportData: true,      // Documents
      canSendNotifications: true, // Announcements
      canConfigureSystem: false,
      canDeleteData: false,     // CANNOT DELETE
      canManageCreatives: false,
      canSubmitRoster: true,
      canViewRosters: true,
      canManageRosters: false
    }
  },

  // ========================================================
  // CREATIVE DEPARTMENT (ANNOUNCEMENTS ONLY)
  // ========================================================
  creatives: {
    name: 'Creative Department',
    category: 'Creative Unit',
    accessTier: 'Specialized Access',
    description: 'Announcements only: Manage institutional broadcasts and creative assets',
    permissions: {
      canManageProducts: false,
      canManageOrders: false,
      canManageUsers: false,
      canViewAnalytics: false,
      canViewFinance: false,
      canEditFinance: false,
      canExportData: false,
      canSendNotifications: true, // Announcements
      canConfigureSystem: false,
      canDeleteData: false,
      canManageCreatives: true,   // Creatives
      canSubmitRoster: false,
      canViewRosters: false,
      canManageRosters: false
    }
  },

  governor: {
    name: 'Governor',
    category: 'Collegiate Leadership',
    accessTier: 'Medium Access',
    description: 'Oversees college rosters, contributions, and localized initiatives',
    permissions: {
      canManageProducts: false,
      canManageOrders: false,
      canManageUsers: false,
      canViewAnalytics: true,
      canViewFinance: false,
      canEditFinance: false,
      canExportData: true,
      canSendNotifications: false,
      canConfigureSystem: false,
      canDeleteData: false,
      canManageCreatives: false,
      canSubmitRoster: true,
      canViewRosters: true,
      canManageRosters: false
    }
  },

  member: {
    name: 'Member',
    category: 'General Student Body',
    accessTier: 'Low Access',
    description: 'Basic student member access: View and order requisitions',
    permissions: {
      canManageProducts: false,
      canManageOrders: false,
      canManageUsers: false,
      canViewAnalytics: false,
      canViewFinance: false,
      canEditFinance: false,
      canExportData: false,
      canSendNotifications: false,
      canConfigureSystem: false,
      canDeleteData: false,
      canManageCreatives: false,
      canSubmitRoster: true,
      canViewRosters: false,
      canManageRosters: false
    }
  },

  guest: {
    name: 'Guest',
    category: 'General Student Body',
    accessTier: 'Low Access',
    description: 'Restricted access: Public browsing and class roster submission',
    permissions: {
      canManageProducts: false,
      canManageOrders: false,
      canManageUsers: false,
      canViewAnalytics: false,
      canViewFinance: false,
      canEditFinance: false,
      canExportData: false,
      canSendNotifications: false,
      canConfigureSystem: false,
      canDeleteData: false,
      canManageCreatives: false,
      canSubmitRoster: true,
      canViewRosters: false,
      canManageRosters: false
    }
  }
};

/**
 * Check if user has a specific permission
 * @param {Object} user - User object with role and permissions
 * @param {string} permission - Permission to check
 * @returns {boolean} True if user has permission
 */
export const hasPermission = (user, permission) => {
  if (!user || !user.role) return false;
  
  // Per-user overrides win over the role. This is what lets an Admin hand
  // individual access — or take it away — without inventing a new role.
  // Checked first, and deliberately separate from `permissions`, which is a
  // full snapshot of the role's defaults written at signup.
  if (user.permissionOverrides
      && user.permissionOverrides[permission] !== undefined) {
    return user.permissionOverrides[permission];
  }
  
  // Check custom permissions first (if they exist)
  if (user.permissions && user.permissions[permission] !== undefined) {
    return user.permissions[permission];
  }
  
  // Fall back to role-based permissions
  const rolePermissions = ROLE_PERMISSIONS[user.role]?.permissions;
  return rolePermissions ? rolePermissions[permission] || false : false;
};

/**
 * Every permission an Admin can toggle per user, grouped for the editor UI.
 * This is the full surface of the app's access control.
 */
export const PERMISSION_CATALOG = [
  {
    group: 'Roster',
    items: [
      { key: 'canSubmitRoster', label: 'Submit roster', hint: 'Upload a class list for verification' },
      { key: 'canViewRosters', label: 'View rosters', hint: 'See verified rosters and student lists' },
      { key: 'canManageRosters', label: 'Verify rosters', hint: 'Verify submissions and request corrections' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { key: 'canViewFinance', label: 'View finance', hint: 'See income, dues and budgets' },
      { key: 'canEditFinance', label: 'Edit finance', hint: 'Record income, expenses and budgets' },
    ],
  },
  {
    group: 'Members',
    items: [
      { key: 'canManageProducts', label: 'Manage members', hint: 'Add, edit and remove member records' },
      { key: 'canManageOrders', label: 'Place orders', hint: 'Create and manage member orders' },
      { key: 'canManageUsers', label: 'Manage users', hint: 'Assign roles and permissions' },
    ],
  },
  {
    group: 'Content',
    items: [
      { key: 'canViewAnalytics', label: 'View analytics', hint: 'See dashboard analytics' },
      { key: 'canSendNotifications', label: 'Send announcements', hint: 'Publish announcements and Telegram posts' },
      { key: 'canManageCreatives', label: 'Manage creatives', hint: 'Edit posts and creative assets' },
      { key: 'canExportData', label: 'Export data', hint: 'Download CSV/Excel exports' },
      { key: 'canConfigureSystem', label: 'Configure system', hint: 'Change system-wide settings' },
      { key: 'canDeleteData', label: 'Delete data', hint: 'Permanently remove records' },
    ],
  },
];

/** Flat list of every permission key, used for validation on save. */
export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.flatMap((g) =>
  g.items.map((i) => i.key)
);

/**
 * Turn a set of granted permission keys into a sparse override map, omitting
 * anything the role already allows.
 *
 * Only differences are stored, so a later change to the role's defaults still
 * reaches the user, and a "reset to role" action is simply an empty object.
 * @param {Set<string>|Array<string>} granted
 * @param {string} role
 */
export const buildOverrides = (granted, role) => {
  const base = ROLE_PERMISSIONS[role]?.permissions || {};

  // Accepts a Set, an array, or a plain {key: boolean} map. The map case is
  // trivial to pass by accident and would otherwise throw on `new Set()`.
  let set;
  if (granted instanceof Set) {
    set = granted;
  } else if (Array.isArray(granted)) {
    set = new Set(granted);
  } else if (granted && typeof granted === 'object') {
    set = new Set(Object.keys(granted).filter((key) => granted[key]));
  } else {
    set = new Set();
  }

  const overrides = {};

  // Walks the whole catalog, not just the granted keys, so a permission the
  // role already allows can be revoked as well as one it denies being granted.
  ALL_PERMISSION_KEYS.forEach((key) => {
    const wants = set.has(key);
    if (!!base[key] === wants) return; // already matches the role
    overrides[key] = wants;
  });

  return overrides;
};

/**
 * Effective permissions for a user: role defaults, then overrides applied.
 * Use this to show the resolved state in admin UI.
 */
export const effectivePermissions = (user) => {
  if (!user?.role) return {};
  const base = { ...(ROLE_PERMISSIONS[user.role]?.permissions || {}) };
  const overrides = user.permissionOverrides || {};
  ALL_PERMISSION_KEYS.forEach((key) => {
    if (overrides[key] !== undefined) base[key] = overrides[key];
  });
  return base;
};

/**
 * Whether this role may SUBMIT a roster.
 *
 * Mayors have no login and browse as 'public', which deliberately has no
 * ROLE_PERMISSIONS entry — so a plain hasPermission() check reports false for
 * them. The sidebar and ProtectedRoute both allow signed-out visitors through
 * their explicit guest bypass, which is why roster submission works for them
 * today. Use this helper instead of checking `canSubmitRoster` directly, so
 * that anonymous Mayors are not silently locked out later.
 */
export const canSubmitRosterFor = (role) =>
  role === 'public' || hasPermission({ role }, 'canSubmitRoster');

/**
 * Check if user has any of the specified permissions
 * @param {Object} user - User object
 * @param {string[]} permissions - Array of permissions to check
 * @returns {boolean} True if user has at least one permission
 */
export const hasAnyPermission = (user, permissions) => {
  return permissions.some(permission => hasPermission(user, permission));
};

/**
 * Check if user has all specified permissions
 * @param {Object} user - User object
 * @param {string[]} permissions - Array of permissions to check
 * @returns {boolean} True if user has all permissions
 */
export const hasAllPermissions = (user, permissions) => {
  return permissions.every(permission => hasPermission(user, permission));
};

/**
 * Get user's role name
 * @param {string} role - Role identifier
 * @returns {string} Human-readable role name
 */
export const getRoleName = (role) => {
  return ROLE_PERMISSIONS[role]?.name || 'Unknown';
};

/**
 * Get user's role description
 * @param {string} role - Role identifier
 * @returns {string} Role description
 */
export const getRoleDescription = (role) => {
  return ROLE_PERMISSIONS[role]?.description || 'No description available';
};

/**
 * Get all roles for dropdown/select components
 * @returns {Array} Array of role objects with id, name, and description
 */
export const getAllRoles = () => {
  return Object.entries(ROLE_PERMISSIONS).map(([id, data]) => ({
    id,
    name: data.name,
    category: data.category || 'General',
    accessTier: data.accessTier || 'General Access',
    description: data.description
  }));
};

/**
 * Get default permissions for a role
 * @param {string} role - Role identifier
 * @returns {Object} Default permissions object
 */
export const getDefaultPermissionsForRole = (role) => {
  return ROLE_PERMISSIONS[role]?.permissions || ROLE_PERMISSIONS.guest.permissions;
};

/**
 * Routes an Admin can open for a single user with a permission override, even
 * when that user's static role is not on the route's allowed list. Without this,
 * per-user access would look correct in User Management but never take effect.
 */
const ROUTE_PERMISSION_GRANTS = {
  '/admin': ['canManageUsers'],
  '/admin/users': ['canManageUsers'],
  '/admin/settings': ['canConfigureSystem'],
  '/admin/analytics': ['canViewAnalytics'],
  '/finance': ['canViewFinance'],
  '/inventory': ['canManageProducts'],
  '/products': ['canManageProducts'],
  '/products/manage': ['canManageProducts'],
  '/orders': ['canManageOrders'],
  '/orders/manage': ['canManageOrders'],
  '/documents': ['canExportData'],
  '/announcement': ['canSendNotifications'],
};

/**
 * Check if user can access a specific route/page
 * @param {Object} user - User object
 * @param {string} routeName - Route/page identifier
 * @returns {boolean} True if user can access the route
 */
export const canAccessRoute = (user, routeName) => {
  const routePermissions = {
    // Admin routes (President & Admin full operations)
    '/admin': ['admin', 'president'],
    '/admin/users': ['admin', 'president'],
    '/admin/analytics': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'press_secretary', 'linkages_secretary', 'deputy_secretary', 'finance_secretary', 'auditor', 'budget_officer'],
    '/admin/settings': ['admin', 'president'],
    '/admin/audit': ['admin', 'president', 'vice_president', 'finance_secretary', 'auditor', 'budget_officer'],

    // Management routes (Commerce Hub)
    '/products': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'finance_secretary', 'auditor', 'budget_officer', 'senator', 'representative'],
    '/products/manage': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'finance_secretary', 'auditor', 'budget_officer'],
    '/orders': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'finance_secretary', 'auditor', 'budget_officer', 'representative', 'senator', 'member'],
    '/orders/manage': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'finance_secretary', 'auditor', 'budget_officer', 'representative', 'senator'],
    '/commerce': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'finance_secretary', 'auditor', 'budget_officer', 'representative', 'senator', 'member'],

    // Finance — President, VP, Finance Secretary, Auditor, Budget Officer have Higher Access; Secretary can view
    '/finance': ['admin', 'president', 'vice_president', 'finance_secretary', 'auditor', 'budget_officer', 'secretary', 'executive_secretary'],

    // Inventory — President, VP, Secretaries, Finance, Auditor, Budget Officer, Senator, Representative
    '/inventory': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'press_secretary', 'linkages_secretary', 'deputy_secretary', 'finance_secretary', 'auditor', 'budget_officer', 'representative', 'senator'],

    // Sections & Contributions / Roster registry — All roles, public access enabled
    '/sections-contributions': ['public', 'admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'press_secretary', 'linkages_secretary', 'deputy_secretary', 'governor', 'finance_secretary', 'auditor', 'budget_officer', 'senator', 'representative', 'member', 'guest'],
    '/reports': ['public', 'admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'press_secretary', 'linkages_secretary', 'deputy_secretary', 'governor', 'finance_secretary', 'auditor', 'budget_officer', 'senator', 'representative', 'member', 'guest'],

    // Documents — President, VP, Secretaries, Finance, Auditor, Budget Officer, Senator, Representative
    '/documents': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'press_secretary', 'linkages_secretary', 'deputy_secretary', 'finance_secretary', 'auditor', 'budget_officer', 'representative', 'senator'],

    // Announcements — President, VP, Press Secretary, Senator, Representative, Creatives
    '/announcement': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'press_secretary', 'linkages_secretary', 'deputy_secretary', 'senator', 'representative', 'creatives'],

    // Member routes
    '/profile': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'press_secretary', 'linkages_secretary', 'deputy_secretary', 'finance_secretary', 'auditor', 'budget_officer', 'senator', 'representative', 'creatives', 'governor', 'member'],
    '/orders/history': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'finance_secretary', 'representative', 'senator', 'member'],

    // Public routes
    '/': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'press_secretary', 'linkages_secretary', 'deputy_secretary', 'finance_secretary', 'auditor', 'budget_officer', 'senator', 'representative', 'creatives', 'governor', 'member', 'guest'],
    '/login': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'press_secretary', 'linkages_secretary', 'deputy_secretary', 'finance_secretary', 'auditor', 'budget_officer', 'senator', 'representative', 'creatives', 'governor', 'member', 'guest'],
    '/about': ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', 'press_secretary', 'linkages_secretary', 'deputy_secretary', 'finance_secretary', 'auditor', 'budget_officer', 'senator', 'representative', 'creatives', 'governor', 'member', 'guest']
  };

  const allowedRoles = routePermissions[routeName] ||
    ['admin', 'president', 'vice_president', 'secretary', 'finance_secretary', 'senator', 'representative', 'member', 'guest'];

  if (!user?.role) return false;

  const grants = ROUTE_PERMISSION_GRANTS[routeName];

  // An explicit revocation from an Admin outranks the static role list
  if (
    grants &&
    user.permissionOverrides &&
    grants.some((permission) => user.permissionOverrides[permission] === false)
  ) {
    return false;
  }

  if (allowedRoles.includes(user.role)) return true;

  // A per-user grant opens the route even when the static role list would not
  return !!grants && grants.some((permission) => hasPermission(user, permission));
};

/**
 * Get filtered navigation items based on user role
 * @param {Object} user - User object
 * @param {Array} navItems - Array of navigation items
 * @returns {Array} Filtered navigation items
 */
export const filterNavigationByRole = (user, navItems) => {
  return navItems.filter(item => {
    // If item has no roles specified, show to everyone
    if (!item.roles) return true;
    
    // Check if user's role is in the allowed roles
    return item.roles.includes(user?.role);
  });
};

/**
 * Check if user can perform an action on a resource
 * @param {Object} user - User object
 * @param {string} action - Action to perform (create, read, update, delete)
 * @param {string} resourceType - Type of resource
 * @param {Object} resource - Resource object (optional)
 * @returns {boolean} True if user can perform the action
 */
export const canPerformAction = (user, action, resourceType, resource = null) => {
  // President & Admin have full general access (Create, Read, Update, Delete across all operations)
  if (user?.role === 'admin' || user?.role === 'president') return true;

  const role = user?.role;
  const canDeleteGlobally = hasPermission(user, 'canDeleteData');

  // Vice President (Higher Access: Documents, Inventory, Finance, Audit Trail, Commerce Hub)
  if (role === 'vice_president') {
    switch (resourceType) {
      case 'document':
      case 'inventory':
      case 'product':
      case 'finance':
      case 'order':
      case 'audit':
        return true; // Full Add, Update, Delete
      case 'user':
        return action === 'read';
      default:
        return false;
    }
  }

  // Secretariat (Higher Access: Documents, Inventory, Sections & Contributions)
  const SECRETARY_ROLES = ['secretary', 'executive_secretary', 'press_secretary', 'linkages_secretary', 'deputy_secretary'];
  if (SECRETARY_ROLES.includes(role)) {
    switch (resourceType) {
      case 'document':
      case 'inventory':
      case 'product':
      case 'section':
      case 'roster':
        return true; // Full Add, Update, Delete
      case 'announcement':
        return true;
      case 'finance':
        return action === 'read'; // View-only finance
      case 'order':
        return action === 'create' || action === 'read' || action === 'update';
      default:
        return false;
    }
  }

  // Finance & Audit (Higher Access: Finance, Inventory, Documents, Commerce Hub, Audit Trail)
  const FINANCE_ROLES = ['finance_secretary', 'auditor', 'budget_officer'];
  if (FINANCE_ROLES.includes(role)) {
    switch (resourceType) {
      case 'finance':
      case 'inventory':
      case 'product':
      case 'document':
      case 'order':
      case 'audit':
        return true; // Full Add, Update, Delete
      case 'section':
      case 'roster':
        return action === 'create' || action === 'read';
      default:
        return false;
    }
  }

  // Legislative Body: Senators & Representatives (Medium Access: Add, Update, Edit — CANNOT DELETE)
  if (role === 'senator' || role === 'representative') {
    if (action === 'delete' && !canDeleteGlobally) {
      return false; // Strictly cannot delete
    }
    switch (resourceType) {
      case 'document':
      case 'inventory':
      case 'product':
      case 'section':
      case 'roster':
      case 'order':
      case 'announcement':
      case 'creative':
        return action === 'create' || action === 'read' || action === 'update';
      default:
        return false;
    }
  }

  // Creative Department (Announcements only)
  if (role === 'creatives') {
    switch (resourceType) {
      case 'announcement':
      case 'creative':
        return true;
      default:
        return false;
    }
  }

  // Collegiate Leadership: Governor
  if (role === 'governor') {
    switch (resourceType) {
      case 'roster':
      case 'section':
        return action === 'create' || action === 'read';
      default:
        return false;
    }
  }

  // General Student Body: Member
  if (role === 'member') {
    switch (resourceType) {
      case 'product':
      case 'inventory':
        return action === 'read';
      case 'order':
        return action === 'create' || (action === 'read' && resource?.userId === user.uid);
      default:
        return false;
    }
  }

  // Guest
  return false;
};
