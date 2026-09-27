import React, { useState, useEffect } from 'react';
import { db } from '../firebase/firebaseConfig';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, Timestamp } from 'firebase/firestore';
import styles from './Announcement.module.css';

function Announcement() {
  // ========================================
  // STATE MANAGEMENT
  // ========================================
  
  // Announcements
  const [announcements, setAnnouncements] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    description: '',
    venue: '',
    eventDate: '',
    eventTime: '',
    category: 'General',
    imageBase64: '',
  });
//Image previewer 
const [imagePreview, setImagePreview] = useState(null);
const [selectedImage, setSelectedImage] = useState(null);






// ========================================
// 📸 1. Image Compression Utility
// ========================================
/**
 * Compresses an image file using the Canvas API to generate a smaller 
 * Base64 string (JPEG, quality 0.8, max width 1000px) below the 1MB limit.
 * @param {File} file - The original image file selected by the user.
 * @returns {Promise<string>} A promise that resolves with the compressed Base64 Data URL.
 */
const CompressImage = (file) => {
    const maxWidth = 1000;
    const quality = 0.8;
    
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Calculate new dimensions, capping width at maxWidth
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Generate new Base64 string as JPEG with compression quality
                const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                
                // Optional: Check size again and warn, though the compression should help
                if (compressedBase64.length > 1024 * 1024) {
                    console.warn("Image still large. Consider lower quality or smaller dimensions.");
                }

                resolve(compressedBase64);
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

const handleImageChange = async (e) => {
    const file = e.target.files[0];
    
    if (!file) {
      setAnnouncementForm(prev => ({ ...prev, imageBase64:""}))
      setImagePreview(null)
      return;
    }

    if(!file.type.startsWith('image/')){
        alert('Please select an image file.');
        return;
    }

    try {

        const compressedBase64 = await CompressImage(file);

        setAnnouncementForm((prev) => ({
          ...prev,
          imageBase64: compressedBase64
        }));
        setImagePreview(compressedBase64);
    } catch (error){
        console.error("Error processing image:", error);
        alert("Failed to process image. Please try another file.");
        setMember(prev => ({ ...prev, image64: ""}));
        setImagePreview(null);
    }
};

  // Calendar Events
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [eventForm, setEventForm] = useState({
    eventName: '',
    eventDate: '',
    eventType: 'Class',
    requiresAttendance: false,
    description: '',
  });

  // UI States
  const [activeTab, setActiveTab] = useState('announcements'); // 'announcements' or 'calendar'
  const [loading, setLoading] = useState(false);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState(null);
  const [editingEventId, setEditingEventId] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // ========================================
  // FETCH ANNOUNCEMENTS FROM FIREBASE
  // ========================================
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'announcements'), (snapshot) => {
      const announcementsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      
      // Sort by event date (newest first)
      announcementsData.sort((a, b) => {
        const dateA = new Date(a.eventDate);
        const dateB = new Date(b.eventDate);
        return dateB - dateA;
      });

      setAnnouncements(announcementsData);
    });

    return () => unsubscribe();
  }, []);

  // ========================================
  // FETCH CALENDAR EVENTS FROM FIREBASE
  // ========================================
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'calendarEvents'), (snapshot) => {
      const eventsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      
      eventsData.sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
      setCalendarEvents(eventsData);
    });

    return () => unsubscribe();
  }, []);

  // ========================================
  // ANNOUNCEMENT HANDLERS
  // ========================================
  const handleAnnouncementChange = (e) => {
    const { name, value } = e.target;
    setAnnouncementForm(prev => ({ ...prev, [name]: value }));
  };

  const handleAddAnnouncement = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
       await addDoc(collection(db, 'announcements'), {
            title: announcementForm.title,
            description: announcementForm.description,
            venue: announcementForm.venue,
            eventDate: announcementForm.eventDate,
            eventTime: announcementForm.eventTime,
            category: announcementForm.category,
            imageBase64: announcementForm.imageBase64,
            createdAt: new Date().toISOString(),
        });

        alert('✅ Announcement added successfully!');
        setAnnouncementForm({
            title: '',
            description: '',
            venue: '',
            eventDate: '',
            eventTime: '',
            category: 'General',     // ADD THIS
            imageBase64: '',       // ADD THIS
        });
        setImagePreview(null); 
        setSelectedImage(null); // ADD THIS
        setLoading(false);
    } catch (error) {
        console.error('Error adding announcement:', error);
        alert('Error adding announcement');
        setLoading(false);
    }
};
  const handleEditAnnouncement = (announcement) => {
    setEditingAnnouncementId(announcement.id);
    setAnnouncementForm({
      title: announcement.title,
      description: announcement.description,
      venue: announcement.venue,
      eventDate: announcement.eventDate,
      eventTime: announcement.eventTime,
      category: announcement.category,                              // ADD THIS
      imageBase64: announcement.imageBase64 || '',  
    });
     setImagePreview(announcement.imageBase64);
     setSelectedImage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

 const handleUpdateAnnouncement = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
        const announcementRef = doc(db, 'announcements', editingAnnouncementId);
        
        // `Create a` copy WITHOUT the imageFile object
        const dataToUpdate = {
            title: announcementForm.title,
            description: announcementForm.description,
            venue: announcementForm.venue,
            eventDate: announcementForm.eventDate,
            eventTime: announcementForm.eventTime,
            category: announcementForm.category,
            imageBase64: announcementForm.imageBase64,
            updatedAt: new Date().toISOString(),
        };

        await updateDoc(announcementRef, dataToUpdate);

        alert('✅ Announcement updated successfully!');
        setAnnouncementForm({
            title: '',
            description: '',
            venue: '',
            eventDate: '',
            eventTime: '',
            category: 'General',
            imageBase64: '',
        });
        setEditingAnnouncementId(null);
        setImagePreview(null);
        setSelectedImage(null);
        setLoading(false);
    } catch (error) {
        console.error('Error updating announcement:', error);
        alert('Error updating announcement');
        setLoading(false);
    }
};

  const handleDeleteAnnouncement = async (id, title) => {
    if (!window.
      confirm(`Delete announcement: "${title}"?`)) return;

    try {
      await deleteDoc(doc(db, 'announcements', id));
      alert('🗑️ Announcement deleted!');
    } catch (error) {
      console.error('Error deleting announcement:', error);
      alert('Error deleting announcement');
    }
  };

  // ========================================
  // CALENDAR EVENT HANDLERS
  // ========================================
  const handleEventChange = (e) => {
    const { name, value, type, checked } = e.target;
    setEventForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleAddEvent = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await addDoc(collection(db, 'calendarEvents'), {
        ...eventForm,
        createdAt: new Date().toISOString(),
      });

      alert('✅ Event added to calendar!');
      setEventForm({
        eventName: '',
        eventDate: '',
        eventType: 'Class',
        requiresAttendance: false,
        description: '',
      });
      setLoading(false);
    } catch (error) {
      console.error('Error adding event:', error);
      alert('Error adding event');
      setLoading(false);
    }
  };

  const handleEditEvent = (event) => {
    setEditingEventId(event.id);
    setEventForm({
      eventName: event.eventName,
      eventDate: event.eventDate,
      eventType: event.eventType,
      requiresAttendance: event.requiresAttendance,
      description: event.description,
    });
  };

  const handleUpdateEvent = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const eventRef = doc(db, 'calendarEvents', editingEventId);
      await updateDoc(eventRef, {
        ...eventForm,
        updatedAt: new Date().toISOString(),
      });

      alert('✅ Event updated!');
      setEventForm({
        eventName: '',
        eventDate: '',
        eventType: 'Class',
        requiresAttendance: false,
        description: '',
        imageBase64:'',
      });
      setEditingEventId(null);
      setLoading(false);
    } catch (error) {
      console.error('Error updating event:', error);
      alert('Error updating event');
      setLoading(false);
    }
  };

  const handleDeleteEvent = async (id, name) => {
    if (!window.confirm(`Delete event: "${name}"?`)) return;

    try {
      await deleteDoc(doc(db, 'calendarEvents', id));
      alert('🗑️ Event deleted!');
    } catch (error) {
      console.error('Error deleting event:', error);
      alert('Error deleting event');
    }
  };

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
    return calendarEvents.filter(event => event.eventDate === dateStr);
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const getCategoryColor = (category) => {
    const colors = {
      'General': '#fe5c03',
      'Academic': '#2196f3',
      'Sports': '#4caf50',
      'Cultural': '#9c27b0',
      'Meeting': '#ff9800',
    };
    return colors[category] || '#fe5c03';
  };

  const getEventTypeColor = (type) => {
    const colors = {
      'Class': '#2196f3',
      'Exam': '#f44336',
      'Event': '#9c27b0',
      'Holiday': '#4caf50',
      'Meeting': '#ff9800',
    };
    return colors[type] || '#2196f3';
  };



  

  // ========================================
  // RENDER CALENDAR
  // ========================================
  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(selectedMonth, selectedYear);
    const firstDay = getFirstDayOfMonth(selectedMonth, selectedYear);
    const days = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className={styles.calendarDayEmpty}></div>);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const events = getEventsForDate(day);
      const isToday = 
        day === new Date().getDate() && 
        selectedMonth === new Date().getMonth() && 
        selectedYear === new Date().getFullYear();

      days.push(
        <div 
          key={day} 
          className={`${styles.calendarDay} ${isToday ? styles.calendarDayToday : ''}`}
        >
          <div className={styles.calendarDayNumber}>{day}</div>
          {events.length > 0 && (
            <div className={styles.calendarDayEvents}>
              {events.slice(0, 2).map((event, idx) => (
                <div 
                  key={idx}
                  className={styles.calendarEventDot}
                  style={{ backgroundColor: getEventTypeColor(event.eventType) }}
                  title={event.eventName}
                >
                  {event.eventName.substring(0, 10)}...
                </div>
              ))}
              {events.length > 2 && (
                <div className={styles.calendarMoreEvents}>+{events.length - 2} more</div>
              )}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className={styles.calendarWrapper}>
        <div className={styles.calendarHeader}>
          <button 
            onClick={() => {
              if (selectedMonth === 0) {
                setSelectedMonth(11);
                setSelectedYear(selectedYear - 1);
              } else {
                setSelectedMonth(selectedMonth - 1);
              }
            }}
            className={styles.calendarNavButton}
          >
            ◀
          </button>
          <h3 className={styles.calendarTitle}>
            {monthNames[selectedMonth]} {selectedYear}
          </h3>
          <button 
            onClick={() => {
              if (selectedMonth === 11) {
                setSelectedMonth(0);
                setSelectedYear(selectedYear + 1);
              } else {
                setSelectedMonth(selectedMonth + 1);
              }
            }}
            className={styles.calendarNavButton}
          >
            ▶
          </button>
        </div>
        
        <div className={styles.calendarDayNames}>
          {dayNames.map(name => (
            <div key={name} className={styles.calendarDayName}>{name}</div>
          ))}
        </div>
        
        <div className={styles.calendarGrid}>
          {days}
        </div>
      </div>
    );
  };

  // ========================================
  // RENDER
  // ========================================
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.mainTitle}>Announcements & Events</h2>
        <p className={styles.headerSubtitle}>Manage announcements and calendar events</p>
      </div>

      {/* TAB NAVIGATION */}
      <div className={styles.tabContainer}>
        <button
          onClick={() => setActiveTab('announcements')}
          className={`${styles.tab} ${activeTab === 'announcements' ? styles.tabActive : ''}`}
        >
          📢 Announcements
          <span className={styles.tabBadge}>{announcements.length}</span>
        </button>
        <button
          onClick={() => setActiveTab('calendar')}
          className={`${styles.tab} ${activeTab === 'calendar' ? styles.tabActive : ''}`}
        >
          📅 Event Calendar
          <span className={styles.tabBadge}>{calendarEvents.length}</span>
        </button>
      </div>

      {/* ANNOUNCEMENTS TAB */}
      {activeTab === 'announcements' && (
        <div>
          {/* ADD/EDIT ANNOUNCEMENT FORM */}
          <div className={styles.formWrapper}>
            <h3 className={styles.sectionTitle}>
              {editingAnnouncementId ? '✏️ Edit Announcement' : '➕ Create New Announcement'}
            </h3>

            <form onSubmit={editingAnnouncementId ? handleUpdateAnnouncement : handleAddAnnouncement} className={styles.form}>
              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Announcement Title <span className={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  name="title"
                  value={announcementForm.title}
                  onChange={handleAnnouncementChange}
                  placeholder="e.g., Student Council Meeting"
                  className={styles.input}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Description <span className={styles.required}>*</span>
                </label>
                <textarea
                  name="description"
                  value={announcementForm.description}
                  onChange={handleAnnouncementChange}
                  placeholder="Detailed description of the announcement..."
                  rows="3"
                  className={styles.textarea}
                  required
                />
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>
                    Venue <span className={styles.required}>*</span>
                  </label>
                  <input
                    type="text"
                    name="venue"
                    value={announcementForm.venue}
                    onChange={handleAnnouncementChange}
                    placeholder="e.g., Main Auditorium"
                    className={styles.input}
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>
                    Category <span className={styles.required}>*</span>
                  </label>
                  <select
                    name="category"
                    value={announcementForm.category}
                    onChange={handleAnnouncementChange}
                    className={styles.select}
                  >
                    <option value="General">General</option>
                    <option value="Academic">Academic</option>
                    <option value="Sports">Sports</option>
                    <option value="Cultural">Cultural</option>
                    <option value="Meeting">Meeting</option>
                  </select>
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>
                    Event Date <span className={styles.required}>*</span>
                  </label>
                  <input
                    type="date"
                    name="eventDate"
                    value={announcementForm.eventDate}
                    onChange={handleAnnouncementChange}
                    className={styles.input}
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>
                    Event Time <span className={styles.required}>*</span>
                  </label>
                  <input
                    type="time"
                    name="eventTime"
                    value={announcementForm.eventTime}
                    onChange={handleAnnouncementChange}
                    className={styles.input}
                    required
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Announcement Image</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className={styles.fileInput}
                />
                <p className={styles.helperText}>
                  JPG or PNG, max 1MB (auto-compressed)
                </p>
                
                {imagePreview && (
                  <div className={styles.imagePreviewContainer}>
                    <img src={imagePreview} alt="Preview" className={styles.imagePreview} />
                    <button
                      type="button"
                      onClick={() => {
                        setImagePreview(null);
                        setAnnouncementForm(prev => ({ ...prev, imageBase64: '' }));
                      }}
                      className={styles.removeImageBtn}
                    >
                      ✕ Remove
                    </button>
                  </div>
                )}
              </div>

              <div className={styles.buttonGroup}>
                <button
                  type="submit"
                  disabled={loading}
                  className={styles.submitButton}
                >
                  {loading 
                    ? '⏳ Processing...' 
                    : editingAnnouncementId 
                      ? '💾 Update Announcement' 
                      : '➕ Add Announcement'}
                </button>

                {editingAnnouncementId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingAnnouncementId(null);
                      setAnnouncementForm({
                        title: '',
                        description: '',
                        venue: '',
                        eventDate: '',
                        eventTime: '',
                        category: 'General',
                        imageBase64: '',
                      });
                      setImagePreview(null);
                      setSelectedImage(null);
                    }}
                    className={styles.cancelButton}
                  >
                    ❌ Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* ANNOUNCEMENTS LIST */}
          <div className={styles.announcementsWrapper}>
            <h3 className={styles.sectionTitle}>All Announcements</h3>
            
            {announcements.length === 0 ? (
              <div className={styles.emptyState}>
                <p className={styles.emptyText}>No announcements yet. Create your first one above!</p>
              </div>
            ) : (
              <div className={styles.announcementsList}>
                {announcements.map((announcement) => (
                  <div key={announcement.id} className={styles.announcementCard}>
                    <div 
                      className={styles.announcementHeader}
                      onClick={() => setExpandedId(expandedId === announcement.id ? null : announcement.id)}
                    >
                      <div className={styles.announcementHeaderLeft}>
                        <h4 className={styles.announcementTitle}>{announcement.title}</h4>
                        <div className={styles.announcementMeta}>
                          <span 
                            className={styles.categoryBadge}
                            style={{ backgroundColor: getCategoryColor(announcement.category) }}
                          >
                            {announcement.category}
                          </span>
                          <span className={styles.announcementDate}>
                            📅 {formatDate(announcement.eventDate)} at {announcement.eventTime}
                          </span>
                        </div>
                      </div>
                      <div className={`${styles.expandIcon} ${expandedId === announcement.id ? styles.expandIconExpanded : ''}`}>
                        ▼
                      </div>
                    </div>

                    {announcement.imageBase64 && (
                      <div className={styles.announcementImageWrapper}>
                        <img 
                          src={announcement.imageBase64}
                          alt={announcement.title}
                          className={styles.announcementImage}
                          onError={(e) => {
                            e.target.style.display = 'none';
                          }}
                        />
                      </div>
                    )}

                    {expandedId === announcement.id && (
                      <div className={styles.announcementBody}>
                        <div className={styles.announcementDetail}>
                          <strong className={styles.detailLabel}>Description:</strong>
                          <p className={styles.detailValue}>{announcement.description}</p>
                        </div>

                        <div className={styles.announcementDetail}>
                          <strong className={styles.detailLabel}>Venue:</strong>
                          <p className={styles.detailValue}>📍 {announcement.venue}</p>
                        </div>

                        <div className={styles.announcementActions}>
                          <button
                            onClick={() => handleEditAnnouncement(announcement)}
                            className={styles.editButton}
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => handleDeleteAnnouncement(announcement.id, announcement.title)}
                            className={styles.deleteButton}
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CALENDAR TAB */}
      {activeTab === 'calendar' && (
        <div>
          {/* ADD/EDIT EVENT FORM */}
          <div className={styles.formWrapper}>
            <h3 className={styles.sectionTitle}>
              {editingEventId ? '✏️ Edit Calendar Event' : '➕ Add Calendar Event'}
            </h3>

            <form onSubmit={editingEventId ? handleUpdateEvent : handleAddEvent} className={styles.form}>
              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Event Name <span className={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  name="eventName"
                  value={eventForm.eventName}
                  onChange={handleEventChange}
                  placeholder="e.g., Midterm Exam - Math"
                  className={styles.input}
                  required
                />
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>
                    Event Date <span className={styles.required}>*</span>
                  </label>
                  <input
                    type="date"
                    name="eventDate"
                    value={eventForm.eventDate}
                    onChange={handleEventChange}
                    className={styles.input}
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>
                    Event Type <span className={styles.required}>*</span>
                  </label>
                  <select
                    name="eventType"
                    value={eventForm.eventType}
                    onChange={handleEventChange}
                    className={styles.select}
                  >
                    <option value="Class">Class</option>
                    <option value="Exam">Exam</option>
                    <option value="Event">Event</option>
                    <option value="Holiday">Holiday</option>
                    <option value="Meeting">Meeting</option>
                  </select>
                </div>
              </div>

              <div className={styles.checkboxGroup}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    name="requiresAttendance"
                    checked={eventForm.requiresAttendance}
                    onChange={handleEventChange}
                    className={styles.checkbox}
                  />
                  <span>Requires Attendance</span>
                </label>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Description (Optional)</label>
                <textarea
                  name="description"
                  value={eventForm.description}
                  onChange={handleEventChange}
                  placeholder="Additional details about this event..."
                  rows="2"
                  className={styles.textarea}
                />
              </div>

              <div className={styles.buttonGroup}>
                <button
                  type="submit"
                  disabled={loading}
                  className={styles.submitButton}
                >
                  {loading 
                    ? '⏳ Processing...' 
                    : editingEventId 
                      ? '💾 Update Event' 
                      : '➕ Add Event'}
                </button>

                {editingEventId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingEventId(null);
                      setEventForm({
                        eventName: '',
                        eventDate: '',
                        eventType: 'Class',
                        requiresAttendance: false,
                        description: '',
                      });
                    }}
                    className={styles.cancelButton}
                  >
                    ❌ Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* CALENDAR VIEW */}
          <div className={styles.calendarSection}>
            {renderCalendar()}
          </div>

          {/* EVENTS LIST */}
          <div className={styles.eventsListWrapper}>
            <h3 className={styles.sectionTitle}>Upcoming Events</h3>
            
            {calendarEvents.length === 0 ? (
              <div className={styles.emptyState}>
                <p className={styles.emptyText}>No events scheduled yet.</p>
              </div>
            ) : (
              <div className={styles.eventsList}>
                {calendarEvents.map((event) => (
                  <div key={event.id} className={styles.eventCard}>
                    <div className={styles.eventCardHeader}>
                      <div>
                        <h4 className={styles.eventCardTitle}>{event.eventName}</h4>
                        <p className={styles.eventCardDate}>
                          📅 {formatDate(event.eventDate)}
                        </p>
                      </div>
                      <div className={styles.eventBadges}>
                        <span 
                          className={styles.eventTypeBadge}
                          style={{ backgroundColor: getEventTypeColor(event.eventType) }}
                        >
                          {event.eventType}
                        </span>
                        {event.requiresAttendance && (
                          <span className={styles.attendanceBadge}>
                            ✓ Attendance Required
                          </span>
                        )}
                      </div>
                    </div>

                    {event.description && (
                      <p className={styles.eventCardDesc}>{event.description}</p>
                    )}

                    <div className={styles.eventCardActions}>
                      <button
                        onClick={() => handleEditEvent(event)}
                        className={styles.editButton}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDeleteEvent(event.id, event.eventName)}
                        className={styles.deleteButton}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export default Announcement;