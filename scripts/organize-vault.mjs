import fs from 'fs';
import path from 'path';

const DOCS_DIR = path.resolve('Obisidian Documentation');

// Subdirectories under Documents/
const CATEGORIES = {
  ARCH: '01_Architecture_Database',
  COMM: '02_Commerce_Merchandising',
  FIN: '03_Finance_Ledger',
  GOV: '04_Academics_Governance_Docs',
  UI: '05_System_UI_Components',
  RES: '06_Research_Manuscripts',
  OPS: '07_DevOps_Deployment',
  DBA: 'db-atlas'
};

// Cross-domain semantic synapses (bidirectional neural links)
const NEURAL_SYNAPSES = {
  // Finance cross-links
  'FINANCE_MODULE_REDESIGN_SPEC.md': [
    '[[02_Commerce_Merchandising/COMMERCE_HUB_FEATURE|Commerce Hub Revenue Integration]]',
    '[[02_Commerce_Merchandising/ORDER_STOCK_MANAGEMENT|Order Stock & IGF Sync]]',
    '[[db-atlas/fundAccounts|fundAccounts Collection]]',
    '[[db-atlas/budgetAllocations|budgetAllocations Collection]]',
    '[[db-atlas/transactions|transactions Double-Entry Ledger]]',
    '[[01_Architecture_Database/COMPLETE_CODEBASE_ERD_AND_DATABASE_SPECIFICATION|Codebase ERD]]'
  ],
  'FINANCE_CLARIFICATION.MD': [
    '[[03_Finance_Ledger/FINANCE_MODULE_REDESIGN_SPEC|Finance Redesign Spec]]',
    '[[db-atlas/transactions|transactions Ledger]]',
    '[[db-atlas/fundAccounts|fundAccounts Balance Invariants]]'
  ],

  // Commerce cross-links
  'COMMERCE_HUB_FEATURE.md': [
    '[[03_Finance_Ledger/FINANCE_MODULE_REDESIGN_SPEC|Finance IGF Sync]]',
    '[[02_Commerce_Merchandising/ORDER_STOCK_MANAGEMENT|Order Stock Management]]',
    '[[02_Commerce_Merchandising/TRACK_ORDER_ARCHITECTURE|Track Order Architecture]]',
    '[[db-atlas/products|products Collection]]',
    '[[db-atlas/orders|orders Collection]]',
    '[[db-atlas/inventory|inventory Collection]]'
  ],
  'ORDER_STOCK_MANAGEMENT.md': [
    '[[02_Commerce_Merchandising/COMMERCE_HUB_FEATURE|Commerce Hub Dashboard]]',
    '[[03_Finance_Ledger/FINANCE_MODULE_REDESIGN_SPEC|Finance Module Spec]]',
    '[[db-atlas/orders|orders Lifecycle]]',
    '[[db-atlas/inventory|inventory Deductions]]'
  ],
  'TRACK_ORDER_ARCHITECTURE.md': [
    '[[02_Commerce_Merchandising/COMMERCE_HUB_FEATURE|Commerce Hub]]',
    '[[db-atlas/orders|orders Status Machine]]',
    '[[01_Architecture_Database/COMPLETE_CODEBASE_ERD_AND_DATABASE_SPECIFICATION|Codebase ERD Topology]]'
  ],

  // Architecture & Database cross-links
  'COMPLETE_CODEBASE_ERD_AND_DATABASE_SPECIFICATION.md': [
    '[[01_Architecture_Database/DB_ATLAS_OBSIDIAN_CONFIGURATION_REVIEW|DB Atlas Setup & Review]]',
    '[[03_Finance_Ledger/FINANCE_MODULE_REDESIGN_SPEC|Finance Module Spec]]',
    '[[02_Commerce_Merchandising/COMMERCE_HUB_FEATURE|Commerce Hub Spec]]',
    '[[04_Academics_Governance_Docs/DOCUMENT_MANAGEMENT_WALKTHROUGH|Document Governance]]',
    '[[01_Architecture_Database/MONGODB_AI_INTEGRATION_COMPLETE|MongoDB Vector AI Engine]]',
    '[[01_Architecture_Database/GLOSSARY|Domain Terminology Glossary]]'
  ],
  'DB_ATLAS_OBSIDIAN_CONFIGURATION_REVIEW.md': [
    '[[01_Architecture_Database/COMPLETE_CODEBASE_ERD_AND_DATABASE_SPECIFICATION|Codebase ERD Specification]]',
    '[[db-atlas/orders|orders Table Note]]',
    '[[db-atlas/transactions|transactions Table Note]]',
    '[[db-atlas/fundAccounts|fundAccounts Table Note]]'
  ],
  'MONGODB_AI_INTEGRATION_COMPLETE.md': [
    '[[01_Architecture_Database/MONGODB_ATLAS_SETUP_GUIDE|MongoDB Atlas Setup]]',
    '[[01_Architecture_Database/MONGODB_AI_TECHNICAL_FINDINGS|Technical Findings]]',
    '[[01_Architecture_Database/COMPLETE_CODEBASE_ERD_AND_DATABASE_SPECIFICATION|Firestore Core DB]]'
  ],

  // Academics & Governance cross-links
  'DOCUMENT_MANAGEMENT_WALKTHROUGH.md': [
    '[[db-atlas/documents|documents Collection]]',
    '[[db-atlas/documentLabels|documentLabels Collection]]',
    '[[db-atlas/documentTemplates|documentTemplates Collection]]',
    '[[04_Academics_Governance_Docs/PDF_DASHBOARD_DESIGN_TRANSFORMATION|PDF Dashboard UI]]'
  ],

  // UI Components cross-links
  'THEME_SYSTEM_COMPLETE.md': [
    '[[05_System_UI_Components/MODAL_SYSTEM_COMPLETE|Modal Dialog System]]',
    '[[05_System_UI_Components/ANNOUNCEMENT_FINAL_OPTIMIZATION|Announcements Carousel]]',
    '[[05_System_UI_Components/CALENDAR_MODAL_AND_HOMEPAGE_SPEC|Event Calendar]]'
  ],

  // Manuscripts & Research cross-links
  'CHAPTER_1_SUMMARY.md': [
    '[[06_Research_Manuscripts/CHAPTER_2_LITERATURE_REVIEW|Chapter 2 Literature Review]]',
    '[[06_Research_Manuscripts/MANUSCRIPT_PROGRESS_REPORT_OCT25_OCT31_2026|October Progress Report]]',
    '[[01_Architecture_Database/COMPLETE_CODEBASE_ERD_AND_DATABASE_SPECIFICATION|Database Architecture]]'
  ],
  'MANUSCRIPT_PROGRESS_REPORT_OCT25_OCT31_2026.md': [
    '[[06_Research_Manuscripts/CHAPTER_1_SUMMARY|Thesis Problem & Objectives]]',
    '[[01_Architecture_Database/COMPLETE_CODEBASE_ERD_AND_DATABASE_SPECIFICATION|Codebase ERD System]]',
    '[[03_Finance_Ledger/FINANCE_MODULE_REDESIGN_SPEC|Finance Module Overhaul]]'
  ],

  // DevOps cross-links
  'DEPLOYMENT_GUIDE.md': [
    '[[07_DevOps_Deployment/PRE_DEPLOYMENT_CHECKLIST|Pre-Deployment Checklist]]',
    '[[07_DevOps_Deployment/BLAZE_PLAN_SETUP_GUIDE|Firebase Blaze Plan]]',
    '[[07_DevOps_Deployment/FIREBASE_ADMIN_SDK_SETUP|Firebase Admin SDK]]',
    '[[07_DevOps_Deployment/SETUP_GOOGLE_OAUTH|Google OAuth Credentials]]'
  ]
};

// File mapping dictionary
const FILE_MAP = {
  // Architecture & Database
  'COMPLETE_CODEBASE_ERD_AND_DATABASE_SPECIFICATION.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'erd-spec' },
  'DB_ATLAS_OBSIDIAN_CONFIGURATION_REVIEW.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'code-review' },
  'DATABASE_SCHEMA.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'schema' },
  '0001-fund-aware-ledger-redesign.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'adr' },
  '0002-university-appropriation-and-ppmp-matrix.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'adr' },
  'MONGODB_AI_INTEGRATION_COMPLETE.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'integration' },
  'MONGODB_AI_INTEGRATION_SUMMARY.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'summary' },
  'MONGODB_AI_STORAGE_AND_CLEANUP_DIAGNOSTICS.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'diagnostics' },
  'MONGODB_AI_TECHNICAL_FINDINGS.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'technical-findings' },
  'MONGODB_ATLAS_SETUP_GUIDE.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'guide' },
  'MONGODB_INTEGRATION_SESSION_01.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'log' },
  'MONGODB_INTEGRATION_SESSION_02.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'log' },
  'MONGODB_INTEGRATION_SESSION_03.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'log' },
  'MONGODB_INTEGRATION_SESSION_03_TASKS.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'tasks' },
  'MONGODB_SESSION_01_SUMMARY.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'summary' },
  'MONGODB_SESSION_03_SUMMARY_REPORT.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'summary' },
  'GLOSSARY.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'glossary' },
  'PROJECT_DOCUMENTATION.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'documentation' },
  'OVERVIEW.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'overview' },
  'QUICK_REFERENCE.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'reference' },
  'Tutorial.md': { cat: CATEGORIES.ARCH, domain: 'architecture', type: 'tutorial' },

  // Commerce & Merchandising
  'COMMERCE_HUB_FEATURE.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'feature-spec' },
  'COMMERCE_HUB_GUIDE.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'user-guide' },
  'COMMERCE_HUB_SUMMARY.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'summary' },
  'COMMERCE_HUB_VISUAL.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'visual-guide' },
  'INVENTORY_DESIGN_TRANSFORMATION.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'design-spec' },
  'ORDERMANAGEMENT_DESIGN_IMPROVEMENTS.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'design-spec' },
  'ORDERMANAGEMENT_FIX_SUMMARY.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'bugfix' },
  'ORDERMANAGEMENT_TABLE_FIX.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'bugfix' },
  'ORDERMANAGEMENT_TABLE_TRANSFORMATION.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'design-spec' },
  'ORDERMANAGEMENT_VISUAL_GUIDE.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'visual-guide' },
  'ORDER_DESIGN_IMPROVEMENTS.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'design-spec' },
  'ORDER_ID_FORMAT_UPDATE.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'specification' },
  'ORDER_ID_QUICK_REFERENCE.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'quick-ref' },
  'ORDER_STATUS_MODAL_ANIMATION.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'ui-animation' },
  'ORDER_STOCK_IMPLEMENTATION_SUMMARY.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'implementation' },
  'ORDER_STOCK_MANAGEMENT.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'feature-spec' },
  'ORDER_STOCK_MANAGEMENT_FIX.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'bugfix' },
  'ORDER_SUBMISSION_BUG_FIX.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'bugfix' },
  'PRODUCT.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'product-spec' },
  'PRODUCT_CATALOG_REDESIGN.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'redesign' },
  'PRODUCT_VARIATIONS_ENHANCEMENT.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'enhancement' },
  'PRODUCT_VARIATIONS_QUICK_GUIDE.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'quick-ref' },
  'STATUS_MODAL_QUICK_REFERENCE.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'quick-ref' },
  'STOCK_MANAGEMENT_QUICK_GUIDE.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'quick-ref' },
  'STOCK_MANAGEMENT_VISUAL_GUIDE.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'visual-guide' },
  'TRACK_ORDER_ARCHITECTURE.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'architecture' },
  'TRACK_ORDER_FEATURE.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'feature-spec' },
  'TRACK_ORDER_TESTING.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'qa-testing' },
  'TRACK_ORDER_USER_GUIDE.md': { cat: CATEGORIES.COMM, domain: 'commerce', type: 'user-guide' },

  // Finance & Ledger
  'FINANCE_MODULE_REDESIGN_SPEC.md': { cat: CATEGORIES.FIN, domain: 'finance', type: 'redesign-spec' },
  'FINANCE_CLARIFICATION.MD': { cat: CATEGORIES.FIN, domain: 'finance', type: 'clarification' },

  // Governance, Academics & Documents
  'DOCUMENT_MANAGEMENT_WALKTHROUGH.md': { cat: CATEGORIES.GOV, domain: 'governance', type: 'walkthrough' },
  'DOCUMENT_REPO_FIX_SUMMARY.md': { cat: CATEGORIES.GOV, domain: 'governance', type: 'bugfix' },
  'PDF_DASHBOARD_DESIGN_TRANSFORMATION.md': { cat: CATEGORIES.GOV, domain: 'governance', type: 'design-spec' },

  // UI Components & Core System
  'ANNOUNCEMENT_FINAL_OPTIMIZATION.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'optimization' },
  'ANNOUNCEMENT_SCROLLABLE_DESCRIPTION.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'component' },
  'ANNOUNCEMENT_SIZE_COMPARISON.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'analysis' },
  'ANNOUNCEMENT_UI_IMPROVEMENTS.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'ui-enhancement' },
  'ANNOUNCEMENT_UI_QUICK_GUIDE.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'quick-guide' },
  'ANNOUNCEMENT_UI_REDESIGN.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'redesign' },
  'ANNOUNCEMENT_WIDTH_OPTIMIZATION.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'optimization' },
  'CALENDAR_IMPLEMENTATION_SUMMARY.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'summary' },
  'CALENDAR_MODAL_AND_HOMEPAGE_SPEC.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'specification' },
  'CALENDAR_VISUAL_GUIDE.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'visual-guide' },
  'CALENDAR_WIDGET_REDESIGN.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'redesign' },
  'CONFIRMATION_MODAL_FEATURE.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'component' },
  'HERO_TEXT_ANIMATION.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'animation' },
  'LOGIN_PASSWORD_TOGGLE_FEATURE.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'auth-ui' },
  'PASSWORD_TOGGLE_VISUAL_GUIDE.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'visual-guide' },
  'MEMBERLIST_REFERROR_FIX.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'bugfix' },
  'MEMBER_MANAGEMENT_COMPLETE_STATUS.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'status' },
  'MEMBER_SCROLLING_OPTIMIZATION.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'optimization' },
  'MEMBER_UI_SIMPLIFICATION.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'ui-enhancement' },
  'MODAL_SYSTEM_COMPLETE.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'system-spec' },
  'OFFICERS_CAROUSEL_FEATURE.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'component' },
  'SCROLLING_OPTIMIZATION_SUMMARY.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'optimization' },
  'SIDEBAR_ICONS_REFERENCE.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'design-system' },
  'THEME_SYSTEM_COMPLETE.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'theme-spec' },
  'THEME_SYSTEM_FEATURE.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'theme-spec' },
  'THEME_SYSTEM_USER_GUIDE.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'user-guide' },
  'SYSTEM_DEMONSTRATION_VIDEO_GUIDE.md': { cat: CATEGORIES.UI, domain: 'ui', type: 'video-guide' },

  // Research & Manuscripts
  'CHAPTER_1_SUMMARY.md': { cat: CATEGORIES.RES, domain: 'manuscript', type: 'thesis-chapter' },
  'CHAPTER_2_LITERATURE_REVIEW.md': { cat: CATEGORIES.RES, domain: 'manuscript', type: 'thesis-chapter' },
  'MANUSCRIPT_PROGRESS_REPORT_OCT25_OCT31_2026.md': { cat: CATEGORIES.RES, domain: 'manuscript', type: 'progress-report' },
  'PROGRESS_REPORT_OCT19_OCT24_2026.md': { cat: CATEGORIES.RES, domain: 'manuscript', type: 'progress-report' },
  'SSG_WEEKLY_PROGRESS_REPORT_AUG25_OCT7.md': { cat: CATEGORIES.RES, domain: 'manuscript', type: 'progress-report' },
  'WEEKLY_PROGRESS_REPORT_AUG25_OCT7.md': { cat: CATEGORIES.RES, domain: 'manuscript', type: 'progress-report' },
  'OCTOBER_7_UPDATE_SUMMARY.md': { cat: CATEGORIES.RES, domain: 'manuscript', type: 'progress-report' },

  // DevOps & Deployment
  'BLAZE_PLAN_SETUP_GUIDE.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'infrastructure' },
  'BUGFIX_DELETE_AND_FIELD_NAME.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'qa-fix' },
  'BUG_FIX_SUMMARY.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'qa-fix' },
  'CONTEXT_TRANSFER_COMPLETION_SUMMARY.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'summary' },
  'DEPLOYMENT_GUIDE.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'deployment' },
  'DEPLOY_NOW.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'deployment' },
  'FIREBASE_ADMIN_SDK_SETUP.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'auth-security' },
  'IMPLEMENTATION_SUMMARY.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'summary' },
  'LAN_ACCESS_SETUP_GUIDE.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'networking' },
  'PRE_DEPLOYMENT_CHECKLIST.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'checklist' },
  'PRE_DEPLOYMENT_SPEC_AND_CHECKLIST.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'checklist' },
  'QUICK_DEPLOY.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'deployment' },
  'README_DEPLOYMENT.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'deployment' },
  'SETUP_GOOGLE_OAUTH.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'auth-security' },
  'STEP_BY_STEP_DEPLOY.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'deployment' },
  'TEST_PLAN.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'testing' },
  'VERIFICATION_GUIDE.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'verification' },
  'SKILLS_CHEAT_SHEET.md': { cat: CATEGORIES.OPS, domain: 'devops', type: 'skills-guide' }
};

// Search paths in priority order
const SEARCH_DIRS = ['Obisidian Documentation', 'Markdownfiles', 'Paperworks', 'docs/adr', '.'];

function findSourcePath(fileName) {
  for (const dir of SEARCH_DIRS) {
    const p = path.join(dir, fileName);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Function to process a vault root (either Documents or Documentations)
function organizeVault(targetRoot) {
  console.log(`\n==================================================`);
  console.log(`🚀 Organizing Vault Directory: ${targetRoot}`);
  console.log(`==================================================`);

  if (!fs.existsSync(targetRoot)) {
    fs.mkdirSync(targetRoot, { recursive: true });
  }

  // Ensure category subdirectories exist
  for (const catDir of Object.values(CATEGORIES)) {
    const fullCatPath = path.join(targetRoot, catDir);
    if (!fs.existsSync(fullCatPath)) {
      fs.mkdirSync(fullCatPath, { recursive: true });
    }
  }

  // Ensure .obsidian exists
  const obsidianDir = path.join(targetRoot, '.obsidian');
  if (!fs.existsSync(obsidianDir)) {
    fs.mkdirSync(obsidianDir, { recursive: true });
  }

  // Copy and enrich all markdown files
  let count = 0;
  for (const [fileName, meta] of Object.entries(FILE_MAP)) {
    const src = findSourcePath(fileName);
    if (!src) continue;

    let content = fs.readFileSync(src, 'utf-8');
    const targetDir = path.join(targetRoot, meta.cat);
    const targetFile = path.join(targetDir, fileName);

    const cleanTitle = fileName.replace(/\.md$/i, '').replace(/_/g, ' ');
    const domainTag = `domain/${meta.domain}`;
    const typeTag = `type/${meta.type}`;
    const mocLink = `[[${meta.cat}_MOC|📁 ${meta.cat.replace(/_/g, ' ')}]]`;

    const navBanner = `\n> [!info] 🧠 Neural Synapse Navigation\n> 📍 **Category Hub:** ${mocLink} | 🏠 **Neural Core:** [[00_VAULT_INDEX|🧠 Master Knowledge Graph]]\n\n`;

    // Cross-domain links section
    const synapses = NEURAL_SYNAPSES[fileName];
    let synapseSection = '';
    if (synapses && synapses.length > 0) {
      synapseSection = `\n\n---\n\n### 🧠 Connected Neural Synapses\n` +
        synapses.map(s => `* 🔗 ${s}`).join('\n') + `\n`;
    }

    if (!content.startsWith('---')) {
      const frontmatter = `---
title: "${cleanTitle}"
tags:
  - ${domainTag}
  - ${typeTag}
  - status/production
  - ctu-daanbantayan
category: "${meta.cat}"
---
`;
      content = frontmatter + navBanner + content;
    } else {
      if (!content.includes('domain/')) {
        content = content.replace(/^---\r?\n/, `---\ntags:\n  - ${domainTag}\n  - ${typeTag}\n  - status/production\n  - ctu-daanbantayan\ncategory: "${meta.cat}"\n`);
      }
      if (!content.includes('Neural Synapse Navigation')) {
        content = content.replace(/^(---\r?\n[\s\S]*?\r?\n---)(\r?\n|$)/, `$1\n${navBanner}`);
      }
    }

    // Append cross-synapses if not already appended
    if (synapseSection && !content.includes('Connected Neural Synapses')) {
      content += synapseSection;
    }

    fs.writeFileSync(targetFile, content, 'utf-8');
    count++;
  }

  // Handle binary/diagram assets
  const assets = [
    { name: 'MONGODB_ARCHITECTURE_DIAGRAM.drawio', cat: CATEGORIES.ARCH },
    { name: 'SYSTEM RESEARCH PAPER.pdf', cat: CATEGORIES.RES }
  ];

  for (const asset of assets) {
    const src = findSourcePath(asset.name);
    if (src && fs.existsSync(src)) {
      const dest = path.join(targetRoot, asset.cat, asset.name);
      fs.copyFileSync(src, dest);
      console.log(`Copied asset: ${asset.name} -> ${asset.cat}`);
    }
  }

  // Copy / update db-atlas notes
  const srcDbAtlas = path.join('Obisidian Documentation', 'db-atlas');
  const targetDbAtlas = path.join(targetRoot, 'db-atlas');
  if (fs.existsSync(srcDbAtlas) && targetDbAtlas !== srcDbAtlas) {
    if (!fs.existsSync(targetDbAtlas)) fs.mkdirSync(targetDbAtlas, { recursive: true });
    const dbFiles = fs.readdirSync(srcDbAtlas).filter(f => f.endsWith('.md'));
    for (const f of dbFiles) {
      fs.copyFileSync(path.join(srcDbAtlas, f), path.join(targetDbAtlas, f));
    }
  }

  // Generate Domain MOCs
  const MOCS = [
    {
      cat: CATEGORIES.ARCH,
      file: '01_Architecture_Database_MOC.md',
      title: '🏛️ Architecture, Database & System Topology — Domain Hub',
      tag: 'domain/architecture',
      desc: 'Core system specifications, Firestore NoSQL collection structures, MongoDB AI analytics, Entity-Relationship Diagrams, and Architectural Decision Records.'
    },
    {
      cat: CATEGORIES.COMM,
      file: '02_Commerce_Merchandising_MOC.md',
      title: '🛍️ Commerce Hub, Orders & Inventory — Domain Hub',
      tag: 'domain/commerce',
      desc: 'Student merchandise ordering lifecycle, product variations, real-time stock deduction, order tracking, and claim confirmation modals.'
    },
    {
      cat: CATEGORIES.FIN,
      file: '03_Finance_Ledger_MOC.md',
      title: '💳 Finance & IGF Double-Entry Ledger — Domain Hub',
      tag: 'domain/finance',
      desc: 'University fund accounting, budget allocations, integer centavo transactions, and cash liquidation audit integrity.'
    },
    {
      cat: CATEGORIES.GOV,
      file: '04_Academics_Governance_Docs_MOC.md',
      title: '🎓 Academics, Governance & Document Repository — Domain Hub',
      tag: 'domain/governance',
      desc: 'Class rosters, section management, Death Aid benefit collections, and SSG official document archiving.'
    },
    {
      cat: CATEGORIES.UI,
      file: '05_System_UI_Components_MOC.md',
      title: '🎨 UI Design System, Modals & Components — Domain Hub',
      tag: 'domain/ui',
      desc: 'Announcement carousels, responsive calendars, modal dialogs, authentication toggles, and dynamic dark/light themes.'
    },
    {
      cat: CATEGORIES.RES,
      file: '06_Research_Manuscripts_MOC.md',
      title: '📚 Thesis Manuscripts & Weekly Progress Reports — Domain Hub',
      tag: 'domain/manuscript',
      desc: 'Academic thesis chapters, literature reviews, methodology specifications, and weekly engineering progress reports.'
    },
    {
      cat: CATEGORIES.OPS,
      file: '07_DevOps_Deployment_MOC.md',
      title: '🚀 DevOps, Infrastructure & Deployment Guides — Domain Hub',
      tag: 'domain/devops',
      desc: 'Firebase Blaze plan configurations, LAN access procedures, Google OAuth credentials, pre-deployment checklists, and automated testing.'
    }
  ];

  for (const moc of MOCS) {
    const catPath = path.join(targetRoot, moc.cat);
    const mocPath = path.join(catPath, moc.file);

    const filesInCat = fs.readdirSync(catPath)
      .filter(f => f.endsWith('.md') && f !== moc.file)
      .sort();

    let mocContent = `---
title: "${moc.title}"
tags:
  - ${moc.tag}
  - type/moc
  - status/production
---

# ${moc.title}

> [!abstract] Synaptic Cluster Overview
> ${moc.desc}

> [!tip] 🧠 Neural Core Synapse
> 🏠 Return to Master Vault Index: [[00_VAULT_INDEX|🧠 Master Knowledge Graph & Synaptic Core]]

---

## 📑 Domain Documentation Nodes

| Document Note | Neural Type | Description / Link |
| :--- | :---: | :--- |
`;

    for (const f of filesInCat) {
      const cleanName = f.replace(/\.md$/, '');
      const meta = FILE_MAP[f] || { type: 'note' };
      mocContent += `| [[${cleanName}]] | \`${meta.type}\` | Direct synapse to note | \n`;
    }

    // Add asset rows if applicable
    if (moc.cat === CATEGORIES.ARCH) {
      mocContent += `| [[MONGODB_ARCHITECTURE_DIAGRAM.drawio]] | \`diagram-asset\` | Architecture diagram file | \n`;
    } else if (moc.cat === CATEGORIES.RES) {
      mocContent += `| [[SYSTEM RESEARCH PAPER.pdf]] | \`research-paper\` | Complete academic thesis PDF | \n`;
    }

    mocContent += `\n---\n*Part of CTU Daanbantayan SSG Office Assistant Knowledge Network.*\n`;
    fs.writeFileSync(mocPath, mocContent, 'utf-8');
  }

  // Copy or write 00_VAULT_INDEX.md
  const masterIndexPath = path.join('Obisidian Documentation', '00_VAULT_INDEX.md');
  if (fs.existsSync(masterIndexPath) && path.join(targetRoot, '00_VAULT_INDEX.md') !== masterIndexPath) {
    fs.copyFileSync(masterIndexPath, path.join(targetRoot, '00_VAULT_INDEX.md'));
  }

  // Configure .obsidian/graph.json
  const graphConfig = {
    "collapse-filter": false,
    "search": "",
    "localJumps": 1,
    "localBacklinks": true,
    "localForelinks": true,
    "localInterlinks": false,
    "showTags": true,
    "showAttachments": false,
    "hideUnresolved": false,
    "collapse-color-groups": false,
    "colorGroups": [
      { "query": "tag:#nucleus/core", "color": { "a": 1, "rgb": 10040319 } },
      { "query": "tag:#domain/architecture", "color": { "a": 1, "rgb": 440212 } },
      { "query": "tag:#domain/commerce", "color": { "a": 1, "rgb": 1096065 } },
      { "query": "tag:#domain/finance", "color": { "a": 1, "rgb": 16096779 } },
      { "query": "tag:#domain/governance", "color": { "a": 1, "rgb": 3899894 } },
      { "query": "tag:#domain/ui", "color": { "a": 1, "rgb": 9133302 } },
      { "query": "tag:#domain/manuscript", "color": { "a": 1, "rgb": 15485081 } },
      { "query": "tag:#domain/devops", "color": { "a": 1, "rgb": 15680580 } },
      { "query": "tag:#type/db-atlas-table", "color": { "a": 1, "rgb": 960233 } }
    ],
    "collapse-display": false,
    "showArrow": true,
    "textFadeMultiplier": 0,
    "nodeSizeMultiplier": 1.25,
    "lineSizeMultiplier": 1.1,
    "collapse-forces": false,
    "centerStrength": 0.45,
    "repelStrength": 14,
    "linkStrength": 1.2,
    "linkDistance": 220,
    "scale": 1.0,
    "close": false
  };

  fs.writeFileSync(path.join(obsidianDir, 'graph.json'), JSON.stringify(graphConfig, null, 2), 'utf-8');

  // CLEANUP LOOSE FILES in root of targetRoot (except 00_VAULT_INDEX.md)
  const rootFiles = fs.readdirSync(targetRoot).filter(f => !fs.statSync(path.join(targetRoot, f)).isDirectory());
  let cleanedCount = 0;
  for (const f of rootFiles) {
    if (f !== '00_VAULT_INDEX.md') {
      fs.unlinkSync(path.join(targetRoot, f));
      cleanedCount++;
    }
  }

  console.log(`✅ Processed ${count} notes.`);
  console.log(`🧹 Cleaned up ${cleanedCount} loose files from root of ${targetRoot}.`);
  console.log(`🌟 ${targetRoot} is now a 100% organized, clean, neural Obsidian Vault!`);
}

// Run for Obisidian Documentation
organizeVault(DOCS_DIR);
