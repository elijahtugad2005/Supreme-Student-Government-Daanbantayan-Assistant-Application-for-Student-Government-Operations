// components/AuditTrail/AuditTrail.jsx
// PURPOSE: Display audit trail of user role changes and admin actions
// FEATURES:
//   - Shows recent admin actions
//   - Tracks role changes and permission updates
//   - Search and filter capabilities
//   - Export functionality

import React, { useState, useEffect } from 'react';
import userManagementService from '../../services/userManagementService.js';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import styles from './AuditTrail.module.css';

function AuditTrail() {
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  
  const { currentUser, userRole } = useAuth();
  
  // Only admins can view audit trail
  const canViewAuditTrail = userRole === 'admin';
  
  // Available action filters
  const actionFilters = [
    { value: 'all', label: 'All Actions' },
    { value: 'role_changed', label: 'Role Changes' },
    { value: 'permissions_changed', label: 'Permission Changes' },
    { value: 'user_created', label: 'User Creation' },
    { value: 'user_updated', label: 'User Updates' },
    { value: 'user_deleted', label: 'User Deletion' },
    { value: 'budget_created', label: 'Budget Creation' },
    { value: 'budget_updated', label: 'Budget Updates' },
    { value: 'budget_deleted', label: 'Budget Deletion' },
    { value: 'expense_created', label: 'Expense Creation' },
    { value: 'expense_updated', label: 'Expense Updates' },
    { value: 'expense_deleted', label: 'Expense Deletion' },
    { value: 'income_created', label: 'Income Creation' },
    { value: 'financial_report_generated', label: 'Report Generation' },
    { value: 'financial_data_exported', label: 'Data Export' }
  ];
  
  // Fetch audit logs
  const fetchAuditLogs = async () => {
    if (!canViewAuditTrail) return;
    
    try {
      setLoading(true);
      setError('');
      
      const logs = await userManagementService.getAuditLogs(100);
      setAuditLogs(logs);
      
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      setError('Failed to load audit logs. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  // Load audit logs on component mount
  useEffect(() => {
    if (canViewAuditTrail) {
      fetchAuditLogs();
    }
  }, [canViewAuditTrail]);
  
  // Format timestamp
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Unknown';
    
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date);
    } catch (error) {
      return 'Invalid date';
    }
  };
  
  // Get action icon and color
  const getActionDetails = (action) => {
    switch (action) {
      case 'role_changed':
        return { icon: '🔄', color: '#4CAF50', label: 'Role Changed' };
      case 'permissions_changed':
        return { icon: '🔐', color: '#2196F3', label: 'Permissions Updated' };
      case 'user_created':
        return { icon: '➕', color: '#9C27B0', label: 'User Created' };
      case 'user_updated':
        return { icon: '✏️', color: '#FF9800', label: 'User Updated' };
      case 'user_deleted':
        return { icon: '🗑️', color: '#F44336', label: 'User Deleted' };
      
      // Finance Actions
      case 'budget_created':
        return { icon: '💰', color: '#4CAF50', label: 'Budget Created' };
      case 'budget_updated':
        return { icon: '💵', color: '#2196F3', label: 'Budget Updated' };
      case 'budget_deleted':
        return { icon: '💸', color: '#F44336', label: 'Budget Deleted' };
      case 'expense_created':
        return { icon: '🧾', color: '#FF9800', label: 'Expense Created' };
      case 'expense_updated':
        return { icon: '📝', color: '#2196F3', label: 'Expense Updated' };
      case 'expense_deleted':
        return { icon: '🗑️', color: '#F44336', label: 'Expense Deleted' };
      case 'income_created':
        return { icon: '💵', color: '#4CAF50', label: 'Income Created' };
      case 'financial_report_generated':
        return { icon: '📊', color: '#9C27B0', label: 'Report Generated' };
      case 'financial_data_exported':
        return { icon: '📥', color: '#607D8B', label: 'Data Exported' };
      case 'bulk_delete':
        return { icon: '🗑️', color: '#F44336', label: 'Bulk Delete' };
      case 'bulk_update':
        return { icon: '📝', color: '#2196F3', label: 'Bulk Update' };
      
      default:
        return { icon: '📝', color: '#607D8B', label: 'Action Logged' };
    }
  };
  
  // Filter logs based on search term and action filter
  const filteredLogs = auditLogs.filter(log => {
    // Filter by action type
    if (filterAction !== 'all' && log.action !== filterAction) {
      return false;
    }
    
    // Filter by search term
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const userText = log.userId?.toLowerCase() || '';
      const targetText = log.targetUserId?.toLowerCase() || '';
      const performedByText = log.performedBy?.toLowerCase() || '';
      const affectedUserText = log.affectedUser?.toLowerCase() || '';
      const actionText = getActionDetails(log.action).label.toLowerCase();
      const moduleText = log.module?.toLowerCase() || '';
      const itemNameText = log.itemName?.toLowerCase() || '';
      
      return userText.includes(searchLower) || 
             targetText.includes(searchLower) ||
             performedByText.includes(searchLower) ||
             affectedUserText.includes(searchLower) ||
             actionText.includes(searchLower) ||
             moduleText.includes(searchLower) ||
             itemNameText.includes(searchLower);
    }
    
    return true;
  });
  
  // Export audit logs
  const handleExport = () => {
    const csvContent = [
      ['Timestamp', 'Action', 'Module', 'Performed By', 'Affected User', 'Item', 'Changes', 'Notes'],
      ...filteredLogs.map(log => [
        formatTimestamp(log.timestamp),
        getActionDetails(log.action).label,
        log.module || 'User Management',
        log.performedBy || log.userId || 'System',
        log.affectedUser || log.targetUserId || 'N/A',
        log.itemName || 'N/A',
        JSON.stringify(log.changes || {}),
        log.notes || ''
      ])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-trail-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  // Render changes in a readable format
  const renderChanges = (changes) => {
    if (!changes) return 'No changes recorded';
    
    const { before, after } = changes;
    
    if (before === null && after) {
      return (
        <div className={styles.changesContainer}>
          <span className={styles.createdLabel}>Created with data:</span>
          <pre className={styles.changesData}>
            {JSON.stringify(after, null, 2)}
          </pre>
        </div>
      );
    }
    
    if (after === null && before) {
      return (
        <div className={styles.changesContainer}>
          <span className={styles.deletedLabel}>Deleted user data:</span>
          <pre className={styles.changesData}>
            {JSON.stringify(before, null, 2)}
          </pre>
        </div>
      );
    }
    
    if (before && after) {
      const changesList = [];
      
      // Find differences
      Object.keys(after).forEach(key => {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
          changesList.push({
            field: key,
            from: before[key],
            to: after[key]
          });
        }
      });
      
      if (changesList.length === 0) {
        return 'No significant changes';
      }
      
      return (
        <div className={styles.changesContainer}>
          <span className={styles.changedLabel}>Changed fields:</span>
          <ul className={styles.changesList}>
            {changesList.map((change, index) => (
              <li key={index} className={styles.changeItem}>
                <span className={styles.changeField}>{change.field}:</span>
                <span className={styles.changeFrom}>{JSON.stringify(change.from)}</span>
                <span className={styles.changeArrow}>→</span>
                <span className={styles.changeTo}>{JSON.stringify(change.to)}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    
    return 'Changes unavailable';
  };
  
  if (!canViewAuditTrail) {
    return (
      <div className={styles.accessDenied}>
        <div className={styles.accessDeniedIcon}>🔒</div>
        <h3>Access Denied</h3>
        <p>You need administrator privileges to view the audit trail.</p>
      </div>
    );
  }
  
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Audit Trail</h1>
        <p className={styles.subtitle}>
          Track all administrative actions and role changes in the system.
          {filteredLogs.length > 0 && ` Showing ${filteredLogs.length} of ${auditLogs.length} logs.`}
        </p>
      </header>
      
      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.searchContainer}>
          <input
            type="text"
            placeholder="Search by user ID or action..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles.searchInput}
          />
          <span className={styles.searchIcon}>🔍</span>
        </div>
        
        <div className={styles.filters}>
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className={styles.filterSelect}
          >
            {actionFilters.map(filter => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>
        
        <button
          onClick={handleExport}
          className={styles.exportButton}
          disabled={filteredLogs.length === 0}
        >
          📥 Export CSV
        </button>
        
        <button
          onClick={fetchAuditLogs}
          className={styles.refreshButton}
          disabled={loading}
        >
          {loading ? '🔄 Refreshing...' : '🔄 Refresh'}
        </button>
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
          <p>Loading audit logs...</p>
        </div>
      )}
      
      {/* Audit Logs Table */}
      {!loading && filteredLogs.length > 0 && (
        <div className={styles.auditTable}>
          <div className={styles.tableHeader}>
            <div className={styles.headerCell}>Action</div>
            <div className={styles.headerCell}>Module</div>
            <div className={styles.headerCell}>Performed By</div>
            <div className={styles.headerCell}>Affected User/Item</div>
            <div className={styles.headerCell}>Timestamp</div>
            <div className={styles.headerCell}>Details</div>
          </div>
          
          <div className={styles.tableBody}>
            {filteredLogs.map((log, index) => {
              const actionDetails = getActionDetails(log.action);
              
              return (
                <div key={index} className={styles.tableRow}>
                  <div className={styles.tableCell}>
                    <span 
                      className={styles.actionBadge}
                      style={{ backgroundColor: actionDetails.color }}
                    >
                      {actionDetails.icon} {actionDetails.label}
                    </span>
                  </div>
                  
                  <div className={styles.tableCell}>
                    <span className={styles.moduleBadge}>
                      {log.module || 'User Management'}
                    </span>
                  </div>
                  
                  <div className={styles.tableCell}>
                    <div className={styles.userInfo}>
                      <strong>{log.performedBy || 'System'}</strong>
                      {log.performedBy && log.userId && (
                        <div className={styles.userId}>ID: {log.userId.substring(0, 8)}...</div>
                      )}
                    </div>
                  </div>
                  
                  <div className={styles.tableCell}>
                    <div className={styles.affectedInfo}>
                      {log.itemName ? (
                        <>
                          <strong>{log.itemName}</strong>
                          <div className={styles.itemType}>{log.itemType || 'Item'}</div>
                        </>
                      ) : log.affectedUser ? (
                        <>
                          <strong>{log.affectedUser}</strong>
                          {log.targetUserId && (
                            <div className={styles.userId}>ID: {log.targetUserId.substring(0, 8)}...</div>
                          )}
                        </>
                      ) : (
                        <span className={styles.noAffected}>N/A</span>
                      )}
                    </div>
                  </div>
                  
                  <div className={styles.tableCell}>
                    <span className={styles.timestamp}>
                      {formatTimestamp(log.timestamp)}
                    </span>
                  </div>
                  
                  <div className={styles.tableCell}>
                    <div className={styles.detailsContainer}>
                      {log.notes && (
                        <div className={styles.notesText}>{log.notes}</div>
                      )}
                      {renderChanges(log.changes)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Empty State */}
      {!loading && filteredLogs.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📋</div>
          <h3>No Audit Logs Found</h3>
          <p>
            {auditLogs.length === 0 
              ? 'No audit logs have been recorded yet.'
              : 'No logs match your search criteria. Try adjusting your filters.'}
          </p>
        </div>
      )}
      
      {/* Legend */}
      <div className={styles.legend}>
        <h4>Action Legend:</h4>
        <div className={styles.legendItems}>
          {actionFilters.slice(1).map(filter => {
            const details = getActionDetails(filter.value);
            return (
              <div key={filter.value} className={styles.legendItem}>
                <span 
                  className={styles.legendColor}
                  style={{ backgroundColor: details.color }}
                ></span>
                <span className={styles.legendIcon}>{details.icon}</span>
                <span className={styles.legendLabel}>{filter.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default AuditTrail;