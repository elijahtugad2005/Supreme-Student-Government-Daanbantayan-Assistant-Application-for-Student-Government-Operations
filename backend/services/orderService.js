/**
 * backend/services/orderService.js
 * Authoritative server-side commerce order creation & privacy-safe masked order tracking.
 *
 * Security invariants enforced server-side:
 *  - Client-supplied `pricePerUnit`, `totalPrice`, and `orderStatus` are IGNORED.
 *  - Unit price is computed strictly from Firestore `products` (`price`, `sizePrices`, `customVariations`).
 *  - Public orders ALWAYS start in `orderStatus: 'Pending'` (never self-marked `'Online Paid'`).
 *  - Public order tracking requires `orderId` + secondary verifier (`schoolID`, `email`, or `trackingCode`)
 *    and strips/masks all sensitive student PII (email, phone, address, full name, full ID, full ref #).
 */

const crypto = require('crypto');

const MAX_ORDER_QTY = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class OrderValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'OrderValidationError';
    this.statusCode = statusCode;
  }
}

function toPositivePrice(value) {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100) / 100;
}

function lookupPriceInMap(priceMap, key) {
  if (!priceMap || typeof priceMap !== 'object' || !key) return null;
  if (Object.prototype.hasOwnProperty.call(priceMap, key)) {
    return toPositivePrice(priceMap[key]);
  }
  const norm = String(key).trim().toLowerCase();
  for (const [k, v] of Object.entries(priceMap)) {
    if (String(k).trim().toLowerCase() === norm) {
      return toPositivePrice(v);
    }
  }
  return null;
}

function resolveAuthoritativeUnitPrice(product, { size = '', selectedCustomVariations = {} } = {}) {
  const basePrice = toPositivePrice(product?.price) || 0;
  if (size) {
    const sizePrice = lookupPriceInMap(product.sizePrices, size);
    if (sizePrice !== null) return sizePrice;
  }
  if (
    selectedCustomVariations &&
    typeof selectedCustomVariations === 'object' &&
    Array.isArray(product.customVariations)
  ) {
    for (const variation of product.customVariations) {
      if (!variation?.type || !Array.isArray(variation.options)) continue;
      const chosen = selectedCustomVariations[variation.type];
      if (!chosen) continue;
      const opt = variation.options.find(
        (o) => String(o?.name || '').trim().toLowerCase() === String(chosen).trim().toLowerCase()
      );
      const optPrice = toPositivePrice(opt?.price);
      if (optPrice !== null) return optPrice;
    }
  }
  return basePrice;
}

function maskFullName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'Student';
  return parts
    .map((p) => (p.length <= 1 ? `${p}*` : `${p[0]}***`))
    .join(' ');
}

function maskTail(value, visible = 4) {
  const clean = String(value || '').trim();
  if (!clean) return null;
  if (clean.length <= visible) return '*'.repeat(clean.length);
  return `${'*'.repeat(Math.max(4, clean.length - visible))}${clean.slice(-visible)}`;
}

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

async function generateSequentialOrderId(db) {
  const counterRef = db.collection('settings').doc('orderCounters');
  try {
    if (typeof db.runTransaction === 'function') {
      const nextNum = await db.runTransaction(async (tx) => {
        const snap = await tx.get(counterRef);
        let current = snap.exists ? Number(snap.data()?.lastOrderNumber || 0) : 0;
        if (!Number.isFinite(current) || current <= 0) {
          // Seed from latest existing order if counter has never been initialized
          const latestSnap = await db
            .collection('orders')
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
          if (!latestSnap.empty) {
            const lastId = String(latestSnap.docs[0].data()?.orderId || '');
            const m = lastId.match(/^ORD-DB-(\d+)$/);
            if (m) current = parseInt(m[1], 10) || 0;
          }
        }
        const next = current + 1;
        tx.set(counterRef, { lastOrderNumber: next, updatedAt: new Date().toISOString() }, { merge: true });
        return next;
      });
      return `ORD-DB-${String(nextNum).padStart(4, '0')}`;
    }
  } catch (err) {
    console.warn('[OrderService] Counter transaction fallback:', err.message);
  }
  return `ORD-DB-${Date.now()}`;
}

async function findCatalogProduct(db, productId) {
  const trimmed = String(productId || '').trim();
  if (!trimmed) return null;

  // Match by explicit `productId` field first
  const byField = await db
    .collection('products')
    .where('productId', '==', trimmed)
    .limit(1)
    .get();
  if (!byField.empty) {
    const doc = byField.docs[0];
    return { docId: doc.id, ...doc.data() };
  }

  // Fallback to Firestore document ID
  const byDoc = await db.collection('products').doc(trimmed).get();
  if (byDoc.exists) {
    return { docId: byDoc.id, ...byDoc.data() };
  }
  return null;
}

/**
 * Validates and persists a public student merchandise order using authoritative Firestore catalog prices.
 */
async function createAuthoritativeOrder(db, payload = {}) {
  const fullName = String(payload.fullName || '').trim();
  const bachelorDegree = String(payload.bachelorDegree || '').trim();
  const section = String(payload.section || '').trim();
  const address = String(payload.address || '').trim();
  const email = String(payload.email || '').trim();
  const phoneNumber = String(payload.phoneNumber || '').trim();
  const schoolID = String(payload.schoolID || '').trim();
  const productId = String(payload.productId || '').trim();
  const size = String(payload.size || '').trim();
  const color = String(payload.color || '').trim();
  const customVariations =
    payload.customVariations && typeof payload.customVariations === 'object'
      ? payload.customVariations
      : {};
  const quantity = parseInt(payload.quantity, 10);
  const paymentMethod = payload.paymentMethod === 'Online' ? 'Online' : 'Cash';
  const onlinePaymentType = String(payload.onlinePaymentType || '').trim();
  const referenceNumber = String(payload.referenceNumber || '').trim();

  if (!fullName) throw new OrderValidationError('Full name is required.');
  if (!bachelorDegree) throw new OrderValidationError('Degree program is required.');
  if (!section) throw new OrderValidationError('Year level is required.');
  if (!address) throw new OrderValidationError('Campus or delivery address is required.');
  if (!email || !EMAIL_RE.test(email)) throw new OrderValidationError('Valid email address is required.');
  if (!schoolID) throw new OrderValidationError('Student / School ID is required.');
  if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 10) {
    throw new OrderValidationError('Valid mobile number (at least 10 digits) is required.');
  }
  if (!productId) throw new OrderValidationError('Please select a product.');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QTY) {
    throw new OrderValidationError(`Quantity must be an integer between 1 and ${MAX_ORDER_QTY}.`);
  }

  if (paymentMethod === 'Online') {
    if (!['GCash', 'PayMaya'].includes(onlinePaymentType)) {
      throw new OrderValidationError('Select a valid e-wallet provider (GCash or PayMaya).');
    }
    if (!referenceNumber || referenceNumber.length < 4) {
      throw new OrderValidationError('Transaction reference number is required for online payment.');
    }
  }

  const product = await findCatalogProduct(db, productId);
  if (!product) {
    throw new OrderValidationError('Selected product was not found in the catalog.', 404);
  }

  const stockAvailable = Number(product.stockAvailable) || 0;
  if (stockAvailable < quantity) {
    throw new OrderValidationError(
      `Insufficient stock! Only ${stockAvailable} unit(s) available.`,
      409
    );
  }

  // Validate size against catalog options
  if (Array.isArray(product.sizeOptions) && product.sizeOptions.length > 0) {
    if (!size) throw new OrderValidationError('Please select a size.');
    const matchedSize = product.sizeOptions.find(
      (s) => String(s).trim().toLowerCase() === size.toLowerCase()
    );
    if (!matchedSize) {
      throw new OrderValidationError(`Invalid size "${size}" for this product.`);
    }
  }

  // Validate color against catalog options
  if (Array.isArray(product.colorVariations) && product.colorVariations.length > 0) {
    if (!color) throw new OrderValidationError('Please select a color variation.');
    const matchedColor = product.colorVariations.find(
      (c) => String(c).trim().toLowerCase() === color.toLowerCase()
    );
    if (!matchedColor) {
      throw new OrderValidationError(`Invalid color "${color}" for this product.`);
    }
  }

  // Validate custom variations
  const sanitizedCustomVars = {};
  if (Array.isArray(product.customVariations)) {
    for (const variation of product.customVariations) {
      if (!variation?.type || !Array.isArray(variation.options) || variation.options.length === 0) {
        continue;
      }
      const chosen = String(customVariations[variation.type] || '').trim();
      if (!chosen) {
        throw new OrderValidationError(`Please select a ${variation.type}.`);
      }
      const validOpt = variation.options.find(
        (o) => String(o?.name || '').trim().toLowerCase() === chosen.toLowerCase()
      );
      if (!validOpt) {
        throw new OrderValidationError(`Invalid ${variation.type} option "${chosen}".`);
      }
      sanitizedCustomVars[variation.type] = validOpt.name;
    }
  }

  const unitPrice = resolveAuthoritativeUnitPrice(product, {
    size,
    selectedCustomVariations: sanitizedCustomVars,
  });
  if (unitPrice <= 0) {
    throw new OrderValidationError('Product pricing is unavailable. Please contact the SSG office.', 422);
  }

  const totalPrice = (Math.round(unitPrice * 100) * quantity) / 100;
  const orderId = await generateSequentialOrderId(db);
  const trackingCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  const now = new Date();

  const orderRecord = {
    orderId,
    trackingCode,
    customerInfo: {
      fullName,
      bachelorDegree,
      section,
      address,
      email,
      emailLower: email.toLowerCase(),
      phoneNumber,
      schoolID,
      schoolIdNormalized: normalizeId(schoolID),
    },
    productInfo: {
      productId: product.productId || product.docId,
      productName: product.productName || 'SSG Merchandise',
      size: size || 'N/A',
      color: color || 'N/A',
      ...(Object.keys(sanitizedCustomVars).length > 0
        ? { customVariations: sanitizedCustomVars }
        : {}),
      quantity,
      pricePerUnit: unitPrice,
      totalPrice,
    },
    paymentInfo: {
      paymentMethod,
      onlinePaymentType: paymentMethod === 'Online' ? onlinePaymentType : null,
      referenceNumber: paymentMethod === 'Online' ? referenceNumber : null,
      verificationStatus:
        paymentMethod === 'Online' ? 'pending_verification' : 'cash_on_pickup',
    },
    // Public checkout NEVER self-marks 'Online Paid' — SSG officer verifies & settles in OrderManagement
    orderStatus: 'Pending',
    igfSynced: false,
    stockReserved: false,
    stockClaimDeducted: false,
    source: 'PUBLIC_SERVER_CHECKOUT',
    dateOrdered: now,
    createdAt: now,
    updatedAt: now,
  };

  let createdDocId;
  const ordersCol = db.collection('orders');
  const productsCol = db.collection('products');
  if (
    typeof db.runTransaction === 'function' &&
    typeof ordersCol.doc === 'function' &&
    typeof productsCol.doc === 'function' &&
    product.docId
  ) {
    const productRef = productsCol.doc(product.docId);
    createdDocId = await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(productRef);
      if (!freshSnap.exists) {
        throw new OrderValidationError('Selected product was not found in the catalog.', 404);
      }
      const freshStock = Number(freshSnap.data()?.stockAvailable) || 0;
      if (freshStock < quantity) {
        throw new OrderValidationError(
          `Insufficient stock! Only ${freshStock} unit(s) available.`,
          409
        );
      }
      tx.update(productRef, {
        stockAvailable: freshStock - quantity,
        updatedAt: now.toISOString(),
      });
      const newOrderRef = ordersCol.doc();
      const reservedRecord = {
        ...orderRecord,
        stockReserved: true,
        stockClaimDeducted: true,
      };
      tx.set(newOrderRef, reservedRecord);
      return newOrderRef.id;
    });
  } else {
    const docRef = await ordersCol.add(orderRecord);
    createdDocId = docRef.id;
  }

  return {
    docId: createdDocId,
    orderId,
    trackingCode,
    orderStatus: orderRecord.orderStatus,
    productInfo: orderRecord.productInfo,
    paymentInfo: {
      paymentMethod: orderRecord.paymentInfo.paymentMethod,
      onlinePaymentType: orderRecord.paymentInfo.onlinePaymentType,
      verificationStatus: orderRecord.paymentInfo.verificationStatus,
    },
    dateOrdered: now.toISOString(),
  };
}

/**
 * Strips sensitive PII from an order document for safe public tracking display.
 */
function maskOrderForPublicTracking(order) {
  if (!order) return null;
  const cust = order.customerInfo || {};
  const prod = order.productInfo || {};
  const pay = order.paymentInfo || {};

  const toIso = (v) => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };

  return {
    orderId: order.orderId,
    orderStatus: order.orderStatus || 'Pending',
    dateOrdered: toIso(order.dateOrdered || order.createdAt),
    updatedAt: toIso(order.updatedAt),
    customerInfo: {
      fullName: maskFullName(cust.fullName),
      bachelorDegree: cust.bachelorDegree || 'N/A',
      section: cust.section || 'N/A',
      schoolID: maskTail(cust.schoolID, 4) || '****',
    },
    productInfo: {
      productName: prod.productName || 'SSG Merchandise',
      size: prod.size || 'N/A',
      color: prod.color || 'N/A',
      ...(prod.customVariations ? { customVariations: prod.customVariations } : {}),
      quantity: Number(prod.quantity) || 1,
      pricePerUnit: Number(prod.pricePerUnit) || 0,
      totalPrice: Number(prod.totalPrice) || 0,
    },
    paymentInfo: {
      paymentMethod: pay.paymentMethod || 'Cash',
      onlinePaymentType: pay.onlinePaymentType || null,
      verificationStatus: pay.verificationStatus || null,
      referenceNumber: pay.referenceNumber ? maskTail(pay.referenceNumber, 4) : null,
    },
  };
}

/**
 * Looks up a single order by `orderId` AND requires a matching `verifier`
 * (`schoolID`, `email`, or `trackingCode`) so sequential Order IDs cannot be scraped.
 */
async function lookupPublicOrder(db, { orderId, verifier } = {}) {
  const cleanOrderId = String(orderId || '').trim().toUpperCase();
  const cleanVerifier = normalizeId(verifier);
  if (!cleanOrderId || !cleanVerifier) {
    return null;
  }

  const snap = await db
    .collection('orders')
    .where('orderId', '==', cleanOrderId)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const order = snap.docs[0].data();
  const cust = order.customerInfo || {};

  const validVerifiers = [
    normalizeId(cust.schoolID),
    normalizeId(cust.schoolIdNormalized),
    normalizeId(cust.email),
    normalizeId(cust.emailLower),
    normalizeId(order.trackingCode),
  ].filter(Boolean);

  if (!validVerifiers.includes(cleanVerifier)) {
    return null;
  }

  return maskOrderForPublicTracking(order);
}

/**
 * Lightweight zero-dependency sliding-window rate limiter middleware.
 * Uses Express's proxy-aware req.ip (never raw spoofable X-Forwarded-For)
 * and enforces an O(1) hard LRU cap (`maxKeys`) to prevent memory exhaustion.
 */
function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 25,
  maxKeys = 5000,
  keyGenerator = null,
} = {}) {
  const hits = new Map();

  const middleware = (req, res, next) => {
    const rawKey =
      typeof keyGenerator === 'function'
        ? keyGenerator(req)
        : req.ip || req.socket?.remoteAddress || 'unknown';
    const key = String(rawKey || 'unknown').trim().slice(0, 128) || 'unknown';

    const now = Date.now();
    const recent = (hits.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= max) {
      hits.delete(key);
      hits.set(key, recent);
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please wait a few minutes and try again.',
      });
    }
    recent.push(now);
    hits.delete(key);
    hits.set(key, recent);

    while (hits.size > maxKeys) {
      const oldestKey = hits.keys().next().value;
      if (oldestKey === undefined) break;
      hits.delete(oldestKey);
    }
    return next();
  };

  middleware._size = () => hits.size;
  return middleware;
}

module.exports = {
  OrderValidationError,
  resolveAuthoritativeUnitPrice,
  createAuthoritativeOrder,
  maskOrderForPublicTracking,
  lookupPublicOrder,
  createRateLimiter,
};
