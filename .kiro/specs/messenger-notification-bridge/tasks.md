# Implementation Plan: Messenger Notification Bridge

## Overview

This implementation plan covers the development of a Messenger Notification Bridge that enables a React web application to send notifications to users through Facebook Messenger. The system consists of a Node.js Express backend server that handles webhook verification, receives Messenger events, and sends messages via the Facebook Messenger Platform API, along with React frontend integration for triggering notifications.

The implementation follows a sequential approach: backend setup → webhook endpoints → message sending → frontend integration → configuration → testing.

## Tasks

- [x] 1. Set up backend server project structure and dependencies
  - Create `backend/` directory in project root
  - Initialize Node.js project with `npm init`
  - Install dependencies: `express`, `body-parser`, `axios`, `dotenv`
  - Create `backend/server.js` as main entry point
  - Create `backend/.env` file for environment variables
  - Add `backend/node_modules` to `.gitignore`
  - _Requirements: 1.1, 1.2, 1.3, 8.1, 8.2_

- [ ] 2. Implement Express server initialization and middleware
  - [x] 2.1 Create Express application with body-parser middleware
    - Initialize Express app
    - Configure body-parser for JSON (10MB limit)
    - Configure body-parser for URL-encoded bodies (extended mode)
    - Load PAGE_ACCESS_TOKEN and VERIFY_TOKEN from environment variables
    - Add validation to exit if environment variables are missing
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 8.1, 8.2, 8.3, 8.4, 11.1, 11.2_

  - [x] 2.2 Add server startup logic with logging
    - Configure server to listen on port 3000
    - Add startup log showing listening port
    - Add error handling for server startup failures
    - _Requirements: 1.1, 1.6, 10.6_

  - [ ]* 2.3 Write unit tests for environment variable validation
    - Test server exits when PAGE_ACCESS_TOKEN is missing
    - Test server exits when VERIFY_TOKEN is missing
    - Test server starts successfully with valid environment variables
    - _Requirements: 8.3, 8.4_

- [x] 3. Checkpoint - Verify server starts successfully
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement webhook verification endpoint
  - [x] 4.1 Create GET /webhook endpoint
    - Extract hub.mode, hub.verify_token, and hub.challenge from query parameters
    - Validate hub.mode equals "subscribe"
    - Validate hub.verify_token matches VERIFY_TOKEN environment variable
    - Return 200 with hub.challenge on successful verification
    - Return 403 on verification failure
    - Add logging for verification attempts
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 10.1, 11.5_

  - [ ]* 4.2 Write unit tests for webhook verification logic
    - Test successful verification with valid mode and token
    - Test rejection with invalid mode
    - Test rejection with invalid token
    - Test rejection with missing parameters
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 4.3 Write integration tests for GET /webhook endpoint
    - Test endpoint returns 200 and challenge with valid parameters
    - Test endpoint returns 403 with invalid token
    - Test endpoint returns 403 with invalid mode
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 5. Implement webhook event receiver endpoint
  - [x] 5.1 Create POST /webhook endpoint
    - Respond with 200 OK immediately upon receiving request
    - Parse webhook payload from request body
    - Check if payload.object equals "page"
    - Iterate through entry array and messaging events
    - Extract sender.id (PSID) from each messaging event
    - Log PSID with format "Received message from PSID: {psid}"
    - Extract and log message.text if present
    - Wrap processing logic in try-catch to prevent errors after 200 response
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 10.1_

  - [ ]* 5.2 Write integration tests for POST /webhook endpoint
    - Test endpoint returns 200 OK immediately
    - Test PSID extraction from sample webhook payload
    - Test message text extraction from sample webhook payload
    - Test handling of malformed webhook payloads
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 6. Checkpoint - Test webhook endpoints with mock data
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement message sending endpoint
  - [ ] 7.1 Create POST /send-message endpoint with validation
    - Extract psid and message from request body
    - Validate psid is present and non-empty string
    - Validate message is present and non-empty string
    - Return 400 with error message if validation fails
    - Log validation errors
    - _Requirements: 4.1, 4.7, 4.8, 10.4_

  - [ ] 7.2 Implement Messenger Platform API integration
    - Construct POST request to https://graph.facebook.com/v12.0/me/messages
    - Include access_token query parameter with PAGE_ACCESS_TOKEN
    - Set Content-Type header to application/json
    - Send JSON payload with recipient.id and message.text
    - Log outgoing message details (PSID and message content)
    - _Requirements: 4.2, 4.3, 4.4, 10.2, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ] 7.3 Add response handling and error handling
    - Parse JSON response from Messenger Platform API
    - Return 200 with success: true and messageId on successful send
    - Catch API errors and extract error details
    - Log complete error response from Facebook API
    - Return 500 with success: false and error message on API failure
    - _Requirements: 4.5, 4.6, 10.3, 12.6, 12.7_

  - [ ]* 7.4 Write unit tests for request validation
    - Test rejection of missing psid
    - Test rejection of empty psid
    - Test rejection of missing message
    - Test rejection of empty message
    - Test acceptance of valid request
    - _Requirements: 4.7, 4.8_

  - [ ]* 7.5 Write integration tests for POST /send-message endpoint
    - Mock Messenger Platform API with successful response
    - Test successful message sending returns 200 with success: true
    - Test 400 response for missing psid
    - Test 400 response for missing message
    - Mock API error response and test 500 error handling
    - Verify correct request structure sent to Facebook API
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [ ] 8. Add error handling middleware
  - [ ] 8.1 Create error handling middleware for JSON parsing errors
    - Add middleware to catch SyntaxError from invalid JSON
    - Return 400 with error message for invalid JSON
    - Add middleware to catch entity.too.large errors
    - Return 413 with error message for oversized payloads
    - Log all parsing errors
    - _Requirements: 11.3, 11.4_

  - [ ]* 8.2 Write integration tests for error handling middleware
    - Test 400 response for invalid JSON in request body
    - Test 413 response for oversized request body
    - _Requirements: 11.3, 11.4_

- [ ] 9. Checkpoint - Test complete backend functionality
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Create React frontend messenger service
  - [ ] 10.1 Create messenger service module
    - Create `src/services/messengerService.js` file
    - Implement `sendMessengerNotification(psid, message)` function
    - Read backend URL from environment variable VITE_BACKEND_URL (default: http://localhost:3000)
    - Send POST request to /send-message endpoint
    - Set Content-Type header to application/json
    - Send JSON body with psid and message
    - Parse response and return data on success
    - Throw error with message on failure
    - Handle network errors gracefully
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.5_

  - [ ]* 10.2 Write unit tests for messenger service
    - Mock fetch API
    - Test successful message sending
    - Test error handling for 400 response
    - Test error handling for 500 response
    - Test network error handling
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 11. Create example React component integration
  - [ ] 11.1 Create example notification component
    - Create `src/components/MessengerNotification/MessengerNotification.jsx`
    - Import messengerService
    - Add state for loading, error, and success
    - Implement handleSendNotification function using messengerService
    - Add button to trigger notification sending
    - Display loading state while sending
    - Display success message on successful send
    - Display error message on failure
    - Add retry mechanism for failed sends
    - _Requirements: 7.1, 7.4, 7.5, 7.6_

  - [ ] 11.2 Create CSS module for notification component
    - Create `src/components/MessengerNotification/MessengerNotification.module.css`
    - Style notification button
    - Style success and error messages
    - Add loading spinner styles
    - _Requirements: 7.4, 7.5_

- [ ] 12. Set up environment configuration files
  - [ ] 12.1 Create backend environment configuration
    - Create `backend/.env.example` with template variables
    - Document required environment variables (PAGE_ACCESS_TOKEN, VERIFY_TOKEN)
    - Add instructions for obtaining Facebook credentials
    - _Requirements: 8.1, 8.2_

  - [ ] 12.2 Update frontend environment configuration
    - Add VITE_BACKEND_URL to `.env.local.example` if it exists, or create it
    - Document backend URL configuration
    - Set default value to http://localhost:3000
    - _Requirements: 8.5_

- [ ] 13. Create setup and deployment documentation
  - [ ] 13.1 Create backend setup documentation
    - Create `backend/README.md`
    - Document installation steps (npm install)
    - Document environment variable setup
    - Document how to start the server (node server.js)
    - Document ngrok setup and usage
    - Document Facebook webhook configuration steps
    - Include troubleshooting section
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ] 13.2 Create integration documentation
    - Create `Documentations/MESSENGER_NOTIFICATION_BRIDGE.md`
    - Document complete setup workflow
    - Document how to obtain Facebook Page Access Token
    - Document how to configure Facebook webhook
    - Document how to use messenger service in React components
    - Include example code snippets
    - Document common errors and solutions
    - _Requirements: 1.1-12.7_

- [ ] 14. Add npm scripts for backend
  - [ ] 14.1 Update backend package.json with scripts
    - Add "start" script to run server
    - Add "dev" script with nodemon for development (if nodemon is installed)
    - Add "test" script for running tests
    - _Requirements: 1.1, 1.6_

- [ ] 15. Final checkpoint - End-to-end integration test
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- The backend server should be developed and tested independently before frontend integration
- ngrok setup is required for webhook testing with Facebook but is documented rather than implemented in code
- Facebook Page Access Token and webhook configuration are manual setup steps documented in README files
- The example React component (task 11) serves as a reference implementation and can be adapted to specific use cases in the application
- Testing tasks focus on unit and integration tests; manual testing with real Facebook integration should be performed after implementation
