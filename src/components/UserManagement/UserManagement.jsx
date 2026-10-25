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
import { 
  ShieldCheck, 
  Users, 
  UserCheck, 
  Search, 
  Download, 
  RefreshCw, 
  AlertTriangle, 
  Edit3, 
  UserX, 
  X,
  Save,
  Key,
  Shield,
  Layers,
  Sparkles,
  SlidersHorizontal,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Clock,
  Briefcase
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import styles from './UserManagement.module.css';

function UserManagement() {
  const { currentUser, userRole } = useAuth();
  const { theme } = useTheme();
  const isClassic = theme === 'dark';
  
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
        <div className={styles.accessDeniedIcon}><ShieldCheck size={48} /></div>
        <h3>Administrator Clearance Required</h3>
        <p>You need verified administrative privileges to access the User Credentials & Role Management Console.</p>
      </div>
    );
  }
  
  return (
    <div className={`${styles.container} ${isClassic ? styles.umClassic : ''}`}>
      {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}
      {/* Top Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.eyebrowBadge}>
            <Shield size={13} />
            <span>{isClassic ? 'SSG EXECUTIVE IAM & RBAC' : 'Identity & Access Management (IAM)'}</span>
          </div>
          <h1 className={styles.title}>User Management & RBAC</h1>
          <p className={styles.subtitle}>
            Control administrative roles, granular permission overrides, and security access states across the SSG network.
          </p>
        </div>
      </header>
      
      {/* Statistics Overview */}
      {statistics && (
        <div className={styles.statistics}>
          <div className={styles.statCard}>
            <div className={styles.statIcon}><Users size={22} /></div>
            <div className={styles.statContent}>
              <div className={styles.statNumber}>{statistics.totalUsers}</div>
              <div className={styles.statLabel}>Total Registered</div>
            </div>
          </div>
          
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconActive}`}>
              <UserCheck size={22} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statNumber}>{statistics.activeUsers}</div>
              <div className={styles.statLabel}>Active Officers & Members</div>
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
      
      {/* Controls Bar */}
      <div className={styles.controls}>
        <div className={styles.searchContainer}>
          <Search size={18} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search by full name, email, or user ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        
        <div className={styles.filterContainer}>
          <div className={styles.selectWrapper}>
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
          </div>
          
          <div className={styles.selectWrapper}>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="active">Active Accounts Only</option>
              <option value="all">All Account Statuses</option>
              <option value="inactive">Inactive / Suspended</option>
            </select>
          </div>
          
          <div className={styles.selectWrapper}>
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
        </div>
        
        <div className={styles.actionButtons}>
          <button
            onClick={handleExportUsers}
            className={styles.exportButton}
            disabled={filteredUsers.length === 0}
            title="Export CSV Roster"
          >
            <Download size={16} />
            Export CSV
          </button>
          
          <button
            onClick={fetchUsers}
            className={styles.refreshButton}
            disabled={loading}
            title="Refresh User Data"
          >
            <RefreshCw size={16} className={loading ? styles.spinIcon : ''} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
      
      {/* Error Alert */}
      {error && (
        <div className={styles.errorBox}>
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}
      
      {/* Loading Skeleton / State */}
      {loading && (
        <div className={styles.loadingState}>
          <div className={styles.spinner}></div>
          <p>Synchronizing IAM Directory & Permissions...</p>
        </div>
      )}
      
      {/* Users Table */}
      {!loading && filteredUsers.length > 0 && (
        <div className={styles.usersTable}>
          <div className={styles.tableHeader}>
            <div className={styles.headerCell}>Identity</div>
            <div className={styles.headerCell}>Designation & Permissions</div>
            <div className={styles.headerCell}>Department</div>
            <div className={styles.headerCell}>Access State</div>
            <div className={styles.headerCell}>Last Session</div>
            <div className={`${styles.headerCell} ${styles.headerCellActions}`}>Actions</div>
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
                    <div className={styles.userId}>UID: {user.id.substring(0, 10)}...</div>
                  </div>
                </div>
                
                {/* Role & Overrides */}
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
                      <Key size={12} />
                      <span>{Object.values(user.permissionOverrides).filter(Boolean).length} Overrides</span>
                    </div>
                  )}
                </div>
                
                {/* Department */}
                <div className={styles.departmentCell}>
                  <span className={styles.deptText}>
                    {user.department || 'General Administration'}
                  </span>
                </div>
                
                {/* Status */}
                <div className={styles.statusCell}>
                  <span className={`${styles.statusBadge} ${user.isActive ? styles.statusActive : styles.statusInactive}`}>
                    {user.isActive ? (
                      <><CheckCircle2 size={14} /> Active</>
                    ) : (
                      <><XCircle size={14} /> Deactivated</>
                    )}
                  </span>
                </div>
                
                {/* Last Login */}
                <div className={styles.lastLoginCell}>
                  <Clock size={13} className={styles.cellIcon} />
                  <span>{formatDate(user.lastLoginAt)}</span>
                </div>
                
                {/* Actions */}
                <div className={styles.actionsCell}>
                  <button
                    onClick={() => handleEditUser(user)}
                    disabled={!canEditUser(user)}
                    className={styles.editButton}
                    title={canEditUser(user) ? "Configure User Access" : "Cannot edit yourself"}
                  >
                    <Edit3 size={15} />
                    Edit
                  </button>
                  
                  <button
                    onClick={() => handleConfirmAction(user, user.isActive ? 'deactivate' : 'activate')}
                    className={user.isActive ? styles.deactivateButton : styles.activateButton}
                    disabled={!canEditUser(user)}
                    title={canEditUser(user) ? (user.isActive ? "Deactivate user" : "Activate user") : "Cannot modify yourself"}
                  >
                    {user.isActive ? (
                      <><UserX size={15} /> Suspend</>
                    ) : (
                      <><UserCheck size={15} /> Activate</>
                    )}
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
          <div className={styles.emptyIcon}><Users size={40} /></div>
          <h3>No Users Found</h3>
          <p>
            {users.length === 0 
              ? 'No users have registered or synced to this directory.'
              : 'No officers or users matched your query. Try broadening your search or role filter.'}
          </p>
        </div>
      )}
      
      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderTitleGroup}>
                <Shield size={20} className={styles.modalHeaderIcon} />
                <div>
                  <h3>Configure Access: {selectedUser.name}</h3>
                  <p className={styles.modalHeaderSub}>Manage system-wide permissions and departmental assignments</p>
                </div>
              </div>
              <button 
                onClick={() => setShowEditModal(false)}
                className={styles.modalClose}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className={styles.modalBody}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Assigned System Role Preset</label>
                <select
                  value={editForm.role}
                  onChange={(e) => {
                    const nextRole = e.target.value;
                    setEditForm({ ...editForm, role: nextRole });
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
                  {/* Group roles by Department / Category */}
                  {Object.entries(
                    availableRoles.reduce((acc, role) => {
                      const cat = role.category || 'Other Roles';
                      if (!acc[cat]) acc[cat] = [];
                      acc[cat].push(role);
                      return acc;
                    }, {})
                  ).map(([category, roles]) => (
                    <optgroup key={category} label={`── ${category.toUpperCase()} ──`}>
                      {roles.map(role => (
                        <option key={role.id} value={role.id}>
                          {role.name} [{role.accessTier}] — {role.description}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              
              {/* ============ PER-USER ACCESS ============ */}
              <div className={styles.permissionEditor}>
                <div className={styles.permissionHeader}>
                  <div className={styles.permHeaderLeft}>
                    <Key size={16} />
                    <label className={styles.formLabel}>Granular Permission Overrides</label>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetOverrides}
                    className={styles.resetPermissionsButton}
                  >
                    Reset to {getRoleName(editForm.role)} defaults
                  </button>
                </div>
                
                <p className={styles.permissionHelp}>
                  Toggle individual switches to grant or revoke specific capabilities independent of the base role. Differences are explicitly highlighted.
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
                                  {isGranted ? 'granted override' : 'revoked override'}
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
                    <Sparkles size={14} />
                    <span>
                      Pending individual overrides will be saved for <strong>{selectedUser.name}</strong>.
                    </span>
                  </div>
                )}
              </div>
              
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Department / Bureau</label>
                <input
                  type="text"
                  value={editForm.department}
                  onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                  className={styles.formInput}
                  placeholder="e.g., Executive Committee, Finance Bureau, Student Welfare"
                />
              </div>
              
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Administrative Audit Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  className={styles.formTextarea}
                  placeholder="Record rationale for role adjustments or custom clearance grants..."
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
                  <span>User account is active & permitted to authenticate</span>
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
                  <Save size={16} />
                  Save Changes
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
              <div className={styles.modalHeaderTitleGroup}>
                <AlertTriangle size={20} style={{ color: actionToConfirm === 'deactivate' ? '#ef4444' : '#10b981' }} />
                <h3>Confirm Security Action</h3>
              </div>
              <button 
                onClick={() => setShowConfirmModal(false)}
                className={styles.modalClose}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className={styles.modalBody}>
              <div className={styles.confirmIcon}>
                {actionToConfirm === 'deactivate' ? (
                  <UserX size={52} style={{ color: '#ef4444' }} />
                ) : (
                  <UserCheck size={52} style={{ color: '#10b981' }} />
                )}
              </div>
              
              <p className={styles.confirmMessage}>
                {actionToConfirm === 'deactivate'
                  ? `Are you sure you want to suspend access for ${selectedUser.name}? Their credentials will be deactivated immediately.`
                  : `Are you sure you want to reactivate access for ${selectedUser.name}? Their institutional system access will be restored.`
                }
              </p>
              
              <div className={styles.confirmDetails}>
                <div><strong>Officer / User:</strong> {selectedUser.name}</div>
                <div><strong>Institutional Email:</strong> {selectedUser.email}</div>
                <div><strong>Current Account State:</strong> {selectedUser.isActive ? 'Active' : 'Inactive'}</div>
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
                  {actionToConfirm === 'deactivate' ? (
                    <><UserX size={16} /> Confirm Deactivation</>
                  ) : (
                    <><UserCheck size={16} /> Confirm Activation</>
                  )}
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