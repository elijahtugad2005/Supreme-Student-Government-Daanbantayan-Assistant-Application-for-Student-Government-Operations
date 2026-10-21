# Technical Specification: Calendar Modal Boundaries & Homepage Read-Only Viewer

**Triage Status:** `ready-for-agent`  
**System Module:** Event Calendar & Announcements System / Homepage Integration  
**Author:** AI Technical Pair Architect  
**Status:** Approved Specification  

---

## Problem Statement

When officers interact with the Calendar Widget to edit dates, event days, or hover over event entries, the hover card and quick-add popover calculate floating coordinates that can clip outside the boundaries of the parent container or viewport, causing layout disruption, overflowing borders, and awkward scrolling glitches.

Furthermore, students, guests, and general members browsing the CTU-Daanbantayan SSG Homepage currently lack instant visibility of scheduled campus activities and academic deadlines directly on the landing page. However, non-authorized visitors must under no circumstances be able to edit, delete, or create calendar records, nor should unauthorized users have un-gated access to the full event editing dashboard.

---

## Solution

1. **Self-Contained Centered Day Modal in Calendar Widget**:
   - Re-architect the day-click and event-editing trigger so it no longer relies on an unconstrained absolute-positioned floating popover.
   - Introduce an elegant, bounded, centered overlay modal with an internal scrollable body and strict viewport limits (`max-height: 90vh`, `max-width: min(540px, 94vw)`, `overflow-y: auto`), ensuring 100% of inputs, preset chips, and action buttons remain strictly inside the modal container.
   - Refactor hover cards so their positional coordinates are strictly clamped within the calendar grid boundaries.

2. **Dedicated Read-Only Event Calendar Component for Homepage**:
   - Create a dedicated, compact read-only Calendar component (`HomepageEventCalendar`) optimized for student discovery and viewing.
   - Position this component directly beneath the **Announcements & Events** section on the Homepage.
   - Strip all mutation triggers, drag-to-select range handlers, hover edit shortcuts, and bulk action bars from the Homepage calendar view.
   - Provide an authorized **"View Full Calendar"** CTA button that:
     - Allows authorized personnel (admin, officers, executive members, creatives) to seamlessly navigate to the full interactive Calendar inside the Announcements tab (`/announcement?tab=calendar`).
     - Hides or safely prompts unauthorized/guest visitors with an informative sign-in/access-restricted tooltip without exposing editing controls.

---

## User Stories

1. As an SSG officer editing a specific date on the calendar, I want the editing dialog to stay completely inside its modal container, so that inputs and presets do not clip or spill outside the screen.
2. As an SSG officer managing multiple dates, I want the modal overlay to have a clear header, scrollable body, and fixed action buttons, so that I can easily submit or cancel changes regardless of screen size.
3. As a mobile or small-screen user, I want the day event inspection dialog to center on my screen with internal scrolling, so that I can access all event details without horizontal page breaking.
4. As a student visiting the SSG Homepage, I want to see an interactive, read-only monthly calendar directly below Announcements & Events, so that I can browse upcoming exams, activities, and holidays without logging in.
5. As a student or guest on the Homepage, I want to hover or click on scheduled dates to view event titles, venues, and descriptions in read-only mode, so that I can stay updated on campus schedules.
6. As a guest or unauthorized visitor on the Homepage, I should never see edit buttons, delete buttons, or drag-to-create shortcuts, so that the university calendar remains protected from unauthorized changes.
7. As an authorized officer on the Homepage, I want to see a "View Full Calendar" or "Manage Events" button that takes me to the Announcement Calendar tab, so that I can jump into event administration quickly.
8. As a guest clicking "View Full Calendar" on the Homepage, I want to be informed that full calendar management requires officer authorization or login, so that access restrictions are transparent and polite.
9. As an admin viewing the event calendar, I want category color tags and badges to remain consistent between the Homepage read-only view and the full admin calendar, so that the design identity is unified.
10. As a faculty member or student using keyboard navigation, I want the day inspection modal to properly manage focus and close on the Escape key or Backdrop click, so that accessibility standards are upheld.

---

## Implementation Decisions

### Decision 1: Modal Architecture Refactoring (Contained Centered Dialog)
- Replace coordinate-based popovers (`InlineQuickEventPopover` positioning with arbitrary `posX`/`posY`) with a centered flexbox modal overlay pattern.
- The modal wrapper uses `position: fixed` (or contained within the calendar panel) with `display: flex; align-items: center; justify-content: center; z-index: 1000`.
- The modal dialog card is constrained:
  - Width: `clamp(320px, 92vw, 520px)`
  - Maximum height: `88vh`
  - Body container uses `overflow-y: auto; overscroll-behavior: contain;`
  - Footer actions (Cancel, Save & Publish, Delete) remain pinned or stick to the bottom of the modal card.
- All preset chips, emoji selectors, and multi-date series pills wrap cleanly using flex-wrap with negative margins eliminated.

### Decision 2: Bounded Hover Card Clamping
- Hover cards for event summaries on hover must compute their position clamped against `calendarGridRef.current.getBoundingClientRect()`:
  - X clamped between `8px` and `parentWidth - hoverCardWidth - 8px`.
  - Y clamped so it flips beneath or above the day cell if too close to the top or bottom edge.

### Decision 3: Dedicated Compact Homepage Event Calendar
- Build a dedicated component `HomepageEventCalendar.jsx` (and accompanying CSS module) rather than overloading the complex editing logic of `CalendarWidget.jsx`.
- Interface for `HomepageEventCalendar`:
  - Listens to Firestore `calendarEvents` snapshot in real time.
  - Supports month navigation (Previous, Next, Current Day) and category filter chips (Exam, Activity, Holiday, Meeting).
  - Displays day dots and mini-labels.
  - Clicking a day opens a **Read-Only Event Inspector Modal** showing event name, managing organization, venue/location, time, and whether attendance is required.
  - Excludes any forms, input fields, bulk action bars, or drag handlers.

### Decision 4: Role-Gated Navigation Link
- Embed the "View Full Calendar" action button in the header of the Homepage calendar section.
- Permission evaluation seam:
  - If `currentUser` has roles matching `['admin', 'secretary', 'governor', 'finance_secretary', 'representative', 'senator', 'creatives', 'officer']`: the button navigates to `/announcement?tab=calendar`.
  - If guest or unauthorized member: either hide the action button or show a subtle lock badge / modal prompt redirecting to login.

---

## Testing Decisions

### External Behavioral Verification
- **Modal Containment Test**:
  - Open day editing for dates at the far-right edge (e.g. Saturdays), far-left edge (Sundays), top row, and bottom row.
  - Verify that the modal card never overflows the screen horizontally or vertically.
  - Verify that scrolling inside the modal works smoothly without scrolling the parent background page.
- **Read-Only Integrity Test**:
  - Load the Homepage in a guest incognito browser session.
  - Inspect DOM and verify that no edit buttons, delete buttons, drag listeners, or form inputs exist in the calendar.
  - Verify that clicking any day displays event information in read-only format.
- **Authorization Flow Test**:
  - Verify that logging in with an SSG officer account reveals the full calendar management capabilities in `/announcement`.
  - Verify that guest users clicking navigation links cannot access editing routes.

---

## Out of Scope

- Integrating external calendar sync protocols (Google Calendar API, iCal export) — reserved for future releases.
- SMS notification dispatch for calendar events (handled via existing Telegram bot).
- Multi-campus scheduling outside CTU-Daanbantayan.

---

## Further Notes

- The Homepage calendar layout will inherit the existing dark/light editorial theme variables from `src/index.css` and `Homepage.module.css`.
- The existing Firestore collection `calendarEvents` schema remains unchanged; this update is 100% backward compatible with existing event documents.
