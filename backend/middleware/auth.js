const { verifyIdToken } = require('../services/firebase-admin');

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

    next();
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
 * Use after authenticate() middleware
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
        message: 'Please authenticate first'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        message: `This action requires one of these roles: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
}

module.exports = {
  authenticate,
  optionalAuthenticate,
  requireRole
};
