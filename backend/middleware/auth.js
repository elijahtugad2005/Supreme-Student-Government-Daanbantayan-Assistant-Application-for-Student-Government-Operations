const { verifyIdToken, getFirestore } = require('../services/firebase-admin');

/**
 * Authorized roles for Document Archive access & AI analysis (mirrors /documents route in App.jsx & permissions.js)
 */
const DOCUMENT_ARCHIVE_ROLES = [
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
  'representative',
  'senator',
];

/**
 * Authorized roles for Document deletion (Admin, Executive Leadership, and Secretariat)
 */
const DOCUMENT_DELETE_ROLES = [
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
];

/**
 * Authorized roles for Announcement & Telegram Broadcast publishing (mirrors /announcement route in permissions.js)
 */
const ANNOUNCEMENT_ROLES = [
  'admin',
  'superadmin',
  'president',
  'vice_president',
  'secretary',
  'general_secretary',
  'executive_secretary',
  'press_secretary',
  'linkages_secretary',
  'deputy_secretary',
  'senator',
  'representative',
  'creatives',
  'governor',
  'adviser',
];

/**
 * Fetch the authoritative Firestore profile for a user UID.
 * Returns null if Firestore is unavailable or the document does not exist.
 */
async function loadUserProfile(uid) {
  if (!uid) return null;
  try {
    const db = getFirestore();
    if (db && typeof db.collection === 'function') {
      const snap = await db.collection('users').doc(uid).get();
      if (snap && snap.exists) {
        return snap.data() || {};
      }
    }
  } catch (err) {
    console.warn(`[Auth] Firestore profile lookup failed for ${uid}:`, err.message);
  }
  return null;
}

/**
 * Authentication middleware
 * Verifies Firebase JWT token from Authorization header with revocation check
 * and rejects accounts deactivated (`isActive === false`) in Firestore.
 * 
 * Expected header format: "Bearer <firebase-id-token>"
 */
async function authenticate(req, res, next) {
  try {
    // Strictly require Authorization: Bearer <firebase-id-token> header.
    // Query-string tokens (?token=) are forbidden across all endpoints because
    // URLs leak bearer JWTs into browser history, Referer headers, and proxy logs.
    let idToken = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      idToken = authHeader.slice('Bearer '.length).trim();
    }

    if (!idToken) {
      return res.status(401).json({
        success: false,
        error: 'Authorization required',
        message: 'Provide a Firebase ID token via Authorization: Bearer header'
      });
    }

    // Verify token with Firebase Admin (checkRevoked = true enforces token revocation)
    const decodedToken = await verifyIdToken(idToken, true);

    // Check Firestore user profile so deactivated accounts (`isActive === false`)
    // lose API access immediately even before JWT expiration.
    const userProfile = await loadUserProfile(decodedToken.uid);
    if (userProfile && userProfile.isActive === false) {
      console.warn(`[Auth] Blocked deactivated user: ${decodedToken.email || decodedToken.uid}`);
      return res.status(403).json({
        success: false,
        error: 'Account deactivated',
        message: 'Your account has been deactivated. Access has been revoked.'
      });
    }

    // Attach user info to request object (prefer authoritative Firestore role/name when present)
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: userProfile?.name || decodedToken.name || decodedToken.email?.split('@')[0] || 'Unknown',
      role: userProfile?.role || decodedToken.role || 'member',
      permissionOverrides:
        userProfile?.permissionOverrides && typeof userProfile.permissionOverrides === 'object'
          ? userProfile.permissionOverrides
          : null,
      emailVerified: decodedToken.email_verified,
      isActive: true
    };

    console.log(`[Auth] Authenticated user: ${req.user.email} (${req.user.uid})`);

    return next();
  } catch (error) {
    console.error('[Auth] Token verification failed:', error.message);

    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({
        success: false,
        error: 'Token revoked',
        message: 'Your session has been revoked or deactivated. Please sign in again.'
      });
    }

    if (error.code === 'auth/user-disabled') {
      return res.status(401).json({
        success: false,
        error: 'Account disabled',
        message: 'This account has been disabled or deactivated.'
      });
    }

    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        message: 'Your session has expired. Please sign in again.'
      });
    }

    if (error.code === 'auth/argument-error') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        message: 'The provided token is malformed or invalid.'
      });
    }

    return res.status(401).json({
      success: false,
      error: 'Authentication failed',
      message: error.message
    });
  }
}

/**
 * Optional authentication middleware
 * Tries to authenticate (with revocation + active check) but doesn't fail if no token provided
 */
async function optionalAuthenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await verifyIdToken(idToken, true);
    const userProfile = await loadUserProfile(decodedToken.uid);
    if (userProfile && userProfile.isActive === false) {
      req.user = null;
      return next();
    }

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: userProfile?.name || decodedToken.name || decodedToken.email?.split('@')[0] || 'Unknown',
      role: userProfile?.role || decodedToken.role || 'member',
      isActive: true
    };

    return next();
  } catch (error) {
    // Don't fail on auth error, just set user to null
    console.warn('[Auth] Optional authentication failed:', error.message);
    req.user = null;
    return next();
  }
}

/**
 * Role + permissionOverrides authorization middleware.
 * Mirrors Firestore rules & client `hasPermission()` so officers granted granular
 * `permissionOverrides` (e.g., `canExportData`, `canSendNotifications`) are never
 * blocked by Express with HTTP 403 while deactivated accounts (`isActive === false`)
 * remain strictly rejected.
 */
function requireAccess(allowedRoles = [], allowedOverrideKeys = []) {
  const flatRoles = Array.isArray(allowedRoles) ? allowedRoles.flat() : [allowedRoles];
  const flatOverrides = Array.isArray(allowedOverrideKeys) ? allowedOverrideKeys.flat() : [allowedOverrideKeys];

  const hasMatchingAccess = (user) => {
    if (!user) return false;
    if (flatRoles.includes(user.role)) return true;
    const overrides = user.permissionOverrides;
    if (overrides && typeof overrides === 'object' && flatOverrides.length > 0) {
      return flatOverrides.some((key) => overrides[key] === true);
    }
    return false;
  };

  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
        message: 'Please authenticate first'
      });
    }

    if (req.user.isActive === false) {
      return res.status(403).json({
        success: false,
        error: 'Account deactivated',
        message: 'Your account has been deactivated. Access has been revoked.'
      });
    }

    if ((req.user.isActive !== true || !hasMatchingAccess(req.user)) && req.user.uid) {
      const userData = await loadUserProfile(req.user.uid);
      if (userData) {
        if (userData.isActive === false) {
          req.user.isActive = false;
          return res.status(403).json({
            success: false,
            error: 'Account deactivated',
            message: 'Your account has been deactivated. Access has been revoked.'
          });
        }
        if (userData.role) req.user.role = userData.role;
        if (userData.name) req.user.name = userData.name;
        if (userData.permissionOverrides && typeof userData.permissionOverrides === 'object') {
          req.user.permissionOverrides = userData.permissionOverrides;
        }
        req.user.isActive = true;
      }
    }

    if (!hasMatchingAccess(req.user)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        message: `This action requires one of these roles: ${flatRoles.join(', ')}`
      });
    }

    return next();
  };
}

/**
 * Role-based authorization middleware (backward-compatible wrapper around requireAccess)
 */
function requireRole(...allowedRoles) {
  return requireAccess(allowedRoles.flat(), []);
}

const DOCUMENT_UPLOAD_ROLES = [...DOCUMENT_ARCHIVE_ROLES, 'governor'];
const DOCUMENT_ARCHIVE_OVERRIDES = ['canExportData', 'canManageProducts', 'canEditFinance'];
const DOCUMENT_DELETE_OVERRIDES = ['canDeleteData'];
const ANNOUNCEMENT_OVERRIDES = ['canSendNotifications', 'canManageAnnouncements', 'canCreateAnnouncements'];

module.exports = {
  authenticate,
  optionalAuthenticate,
  requireRole,
  requireAccess,
  DOCUMENT_ARCHIVE_ROLES,
  DOCUMENT_UPLOAD_ROLES,
  DOCUMENT_DELETE_ROLES,
  DOCUMENT_ARCHIVE_OVERRIDES,
  DOCUMENT_DELETE_OVERRIDES,
  ANNOUNCEMENT_ROLES,
  ANNOUNCEMENT_OVERRIDES,
};
