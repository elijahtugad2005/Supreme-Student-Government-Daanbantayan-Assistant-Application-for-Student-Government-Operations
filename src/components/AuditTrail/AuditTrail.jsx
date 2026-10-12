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
import { 
  ShieldAlert, 
  History, 
  Search, 
  Download, 
  RefreshCw, 
  UserCheck, 
  Key, 
  UserPlus, 
  UserMinus, 
  Edit3, 
  DollarSign, 
  FileText, 
  Trash2, 
  Clock, 
  Activity, 
  ArrowRight,
  Filter,
  CheckCircle,
  AlertTriangle,
  FolderOpen
} from 'lucide-react';
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
    { value: 'all', label: 'All Security Actions' },
    { value: 'role_changed', label: 'Role Changes' },
    { value: 'permissions_changed', label: 'Permission Overrides' },
    { value: 'user_created', label: 'User Provisioning' },
    { value: 'user_updated', label: 'Profile Modifications' },
    { value: 'user_deleted', label: 'User Deactivations' },
    { value: 'budget_created', label: 'Budget Allocation' },
    { value: 'budget_updated', label: 'Budget Revisions' },
    { value: 'budget_deleted', label: 'Budget Deletions' },
    { value: 'expense_created', label: 'Expense Disbursement' },
    { value: 'expense_updated', label: 'Expense Alteration' },
    { value: 'expense_deleted', label: 'Expense Deletions' },
    { value: 'income_created', label: 'Revenue Recording' },
    { value: 'financial_report_generated', label: 'Report Audits' },
    { value: 'financial_data_exported', label: 'Data Extractions' }
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
        return { Icon: UserCheck, color: '#10b981', label: 'Role Changed' };
      case 'permissions_changed':
        return { Icon: Key, color: '#3b82f6', label: 'Permissions Updated' };
      case 'user_created':
        return { Icon: UserPlus, color: '#8b5cf6', label: 'User Provisioned' };
      case 'user_updated':
        return { Icon: Edit3, color: '#f59e0b', label: 'User Modified' };
      case 'user_deleted':
        return { Icon: UserMinus, color: '#ef4444', label: 'User Deactivated' };
      
      // Finance Actions
      case 'budget_created':
        return { Icon: DollarSign, color: '#10b981', label: 'Budget Created' };
      case 'budget_updated':
        return { Icon: DollarSign, color: '#3b82f6', label: 'Budget Revised' };
      case 'budget_deleted':
        return { Icon: Trash2, color: '#ef4444', label: 'Budget Deleted' };
      case 'expense_created':
        return { Icon: FileText, color: '#f59e0b', label: 'Expense Logged' };
      case 'expense_updated':
        return { Icon: Edit3, color: '#3b82f6', label: 'Expense Altered' };
      case 'expense_deleted':
        return { Icon: Trash2, color: '#ef4444', label: 'Expense Deleted' };
      case 'income_created':
        return { Icon: DollarSign, color: '#10b981', label: 'Income Recorded' };
      case 'financial_report_generated':
        return { Icon: Activity, color: '#8b5cf6', label: 'Report Generated' };
      case 'financial_data_exported':
        return { Icon: Download, color: '#64748b', label: 'Data Exported' };
      case 'bulk_delete':
        return { Icon: Trash2, color: '#ef4444', label: 'Bulk Deletion' };
      case 'bulk_update':
        return { Icon: Edit3, color: '#3b82f6', label: 'Bulk Update' };
      
      default:
        return { Icon: Activity, color: '#64748b', label: 'Action Recorded' };
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
        <div className={styles.accessDeniedIcon}><ShieldAlert size={48} /></div>
        <h3>Administrative Security Clearance Required</h3>
        <p>You need verified administrator credentials to review the institutional audit trail.</p>
      </div>
    );
  }
  
  return (
    <div className={styles.container}>
      {/* Top Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.eyebrowBadge}>
            <History size={13} />
            <span>Immutable Security Log</span>
          </div>
          <h1 className={styles.title}>System Audit Trail</h1>
          <p className={styles.subtitle}>
            Comprehensive chronological log of administrator transactions, role elevations, and operational mutations.
            {filteredLogs.length > 0 && ` Displaying ${filteredLogs.length} of ${auditLogs.length} total entries.`}
          </p>
        </div>
      </header>
      
      {/* Controls Bar */}
      <div className={styles.controls}>
        <div className={styles.searchContainer}>
          <Search size={18} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search by admin name, affected entity, user ID, or module..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        
        <div className={styles.filters}>
          <div className={styles.filterWrapper}>
            <Filter size={15} className={styles.filterIcon} />
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
        </div>
        
        <div className={styles.actionButtons}>
          <button
            onClick={handleExport}
            className={styles.exportButton}
            disabled={filteredLogs.length === 0}
            title="Download CSV Audit Log"
          >
            <Download size={16} />
            Export CSV
          </button>
          
          <button
            onClick={fetchAuditLogs}
            className={styles.refreshButton}
            disabled={loading}
            title="Sync Latest Logs"
          >
            <RefreshCw size={16} className={loading ? styles.spinIcon : ''} />
            {loading ? 'Syncing...' : 'Refresh'}
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
      
      {/* Loading State */}
      {loading && (
        <div className={styles.loadingState}>
          <div className={styles.spinner}></div>
          <p>Retrieving cryptographic audit logs from server...</p>
        </div>
      )}
      
      {/* Audit Logs Table */}
      {!loading && filteredLogs.length > 0 && (
        <div className={styles.auditTable}>
          <div className={styles.tableHeader}>
            <div className={styles.headerCell}>Security Action</div>
            <div className={styles.headerCell}>Module</div>
            <div className={styles.headerCell}>Initiator</div>
            <div className={styles.headerCell}>Target / Resource</div>
            <div className={styles.headerCell}>Timestamp</div>
            <div className={styles.headerCell}>Differential Payload</div>
          </div>
          
          <div className={styles.tableBody}>
            {filteredLogs.map((log, index) => {
              const actionDetails = getActionDetails(log.action);
              const ActionIcon = actionDetails.Icon;
              
              return (
                <div key={index} className={styles.tableRow}>
                  {/* Action Badge */}
                  <div className={styles.tableCell}>
                    <span 
                      className={styles.actionBadge}
                      style={{ 
                        backgroundColor: `${actionDetails.color}18`,
                        color: actionDetails.color,
                        borderColor: `${actionDetails.color}40`
                      }}
                    >
                      <ActionIcon size={14} />
                      <span>{actionDetails.label}</span>
                    </span>
                  </div>
                  
                  {/* Module Badge */}
                  <div className={styles.tableCell}>
                    <span className={styles.moduleBadge}>
                      <FolderOpen size={12} />
                      <span>{log.module || 'User Management'}</span>
                    </span>
                  </div>
                  
                  {/* Initiator */}
                  <div className={styles.tableCell}>
                    <div className={styles.userInfo}>
                      <strong className={styles.initiatorName}>{log.performedBy || 'System'}</strong>
                      {log.performedBy && log.userId && (
                        <span className={styles.userId}>UID: {log.userId.substring(0, 8)}...</span>
                      )}
                    </div>
                  </div>
                  
                  {/* Target / Affected Resource */}
                  <div className={styles.tableCell}>
                    <div className={styles.affectedInfo}>
                      {log.itemName ? (
                        <>
                          <strong className={styles.resourceName}>{log.itemName}</strong>
                          <div className={styles.itemType}>{log.itemType || 'Resource Item'}</div>
                        </>
                      ) : log.affectedUser ? (
                        <>
                          <strong className={styles.resourceName}>{log.affectedUser}</strong>
                          {log.targetUserId && (
                            <span className={styles.userId}>UID: {log.targetUserId.substring(0, 8)}...</span>
                          )}
                        </>
                      ) : (
                        <span className={styles.noAffected}>System Wide</span>
                      )}
                    </div>
                  </div>
                  
                  {/* Timestamp */}
                  <div className={styles.tableCell}>
                    <div className={styles.timestampContainer}>
                      <Clock size={13} className={styles.timeIcon} />
                      <span className={styles.timestamp}>
                        {formatTimestamp(log.timestamp)}
                      </span>
                    </div>
                  </div>
                  
                  {/* Details / Diff payload */}
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
          <div className={styles.emptyIcon}><History size={40} /></div>
          <h3>No Audit Records Found</h3>
          <p>
            {auditLogs.length === 0 
              ? 'No security audit events have been logged yet.'
              : 'No audit records match your query or filter parameters.'}
          </p>
        </div>
      )}
      
      {/* Legend */}
      <div className={styles.legend}>
        <div className={styles.legendHeader}>
          <Activity size={16} />
          <h4>Telemetry Action Index</h4>
        </div>
        <div className={styles.legendItems}>
          {actionFilters.slice(1).map(filter => {
            const details = getActionDetails(filter.value);
            const LegendIcon = details.Icon;
            return (
              <div key={filter.value} className={styles.legendItem}>
                <span 
                  className={styles.legendColor}
                  style={{ backgroundColor: details.color }}
                ></span>
                <span className={styles.legendIcon} style={{ color: details.color }}>
                  <LegendIcon size={14} />
                </span>
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