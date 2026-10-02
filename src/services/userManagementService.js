// services/userManagementService.js
// PURPOSE: Centralized service for user management operations
// FEATURES:
//   - User CRUD operations
//   - Role assignment and management
//   - Permission management
//   - User search and filtering
//   - Audit logging

import { db } from '../firebase/firebaseConfig.js';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit as firestoreLimit,
  startAfter,
  serverTimestamp
} from 'firebase/firestore';
import { ALL_PERMISSION_KEYS, getAllRoles, getDefaultPermissionsForRole, getRoleName } from '../utils/permissions.js';

/**
 * Keep only real permission keys with boolean values, so a stray or hostile
 * payload cannot write arbitrary fields onto a user document.
 */
const sanitizeOverrides = (overrides) => {
  const result = {};
  if (!overrides || typeof overrides !== 'object') return result;
  Object.entries(overrides).forEach(([key, value]) => {
    if (ALL_PERMISSION_KEYS.includes(key) && typeof value === 'boolean') {
      result[key] = value;
    }
  });
  return result;
};

// Collection references
const USERS_COLLECTION = 'users';
const AUDIT_LOGS_COLLECTION = 'audit_logs';

/**
 * User Management Service
 */
export const userManagementService = {
  // ========================================
  // USER CRUD OPERATIONS
  // ========================================
  
  /**
   * Get user by ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User data
   */
  async getUserById(userId) {
    try {
      const userDoc = await getDoc(doc(db, USERS_COLLECTION, userId));
      if (userDoc.exists()) {
        return {
          id: userDoc.id,
          ...userDoc.data()
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting user:', error);
      throw error;
    }
  },
  
  /**
   * Get user by email
   * @param {string} email - User email
   * @returns {Promise<Object>} User data
   */
  async getUserByEmail(email) {
    try {
      const usersQuery = query(
        collection(db, USERS_COLLECTION),
        where('email', '==', email),
        // `limit` is imported as firestoreLimit; calling it bare threw a
        // ReferenceError the moment this path ran.
        firestoreLimit(1)
      );
      
      const querySnapshot = await getDocs(usersQuery);
      if (!querySnapshot.empty) {
        const userDoc = querySnapshot.docs[0];
        return {
          id: userDoc.id,
          ...userDoc.data()
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting user by email:', error);
      throw error;
    }
  },
  
  /**
   * Create new user
   * @param {Object} userData - User data
   * @returns {Promise<string>} User ID
   */
  async createUser(userData) {
    try {
      const userId = userData.uid;
      const userRef = doc(db, USERS_COLLECTION, userId);
      
      // Ensure required fields
      const completeUserData = {
        ...userData,
        createdAt: serverTimestamp(),
        lastUpdatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
        isActive: true
      };
      
      await setDoc(userRef, completeUserData);
      
      // Log the action
      await this.logAuditAction('user_created', userId, null, {
        before: null,
        after: completeUserData
      });
      
      return userId;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  },
  
  /**
   * Update user
   * @param {string} userId - User ID
   * @param {Object} updates - Fields to update
   * @param {string} adminId - Admin ID who performed the update
   * @returns {Promise<void>}
   */
  async updateUser(userId, updates, adminId) {
    try {
      const userRef = doc(db, USERS_COLLECTION, userId);
      const currentUser = await this.getUserById(userId);
      
      const updateData = {
        ...updates,
        lastUpdatedAt: serverTimestamp()
      };
      
      await updateDoc(userRef, updateData);
      
      // Log the action
      await this.logAuditAction('user_updated', adminId, userId, {
        before: currentUser,
        after: { ...currentUser, ...updates }
      });
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  },
  
  /**
   * Delete user (soft delete)
   * @param {string} userId - User ID
   * @param {string} adminId - Admin ID who performed the deletion
   * @returns {Promise<void>}
   */
  async deleteUser(userId, adminId) {
    try {
      const userRef = doc(db, USERS_COLLECTION, userId);
      const currentUser = await this.getUserById(userId);
      
      // Soft delete - mark as inactive instead of removing
      await updateDoc(userRef, {
        isActive: false,
        deletedAt: serverTimestamp(),
        deletedBy: adminId,
        lastUpdatedAt: serverTimestamp()
      });
      
      // Log the action
      await this.logAuditAction('user_deleted', adminId, userId, {
        before: currentUser,
        after: null
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  },
  
  // ========================================
  // ROLE MANAGEMENT
  // ========================================
  
  /**
   * Update user role
   * @param {string} userId - User ID
   * @param {string} newRole - New role
   * @param {string} adminId - Admin ID who performed the change
   * @returns {Promise<void>}
   */
  async updateUserRole(userId, newRole, adminId) {
    try {
      const userRef = doc(db, USERS_COLLECTION, userId);
      const currentUser = await this.getUserById(userId);
      
      // Get default permissions for new role
      const newPermissions = getDefaultPermissionsForRole(newRole);
      
      const updateData = {
        role: newRole,
        permissions: newPermissions,
        // Overrides are absolute grants against the old role's defaults, so
        // carrying them across unchanged would silently grant or revoke the
        // wrong things. They are re-derived from the new role by the caller
        // (UserManagement does this with buildOverrides) and written separately;
        // leaving the stored map alone here keeps this call a pure role change.
        lastUpdatedAt: serverTimestamp()
      };
      
      await updateDoc(userRef, updateData);
      
      // Log the role change
      await this.logAuditAction('role_changed', adminId, userId, {
        before: { role: currentUser.role, permissions: currentUser.permissions },
        after: { role: newRole, permissions: newPermissions }
      });
    } catch (error) {
      console.error('Error updating user role:', error);
      throw error;
    }
  },
  
  /**
   * Update user permissions
   * @param {string} userId - User ID
   * @param {Object} newPermissions - New permissions object
   * @param {string} adminId - Admin ID who performed the change
   * @returns {Promise<void>}
   */
  async updateUserPermissions(userId, newPermissions, adminId) {
    try {
      const userRef = doc(db, USERS_COLLECTION, userId);
      const currentUser = await this.getUserById(userId);
      
      const updateData = {
        permissions: newPermissions,
        lastUpdatedAt: serverTimestamp()
      };
      
      await updateDoc(userRef, updateData);
      
      // Log the permission change
      await this.logAuditAction('permissions_changed', adminId, userId, {
        before: { permissions: currentUser.permissions },
        after: { permissions: newPermissions }
      });
    } catch (error) {
      console.error('Error updating user permissions:', error);
      throw error;
    }
  },
  
  /**
   * Save per-user permission overrides.
   *
   * Stored as a sparse map containing ONLY the permissions that differ from
   * the user's role defaults, so changing a role's defaults later still reaches
   * the user, and "reset to role" is simply an empty object.
   *
   * @param {string} userId
   * @param {Object} overrides e.g. { canManageRosters: true }
   * @param {string} adminId Admin who made the change
   */
  async updateUserPermissionOverrides(userId, overrides, adminId) {
    try {
      const userRef = doc(db, USERS_COLLECTION, userId);
      const currentUser = await this.getUserById(userId);

      const sanitized = sanitizeOverrides(overrides);

      await updateDoc(userRef, {
        permissionOverrides: sanitized,
        lastUpdatedAt: serverTimestamp(),
      });

      await this.logAuditAction('permission_overrides_changed', adminId, userId, {
        before: currentUser?.permissionOverrides || {},
        after: sanitized,
      });
    } catch (error) {
      console.error('Error updating permission overrides:', error);
      throw error;
    }
  },

  /**
   * Remove every override so the user falls back to their role's defaults.
   * @param {string} userId
   * @param {string} adminId
   */
  async resetUserPermissionOverrides(userId, adminId) {
    return this.updateUserPermissionOverrides(userId, {}, adminId);
  },

  /**
   * Get all available roles
   * @returns {Array} Array of role objects
   */
  getAllAvailableRoles() {
    return getAllRoles();
  },
  
  // ========================================
  // USER LISTING AND SEARCH
  // ========================================
  
  /**
   * Get all users with pagination
   * @param {number} page - Page number (starting from 1)
   * @param {number} pageSize - Number of users per page
   * @param {string} roleFilter - Filter by role (optional)
   * @param {boolean} activeOnly - Show only active users
   * @returns {Promise<Object>} Paginated users data
   */
  async getAllUsers(page = 1, pageSize = 20, roleFilter = null, activeOnly = true) {
    try {
      // Build query constraints — avoid compound index issues by keeping it simple
      const constraints = [];

      if (roleFilter) {
        constraints.push(where('role', '==', roleFilter));
      }

      const q = query(collection(db, USERS_COLLECTION), ...constraints);
      const querySnapshot = await getDocs(q);

      // Filter in-memory: handles missing isActive field (treats missing = active)
      const allUsers = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        // If activeOnly, skip users where isActive is explicitly false
        if (activeOnly && data.isActive === false) return;
        allUsers.push({ id: docSnap.id, ...data });
      });

      // Sort by createdAt descending (handles both ISO strings and Firestore Timestamps)
      allUsers.sort((a, b) => {
        const toMs = (v) => {
          if (!v) return 0;
          if (typeof v.toMillis === 'function') return v.toMillis();
          return new Date(v).getTime();
        };
        return toMs(b.createdAt) - toMs(a.createdAt);
      });

      // Paginate in-memory
      const totalUsers = allUsers.length;
      const totalPages = Math.ceil(totalUsers / pageSize);
      const startIndex = (page - 1) * pageSize;
      const users = allUsers.slice(startIndex, startIndex + pageSize);

      return {
        users,
        pagination: {
          page,
          pageSize,
          totalUsers,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        }
      };
    } catch (error) {
      console.error('Error getting users:', error);
      throw error;
    }
  },
  
  /**
   * Search users by name or email
   * @param {string} searchTerm - Search term
   * @param {number} limit - Maximum results to return
   * @returns {Promise<Array>} Array of matching users
   */
  async searchUsers(searchTerm, maxResults = 50) {
    try {
      // Fetch all users then filter in-memory (Firestore doesn't support full-text search)
      const usersQuery = query(
        collection(db, USERS_COLLECTION),
        firestoreLimit(500) // cap at 500 to avoid huge reads
      );

      const querySnapshot = await getDocs(usersQuery);
      const searchTermLower = searchTerm.toLowerCase();

      const results = [];
      querySnapshot.forEach((docSnap) => {
        const userData = docSnap.data();
        // Skip explicitly inactive users
        if (userData.isActive === false) return;
        const matches =
          userData.email?.toLowerCase().includes(searchTermLower) ||
          userData.name?.toLowerCase().includes(searchTermLower);

        if (matches) {
          results.push({ id: docSnap.id, ...userData });
        }
      });

      return results.slice(0, maxResults);
    } catch (error) {
      console.error('Error searching users:', error);
      throw error;
    }
  },
  
  /**
   * Get users by role
   * @param {string} role - Role to filter by
   * @returns {Promise<Array>} Array of users with specified role
   */
  async getUsersByRole(role) {
    try {
      const usersQuery = query(
        collection(db, USERS_COLLECTION),
        where('role', '==', role),
        where('isActive', '==', true),
        orderBy('name')
      );
      
      const querySnapshot = await getDocs(usersQuery);
      const users = [];
      
      querySnapshot.forEach((doc) => {
        users.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      return users;
    } catch (error) {
      console.error('Error getting users by role:', error);
      throw error;
    }
  },
  
  /**
   * Get user statistics
   * @returns {Promise<Object>} User statistics
   */
  async getUserStatistics() {
    try {
      const usersQuery = query(collection(db, USERS_COLLECTION));
      const querySnapshot = await getDocs(usersQuery);
      
      let totalUsers = 0;
      let activeUsers = 0;
      const roleCounts = {};
      
      querySnapshot.forEach((doc) => {
        const userData = doc.data();
        totalUsers++;
        
        if (userData.isActive !== false) {
          activeUsers++;
        }
        
        const role = userData.role || 'unknown';
        roleCounts[role] = (roleCounts[role] || 0) + 1;
      });
      
      return {
        totalUsers,
        activeUsers,
        inactiveUsers: totalUsers - activeUsers,
        roleCounts,
        roles: getAllRoles().map(role => ({
          ...role,
          count: roleCounts[role.id] || 0
        }))
      };
    } catch (error) {
      console.error('Error getting user statistics:', error);
      throw error;
    }
  },
  
  // ========================================
  // AUDIT LOGGING
  // ========================================
  
  /**
   * Log audit action with user names
   * @param {string} action - Action type
   * @param {string} userId - User who performed the action
   * @param {string} targetUserId - User who was affected
   * @param {Object} changes - Changes made
   * @param {Object} additionalData - Additional data (module, item details, etc.)
   * @returns {Promise<void>}
   */
  async logAuditAction(action, userId, targetUserId, changes = {}, additionalData = {}) {
    try {
      const auditLogRef = doc(collection(db, AUDIT_LOGS_COLLECTION));
      
      // Get user names for better tracking
      let performedByName = 'System';
      let affectedUserName = null;
      
      if (userId) {
        try {
          const performerUser = await this.getUserById(userId);
          performedByName = performerUser ? performerUser.name || performerUser.email : userId;
        } catch (error) {
          console.warn('Could not fetch performer user name:', error);
          performedByName = userId; // Fallback to UID
        }
      }
      
      if (targetUserId) {
        try {
          const targetUser = await this.getUserById(targetUserId);
          affectedUserName = targetUser ? targetUser.name || targetUser.email : targetUserId;
        } catch (error) {
          console.warn('Could not fetch target user name:', error);
          affectedUserName = targetUserId; // Fallback to UID
        }
      }
      
      const auditLog = {
        action,
        userId,
        targetUserId,
        performedBy: performedByName, // Human-readable name
        affectedUser: affectedUserName, // Human-readable name
        changes,
        timestamp: serverTimestamp(),
        ipAddress: 'N/A', // Would get from request in production
        userAgent: navigator.userAgent || 'N/A',
        module: additionalData.module || 'User Management', // Track which module
        itemType: additionalData.itemType || null, // Finance item, product, etc.
        itemId: additionalData.itemId || null, // ID of affected item
        itemName: additionalData.itemName || null, // Name of affected item
        notes: additionalData.notes || ''
      };
      
      await setDoc(auditLogRef, auditLog);
    } catch (error) {
      console.error('Error logging audit action:', error);
      // Don't throw - audit logging shouldn't break the main operation
    }
  },
  
  /**
   * Get audit logs
   * @param {number} limit - Maximum logs to return
   * @returns {Promise<Array>} Array of audit logs
   */
  async getAuditLogs(maxLogs = 50) {
    try {
      const auditLogsQuery = query(
        collection(db, AUDIT_LOGS_COLLECTION),
        orderBy('timestamp', 'desc'),
        firestoreLimit(maxLogs)
      );

      const querySnapshot = await getDocs(auditLogsQuery);
      const logs = [];

      querySnapshot.forEach((docSnap) => {
        logs.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      return logs;
    } catch (error) {
      console.error('Error getting audit logs:', error);
      throw error;
    }
  },
  
  // ========================================
  // HELPER FUNCTIONS
  // ========================================
  
  /**
   * Validate user data
   * @param {Object} userData - User data to validate
   * @returns {Object} Validation result
   */
  validateUserData(userData) {
    const errors = [];
    
    // Required fields
    if (!userData.email) {
      errors.push('Email is required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email)) {
      errors.push('Invalid email format');
    }
    
    if (!userData.name) {
      errors.push('Name is required');
    }
    
    if (!userData.role) {
      errors.push('Role is required');
    } else if (!getAllRoles().some(role => role.id === userData.role)) {
      errors.push('Invalid role specified');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  },
  
  /**
   * Format user for display
   * @param {Object} user - User object
   * @returns {Object} Formatted user object
   */
  formatUserForDisplay(user) {
    if (!user) return null;
    
    return {
      ...user,
      roleName: getRoleName(user.role),
      createdAtFormatted: user.createdAt ? 
        new Date(user.createdAt).toLocaleDateString() : 'N/A',
      lastLoginFormatted: user.lastLoginAt ? 
        new Date(user.lastLoginAt).toLocaleDateString() : 'Never'
    };
  }
};

export default userManagementService;