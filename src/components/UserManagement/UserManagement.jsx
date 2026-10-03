// components/UserManagement/UserManagement.jsx
// PURPOSE: Admin dashboard for managing user roles and permissions
// FEATURES:
//   - View all users with filtering and search
//   - Update user roles and permissions
//   - User statistics and analytics
//   - Export functionality
//   - Role change history

import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import userManagementService from '../../services/userManagementService.js';
import { 
  getAllRoles, 
  getRoleName, 
  getRoleDescription, 
  buildOverrides,
  effectivePermissions,
  PERMISSION_CATALOG,
  ROLE_PERMISSIONS
} from '../../utils/permissions.js';
import { syncClaimsForUser } from '../../services/roleClaims.js';
import styles from './UserManagement.module.css';

function UserManagement() {
  const { currentUser, userRole } = useAuth();
  
  // State management
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statistics, setStatistics] = useState(null);
  
  // Filters and search
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  
  // Selected user for editing
  const [selectedUser, setSelectedUser] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [actionToConfirm, setActionToConfirm] = useState(null);
  
  // Edit form state
  const [editForm, setEditForm] = useState({
    role: '',
    permissions: {},
    department: '',
    isActive: true,
    notes: ''
  });
  
  // Permissions the Admin has ticked for this user. Seeded from the user's
  // CURRENT effective access, so role defaults appear pre-checked and only the
  // deliberate changes get saved as overrides.
  const [grantedPermissions, setGrantedPermissions] = useState(new Set());
  
  // Check if current user has admin privileges
  const isAdmin = userRole === 'admin';
  
  // Available roles for dropdown
  const availableRoles = getAllRoles();
  
  // Fetch users and statistics
  const fetchUsers = async () => {
    if (!isAdmin) return;
    
    try {
      setLoading(true);
      setError('');
      
      // Fetch users with pagination and filters
      const usersData = await userManagementService.getAllUsers(
        currentPage, 
        pageSize, 
        roleFilter === 'all' ? null : roleFilter,
        statusFilter === 'active'
      );
      
      setUsers(usersData.users);
      setFilteredUsers(usersData.users);
      
      // Fetch statistics
      const stats = await userManagementService.getUserStatistics();
      setStatistics(stats);
      
    } catch (error) {
      console.error('Error fetching users:', error);
      setError('Failed to load users. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  // Search users
  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setFilteredUsers(users);
      return;
    }
    
    try {
      const searchResults = await userManagementService.searchUsers(searchTerm, 50);
      setFilteredUsers(searchResults);
    } catch (error) {
      console.error('Error searching users:', error);
      setFilteredUsers(users);
    }
  };
  
  // Load users on component mount or filter change
  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin, currentPage, pageSize, roleFilter, statusFilter]);
  
  // Handle search term change with debounce
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      handleSearch();
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [searchTerm, users]);
  
  // Open edit modal
  const handleEditUser = (user) => {
    setSelectedUser(user);
    setEditForm({
      role: user.role,
      permissions: user.permissions || {},
      department: user.department || '',
      isActive: user.isActive !== false,
      notes: user.notes || ''
    });
    setGrantedPermissions(new Set(Object.keys(effectivePermissions(user)).filter(
      (key) => effectivePermissions(user)[key]
    )));
    setShowEditModal(true);
  };
  
  const togglePermission = (key) => {
    setGrantedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Drops every override so the user inherits their role's access again.
  const handleResetOverrides = () => {
    const base = ROLE_PERMISSIONS[editForm.role]?.permissions || {};
    setGrantedPermissions(new Set(Object.keys(base).filter((key) => base[key])));
  };
  
  /** Ticks that differ from what the selected role already allows. */
  const overrideChanges = () => {
    const next = buildOverrides(grantedPermissions, editForm.role);
    const current = selectedUser?.permissionOverrides || {};
    const changed = Object.keys({ ...next, ...current }).some((k) => next[k] !== current[k]);
    return changed ? next : null;
  };
  
  // Open confirm modal
  const handleConfirmAction = (user, action) => {
    setSelectedUser(user);
    setActionToConfirm(action);
    setShowConfirmModal(true);
  };
  
  // Update user role, overrides and profile fields
  const handleUpdateRole = async () => {
    if (!selectedUser || !currentUser) return;
    
    try {
      const roleChanged = editForm.role !== selectedUser.role;

      // Overrides are derived from the role being saved, so a role change and a
      // permission change stay consistent with each other.
      const overrides = buildOverrides(grantedPermissions, editForm.role);

      if (roleChanged) {
        await userManagementService.updateUserRole(
          selectedUser.id,
          editForm.role,
          currentUser.uid
        );

        // Storage rules read the role from the ID token, so the claim has to
        // follow the new role. Without this the person keeps their previous
        // Storage access until their token refreshes on its own.
        try {
          await syncClaimsForUser(selectedUser.id);
        } catch (claimError) {
          // The role change itself succeeded; warn rather than roll it back.
          setError(
            `Role saved, but the access token was not updated (${claimError.message}). ` +
              'Storage permissions will refresh on their next sign-in.'
          );
        }
      }

      await userManagementService.updateUserPermissionOverrides(
        selectedUser.id,
        overrides,
        currentUser.uid
      );

      if (editForm.department !== (selectedUser.department || '')
          || editForm.notes !== (selectedUser.notes || '')
          || editForm.isActive !== (selectedUser.isActive !== false)) {
        await userManagementService.updateUser(
          selectedUser.id,
          {
            department: editForm.department,
            notes: editForm.notes,
            isActive: editForm.isActive
          },
          currentUser.uid
        );
      }
      
      // Update local state
      const updatedUsers = users.map(user => 
        user.id === selectedUser.id 
          ? { ...user, role: editForm.role, permissions: ROLE_PERMISSIONS[editForm.role]?.permissions || {}, permissionOverrides: overrides, department: editForm.department, isActive: editForm.isActive, notes: editForm.notes }
          : user
      );
      
      setUsers(updatedUsers);
      setFilteredUsers(updatedUsers);
      setShowEditModal(false);
      setSelectedUser(null);
      
      // Refresh statistics
      const stats = await userManagementService.getUserStatistics();
      setStatistics(stats);
      
    } catch (error) {
      console.error('Error updating user access:', error);
      setError('Failed to update user access. Please try again.');
    }
  };
  
  // Toggle user active status
  const handleToggleUserStatus = async () => {
    if (!selectedUser || !currentUser) return;
    
    try {
      await userManagementService.updateUser(
        selectedUser.id,
        { isActive: !selectedUser.isActive },
        currentUser.uid
      );
      
      // Update local state
      const updatedUsers = users.map(user => 
        user.id === selectedUser.id 
          ? { ...user, isActive: !selectedUser.isActive }
          : user
      );
      
      setUsers(updatedUsers);
      setFilteredUsers(updatedUsers);
      setShowConfirmModal(false);
      setSelectedUser(null);
      
    } catch (error) {
      console.error('Error toggling user status:', error);
      setError('Failed to update user status. Please try again.');
    }
  };
  
  // Export users to CSV
  const handleExportUsers = () => {
    const csvContent = [
      ['ID', 'Email', 'Name', 'Role', 'Department', 'Status', 'Created At', 'Last Login'],
      ...filteredUsers.map(user => [
        user.id,
        user.email,
        user.name,
        getRoleName(user.role),
        user.department || 'N/A',
        user.isActive ? 'Active' : 'Inactive',
        user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A',
        user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never'
      ])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `users-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };
  
  // Get role color
  const getRoleColor = (role) => {
    const colors = {
      admin: '#4CAF50',
      governor: '#00897B',
      secretary: '#2196F3',
      finance_secretary: '#00ACC1',
      senator: '#7E57C2',
      representative: '#FF9800',
      member: '#9C27B0',
      guest: '#607D8B'
    };
    return colors[role] || '#757575';
  };
  
  // Check if user can be edited by current admin
  const canEditUser = (user) => {
    if (!currentUser) return false;
    // Admins can't edit themselves (prevent self-demotion)
    if (user.id === currentUser.uid) return false;
    return true;
  };
  
  if (!isAdmin) {
    return (
      <div className={styles.accessDenied}>
        <div className={styles.accessDeniedIcon}>👑</div>
        <h3>Administrator Access Required</h3>
        <p>You need administrator privileges to access the User Management dashboard.</p>
      </div>
    );
  }
  
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>User Management</h1>
        <p className={styles.subtitle}>
          Manage user roles, permissions, and access levels across the system.
        </p>
      </header>
      
      {/* Statistics Overview */}
      {statistics && (
        <div className={styles.statistics}>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>👥</div>
            <div className={styles.statContent}>
              <div className={styles.statNumber}>{statistics.totalUsers}</div>
              <div className={styles.statLabel}>Total Users</div>
            </div>
          </div>
          
          <div className={styles.statCard}>
            <div className={styles.statIcon}>✅</div>
            <div className={styles.statContent}>
              <div className={styles.statNumber}>{statistics.activeUsers}</div>
              <div className={styles.statLabel}>Active Users</div>
            </div>
          </div>
          
          {statistics.roles.map(role => (
            <div key={role.id} className={styles.statCard}>
              <div 
                className={styles.statRoleIcon}
                style={{ backgroundColor: getRoleColor(role.id) }}
              >
                {role.name.charAt(0)}
              </div>
              <div className={styles.statContent}>
                <div className={styles.statNumber}>{role.count || 0}</div>
                <div className={styles.statLabel}>{role.name}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.searchContainer}>
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles.searchInput}
          />
          <span className={styles.searchIcon}>🔍</span>
        </div>
        
        <div className={styles.filterContainer}>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className={styles.filterSelect}
          >
            <option value="all">All Roles</option>
            {availableRoles.map(role => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
          
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={styles.filterSelect}
          >
            <option value="active">Active Only</option>
            <option value="all">All Statuses</option>
            <option value="inactive">Inactive Only</option>
          </select>
          
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className={styles.filterSelect}
          >
            <option value={10}>10 per page</option>
            <option value={20}>20 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
        </div>
        
        <div className={styles.actionButtons}>
          <button
            onClick={handleExportUsers}
            className={styles.exportButton}
            disabled={filteredUsers.length === 0}
          >
            📥 Export
          </button>
          
          <button
            onClick={fetchUsers}
            className={styles.refreshButton}
            disabled={loading}
          >
            {loading ? '🔄 Refreshing...' : '🔄 Refresh'}
          </button>
        </div>
      </div>
      
      {/* Error Display */}
      {error && (
        <div className={styles.errorBox}>
          ⚠️ {error}
        </div>
      )}
      
      {/* Loading State */}
      {loading && (
        <div className={styles.loadingState}>
          <div className={styles.spinner}></div>
          <p>Loading users...</p>
        </div>
      )}
      
      {/* Users Table */}
      {!loading && filteredUsers.length > 0 && (
        <div className={styles.usersTable}>
          <div className={styles.tableHeader}>
            <div className={styles.headerCell}>User</div>
            <div className={styles.headerCell}>Role</div>
            <div className={styles.headerCell}>Department</div>
            <div className={styles.headerCell}>Status</div>
            <div className={styles.headerCell}>Last Login</div>
            <div className={styles.headerCell}>Actions</div>
          </div>
          
          <div className={styles.tableBody}>
            {filteredUsers.map(user => (
              <div key={user.id} className={styles.tableRow}>
                {/* User Info */}
                <div className={styles.userCell}>
                  <div className={styles.userAvatar}>
                    {user.photoURL ? (
                      <img src={user.photoURL} alt={user.name} />
                    ) : (
                      <span>{user.name.charAt(0)}</span>
                    )}
                  </div>
                  <div className={styles.userInfo}>
                    <div className={styles.userName}>{user.name}</div>
                    <div className={styles.userEmail}>{user.email}</div>
                    <div className={styles.userId}>ID: {user.id.substring(0, 8)}...</div>
                  </div>
                </div>
                
                {/* Role */}
                <div className={styles.roleCell}>
                  <span 
                    className={styles.roleBadge}
                    style={{ backgroundColor: getRoleColor(user.role) }}
                  >
                    {getRoleName(user.role)}
                  </span>
                  <div className={styles.roleDescription}>
                    {getRoleDescription(user.role)}
                  </div>
                  {user.permissionOverrides && Object.keys(user.permissionOverrides).length > 0 && (
                    <div className={styles.overrideBadge}>
                      +{Object.values(user.permissionOverrides).filter(Boolean).length} individual
                    </div>
                  )}
                </div>
                
                {/* Department */}
                <div className={styles.departmentCell}>
                  {user.department || 'Not specified'}
                </div>
                
                {/* Status */}
                <div className={styles.statusCell}>
                  <span className={`${styles.statusBadge} ${user.isActive ? styles.statusActive : styles.statusInactive}`}>
                    {user.isActive ? '✅ Active' : '❌ Inactive'}
                  </span>
                </div>
                
                {/* Last Login */}
                <div className={styles.lastLoginCell}>
                  {formatDate(user.lastLoginAt)}
                </div>
                
                {/* Actions */}
                <div className={styles.actionsCell}>
                  <button
                    onClick={() => handleEditUser(user)}
                    disabled={!canEditUser(user)}
                    className={styles.editButton}
                    title={canEditUser(user) ? "Edit user" : "Cannot edit yourself"}
                  >
                    ✏️ Edit
                  </button>
                  
                  <button
                    onClick={() => handleConfirmAction(user, user.isActive ? 'deactivate' : 'activate')}
                    className={user.isActive ? styles.deactivateButton : styles.activateButton}
                    disabled={!canEditUser(user)}
                    title={canEditUser(user) ? (user.isActive ? "Deactivate user" : "Activate user") : "Cannot modify yourself"}
                  >
                    {user.isActive ? '❌ Deactivate' : '✅ Activate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Empty State */}
      {!loading && filteredUsers.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>👥</div>
          <h3>No Users Found</h3>
          <p>
            {users.length === 0 
              ? 'No users have been registered yet.'
              : 'No users match your search criteria. Try adjusting your filters.'}
          </p>
        </div>
      )}
      
      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3>Edit User: {selectedUser.name}</h3>
              <button 
                onClick={() => setShowEditModal(false)}
                className={styles.modalClose}
              >
                ✕
              </button>
            </div>
            
            <div className={styles.modalBody}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) => {
                    const nextRole = e.target.value;
                    setEditForm({ ...editForm, role: nextRole });
                    // Ticks are relative to a role. Rebuild them from the new
                    // role's defaults, then re-apply this user's deliberate
                    // overrides so a role change never silently discards them.
                    const base = ROLE_PERMISSIONS[nextRole]?.permissions || {};
                    const next = new Set(Object.keys(base).filter((key) => base[key]));
                    Object.entries(selectedUser?.permissionOverrides || {}).forEach(([key, granted]) => {
                      if (granted) next.add(key);
                      else next.delete(key);
                    });
                    setGrantedPermissions(next);
                  }}
                  className={styles.formSelect}
                >
                  {availableRoles.map(role => (
                    <option key={role.id} value={role.id}>
                      {role.name} - {role.description}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* ============ PER-USER ACCESS ============ */}
              <div className={styles.permissionEditor}>
                <div className={styles.permissionHeader}>
                  <label className={styles.formLabel}>Individual Access</label>
                  <button
                    type="button"
                    onClick={handleResetOverrides}
                    className={styles.resetPermissionsButton}
                  >
                    Reset to {getRoleName(editForm.role)} default
                  </button>
                </div>
                
                <p className={styles.permissionHelp}>
                  Tick or untick to give this person access on top of — or instead of — their
                  role. Only the differences from {getRoleName(editForm.role)} are saved.
                </p>
                
                {PERMISSION_CATALOG.map(group => (
                  <div key={group.group} className={styles.permissionGroup}>
                    <h4 className={styles.permissionGroupTitle}>{group.group}</h4>
                    {group.items.map(item => {
                      const roleDefault = ROLE_PERMISSIONS[editForm.role]?.permissions?.[item.key] === true;
                      const isGranted = grantedPermissions.has(item.key);
                      const isOverride = isGranted !== roleDefault;
                      return (
                        <label
                          key={item.key}
                          className={`${styles.permissionItem} ${isOverride ? styles.permissionItemOverride : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isGranted}
                            onChange={() => togglePermission(item.key)}
                          />
                          <span className={styles.permissionText}>
                            <span className={styles.permissionLabel}>
                              {item.label}
                              {isOverride && (
                                <span className={styles.overrideTag}>
                                  {isGranted ? 'granted' : 'revoked'}
                                </span>
                              )}
                            </span>
                            <span className={styles.permissionHint}>{item.hint}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}
                
                {overrideChanges() && (
                  <div className={styles.permissionSummary}>
                    Saves as individual access for{' '}
                    <strong>{selectedUser.name}</strong>.
                  </div>
                )}
              </div>
              
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Department</label>
                <input
                  type="text"
                  value={editForm.department}
                  onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                  className={styles.formInput}
                  placeholder="Enter department (optional)"
                />
              </div>
              
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Admin Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  className={styles.formTextarea}
                  placeholder="Add notes about this user..."
                  rows={3}
                />
              </div>
              
              <div className={styles.formGroup}>
                <label className={styles.formCheckbox}>
                  <input
                    type="checkbox"
                    checked={editForm.isActive}
                    onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                  />
                  <span>Account is active</span>
                </label>
              </div>
              
              <div className={styles.modalActions}>
                <button
                  onClick={() => setShowEditModal(false)}
                  className={styles.cancelButton}
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateRole}
                  className={styles.saveButton}
                >
                  💾 Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Confirm Action Modal */}
      {showConfirmModal && selectedUser && actionToConfirm && (
        <div className={styles.modalOverlay}>
          <div className={styles.confirmModal}>
            <div className={styles.modalHeader}>
              <h3>Confirm Action</h3>
              <button 
                onClick={() => setShowConfirmModal(false)}
                className={styles.modalClose}
              >
                ✕
              </button>
            </div>
            
            <div className={styles.modalBody}>
              <div className={styles.confirmIcon}>
                {actionToConfirm === 'deactivate' ? '⚠️' : '✅'}
              </div>
              
              <p className={styles.confirmMessage}>
                {actionToConfirm === 'deactivate'
                  ? `Are you sure you want to deactivate ${selectedUser.name}? They will lose access to the system.`
                  : `Are you sure you want to activate ${selectedUser.name}? They will regain access to the system.`
                }
              </p>
              
              <div className={styles.confirmDetails}>
                <div><strong>User:</strong> {selectedUser.name}</div>
                <div><strong>Email:</strong> {selectedUser.email}</div>
                <div><strong>Current Status:</strong> {selectedUser.isActive ? 'Active' : 'Inactive'}</div>
              </div>
              
              <div className={styles.modalActions}>
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className={styles.cancelButton}
                >
                  Cancel
                </button>
                <button
                  onClick={handleToggleUserStatus}
                  className={actionToConfirm === 'deactivate' ? styles.deactivateConfirmButton : styles.activateConfirmButton}
                >
                  {actionToConfirm === 'deactivate' ? '❌ Confirm Deactivation' : '✅ Confirm Activation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserManagement;