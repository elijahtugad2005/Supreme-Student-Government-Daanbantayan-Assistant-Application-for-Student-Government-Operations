import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { db } from '../firebase/firebaseConfig';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, Timestamp } from 'firebase/firestore';
import styles from './Announcement.module.css';
import GlassModal from './GlassModal/GlassModal';
import {
  ANNOUNCEMENT_TYPES,
  ANNOUNCEMENT_TYPE_VALUES,
  TELEGRAM_CHANNELS,
  BOTH_CHANNELS,
  getTypeConfig,
  getChannelConfig,
  buildTelegramMessage,
  buildTelegramMessageParts,
  resolveChannels,
  normalizeTelegramRecords,
} from '../utils/announcementTypes';
import {
  sendAnnouncementToTelegram,
  deleteTelegramMessage,
  isTelegramReady,
} from '../services/telegramService';

const EMPTY_ANNOUNCEMENT_FORM = {
  title: '',
  description: '',
  venue: '',
  eventDate: '',
  eventTime: '',
  category: 'General',
  type: '',
  homepageVisible: false,
  imageBase64: '',
};

// Which fields the announcement form insists on before it will save
const ANNOUNCEMENT_REQUIRED_FIELDS = [
  { name: 'title', label: 'Announcement Title' },
  { name: 'description', label: 'Description' },
  { name: 'venue', label: 'Venue' },
  { name: 'eventDate', label: 'Event Date' },
  { name: 'eventTime', label: 'Event Time' },
];

function Announcement() {
  // ========================================
  // STATE MANAGEMENT
  // ========================================
  
  // Announcements
  const [announcements, setAnnouncements] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [announcementForm, setAnnouncementForm] = useState({ ...EMPTY_ANNOUNCEMENT_FORM });
//Image previewer 
const [imagePreview, setImagePreview] = useState(null);
const [selectedImage, setSelectedImage] = useState(null);

  // Telegram publishing
  const [telegramChannel, setTelegramChannel] = useState('');
  const [publishStatus, setPublishStatus] = useState('idle'); // idle | publishing | published | failed
  const [publishError, setPublishError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Inline form validation
  const [formErrors, setFormErrors] = useState({});

  // Glass dialog — replaces window.alert / window.confirm
  const [dialog, setDialog] = useState(null);
  const dialogResolver = useRef(null);

  const closeDialog = useCallback((result) => {
    setDialog(null);
    const resolve = dialogResolver.current;
    dialogResolver.current = null;
    resolve?.(result);
  }, []);

  /**
   * Show a glass dialog and resolve once it is dismissed.
   * If one is already open the new request is refused (resolves false) so a
   * second Enter press cannot orphan the first promise.
   */
  const ask = useCallback((options) => new Promise((resolve) => {
    if (dialogResolver.current) {
      resolve(false);
      return;
    }
    dialogResolver.current = resolve;
    setDialog({ showCancel: false, confirmLabel: 'OK', tone: 'info', ...options });
  }), []);

  /** Single-button notice (replaces alert). */
  const notify = useCallback((options) => ask(options), [ask]);

  // Drop a pending dialog if the component unmounts
  useEffect(() => () => { dialogResolver.current = null; }, []);

  // News Articles
  const [newsArticles, setNewsArticles] = useState([]);
  const [editingNewsId, setEditingNewsId] = useState(null);
  const [newsForm, setNewsForm] = useState({
    title: '',
    description: '',
    tag: 'event',
    images: [],
    expiryDate: '',
  });
  const [newsImagePreviews, setNewsImagePreviews] = useState([]);



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
        await notify({
          tone: 'error',
          title: 'Unsupported file',
          message: 'Please select an image file (JPG or PNG).',
        });
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
        await notify({
          tone: 'error',
          title: 'Could not process image',
          message: 'Please try another file.',
        });
        setAnnouncementForm(prev => ({ ...prev, imageBase64: ""}));
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
  const [activeTab, setActiveTab] = useState('announcements'); // 'announcements', 'calendar', or 'news'
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
  // FETCH NEWS ARTICLES FROM FIREBASE
  // ========================================
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'newsArticles'), (snapshot) => {
      const newsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      newsData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setNewsArticles(newsData);
    });
    return () => unsubscribe();
  }, []);

  // ========================================
  // ANNOUNCEMENT HANDLERS
  // ========================================
  const clearFieldError = (name) => {
    setFormErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  const handleAnnouncementChange = (e) => {
    const { name, value, checked } = e.target;
    if (name === 'homepageVisible') {
      setAnnouncementForm(prev => ({ ...prev, homepageVisible: checked }));
      return;
    }
    setAnnouncementForm(prev => ({ ...prev, [name]: value }));
    // Clear the error as soon as the field is filled in
    if (formErrors[name]) clearFieldError(name);
  };

  // Clearing a type or content invalidates a previous publish result
  const resetPublishState = () => {
    setPublishStatus('idle');
    setPublishError('');
    setConfirmOpen(false);
  };

  /** Check the announcement fields, including the homepage release option. */
  const validateAnnouncement = () => {
    const errors = {};
    ANNOUNCEMENT_REQUIRED_FIELDS.forEach(({ name, label }) => {
      const value = announcementForm[name];
      if (!value || !String(value).trim()) {
        errors[name] = `${label} is required.`;
      }
    });
    if (announcementForm.eventDate && Number.isNaN(new Date(announcementForm.eventDate).getTime())) {
      errors.eventDate = 'Enter a valid date.';
    }
    return errors;
  };

  // Pressing Enter in any field submits the form, so nothing is written until
  // the manager confirms — and the homepage release choice is spelled out.
  const confirmAnnouncementSave = async (isUpdate) => {
    const errors = validateAnnouncement();
    setFormErrors(errors);

    const missing = ANNOUNCEMENT_REQUIRED_FIELDS.filter((f) => errors[f.name]).map((f) => f.label);

    if (missing.length > 0) {
      await notify({
        tone: 'error',
        title: 'Announcement not saved',
        message: `Please complete these fields first:\n\n• ${missing.join('\n• ')}`,
      });
      return false;
    }

    const release = announcementForm.homepageVisible
      ? '✅ Will be shown in the Homepage announcement section.'
      : '🔒 Saved only. It will NOT appear on the Homepage.';

    return ask({
      tone: announcementForm.homepageVisible ? 'success' : 'info',
      title: isUpdate ? 'Update announcement?' : 'Add announcement?',
      message: [
        `Title: ${announcementForm.title}`,
        `Venue: ${announcementForm.venue}`,
        `When: ${announcementForm.eventDate} at ${announcementForm.eventTime}`,
        '',
        release,
      ].join('\n'),
      showCancel: true,
      confirmLabel: isUpdate ? 'Update' : 'Add',
      cancelLabel: 'Cancel',
    });
  };

  const handleAddAnnouncement = async (e) => {
    e.preventDefault();

    const confirmed = await confirmAnnouncementSave(false);
    if (!confirmed) return;

    setLoading(true);

    try {
       await addDoc(collection(db, 'announcements'), {
            title: announcementForm.title,
            description: announcementForm.description,
            venue: announcementForm.venue,
            eventDate: announcementForm.eventDate,
            eventTime: announcementForm.eventTime,
            category: announcementForm.category,
            type: announcementForm.type || '',
            homepageVisible: !!announcementForm.homepageVisible,
            imageBase64: announcementForm.imageBase64,
            createdAt: new Date().toISOString(),
        });

        await notify({
          tone: 'success',
          title: 'Announcement added',
          message: announcementForm.homepageVisible
            ? '"' + announcementForm.title + '" was added and is now live on the Homepage.'
            : '"' + announcementForm.title + '" was added. It is not shown on the Homepage yet.',
        });

        setAnnouncementForm({ ...EMPTY_ANNOUNCEMENT_FORM });
        setImagePreview(null); 
        setSelectedImage(null); // ADD THIS
        setFormErrors({});
        setTelegramChannel('');
        resetPublishState();
        setLoading(false);
    } catch (error) {
        console.error('Error adding announcement:', error);
        await notify({ tone: 'error', title: 'Could not add announcement', message: 'Please try again.' });
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
      type: announcement.type || '',
      homepageVisible: !!announcement.homepageVisible,
      imageBase64: announcement.imageBase64 || '',  
    });
     setImagePreview(announcement.imageBase64);
     setSelectedImage(null);
     setTelegramChannel(announcement.telegram?.channel || '');
     setPublishStatus(announcement.telegram?.status || 'idle');
     setPublishError('');
     setFormErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

 const handleUpdateAnnouncement = async (e) => {
    e.preventDefault();

    const confirmed = await confirmAnnouncementSave(true);
    if (!confirmed) return;

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
            type: announcementForm.type || '',
            homepageVisible: !!announcementForm.homepageVisible,
            imageBase64: announcementForm.imageBase64,
            updatedAt: new Date().toISOString(),
        };

        await updateDoc(announcementRef, dataToUpdate);

        await notify({
          tone: 'success',
          title: 'Announcement updated',
          message: announcementForm.homepageVisible
            ? '"' + announcementForm.title + '" was updated and is live on the Homepage.'
            : '"' + announcementForm.title + '" was updated. It is hidden from the Homepage.',
        });

        setAnnouncementForm({ ...EMPTY_ANNOUNCEMENT_FORM });
        setEditingAnnouncementId(null);
        setImagePreview(null);
        setSelectedImage(null);
        setFormErrors({});
        setTelegramChannel('');
        resetPublishState();
        setLoading(false);
    } catch (error) {
        console.error('Error updating announcement:', error);
        await notify({ tone: 'error', title: 'Could not update announcement', message: 'Please try again.' });
        setLoading(false);
    }
};

  // ========================================
  // TELEGRAM PUBLISHING
  // ========================================

  // Exactly what will be sent: type emoji + title, the bolded announcement
  // title, then the manager's own text. The preview renders the same parts
  // the message is built from, so the two cannot drift apart.
  const telegramParts = useMemo(
    () => buildTelegramMessageParts(
      announcementForm.type,
      announcementForm.description,
      announcementForm.title
    ),
    [announcementForm.type, announcementForm.description, announcementForm.title]
  );

  const telegramPreview = useMemo(
    () => buildTelegramMessage(
      announcementForm.type,
      announcementForm.description,
      announcementForm.title
    ),
    [announcementForm.type, announcementForm.description, announcementForm.title]
  );

  // Which channels a saved announcement actually reached
  const publishedChannelLabels = (announcement) => {
    const records = normalizeTelegramRecords(announcement.telegram);
    const sent = Object.keys(records).filter((c) => records[c]?.status && records[c].status !== 'failed');
    if (sent.length === 0) return 'Telegram';
    return sent.map((c) => getChannelConfig(c)?.label || c).join(' + ');
  };

  const renderTelegramText = (parts) => (    <>
      {parts.prefix && <>{parts.prefix}</>}
      {parts.title && (
        <>
          {parts.prefix && '\n\n'}
          <strong>{parts.title}</strong>
        </>
      )}
      {parts.body.trim() && (
        <>
          {(parts.prefix || parts.title) && '\n\n'}
          {parts.body}
        </>
      )}
    </>
  );

  const selectedTypeConfig = getTypeConfig(announcementForm.type);
  const selectedChannelConfig =
    telegramChannel === BOTH_CHANNELS
      ? { label: 'Faculty + All Mayors' }
      : getChannelConfig(telegramChannel);
  const targetChannels = resolveChannels(telegramChannel);

  const publishChecks = [
    { label: 'Announcement Type:', value: selectedTypeConfig?.label || 'Not selected', ok: !!selectedTypeConfig },
    {
      label: 'Publish To:',
      value: selectedChannelConfig?.label || 'Not selected',
      ok: !!selectedChannelConfig,
    },
  ];
  const canPublish = publishChecks.every((c) => c.ok)
    && announcementForm.description.trim().length > 0
    && publishStatus !== 'publishing';

  // The message body belongs to the website announcement and is never
  // modified — only the type prefix is generated on top of it.
  const announcementPayload = () => ({
    title: announcementForm.title,
    description: announcementForm.description,
    venue: announcementForm.venue,
    eventDate: announcementForm.eventDate,
    eventTime: announcementForm.eventTime,
    category: announcementForm.category,
    type: announcementForm.type || '',
    homepageVisible: !!announcementForm.homepageVisible,
    imageBase64: announcementForm.imageBase64,
  });

  // Make sure there is an announcement document to attach the Telegram
  // result to, without ever duplicating the announcement.
  const ensureAnnouncementDoc = async () => {
    if (editingAnnouncementId) {
      await updateDoc(doc(db, 'announcements', editingAnnouncementId), {
        ...announcementPayload(),
        updatedAt: new Date().toISOString(),
      });
      return editingAnnouncementId;
    }
    const created = await addDoc(collection(db, 'announcements'), {
      ...announcementPayload(),
      createdAt: new Date().toISOString(),
    });
    setEditingAnnouncementId(created.id);
    return created.id;
  };

  const handleConfirmPublish = async () => {
    if (!canPublish) return;

    setConfirmOpen(false);
    setPublishStatus('publishing');
    setPublishError('');

    const selection = telegramChannel;
    const channels = resolveChannels(selection);
    const message = telegramPreview;
    const imageBase64 = announcementForm.imageBase64 || '';
    let announcementId = null;

    try {
      announcementId = await ensureAnnouncementDoc();

      // Fan out to every selected channel, collecting each result separately
      const results = {};
      for (const channel of channels) {
        try {
          const result = await sendAnnouncementToTelegram({ channel, message, imageBase64 });
          results[channel] = {
            status: result.photo.status === 'failed' ? 'partial' : 'published',
            messageId: result.messageId,
            publishedAt: new Date().toISOString(),
            error: result.photo.status === 'failed' ? result.photo.error : '',
          };
        } catch (channelError) {
          console.error(`Telegram publish to ${channel} failed:`, channelError);
          results[channel] = {
            status: 'failed',
            messageId: null,
            publishedAt: '',
            error: channelError?.userMessage || 'Publishing failed. Please try again.',
          };
        }
      }

      const values = Object.values(results);
      const sentCount = values.filter((r) => r.status !== 'failed').length;
      const overall = sentCount === 0 ? 'failed' : (sentCount === values.length ? 'published' : 'partial');

      // Surface the first problem so it is not silently swallowed
      const problem = values.find((r) => r.status === 'failed' || r.status === 'partial');
      setPublishError(problem && problem.status !== 'published' ? problem.error : '');
      setPublishStatus(overall);

      await updateDoc(doc(db, 'announcements', announcementId), {
        telegram: {
          status: overall,
          channel: channels.length === 1 ? channels[0] : selection,
          message,
          channels: results,
          publishedAt: new Date().toISOString(),
          error: problem && problem.status !== 'published' ? problem.error : '',
        },
      });
    } catch (error) {
      console.error('Telegram publish failed:', error);
      // Only a generic, redacted message ever reaches the UI
      const safeMessage = error?.userMessage || 'Publishing failed. Please try again.';
      setPublishError(safeMessage);
      setPublishStatus('failed');

      if (announcementId) {
        try {
          await updateDoc(doc(db, 'announcements', announcementId), {
            telegram: {
              status: 'failed',
              channel: selection,
              message,
              publishedAt: '',
              error: safeMessage,
            },
          });
        } catch (metaError) {
          console.error('Could not record publish failure:', metaError);
        }
      }
    }
  };

  const handleDeleteAnnouncement = async (announcement) => {
    const { id, title } = announcement;
    const records = normalizeTelegramRecords(announcement.telegram);
    const sentChannels = Object.keys(records);

    const warning = sentChannels.length > 0
      ? `\n\nThe Telegram message will also be removed from: ${sentChannels
          .map((c) => getChannelConfig(c)?.label || c)
          .join(', ')}.\n\nNote: Telegram only allows bots to delete messages sent in the last 48 hours, so an older message may stay in the channel.`
      : '';

    const confirmed = await ask({
      tone: 'danger',
      title: 'Delete announcement?',
      message: `"${title}" will be permanently removed.${warning}`,
      showCancel: true,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    if (!confirmed) return;

    // Remove the Telegram message(s) first — if that fails the announcement
    // is still deleted, and the user is told what was left behind.
    const failures = [];
    for (const channel of sentChannels) {
      const result = await deleteTelegramMessage({ channel, messageId: records[channel]?.messageId });
      if (!result.deleted && records[channel]?.messageId) {
        failures.push(`${getChannelConfig(channel)?.label || channel}: ${result.error}`);
      }
    }

    try {
      await deleteDoc(doc(db, 'announcements', id));
    } catch (error) {
      console.error('Error deleting announcement:', error);
      await notify({ tone: 'error', title: 'Could not delete', message: 'Please try again.' });
      return;
    }

    // The confirmation is the acknowledgement — no follow-up on success.
    // A failure is still surfaced so a Telegram message left behind is never
    // silently forgotten.
    if (failures.length > 0) {
      await notify({
        tone: 'error',
        title: 'Telegram message not removed',
        message: `These Telegram messages are still in the channel:\n\n• ${failures.join('\n• ')}`,
      });
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

      await notify({ tone: 'success', title: 'Event added', message: `"${eventForm.eventName}" was added to the calendar.` });
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
      await notify({ tone: 'error', title: 'Could not add event', message: 'Please try again.' });
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

      await notify({ tone: 'success', title: 'Event updated', message: `"${eventForm.eventName}" was updated.` });
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
      await notify({ tone: 'error', title: 'Could not update event', message: 'Please try again.' });
      setLoading(false);
    }
  };

  const handleDeleteEvent = async (id, name) => {
    const confirmed = await ask({
      tone: 'danger',
      title: 'Delete event?',
      message: `"${name}" will be permanently removed from the calendar.`,
      showCancel: true,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, 'calendarEvents', id));
      await notify({ tone: 'success', title: 'Deleted', message: `"${name}" was removed.` });
    } catch (error) {
      console.error('Error deleting event:', error);
      await notify({ tone: 'error', title: 'Could not delete', message: 'Please try again.' });
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
  // NEWS ARTICLE HANDLERS
  // ========================================
  const handleNewsChange = (e) => {
    const { name, value } = e.target;
    setNewsForm(prev => ({ ...prev, [name]: value }));
  };

  const handleNewsImageChange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const validImages = files.filter(f => f.type.startsWith('image/'));
    if (validImages.length !== files.length) {
      await notify({
        tone: 'info',
        title: 'Some files skipped',
        message: 'Files that were not images were skipped.',
      });
    }

    try {
      const compressedImages = await Promise.all(
        validImages.map(file => CompressImage(file))
      );
      setNewsForm(prev => ({
        ...prev,
        images: [...prev.images, ...compressedImages],
      }));
      setNewsImagePreviews(prev => [...prev, ...compressedImages]);
    } catch (error) {
      console.error('Error processing images:', error);
      await notify({
        tone: 'error',
        title: 'Could not process images',
        message: 'Some images failed to process. Please try again.',
      });
    }
  };

  const removeNewsImage = (index) => {
    setNewsForm(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
    setNewsImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddNews = async (e) => {
    e.preventDefault();
    if (newsForm.images.length < 1) {
      await notify({
        tone: 'error',
        title: 'Photo required',
        message: 'Please add at least 1 photo for the news article.',
      });
      return;
    }
    setLoading(true);
    try {
      await addDoc(collection(db, 'newsArticles'), {
        title: newsForm.title,
        description: newsForm.description,
        tag: newsForm.tag,
        images: newsForm.images,
        expiryDate: newsForm.expiryDate || '',
        createdAt: new Date().toISOString(),
      });
      await notify({ tone: 'success', title: 'News published', message: `"${newsForm.title}" is now live on the Homepage.` });
      resetNewsForm();
    } catch (error) {
      console.error('Error adding news:', error);
      await notify({ tone: 'error', title: 'Could not publish', message: 'Please try again.' });
    }
    setLoading(false);
  };

  const handleEditNews = (article) => {
    setEditingNewsId(article.id);
    setNewsForm({
      title: article.title,
      description: article.description,
      tag: article.tag,
      images: article.images || [],
      expiryDate: article.expiryDate || '',
    });
    setNewsImagePreviews(article.images || []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleUpdateNews = async (e) => {
    e.preventDefault();
    if (newsForm.images.length < 1) {
      await notify({
        tone: 'error',
        title: 'Photo required',
        message: 'Please add at least 1 photo for the news article.',
      });
      return;
    }
    setLoading(true);
    try {
      const newsRef = doc(db, 'newsArticles', editingNewsId);
      await updateDoc(newsRef, {
        title: newsForm.title,
        description: newsForm.description,
        tag: newsForm.tag,
        images: newsForm.images,
        expiryDate: newsForm.expiryDate || '',
        updatedAt: new Date().toISOString(),
      });
      await notify({ tone: 'success', title: 'News updated', message: `"${newsForm.title}" was updated.` });
      resetNewsForm();
    } catch (error) {
      console.error('Error updating news:', error);
      await notify({ tone: 'error', title: 'Could not update', message: 'Please try again.' });
    }
    setLoading(false);
  };

  const handleDeleteNews = async (id, title) => {
    const confirmed = await ask({
      tone: 'danger',
      title: 'Delete news article?',
      message: `"${title}" will be permanently removed from the Homepage.`,
      showCancel: true,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, 'newsArticles', id));
      await notify({ tone: 'success', title: 'Deleted', message: `"${title}" was removed.` });
    } catch (error) {
      console.error('Error deleting news:', error);
      await notify({ tone: 'error', title: 'Could not delete', message: 'Please try again.' });
    }
  };

  const resetNewsForm = () => {
    setNewsForm({ title: '', description: '', tag: 'event', images: [], expiryDate: '' });
    setNewsImagePreviews([]);
    setEditingNewsId(null);
  };

  const getNewsTagStyle = (tag) => {
    switch (tag) {
      case 'event': return styles.newsTagEvent;
      case 'policy': return styles.newsTagPolicy;
      case 'news': return styles.newsTagNews;
      default: return styles.newsTagNews;
    }
  };

  const isArticleExpired = (expiryDate) => {
    if (!expiryDate) return false;
    return new Date(expiryDate) < new Date();
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
        <button
          onClick={() => setActiveTab('news')}
          className={`${styles.tab} ${activeTab === 'news' ? styles.tabActive : ''}`}
        >
          📰 Latest News
          <span className={styles.tabBadge}>{newsArticles.length}</span>
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

            <form onSubmit={editingAnnouncementId ? handleUpdateAnnouncement : handleAddAnnouncement} className={styles.form} noValidate>
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
                  className={`${styles.input} ${formErrors.title ? styles.inputError : ''}`}
                  required
                />
                {formErrors.title && <span className={styles.fieldError}>{formErrors.title}</span>}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Announcement Type <span className={styles.required}>*</span>
                </label>
                <select
                  name="type"
                  value={announcementForm.type}
                  onChange={(e) => {
                    handleAnnouncementChange(e);
                    resetPublishState();
                  }}
                  className={styles.select}
                >
                  <option value="">Select Announcement Type</option>
                  {ANNOUNCEMENT_TYPE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {ANNOUNCEMENT_TYPES[value].label}
                    </option>
                  ))}
                </select>
                <p className={styles.helperText}>
                  Sets the emoji and title that open the Telegram message. It does not
                  change the announcement text you write below.
                </p>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Description <span className={styles.required}>*</span>
                </label>
                <textarea
                  name="description"
                  value={announcementForm.description}
                  onChange={handleAnnouncementChange}
                  placeholder="Write the announcement exactly how you want it posted..."
                  rows="6"
                  className={`${styles.textarea} ${formErrors.description ? styles.inputError : ''}`}
                  required
                />
                {formErrors.description && <span className={styles.fieldError}>{formErrors.description}</span>}
                <p className={styles.helperText}>
                  This is your custom message. It is used for the website and sent to
                  Telegram unchanged.
                </p>
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
                    className={`${styles.input} ${formErrors.venue ? styles.inputError : ''}`}
                    required
                  />
                  {formErrors.venue && <span className={styles.fieldError}>{formErrors.venue}</span>}
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
                    className={`${styles.input} ${formErrors.eventDate ? styles.inputError : ''}`}
                    required
                  />
                  {formErrors.eventDate && <span className={styles.fieldError}>{formErrors.eventDate}</span>}
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
                    className={`${styles.input} ${formErrors.eventTime ? styles.inputError : ''}`}
                    required
                  />
                  {formErrors.eventTime && <span className={styles.fieldError}>{formErrors.eventTime}</span>}
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

              {/* HOMEPAGE RELEASE */}
              <div className={styles.releaseBlock}>
                <label className={styles.releaseToggle}>
                  <input
                    type="checkbox"
                    name="homepageVisible"
                    checked={announcementForm.homepageVisible}
                    onChange={handleAnnouncementChange}
                    className={styles.checkbox}
                  />
                  <span className={styles.releaseToggleText}>
                    <strong>Release to Homepage</strong>
                    <span className={styles.releaseToggleHint}>
                      {announcementForm.homepageVisible
                        ? '✅ This announcement will appear in the Homepage announcement section.'
                        : '🔒 Saved privately. It will stay out of the Homepage announcement section until you tick this.'}
                    </span>
                  </span>
                </label>
              </div>

              {/* TELEGRAM PREVIEW */}
              <div className={styles.telegramBlock}>
                <span className={styles.telegramBlockLabel}>Telegram Preview</span>
                {selectedTypeConfig ? (
                  <pre className={styles.telegramPreview}>{renderTelegramText(telegramParts)}</pre>
                ) : (
                  <p className={styles.telegramPlaceholder}>
                    Select an Announcement Type to see the Telegram message.
                  </p>
                )}
              </div>

              {/* PUBLISH */}
              <div className={styles.telegramBlock}>
                <span className={styles.telegramBlockLabel}>Publish To</span>
                <div className={styles.channelOptions}>
                  {Object.values(TELEGRAM_CHANNELS).map((channel) => (
                    <label
                      key={channel.value}
                      className={`${styles.channelOption} ${telegramChannel === channel.value ? styles.channelOptionActive : ''}`}
                    >
                      <input
                        type="radio"
                        name="telegramChannel"
                        value={channel.value}
                        checked={telegramChannel === channel.value}
                        onChange={(e) => {
                          setTelegramChannel(e.target.value);
                          resetPublishState();
                        }}
                        className={styles.checkbox}
                      />
                      <span>{channel.label}</span>
                    </label>
                  ))}

                  <label
                    className={`${styles.channelOption} ${telegramChannel === BOTH_CHANNELS ? styles.channelOptionActive : ''}`}
                  >
                    <input
                      type="radio"
                      name="telegramChannel"
                      value={BOTH_CHANNELS}
                      checked={telegramChannel === BOTH_CHANNELS}
                      onChange={(e) => {
                        setTelegramChannel(e.target.value);
                        resetPublishState();
                      }}
                      className={styles.checkbox}
                    />
                    <span>Both Channels</span>
                  </label>
                </div>

                {/* Readiness summary */}
                <div className={styles.publishSummary}>
                  {publishChecks.map((check) => (
                    <div key={check.label} className={styles.publishSummaryRow}>
                      <span className={styles.publishSummaryLabel}>{check.label}</span>
                      <span className={`${styles.publishSummaryValue} ${check.ok ? '' : styles.publishSummaryMissing}`}>
                        {check.value}
                      </span>
                    </div>
                  ))}
                  {!announcementForm.description.trim() && (
                    <div className={styles.publishSummaryRow}>
                      <span className={styles.publishSummaryLabel}>Message:</span>
                      <span className={`${styles.publishSummaryValue} ${styles.publishSummaryMissing}`}>
                        Empty
                      </span>
                    </div>
                  )}
                </div>

                {telegramChannel && !targetChannels.every((c) => isTelegramReady(c)) && (
                  <p className={styles.publishWarning}>
                    ⚠️ Telegram is not fully configured for {selectedChannelConfig?.label}. Add the
                    bot token and any missing channel IDs to your environment file.
                  </p>
                )}

                <div className={styles.publishRow}>
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={!canPublish}
                    className={styles.publishButton}
                  >
                    {publishStatus === 'publishing' ? '⏳ Publishing...' : '📤 Publish'}
                  </button>

                  {publishStatus === 'published' && (
                    <span className={styles.publishStatusSuccess}>✓ Published successfully</span>
                  )}
                  {publishStatus === 'partial' && publishError && (
                    <span className={styles.publishStatusPartial}>
                      ⚠ Text sent, but the photo failed: {publishError}
                    </span>
                  )}
                  {publishStatus === 'failed' && publishError && (
                    <span className={styles.publishStatusError}>✕ {publishError}</span>
                  )}
                </div>
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
                      setAnnouncementForm({ ...EMPTY_ANNOUNCEMENT_FORM });
                      setImagePreview(null);
                      setSelectedImage(null);
                      setTelegramChannel('');
                      resetPublishState();
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
                          {getTypeConfig(announcement.type) && (
                            <span className={styles.typeBadge}>
                              {getTypeConfig(announcement.type).label}
                            </span>
                          )}
                          <span className={`${styles.releaseBadge} ${announcement.homepageVisible ? styles.releaseBadgeLive : ''}`}>
                            {announcement.homepageVisible ? '🌐 On Homepage' : '🔒 Not released'}
                          </span>
                          {announcement.telegram?.status === 'published' && (
                            <span className={styles.publishedBadge}>
                              📤 {publishedChannelLabels(announcement)}
                            </span>
                          )}
                          {announcement.telegram?.status === 'partial' && (
                            <span className={styles.partialBadge}>
                              ⚠ Photo not sent
                            </span>
                          )}
                          {announcement.telegram?.status === 'failed' && (
                            <span className={styles.failedBadge}>✕ Not published</span>
                          )}
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
                            onClick={() => handleDeleteAnnouncement(announcement)}
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

          {/* PUBLISH CONFIRMATION */}
          {confirmOpen && (
            <div className={styles.confirmOverlay} onClick={() => setConfirmOpen(false)}>
              <div className={styles.confirmModal} onClick={(e) => e.stopPropagation()}>
                <h3 className={styles.confirmTitle}>Publish Announcement</h3>

                <div className={styles.confirmRows}>
                  <div className={styles.confirmRow}>
                    <span className={styles.confirmLabel}>Type:</span>
                    <span className={styles.confirmValue}>{selectedTypeConfig?.label}</span>
                  </div>
                  <div className={styles.confirmRow}>
                    <span className={styles.confirmLabel}>Channel:</span>
                    <span className={styles.confirmValue}>{selectedChannelConfig?.label}</span>
                  </div>
                  <div className={styles.confirmRow}>
                    <span className={styles.confirmLabel}>Attachment:</span>
                    <span className={styles.confirmValue}>
                      {announcementForm.imageBase64 ? '🖼 Photo' : 'None'}
                    </span>
                  </div>
                </div>

                <span className={styles.confirmLabel}>Message:</span>
                <pre className={styles.confirmMessage}>{renderTelegramText(telegramParts)}</pre>

                <div className={styles.confirmActions}>
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(false)}
                    className={styles.cancelButton}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmPublish}
                    disabled={publishStatus === 'publishing'}
                    className={styles.publishButton}
                  >
                    {publishStatus === 'publishing' ? '⏳ Publishing...' : 'Confirm Publish'}
                  </button>
                </div>
              </div>
            </div>
          )}
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

      {/* NEWS TAB */}
      {activeTab === 'news' && (
        <div>
          {/* ADD/EDIT NEWS FORM */}
          <div className={styles.formWrapper}>
            <h3 className={styles.sectionTitle}>
              {editingNewsId ? '✏️ Edit News Article' : '➕ Create News Article'}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--ann-text-muted, #888)', marginBottom: '1rem' }}>
              News articles appear in the "What's New" section on the Homepage. Add photos, a tag, and an optional expiry date.
            </p>

            <form onSubmit={editingNewsId ? handleUpdateNews : handleAddNews} className={styles.form}>
              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Article Title <span className={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  name="title"
                  value={newsForm.title}
                  onChange={handleNewsChange}
                  placeholder="e.g., SSG General Assembly 2025"
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
                  value={newsForm.description}
                  onChange={handleNewsChange}
                  placeholder="Write a brief summary of this news..."
                  rows="3"
                  className={styles.textarea}
                  required
                />
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>
                    Tag <span className={styles.required}>*</span>
                  </label>
                  <select
                    name="tag"
                    value={newsForm.tag}
                    onChange={handleNewsChange}
                    className={styles.select}
                  >
                    <option value="event">🎉 Event</option>
                    <option value="policy">📋 Policy</option>
                    <option value="news">📰 News</option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>Expiry Date (Optional)</label>
                  <input
                    type="datetime-local"
                    name="expiryDate"
                    value={newsForm.expiryDate}
                    onChange={handleNewsChange}
                    className={styles.input}
                  />
                  <p className={styles.helperText}>
                    Article will be hidden from the homepage after this date.
                  </p>
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Photos <span className={styles.required}>*</span>
                </label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleNewsImageChange}
                  className={styles.fileInput}
                />
                <p className={styles.helperText}>
                  Add at least 1 photo (recommended 3+). JPG/PNG, auto-compressed.
                </p>

                {newsImagePreviews.length > 0 && (
                  <div className={styles.multiImageGrid}>
                    {newsImagePreviews.map((img, index) => (
                      <div key={index} className={styles.multiImageCard}>
                        <img src={img} alt={`Photo ${index + 1}`} className={styles.multiImageThumb} />
                        <button
                          type="button"
                          onClick={() => removeNewsImage(index)}
                          className={styles.multiImageRemove}
                        >
                          ✕
                        </button>
                        <span className={styles.multiImageIndex}>#{index + 1}</span>
                      </div>
                    ))}
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
                    : editingNewsId
                      ? '💾 Update Article'
                      : '📰 Publish Article'}
                </button>

                {editingNewsId && (
                  <button
                    type="button"
                    onClick={resetNewsForm}
                    className={styles.cancelButton}
                  >
                    ❌ Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* NEWS ARTICLES LIST */}
          <div className={styles.announcementsWrapper}>
            <h3 className={styles.sectionTitle}>All News Articles</h3>

            {newsArticles.length === 0 ? (
              <div className={styles.emptyState}>
                <p className={styles.emptyText}>No news articles yet. Publish your first one above!</p>
              </div>
            ) : (
              <div className={styles.announcementsList}>
                {newsArticles.map((article) => (
                  <div key={article.id} className={styles.announcementCard}>
                    <div
                      className={styles.announcementHeader}
                      onClick={() => setExpandedId(expandedId === article.id ? null : article.id)}
                    >
                      <div className={styles.announcementHeaderLeft}>
                        <h4 className={styles.announcementTitle}>{article.title}</h4>
                        <div className={styles.announcementMeta}>
                          <span className={`${styles.newsTagBadge} ${getNewsTagStyle(article.tag)}`}>
                            {article.tag}
                          </span>
                          {article.expiryDate && (
                            isArticleExpired(article.expiryDate)
                              ? <span className={styles.expiredBadge}>⏰ Expired</span>
                              : <span className={styles.expiryBadge}>⏳ Expires {new Date(article.expiryDate).toLocaleDateString()}</span>
                          )}
                          <span className={styles.announcementDate}>
                            📅 {formatDate(article.createdAt?.split('T')[0] || '')}
                          </span>
                        </div>
                      </div>
                      <div className={`${styles.expandIcon} ${expandedId === article.id ? styles.expandIconExpanded : ''}`}>
                        ▼
                      </div>
                    </div>

                    {/* Show first image as preview */}
                    {article.images?.[0] && (
                      <div className={styles.announcementImageWrapper}>
                        <img
                          src={article.images[0]}
                          alt={article.title}
                          className={styles.announcementImage}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      </div>
                    )}

                    {expandedId === article.id && (
                      <div className={styles.announcementBody}>
                        <div className={styles.announcementDetail}>
                          <strong className={styles.detailLabel}>Description:</strong>
                          <p className={styles.detailValue}>{article.description}</p>
                        </div>

                        {article.images?.length > 1 && (
                          <div className={styles.announcementDetail}>
                            <strong className={styles.detailLabel}>All Photos ({article.images.length}):</strong>
                            <div className={styles.multiImageGrid}>
                              {article.images.map((img, idx) => (
                                <div key={idx} className={styles.multiImageCard}>
                                  <img src={img} alt={`Photo ${idx + 1}`} className={styles.multiImageThumb} />
                                  <span className={styles.multiImageIndex}>#{idx + 1}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className={styles.announcementActions}>
                          <button
                            onClick={() => handleEditNews(article)}
                            className={styles.editButton}
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => handleDeleteNews(article.id, article.title)}
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

      {/* GLASS DIALOG — replaces every window.alert / window.confirm */}
      <GlassModal
        open={!!dialog}
        tone={dialog?.tone}
        title={dialog?.title}
        message={dialog?.message}
        confirmLabel={dialog?.confirmLabel}
        cancelLabel={dialog?.cancelLabel}
        showCancel={dialog?.showCancel}
        onConfirm={() => closeDialog(true)}
        onCancel={() => closeDialog(false)}
      />
    </div>
  );
}
export default Announcement;