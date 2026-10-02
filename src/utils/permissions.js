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
  'secretary',
  'finance_secretary',
  'governor',
  'representative',
];

export const canManageDeathAid = (user) =>
  DEATH_AID_MANAGER_ROLES.includes(user?.role);

export const canSubmitDeathAid = (user) => !!user?.role;

export const canViewOwnDeathAid = (user) => !!user?.role;

/**
 * Collection status lifecycle.
 *
 * DRAFT is deliberately client-side only: persisting it would litter the
 * database with half-finished rows that no one ever submits. A submission is
 * therefore always created directly as FOR_VERIFICATION.
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

/**
 * Why a student is on record as owing.
 *
 * The COUNT is always authoritative — a debt never needs an explanation to be
 * recorded. This only describes what the officer knows for follow-up, because
 * "who didn't pay" has several ordinary answers: they're named, nobody asked,
 * they were absent, or they left after class and never got to hand it in.
 *
 * ANONYMOUS exists so an unexplained debt is still allowed to be recorded
 * rather than blocking the officer until they track someone down.
 */
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
  admin: {
    name: 'Administrator',
    description: 'Full system access with all privileges',
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

  // Mayors submit rosters but never see the student lists back. Governors are
  // the office that oversees them, so they can browse verified rosters.
  governor: {
    name: 'Governor',
    description: 'Oversees a college — can view verified rosters and submit their own',
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

  secretary: {
    name: 'Secretary',
    description: 'Office management — can view Finance but not edit it',
    permissions: {
      canManageProducts: true,
      canManageOrders: true,
      canManageUsers: false,
      canViewAnalytics: true,
      canViewFinance: true,     // view-only
      canEditFinance: false,    // cannot edit
      canExportData: true,
      canSendNotifications: true,
      canConfigureSystem: false,
      canDeleteData: false,
      canManageCreatives: false,
      canSubmitRoster: true,
      // A Secretary verifies rosters, so they must be able to read them.
      canViewRosters: true,
      canManageRosters: true
    }
  },

  finance_secretary: {
    name: 'Finance Secretary',
    description: 'Full access to the Finance section only',
    permissions: {
      canManageProducts: false,
      canManageOrders: false,
      canManageUsers: false,
      canViewAnalytics: true,
      canViewFinance: true,
      canEditFinance: true,     // can edit finance
      canExportData: true,
      canSendNotifications: false,
      canConfigureSystem: false,
      canDeleteData: false,
      canManageCreatives: false,
      canSubmitRoster: true,
      canViewRosters: false,
      canManageRosters: false
    }
  },

  senator: {
    name: 'Senator',
    description: 'Access to Inventory, Documents, and Creatives — no Finance',
    permissions: {
      canManageProducts: true,  // Inventory
      canManageOrders: false,
      canManageUsers: false,
      canViewAnalytics: false,
      canViewFinance: false,
      canEditFinance: false,
      canExportData: true,      // Documents
      canSendNotifications: false,
      canConfigureSystem: false,
      canDeleteData: false,
      canManageCreatives: true,  // Creatives
      canSubmitRoster: true,
      canViewRosters: false,
      canManageRosters: false
    }
  },

  representative: {
    name: 'Representative',
    description: 'Department representative with limited access',
    permissions: {
      canManageProducts: false,
      canManageOrders: true,
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

  member: {
    name: 'Member',
    description: 'Basic member access (default for Google Sign-In)',
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
    description: 'Restricted access (default for email sign-up)',
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
      // Mayors have no login of their own — a Guest submits their roster for
      // an officer to verify. This grants submission only, never verification.
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
    // Admin routes
    '/admin': ['admin'],
    '/admin/users': ['admin'],
    '/admin/analytics': ['admin', 'secretary'],
    '/admin/settings': ['admin'],

    // Management routes
    '/products': ['admin', 'secretary'],
    '/products/manage': ['admin', 'secretary'],
    '/orders': ['admin', 'secretary', 'representative'],
    '/orders/manage': ['admin', 'secretary'],

    // Finance — Secretary can view, Finance Secretary can edit
    '/finance': ['admin', 'secretary', 'finance_secretary'],

    // Inventory — Senator can access
    '/inventory': ['admin', 'secretary', 'representative', 'senator'],

    // Roster registry — Mayors reach this as Guests, since they have no login.
    // Submission only; the roster browser is gated separately on canViewRosters.
    '/reports': ['public', 'admin', 'secretary', 'governor', 'finance_secretary', 'senator', 'representative', 'member', 'guest'],

    // Documents — Senator can access
    '/documents': ['admin', 'secretary', 'representative', 'senator'],

    // Member routes
    '/profile': ['admin', 'secretary', 'finance_secretary', 'senator', 'representative', 'member'],
    '/orders/history': ['admin', 'secretary', 'representative', 'member'],

    // Public routes
    '/': ['admin', 'secretary', 'finance_secretary', 'senator', 'representative', 'member', 'guest'],
    '/login': ['admin', 'secretary', 'finance_secretary', 'senator', 'representative', 'member', 'guest'],
    '/about': ['admin', 'secretary', 'finance_secretary', 'senator', 'representative', 'member', 'guest']
  };

  const allowedRoles = routePermissions[routeName] ||
    ['admin', 'secretary', 'finance_secretary', 'senator', 'representative', 'member', 'guest'];

  if (!user?.role) return false;

  const grants = ROUTE_PERMISSION_GRANTS[routeName];

  // An explicit revocation from an Admin outranks the static role list — a
  // Finance Secretary denied canViewFinance must actually lose /finance.
  if (
    grants &&
    user.permissionOverrides &&
    grants.some((permission) => user.permissionOverrides[permission] === false)
  ) {
    return false;
  }

  if (allowedRoles.includes(user.role)) return true;

  // A per-user grant is a deliberate assignment from an Admin, so it opens the
  // route even when the static role list would not.
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
  // Admin can do everything
  if (user?.role === 'admin') return true;

  // Roster registry — every role may submit; only Governors, the Secretary and
  // Admin may read student lists; only the Secretary and Admin may verify.
  // A Mayor (Guest) can never read a roster back or alter a verified one.
  const ROSTER_ROLES = [
    'public',
    'admin',
    'secretary',
    'governor',
    'finance_secretary',
    'senator',
    'representative',
    'member',
    'guest',
  ];
  if (ROSTER_ROLES.includes(user?.role)) {
    switch (resourceType) {
      case 'roster':
        // Delegated to hasPermission so a per-user grant or revocation is
        // honoured. Listing roles here would silently ignore the whole feature.
        if (action === 'create') return true;
        if (action === 'read') return hasPermission(user, 'canViewRosters');
        if (action === 'verify' || action === 'requestCorrection') {
          return hasPermission(user, 'canManageRosters');
        }
        if (action === 'update' || action === 'delete') {
          return hasPermission(user, 'canManageRosters');
        }
        return false;
      default: return false;
    }
  }

  // Finance Secretary — full Finance access only
  if (user?.role === 'finance_secretary') {
    switch (resourceType) {
      case 'finance': return true; // create, read, update, delete
      default: return false;
    }
  }

  // Secretary — view Finance, manage products/orders
  if (user?.role === 'secretary') {
    switch (resourceType) {
      case 'product': return action === 'create' || action === 'read' || action === 'update';
      case 'order':   return action === 'create' || action === 'read' || action === 'update';
      case 'finance': return action === 'read'; // view-only
      case 'user':    return action === 'read';
      default: return false;
    }
  }

  // Senator — Inventory (products) + Documents (export) + Creatives
  if (user?.role === 'senator') {
    switch (resourceType) {
      case 'product':   return action === 'read' || action === 'create' || action === 'update';
      case 'document':  return action === 'read' || action === 'create';
      case 'creative':  return action === 'read' || action === 'create' || action === 'update';
      default: return false;
    }
  }

  // Representative
  if (user?.role === 'representative') {
    switch (resourceType) {
      case 'product': return action === 'read';
      case 'order':
        return action === 'create' ||
               (action === 'read' && resource?.userId === user.uid);
      default: return false;
    }
  }

  // Member
  if (user?.role === 'member') {
    switch (resourceType) {
      case 'product': return action === 'read';
      case 'order':
        return action === 'create' ||
               (action === 'read' && resource?.userId === user.uid);
      default: return false;
    }
  }

  // Guest — no permissions
  return false;
};
