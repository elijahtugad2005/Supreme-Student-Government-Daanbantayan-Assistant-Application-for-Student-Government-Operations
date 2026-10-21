// components/CalendarWidget/subcomponents/EventHoverCard.jsx
import React from 'react';
import { FiClock, FiMapPin, FiCheckCircle, FiShield, FiTag } from 'react-icons/fi';
import styles from './InlineCalendarStyles.module.css';

export default function EventHoverCard({ event, position, meta }) {
  if (!event) return null;

  const style = {
    top: `${position.y}px`,
    left: `${position.x}px`,
  };

  return (
    <div className={styles.hoverCardContainer} style={style}>
      <div className={styles.hoverCardHeader} style={{ borderLeftColor: event.color || meta?.color || '#38BDF8' }}>
        <div className={styles.hoverOrgRow}>
          {event.iconType === 'logo' && event.managingOrgLogo && (event.managingOrgLogo.startsWith('data:') || event.managingOrgLogo.startsWith('http') || event.managingOrgLogo.startsWith('/')) ? (
            <img src={event.managingOrgLogo} alt="Org Logo" style={{ width: '20px', height: '20px', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <span className={styles.hoverEmoji}>{event.emoji || '📅'}</span>
          )}
          {event.managingOrgTag && (
            <span className={styles.hoverOrgBadge} style={{ borderColor: event.color || meta?.color }}>
              {event.managingOrgTag}
            </span>
          )}
          <span className={styles.hoverTypeTag}>{event.eventType || 'Event'}</span>
        </div>
        <h4 className={styles.hoverTitle}>{event.eventName}</h4>
      </div>

      <div className={styles.hoverBody}>
        {event.isMultiDay && event.dates?.length > 1 && (
          <div className={styles.hoverMetaRow}>
            <span className={styles.hoverMetaLabel}>Duration:</span>
            <span className={styles.hoverMetaValue}>
              {event.startDate} to {event.endDate} ({event.dates.length} days)
            </span>
          </div>
        )}

        {(event.startTime || event.endTime) && (
          <div className={styles.hoverMetaRow}>
            <FiClock className={styles.hoverIcon} />
            <span className={styles.hoverMetaValue}>
              {event.startTime || 'Start'} {event.endTime ? `– ${event.endTime}` : ''}
            </span>
          </div>
        )}

        {event.location && (
          <div className={styles.hoverMetaRow}>
            <FiMapPin className={styles.hoverIcon} />
            <span className={styles.hoverMetaValue}>{event.location}</span>
          </div>
        )}

        {event.requiresAttendance && (
          <div className={styles.hoverAttendanceBadge}>
            <FiCheckCircle /> Mandatory Attendance Required
          </div>
        )}

        {event.description && (
          <p className={styles.hoverDescription}>{event.description}</p>
        )}
      </div>
    </div>
  );
}
