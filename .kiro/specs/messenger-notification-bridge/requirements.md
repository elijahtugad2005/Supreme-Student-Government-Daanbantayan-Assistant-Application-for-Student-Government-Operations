# Requirements Document

## Introduction

The Messenger Notification Bridge enables a React web application to send notifications to users through Facebook Messenger using the Facebook Messenger Platform API. The system consists of a Node.js backend server that handles webhook verification, receives Messenger events, and sends messages via the Messenger Platform API. The backend is exposed publicly through ngrok to allow Facebook to communicate with the local development server. The React frontend integrates with the backend to trigger message sending operations.

## Glossary

- **Backend_Server**: The Node.js Express server that handles webhook verification, event processing, and message sending
- **React_Frontend**: The existing React web application that triggers message sending operations
- **Messenger_Platform_API**: Facebook's API for sending and receiving messages through Messenger
- **Webhook**: An HTTP endpoint that receives real-time events from Facebook Messenger Platform
- **PSID**: Page-Scoped ID - a unique identifier for each user who interacts with a Facebook Page
- **Page_Access_Token**: Authentication credential for accessing the Messenger Platform API on behalf of a Facebook Page
- **Verify_Token**: A secret string used to verify webhook subscription requests from Facebook
- **ngrok_Tunnel**: A secure tunnel service that exposes the local Backend_Server to the public internet via HTTPS
- **Webhook_Verification_Endpoint**: The GET /webhook endpoint that validates Facebook's webhook subscription request
- **Webhook_Event_Receiver**: The POST /webhook endpoint that receives incoming Messenger events
- **Message_Sending_Endpoint**: The POST /send-message endpoint that sends messages through Messenger Platform API
- **Facebook_Page**: The Facebook Page that serves as the identity for sending and receiving messages

## Requirements

### Requirement 1: Backend Server Initialization

**User Story:** As a developer, I want to initialize a Node.js Express server with proper middleware, so that the system can handle HTTP requests for webhook operations and message sending.

#### Acceptance Criteria

1. THE Backend_Server SHALL listen on port 3000
2. THE Backend_Server SHALL use body-parser middleware to parse JSON request bodies
3. THE Backend_Server SHALL use body-parser middleware to parse URL-encoded request bodies
4. THE Backend_Server SHALL load the Page_Access_Token from environment variable PAGE_ACCESS_TOKEN
5. THE Backend_Server SHALL load the Verify_Token from environment variable VERIFY_TOKEN
6. WHEN the Backend_Server starts successfully, THE Backend_Server SHALL log the listening port to the console

### Requirement 2: Webhook Verification

**User Story:** As a Facebook Platform administrator, I want to verify webhook subscriptions, so that only authorized services can receive Messenger events.

#### Acceptance Criteria

1. WHEN a GET request is received at /webhook with query parameters hub.mode, hub.verify_token, and hub.challenge, THE Webhook_Verification_Endpoint SHALL validate the subscription request
2. IF hub.mode equals "subscribe" AND hub.verify_token matches the configured Verify_Token, THEN THE Webhook_Verification_Endpoint SHALL respond with HTTP status 200 and the hub.challenge value
3. IF hub.verify_token does not match the configured Verify_Token, THEN THE Webhook_Verification_Endpoint SHALL respond with HTTP status 403
4. IF hub.mode does not equal "subscribe", THEN THE Webhook_Verification_Endpoint SHALL respond with HTTP status 403

### Requirement 3: Webhook Event Reception

**User Story:** As a system administrator, I want to receive and log incoming Messenger events, so that I can capture user PSIDs and monitor system activity.

#### Acceptance Criteria

1. WHEN a POST request is received at /webhook, THE Webhook_Event_Receiver SHALL respond with HTTP status 200 immediately
2. WHEN the webhook payload contains an object property equal to "page", THE Webhook_Event_Receiver SHALL process the entry array
3. FOR ALL entries in the entry array, THE Webhook_Event_Receiver SHALL process each messaging event in the messaging array
4. WHEN a messaging event contains a sender.id property, THE Webhook_Event_Receiver SHALL log the PSID to the console with the format "Received message from PSID: {psid}"
5. WHEN a messaging event contains a message property, THE Webhook_Event_Receiver SHALL log the message text to the console

### Requirement 4: Message Sending via Messenger Platform API

**User Story:** As a React application, I want to send messages to users via Messenger, so that I can deliver notifications to users who have interacted with the Facebook Page.

#### Acceptance Criteria

1. WHEN a POST request is received at /send-message with a JSON body containing psid and message properties, THE Message_Sending_Endpoint SHALL send a message to the specified PSID
2. THE Message_Sending_Endpoint SHALL construct a request to the Messenger Platform API at https://graph.facebook.com/v12.0/me/messages
3. THE Message_Sending_Endpoint SHALL include the Page_Access_Token as a query parameter in the API request
4. THE Message_Sending_Endpoint SHALL send a JSON payload with recipient.id set to the provided psid and message.text set to the provided message
5. WHEN the Messenger Platform API responds with HTTP status 200, THE Message_Sending_Endpoint SHALL respond to the React_Frontend with HTTP status 200 and a JSON body containing success: true
6. IF the Messenger Platform API responds with an error status, THEN THE Message_Sending_Endpoint SHALL respond to the React_Frontend with HTTP status 500 and a JSON body containing success: false and the error details
7. IF the request body is missing the psid property, THEN THE Message_Sending_Endpoint SHALL respond with HTTP status 400 and an error message
8. IF the request body is missing the message property, THEN THE Message_Sending_Endpoint SHALL respond with HTTP status 400 and an error message

### Requirement 5: ngrok Tunnel Configuration

**User Story:** As a developer, I want to expose the local Backend_Server through ngrok, so that Facebook can send webhook events to my development environment.

#### Acceptance Criteria

1. THE ngrok_Tunnel SHALL expose port 3000 to the public internet via HTTPS
2. THE ngrok_Tunnel SHALL provide a public HTTPS URL in the format https://{subdomain}.ngrok.io
3. WHEN the ngrok_Tunnel is established, THE ngrok_Tunnel SHALL display the public URL in the terminal
4. THE ngrok_Tunnel SHALL remain active for the duration of the development session
5. THE ngrok_Tunnel SHALL forward all incoming HTTPS requests to http://localhost:3000

### Requirement 6: Facebook Webhook Configuration

**User Story:** As a developer, I want to configure Facebook Messenger Platform webhooks, so that the system can receive real-time Messenger events.

#### Acceptance Criteria

1. THE Facebook_Page SHALL be configured with a webhook callback URL in the format https://{ngrok-subdomain}.ngrok.io/webhook
2. THE Facebook_Page SHALL be configured with the Verify_Token value "kiro_verify_token"
3. THE Facebook_Page SHALL subscribe to the "messages" webhook field
4. THE Facebook_Page SHALL subscribe to the "messaging_postbacks" webhook field
5. WHEN webhook configuration is saved, THE Facebook Messenger Platform SHALL send a verification request to the Webhook_Verification_Endpoint

### Requirement 7: React Frontend Integration

**User Story:** As a React developer, I want to integrate message sending functionality into the React application, so that users can trigger Messenger notifications from the web interface.

#### Acceptance Criteria

1. THE React_Frontend SHALL provide a function that sends POST requests to http://localhost:3000/send-message
2. THE React_Frontend SHALL include a JSON body with psid and message properties in the POST request
3. THE React_Frontend SHALL set the Content-Type header to "application/json"
4. WHEN the Backend_Server responds with success: true, THE React_Frontend SHALL indicate successful message delivery to the user
5. IF the Backend_Server responds with success: false, THEN THE React_Frontend SHALL display an error message to the user
6. IF the network request fails, THEN THE React_Frontend SHALL handle the error gracefully and inform the user

### Requirement 8: Environment Configuration

**User Story:** As a developer, I want to manage sensitive credentials through environment variables, so that API tokens are not hardcoded in the source code.

#### Acceptance Criteria

1. THE Backend_Server SHALL read the Page_Access_Token from the PAGE_ACCESS_TOKEN environment variable
2. THE Backend_Server SHALL read the Verify_Token from the VERIFY_TOKEN environment variable
3. IF the PAGE_ACCESS_TOKEN environment variable is not set, THEN THE Backend_Server SHALL log an error message and exit
4. IF the VERIFY_TOKEN environment variable is not set, THEN THE Backend_Server SHALL log an error message and exit
5. THE React_Frontend SHALL read the Backend_Server URL from environment configuration

### Requirement 9: Message Sending Authorization

**User Story:** As a Facebook Messenger Platform user, I want to ensure that only users who have messaged the Facebook Page can receive messages, so that the system complies with Messenger Platform policies.

#### Acceptance Criteria

1. THE Backend_Server SHALL only send messages to PSIDs that have been received through the Webhook_Event_Receiver
2. WHEN a user sends a message to the Facebook_Page, THE Webhook_Event_Receiver SHALL log the PSID for future message sending
3. IF the Messenger Platform API rejects a message send request due to invalid PSID, THEN THE Message_Sending_Endpoint SHALL return an error to the React_Frontend
4. THE Backend_Server SHALL not maintain a persistent list of authorized PSIDs (authorization is managed by Facebook)

### Requirement 10: Error Handling and Logging

**User Story:** As a developer, I want comprehensive error handling and logging, so that I can debug issues and monitor system behavior.

#### Acceptance Criteria

1. WHEN the Backend_Server receives a webhook event, THE Backend_Server SHALL log the event type and sender PSID
2. WHEN the Message_Sending_Endpoint sends a message, THE Backend_Server SHALL log the target PSID and message content
3. IF the Messenger Platform API returns an error, THEN THE Backend_Server SHALL log the complete error response
4. IF a request to /send-message is missing required fields, THEN THE Backend_Server SHALL log the validation error
5. WHEN the ngrok_Tunnel is established, THE system SHALL log the public HTTPS URL
6. IF the Backend_Server fails to start, THEN THE Backend_Server SHALL log the error reason and exit gracefully

### Requirement 11: HTTP Request Parsing and Validation

**User Story:** As a backend developer, I want to parse and validate incoming HTTP requests, so that the system handles malformed requests gracefully.

#### Acceptance Criteria

1. THE Backend_Server SHALL parse JSON request bodies with a size limit of 10MB
2. THE Backend_Server SHALL parse URL-encoded request bodies with extended mode enabled
3. IF a request body exceeds the size limit, THEN THE Backend_Server SHALL respond with HTTP status 413
4. IF a request body contains invalid JSON, THEN THE Backend_Server SHALL respond with HTTP status 400
5. THE Webhook_Verification_Endpoint SHALL validate the presence of required query parameters before processing

### Requirement 12: Messenger Platform API Integration

**User Story:** As a backend developer, I want to integrate with the Messenger Platform Send API, so that messages are delivered reliably through Facebook's infrastructure.

#### Acceptance Criteria

1. THE Message_Sending_Endpoint SHALL use the Messenger Platform API version v12.0 or higher
2. THE Message_Sending_Endpoint SHALL send requests to https://graph.facebook.com/v12.0/me/messages
3. THE Message_Sending_Endpoint SHALL include the access_token query parameter with the Page_Access_Token value
4. THE Message_Sending_Endpoint SHALL set the Content-Type header to "application/json"
5. THE Message_Sending_Endpoint SHALL construct the request payload with recipient and message objects according to Messenger Platform API specification
6. WHEN the Messenger Platform API responds, THE Message_Sending_Endpoint SHALL parse the JSON response body
7. IF the Messenger Platform API response contains an error object, THEN THE Message_Sending_Endpoint SHALL extract the error message and code
