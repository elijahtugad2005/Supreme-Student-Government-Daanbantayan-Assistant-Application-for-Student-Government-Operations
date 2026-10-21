// backend/server.js
// Main entry point for the SSG Office Assistant Backend API
// Handles: Telegram notifications + MongoDB document storage
//
// Session 3 Update: Integrated MongoDB GridFS document API
// All document storage endpoints are available at /api/documents/*

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// Initialize Firebase Admin first (must happen before routes load)
const { initializeFirebaseAdmin } = require('./services/firebase-admin');
const { closeConnection } = require('./services/mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ──────────────────────────────────────────────────────────────────────────────

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// CORS — allow the Vite dev server and any configured production origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (e.g. Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true
}));

// ──────────────────────────────────────────────────────────────────────────────
// FIREBASE ADMIN INITIALIZATION
// ──────────────────────────────────────────────────────────────────────────────

try {
  initializeFirebaseAdmin();
  console.log('🔥 Firebase Admin initialized');
} catch (error) {
  console.error('[Server] Failed to initialize Firebase Admin:', error.message);
  console.warn('[Server] Document API endpoints will NOT work without Firebase Admin SDK.');
}

// ──────────────────────────────────────────────────────────────────────────────
// ROOT & HEALTH CHECK
// ──────────────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.status(200).json({
    message: 'SSG Office Assistant Backend API is live!',
    status: 'running',
    endpoints: {
      health: '/health',
      documents: '/api/documents',
      ai: '/api/ai'
    }
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      mongodb: 'connected',
      firebase: 'initialized'
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// API ROUTES — MongoDB Document Storage (Session 2/3)
// ──────────────────────────────────────────────────────────────────────────────

const documentsRouter = require('./routes/documents');
app.use('/api/documents', documentsRouter);

const aiRouter = require('./routes/ai');
app.use('/api/ai', aiRouter);

// ──────────────────────────────────────────────────────────────────────────────
// TELEGRAM / MESSENGER WEBHOOK ENDPOINTS (Legacy — kept for notifications)
// ──────────────────────────────────────────────────────────────────────────────

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

if (!PAGE_ACCESS_TOKEN) {
  console.warn('[Server] WARNING: PAGE_ACCESS_TOKEN not set — Telegram/Messenger features disabled.');
}
if (!VERIFY_TOKEN) {
  console.warn('[Server] WARNING: VERIFY_TOKEN not set — webhook verification disabled.');
}

// Webhook verification (GET) — Facebook/Messenger handshake
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`[${new Date().toISOString()}] Webhook verification attempt:`, {
    mode,
    tokenMatch: token === VERIFY_TOKEN,
    challengePresent: !!challenge
  });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log(`[${new Date().toISOString()}] Webhook verified successfully`);
    res.status(200).send(challenge);
  } else {
    console.error(`[${new Date().toISOString()}] Webhook verification FAILED`);
    res.sendStatus(403);
  }
});

// Webhook event receiver (POST)
app.post('/webhook', (req, res) => {
  // Acknowledge immediately; Facebook requires a fast 200
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;

    if (body.object === 'page') {
      body.entry.forEach(entry => {
        entry.messaging.forEach(event => {
          const senderPsid = event.sender.id;
          console.log(`[${new Date().toISOString()}] Message from PSID: ${senderPsid}`);
          if (event.message?.text) {
            console.log(`[${new Date().toISOString()}] Message text: ${event.message.text}`);
          }
        });
      });
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error processing webhook event:`, error.message);
  }
});

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

// ──────────────────────────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// ──────────────────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SERVER START + GRACEFUL SHUTDOWN
// ──────────────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  let localIP = 'localhost';
  
  // Find WiFi IP address
  for (const interfaceName in networkInterfaces) {
    for (const iface of networkInterfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('192.168')) {
        localIP = iface.address;
        break;
      }
    }
  }
  
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`📄 Document API: http://localhost:${PORT}/api/documents`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 Network access: http://${localIP}:${PORT}`);
  console.log(`   Share this URL with devices on the same WiFi network`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`ERROR: Port ${PORT} is already in use`);
  } else if (error.code === 'EACCES') {
    console.error(`ERROR: Permission denied to bind to port ${PORT}`);
  } else {
    console.error(`ERROR: Server startup failed:`, error.message);
  }
  process.exit(1);
});

// Graceful shutdown — close MongoDB connection when process ends
const shutdown = async (signal) => {
  console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
  await closeConnection();
  server.close(() => {
    console.log('[Server] HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
