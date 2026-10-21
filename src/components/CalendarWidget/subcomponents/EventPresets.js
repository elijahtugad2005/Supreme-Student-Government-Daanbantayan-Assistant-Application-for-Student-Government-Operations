// components/CalendarWidget/subcomponents/EventPresets.js
export const EVENT_PRESETS = [
  { id: 'classes', label: 'Academic / Class', eventType: 'Class', color: '#38BDF8', emoji: '📚', desc: 'Lectures, regular classes & deadlines' },
  { id: 'exam', label: 'Upcoming Exam', eventType: 'Exam', color: '#F87171', emoji: '📝', desc: 'Prelims, midterms, finals & departmental exams' },
  { id: 'no_classes', label: 'No Classes', eventType: 'Holiday', color: '#EF4444', emoji: '🚫', desc: 'Suspensions, weather advisory & campus closures' },
  { id: 'faculty', label: 'Faculty Event', eventType: 'Event', color: '#A855F7', emoji: '🏛️', desc: 'College deans, faculty assembly & departmental councils' },
  { id: 'training', label: 'Teacher Training', eventType: 'Meeting', color: '#EC4899', emoji: '🎓', desc: 'Seminars, in-service training & faculty development' },
  { id: 'holiday', label: 'Holiday', eventType: 'Holiday', color: '#10B981', emoji: '🏖️', desc: 'National, regional & university holidays' },
  { id: 'birthday', label: 'Birthday / Milestone', eventType: 'Event', color: '#F59E0B', emoji: '🎂', desc: 'Officer, staff & university founding anniversaries' },
  { id: 'intramurals', label: 'Intramurals / Games', eventType: 'Event', color: '#6366F1', emoji: '🏆', desc: 'Sports competitions, cheer dance & multi-day cups' },
  { id: 'ssg_meeting', label: 'SSG Meeting', eventType: 'Meeting', color: '#EAB308', emoji: '⚖️', desc: 'Executive board, legislative senate & assembly' },
];

export const ORG_PRESETS = [
  { id: 'ssg', name: 'Supreme Student Government', tag: 'SSG', color: '#D94F1F', logo: '🏛️' },
  { id: 'cict', name: 'College of Computer Studies', tag: 'CICT', color: '#0284C7', logo: '💻' },
  { id: 'coed', name: 'College of Education', tag: 'COED', color: '#16A34A', logo: '📖' },
  { id: 'cot', name: 'College of Technology', tag: 'COT', color: '#EA580C', logo: '⚙️' },
  { id: 'cas', name: 'College of Arts and Sciences', tag: 'CAS', color: '#9333EA', logo: '🎨' },
  { id: 'faculty', name: 'University Faculty & Admin', tag: 'ADMIN', color: '#475569', logo: '🛡️' },
];

export const COLOR_SWATCHES = [
  '#800000', // Maroon / Crimson
  '#38BDF8', // Sky Blue
  '#F87171', // Coral Red
  '#34D399', // Emerald
  '#C084FC', // Purple
  '#FBBF24', // Amber
  '#EC4899', // Pink
  '#6366F1', // Indigo
  '#D94F1F', // CTU Orange
  '#64748B', // Slate
];

export const QUICK_EMOJIS = ['📅', '📝', '📚', '🏆', '🎉', '🚫', '🏛️', '🎂', '⚖️', '🎓', '🏖️', '💻'];
