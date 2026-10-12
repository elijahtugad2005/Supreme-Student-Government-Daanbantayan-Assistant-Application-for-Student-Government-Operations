// components/CalendarWidget/CalendarWidget.jsx
// PURPOSE: High-end interactive Academic & Event Calendar widget for CTU-Daanbantayan SSG
// DESIGN: Redesigned according to redesign-existing-projects skill:
//   - Tabular figures & modern typography
//   - React Icons (FiCalendar, FiClock, FiChevronLeft, FiChevronRight, FiEdit2, FiTrash2, FiPlus, FiCheck, FiX, etc.)
//   - Sophisticated color palette with single tinted accent, refined surface elevation & glassmorphic borders
//   - Asymmetric 2-column editorial layout: Interactive Month Matrix on left, Live Schedule Agenda on right
//   - Complete interactive & accessible states (loading skeleton, empty states, keyboard navigation, tooltips)

import React, { useState, useEffect } from 'react';
import { db } from '../../firebase/firebaseConfig';
import { collection, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '../AuthContext/AuthContext';
import { 
  FiCalendar, 
  FiClock, 
  FiChevronLeft, 
  FiChevronRight, 
  FiEdit2, 
  FiTrash2, 
  FiCheckCircle, 
  FiInfo, 
  FiX, 
  FiTag, 
  FiShield, 
  FiFilter, 
  FiArrowRight,
  FiAlertCircle
} from 'react-icons/fi';
import styles from './CalendarWidget.module.css';

const EVENT_TYPES = [
  { label: 'Academic / Class', value: 'Class', color: '#38BDF8', badgeBg: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.35)', desc: 'Lectures, class suspensions & academic deadlines' },
  { label: 'Examination', value: 'Exam', color: '#F87171', badgeBg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.35)', desc: 'Prelims, midterms & departmental exams' },
  { label: 'Campus Activity', value: 'Event', color: '#C084FC', badgeBg: 'rgba(192, 132, 252, 0.12)', border: 'rgba(192, 132, 252, 0.35)', desc: 'Intramurals, college days & student assemblies' },
  { label: 'Holiday', value: 'Holiday', color: '#34D399', badgeBg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.35)', desc: 'National & local university holidays' },
  { label: 'SSG Meeting', value: 'Meeting', color: '#FBBF24', badgeBg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.35)', desc: 'Legislative sessions, officer meetings & general assemblies' },
];

function CalendarWidget() {
  const { currentUser } = useAuth() || {};
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [activeDateKey, setActiveDateKey] = useState(null); // Selected date in grid
  const [selectedDayEvents, setSelectedDayEvents] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [filterType, setFilterType] = useState('ALL');

  // Edit State
  const [editingEvent, setEditingEvent] = useState(null);
  const [editFormData, setEditFormData] = useState({
    eventName: '',
    eventDate: '',
    eventType: 'Class',
    requiresAttendance: false,
    description: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

  // Officer / Admin privilege check
  const canEditEvents = Boolean(currentUser);

  // ========================================
  // FETCH EVENTS FROM FIREBASE
  // ========================================
  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(collection(db, 'calendarEvents'), (snapshot) => {
      const eventsData = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      
      eventsData.sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
      setCalendarEvents(eventsData);
      setLoading(false);
    }, (error) => {
      console.error('Failed to load events:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Update selected day view if data changes
  useEffect(() => {
    if (activeDateKey) {
      const updatedList = calendarEvents.filter(e => e.eventDate === activeDateKey);
      setSelectedDayEvents(updatedList);
    }
  }, [calendarEvents, activeDateKey]);

  // ========================================
  // CALENDAR HELPERS
  // ========================================
  const getDaysInMonth = (month, year) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (month, year) => {
    return new Date(year, month, 1).getDay();
  };

  const getEventsForDate = (day) => {
    const dateStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return calendarEvents.filter(event => {
      const matchesDate = event.eventDate === dateStr;
      if (!matchesDate) return false;
      if (filterType === 'ALL') return true;
      return event.eventType === filterType;
    });
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  const formatShortDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    return {
      month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      day: date.getDate(),
      weekday: date.toLocaleDateString('en-US', { weekday: 'short' })
    };
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const getEventTypeMeta = (type) => {
    return EVENT_TYPES.find(t => t.value === type) || EVENT_TYPES[0];
  };

  // ========================================
  // NAVIGATION HANDLERS
  // ========================================
  const handlePrevMonth = () => {
    if (selectedMonth === 0) {
      setSelectedMonth(11);
      setSelectedYear(selectedYear - 1);
    } else {
      setSelectedMonth(selectedMonth - 1);
    }
    setActiveDateKey(null);
  };

  const handleNextMonth = () => {
    if (selectedMonth === 11) {
      setSelectedMonth(0);
      setSelectedYear(selectedYear + 1);
    } else {
      setSelectedMonth(selectedMonth + 1);
    }
    setActiveDateKey(null);
  };

  const handleJumpToToday = () => {
    const today = new Date();
    setSelectedMonth(today.getMonth());
    setSelectedYear(today.getFullYear());
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    setActiveDateKey(dateStr);
    const dayEvents = calendarEvents.filter(e => e.eventDate === dateStr);
    setSelectedDayEvents(dayEvents);
  };

  // ========================================
  // DAY CLICK
  // ========================================
  const handleDateClick = (day) => {
    const dateStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const allEventsOnDay = calendarEvents.filter(e => e.eventDate === dateStr);
    
    setActiveDateKey(dateStr);
    setSelectedDayEvents(allEventsOnDay);

    if (allEventsOnDay.length > 0) {
      setShowEventModal(true);
    }
  };

  // ========================================
  // EDIT EVENT HANDLERS
  // ========================================
  const handleStartEdit = (event) => {
    setEditingEvent(event);
    setEditFormData({
      eventName: event.eventName || '',
      eventDate: event.eventDate || '',
      eventType: event.eventType || 'Class',
      requiresAttendance: Boolean(event.requiresAttendance),
      description: event.description || '',
    });
    setActionMessage(null);
  };

  const handleEditChange = (e) => {
    const { name, value, type, checked } = e.target;
    setEditFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingEvent?.id) return;
    setIsSaving(true);
    setActionMessage(null);

    try {
      const eventRef = doc(db, 'calendarEvents', editingEvent.id);
      await updateDoc(eventRef, {
        eventName: editFormData.eventName.trim(),
        eventDate: editFormData.eventDate,
        eventType: editFormData.eventType,
        requiresAttendance: editFormData.requiresAttendance,
        description: editFormData.description.trim(),
        updatedAt: new Date().toISOString(),
      });

      setActionMessage({ type: 'success', text: 'Event updated successfully.' });
      setTimeout(() => {
        setEditingEvent(null);
        setActionMessage(null);
      }, 1000);
    } catch (err) {
      console.error('Failed to update event:', err);
      setActionMessage({ type: 'error', text: 'Update failed. Check administrative permissions.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEvent = async (eventId, eventName) => {
    if (!window.confirm(`Delete calendar record "${eventName}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'calendarEvents', eventId));
      if (editingEvent?.id === eventId) {
        setEditingEvent(null);
      }
    } catch (err) {
      console.error('Failed to delete event:', err);
      alert('Delete failed. Administrative credentials required.');
    }
  };

  // Upcoming events
  const getUpcomingEvents = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return calendarEvents
      .filter(event => {
        const matchesDate = new Date(event.eventDate) >= today;
        if (!matchesDate) return false;
        if (filterType === 'ALL') return true;
        return event.eventType === filterType;
      })
      .slice(0, 6);
  };

  // Render Calendar Grid Days
  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(selectedMonth, selectedYear);
    const firstDay = getFirstDayOfMonth(selectedMonth, selectedYear);
    const days = [];

    // Empty lead cells
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className={styles.dayEmpty} aria-hidden="true" />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const events = getEventsForDate(day);
      const isToday = 
        day === new Date().getDate() && 
        selectedMonth === new Date().getMonth() && 
        selectedYear === new Date().getFullYear();
      const isSelected = activeDateKey === dateStr;

      days.push(
        <div 
          key={day} 
          className={`${styles.dayCell} ${isToday ? styles.dayToday : ''} ${isSelected ? styles.daySelected : ''} ${events.length > 0 ? styles.dayHasEvents : ''}`}
          onClick={() => handleDateClick(day)}
          role="button"
          tabIndex={0}
          aria-label={`${monthNames[selectedMonth]} ${day}, ${events.length} events`}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleDateClick(day); }}
        >
          <div className={styles.dayCellTop}>
            <span className={styles.dayNumber}>{day}</span>
            {events.length > 0 && (
              <span className={styles.dayCountPill}>
                {events.length}
              </span>
            )}
          </div>

          {events.length > 0 ? (
            <div className={styles.dayEventList}>
              {events.slice(0, 2).map((event, idx) => {
                const meta = getEventTypeMeta(event.eventType);
                return (
                  <div 
                    key={event.id || idx}
                    className={styles.eventMiniTag}
                    style={{
                      borderLeftColor: meta.color,
                      backgroundColor: meta.badgeBg,
                    }}
                    title={`${event.eventName} (${meta.label})`}
                  >
                    <span 
                      className={styles.eventMiniPip}
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className={styles.eventMiniName}>{event.eventName}</span>
                  </div>
                );
              })}
              {events.length > 2 && (
                <div className={styles.moreEventsHint}>+{events.length - 2} more</div>
              )}
            </div>
          ) : (
            <div className={styles.emptyDayPlaceholder} />
          )}
        </div>
      );
    }

    return days;
  };

  const upcoming = getUpcomingEvents();

  return (
    <div className={styles.widgetWrapper}>
      {/* ── TOP ACTION BAR & FILTER SYSTEM ── */}
      <header className={styles.topBar}>
        <div className={styles.brandingBlock}>
          <div className={styles.calendarIconBubble}>
            <FiCalendar className={styles.topIcon} />
          </div>
          <div>
            <div className={styles.eyebrowTag}>
              <span>CAMPUS TIMELINE</span>
              {canEditEvents && (
                <span className={styles.officerBadge}>
                  <FiShield /> OFFICER EDITING
                </span>
              )}
            </div>
            <h3 className={styles.mainTitle}>Academic & Activity Calendar</h3>
          </div>
        </div>

        {/* Filter Pills */}
        <div className={styles.filterGroup}>
          <button
            type="button"
            onClick={() => setFilterType('ALL')}
            className={`${styles.filterPill} ${filterType === 'ALL' ? styles.filterPillActive : ''}`}
          >
            All Items
            <span className={styles.pillCount}>{calendarEvents.length}</span>
          </button>
          {EVENT_TYPES.map((type) => {
            const count = calendarEvents.filter(e => e.eventType === type.value).length;
            return (
              <button
                key={type.value}
                type="button"
                onClick={() => setFilterType(prev => prev === type.value ? 'ALL' : type.value)}
                className={`${styles.filterPill} ${filterType === type.value ? styles.filterPillActive : ''}`}
                style={filterType === type.value ? { borderColor: type.color, color: '#FFFFFF' } : {}}
              >
                <span 
                  className={styles.filterDot}
                  style={{ backgroundColor: type.color }}
                />
                {type.value}
                <span className={styles.pillCount}>{count}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* ── MAIN 2-COLUMN ASYMMETRIC LAYOUT ── */}
      <div className={styles.layoutGrid}>
        
        {/* COLUMN A: INTERACTIVE MONTH MATRIX */}
        <section className={styles.calendarPanel} aria-label="Monthly Calendar Matrix">
          <div className={styles.monthToolbar}>
            <div className={styles.monthDisplay}>
              <h4 className={styles.monthHeading}>
                {monthNames[selectedMonth]} <span className={styles.yearHighlight}>{selectedYear}</span>
              </h4>
              <button 
                type="button" 
                onClick={handleJumpToToday}
                className={styles.todayButton}
              >
                Current Day
              </button>
            </div>

            <div className={styles.navControls}>
              <button 
                type="button"
                onClick={handlePrevMonth}
                className={styles.navButton}
                aria-label="Previous Month"
              >
                <FiChevronLeft />
              </button>
              <button 
                type="button"
                onClick={handleNextMonth}
                className={styles.navButton}
                aria-label="Next Month"
              >
                <FiChevronRight />
              </button>
            </div>
          </div>

          {/* Weekday Header */}
          <div className={styles.weekdayRow}>
            {dayNames.map(name => (
              <div key={name} className={styles.weekdayCell}>{name}</div>
            ))}
          </div>

          {/* Days Grid */}
          {loading ? (
            <div className={styles.loadingSkeletonGrid}>
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className={styles.skeletonCell} />
              ))}
            </div>
          ) : (
            <div className={styles.daysGrid}>
              {renderCalendar()}
            </div>
          )}

          {/* Type Key Footer */}
          <div className={styles.typeKeyFooter}>
            <span className={styles.keyLabel}>CATEGORIES:</span>
            {EVENT_TYPES.map(t => (
              <span key={t.value} className={styles.keyItem}>
                <span className={styles.keyPip} style={{ backgroundColor: t.color }} />
                {t.label}
              </span>
            ))}
          </div>
        </section>

        {/* COLUMN B: LIVE AGENDA & UPCOMING TIMELINE */}
        <aside className={styles.agendaPanel} aria-label="Upcoming Events Agenda">
          <div className={styles.agendaHeader}>
            <div className={styles.agendaTitleGroup}>
              <FiClock className={styles.agendaIcon} />
              <h4 className={styles.agendaTitle}>Upcoming Agenda</h4>
            </div>
            <span className={styles.agendaCountBadge}>
              {upcoming.length} Next
            </span>
          </div>

          <div className={styles.agendaContent}>
            {loading ? (
              <div className={styles.agendaSkeletonList}>
                <div className={styles.agendaSkeletonItem} />
                <div className={styles.agendaSkeletonItem} />
                <div className={styles.agendaSkeletonItem} />
              </div>
            ) : upcoming.length === 0 ? (
              <div className={styles.emptyAgenda}>
                <FiAlertCircle className={styles.emptyIcon} />
                <h5 className={styles.emptyTitle}>No scheduled dates</h5>
                <p className={styles.emptyText}>
                  There are no upcoming activities or deadlines matching the active filter.
                </p>
              </div>
            ) : (
              <div className={styles.timelineList}>
                {upcoming.map((event) => {
                  const meta = getEventTypeMeta(event.eventType);
                  const dateParts = formatShortDate(event.eventDate);

                  return (
                    <article 
                      key={event.id}
                      className={styles.timelineCard}
                      style={{ borderLeftColor: meta.color }}
                    >
                      {/* Date Badge */}
                      <div className={styles.dateBlock}>
                        <span className={styles.dateMonth}>{dateParts.month}</span>
                        <span className={styles.dateDay}>{dateParts.day}</span>
                        <span className={styles.dateWeekday}>{dateParts.weekday}</span>
                      </div>

                      {/* Event Detail */}
                      <div className={styles.cardMain}>
                        <div className={styles.cardHeader}>
                          <span 
                            className={styles.cardTypePill}
                            style={{ 
                              color: meta.color, 
                              backgroundColor: meta.badgeBg,
                              borderColor: meta.border 
                            }}
                          >
                            {meta.label}
                          </span>
                          {event.requiresAttendance && (
                            <span className={styles.attendanceChip} title="Mandatory attendance record">
                              <FiCheckCircle /> Required
                            </span>
                          )}
                        </div>

                        <h5 className={styles.cardTitle}>{event.eventName}</h5>

                        {event.description && (
                          <p className={styles.cardDesc}>{event.description}</p>
                        )}

                        {/* Officer Actions */}
                        {canEditEvents && (
                          <div className={styles.cardOfficerActions}>
                            <button
                              type="button"
                              onClick={() => handleStartEdit(event)}
                              className={styles.btnActionEdit}
                              title="Edit calendar entry"
                            >
                              <FiEdit2 /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteEvent(event.id, event.eventName)}
                              className={styles.btnActionDelete}
                              title="Delete record"
                            >
                              <FiTrash2 />
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

      </div>

      {/* ── MODAL: DAY EVENTS DETAIL ── */}
      {showEventModal && selectedDayEvents && !editingEvent && (
        <div className={styles.modalOverlay} onClick={() => setShowEventModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <header className={styles.modalHeader}>
              <div className={styles.modalHeaderInfo}>
                <span className={styles.modalEyebrow}>DATE OVERVIEW</span>
                <h3 className={styles.modalTitle}>
                  {formatDate(activeDateKey)}
                </h3>
                <span className={styles.modalCounter}>
                  {selectedDayEvents.length} event(s) registered for this date
                </span>
              </div>
              <button 
                type="button"
                onClick={() => setShowEventModal(false)}
                className={styles.modalCloseBtn}
                aria-label="Close dialog"
              >
                <FiX />
              </button>
            </header>

            <div className={styles.modalBody}>
              {selectedDayEvents.map((event) => {
                const meta = getEventTypeMeta(event.eventType);
                return (
                  <div 
                    key={event.id}
                    className={styles.modalItem}
                    style={{ borderLeftColor: meta.color }}
                  >
                    <div className={styles.modalItemTop}>
                      <div>
                        <h4 className={styles.modalItemTitle}>{event.eventName}</h4>
                        <span 
                          className={styles.cardTypePill}
                          style={{ 
                            color: meta.color, 
                            backgroundColor: meta.badgeBg,
                            borderColor: meta.border 
                          }}
                        >
                          {meta.label}
                        </span>
                      </div>
                      {event.requiresAttendance && (
                        <span className={styles.attendanceChip}>
                          <FiCheckCircle /> Attendance Required
                        </span>
                      )}
                    </div>

                    {event.description && (
                      <p className={styles.modalItemDesc}>{event.description}</p>
                    )}

                    {canEditEvents && (
                      <div className={styles.modalItemActions}>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(event)}
                          className={styles.btnActionEdit}
                        >
                          <FiEdit2 /> Edit Entry
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteEvent(event.id, event.eventName)}
                          className={styles.btnActionDelete}
                        >
                          <FiTrash2 /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: EDIT EVENT ── */}
      {editingEvent && (
        <div className={styles.modalOverlay} onClick={() => setEditingEvent(null)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <header className={styles.modalHeader}>
              <div className={styles.modalHeaderInfo}>
                <span className={styles.modalEyebrow}>SSG OFFICER CONSOLE</span>
                <h3 className={styles.modalTitle}>Edit Calendar Entry</h3>
              </div>
              <button 
                type="button"
                onClick={() => setEditingEvent(null)}
                className={styles.modalCloseBtn}
                aria-label="Close dialog"
              >
                <FiX />
              </button>
            </header>

            <form onSubmit={handleSaveEdit} className={styles.modalForm}>
              {actionMessage && (
                <div className={actionMessage.type === 'success' ? styles.alertSuccess : styles.alertError}>
                  {actionMessage.type === 'success' ? <FiCheckCircle /> : <FiAlertCircle />}
                  {actionMessage.text}
                </div>
              )}

              <div className={styles.formField}>
                <label className={styles.fieldLabel}>Event Title *</label>
                <input
                  type="text"
                  name="eventName"
                  value={editFormData.eventName}
                  onChange={handleEditChange}
                  className={styles.fieldInput}
                  placeholder="e.g., Midterm Departmental Exam"
                  required
                />
              </div>

              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Date *</label>
                  <input
                    type="date"
                    name="eventDate"
                    value={editFormData.eventDate}
                    onChange={handleEditChange}
                    className={styles.fieldInput}
                    required
                  />
                </div>

                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>Category / Type *</label>
                  <select
                    name="eventType"
                    value={editFormData.eventType}
                    onChange={handleEditChange}
                    className={styles.fieldSelect}
                  >
                    {EVENT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles.checkboxWrapper}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    name="requiresAttendance"
                    checked={editFormData.requiresAttendance}
                    onChange={handleEditChange}
                    className={styles.checkboxNative}
                  />
                  <span>Require Student Attendance Verification</span>
                </label>
              </div>

              <div className={styles.formField}>
                <label className={styles.fieldLabel}>Description & Guidelines</label>
                <textarea
                  name="description"
                  value={editFormData.description}
                  onChange={handleEditChange}
                  className={styles.fieldTextarea}
                  rows="3"
                  placeholder="Specify venue, target departments, uniform policies, or room assignments..."
                />
              </div>

              <div className={styles.formButtonRow}>
                <button
                  type="button"
                  onClick={() => setEditingEvent(null)}
                  className={styles.btnSecondary}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.btnPrimary}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving Changes...' : 'Save & Publish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default CalendarWidget;