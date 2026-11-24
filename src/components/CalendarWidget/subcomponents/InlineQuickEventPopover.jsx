// components/CalendarWidget/subcomponents/InlineQuickEventPopover.jsx
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FiX,
  FiCheck,
  FiTrash2,
  FiClock,
  FiMapPin,
  FiCalendar,
  FiChevronRight,
  FiFileText,
  FiSliders,
  FiSmile,
  FiAward,
  FiCheckCircle,
  FiAlertCircle,
} from 'react-icons/fi';
import { EVENT_PRESETS, ORG_PRESETS, COLOR_SWATCHES, QUICK_EMOJIS } from './EventPresets';
import styles from './InlineCalendarStyles.module.css';

const EVENT_CATEGORIES = [
  { value: 'Class', label: 'Academic', color: '#38BDF8' },
  { value: 'Exam', label: 'Exam', color: '#F87171' },
  { value: 'Event', label: 'Activity', color: '#C084FC' },
  { value: 'Holiday', label: 'Holiday', color: '#34D399' },
  { value: 'Meeting', label: 'Meeting', color: '#D4AF37' },
];

const LIGHT_SWATCHES = new Set(['#D4AF37', '#FBBF24', '#38BDF8', '#34D399', '#F87171', '#C084FC']);

function isSafeImageSrc(src) {
  return (
    typeof src === 'string' &&
    (src.startsWith('data:') || src.startsWith('http') || src.startsWith('/'))
  );
}

function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatReadableDate(isoStr) {
  if (!isoStr) return '';
  const date = new Date(`${isoStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoStr;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatShortMonthDay(isoStr) {
  if (!isoStr) return '';
  const date = new Date(`${isoStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoStr;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export default function InlineQuickEventPopover({
  selectedDates = [],
  existingEvent = null,
  position = null,
  anchorRect = null,
  onClose,
  onSave,
  onDelete,
  onOpenAdvanced,
  orgList = [],
}) {
  const isEditing = Boolean(existingEvent);
  const initialSortedDates = useMemo(() => [...selectedDates].sort(), [selectedDates]);
  const isMultiDaySelection = initialSortedDates.length > 1;

  const [eventName, setEventName] = useState(existingEvent?.eventName || '');
  const [eventType, setEventType] = useState(existingEvent?.eventType || 'Event');
  const [selectedColor, setSelectedColor] = useState(existingEvent?.color || '#D4AF37');
  const [iconType, setIconType] = useState(
    existingEvent?.iconType || (existingEvent?.managingOrgLogo ? 'logo' : 'emoji')
  );
  const [selectedEmoji, setSelectedEmoji] = useState(existingEvent?.emoji || '📅');
  const [managingOrgTag, setManagingOrgTag] = useState(existingEvent?.managingOrgTag || 'SSG');
  const [managingOrgLogo, setManagingOrgLogo] = useState(existingEvent?.managingOrgLogo || '');
  const [singleDate, setSingleDate] = useState(
    initialSortedDates[0] || existingEvent?.eventDate || getTodayISO()
  );
  const [startTime, setStartTime] = useState(existingEvent?.startTime || '08:00');
  const [endTime, setEndTime] = useState(existingEvent?.endTime || '17:00');
  const [location, setLocation] = useState(existingEvent?.location || '');
  const [requiresAttendance, setRequiresAttendance] = useState(
    Boolean(existingEvent?.requiresAttendance)
  );
  const [activeSection, setActiveSection] = useState('event'); // 'event' | 'schedule' | 'branding'
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Viewport & Positioning state
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );
  const [desktopCoords, setDesktopCoords] = useState(null);
  const panelRef = useRef(null);
  const titleInputRef = useRef(null);

  // Watch mobile breakpoint
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 767px)');
    const handleChange = (e) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  // Lock background scroll on mobile bottom sheet & listen for Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const prevOverflow = document.body.style.overflow;
    if (isMobile) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (isMobile) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [isMobile, onClose]);

  // Focus title input gently on desktop open (avoid unwanted mobile keyboard jump on tap)
  useEffect(() => {
    if (!isMobile && activeSection === 'event' && titleInputRef.current) {
      titleInputRef.current.focus({ preventScroll: true });
    }
  }, [isMobile, activeSection]);

  // Compute smart viewport-clamped position on desktop
  useLayoutEffect(() => {
    if (isMobile) {
      setDesktopCoords(null);
      return undefined;
    }

    const computeCoords = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 16;
      const panelEl = panelRef.current;
      const panelW = panelEl ? panelEl.offsetWidth : 440;
      const panelH = panelEl ? panelEl.offsetHeight : 540;

      if (!anchorRect) {
        // Centered presentation (e.g. Toolbar "+ Quick Add" or Batch Edit)
        setDesktopCoords(null);
        return;
      }

      const gap = 12;
      let left;
      let top;

      // Prefer side-by-side placement so the clicked calendar cell stays visible
      if (anchorRect.right + gap + panelW <= vw - margin) {
        left = anchorRect.right + gap;
        top = anchorRect.top - 16;
      } else if (anchorRect.left - gap - panelW >= margin) {
        left = anchorRect.left - gap - panelW;
        top = anchorRect.top - 16;
      } else {
        // Fallback: align below or above the cell
        left = anchorRect.left + anchorRect.width / 2 - panelW / 2;
        if (anchorRect.bottom + gap + panelH <= vh - margin) {
          top = anchorRect.bottom + gap;
        } else {
          top = anchorRect.top - gap - panelH;
        }
      }

      // Strictly clamp inside the visible viewport
      left = Math.max(margin, Math.min(left, vw - panelW - margin));
      top = Math.max(margin, Math.min(top, vh - panelH - margin));

      setDesktopCoords({ top, left });
    };

    computeCoords();
    window.addEventListener('resize', computeCoords);
    return () => window.removeEventListener('resize', computeCoords);
  }, [isMobile, anchorRect, activeSection, position]);

  // Available Organizations (Dynamic from Member Management Firestore + SSG + fallbacks)
  const availableOrgs = useMemo(() => {
    const list = [];
    const ssgEntry = orgList?.find((o) => o.id === 'ssg');
    list.push({
      id: 'ssg',
      name: ssgEntry?.name || 'Supreme Student Government',
      tag: 'SSG',
      logo: ssgEntry?.logo64 || '/images/logossg.png',
      color: '#D4AF37',
    });

    if (orgList && orgList.length > 0) {
      orgList.forEach((o) => {
        if (o.id !== 'ssg') {
          list.push({
            id: o.id,
            name: o.name,
            tag:
              o.tag ||
              (o.name
                ? o.name
                    .split(' ')
                    .map((w) => w[0])
                    .join('')
                    .substring(0, 4)
                    .toUpperCase()
                : 'ORG'),
            logo: o.logo64 || o.logo || null,
            color: o.color || '#D4AF37',
          });
        }
      });
    } else {
      ORG_PRESETS.forEach((p) => {
        if (!list.some((item) => item.tag === p.tag)) {
          list.push(p);
        }
      });
    }
    return list;
  }, [orgList]);

  const handleApplyPreset = (preset) => {
    setEventType(preset.eventType);
    setSelectedColor(preset.color);
    if (preset.emoji) {
      setSelectedEmoji(preset.emoji);
      setIconType('emoji');
    }
    if (!eventName || EVENT_PRESETS.some((p) => p.label === eventName)) {
      setEventName(preset.label);
      setFormError('');
    }
  };

  const handleApplyOrg = (org) => {
    setManagingOrgTag(org.tag);
    if (org.color) {
      setSelectedColor(org.color);
    }
    if (isSafeImageSrc(org.logo)) {
      setManagingOrgLogo(org.logo);
    }
  };

  const timeRangeWarning =
    startTime && endTime && endTime < startTime
      ? 'End time is earlier than start time.'
      : '';

  const formattedDateSummary = () => {
    if (isMultiDaySelection) {
      return `${formatShortMonthDay(initialSortedDates[0])} – ${formatReadableDate(
        initialSortedDates[initialSortedDates.length - 1]
      )} · ${initialSortedDates.length} days`;
    }
    return formatReadableDate(singleDate || existingEvent?.eventDate);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedName = eventName.trim();
    if (!trimmedName) {
      setFormError('Enter an event title to continue.');
      setActiveSection('event');
      requestAnimationFrame(() => titleInputRef.current?.focus());
      return;
    }

    setFormError('');
    setIsSubmitting(true);

    const finalDates = isMultiDaySelection
      ? initialSortedDates
      : [singleDate || existingEvent?.eventDate || getTodayISO()];
    const startDate = finalDates[0];
    const endDate = finalDates[finalDates.length - 1];
    const isMultiDay = finalDates.length > 1;

    const payload = {
      eventName: trimmedName,
      eventType,
      color: selectedColor,
      iconType,
      emoji: selectedEmoji,
      managingOrgTag,
      managingOrgLogo: managingOrgLogo || existingEvent?.managingOrgLogo || '',
      startTime,
      endTime,
      location: location.trim(),
      requiresAttendance,
      isMultiDay,
      startDate: startDate || existingEvent?.startDate || existingEvent?.eventDate,
      endDate: endDate || existingEvent?.endDate || existingEvent?.eventDate,
      dates: finalDates,
      eventDate: startDate || existingEvent?.eventDate,
      updatedAt: new Date().toISOString(),
    };

    if (!isEditing) {
      payload.createdAt = new Date().toISOString();
    }

    try {
      await onSave(payload, existingEvent?.id);
    } catch (err) {
      console.error('Quick event save error:', err);
      setFormError('Could not save this event. Check your officer permissions and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isAnchoredDesktop = !isMobile && Boolean(anchorRect);
  const inlinePositionStyle = isAnchoredDesktop && desktopCoords
    ? { top: `${desktopCoords.top}px`, left: `${desktopCoords.left}px` }
    : undefined;

  const badgeHasImage = iconType === 'logo' && isSafeImageSrc(managingOrgLogo);

  const popoverMarkup = (
    <div
      className={`${styles.quickOverlay} ${
        isMobile
          ? styles.quickOverlayMobile
          : isAnchoredDesktop
            ? styles.quickOverlayAnchored
            : styles.quickOverlayCentered
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-add-event-title"
        className={`${styles.popoverContainer} ${
          isMobile
            ? styles.popoverSheetMobile
            : isAnchoredDesktop
              ? styles.popoverAnchoredDesktop
              : styles.popoverCenteredDesktop
        }`}
        style={inlinePositionStyle}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Mobile bottom-sheet grab handle */}
        {isMobile && (
          <div className={styles.sheetHandleBar} aria-hidden="true">
            <span className={styles.sheetHandlePill} />
          </div>
        )}

        {/* Header */}
        <header className={styles.popoverHeader}>
          <div className={styles.popoverHeaderTitle}>
            <div
              className={styles.headerEmblem}
              style={{
                borderColor: `${selectedColor}88`,
                backgroundColor: `${selectedColor}1E`,
              }}
              aria-hidden="true"
            >
              {badgeHasImage ? (
                <img
                  src={managingOrgLogo}
                  alt=""
                  className={styles.headerEmblemImg}
                />
              ) : (
                <span className={styles.headerEmblemEmoji}>{selectedEmoji}</span>
              )}
            </div>
            <div className={styles.headerTextCol}>
              <h4 id="quick-add-event-title" className={styles.popoverTitle}>
                {isEditing ? 'Quick Edit Event' : 'Quick Add Event'}
              </h4>
              <div className={styles.popoverDatePill}>
                <FiCalendar className={styles.popoverDateIcon} aria-hidden="true" />
                <span>{formattedDateSummary()}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={styles.iconCloseBtn}
            aria-label="Close quick event editor"
          >
            <FiX />
          </button>
        </header>

        {/* Segmented Tab Bar */}
        <nav className={styles.popoverTabsNav} role="tablist" aria-label="Event editor sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === 'event'}
            onClick={() => setActiveSection('event')}
            className={`${styles.popoverTabBtn} ${
              activeSection === 'event' ? styles.popoverTabBtnActive : ''
            }`}
          >
            <FiFileText aria-hidden="true" />
            <span>Details</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === 'schedule'}
            onClick={() => setActiveSection('schedule')}
            className={`${styles.popoverTabBtn} ${
              activeSection === 'schedule' ? styles.popoverTabBtnActive : ''
            }`}
          >
            <FiClock aria-hidden="true" />
            <span>Schedule</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === 'branding'}
            onClick={() => setActiveSection('branding')}
            className={`${styles.popoverTabBtn} ${
              activeSection === 'branding' ? styles.popoverTabBtnActive : ''
            }`}
          >
            <FiSliders aria-hidden="true" />
            <span>Style</span>
          </button>
        </nav>

        {/* Form Body + Sticky Footer */}
        <form onSubmit={handleSubmit} className={styles.popoverFormShell} noValidate>
          <div className={styles.popoverScrollBody}>
            {formError && (
              <div className={styles.inlineErrorBanner} role="alert">
                <FiAlertCircle aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            {/* TAB 1: DETAILS */}
            {activeSection === 'event' && (
              <div className={styles.sectionStack}>
                <div className={styles.fieldGroup}>
                  <label htmlFor="quick-event-title" className={styles.sectionSmallLabel}>
                    Event Title <span className={styles.requiredMark}>*</span>
                  </label>
                  <input
                    id="quick-event-title"
                    ref={titleInputRef}
                    type="text"
                    className={`${styles.textInput} ${formError && !eventName.trim() ? styles.inputError : ''}`}
                    placeholder="e.g. Midterm Exams, SSG Assembly, Intramurals..."
                    value={eventName}
                    onChange={(e) => {
                      setEventName(e.target.value);
                      if (formError) setFormError('');
                    }}
                    required
                  />
                </div>

                {/* Category Selector */}
                <div className={styles.fieldGroup}>
                  <span className={styles.sectionSmallLabel}>Category</span>
                  <div className={styles.categoryRow} role="radiogroup" aria-label="Event category">
                    {EVENT_CATEGORIES.map((cat) => {
                      const isActive = eventType === cat.value;
                      return (
                        <button
                          key={cat.value}
                          type="button"
                          role="radio"
                          aria-checked={isActive}
                          onClick={() => setEventType(cat.value)}
                          className={`${styles.categoryPill} ${
                            isActive ? styles.categoryPillActive : ''
                          }`}
                        >
                          <span
                            className={styles.categoryDot}
                            style={{ backgroundColor: cat.color }}
                            aria-hidden="true"
                          />
                          <span>{cat.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quick Templates */}
                <div className={styles.fieldGroup}>
                  <span className={styles.sectionSmallLabel}>Quick Templates</span>
                  <div className={styles.presetChipsRow}>
                    {EVENT_PRESETS.map((preset) => {
                      const isSelected =
                        eventName === preset.label && eventType === preset.eventType;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`${styles.presetChip} ${
                            isSelected ? styles.presetChipActive : ''
                          }`}
                          onClick={() => handleApplyPreset(preset)}
                          title={preset.desc}
                        >
                          <span
                            className={styles.presetDot}
                            style={{ backgroundColor: preset.color }}
                            aria-hidden="true"
                          />
                          <span>{preset.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Managing Organization */}
                <div className={styles.fieldGroup}>
                  <span className={styles.sectionSmallLabel}>Managing Organization</span>
                  <div className={styles.orgChipsRow}>
                    {availableOrgs.map((org) => {
                      const isActive = managingOrgTag === org.tag;
                      return (
                        <button
                          key={org.id}
                          type="button"
                          className={`${styles.orgChip} ${isActive ? styles.orgChipActive : ''}`}
                          onClick={() => handleApplyOrg(org)}
                          title={org.name}
                        >
                          {isSafeImageSrc(org.logo) ? (
                            <img
                              src={org.logo}
                              alt=""
                              className={styles.orgChipLogo}
                            />
                          ) : (
                            <span className={styles.orgChipInitial} aria-hidden="true">
                              {(org.tag || 'O').slice(0, 2)}
                            </span>
                          )}
                          <span>{org.tag}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: SCHEDULE & VENUE */}
            {activeSection === 'schedule' && (
              <div className={styles.sectionStack}>
                {/* Date Field */}
                <div className={styles.fieldGroup}>
                  <label htmlFor="quick-event-date" className={styles.sectionSmallLabel}>
                    {isMultiDaySelection ? 'Selected Date Range' : 'Activity Date'}
                  </label>
                  {isMultiDaySelection ? (
                    <div className={styles.multiDateBox}>
                      <div className={styles.multiDateSummary}>
                        <FiCalendar className={styles.fieldIcon} aria-hidden="true" />
                        <span>{formattedDateSummary()}</span>
                      </div>
                      <div className={styles.multiDatePills}>
                        {initialSortedDates.slice(0, 6).map((d) => (
                          <span key={d} className={styles.dateChipToken}>
                            {formatShortMonthDay(d)}
                          </span>
                        ))}
                        {initialSortedDates.length > 6 && (
                          <span className={styles.dateChipToken}>
                            +{initialSortedDates.length - 6} more
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.inlineField}>
                      <FiCalendar className={styles.fieldIcon} aria-hidden="true" />
                      <input
                        id="quick-event-date"
                        type="date"
                        value={singleDate}
                        onChange={(e) => setSingleDate(e.target.value)}
                        className={styles.nativeInput}
                        required
                      />
                    </div>
                  )}
                </div>

                {/* Time Range */}
                <div className={styles.timeGrid}>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="quick-start-time" className={styles.sectionSmallLabel}>
                      Start Time
                    </label>
                    <div className={styles.inlineField}>
                      <FiClock className={styles.fieldIcon} aria-hidden="true" />
                      <input
                        id="quick-start-time"
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className={styles.nativeInput}
                      />
                    </div>
                  </div>

                  <div className={styles.fieldGroup}>
                    <label htmlFor="quick-end-time" className={styles.sectionSmallLabel}>
                      End Time
                    </label>
                    <div className={styles.inlineField}>
                      <FiClock className={styles.fieldIcon} aria-hidden="true" />
                      <input
                        id="quick-end-time"
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className={styles.nativeInput}
                      />
                    </div>
                  </div>
                </div>

                {timeRangeWarning && (
                  <p className={styles.fieldHintWarning}>{timeRangeWarning}</p>
                )}

                {/* Venue / Location */}
                <div className={styles.fieldGroup}>
                  <label htmlFor="quick-event-venue" className={styles.sectionSmallLabel}>
                    Venue / Location
                  </label>
                  <div className={styles.inlineField}>
                    <FiMapPin className={styles.fieldIcon} aria-hidden="true" />
                    <input
                      id="quick-event-venue"
                      type="text"
                      placeholder="Room, Campus Gymnasium, Auditorium..."
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className={styles.nativeInput}
                    />
                  </div>
                </div>

                {/* Attendance Verification Switch Row */}
                <label className={styles.toggleCardRow}>
                  <div className={styles.toggleCardCopy}>
                    <span className={styles.toggleCardTitle}>
                      <FiCheckCircle className={styles.toggleCardIcon} aria-hidden="true" />
                      Mandatory Attendance
                    </span>
                    <span className={styles.toggleCardDesc}>
                      Marks this activity for student attendance verification
                    </span>
                  </div>
                  <span className={styles.switchControl}>
                    <input
                      type="checkbox"
                      checked={requiresAttendance}
                      onChange={(e) => setRequiresAttendance(e.target.checked)}
                      className={styles.switchNative}
                    />
                    <span className={styles.switchTrack} aria-hidden="true">
                      <span className={styles.switchThumb} />
                    </span>
                  </span>
                </label>
              </div>
            )}

            {/* TAB 3: STYLE & BADGE */}
            {activeSection === 'branding' && (
              <div className={styles.sectionStack}>
                {/* Live Calendar Cell Preview */}
                <div className={styles.previewBand}>
                  <span className={styles.sectionSmallLabel}>Calendar Cell Preview</span>
                  <div
                    className={styles.previewTagChip}
                    style={{
                      borderColor: `${selectedColor}77`,
                      backgroundColor: `${selectedColor}1A`,
                    }}
                  >
                    <span
                      className={styles.previewTagDot}
                      style={{ backgroundColor: selectedColor }}
                      aria-hidden="true"
                    />
                    {badgeHasImage ? (
                      <img src={managingOrgLogo} alt="" className={styles.previewTagLogo} />
                    ) : (
                      <span className={styles.previewTagEmoji} aria-hidden="true">
                        {selectedEmoji}
                      </span>
                    )}
                    <span className={styles.previewTagText}>
                      {eventName.trim() || 'Untitled Campus Event'}
                    </span>
                    <span className={styles.previewOrgPill}>{managingOrgTag}</span>
                  </div>
                </div>

                {/* Color Swatches */}
                <div className={styles.fieldGroup}>
                  <span className={styles.sectionSmallLabel}>Accent Color</span>
                  <div className={styles.swatchesRow} role="radiogroup" aria-label="Event color">
                    {COLOR_SWATCHES.map((color) => {
                      const isSelected = selectedColor.toLowerCase() === color.toLowerCase();
                      const checkColor = LIGHT_SWATCHES.has(color.toUpperCase())
                        ? '#1a0408'
                        : '#fff6e0';
                      return (
                        <button
                          key={color}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          aria-label={`Select color ${color}`}
                          className={`${styles.colorDot} ${
                            isSelected ? styles.colorDotSelected : ''
                          }`}
                          style={{ backgroundColor: color }}
                          onClick={() => setSelectedColor(color)}
                        >
                          {isSelected && (
                            <FiCheck
                              style={{ color: checkColor, fontSize: '0.8rem', strokeWidth: 3 }}
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Display Badge Switcher */}
                <div className={styles.fieldGroup}>
                  <span className={styles.sectionSmallLabel}>Display Badge</span>
                  <div className={styles.iconTypeToggleGroup}>
                    <button
                      type="button"
                      className={`${styles.iconTypeToggleBtn} ${
                        iconType === 'emoji' ? styles.iconTypeToggleBtnActive : ''
                      }`}
                      onClick={() => setIconType('emoji')}
                    >
                      <FiSmile aria-hidden="true" />
                      <span>Emoji Badge</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.iconTypeToggleBtn} ${
                        iconType === 'logo' ? styles.iconTypeToggleBtnActive : ''
                      }`}
                      onClick={() => {
                        setIconType('logo');
                        if (!managingOrgLogo) {
                          const matched =
                            availableOrgs.find((o) => o.tag === managingOrgTag) ||
                            availableOrgs[0];
                          if (isSafeImageSrc(matched?.logo)) {
                            setManagingOrgLogo(matched.logo);
                          }
                        }
                      }}
                    >
                      <FiAward aria-hidden="true" />
                      <span>Organization Logo</span>
                    </button>
                  </div>

                  {iconType === 'emoji' ? (
                    <div className={styles.emojisRow}>
                      {QUICK_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          aria-label={`Use ${emoji} badge`}
                          aria-pressed={selectedEmoji === emoji}
                          className={`${styles.emojiBtn} ${
                            selectedEmoji === emoji ? styles.emojiBtnSelected : ''
                          }`}
                          onClick={() => setSelectedEmoji(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.orgLogoPickerGrid}>
                      {availableOrgs.map((org) => {
                        const hasLogo = isSafeImageSrc(org.logo);
                        const isSelected = hasLogo && managingOrgLogo === org.logo;
                        return (
                          <button
                            key={org.id}
                            type="button"
                            disabled={!hasLogo}
                            className={`${styles.orgLogoPickItem} ${
                              isSelected ? styles.orgLogoPickItemActive : ''
                            }`}
                            onClick={() => {
                              if (hasLogo) {
                                setManagingOrgLogo(org.logo);
                                setManagingOrgTag(org.tag);
                                setSelectedColor(org.color || selectedColor);
                              }
                            }}
                            title={
                              hasLogo
                                ? `${org.name} (${org.tag})`
                                : `${org.name} has no uploaded logo yet`
                            }
                          >
                            {hasLogo ? (
                              <img
                                src={org.logo}
                                alt=""
                                className={styles.orgLogoThumb}
                              />
                            ) : (
                              <span className={styles.orgLogoFallbackInitial}>
                                {(org.name || 'O').charAt(0).toUpperCase()}
                              </span>
                            )}
                            <span>{org.tag}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sticky Action Footer */}
          <footer className={styles.popoverFooter}>
            {(isEditing && (onDelete || onOpenAdvanced)) && (
              <div className={styles.footerUtilities}>
                {isEditing && onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(existingEvent)}
                    className={styles.deleteBtnRow}
                    title="Delete event"
                  >
                    <FiTrash2 aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                )}

                {isEditing && onOpenAdvanced && (
                  <button
                    type="button"
                    onClick={() => onOpenAdvanced(existingEvent)}
                    className={styles.advancedBtn}
                  >
                    <span>Full Editor</span>
                    <FiChevronRight aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            <div className={styles.footerActions}>
              <button
                type="button"
                onClick={onClose}
                className={styles.cancelBtn}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !eventName.trim()}
                className={styles.saveBtn}
              >
                <FiCheck aria-hidden="true" />
                <span>
                  {isSubmitting
                    ? 'Saving...'
                    : isEditing
                      ? 'Update Event'
                      : 'Add Event'}
                </span>
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return popoverMarkup;
  }

  return createPortal(popoverMarkup, document.body);
}
