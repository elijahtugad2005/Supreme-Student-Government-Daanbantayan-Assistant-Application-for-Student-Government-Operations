/**
 * backend/routes/orders.js
 * Public commerce endpoints protected by authoritative catalog validation,
 * PII masking, secondary tracking verification, and IP rate limiting.
 */

const express = require('express');
const { getFirestore } = require('../services/firebase-admin');
const {
  OrderValidationError,
  createAuthoritativeOrder,
  lookupPublicOrder,
  createRateLimiter,
} = require('../services/orderService');

const router = express.Router();

const createOrderLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
const trackOrderLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40 });

/**
 * POST /api/orders
 * Creates a public student merchandise order using authoritative server-side pricing.
 */
router.post('/', createOrderLimiter, async (req, res) => {
  try {
    const db = getFirestore();
    const created = await createAuthoritativeOrder(db, req.body || {});
    return res.status(201).json({
      success: true,
      order: created,
    });
  } catch (err) {
    if (err instanceof OrderValidationError) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
      });
    }
    console.error('[OrdersRoute] POST /api/orders failed:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Could not place your order right now. Please try again shortly.',
    });
  }
});

/**
 * GET /api/orders/track?orderId=ORD-DB-0001&verifier=<schoolID|email|trackingCode>
 * Returns masked, privacy-safe status & item details only when both orderId and verifier match.
 */
router.get('/track', trackOrderLimiter, async (req, res) => {
  try {
    const orderId = String(req.query.orderId || '').trim();
    const verifier = String(req.query.verifier || '').trim();

    if (!orderId || !verifier) {
      return res.status(400).json({
        success: false,
        error: 'Both Order ID and Student ID (or Email / Tracking Code) are required.',
      });
    }

    const db = getFirestore();
    const maskedOrder = await lookupPublicOrder(db, { orderId, verifier });

    if (!maskedOrder) {
      return res.status(404).json({
        success: false,
        error: 'No matching order found. Please check your Order ID and Student ID / Email.',
      });
    }

    return res.status(200).json({
      success: true,
      order: maskedOrder,
    });
  } catch (err) {
    console.error('[OrdersRoute] GET /api/orders/track failed:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to check order status right now. Please try again shortly.',
    });
  }
});

module.exports = router;
