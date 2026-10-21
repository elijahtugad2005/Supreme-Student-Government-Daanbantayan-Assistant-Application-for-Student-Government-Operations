// components/CalendarWidget/subcomponents/BulkActionBar.jsx
import React from 'react';
import { FiCheckSquare, FiEdit, FiTrash2, FiX, FiCalendar } from 'react-icons/fi';
import styles from './InlineCalendarStyles.module.css';

export default function BulkActionBar({
  selectedCount = 0,
  selectedDates = [],
  onBatchEdit,
  onBatchDelete,
  onClearSelection,
  canManage = false,
}) {
  if (selectedCount === 0) return null;

  const sortedDates = [...selectedDates].sort();
  const summaryText = sortedDates.length === 1 
    ? sortedDates[0] 
    : `${sortedDates[0]} ... ${sortedDates[sortedDates.length - 1]}`;

  return (
    <div className={styles.bulkBarContainer}>
      <div className={styles.bulkBarLeft}>
        <div className={styles.bulkBadge}>
          <FiCheckSquare className={styles.bulkIcon} />
          <span className={styles.bulkCount}>{selectedCount}</span>
        </div>
        <div>
          <h5 className={styles.bulkTitle}>
            {selectedCount} Date{selectedCount > 1 ? 's' : ''} Selected
          </h5>
          <span className={styles.bulkSubtitle}>
            <FiCalendar /> {summaryText} (Multi-Date / Weekly Series)
          </span>
        </div>
      </div>

      <div className={styles.bulkBarActions}>
        {canManage && (
          <>
            <button
              type="button"
              onClick={onBatchEdit}
              className={styles.bulkEditBtn}
              title="Apply event or batch update to all selected dates"
            >
              <FiEdit /> Batch Create / Edit
            </button>
            <button
              type="button"
              onClick={onBatchDelete}
              className={styles.bulkDeleteBtn}
              title="Delete all calendar events occurring on these dates"
            >
              <FiTrash2 /> Delete On Dates
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onClearSelection}
          className={styles.bulkClearBtn}
          title="Clear date selections"
        >
          <FiX /> Clear
        </button>
      </div>
    </div>
  );
}
