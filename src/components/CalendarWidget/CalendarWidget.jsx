// components/CalendarWidget/CalendarWidget.jsx
// PURPOSE: High-end interactive Academic & Event Calendar widget for CTU-Daanbantayan SSG
// DESIGN: Redesigned according to redesign-existing-projects skill:
//   - Tabular figures & modern typography
//   - React Icons (FiCalendar, FiClock, FiChevronLeft, FiChevronRight, FiEdit2, FiTrash2, FiPlus, FiCheck, FiX, etc.)
//   - Sophisticated color palette with single tinted accent, refined surface elevation & glassmorphic borders
//   - Asymmetric 2-column editorial layout: Interactive Month Matrix on left, Live Schedule Agenda on right
//   - Complete interactive & accessible states (loading skeleton, empty states, keyboard navigation, tooltips)

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../../firebase/firebaseConfig';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, addDoc, setDoc } from 'firebase/firestore';
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
  FiAlertCircle,
  FiPlus,
  FiCheckSquare
} from 'react-icons/fi';
import styles from './CalendarWidget.module.css';
import InlineQuickEventPopover from './subcomponents/InlineQuickEventPopover';
import EventHoverCard from './subcomponents/EventHoverCard';
import UndoSnackbar from './subcomponents/UndoSnackbar';
import BulkActionBar from './subcomponents/BulkActionBar';

const EVENT_TYPES = [
  { label: 'Academic / Class', value: 'Class', color: '#38BDF8', badgeBg: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.35)', desc: 'Lectures, class suspensions & academic deadlines' },
  { label: 'Examination', value: 'Exam', color: '#F87171', badgeBg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.35)', desc: 'Prelims, midterms & departmental exams' },
  { label: 'Campus Activity', value: 'Event', color: '#C084FC', badgeBg: 'rgba(192, 132, 252, 0.12)', border: 'rgba(192, 132, 252, 0.35)', desc: 'Intramurals, college days & student assemblies' },
  { label: 'Holiday', value: 'Holiday', color: '#34D399', badgeBg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.35)', desc: 'National & local university holidays' },
  { label: 'SSG Meeting', value: 'Meeting', color: '#FBBF24', badgeBg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.35)', desc: 'Legislative sessions, officer meetings & general assemblies' },
];

function CalendarWidget({ readOnly = false, isClassicHomepage = false }) {
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

  // ── INLINE, RANGE SELECTION & BATCH EDIT STATES ──
  const [quickPopover, setQuickPopover] = useState(null); // { isOpen, position, selectedDates, existingEvent }
  const [hoverCard, setHoverCard] = useState(null); // { event, position, meta }
  const [isDraggingRange, setIsDraggingRange] = useState(false);
  const [rangeStartDay, setRangeStartDay] = useState(null);
  const [rangeEndDay, setRangeEndDay] = useState(null);
  const [isSelectMode, setIsSelectMode] = useState(false); // Multi-date selection mode toggle
  const [selectedDateKeys, setSelectedDateKeys] = useState(new Set()); // Set of 'YYYY-MM-DD'
  const [undoState, setUndoState] = useState(null); // { message, previousEvent, isCreate, isDelete }
  const calendarGridRef = useRef(null);

  // User permission check (Disabled if readOnly is true, else defaults for officers/admins/creatives)
  const userRole = (currentUser?.role || '').toLowerCase();
  const canManageEvents = Boolean(
    !readOnly &&
    currentUser && (
      !currentUser.role ||
      userRole === 'admin' ||
      userRole === 'secretary' ||
      userRole === 'governor' ||
      userRole === 'finance_secretary' ||
      userRole === 'representative' ||
      userRole === 'senator' ||
      userRole === 'creatives' ||
      userRole === 'officer' ||
      userRole === 'member' ||
      currentUser?.canManageCreatives
    )
  );
  const canEditEvents = canManageEvents;

  const [organizations, setOrganizations] = useState([]);

  // ========================================
  // FETCH EVENTS & ORGANIZATIONS FROM FIREBASE
  // ========================================
  useEffect(() => {
    // Live listener for registered organizations from Member Management
    const unsubOrgs = onSnapshot(collection(db, 'organizations'), (snapshot) => {
      const orgsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setOrganizations(orgsData);
    }, (err) => console.error('Failed to load organizations:', err));

    return () => unsubOrgs();
  }, []);

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

  // Perf: index filtered events by 'YYYY-MM-DD' once per data/filter change,
  // instead of filtering the full list for every cell on every render (hover, drag...).
  const eventsByDate = useMemo(() => {
    const map = new Map();
    for (const event of calendarEvents) {
      if (filterType !== 'ALL' && event.eventType !== filterType) continue;
      const keys = new Set(Array.isArray(event.dates) ? event.dates : []);
      if (event.eventDate) keys.add(event.eventDate);
      for (const key of keys) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(event);
      }
    }
    return map;
  }, [calendarEvents, filterType]);

  const EMPTY_EVENTS = [];
  const getEventsForDate = (day) => {
    const dateStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return eventsByDate.get(dateStr) || EMPTY_EVENTS;
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

  // ── RANGE SELECTION & INLINE POPOVER HANDLERS ──
  const getDateStr = (day) => {
    return `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const getDaysBetween = (start, end) => {
    const minDay = Math.min(start, end);
    const maxDay = Math.max(start, end);
    const dates = [];
    for (let d = minDay; d <= maxDay; d++) {
      dates.push(getDateStr(d));
    }
    return dates;
  };

  // Cell Mouse Down (Starts Range Drag or Single Cell Click)
  const handleCellMouseDown = (e, day) => {
    if (e.button !== 0) return;

    if (readOnly || !canManageEvents) {
      const dateStr = getDateStr(day);
      const allEventsOnDay = calendarEvents.filter(
        ev => ev.eventDate === dateStr || (Array.isArray(ev.dates) && ev.dates.includes(dateStr))
      );
      setActiveDateKey(dateStr);
      setSelectedDayEvents(allEventsOnDay);
      if (allEventsOnDay.length > 0) {
        setShowEventModal(true);
      }
      return;
    }

    if (isSelectMode) {
      // Manual multi-selection mode: toggle this date in/out of set
      const dateStr = getDateStr(day);
      setSelectedDateKeys(prev => {
        const next = new Set(prev);
        if (next.has(dateStr)) {
          next.delete(dateStr);
        } else {
          next.add(dateStr);
        }
        return next;
      });
      return;
    }

    setIsDraggingRange(true);
    setRangeStartDay(day);
    setRangeEndDay(day);
    setHoverCard(null);
  };

  const handleCellMouseEnter = (day) => {
    if (readOnly || !canManageEvents) return;
    if (isDraggingRange && !isSelectMode) {
      setRangeEndDay(day);
    }
  };

  const handleCellMouseUp = (e, day) => {
    if (readOnly || !canManageEvents) return;
    if (isSelectMode) return;
    if (!isDraggingRange) return;
    setIsDraggingRange(false);

    const start = rangeStartDay || day;
    const end = day;
    const selectedDays = getDaysBetween(start, end);

    // Calculate anchor position for popover relative to calendarGrid
    const rect = e.currentTarget.getBoundingClientRect();
    const parentRect = calendarGridRef.current?.getBoundingClientRect() || { top: 0, left: 0 };
    
    const posX = Math.max(10, rect.left - parentRect.left);
    const posY = Math.max(10, rect.bottom - parentRect.top);

    const dateStr = getDateStr(day);
    const allEventsOnDay = calendarEvents.filter(
      ev => ev.eventDate === dateStr || (Array.isArray(ev.dates) && ev.dates.includes(dateStr))
    );
    setActiveDateKey(dateStr);
    setSelectedDayEvents(allEventsOnDay);

    // Open Inline Quick Popover
    setQuickPopover({
      isOpen: true,
      position: { x: posX, y: posY },
      selectedDates: selectedDays,
      existingEvent: null,
    });
  };

  // Direct Quick-Edit Click on Existing Mini Tag
  const handleQuickEditEvent = (e, event) => {
    e.stopPropagation();
    if (readOnly || !canManageEvents) {
      // In read-only mode, clicking an event opens the day details modal for reading
      setActiveDateKey(event.eventDate);
      const allEventsOnDay = calendarEvents.filter(
        ev => ev.eventDate === event.eventDate || (Array.isArray(ev.dates) && ev.dates.includes(event.eventDate))
      );
      setSelectedDayEvents(allEventsOnDay);
      setShowEventModal(true);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const parentRect = calendarGridRef.current?.getBoundingClientRect() || { top: 0, left: 0 };

    setQuickPopover({
      isOpen: true,
      position: { x: Math.max(10, rect.left - parentRect.left), y: Math.max(10, rect.bottom - parentRect.top) },
      selectedDates: Array.isArray(event.dates) ? event.dates : [event.eventDate],
      existingEvent: event,
    });
    setHoverCard(null);
  };

  // Hover Card Triggers
  const handleEventMouseEnter = (e, event) => {
    if (quickPopover?.isOpen || isDraggingRange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const parentRect = calendarGridRef.current?.getBoundingClientRect() || { top: 0, left: 0 };
    const meta = getEventTypeMeta(event.eventType);

    setHoverCard({
      event,
      position: {
        x: Math.min(parentRect.width - 310, Math.max(10, rect.left - parentRect.left)),
        y: Math.max(10, rect.top - parentRect.top - 8),
      },
      meta,
    });
  };

  const handleEventMouseLeave = () => {
    setHoverCard(null);
  };

  // Save Inline Quick Event (Create or Update)
  const handleSaveQuickEvent = async (eventData, eventId) => {
    try {
      if (eventId) {
        // Updating existing event
        const oldEvent = calendarEvents.find(ev => ev.id === eventId);
        const eventRef = doc(db, 'calendarEvents', eventId);
        await updateDoc(eventRef, eventData);

        setUndoState({
          message: `Updated "${eventData.eventName}"`,
          revertAction: async () => {
            await updateDoc(eventRef, oldEvent);
          }
        });
      } else {
        // Creating new event
        const docRef = await addDoc(collection(db, 'calendarEvents'), {
          ...eventData,
          createdBy: {
            uid: currentUser?.uid || 'guest',
            email: currentUser?.email || 'officer@ctu.edu.ph',
            name: currentUser?.displayName || 'Officer',
            role: userRole || 'officer',
          }
        });

        setUndoState({
          message: `Created "${eventData.eventName}"`,
          revertAction: async () => {
            await deleteDoc(doc(db, 'calendarEvents', docRef.id));
          }
        });
      }

      setQuickPopover(null);
      setRangeStartDay(null);
      setRangeEndDay(null);
    } catch (err) {
      console.error('Failed to save quick event:', err);
      alert('Action failed. Administrative credentials required.');
    }
  };

  // Delete Inline Quick Event
  const handleDeleteQuickEvent = async (event) => {
    if (!window.confirm(`Delete event "${event.eventName}"?`)) return;
    try {
      await deleteDoc(doc(db, 'calendarEvents', event.id));
      setQuickPopover(null);

      setUndoState({
        message: `Deleted "${event.eventName}"`,
        revertAction: async () => {
          const { id, ...rest } = event;
          await setDoc(doc(db, 'calendarEvents', id), rest);
        }
      });
    } catch (err) {
      console.error('Failed to delete quick event:', err);
      alert('Delete failed.');
    }
  };

  // ── BATCH SELECTION HANDLERS ──
  const handleBatchEdit = () => {
    if (selectedDateKeys.size === 0) return;
    const sortedDates = Array.from(selectedDateKeys).sort();

    // Center popover relative to calendar grid
    const parentRect = calendarGridRef.current?.getBoundingClientRect() || { width: 500, height: 400 };
    setQuickPopover({
      isOpen: true,
      position: { x: Math.max(20, (parentRect.width / 2) - 180), y: 80 },
      selectedDates: sortedDates,
      existingEvent: null,
    });
  };

  const handleBatchDelete = async () => {
    if (selectedDateKeys.size === 0) return;
    const datesArr = Array.from(selectedDateKeys);
    
    // Find all events occurring on any of the selected dates
    const matchingEvents = calendarEvents.filter(ev => {
      if (datesArr.includes(ev.eventDate)) return true;
      if (Array.isArray(ev.dates) && ev.dates.some(d => datesArr.includes(d))) return true;
      return false;
    });

    if (matchingEvents.length === 0) {
      alert('No scheduled events found on the selected dates.');
      return;
    }

    if (!window.confirm(`Delete all ${matchingEvents.length} event(s) across the ${datesArr.length} selected dates?`)) {
      return;
    }

    try {
      // Snapshot for Undo
      const backupList = matchingEvents.map(ev => ({ ...ev }));
      
      await Promise.all(matchingEvents.map(ev => deleteDoc(doc(db, 'calendarEvents', ev.id))));

      setSelectedDateKeys(new Set());
      setIsSelectMode(false);

      setUndoState({
        message: `Deleted ${matchingEvents.length} event(s) on ${datesArr.length} dates`,
        revertAction: async () => {
          await Promise.all(backupList.map(ev => {
            const { id, ...data } = ev;
            return setDoc(doc(db, 'calendarEvents', id), data);
          }));
        }
      });
    } catch (err) {
      console.error('Batch delete failed:', err);
      alert('Batch delete failed.');
    }
  };
  // ========================================
  const handleStartEdit = (event) => {
    setEditingEvent(event);
    setEditFormData({
      eventName: event.eventName || '',
      eventDate: event.eventDate || '',
      eventType: event.eventType || 'Class',
      requiresAttendance: Boolean(event.requiresAttendance),
      description: event.description || '',
      iconType: event.iconType || (event.managingOrgLogo ? 'logo' : 'emoji'),
      emoji: event.emoji || '📅',
      managingOrgLogo: event.managingOrgLogo || '',
      managingOrgTag: event.managingOrgTag || 'SSG',
    });
    setQuickPopover(null);
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
        iconType: editFormData.iconType,
        emoji: editFormData.emoji,
        managingOrgLogo: editFormData.managingOrgLogo,
        managingOrgTag: editFormData.managingOrgTag,
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

    const minRange = rangeStartDay && rangeEndDay ? Math.min(rangeStartDay, rangeEndDay) : null;
    const maxRange = rangeStartDay && rangeEndDay ? Math.max(rangeStartDay, rangeEndDay) : null;
    const now = new Date();
    const isCurrentMonth = selectedMonth === now.getMonth() && selectedYear === now.getFullYear();
    const todayDate = now.getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const events = getEventsForDate(day);
      const isToday = isCurrentMonth && day === todayDate;
      const isSelected = activeDateKey === dateStr;
      const isInRange = minRange !== null && maxRange !== null && day >= minRange && day <= maxRange;
      const isRangeAnchor = day === rangeStartDay;

      const isMultiSelected = selectedDateKeys.has(dateStr);

      days.push(
        <div 
          key={day} 
          className={`${styles.dayCell} ${isToday ? styles.dayToday : ''} ${isSelected ? styles.daySelected : ''} ${events.length > 0 ? styles.dayHasEvents : ''} ${isInRange ? styles.dayInRange : ''} ${isRangeAnchor ? styles.dayRangeAnchor : ''} ${isMultiSelected ? styles.dayMultiSelected : ''}`}
          onMouseDown={(e) => handleCellMouseDown(e, day)}
          onMouseEnter={() => handleCellMouseEnter(day)}
          onMouseUp={(e) => handleCellMouseUp(e, day)}
          role="button"
          tabIndex={0}
          aria-label={`${monthNames[selectedMonth]} ${day}, ${events.length} events`}
          onKeyDown={(e) => { 
            if (e.key === 'Enter' || e.key === ' ') {
              handleCellMouseDown(e, day);
              handleCellMouseUp(e, day);
            } 
          }}
        >
          <div className={styles.dayCellTop}>
            <span className={styles.dayNumber}>{day}</span>
            {isMultiSelected && (
              <span className={styles.dayCheckPill}>
                <FiCheckCircle style={{ color: '#38BDF8' }} />
              </span>
            )}
            {!isMultiSelected && events.length > 0 && (
              <span className={styles.dayCountPill}>
                {events.length}
              </span>
            )}
          </div>

          {events.length > 0 ? (
            <div className={styles.dayEventList}>
              {events.slice(0, 2).map((event, idx) => {
                const meta = getEventTypeMeta(event.eventType);
                const eventColor = event.color || meta.color;
                return (
                  <div 
                    key={event.id || idx}
                    className={styles.eventMiniTag}
                    style={{
                      borderLeftColor: eventColor,
                      backgroundColor: meta.badgeBg,
                    }}
                    onClick={(e) => handleQuickEditEvent(e, event)}
                    onMouseEnter={(e) => handleEventMouseEnter(e, event)}
                    onMouseLeave={handleEventMouseLeave}
                    title={canEditEvents ? `${event.eventName} (Click to edit)` : `${event.eventName} (Click to view)`}
                  >
                    <span 
                      className={styles.eventMiniPip}
                      style={{ backgroundColor: eventColor }}
                    />
                    {event.iconType === 'logo' && event.managingOrgLogo && (event.managingOrgLogo.startsWith('data:') || event.managingOrgLogo.startsWith('http')) ? (
                      <img 
                        src={event.managingOrgLogo} 
                        alt="Org" 
                        style={{ width: '14px', height: '14px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, marginRight: '2px' }} 
                      />
                    ) : (
                      event.emoji && <span style={{ fontSize: '0.75rem', marginRight: '2px' }}>{event.emoji}</span>
                    )}
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

  const upcoming = useMemo(getUpcomingEvents, [calendarEvents, filterType]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`${styles.widgetWrapper} ${isClassicHomepage ? styles.widgetClassic : ''}`}>
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
        <section 
          ref={calendarGridRef}
          className={styles.calendarPanel} 
          aria-label="Monthly Calendar Matrix"
          style={{ position: 'relative', zIndex: 50 }}
        >
          {/* Quick-Add / Quick-Edit Popover */}
          {quickPopover?.isOpen && (
            <InlineQuickEventPopover
              selectedDates={quickPopover.selectedDates}
              existingEvent={quickPopover.existingEvent}
              position={quickPopover.position}
              canManage={canManageEvents}
              orgList={organizations}
              onClose={() => {
                setQuickPopover(null);
                setRangeStartDay(null);
                setRangeEndDay(null);
              }}
              onSave={handleSaveQuickEvent}
              onDelete={handleDeleteQuickEvent}
              onOpenAdvanced={handleStartEdit}
            />
          )}

          {/* Hover Card */}
          {hoverCard && (
            <EventHoverCard
              event={hoverCard.event}
              position={hoverCard.position}
              meta={hoverCard.meta}
            />
          )}

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

              {/* Multi-Date / Weekly Selection Mode Toggle */}
              {canManageEvents && (
                <button
                  type="button"
                  onClick={() => {
                    setIsSelectMode(prev => !prev);
                    if (isSelectMode) {
                      setSelectedDateKeys(new Set());
                    }
                  }}
                  className={`${styles.todayButton} ${isSelectMode ? styles.selectModeActive : ''}`}
                  style={isSelectMode ? { borderColor: '#38BDF8', color: '#38BDF8', background: 'rgba(56, 189, 248, 0.2)' } : { borderColor: 'rgba(56, 189, 248, 0.4)', color: '#38BDF8' }}
                  title="Toggle multi-date selection for batch editing & weekly series"
                >
                  <FiCheckSquare style={{ marginRight: '5px', verticalAlign: 'middle', fontSize: '0.85rem' }} />
                  {isSelectMode ? 'Selecting Dates...' : 'Select Dates'}
                </button>
              )}
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

                        <h5 className={styles.cardTitle} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {event.iconType === 'logo' && event.managingOrgLogo && (event.managingOrgLogo.startsWith('data:') || event.managingOrgLogo.startsWith('http')) ? (
                            <img
                              src={event.managingOrgLogo}
                              alt="Org"
                              style={{ width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                            />
                          ) : (
                            event.emoji && <span style={{ fontSize: '1rem', flexShrink: 0 }}>{event.emoji}</span>
                          )}
                          <span>{event.eventName}</span>
                        </h5>

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
                        <h4 className={styles.modalItemTitle} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {event.iconType === 'logo' && event.managingOrgLogo && (event.managingOrgLogo.startsWith('data:') || event.managingOrgLogo.startsWith('http')) ? (
                            <img
                              src={event.managingOrgLogo}
                              alt="Org"
                              style={{ width: '20px', height: '20px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                            />
                          ) : (
                            event.emoji && <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{event.emoji}</span>
                          )}
                          <span>{event.eventName}</span>
                        </h4>
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
                {canEditEvents && (
                  <button
                    type="button"
                    onClick={async () => {
                      const id = editingEvent.id;
                      const name = editingEvent.eventName;
                      setEditingEvent(null);
                      await handleDeleteEvent(id, name);
                    }}
                    className={styles.btnDanger}
                    disabled={isSaving}
                  >
                    <FiTrash2 /> Delete
                  </button>
                )}
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

      {/* ── BATCH / MULTI-DATE ACTION BAR ── */}
      {canManageEvents && (
        <BulkActionBar
          selectedCount={selectedDateKeys.size}
          selectedDates={Array.from(selectedDateKeys)}
          canManage={canManageEvents}
          onBatchEdit={handleBatchEdit}
          onBatchDelete={handleBatchDelete}
          onClearSelection={() => setSelectedDateKeys(new Set())}
        />
      )}

      {/* ── UNDO TOAST NOTIFICATION ── */}
      {undoState && (
        <UndoSnackbar
          message={undoState.message}
          onUndo={async () => {
            if (undoState.revertAction) {
              await undoState.revertAction();
            }
            setUndoState(null);
          }}
          onDismiss={() => setUndoState(null)}
          durationSeconds={8}
        />
      )}
    </div>
  );
}

export default CalendarWidget;