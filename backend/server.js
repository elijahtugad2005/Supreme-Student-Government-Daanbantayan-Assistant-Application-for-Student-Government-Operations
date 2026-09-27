// Main entry point for the Messenger Notification Bridge backend server
// This server handles webhook verification, receives Messenger events, and sends messages via the Messenger Platform API

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Environment variables
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Validate required environment variables
if (!PAGE_ACCESS_TOKEN) {
  console.error('ERROR: PAGE_ACCESS_TOKEN environment variable is not set');
  process.exit(1);
}

if (!VERIFY_TOKEN) {
  console.error('ERROR: VERIFY_TOKEN environment variable is not set');
  process.exit(1);
}
// Webhook verification endpoint
// Facebook sends a GET request to verify the webhook subscription
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  // Log verification attempt
  console.log(`[${new Date().toISOString()}] [INFO] Webhook verification attempt:`, {
    mode: mode,
    tokenMatch: token === VERIFY_TOKEN,
    challengePresent: !!challenge
  });
  
  // Validate hub.mode equals "subscribe" and hub.verify_token matches VERIFY_TOKEN
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log(`[${new Date().toISOString()}] [INFO] Webhook verified successfully`);
    // Return 200 with hub.challenge on successful verification
    res.status(200).send(challenge);
  } else {
    // Return 403 on verification failure
    console.error(`[${new Date().toISOString()}] [ERROR] Webhook verification failed:`, {
      receivedMode: mode,
      expectedMode: 'subscribe',
      tokenMatch: token === VERIFY_TOKEN
    });
    res.sendStatus(403);
  }
});

// Webhook event receiver endpoint
// Facebook sends POST requests with Messenger events to this endpoint
app.post('/webhook', (req, res) => {
  // Respond with 200 OK immediately (Facebook requires quick acknowledgment)
  res.status(200).send('EVENT_RECEIVED');
  
  // Process webhook payload asynchronously
  try {
    const body = req.body;
    
    // Check if payload.object equals "page"
    if (body.object === 'page') {
      // Iterate through entry array
      body.entry.forEach(entry => {
        // Iterate through messaging events
        entry.messaging.forEach(event => {
          // Extract sender.id (PSID) from each messaging event
          const senderPsid = event.sender.id;
          
          // Log PSID with format "Received message from PSID: {psid}"
          console.log(`[${new Date().toISOString()}] [INFO] Received message from PSID: ${senderPsid}`);
          
          // Extract and log message.text if present
          if (event.message && event.message.text) {
            console.log(`[${new Date().toISOString()}] [INFO] Message text: ${event.message.text}`);
          }
        });
      });
    }
  } catch (error) {
    // Wrap processing logic in try-catch to prevent errors after 200 response
    console.error(`[${new Date().toISOString()}] [ERROR] Error processing webhook event:`, error.message);
  }
});

// TODO: Add message sending endpoint (POST /send-message)
// TODO: Add error handling middleware

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

// Error handling for server startup failures
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
