// components/CalendarWidget/subcomponents/InlineQuickEventPopover.jsx
import React, { useState, useEffect } from 'react';
import { FiX, FiCheck, FiTrash2, FiClock, FiMapPin, FiCalendar, FiChevronRight } from 'react-icons/fi';
import { EVENT_PRESETS, ORG_PRESETS, COLOR_SWATCHES, QUICK_EMOJIS } from './EventPresets';
import styles from './InlineCalendarStyles.module.css';

export default function InlineQuickEventPopover({
  selectedDates = [],
  existingEvent = null,
  position = { x: 0, y: 0 },
  onClose,
  onSave,
  onDelete,
  onOpenAdvanced,
  canManage = false,
  orgList = [],
}) {
  const isEditing = Boolean(existingEvent);

  const [eventName, setEventName] = useState(existingEvent?.eventName || '');
  const [eventType, setEventType] = useState(existingEvent?.eventType || 'Class');
  const [selectedColor, setSelectedColor] = useState(existingEvent?.color || '#38BDF8');
  const [iconType, setIconType] = useState(existingEvent?.iconType || (existingEvent?.managingOrgLogo ? 'logo' : 'emoji'));
  const [selectedEmoji, setSelectedEmoji] = useState(existingEvent?.emoji || '📅');
  const [managingOrgTag, setManagingOrgTag] = useState(existingEvent?.managingOrgTag || 'SSG');
  const [managingOrgLogo, setManagingOrgLogo] = useState(existingEvent?.managingOrgLogo || '');
  const [startTime, setStartTime] = useState(existingEvent?.startTime || '08:00');
  const [endTime, setEndTime] = useState(existingEvent?.endTime || '17:00');
  const [location, setLocation] = useState(existingEvent?.location || '');
  const [requiresAttendance, setRequiresAttendance] = useState(Boolean(existingEvent?.requiresAttendance));
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Available Organizations (Dynamic from Member Management Firestore + SSG + fallbacks)
  const availableOrgs = React.useMemo(() => {
    const list = [];
    // Ensure SSG is always present
    const ssgEntry = orgList?.find(o => o.id === 'ssg');
    list.push({
      id: 'ssg',
      name: ssgEntry?.name || 'Supreme Student Government',
      tag: 'SSG',
      logo: ssgEntry?.logo64 || '/images/logossg.png',
      color: '#D94F1F',
    });

    if (orgList && orgList.length > 0) {
      orgList.forEach(o => {
        if (o.id !== 'ssg') {
          list.push({
            id: o.id,
            name: o.name,
            tag: o.tag || (o.name ? o.name.split(' ').map(w => w[0]).join('').substring(0, 4).toUpperCase() : 'ORG'),
            logo: o.logo64 || o.logo || null,
            color: o.color || '#D94F1F',
          });
        }
      });
    } else {
      ORG_PRESETS.forEach(p => {
        if (!list.some(item => item.tag === p.tag)) {
          list.push(p);
        }
      });
    }
    return list;
  }, [orgList]);

  // Apply preset values
  const handleApplyPreset = (preset) => {
    setEventType(preset.eventType);
    setSelectedColor(preset.color);
    if (preset.emoji) {
      setSelectedEmoji(preset.emoji);
      setIconType('emoji');
    }
    if (!eventName || EVENT_PRESETS.some(p => p.label === eventName)) {
      setEventName(preset.label);
    }
  };

  const handleApplyOrg = (org) => {
    setManagingOrgTag(org.tag);
    setSelectedColor(org.color || '#D94F1F');
    if (org.logo && typeof org.logo === 'string' && (org.logo.startsWith('data:') || org.logo.startsWith('http') || org.logo.startsWith('/'))) {
      setManagingOrgLogo(org.logo);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!eventName.trim() || isSubmitting) return;

    setIsSubmitting(true);
    const sortedDates = [...selectedDates].sort();
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];
    const isMultiDay = sortedDates.length > 1;

    const payload = {
      eventName: eventName.trim(),
      eventType,
      color: selectedColor,
      iconType, // 'emoji' or 'logo'
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
      dates: sortedDates.length > 0 ? sortedDates : (existingEvent?.dates || [existingEvent?.eventDate]),
      eventDate: startDate || existingEvent?.eventDate,
      updatedAt: new Date().toISOString(),
    };

    if (!isEditing) {
      payload.createdAt = new Date().toISOString();
    }

    try {
      await onSave(payload, existingEvent?.id);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formattedDateRange = () => {
    if (selectedDates.length === 0) return existingEvent?.eventDate || '';
    if (selectedDates.length === 1) return selectedDates[0];
    return `${selectedDates[0]} → ${selectedDates[selectedDates.length - 1]} (${selectedDates.length} days)`;
  };

  const [activeSection, setActiveSection] = useState('event'); // 'event' | 'schedule' | 'branding'

  return (
    <div 
      className={styles.popoverContainer} 
      style={{ top: `${position.y}px`, left: `${position.x}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className={styles.popoverHeader}>
        <div className={styles.popoverHeaderTitle}>
          <span className={styles.headerEmojiPreview}>
            {iconType === 'logo' && managingOrgLogo && (managingOrgLogo.startsWith('data:') || managingOrgLogo.startsWith('http') || managingOrgLogo.startsWith('/')) ? (
              <img src={managingOrgLogo} alt="Logo" style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              selectedEmoji
            )}
          </span>
          <div>
            <h4 className={styles.popoverTitle}>{isEditing ? 'Quick Edit Event' : 'Quick Add Event'}</h4>
            <span className={styles.popoverSubDate}>
              <FiCalendar /> {formattedDateRange()}
            </span>
          </div>
        </div>
        <button type="button" onClick={onClose} className={styles.iconCloseBtn} aria-label="Close">
          <FiX />
        </button>
      </div>

      {/* Clickable Section Navigation Tabs */}
      <div className={styles.popoverTabsNav}>
        <button
          type="button"
          onClick={() => setActiveSection('event')}
          className={`${styles.popoverTabBtn} ${activeSection === 'event' ? styles.popoverTabBtnActive : ''}`}
        >
          📝 General Info
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('schedule')}
          className={`${styles.popoverTabBtn} ${activeSection === 'schedule' ? styles.popoverTabBtnActive : ''}`}
        >
          ⏰ Time & Venue
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('branding')}
          className={`${styles.popoverTabBtn} ${activeSection === 'branding' ? styles.popoverTabBtnActive : ''}`}
        >
          🎨 Color & Logo
        </button>
      </div>

      {/* Form Content */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className={styles.popoverScrollBody}>
          {/* SECTION 1: GENERAL INFO & PRESETS */}
          {activeSection === 'event' && (
            <>
              <div className={styles.inputGroup}>
                <label className={styles.sectionSmallLabel}>EVENT TITLE *</label>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="e.g. Midterm Exams, Assembly, Sports Fest..."
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {/* Presets Chips */}
              <div className={styles.presetsSection}>
                <span className={styles.sectionSmallLabel}>CATEGORY PRESETS:</span>
                <div className={styles.presetChipsRow}>
                  {EVENT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={styles.presetChip}
                      onClick={() => handleApplyPreset(preset)}
                      title={preset.desc}
                    >
                      <span>{preset.emoji}</span>
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Managing Org Selection */}
              <div className={styles.presetsSection}>
                <span className={styles.sectionSmallLabel}>MANAGING ORGANIZATION:</span>
                <div className={styles.orgChipsRow}>
                  {availableOrgs.map((org) => (
                    <button
                      key={org.id}
                      type="button"
                      className={`${styles.orgChip} ${managingOrgTag === org.tag ? styles.orgChipActive : ''}`}
                      onClick={() => handleApplyOrg(org)}
                      style={managingOrgTag === org.tag ? { borderColor: org.color, backgroundColor: `${org.color}22` } : {}}
                      title={org.name}
                    >
                      {org.logo && typeof org.logo === 'string' && (org.logo.startsWith('data:') || org.logo.startsWith('http') || org.logo.startsWith('/')) ? (
                        <img src={org.logo} alt={org.tag} style={{ width: '16px', height: '16px', borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        <span>{org.logo || '🏛️'}</span>
                      )}
                      <span>{org.tag}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* SECTION 2: SCHEDULE & VENUE */}
          {activeSection === 'schedule' && (
            <div className={styles.tabSectionCard}>
              <span className={styles.sectionSmallLabel}>TIME & LOCATION:</span>
              <div className={styles.timeLocationRow}>
                <div className={styles.inlineField}>
                  <FiClock className={styles.fieldIcon} />
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className={styles.timeInput}
                  />
                </div>
                <div className={styles.inlineField}>
                  <FiClock className={styles.fieldIcon} />
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className={styles.timeInput}
                  />
                </div>
              </div>

              <div className={styles.inlineField}>
                <FiMapPin className={styles.fieldIcon} />
                <input
                  type="text"
                  placeholder="Room / Venue / Gymnasium..."
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className={styles.venueInput}
                />
              </div>

              {/* Attendance toggle */}
              <label className={styles.checkboxLabel} style={{ marginTop: '0.4rem' }}>
                <input
                  type="checkbox"
                  checked={requiresAttendance}
                  onChange={(e) => setRequiresAttendance(e.target.checked)}
                />
                <span>Requires Student Attendance Verification</span>
              </label>
            </div>
          )}

          {/* SECTION 3: COLOR & ICON/LOGO */}
          {activeSection === 'branding' && (
            <div className={styles.tabSectionCard}>
              {/* Color Swatches */}
              <div className={styles.swatchBlock}>
                <span className={styles.sectionSmallLabel}>THEME COLOR:</span>
                <div className={styles.swatchesRow}>
                  {COLOR_SWATCHES.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`${styles.colorDot} ${selectedColor === color ? styles.colorDotSelected : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setSelectedColor(color)}
                    />
                  ))}
                </div>
              </div>

              {/* Emoji or Org Logo Toggle */}
              <div className={styles.emojiBlock} style={{ marginTop: '0.5rem' }}>
                <span className={styles.sectionSmallLabel}>DISPLAY BADGE (EMOJI VS ORG LOGO):</span>
                <div className={styles.iconTypeToggleGroup}>
                  <button
                    type="button"
                    className={`${styles.iconTypeToggleBtn} ${iconType === 'emoji' ? styles.iconTypeToggleBtnActive : ''}`}
                    onClick={() => setIconType('emoji')}
                  >
                    <span>😊 Emoji</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconTypeToggleBtn} ${iconType === 'logo' ? styles.iconTypeToggleBtnActive : ''}`}
                    onClick={() => {
                      setIconType('logo');
                      if (!managingOrgLogo) {
                        const matched = availableOrgs.find(o => o.tag === managingOrgTag) || availableOrgs[0];
                        if (matched?.logo) setManagingOrgLogo(matched.logo);
                      }
                    }}
                  >
                    <span>🏛️ Organization Logo</span>
                  </button>
                </div>

                {iconType === 'emoji' ? (
                  <div className={styles.emojisRow}>
                    {QUICK_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className={`${styles.emojiBtn} ${selectedEmoji === emoji ? styles.emojiBtnSelected : ''}`}
                        onClick={() => setSelectedEmoji(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className={styles.orgLogoPickerGrid}>
                    {availableOrgs.map((org) => {
                      const hasLogo = org.logo && typeof org.logo === 'string' && (org.logo.startsWith('data:') || org.logo.startsWith('http') || org.logo.startsWith('/'));
                      const isSelected = managingOrgLogo === org.logo;
                      return (
                        <button
                          key={org.id}
                          type="button"
                          className={`${styles.orgLogoPickItem} ${isSelected ? styles.orgLogoPickItemActive : ''}`}
                          onClick={() => {
                            if (hasLogo) {
                              setManagingOrgLogo(org.logo);
                              setManagingOrgTag(org.tag);
                              setSelectedColor(org.color || selectedColor);
                            }
                          }}
                          title={`${org.name} (${org.tag})`}
                        >
                          {hasLogo ? (
                            <img src={org.logo} alt={org.tag} className={styles.orgLogoThumb} />
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

        {/* Actions Footer */}
        <div className={styles.popoverFooter}>
          {isEditing && (
            <button
              type="button"
              onClick={() => onDelete(existingEvent)}
              className={styles.deleteBtnRow}
              title="Delete Event"
            >
              <FiTrash2 /> Delete
            </button>
          )}

          {onOpenAdvanced && (
            <button
              type="button"
              onClick={() => onOpenAdvanced(existingEvent)}
              className={styles.advancedBtn}
            >
              Full Modal <FiChevronRight />
            </button>
          )}

          <div className={styles.footerRight}>
            <button type="button" onClick={onClose} className={styles.cancelBtn}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !eventName.trim()}
              className={styles.saveBtn}
              style={{ backgroundColor: selectedColor }}
            >
              {isSubmitting ? 'Saving...' : (isEditing ? 'Update Event' : 'Add Event')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
