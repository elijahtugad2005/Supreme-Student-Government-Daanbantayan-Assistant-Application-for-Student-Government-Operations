import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpFromLine,
  BookOpen,
  CheckCircle,
  FileSpreadsheet,
  HelpCircle,
  Lock,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import styles from './GoogleSheetsSyncGuideModal.module.css';

const GUIDE_CHAPTERS = [
  {
    id: 'overview',
    num: '01',
    shortTitle: 'How Google Sheets Works',
    hint: 'Big picture & officer roles',
  },
  {
    id: 'setup',
    num: '02',
    shortTitle: 'Connecting & Starting a Sheet',
    hint: 'Create new vs. Google Form',
  },
  {
    id: 'sharing',
    num: '03',
    shortTitle: 'Sharing with Co-Officers',
    hint: 'Adding Editors & Viewers',
  },
  {
    id: 'sync_buttons',
    num: '04',
    shortTitle: 'Which Sync Button to Click',
    hint: 'Pull, Push, & Reconcile',
  },
  {
    id: 'safety_rules',
    num: '05',
    shortTitle: 'Booth Walk-Ins & Money Safety',
    hint: 'Why funds & stock stay safe',
  },
  {
    id: 'faq',
    num: '06',
    shortTitle: 'Common Questions & Fixes',
    hint: 'Popups, access & new events',
  },
];

function GoogleSheetsSyncGuideModal({ isOpen, onClose }) {
  const [pageIndex, setPageIndex] = useState(0);
  const contentPaneRef = useRef(null);

  useEffect(() => {
    if (isOpen && contentPaneRef.current) {
      contentPaneRef.current.scrollTop = 0;
    }
  }, [pageIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight') {
        setPageIndex((prev) => Math.min(GUIDE_CHAPTERS.length - 1, prev + 1));
      } else if (e.key === 'ArrowLeft') {
        setPageIndex((prev) => Math.max(0, prev - 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentChapter = GUIDE_CHAPTERS[pageIndex];
  const isFirst = pageIndex === 0;
  const isLast = pageIndex === GUIDE_CHAPTERS.length - 1;
  const nextChapter = !isLast ? GUIDE_CHAPTERS[pageIndex + 1] : null;

  return (
    <div
      className={styles.backdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Guide in Syncing and How Google Sheets Works"
    >
      <div className={styles.modalShell} onClick={(e) => e.stopPropagation()}>
        {/* Top Header */}
        <div className={styles.topHeader}>
          <div className={styles.headerTitleGroup}>
            <div className={styles.headerIconBadge}>
              <BookOpen size={20} />
            </div>
            <div>
              <span className={styles.headerEyebrow}>
                SSG Commerce Hub • Step-by-Step Officer Handbook
              </span>
              <h3 className={styles.headerMainTitle}>
                Guide in Syncing &amp; How Google Sheets Works
              </h3>
            </div>
          </div>

          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close guide"
          >
            <X size={19} />
          </button>
        </div>

        {/* Body: Left Chapter Rail + Right Content Pane */}
        <div className={styles.bodyLayout}>
          <nav className={styles.chapterRail} aria-label="Guide chapters">
            <span className={styles.railHeading}>Chapters (6 Pages)</span>
            {GUIDE_CHAPTERS.map((chap, idx) => {
              const active = idx === pageIndex;
              return (
                <button
                  key={chap.id}
                  type="button"
                  className={`${styles.chapterBtn} ${active ? styles.chapterBtnActive : ''}`}
                  onClick={() => setPageIndex(idx)}
                >
                  <span className={styles.chapterNum}>{chap.num}</span>
                  <span className={styles.chapterBtnText}>
                    <span className={styles.chapterBtnTitle}>{chap.shortTitle}</span>
                    <span className={styles.chapterBtnHint}>{chap.hint}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className={styles.contentPane} ref={contentPaneRef}>
            {/* ==============================================================
                PAGE 1: BIG PICTURE — HOW GOOGLE SHEETS WORKS
               ============================================================== */}
            {currentChapter.id === 'overview' && (
              <>
                <div className={styles.pageHeader}>
                  <span className={styles.pageStepTag}>Page 1 of 6 • The Big Picture</span>
                  <h4 className={styles.pageTitle}>
                    How Google Sheets &amp; Commerce Hub Work Together
                  </h4>
                  <p className={styles.pageLead}>
                    Think of <strong>Google Sheets</strong> as your shared campus{' '}
                    <strong>Order Logbook</strong> (where booth volunteers type walk-ins or Google Forms collect responses), and <strong>Commerce Hub</strong> as the{' '}
                    <strong>Official SSG Cashier &amp; Inventory Counter</strong>.
                  </p>
                </div>

                <div className={styles.flowStrip}>
                  <div className={styles.flowStep}>
                    <div className={styles.flowStepHeader}>
                      <FileSpreadsheet size={17} />
                      1. Google Sheet Logbook
                    </div>
                    <p className={styles.flowStepBody}>
                      Used by booth tables or Google Forms to list student names, sizes, programs, and merchandise orders quickly.
                    </p>
                  </div>

                  <div className={styles.flowStep}>
                    <div className={styles.flowStepHeader}>
                      <ArrowLeftRight size={17} />
                      2. Secretariat Sync
                    </div>
                    <p className={styles.flowStepBody}>
                      An SSG Secretary clicks Sync to copy new sheet orders into the app—and send latest claimed statuses back to the sheet.
                    </p>
                  </div>

                  <div className={styles.flowStep}>
                    <div className={styles.flowStepHeader}>
                      <ShieldCheck size={17} />
                      3. Commerce Hub Counter
                    </div>
                    <p className={styles.flowStepBody}>
                      When students pay or claim their item in person, officers click <strong>Claim</strong> here to count stock and record IGF funds.
                    </p>
                  </div>
                </div>

                <h5 className={styles.sectionTitle}>Who Can Use This Feature?</h5>
                <div className={styles.twoColCompare}>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagGreen}`}>
                      <ShieldCheck size={13} /> Full Sync Authority
                    </span>
                    <h6 className={styles.compareTitle}>SSG Secretaries</h6>
                    <p className={styles.compareDesc}>
                      The <strong>General, Executive, Deputy, Press, Linkages, and Finance Secretaries</strong> are the official record keepers. Only they can connect Google, create or change the master sheet, and click the Sync buttons.
                    </p>
                  </div>

                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagAmber}`}>
                      <Lock size={13} /> View-Only Access
                    </span>
                    <h6 className={styles.compareTitle}>
                      President, VP, Senators, Reps &amp; Audit
                    </h6>
                    <p className={styles.compareDesc}>
                      Can click <strong>Open Centralized Google Sheet</strong> anytime to inspect or print the master list, while sync buttons stay locked so nobody accidentally overwrites records.
                    </p>
                  </div>
                </div>

                <div className={styles.tipBanner}>
                  <CheckCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Only for Merchandise Orders:</strong> Google Sheet Sync connects strictly to the <strong>Orders</strong> table. Product prices, stock counts, and IGF money balances remain safely managed inside the app.
                  </div>
                </div>
              </>
            )}

            {/* ==============================================================
                PAGE 2: CONNECTING GOOGLE & STARTING YOUR OFFICIAL SHEET
               ============================================================== */}
            {currentChapter.id === 'setup' && (
              <>
                <div className={styles.pageHeader}>
                  <span className={styles.pageStepTag}>Page 2 of 6 • First-Time Setup</span>
                  <h4 className={styles.pageTitle}>
                    Connecting Your Account &amp; Setting Up the Sheet
                  </h4>
                  <p className={styles.pageLead}>
                    An SSG Secretary only needs to set up the official Google Sheet once per semester or merchandise project. Everyone else will immediately see it!
                  </p>
                </div>

                <div className={styles.stepList}>
                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>1</span>
                    <div className={styles.stepRowBody}>
                      <strong>Click &ldquo;Connect Google Account&rdquo; at the top-right</strong>
                      <span>
                        A Google sign-in window will open. Pick your Gmail or CTU email address and click <strong>Allow / Continue</strong> so Commerce Hub can read and update your Google Sheet.
                      </span>
                    </div>
                  </div>

                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>2</span>
                    <div className={styles.stepRowBody}>
                      <strong>Choose Option A or Option B depending on your situation:</strong>
                      <span>
                        You can either let Commerce Hub build a brand-new, pre-formatted Google Sheet for you, or connect a Google Sheet you already have.
                      </span>
                    </div>
                  </div>
                </div>

                <div className={styles.twoColCompare}>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagBlue}`}>Option A • Easiest</span>
                    <h6 className={styles.compareTitle}>Create New Commerce Hub Template</h6>
                    <p className={styles.compareDesc}>
                      Type a title (for example, <em>&ldquo;CTU Lanyard Orders — 1st Sem&rdquo;</em>) and choose:
                      <br />• <strong>Pre-filled:</strong> Copies all current orders into the new sheet right away.
                      <br />• <strong>Blank Template:</strong> Creates an empty 18-column table with ready-to-click dropdown menus for <em>Status</em> and <em>Payment</em>.
                    </p>
                  </div>

                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagGreen}`}>
                      Option B • Best for Google Forms
                    </span>
                    <h6 className={styles.compareTitle}>Assign Existing Google Sheet</h6>
                    <p className={styles.compareDesc}>
                      Already collecting uniform or lanyard pre-orders with a <strong>Google Form</strong>? Paste your Google Sheet link, click <strong>Load Worksheet Tabs</strong>, and select your tab (like <em>Form Responses 1</em>). The app matches your columns automatically without erasing your Form questions!
                    </p>
                  </div>
                </div>

                <div className={styles.cautionBanner}>
                  <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Using a Shared SSG Office Laptop?</strong> Your Google connection automatically expires after about an hour, or you can click <strong>Disconnect</strong> before ending your shift so the next Secretary can sign in with their own Google account.
                  </div>
                </div>
              </>
            )}

            {/* ==============================================================
                PAGE 3: SHARING THE GOOGLE SHEET WITH CO-OFFICERS
               ============================================================== */}
            {currentChapter.id === 'sharing' && (
              <>
                <div className={styles.pageHeader}>
                  <span className={styles.pageStepTag}>Page 3 of 6 • Team Collaboration</span>
                  <h4 className={styles.pageTitle}>
                    How to Add Co-Secretaries, Booth Volunteers &amp; Viewers
                  </h4>
                  <p className={styles.pageLead}>
                    You don&apos;t need any special settings inside the app to share the sheet—you control access directly inside Google Sheets using its normal <strong>Share</strong> button, just like a group class report!
                  </p>
                </div>

                <div className={styles.stepList}>
                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>1</span>
                    <div className={styles.stepRowBody}>
                      <strong>Open the Sheet from Commerce Hub</strong>
                      <span>
                        Click the <strong>Open in Google Sheets</strong> button on the Centralized Sheet card.
                      </span>
                    </div>
                  </div>

                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>2</span>
                    <div className={styles.stepRowBody}>
                      <strong>Click the &ldquo;Share&rdquo; Button in Google Sheets (Top-Right Corner)</strong>
                      <span>
                        Type the Gmail or CTU email addresses of the officers or classmates you want to invite.
                      </span>
                    </div>
                  </div>

                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>3</span>
                    <div className={styles.stepRowBody}>
                      <strong>Pick the Right Permission Level Before Clicking Send</strong>
                      <span>
                        Choose <strong>Editor</strong> for people who will type orders or sync, and <strong>Viewer</strong> for people who only need to read.
                      </span>
                    </div>
                  </div>
                </div>

                <div className={styles.twoColCompare}>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagGreen}`}>
                      <Users size={13} /> Give &ldquo;Editor&rdquo; To
                    </span>
                    <h6 className={styles.compareTitle}>
                      Fellow SSG Secretaries &amp; Booth Encoders
                    </h6>
                    <p className={styles.compareDesc}>
                      Fellow Secretaries <strong>must be Editors</strong> on the Google Sheet so that when they log in on their own laptop, Commerce Hub can read and update the same sheet seamlessly.
                    </p>
                  </div>

                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagBlue}`}>
                      Give &ldquo;Viewer&rdquo; To
                    </span>
                    <h6 className={styles.compareTitle}>
                      Advisers, Auditors, Senators &amp; Department Reps
                    </h6>
                    <p className={styles.compareDesc}>
                      Lets them view, search, filter, or print the order list anytime without risking accidental edits or deleted cells.
                    </p>
                  </div>
                </div>

                <div className={styles.tipBanner}>
                  <CheckCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>What if another Secretary sees &ldquo;Editor Access Required&rdquo;?</strong> Commerce Hub will show the exact name and email of the Secretary who created the sheet, plus a one-click <strong>Request Access in Sheet</strong> button!
                  </div>
                </div>
              </>
            )}

            {/* ==============================================================
                PAGE 4: WHICH SYNC BUTTON SHOULD I CLICK?
               ============================================================== */}
            {currentChapter.id === 'sync_buttons' && (
              <>
                <div className={styles.pageHeader}>
                  <span className={styles.pageStepTag}>Page 4 of 6 • Everyday Syncing</span>
                  <h4 className={styles.pageTitle}>
                    Understanding the 3 Sync Buttons (Which One Do I Click?)
                  </h4>
                  <p className={styles.pageLead}>
                    Google Sheets does not overwrite the app behind your back—nothing moves until a Secretary clicks one of these buttons. Here is when to use each one:
                  </p>
                </div>

                <div className={styles.stepList}>
                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>
                      <ArrowDownToLine size={14} />
                    </span>
                    <div className={styles.stepRowBody}>
                      <strong>Pull Sheet → App (Preview) — &ldquo;Bring Sheet Orders Into the App&rdquo;</strong>
                      <span>
                        <strong>Use when:</strong> Booth volunteers typed new walk-in buyers in Google Sheets, or new Google Form responses arrived.
                        <br />
                        <strong>What happens:</strong> Shows a safe <strong>Preview Screen</strong> first so you can review how many new orders will be added before clicking <strong>Commit Pull</strong>.
                      </span>
                    </div>
                  </div>

                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>
                      <ArrowUpFromLine size={14} />
                    </span>
                    <div className={styles.stepRowBody}>
                      <strong>Push App → Sheet — &ldquo;Update Google Sheet from the App&rdquo;</strong>
                      <span>
                        <strong>Use when:</strong> Officers claimed items in Commerce Hub, or students placed orders on the website, and you want the Google Sheet updated.
                        <br />
                        <strong>What happens:</strong> Updates matching Order IDs in Google Sheets (marking them <em>Claimed</em> and <em>IGF Synced</em>) and adds any website orders not yet on the sheet.
                      </span>
                    </div>
                  </div>

                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>
                      <ArrowLeftRight size={14} />
                    </span>
                    <div className={styles.stepRowBody}>
                      <strong>
                        Two-Way Reconcile — &ldquo;Best All-in-One Button at End of Shift&rdquo;
                      </strong>
                      <span>
                        <strong>Use when:</strong> Both the Google Sheet (walk-ins) <em>and</em> Commerce Hub (claimed pickups) were used during the day!
                        <br />
                        <strong>What happens:</strong> Imports new walk-ins into the app, writes their newly generated <span className={styles.inlinePill}>ORD-DB-####</span> IDs back into Google Sheets so they never duplicate, and updates claimed statuses on both sides!
                      </span>
                    </div>
                  </div>
                </div>

                <div className={styles.tipBanner}>
                  <CheckCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Optional Shortcut — &ldquo;Auto-Push row when claiming order&rdquo;:</strong> Check this box during claiming hours! While your Google account is connected, every time you click <strong>Claim</strong> on an order in Commerce Hub, its row in Google Sheets updates automatically.
                  </div>
                </div>
              </>
            )}

            {/* ==============================================================
                PAGE 5: BOOTH WALK-INS, MONEY & STOCK SAFETY RULES
               ============================================================== */}
            {currentChapter.id === 'safety_rules' && (
              <>
                <div className={styles.pageHeader}>
                  <span className={styles.pageStepTag}>Page 5 of 6 • Built-In Safety Protections</span>
                  <h4 className={styles.pageTitle}>
                    How Walk-In IDs, IGF Money &amp; Product Stock Stay Protected
                  </h4>
                  <p className={styles.pageLead}>
                    Don&apos;t worry about accidental typos in Google Sheets! Commerce Hub has four automatic guardrails that protect official SSG funds and merchandise inventory.
                  </p>
                </div>

                <div className={styles.stepList}>
                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>1</span>
                    <div className={styles.stepRowBody}>
                      <strong>Leave &ldquo;Order ID&rdquo; Blank for New Walk-In Buyers</strong>
                      <span>
                        Booth encoders should leave the first column (<span className={styles.inlinePill}>Order ID</span>) empty when typing a new student&apos;s order. When you click <strong>Two-Way Reconcile</strong>, the app automatically assigns the next official ID (like <span className={styles.inlinePill}>ORD-DB-0018</span>) and fills it into the Google Sheet for you!
                      </span>
                    </div>
                  </div>

                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>2</span>
                    <div className={styles.stepRowBody}>
                      <strong>Google Sheets Never Moves Money or Deducts Stock</strong>
                      <span>
                        Google Sheets is strictly for <strong>recording orders</strong>. Even if someone types <em>&ldquo;Claimed&rdquo;</em> or <em>&ldquo;IGF Synced&rdquo;</em> inside Google Sheets, it will <strong>never</strong> add money to the IGF Fund or subtract product stock. Official claiming always happens inside <strong>Commerce Hub → Orders</strong>.
                      </span>
                    </div>
                  </div>

                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>3</span>
                    <div className={styles.stepRowBody}>
                      <strong>Claimed &amp; Paid Orders Are Locked Against Sheet Mistakes</strong>
                      <span>
                        Once a student&apos;s order is officially marked <strong>Claimed</strong> or <strong>Online Paid</strong> in Commerce Hub, it becomes protected. If someone accidentally edits that row back to <em>&ldquo;Pending&rdquo;</em> in Google Sheets, Commerce Hub blocks the mistake and restores the true <em>Claimed</em> status!
                      </span>
                    </div>
                  </div>

                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>4</span>
                    <div className={styles.stepRowBody}>
                      <strong>Erasing a Row in Google Sheets Never Deletes App Orders</strong>
                      <span>
                        If a volunteer accidentally deletes a row in Google Sheets, the order inside Commerce Hub stays 100% intact—and clicking <strong>Push App → Sheet</strong> will restore the missing row back onto the sheet!
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ==============================================================
                PAGE 6: COMMON QUESTIONS & TROUBLESHOOTING (FAQ)
               ============================================================== */}
            {currentChapter.id === 'faq' && (
              <>
                <div className={styles.pageHeader}>
                  <span className={styles.pageStepTag}>Page 6 of 6 • Quick Help &amp; FAQ</span>
                  <h4 className={styles.pageTitle}>
                    Common Questions &amp; Easy Fixes During Booth Days
                  </h4>
                  <p className={styles.pageLead}>
                    If something unexpected pops up during an event, check these quick answers:
                  </p>
                </div>

                <div className={styles.stepList}>
                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>
                      <HelpCircle size={15} />
                    </span>
                    <div className={styles.stepRowBody}>
                      <strong>
                        &ldquo;I clicked Connect Google Account, and nothing appeared!&rdquo;
                      </strong>
                      <span>
                        Your web browser likely blocked the popup window. Look at the right corner of your browser&apos;s address bar for a small blocked-window icon, click <strong>Always allow popups</strong>, and click <strong>Connect Google Account</strong> again.
                      </span>
                    </div>
                  </div>

                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>
                      <HelpCircle size={15} />
                    </span>
                    <div className={styles.stepRowBody}>
                      <strong>
                        &ldquo;Google showed Error 403 / Access Denied!&rdquo;
                      </strong>
                      <span>
                        • <strong>If it happened inside Google&apos;s sign-in window</strong> (saying <em>&ldquo;App is currently being tested&rdquo;</em>): Send your Gmail/CTU email to the SSG System Admin so they can add you to the approved testers list.
                        <br />• <strong>If it happened inside Commerce Hub</strong> (showing a Secretary&apos;s name): Ask that Secretary to open the Google Sheet, click <strong>Share</strong>, and add your email as an <strong>Editor</strong>.
                      </span>
                    </div>
                  </div>

                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>
                      <HelpCircle size={15} />
                    </span>
                    <div className={styles.stepRowBody}>
                      <strong>
                        &ldquo;Can multiple volunteers type walk-ins in Google Sheets at the same time?&rdquo;
                      </strong>
                      <span>
                        Yes! Just have each volunteer type on a separate empty row and leave <span className={styles.inlinePill}>Order ID</span> blank. When the Secretary clicks <strong>Two-Way Reconcile</strong>, every row receives its own unique <span className={styles.inlinePill}>ORD-DB-####</span> number cleanly.
                      </span>
                    </div>
                  </div>

                  <div className={styles.stepRow}>
                    <span className={styles.stepBadge}>
                      <HelpCircle size={15} />
                    </span>
                    <div className={styles.stepRowBody}>
                      <strong>
                        &ldquo;How do we switch to a fresh Google Sheet for a new event or semester?&rdquo;
                      </strong>
                      <span>
                        Click <strong>Reassign / Change Sheet</strong> and create or link your new sheet. Your old Google Sheet is never deleted—it stays safely in Google Drive and remains accessible anytime under the <strong>History</strong> button!
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Sticky Bottom Pagination Controls */}
        <div className={styles.bottomFooter}>
          <div className={styles.pageDotsWrap}>
            <span className={styles.pageCounterText}>
              Page {pageIndex + 1} of {GUIDE_CHAPTERS.length}
            </span>
            {GUIDE_CHAPTERS.map((chap, idx) => (
              <button
                key={chap.id}
                type="button"
                className={`${styles.pageDot} ${idx === pageIndex ? styles.pageDotActive : ''}`}
                onClick={() => setPageIndex(idx)}
                aria-label={`Go to page ${idx + 1}: ${chap.shortTitle}`}
              />
            ))}
          </div>

          <div className={styles.navBtnRow}>
            <button
              type="button"
              className={styles.navBtnSecondary}
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              disabled={isFirst}
            >
              <ArrowLeft size={15} />
              Previous
            </button>

            {isLast ? (
              <button type="button" className={styles.navBtnPrimary} onClick={onClose}>
                <CheckCircle size={15} />
                Done Reading
              </button>
            ) : (
              <button
                type="button"
                className={styles.navBtnPrimary}
                onClick={() => setPageIndex((p) => Math.min(GUIDE_CHAPTERS.length - 1, p + 1))}
              >
                Next: {nextChapter.shortTitle}
                <ArrowRight size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GoogleSheetsSyncGuideModal;

