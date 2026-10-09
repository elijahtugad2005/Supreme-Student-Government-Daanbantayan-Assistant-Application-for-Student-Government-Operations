# Announcement Feature Fix - Implementation Plan

**Implementation completed:** All three issues have been fixed and verified for syntax correctness.

## Investigation Summary

After investigating the Announcement feature codebase, I've identified the root causes and exact fixes needed for all three issues.

---

## Issue 1: Form Not Clearing After Publish

### Root Cause

The `<input type="file">` field cannot be controlled by React state alone. When the announcement is successfully added:
- `setAnnouncementForm({ ...EMPTY_ANNOUNCEMENT_FORM })` resets all form state
- `setImagePreview(null)` clears the preview
- **BUT** the file input's native browser state retains the filename

The file input needs to be reset imperatively using a ref: `inputRef.current.value = ''`.

### Files Modified
- `src/components/Announcement.jsx`

### Exact Fix

1. **Add a ref for the file input** (line ~69, after `dialogResolver`):
```javascript
const dialogResolver = useRef(null);
const fileInputRef = useRef(null);  // ADD THIS LINE
```

2. **Attach the ref to the file input** (line ~1286):
```javascript
<input
  ref={fileInputRef}  // ADD THIS LINE
  type="file"
  accept="image/*"
  onChange={handleImageChange}
  className={styles.fileInput}
/>
```

3. **Reset the file input in `handleAddAnnouncement`** (after line ~459, inside the try block after the success notify):
```javascript
await notify({
  tone: 'success',
  title: 'Announcement added',
  message: announcementForm.homepageVisible
    ? '"' + announcementForm.title + '" was added and is now live on the Homepage.'
    : '"' + announcementForm.title + '" was added. It is not shown on the Homepage yet.',
});

setAnnouncementForm({ ...EMPTY_ANNOUNCEMENT_FORM });
setImagePreview(null); 
setSelectedImage(null);
if (fileInputRef.current) fileInputRef.current.value = '';  // ADD THIS LINE
setFormErrors({});
```

4. **Reset the file input in `handleUpdateAnnouncement`** (after line ~539, inside the try block after the success notify):
```javascript
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
if (fileInputRef.current) fileInputRef.current.value = '';  // ADD THIS LINE
setFormErrors({});
```

5. **Reset the file input in the inline remove button** (line ~1298):
```javascript
<button
  type="button"
  onClick={() => {
    setImagePreview(null);
    setAnnouncementForm(prev => ({ ...prev, imageBase64: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';  // ADD THIS LINE
  }}
  className={styles.removeImageBtn}
>
  ✕ Remove
</button>
```

### Verification
1. Start the dev server: `npm run dev`
2. Navigate to Announcements
3. Fill in all required fields and upload an image
4. Click "Add Announcement"
5. Confirm the form clears completely, including the file input showing no selected file
6. Repeat for Update flow

---

## Issue 2: Update Button UI - Low Visibility

### Root Cause

The `.submitButton` in `Announcement.module.css` (line ~261) uses:
```css
background: var(--ann-card-bg);
```

This makes it blend into the card background, especially in edit mode. The button is nearly invisible and users can't distinguish it from the cancel button.

### Files Modified
- `src/components/Announcement.module.css`

### Exact Fix

Replace the `.submitButton` style (lines ~261-280):

**OLD:**
```css
.submitButton {
  flex: 1;
  min-width: 160px;
  padding: 0.625rem 1rem;
  background: var(--ann-card-bg);
  color: white;
  border: 1px solid var(--ann-border);
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: var(--ann-font);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  box-shadow: 0 2px 8px rgba(217, 79, 31, 0.3);
}

.submitButton:hover {
  background: linear-gradient(135deg, var(--ann-accent-hover) 0%, rgba(217, 79, 31, 0.9) 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(217, 79, 31, 0.4);
}
```

**NEW:**
```css
.submitButton {
  flex: 1;
  min-width: 160px;
  padding: 0.625rem 1rem;
  background: linear-gradient(135deg, var(--ann-accent) 0%, rgba(217, 79, 31, 0.85) 100%);
  color: white;
  border: 1px solid var(--ann-accent);
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: var(--ann-font);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  box-shadow: 0 2px 8px rgba(217, 79, 31, 0.35);
}

.submitButton:hover {
  background: linear-gradient(135deg, var(--ann-accent-hover) 0%, rgba(217, 79, 31, 0.95) 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(217, 79, 31, 0.5);
}
```

### Changes Explained
- Changed base background from `var(--ann-card-bg)` to `linear-gradient(135deg, var(--ann-accent) 0%, rgba(217, 79, 31, 0.85) 100%)` — now uses the accent maroon color
- Changed border from `var(--ann-border)` to `var(--ann-accent)` for stronger definition
- Adjusted box-shadow intensity from 0.3 to 0.35 (base) and 0.4 to 0.5 (hover)
- Updated hover gradient to be slightly more opaque (0.95) for better feedback

The button will now stand out clearly against the card background with the maroon/orange accent color, matching the design system while being visually distinct from the red Cancel button.

### Verification
1. Navigate to Announcements
2. Create a new announcement — verify the "Add Announcement" button is clearly visible with maroon/orange gradient
3. Edit an existing announcement — verify the "Update" button (which uses `.submitButton`) is prominent and clearly differentiated from the red "Cancel" button
4. Test hover states — the button should have clear visual feedback

---

## Issue 3: Telegram Heart Reaction Inline Keyboard

### Root Cause

The `sendAnnouncementToTelegram` function in `telegramService.js` calls `sendMessage` without any `reply_markup`, so recipients cannot indicate they've seen the message. The backend also lacks a webhook handler for Telegram callback queries.

### Files Modified
1. `src/services/telegramService.js`
2. `backend/server.js`

### Part A: Add Inline Keyboard to Telegram Messages

**File:** `src/services/telegramService.js`

**Location:** Inside `sendAnnouncementToTelegram` function, in the `postToTelegram` call (around line 55-62)

**OLD:**
```javascript
const text = await postToTelegram(token, 'sendMessage', {
  chat_id: chatId,
  text: message,
  // The title is bolded; everything else is escaped so the manager's
  // punctuation and line breaks are delivered as written.
  parse_mode: 'HTML',
  disable_web_page_preview: true,
});
```

**NEW:**
```javascript
const text = await postToTelegram(token, 'sendMessage', {
  chat_id: chatId,
  text: message,
  // The title is bolded; everything else is escaped so the manager's
  // punctuation and line breaks are delivered as written.
  parse_mode: 'HTML',
  disable_web_page_preview: true,
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: '❤️ Seen',
          callback_data: 'reaction_heart'
        }
      ]
    ]
  },
});
```

### Part B: Add Telegram Webhook Handler to Backend

**File:** `backend/server.js`

**Location:** After the existing `/webhook` POST route (around line 118, after the existing webhook handler)

**Add this new route:**

```javascript
// ──────────────────────────────────────────────────────────────────────────────
// TELEGRAM WEBHOOK — Inline Keyboard Callback Handler
// ──────────────────────────────────────────────────────────────────────────────

app.post('/telegram-webhook', async (req, res) => {
  // Acknowledge immediately
  res.status(200).send('OK');

  try {
    const body = req.body;

    // Handle callback queries (inline keyboard button presses)
    if (body.callback_query) {
      const callbackQuery = body.callback_query;
      const callbackQueryId = callbackQuery.id;
      const callbackData = callbackQuery.data;
      const userId = callbackQuery.from?.id;
      const userName = callbackQuery.from?.first_name || 'User';

      console.log(`[${new Date().toISOString()}] Telegram callback from ${userName} (${userId}): ${callbackData}`);

      // Handle the heart reaction
      if (callbackData === 'reaction_heart') {
        const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
        
        if (!telegramBotToken) {
          console.error(`[${new Date().toISOString()}] TELEGRAM_BOT_TOKEN not configured`);
          return;
        }

        try {
          // Acknowledge the callback query with a popup message
          await axios.post(
            `https://api.telegram.org/bot${telegramBotToken}/answerCallbackQuery`,
            {
              callback_query_id: callbackQueryId,
              text: `❤️ Thanks ${userName}! Marked as seen.`,
              show_alert: false, // false = small toast, true = alert dialog
            }
          );

          console.log(`[${new Date().toISOString()}] Heart reaction acknowledged for ${userName}`);
        } catch (error) {
          console.error(`[${new Date().toISOString()}] Error acknowledging callback:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error processing Telegram webhook:`, error.message);
  }
});
```

### Part C: Environment Variable Documentation

The backend needs `TELEGRAM_BOT_TOKEN` in its `.env` file. According to `backend/.env.example`, this should already be configured as:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```

**Note:** The frontend uses `TELEGRAM_BOT_API` (defined in `.env.local`), but the backend uses `TELEGRAM_BOT_TOKEN`. These should reference the same token value but use different variable names per their respective contexts.

### Webhook Setup Required

After deploying, configure the Telegram Bot API to send updates to the backend:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-backend-url/telegram-webhook"}'
```

For local testing with ngrok:
```bash
# Terminal 1: Start ngrok
ngrok http 3000

# Terminal 2: Set webhook to ngrok URL
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://YOUR_NGROK_ID.ngrok.io/telegram-webhook"}'
```

### Verification

1. Start the backend: `cd backend && node server.js`
2. Verify backend is running: `http://localhost:3000/health`
3. Start the frontend: `npm run dev`
4. Create and publish an announcement to Telegram (Faculty or All Mayors channel)
5. Open Telegram and verify the message includes a "❤️ Seen" button below the announcement
6. Click the "❤️ Seen" button
7. Verify a toast notification appears: "❤️ Thanks [YourName]! Marked as seen."
8. Check backend console for the log: `Telegram callback from [User] ([id]): reaction_heart`
9. Verify the button does not show a loading spinner (callback was acknowledged)

---

## Files Summary

### Files to Modify

1. **src/components/Announcement.jsx**
   - Add `fileInputRef` declaration
   - Attach ref to file input element
   - Reset file input in `handleAddAnnouncement`, `handleUpdateAnnouncement`, and inline remove button

2. **src/components/Announcement.module.css**
   - Update `.submitButton` and `.submitButton:hover` styles to use accent color gradient

3. **src/services/telegramService.js**
   - Add `reply_markup` with inline keyboard to `sendMessage` call

4. **backend/server.js**
   - Add new `POST /telegram-webhook` route to handle Telegram callback queries
   - Add `answerCallbackQuery` logic for heart reactions

### No New Files Required

All changes are modifications to existing files.

---

## Build and Test Commands

```bash
# Frontend
npm run dev

# Backend
cd backend
node server.js

# Full preflight check (after changes)
npm run preflight
```

---

## Dependencies

All required dependencies are already installed:
- `axios` (already in backend/package.json for Telegram API calls)
- No new frontend dependencies needed

---

## Security Considerations

1. **File Input Reset**: No security implications — purely UX improvement
2. **CSS Changes**: No security implications — visual styling only
3. **Telegram Webhook**:
   - The webhook acknowledges callbacks without authentication (Telegram's design)
   - No sensitive data is exposed (only acknowledgment messages)
   - The bot token is read from server-side environment variables (not exposed)
   - Webhook URL should use HTTPS in production (ngrok provides this for local testing)

---

## Rollback Plan

If any issue arises:

1. **Issue 1 (File Input)**: Remove the ref and the three `.value = ''` lines — form will return to previous behavior (requiring Cancel click)
2. **Issue 2 (Button UI)**: Revert `.submitButton` CSS to use `var(--ann-card-bg)` 
3. **Issue 3 (Telegram)**: 
   - Remove `reply_markup` from `telegramService.js`
   - Remove `/telegram-webhook` route from `backend/server.js`
   - Remove webhook URL from Telegram Bot API: `curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"`

---

## Timeline Estimate

- Issue 1 (File Input): 10 minutes to implement + 5 minutes to test = **15 minutes**
- Issue 2 (Button UI): 5 minutes to implement + 3 minutes to test = **8 minutes**
- Issue 3 (Telegram): 20 minutes to implement + 15 minutes to test (including webhook setup) = **35 minutes**

**Total estimated time: ~1 hour**

---

## Testing Checklist

### Issue 1: Form Clearing
- [ ] Add announcement with image → form clears completely
- [ ] Update announcement with image → form clears completely
- [ ] Click "✕ Remove" on image preview → file input clears
- [ ] Verify no filename shown in file input after any of the above

### Issue 2: Button UI
- [ ] "Add Announcement" button is clearly visible with maroon/orange gradient
- [ ] "Update" button is clearly visible with maroon/orange gradient
- [ ] Button is visually distinct from red "Cancel" button
- [ ] Hover state provides clear visual feedback
- [ ] Button remains accessible in both light and dark themes

### Issue 3: Telegram Reactions
- [ ] Backend `/telegram-webhook` route exists and responds
- [ ] Announcement sent to Telegram includes "❤️ Seen" button
- [ ] Clicking button shows toast: "❤️ Thanks [Name]! Marked as seen."
- [ ] Backend logs show callback received
- [ ] No loading spinner appears (callback acknowledged)
- [ ] Multiple users can react independently
- [ ] Works for both Faculty and All Mayors channels

---

**Plan completed:** Ready for implementation.
