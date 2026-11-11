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
 * Authentication middleware
 * Verifies Firebase JWT token from Authorization header
 * 
 * Expected header format: "Bearer <firebase-id-token>"
 */
async function authenticate(req, res, next) {
  try {
    // Accept token from Authorization header (API calls) OR
    // ?token= query param (direct download anchor links via mongoStore.getUrl())
    let idToken = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      idToken = authHeader.split('Bearer ')[1];
    } else if (req.query.token) {
      idToken = req.query.token;
    }

    if (!idToken || idToken.trim() === '') {
      return res.status(401).json({
        success: false,
        error: 'Authorization required',
        message: 'Provide a Firebase ID token via Authorization: Bearer header or ?token= query param'
      });
    }

    // Verify token with Firebase Admin
    const decodedToken = await verifyIdToken(idToken);

    // Attach user info to request object
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name || decodedToken.email?.split('@')[0] || 'Unknown',
      role: decodedToken.role || 'member', // Custom claim if set
      emailVerified: decodedToken.email_verified
    };

    console.log(`[Auth] Authenticated user: ${req.user.email} (${req.user.uid})`);

    return next();
  } catch (error) {
    console.error('[Auth] Token verification failed:', error.message);

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
 * Tries to authenticate but doesn't fail if no token provided
 */
async function optionalAuthenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await verifyIdToken(idToken);

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name || decodedToken.email?.split('@')[0] || 'Unknown',
      role: decodedToken.role || 'member'
    };

    next();
  } catch (error) {
    // Don't fail on auth error, just set user to null
    console.warn('[Auth] Optional authentication failed:', error.message);
    req.user = null;
    next();
  }
}

/**
 * Role-based authorization middleware
 * Use after authenticate() middleware.
 * Resolves the user's authoritative role from Firestore users/{uid}.role when the
 * ID token custom claim is not yet populated or does not match allowedRoles.
 */
function requireRole(...allowedRoles) {
  const flatRoles = allowedRoles.flat();
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
        message: 'Please authenticate first'
      });
    }

    if (!flatRoles.includes(req.user.role) && req.user.uid) {
      try {
        const db = getFirestore();
        if (db && typeof db.collection === 'function') {
          const snap = await db.collection('users').doc(req.user.uid).get();
          if (snap && snap.exists) {
            const userData = snap.data() || {};
            if (userData.role) req.user.role = userData.role;
            if (userData.name) req.user.name = userData.name;
          }
        }
      } catch (err) {
        console.warn(`[Auth] Firestore role lookup fallback failed for ${req.user.uid}:`, err.message);
      }
    }

    if (!flatRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        message: `This action requires one of these roles: ${flatRoles.join(', ')}`
      });
    }

    return next();
  };
}

module.exports = {
  authenticate,
  optionalAuthenticate,
  requireRole,
  DOCUMENT_ARCHIVE_ROLES,
  DOCUMENT_DELETE_ROLES,
  ANNOUNCEMENT_ROLES,
};
