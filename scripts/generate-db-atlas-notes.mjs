import fs from 'fs';
import path from 'path';

const tables = [
  {
    name: 'fundAccounts',
    description: 'Statutory top-level campus fund accounts (Fiscal Year Budget, FSG Remittance, IGF, IGP)',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique account identifier (e.g., fund_fiscal_year_budget, fund_igf_main).' },
      { name: 'displayName', type: 'string', notNull: true, desc: 'Human-readable statutory fund title displayed in institutional dashboards.' },
      { name: 'topLevelCategory', type: 'string', notNull: true, desc: 'Statutory fund classification: FISCAL_YEAR_BUDGET, FSG_REMITTANCE, IGF, or IGP.' },
      { name: 'subcategory', type: 'string', notNull: false, desc: 'Descriptive sub-category (e.g. Merchandise, Lanyards, Annual General Appropriations).' },
      { name: 'balanceCentavos', type: 'int', notNull: true, default: '0', desc: 'Primary liquid holding in integer centavos (1 PHP = 100 centavos) eliminating floating point drift.' },
      { name: 'appropriatedCeilingCentavos', type: 'int', notNull: false, default: '0', desc: 'Legislative macro budget ceiling authorized for annual PPMP programming.' },
      { name: 'holdingType', type: 'string', notNull: true, desc: 'Physical repository type: bank (BDO Institutional) or cash (Treasury Cash Box).' },
      { name: 'bankAccountReference', type: 'string', notNull: true, desc: 'BDO Institutional Account ****2005 or Treasury Safe Box reference descriptor.' },
      { name: 'status', type: 'string', notNull: true, default: 'active', desc: 'Operational status: active, archived, or frozen.' },
      { name: 'fiscalYear', type: 'int', notNull: true, desc: 'Academic calendar budget year (e.g., 2026).' },
      { name: 'updatedAt', type: 'timestamp', notNull: true, desc: 'Firestore timestamp of the most recent balance adjustment or holding reconciliation.' }
    ]
  },
  {
    name: 'budgetAllocations',
    description: 'Legislative Project Procurement Management Plan (PPMP) activity and event budget allocations',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Auto-generated Firestore allocation document identifier.' },
      { name: 'fundAccountId', type: 'string', notNull: true, ref: 'fundAccounts.id', desc: 'Points to the parent fund account (strictly SSG Fiscal Year Budget or FSG Remittance).' },
      { name: 'activityName', type: 'string', notNull: true, desc: 'Approved student activity, seminar, or project title.' },
      { name: 'category', type: 'string', notNull: true, desc: 'Macro classification: Event, Project, Supplies, or Equipment.' },
      { name: 'procurementType', type: 'string', notNull: true, desc: 'PPMP procurement code: EVENT, PROJECT, or MATERIAL_SUPPLY.' },
      { name: 'committee', type: 'string', notNull: true, desc: 'Responsible organizing body (e.g. Executive, Secretariat, Socio-Cultural, Sports).' },
      { name: 'fiscalYear', type: 'int', notNull: true, desc: 'Fiscal allocation year matching statutory appropriations.' },
      { name: 'approvedAmountCentavos', type: 'int', notNull: true, default: '0', desc: 'Total authorized allocation limit in integer centavos.' },
      { name: 'spentAmountCentavos', type: 'int', notNull: true, default: '0', desc: 'Actual liquidated expenditures posted from the immutable ledger.' },
      { name: 'committedAmountCentavos', type: 'int', notNull: false, default: '0', desc: 'Encumbered purchase order reserves awaiting receipt turnover.' },
      { name: 'status', type: 'string', notNull: true, default: 'approved', desc: 'PPMP governance status: draft, approved, or archived.' },
      { name: 'isActive', type: 'boolean', notNull: true, default: 'true', desc: 'Visibility flag for active PPMP Matrix filtering.' },
      { name: 'resolutionRef', type: 'string', notNull: false, desc: 'Official legislative resolution control number (e.g., Resolution no. 09235).' },
      { name: 'approvedBy', type: 'string', notNull: false, desc: 'Name of authorizing executive officer or presiding chairperson.' },
      { name: 'approvedLineItems', type: 'array', notNull: true, desc: 'Itemized sub-line items tracking planned vs spent expenses and inflation.' },
      { name: 'revisionHistory', type: 'array', notNull: true, desc: 'Append-only audit history of previous amount or title amendments.' }
    ]
  },
  {
    name: 'transactions',
    description: 'Append-only double-entry financial ledger recording all collections, disbursements, and reversals',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique Firestore ledger document identifier.' },
      { name: 'refNumber', type: 'string', notNull: true, desc: 'Deterministic unique transaction reference number (e.g. TXN-123456-789 or IGF-ORD-...-Z6MU3Q).' },
      { name: 'fundAccountId', type: 'string', notNull: true, ref: 'fundAccounts.id', desc: 'The fund account debited or credited by this transaction.' },
      { name: 'fundCategory', type: 'string', notNull: true, desc: 'Fund category snapshot at the time of entry.' },
      { name: 'transactionType', type: 'string', notNull: true, desc: 'Accounting type: collection, expense, payment, refund, reversal, or adjustment.' },
      { name: 'expensePurpose', type: 'string', notNull: true, desc: 'Specific purpose: Event Itemized Expense, Resolution Disbursement, or Merchandise Revenue.' },
      { name: 'amountCentavos', type: 'int', notNull: true, desc: 'Immutable transaction monetary value in integer centavos.' },
      { name: 'budgetAllocationId', type: 'string', notNull: false, ref: 'budgetAllocations.id', desc: 'Optional link to the approved PPMP budget allocation being liquidated.' },
      { name: 'lineItemId', type: 'string', notNull: false, desc: 'Specific sub-item identifier within the allocation line item list.' },
      { name: 'orderId', type: 'string', notNull: false, desc: 'Human-readable order tracking ID (e.g., ORD-DB-0001).' },
      { name: 'orderDocId', type: 'string', notNull: false, ref: 'orders.id', desc: 'Direct foreign key link to the merchandise order document.' },
      { name: 'payeeOrPayer', type: 'string', notNull: true, desc: 'Full name of payee, customer, or remitting representative.' },
      { name: 'description', type: 'string', notNull: true, desc: 'Detailed explanatory memorandum for institutional audit.' },
      { name: 'source', type: 'string', notNull: true, desc: 'System origin tag: MERCHANDISE_ORDER, PPMP_DISBURSEMENT, or MANUAL_POSTING.' },
      { name: 'status', type: 'string', notNull: true, default: 'posted', desc: 'Ledger entry status: posted, reversed, or draft.' },
      { name: 'createdById', type: 'string', notNull: true, ref: 'users.uid', desc: 'UID of the authenticated officer submitting the entry.' },
      { name: 'createdAt', type: 'timestamp', notNull: true, desc: 'Server timestamp when record was created.' },
      { name: 'postedAt', type: 'timestamp', notNull: true, desc: 'Official ledger posting timestamp.' }
    ]
  },
  {
    name: 'products',
    description: 'Commerce Hub merchandise catalog and sellable campus retail stock',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique Firestore product document identifier.' },
      { name: 'productId', type: 'string', notNull: true, desc: 'Business stock-keeping unit (e.g., PROD-LANYARD-001).' },
      { name: 'productName', type: 'string', notNull: true, desc: 'Catalog title (e.g., Unified CTU-DB Lanyard - CoEd/CoTE).' },
      { name: 'category', type: 'string', notNull: true, desc: 'Catalog group: Lanyard, Uniform, Apparel, or Office Supplies.' },
      { name: 'price', type: 'float', notNull: true, desc: 'Retail price in Philippine Pesos (PHP).' },
      { name: 'stockAvailable', type: 'int', notNull: true, default: '0', desc: 'Current available physical stock on store shelf ready for claiming.' },
      { name: 'sizes', type: 'array', notNull: false, desc: 'Available sizing options (e.g. Regular, S, M, L, XL).' },
      { name: 'linkedInventoryId', type: 'string', notNull: false, ref: 'inventory.id', desc: 'Bi-directional link to warehouse asset in Inventory Management.' },
      { name: 'imageUrl', type: 'string', notNull: false, desc: 'Firebase Storage download URL for product preview photograph.' },
      { name: 'status', type: 'string', notNull: true, default: 'Active', desc: 'Catalog state: Active, Out of Stock, or Discontinued.' }
    ]
  },
  {
    name: 'orders',
    description: 'Student merchandise purchase orders, payment verification, and claim tracking',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique Firestore order document identifier.' },
      { name: 'orderId', type: 'string', notNull: true, desc: 'Sequential customer order reference (e.g., ORD-DB-0001).' },
      { name: 'customerInfo', type: 'object', notNull: true, desc: 'Student customer profile: fullName, email, phoneNumber, bachelorDegree, section.' },
      { name: 'productInfo', type: 'object', notNull: true, desc: 'Purchased product metadata: productName, pricePerUnit, quantity, totalPrice.' },
      { name: 'paymentInfo', type: 'object', notNull: true, desc: 'Payment details: paymentMethod (Cash/Online), referenceNumber, onlinePaymentType.' },
      { name: 'orderStatus', type: 'string', notNull: true, default: 'Pending', desc: 'Unified lifecycle status: Pending, Online Paid, Claimed, Returned, or Cancelled.' },
      { name: 'claimed', type: 'boolean', notNull: true, default: 'false', desc: 'Physical item claim state: true once handed over to student.' },
      { name: 'stockClaimDeducted', type: 'boolean', notNull: true, default: 'false', desc: 'Guard flag confirming physical inventory stock has been decremented.' },
      { name: 'igfSynced', type: 'boolean', notNull: true, default: 'false', desc: 'Guard flag confirming order sales revenue is recorded in fund_igf_main.' },
      { name: 'igfReversed', type: 'boolean', notNull: true, default: 'false', desc: 'Guard flag confirming revenue was reversed/refunded upon return or cancellation.' },
      { name: 'igfTxRef', type: 'string', notNull: false, desc: 'Direct reference to the posted transactions.refNumber.' },
      { name: 'igfAmountCentavos', type: 'int', notNull: false, default: '0', desc: 'Exact centavos sum credited to Income Generated Funds.' },
      { name: 'dateOrdered', type: 'timestamp', notNull: true, desc: 'Timestamp when student submitted checkout form.' }
    ]
  },
  {
    name: 'inventory',
    description: 'Physical campus equipment, office supplies, and bulk warehouse stock',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique asset inventory document identifier.' },
      { name: 'name', type: 'string', notNull: true, desc: 'Item name (e.g. BAVIN 64GB USB, A4 Copy Paper, Heavy-Duty Stapler).' },
      { name: 'category', type: 'string', notNull: true, desc: 'Asset classification: Office Supplies, Equipment, Merchandise, or Maintenance.' },
      { name: 'quantity', type: 'int', notNull: true, default: '0', desc: 'Total physical unit count residing in SSG storage.' },
      { name: 'unit', type: 'string', notNull: true, default: 'piece', desc: 'Packaging unit: piece, box, ream, or set.' },
      { name: 'unitPrice', type: 'float', notNull: false, default: '0', desc: 'Procurement cost per unit in PHP.' },
      { name: 'reorderPoint', type: 'int', notNull: false, default: '10', desc: 'Low stock notification threshold.' },
      { name: 'location', type: 'string', notNull: false, desc: 'Physical room or cabinet: SSG Office Cabinet A, Storage Vault.' },
      { name: 'linkedProductId', type: 'string', notNull: false, ref: 'products.id', desc: 'Optional link to retail catalog product for bi-directional inventory sync.' },
      { name: 'isIGFOrigin', type: 'boolean', notNull: true, default: 'false', desc: 'Designates routine operational supplies funded via Income Generated Funds.' },
      { name: 'borrowedCount', type: 'int', notNull: false, default: '0', desc: 'Number of units currently out on loan via Borrowing Logs.' },
      { name: 'lastUpdated', type: 'timestamp', notNull: true, desc: 'Timestamp of the most recent physical inventory count.' }
    ]
  },
  {
    name: 'borrowingLogs',
    description: 'Asset withdrawal and loan custody logs for campus equipment and tools',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique borrowing transaction document identifier.' },
      { name: 'inventoryId', type: 'string', notNull: true, ref: 'inventory.id', desc: 'Points to the borrowed warehouse equipment or item.' },
      { name: 'borrowerName', type: 'string', notNull: true, desc: 'Full name of the borrowing student officer or faculty member.' },
      { name: 'borrowerContact', type: 'string', notNull: true, desc: 'University email address or mobile contact number.' },
      { name: 'purpose', type: 'string', notNull: true, desc: 'Official academic or student government event purpose.' },
      { name: 'quantityBorrowed', type: 'int', notNull: true, desc: 'Number of units checked out from storage.' },
      { name: 'borrowedAt', type: 'timestamp', notNull: true, desc: 'Checkout timestamp.' },
      { name: 'returnDueDate', type: 'timestamp', notNull: true, desc: 'Scheduled return deadline.' },
      { name: 'status', type: 'string', notNull: true, default: 'active', desc: 'Loan status: active, returned, or overdue.' },
      { name: 'returnedAt', type: 'timestamp', notNull: false, desc: 'Timestamp when item was verified and returned to storage.' }
    ]
  },
  {
    name: 'classRosters',
    description: 'Official academic student enrollment rosters submitted by classroom mayors',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique roster document identifier.' },
      { name: 'college', type: 'string', notNull: true, desc: 'College affiliation: CoEd, CoTE, CoAF, CAS.' },
      { name: 'program', type: 'string', notNull: true, desc: 'Degree program: BSIT, BSED, BSHM, BIT.' },
      { name: 'section', type: 'string', notNull: true, desc: 'Academic section designation: 1-A, 2-B, 3-C, 4-A.' },
      { name: 'sectionKey', type: 'string', notNull: true, desc: 'Unique composite hash key (e.g., CoTE_BSIT_3A).' },
      { name: 'studentCount', type: 'int', notNull: true, desc: 'Total enrolled student headcount validated against the student array.' },
      { name: 'students', type: 'array', notNull: true, desc: 'Student records list (schoolId, fullName, gender, enrollmentStatus).' },
      { name: 'status', type: 'string', notNull: true, default: 'pending', desc: 'Roster status: pending proposal, verified baseline, or superseded.' },
      { name: 'isCurrent', type: 'boolean', notNull: true, default: 'false', desc: 'Indicates the official active baseline for bereavement assessment.' },
      { name: 'version', type: 'int', notNull: false, default: '1', desc: 'Revision sequence number.' },
      { name: 'mayorUid', type: 'string', notNull: false, ref: 'users.uid', desc: 'UID of the classroom mayor who uploaded the roster proposal.' },
      { name: 'submittedAt', type: 'timestamp', notNull: true, desc: 'Submission timestamp.' },
      { name: 'verifiedAt', type: 'timestamp', notNull: false, desc: 'Timestamp when official Secretary verified and locked the roster.' }
    ]
  },
  {
    name: 'classSections',
    description: 'Central registry of verified academic sections and current baseline pointer',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique section registry document identifier.' },
      { name: 'sectionKey', type: 'string', notNull: true, desc: 'Unique section composite key.' },
      { name: 'college', type: 'string', notNull: true, desc: 'College affiliation.' },
      { name: 'program', type: 'string', notNull: true, desc: 'Degree program title.' },
      { name: 'sectionName', type: 'string', notNull: true, desc: 'Section identifier string.' },
      { name: 'currentRosterId', type: 'string', notNull: true, ref: 'classRosters.id', desc: 'Foreign key pointer to active baseline classRosters document.' },
      { name: 'enrolledCount', type: 'int', notNull: true, desc: 'Official verified enrolled student count.' },
      { name: 'verifiedAt', type: 'timestamp', notNull: true, desc: 'Timestamp of official section baseline verification.' }
    ]
  },
  {
    name: 'deathAidCollections',
    description: 'Bereavement assistance dues collected by classroom mayors and section representatives',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique collection document identifier.' },
      { name: 'rosterId', type: 'string', notNull: true, ref: 'classRosters.id', desc: 'Points to the verified baseline class roster.' },
      { name: 'sectionKey', type: 'string', notNull: true, desc: 'Composite section key identifying class.' },
      { name: 'enrolledCount', type: 'int', notNull: true, desc: 'Enrolled students count strictly matching verified roster.' },
      { name: 'beneficiaryCount', type: 'int', notNull: true, desc: 'Number of students who paid contribution.' },
      { name: 'contributionPerStudent', type: 'int', notNull: true, default: '20', desc: 'Standard contribution rate per student in PHP.' },
      { name: 'collectedAmount', type: 'int', notNull: true, desc: 'Total cash collected: beneficiaryCount * contributionPerStudent.' },
      { name: 'expectedCollection', type: 'int', notNull: true, desc: 'Total potential collection: enrolledCount * contributionPerStudent.' },
      { name: 'debtCount', type: 'int', notNull: true, default: '0', desc: 'Unpaid student count: enrolledCount - beneficiaryCount.' },
      { name: 'debtAmount', type: 'int', notNull: true, default: '0', desc: 'Total outstanding debt amount in PHP.' },
      { name: 'debtRecords', type: 'array', notNull: true, desc: 'Itemized list of unpaid students for collection follow-up.' },
      { name: 'status', type: 'string', notNull: true, default: 'for_verification', desc: 'Status: for_verification, verified, or discrepancy.' },
      { name: 'recordedByUid', type: 'string', notNull: false, ref: 'users.uid', desc: 'UID of mayor or representative recording collection.' },
      { name: 'submittedByName', type: 'string', notNull: true, desc: 'Full name of submitting representative.' },
      { name: 'submittedAt', type: 'timestamp', notNull: true, desc: 'Submission timestamp.' }
    ]
  },
  {
    name: 'deathAidRemittances',
    description: 'Physical cash remittances counted and certified by the Finance Secretary',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Remittance document ID identical to collectionId.' },
      { name: 'collectionId', type: 'string', notNull: true, ref: 'deathAidCollections.id', desc: 'Direct 1-to-1 foreign key to deathAidCollections document.' },
      { name: 'reportedAmount', type: 'int', notNull: true, desc: 'Cash amount claimed by submitting mayor.' },
      { name: 'amountReceived', type: 'int', notNull: true, desc: 'Physical cash counted and received by auditor.' },
      { name: 'difference', type: 'int', notNull: true, default: '0', desc: 'Cash variance: amountReceived - reportedAmount.' },
      { name: 'status', type: 'string', notNull: true, default: 'confirmed', desc: 'Remittance status: confirmed (diff == 0), discrepancy, or resolved.' },
      { name: 'receivedByUid', type: 'string', notNull: true, ref: 'users.uid', desc: 'UID of receiving Finance Officer certifying cash.' },
      { name: 'receivedAt', type: 'timestamp', notNull: true, desc: 'Physical cash counting timestamp.' }
    ]
  },
  {
    name: 'deathAidAuditLog',
    description: 'Append-only audit trail logging all Death Aid collection and cash certification actions',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique log document identifier.' },
      { name: 'collectionId', type: 'string', notNull: true, ref: 'deathAidCollections.id', desc: 'References the collection document being acted upon.' },
      { name: 'action', type: 'string', notNull: true, desc: 'Action descriptor: SUBMITTED, VERIFIED, or DISCREPANCY_RESOLVED.' },
      { name: 'actorUid', type: 'string', notNull: true, ref: 'users.uid', desc: 'UID of the acting officer.' },
      { name: 'actorName', type: 'string', notNull: true, desc: 'Display name of acting officer.' },
      { name: 'details', type: 'string', notNull: true, desc: 'Narrative description of action and cash totals.' },
      { name: 'timestamp', type: 'timestamp', notNull: true, desc: 'Server timestamp when action occurred.' }
    ]
  },
  {
    name: 'documents',
    description: 'Institutional document repository, AI OCR metadata, and multi-signatory approval chains',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique document archive identifier.' },
      { name: 'title', type: 'string', notNull: true, desc: 'Official document title (e.g., Resolution Authorizing FY2026 Budget).' },
      { name: 'documentNumber', type: 'string', notNull: true, desc: 'Official legislative control number (e.g. RES-2026-042).' },
      { name: 'type', type: 'string', notNull: true, desc: 'Document type: resolution, memorandum, financial_report, or letter.' },
      { name: 'category', type: 'string', notNull: true, desc: 'Category: Academic, Administrative, or Financial.' },
      { name: 'fileUrl', type: 'string', notNull: true, desc: 'Firebase Storage download URL.' },
      { name: 'storagePath', type: 'string', notNull: true, desc: 'Cloud storage bucket path for binary asset.' },
      { name: 'fileSize', type: 'int', notNull: true, desc: 'Document file size in bytes.' },
      { name: 'mimeType', type: 'string', notNull: true, default: 'application/pdf', desc: 'MIME type descriptor.' },
      { name: 'metadata', type: 'object', notNull: false, desc: 'AI OCR extracted summary, keywords, and detected dates.' },
      { name: 'signatories', type: 'array', notNull: true, desc: 'Ordered signatory approval chain with officer roles and sign timestamps.' },
      { name: 'status', type: 'string', notNull: true, default: 'draft', desc: 'Workflow status: draft, pending_review, signed, or archived.' },
      { name: 'authorId', type: 'string', notNull: true, ref: 'users.uid', desc: 'UID of authoring secretary or officer.' },
      { name: 'createdAt', type: 'timestamp', notNull: true, desc: 'Document ingestion timestamp.' }
    ]
  },
  {
    name: 'documentLabels',
    description: 'Taxonomy classification tags for organizing official university records',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique label identifier.' },
      { name: 'name', type: 'string', notNull: true, desc: 'Label tag title (e.g. Urgent, Executive, Confidential).' },
      { name: 'color', type: 'string', notNull: true, default: '#10b981', desc: 'Hexadecimal color indicator.' },
      { name: 'description', type: 'string', notNull: false, desc: 'Usage guidance.' }
    ]
  },
  {
    name: 'documentTemplates',
    description: 'Standardized administrative templates for resolutions, memorandums, and endorsements',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique template identifier.' },
      { name: 'name', type: 'string', notNull: true, desc: 'Template name.' },
      { name: 'content', type: 'string', notNull: true, desc: 'Markdown or rich-text template boilerplate.' },
      { name: 'schema', type: 'object', notNull: false, desc: 'Variable replacement definitions.' }
    ]
  },
  {
    name: 'users',
    description: 'Authenticated student and officer user profiles and role authorizations',
    columns: [
      { name: 'uid', type: 'string', pk: true, desc: 'Firebase Authentication unique user identifier.' },
      { name: 'email', type: 'string', notNull: true, desc: 'University email address (e.g., student@ctu.edu.ph).' },
      { name: 'displayName', type: 'string', notNull: true, desc: 'User full display name.' },
      { name: 'role', type: 'string', notNull: true, default: 'student', desc: 'System RBAC role: admin, president, finance_secretary, secretary, etc.' },
      { name: 'permissionOverrides', type: 'object', notNull: false, desc: 'Fine-grained capability flags granted by administrators.' },
      { name: 'createdAt', type: 'timestamp', notNull: true, desc: 'Account provisioning timestamp.' },
      { name: 'lastLogin', type: 'timestamp', notNull: false, desc: 'Most recent authentication timestamp.' }
    ]
  },
  {
    name: 'members',
    description: 'Student government officer and executive member public directory',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique member directory identifier.' },
      { name: 'userUid', type: 'string', notNull: false, ref: 'users.uid', desc: 'Optional link to authenticated users account.' },
      { name: 'fullName', type: 'string', notNull: true, desc: 'Officer full name.' },
      { name: 'position', type: 'string', notNull: true, desc: 'Official title: President, Senator, Governor, or Committee Head.' },
      { name: 'department', type: 'string', notNull: true, desc: 'College or committee affiliation.' },
      { name: 'academicYear', type: 'string', notNull: true, desc: 'Term of office (e.g. 2026-2027).' },
      { name: 'photoUrl', type: 'string', notNull: false, desc: 'Official portrait photo URL.' }
    ]
  },
  {
    name: 'organizations',
    description: 'Accredited student organizations and collegiate clubs registry',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique organization document identifier.' },
      { name: 'orgName', type: 'string', notNull: true, desc: 'Organization full title (e.g. Society of Information Technology Enthusiasts).' },
      { name: 'orgCode', type: 'string', notNull: true, desc: 'Organization acronym (e.g., SITE, COES).' },
      { name: 'college', type: 'string', notNull: true, desc: 'College department affiliation.' },
      { name: 'presidentName', type: 'string', notNull: true, desc: 'Current student leader name.' },
      { name: 'adviserName', type: 'string', notNull: true, desc: 'Faculty adviser full name.' },
      { name: 'status', type: 'string', notNull: true, default: 'accredited', desc: 'Accreditation status: accredited or probationary.' }
    ]
  },
  {
    name: 'audit_logs',
    description: 'Immutable system-wide security, access, and data manipulation audit trail',
    columns: [
      { name: 'id', type: 'string', pk: true, desc: 'Unique audit log document identifier.' },
      { name: 'action', type: 'string', notNull: true, desc: 'Operation code: LOGIN, REVERSE_TX, DELETE_RECORD, UPDATE_STOCK.' },
      { name: 'actorId', type: 'string', notNull: true, ref: 'users.uid', desc: 'UID of user performing action.' },
      { name: 'actorName', type: 'string', notNull: true, desc: 'Display name of acting officer.' },
      { name: 'targetResource', type: 'string', notNull: true, desc: 'Collection target: orders, fundAccounts, inventory, documents.' },
      { name: 'resourceId', type: 'string', notNull: true, desc: 'Identifier of modified resource.' },
      { name: 'details', type: 'string', notNull: true, desc: 'Complete operation payload and delta.' },
      { name: 'timestamp', type: 'timestamp', notNull: true, desc: 'Immutable server log timestamp.' }
    ]
  }
];

const targetDir = path.resolve('Obisidian Documentation', 'db-atlas');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

for (const t of tables) {
  let frontmatter = '---\n';
  frontmatter += `table_description: "${t.description.replace(/"/g, '\\"')}"\n`;

  for (const col of t.columns) {
    const config = {
      type: col.type
    };
    if (col.pk) config.pk = true;
    if (col.notNull) config.notNull = true;
    if (col.default !== undefined) config.default = col.default;
    if (col.ref) config.ref = col.ref;

    frontmatter += `col_${col.name}: '${JSON.stringify(config)}'\n`;
  }
  frontmatter += '---\n\n';

  let body = `# ${t.name}\n\n`;
  body += `> [!abstract] Table Overview\n`;
  body += `> ${t.description}.\n\n`;
  body += `### Field Specifications\n\n`;

  for (const col of t.columns) {
    body += `## ${col.name}\n`;
    body += `* **Type:** \`${col.type}\`\n`;
    body += `* **Constraints:** ${col.pk ? '`PRIMARY KEY`' : ''}${col.notNull ? ' `NOT NULL`' : ''}${col.ref ? ` \`REFERENCES ${col.ref}\`` : ''}${col.default ? ` (Default: \`${col.default}\`)` : ''}\n`;
    body += `* **Description:** ${col.desc}\n\n`;
  }

  const filePath = path.join(targetDir, `${t.name}.md`);
  fs.writeFileSync(filePath, frontmatter + body, 'utf8');
  console.log(`Generated DB Atlas note: ${filePath}`);
}

console.log('Successfully generated all DB Atlas notes.');
