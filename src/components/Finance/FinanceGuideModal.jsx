import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle,
  ClipboardList,
  Coins,
  FileSpreadsheet,
  HelpCircle,
  Landmark,
  Lock,
  PackageCheck,
  ShieldCheck,
  Store,
  Wallet,
  X,
} from 'lucide-react';
// Shares the look and feel of the Google Sheets Sync guide so both handbooks feel the same.
import styles from '../Data/GoogleSheetsSyncGuideModal.module.css';

const GUIDE_CHAPTERS = [
  { id: 'overview', num: '01', shortTitle: 'The Four SSG Funds', hint: 'Big picture & where money lives' },
  { id: 'ledger', num: '02', shortTitle: 'Fund Accounts & Ledger', hint: 'Balances, posting & reversals' },
  { id: 'allocations', num: '03', shortTitle: 'Budget Allocations', hint: 'Earmarking money for activities' },
  { id: 'ppmp', num: '04', shortTitle: 'PPMP Procurement Matrix', hint: 'Fresh, Partially Used, Depleted' },
  { id: 'igp', num: '05', shortTitle: 'IGP: Lockers & Vendo', hint: 'Campus income projects' },
  { id: 'batches', num: '06', shortTitle: 'Pre-Order Batches', hint: 'From collection to audit clearance' },
  { id: 'reports', num: '07', shortTitle: 'Reports & Google Sheets', hint: 'Exporting the fiscal package' },
  { id: 'safety', num: '08', shortTitle: 'Who Can Do What & FAQ', hint: 'Roles, safety rules & fixes' },
];

const TOTAL = GUIDE_CHAPTERS.length;

function Step({ n, title, children }) {
  return (
    <div className={styles.stepRow}>
      <span className={styles.stepBadge}>{n}</span>
      <div className={styles.stepRowBody}>
        <strong>{title}</strong>
        <span>{children}</span>
      </div>
    </div>
  );
}

function Faq({ q, children }) {
  return (
    <div className={styles.stepRow}>
      <span className={styles.stepBadge}>
        <HelpCircle size={15} />
      </span>
      <div className={styles.stepRowBody}>
        <strong>{q}</strong>
        <span>{children}</span>
      </div>
    </div>
  );
}

function PageHeader({ index, tag, title, children }) {
  return (
    <div className={styles.pageHeader}>
      <span className={styles.pageStepTag}>
        Page {index} of {TOTAL} • {tag}
      </span>
      <h4 className={styles.pageTitle}>{title}</h4>
      <p className={styles.pageLead}>{children}</p>
    </div>
  );
}

function FinanceGuideModal({ isOpen, onClose }) {
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
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setPageIndex((p) => Math.min(TOTAL - 1, p + 1));
      else if (e.key === 'ArrowLeft') setPageIndex((p) => Math.max(0, p - 1));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const current = GUIDE_CHAPTERS[pageIndex];
  const isFirst = pageIndex === 0;
  const isLast = pageIndex === TOTAL - 1;
  const nextChapter = !isLast ? GUIDE_CHAPTERS[pageIndex + 1] : null;
  const pageNo = pageIndex + 1;

  return (
    <div
      className={styles.backdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Finance Handbook: How the SSG Funds and Features Work"
    >
      <div className={styles.modalShell} onClick={(e) => e.stopPropagation()}>
        <div className={styles.topHeader}>
          <div className={styles.headerTitleGroup}>
            <div className={styles.headerIconBadge}>
              <BookOpen size={20} />
            </div>
            <div>
              <span className={styles.headerEyebrow}>
                SSG Treasury &amp; Fiscal Governance • Step-by-Step Officer Handbook
              </span>
              <h3 className={styles.headerMainTitle}>Finance Handbook: How Every Fund &amp; Feature Works</h3>
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close guide">
            <X size={19} />
          </button>
        </div>

        <div className={styles.bodyLayout}>
          <nav className={styles.chapterRail} aria-label="Guide chapters">
            <span className={styles.railHeading}>Chapters ({TOTAL} Pages)</span>
            {GUIDE_CHAPTERS.map((chap, idx) => (
              <button
                key={chap.id}
                type="button"
                className={`${styles.chapterBtn} ${idx === pageIndex ? styles.chapterBtnActive : ''}`}
                onClick={() => setPageIndex(idx)}
              >
                <span className={styles.chapterNum}>{chap.num}</span>
                <span className={styles.chapterBtnText}>
                  <span className={styles.chapterBtnTitle}>{chap.shortTitle}</span>
                  <span className={styles.chapterBtnHint}>{chap.hint}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className={styles.contentPane} ref={contentPaneRef}>
            {/* PAGE 1 — THE FOUR FUNDS */}
            {current.id === 'overview' && (
              <>
                <PageHeader index={pageNo} tag="The Big Picture" title="The Four SSG Funds at a Glance">
                  Every peso the SSG handles belongs to exactly one of <strong>four funds</strong>. Think of them as four
                  separate envelopes: each has its own source, its own rules, and its own balance, so money never gets mixed up.
                </PageHeader>

                <div className={styles.twoColCompare}>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagBlue}`}>
                      <Landmark size={13} /> Fund 1
                    </span>
                    <h6 className={styles.compareTitle}>Fiscal Year Budget</h6>
                    <p className={styles.compareDesc}>
                      The official annual budget given to the SSG by the university for the active term. It sits under an
                      approved <strong>University Fiscal Appropriation</strong> and is the main source for planned projects
                      in the PPMP.
                    </p>
                  </div>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagBlue}`}>
                      <Landmark size={13} /> Fund 2
                    </span>
                    <h6 className={styles.compareTitle}>FSG Remittance</h6>
                    <p className={styles.compareDesc}>
                      Extra funding received from the <strong>Federation of Student Governments</strong>. It acts as a backup
                      pool for approved activities and can also be planned in the PPMP.
                    </p>
                  </div>
                </div>

                <div className={styles.twoColCompare}>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagGreen}`}>
                      <Coins size={13} /> Fund 3
                    </span>
                    <h6 className={styles.compareTitle}>Income Generated Funds (IGF)</h6>
                    <p className={styles.compareDesc}>
                      Money the SSG earns from its own activities, mainly <strong>merchandise, uniforms and pre-order
                      sales</strong>. It is flexible money used for officer consumables and student pre-order purchases.
                    </p>
                  </div>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagGreen}`}>
                      <Store size={13} /> Fund 4
                    </span>
                    <h6 className={styles.compareTitle}>Income-Generating Projects (IGP)</h6>
                    <p className={styles.compareDesc}>
                      Self-sustaining campus projects such as <strong>campus lockers and the vending machine</strong>. Their
                      collections are kept in their own ledger so project income stays traceable.
                    </p>
                  </div>
                </div>

                <h5 className={styles.sectionTitle}>The Six Tabs of the Financial Control Center</h5>
                <div className={styles.stepList}>
                  <Step n="1" title="Funds & Ledger">Balances, allocations, posting expenses and the permanent ledger.</Step>
                  <Step n="2" title="IGP Projects">Locker rentals, vending collections and custom project income.</Step>
                  <Step n="3" title="PPMP Matrix">The year-long procurement plan and what has been used.</Step>
                  <Step n="4" title="Pre-Order Batches">Merchandise runs, from student payments to audit clearance.</Step>
                  <Step n="5" title="Analytics">Charts and breakdowns of how budgets are being used.</Step>
                  <Step n="6" title="Reports & Sheets">Export the full fiscal package to Google Sheets.</Step>
                </div>

                <div className={styles.tipBanner}>
                  <CheckCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>All amounts are stored in whole centavos.</strong> The system never does decimal peso math, so
                    totals never drift by a centavo, no matter how many entries are added.
                  </div>
                </div>
              </>
            )}

            {/* PAGE 2 — LEDGER */}
            {current.id === 'ledger' && (
              <>
                <PageHeader index={pageNo} tag="Core Records" title="Fund Accounts & the Append-Only Ledger">
                  The <strong>Funds &amp; Ledger</strong> tab is the SSG&apos;s official cash book. Fund cards show what each
                  envelope holds, and the ledger below records every movement of money.
                </PageHeader>

                <h5 className={styles.sectionTitle}>What the Ledger Records</h5>
                <div className={styles.stepList}>
                  <Step n="1" title="Receipts & Collections">Money coming in, such as student payments or project income.</Step>
                  <Step n="2" title="Expenses & Payments">Money going out for approved activities or suppliers.</Step>
                  <Step n="3" title="Refunds & Transfers">Money returned to a student or moved between funds.</Step>
                  <Step n="4" title="Reversals & Adjustments">Corrections that cancel an earlier entry, explained below.</Step>
                </div>

                <h5 className={styles.sectionTitle}>Why It Is Called &ldquo;Append-Only&rdquo;</h5>
                <div className={styles.twoColCompare}>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagGreen}`}>
                      <ShieldCheck size={13} /> What you CAN do
                    </span>
                    <h6 className={styles.compareTitle}>Add a Reversal</h6>
                    <p className={styles.compareDesc}>
                      Made a mistake on a posted entry? Click <strong>Reverse</strong> and type a <strong>reason</strong>. The
                      system adds a new linked entry that cancels the old one. Both stay visible, so the history is honest.
                    </p>
                  </div>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagAmber}`}>
                      <Lock size={13} /> What you CANNOT do
                    </span>
                    <h6 className={styles.compareTitle}>Edit or Erase Posted Entries</h6>
                    <p className={styles.compareDesc}>
                      Once an entry is <strong>posted</strong>, it can never be changed or deleted. Only drafts and incomplete
                      entries can still be edited.
                    </p>
                  </div>
                </div>

                <h5 className={styles.sectionTitle}>Entry Status Cheat Sheet</h5>
                <div className={styles.stepList}>
                  <Step n="•" title="Draft / Incomplete">Still being prepared. Does not touch any balance yet.</Step>
                  <Step n="•" title="Pending Review / Pending Approval">Waiting for the right officer to check it.</Step>
                  <Step n="•" title="Approved → Posted">Officially counted in the fund balance.</Step>
                  <Step n="•" title="Rejected / Reversed">Not counted, or cancelled by a linked reversal.</Step>
                </div>

                <div className={styles.tipBanner}>
                  <CheckCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Bank Calibration:</strong> If the real bank balance differs from the app, authorized officers can
                    use <strong>Edit Fund Balance</strong> to align it, but only with a written reason for the record.
                  </div>
                </div>
              </>
            )}

            {/* PAGE 3 — ALLOCATIONS */}
            {current.id === 'allocations' && (
              <>
                <PageHeader index={pageNo} tag="Planning Money" title="Budget Allocations & Posting Expenses">
                  A <strong>Budget Allocation</strong> is money set aside for one approved activity, event or resolution. It
                  tells everyone how much may be spent, and on what.
                </PageHeader>

                <div className={styles.stepList}>
                  <Step n="1" title="Create the allocation">
                    Choose the funding source (Fiscal Year Budget or FSG Remittance), name the activity, set the amount and
                    list the itemized costs.
                  </Step>
                  <Step n="2" title="Get it approved">
                    A <strong>draft</strong> allocation cannot be used yet. Once approved, it becomes active and appears in the
                    Authorized Budget Allocations table.
                  </Step>
                  <Step n="3" title="Post expenses against it">
                    Click <strong>Post Expense</strong> on the allocation, enter the purpose, amount and receipt details, then
                    confirm. The spent amount and remaining balance update immediately.
                  </Step>
                  <Step n="4" title="Watch the remaining balance">
                    Each allocation shows its spent amount and what is left, so officers see at a glance whether there is room.
                  </Step>
                </div>

                <h5 className={styles.sectionTitle}>Common Expense Purposes</h5>
                <div className={styles.twoColCompare}>
                  <div className={styles.compareBox}>
                    <h6 className={styles.compareTitle}>Planned Spending</h6>
                    <p className={styles.compareDesc}>
                      Event preparation consumables, event itemized expenses, project operating expenses and resolution
                      disbursements.
                    </p>
                  </div>
                  <div className={styles.compareBox}>
                    <h6 className={styles.compareTitle}>Merchandise & Others</h6>
                    <p className={styles.compareDesc}>
                      Merchandise expenses, refunds, collections, transfers between funds, and other approved items.
                    </p>
                  </div>
                </div>

                <div className={styles.cautionBanner}>
                  <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>PPMP Overspending Advisory:</strong> If an expense would go past what the PPMP planned, the system
                    shows an advisory so officers see the overspend before confirming. Review it carefully and consult the
                    Auditor before going ahead.
                  </div>
                </div>

                <div className={styles.tipBanner}>
                  <CheckCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Changing an allocation:</strong> Edits keep a revision history, and allocations that are no longer
                    needed can be <strong>archived</strong> and later restored.
                  </div>
                </div>
              </>
            )}

            {/* PAGE 4 — PPMP */}
            {current.id === 'ppmp' && (
              <>
                <PageHeader index={pageNo} tag="Year-Long Plan" title="The PPMP Procurement Matrix">
                  The <strong>Project Procurement Management Plan (PPMP)</strong> is the SSG&apos;s master shopping and spending
                  plan for the whole term. It lists everything planned, and tracks how much of each plan has actually been used.
                </PageHeader>

                <div className={styles.twoColCompare}>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagGreen}`}>
                      <ShieldCheck size={13} /> Allowed Pools
                    </span>
                    <h6 className={styles.compareTitle}>Fiscal Budget & FSG Remittance</h6>
                    <p className={styles.compareDesc}>
                      Use the <strong>funding pool selector</strong> to view the Fiscal Budget, the FSG pool, or both together.
                    </p>
                  </div>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagAmber}`}>
                      <Lock size={13} /> Not Included
                    </span>
                    <h6 className={styles.compareTitle}>IGF & IGP</h6>
                    <p className={styles.compareDesc}>
                      By policy, the PPMP only covers the two appropriated pools. Income funds are handled through their own
                      tabs.
                    </p>
                  </div>
                </div>

                <h5 className={styles.sectionTitle}>The Three Status Colors</h5>
                <div className={styles.stepList}>
                  <Step n="1" title="Fresh">Planned but untouched. No money has been released yet.</Step>
                  <Step n="2" title="Partially Used">Spending has started. Some of the plan is already used.</Step>
                  <Step n="3" title="Depleted">Fully used up to the planned amount.</Step>
                </div>

                <h5 className={styles.sectionTitle}>How to Use the Matrix</h5>
                <div className={styles.stepList}>
                  <Step n="1" title="Filter">Use the status chips (All, Fresh, Partially Used, Depleted, Archived) and the search box.</Step>
                  <Step n="2" title="Browse by category">Switch category tabs to see events, projects and administrative items.</Step>
                  <Step n="3" title="Inspect an item">Open an item to see its itemized cost breakdown and spending so far.</Step>
                </div>
              </>
            )}

            {/* PAGE 5 — IGP */}
            {current.id === 'igp' && (
              <>
                <PageHeader index={pageNo} tag="Campus Income" title="IGP: Campus Lockers, Vendo & Custom Projects">
                  The <strong>IGP Projects</strong> tab records money earned from campus projects. Every collection is added to
                  the IGP fund automatically.
                </PageHeader>

                <h5 className={styles.sectionTitle}>Campus Lockers (30 Units)</h5>
                <div className={styles.stepList}>
                  <Step n="1" title="Pick a locker">
                    There are 15 units in the <strong>HM Building</strong> and 15 in the <strong>Education Building</strong>.
                    Green means available, red means occupied.
                  </Step>
                  <Step n="2" title="Rent it out">
                    Enter the renter&apos;s name, student ID, program, months and the <strong>Assisting Officer</strong>. The
                    rate is ₱100 per month and the expiry date is worked out for you.
                  </Step>
                  <Step n="3" title="Vacate when done">
                    Releasing a locker returns it to available and keeps the previous lease in its history.
                  </Step>
                </div>

                <h5 className={styles.sectionTitle}>Vending Machine & Custom Projects</h5>
                <div className={styles.stepList}>
                  <Step n="1" title="Log Vendo Collection">
                    After emptying the coin box, enter the amount, the building and spot, and <strong>Collected By</strong>{' '}
                    (the officer who counted it).
                  </Step>
                  <Step n="2" title="Add Custom IGP Revenue">
                    Use this for any new student venture, like printing or booth sales, by naming the project and amount.
                  </Step>
                </div>

                <div className={styles.cautionBanner}>
                  <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Entered the wrong amount?</strong> Finance officers can click <strong>Delete</strong> on the
                    collection and type a reason. The exact amount is taken back out of the IGP fund and the deletion is
                    written to the audit log, so the balance always stays correct.
                  </div>
                </div>
              </>
            )}

            {/* PAGE 6 — BATCHES */}
            {current.id === 'batches' && (
              <>
                <PageHeader index={pageNo} tag="Merchandise Runs" title="Pre-Order Batches: From Collection to Audit">
                  A <strong>Pre-Order Batch</strong> follows one merchandise run, such as a lanyard or shirt order, through eight
                  stages, with a checkpoint at the end so every peso is accounted for.
                </PageHeader>

                <div className={styles.stepList}>
                  <Step n="1" title="Open for Pre-Orders">Students place and pay for their orders.</Step>
                  <Step n="2" title="Collection Closed">No more orders. Totals are locked in.</Step>
                  <Step n="3" title="Supplier Quoted">The supplier&apos;s price is recorded and checked against collections.</Step>
                  <Step n="4" title="Supplier Paid">Payment is released. It needs <strong>two officers</strong> to approve.</Step>
                  <Step n="5" title="Received from Supplier">The items arrive and are counted.</Step>
                  <Step n="6" title="Distributing Items">Students claim their items.</Step>
                  <Step n="7" title="Pending Audit Clearance">The Audit Secretary reconciles payments, receipts and claims.</Step>
                  <Step n="8" title="Audit Cleared">Everything matches and the batch is closed.</Step>
                </div>

                <div className={styles.tipBanner}>
                  <CheckCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Orders and income connect:</strong> Merchandise order revenue feeds the IGF fund, and inventory
                    purchases can be charged to either IGF or IGP, with a balance check before money is taken.
                  </div>
                </div>
              </>
            )}

            {/* PAGE 7 — REPORTS */}
            {current.id === 'reports' && (
              <>
                <PageHeader index={pageNo} tag="Sharing the Numbers" title="Reports & Google Sheets Export">
                  The <strong>Reports &amp; Sheets</strong> tab turns the live finance data into a Google Sheets workbook that
                  can be printed, shared or attached to a report.
                </PageHeader>

                <div className={styles.flowStrip}>
                  <div className={styles.flowStep}>
                    <div className={styles.flowStepHeader}>
                      <Wallet size={17} /> 1. Live Finance Data
                    </div>
                    <p className={styles.flowStepBody}>Funds, allocations and ledger entries as they are right now.</p>
                  </div>
                  <div className={styles.flowStep}>
                    <div className={styles.flowStepHeader}>
                      <FileSpreadsheet size={17} /> 2. Export
                    </div>
                    <p className={styles.flowStepBody}>An officer clicks export and signs in with Google.</p>
                  </div>
                  <div className={styles.flowStep}>
                    <div className={styles.flowStepHeader}>
                      <ClipboardList size={17} /> 3. Formatted Workbook
                    </div>
                    <p className={styles.flowStepBody}>A styled, ready-to-share spreadsheet appears in Google Drive.</p>
                  </div>
                </div>

                <h5 className={styles.sectionTitle}>The Four Sheets Inside</h5>
                <div className={styles.stepList}>
                  <Step n="1" title="Summary KPIs">Headline totals for the fiscal picture.</Step>
                  <Step n="2" title="General Ledger">Every posted entry, with dates in a clean year-month-day format.</Step>
                  <Step n="3" title="Approved Allocations">Each allocation, what was spent and what remains.</Step>
                  <Step n="4" title="Holding Funds">The balances of the four funds.</Step>
                </div>

                <div className={styles.cautionBanner}>
                  <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>An export is a snapshot.</strong> Editing the spreadsheet does not change anything in the app. The
                    app stays the official record.
                  </div>
                </div>
              </>
            )}

            {/* PAGE 8 — SAFETY & FAQ */}
            {current.id === 'safety' && (
              <>
                <PageHeader index={pageNo} tag="Safety First" title="Who Can Do What, and Quick Fixes">
                  Finance actions are limited by role, and every sensitive action leaves a permanent trail.
                </PageHeader>

                <div className={styles.twoColCompare}>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagGreen}`}>
                      <ShieldCheck size={13} /> Can Post &amp; Reverse
                    </span>
                    <h6 className={styles.compareTitle}>Finance Secretariat &amp; Oversight</h6>
                    <p className={styles.compareDesc}>
                      The <strong>Finance Secretary, Budget Officer, Auditor</strong> and system Admin can post expenses and
                      reverse entries. Approval and audit clearance powers sit with the matching secretaries.
                    </p>
                  </div>
                  <div className={styles.compareBox}>
                    <span className={`${styles.compareTag} ${styles.tagAmber}`}>
                      <Lock size={13} /> View-Only
                    </span>
                    <h6 className={styles.compareTitle}>Everyone Else</h6>
                    <p className={styles.compareDesc}>
                      Other officers see a <strong>View-Only Mode</strong> badge. They can read balances and reports, but the
                      action buttons stay hidden.
                    </p>
                  </div>
                </div>

                <h5 className={styles.sectionTitle}>Common Questions</h5>
                <div className={styles.stepList}>
                  <Faq q="&ldquo;I don't see the Post Expense or Delete button.&rdquo;">
                    Your role is view-only for finance. Ask the Finance Secretary or Admin to post it, or to request an access
                    grant for your account.
                  </Faq>
                  <Faq q="&ldquo;I posted the wrong amount. How do I fix it?&rdquo;">
                    Posted ledger entries cannot be edited. Use <strong>Reverse</strong> with a reason, then post the correct
                    entry. For IGP collections, use <strong>Delete</strong> with a reason instead.
                  </Faq>
                  <Faq q="&ldquo;The app balance does not match the bank.&rdquo;">
                    Use <strong>Edit Fund Balance</strong> (bank calibration) and write a reconciliation note, so the change is
                    explained in the record.
                  </Faq>
                  <Faq q="&ldquo;Export failed or the sheet looks empty.&rdquo;">
                    Allow popups for Google sign-in, make sure you are signed in with the right Google account, and try again.
                  </Faq>
                </div>

                <div className={styles.tipBanner}>
                  <PackageCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Every action is logged.</strong> Who did it, when, and why is recorded in the audit trail, so
                    finance stays transparent and accountable.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className={styles.bottomFooter}>
          <div className={styles.pageDotsWrap}>
            <span className={styles.pageCounterText}>
              Page {pageNo} of {TOTAL}
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
                onClick={() => setPageIndex((p) => Math.min(TOTAL - 1, p + 1))}
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

export default FinanceGuideModal;

