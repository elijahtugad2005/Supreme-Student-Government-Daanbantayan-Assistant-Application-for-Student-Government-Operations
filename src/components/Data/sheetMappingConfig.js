/**
 * ============================================================
 * Google Sheets & Excel → Firebase Field Mapping Configuration
 * ============================================================
 *
 * Each collection defines:
 *   - collection: Firestore collection name
 *   - label: UI display name
 *   - keyField: the Firebase field used to match existing docs (for upsert)
 *   - defaultKeyColumn: Default column header fallback
 *   - fieldDefinitions: Detailed mapping info with keyword detection aliases,
 *       importance level, and transformers.
 */

// ────────────────────────────────────────────────────────────
// ORDERS MAPPING SPECIFICATION
// ────────────────────────────────────────────────────────────
export const ordersMapping = {
  collection: 'orders',
  label: 'Orders',
  keyField: 'orderId',
  keySheetColumn: 'Product Order ID',

  // Canonical field mappings (field path -> default display header)
  fieldMappings: {
    // Primary Key & Status
    'orderId':                      'Product Order ID',
    'orderStatus':                  'Order Status',

    // Customer Information (CRITICAL: Full Name, Email, Phone, etc.)
    'customerInfo.fullName':        'Full Name',
    'customerInfo.email':           'Email Address',
    'customerInfo.phoneNumber':     'Contact Number',
    'customerInfo.schoolID':        'School ID',
    'customerInfo.bachelorDegree':  'Bachelor Degree',
    'customerInfo.section':         'Section',
    'customerInfo.address':         'Address',

    // Product Information
    'productInfo.productId':        'Product ID',
    'productInfo.productName':      'Product Name',
    'productInfo.quantity':         'Quantity',
    'productInfo.pricePerUnit':     'Price Per Unit',
    'productInfo.totalPrice':       'Total Price',
    'productInfo.size':             'Size',
    'productInfo.color':            'Color',

    // Payment & Logistics
    'paymentInfo.paymentMethod':     'Payment Method',
    'paymentInfo.onlinePaymentType': 'Online Payment Type',
    'paymentInfo.referenceNumber':   'Reference Number',
  },

  // Keyword dictionary for dynamic detection algorithm
  // Matches headers case-insensitively, stripping punctuation and extra spaces
  fieldAliases: {
    'orderId': [
      'product order id', 'order id', 'orderid', 'order number', 'order no', 'order #', 'order_id', 'ord id', 'id'
    ],
    'orderStatus': [
      'order status', 'status', 'order state', 'state', 'order_status'
    ],

    // Customer detection keywords (matches "FULL NAME", "NAME", "CUSTOMER", etc.)
    'customerInfo.fullName': [
      'full name', 'fullname', 'name', 'customer name', 'customer', 'buyer name', 'buyer', 'client name', 'client', 'student name', 'student', 'attendee name'
    ],
    // Email detection keywords (matches "EMAIL", "EMAIL ADDRESS", "E-MAIL", etc.)
    'customerInfo.email': [
      'email', 'email address', 'e-mail', 'e-mail address', 'mail', 'gmail', 'customer email', 'buyer email', 'contact email'
    ],
    // Contact Number detection keywords (matches "CONTACT", "PHONE", "MOBILE", etc.)
    'customerInfo.phoneNumber': [
      'contact number', 'contact no', 'contact', 'phone number', 'phone', 'cellphone', 'mobile number', 'mobile', 'tel', 'telephone', 'phone no'
    ],
    'customerInfo.schoolID': [
      'school id', 'school id number', 'student id', 'student number', 'id number', 'id no', 'student_id', 'school_id'
    ],
    'customerInfo.bachelorDegree': [
      'bachelor degree', 'degree', 'course', 'program', 'department', 'major', 'college degree'
    ],
    'customerInfo.section': [
      'section', 'year and section', 'yr and sec', 'year & section', 'class', 'yr/sec', 'year level'
    ],
    'customerInfo.address': [
      'address', 'home address', 'shipping address', 'delivery address', 'location', 'residence'
    ],

    // Product detection keywords
    'productInfo.productId': [
      'product id', 'item id', 'prod id', 'sku', 'product code', 'item code'
    ],
    'productInfo.productName': [
      'product name', 'product', 'item name', 'item', 'merchandise', 'article', 'description of item'
    ],
    'productInfo.quantity': [
      'quantity', 'qty', 'count', 'number of items', 'pcs', 'pieces', 'amount ordered'
    ],
    'productInfo.pricePerUnit': [
      'price per unit', 'unit price', 'price', 'unit cost', 'item price', 'cost per unit', 'rate'
    ],
    'productInfo.totalPrice': [
      'total price', 'total amount', 'total', 'grand total', 'subtotal', 'overall total', 'amount', 'total pay'
    ],
    'productInfo.size': [
      'size', 'item size', 'product size', 'dimension', 'variant size'
    ],
    'productInfo.color': [
      'color', 'colour', 'variant color', 'item color', 'shade'
    ],

    // Payment detection keywords
    'paymentInfo.paymentMethod': [
      'payment method', 'mode of payment', 'mop', 'payment type', 'method of payment', 'payment mode'
    ],
    'paymentInfo.onlinePaymentType': [
      'online payment type', 'payment channel', 'gateway', 'e-wallet', 'bank', 'provider'
    ],
    'paymentInfo.referenceNumber': [
      'reference number', 'ref number', 'reference no', 'ref no', 'ref #', 'transaction id', 'txn id', 'reference'
    ],
  },

  // Priority / Importance (for algorithm matching and badge display)
  importantFields: [
    'customerInfo.fullName',
    'customerInfo.email',
    'customerInfo.phoneNumber',
    'productInfo.productName',
    'productInfo.quantity',
    'productInfo.totalPrice',
    'orderId',
  ],

  defaultValues: {
    orderStatus: 'Pending',
    'paymentInfo.paymentMethod': 'Cash',
    'productInfo.quantity': 1,
  },

  transformers: {
    'productInfo.quantity':    (v) => {
      const parsed = parseInt(v, 10);
      return isNaN(parsed) || parsed < 1 ? 1 : parsed;
    },
    'productInfo.pricePerUnit':(v) => {
      if (typeof v === 'number') return v;
      const clean = String(v).replace(/[^0-9.-]+/g, '');
      const parsed = parseFloat(clean);
      return isNaN(parsed) ? 0 : parsed;
    },
    'productInfo.totalPrice':  (v) => {
      if (typeof v === 'number') return v;
      const clean = String(v).replace(/[^0-9.-]+/g, '');
      const parsed = parseFloat(clean);
      return isNaN(parsed) ? 0 : parsed;
    },
    'productInfo.productName': (v) => {
      if (!v) return 'N/A';
      const str = String(v).trim();
      // Match patterns like "SET A", "SET B REGULAR", "SET C OVERSIZED", "UNIFORM SET A", etc.
      if (/\bset\s+[a-z0-9]+/i.test(str) || /\buniform(s)?\b/i.test(str)) {
        return 'CTU UNIFORMS';
      }
      return str;
    },
    'productInfo.size':        (v) => (v ? String(v).trim() : 'N/A'),
    'productInfo.color':       (v) => (v ? String(v).trim() : 'N/A'),
    'customerInfo.fullName':   (v) => (v ? String(v).trim() : 'Anonymous Customer'),
    'customerInfo.email':      (v) => (v ? String(v).trim() : ''),
    'customerInfo.phoneNumber':(v) => (v ? String(v).trim() : ''),
  },
};

// ────────────────────────────────────────────────────────────
// PRODUCTS MAPPING SPECIFICATION
// ────────────────────────────────────────────────────────────
export const productsMapping = {
  collection: 'products',
  label: 'Products',
  keyField: 'productId',
  keySheetColumn: 'Product ID',

  fieldMappings: {
    'productId':       'Product ID',
    'productName':     'Product Name',
    'description':     'Description',
    'price':           'Price',
    'stockAvailable':  'Stock Available',
    'supplier':        'Supplier',
  },

  fieldAliases: {
    'productId':      ['product id', 'product_id', 'id', 'item id', 'prod id', 'sku', 'code'],
    'productName':    ['product name', 'product', 'item name', 'item', 'title', 'merchandise'],
    'description':    ['description', 'desc', 'details', 'item description', 'about'],
    'price':          ['price', 'unit price', 'cost', 'selling price', 'amount', 'rate'],
    'stockAvailable': ['stock available', 'stock', 'quantity', 'qty', 'inventory', 'available stock', 'in stock'],
    'supplier':       ['supplier', 'vendor', 'manufacturer', 'source', 'brand'],
  },

  importantFields: [
    'productId',
    'productName',
    'price',
    'stockAvailable',
  ],

  defaultValues: {
    hasVariations: false,
    sizeOptions: [],
    colorVariations: [],
    customVariations: [],
    imageUrl: '',
    imageBase64: '',
  },

  transformers: {
    'price': (v) => {
      if (typeof v === 'number') return v;
      const clean = String(v).replace(/[^0-9.-]+/g, '');
      const parsed = parseFloat(clean);
      return isNaN(parsed) ? 0 : parsed;
    },
    'stockAvailable': (v) => {
      const parsed = parseInt(v, 10);
      return isNaN(parsed) ? 0 : parsed;
    },
  },
};

// ────────────────────────────────────────────────────────────
// ALL MAPPINGS
// ────────────────────────────────────────────────────────────
export const allMappings = {
  orders:   ordersMapping,
  products: productsMapping,
};
