// backend/utils/errorSanitizer.js
// PURPOSE: Sanitize error responses sent to client applications.
// Prevents internal database driver errors, IPs, stack traces, and topology leaks.

/**
 * Sanitizes an error object for consumer responses.
 * @param {Error|any} error - The caught internal error
 * @param {string} fallbackMessage - Consumer-facing safe message
 * @returns {{success: false, error: string, message: string}}
 */
function sanitizeErrorResponse(error, fallbackMessage = 'An unexpected error occurred.') {
  const isDev = process.env.NODE_ENV === 'development';
  
  // Safe messages whitelist or standard HTTP responses
  let cleanMessage = fallbackMessage;
  if (error && typeof error.message === 'string') {
    // If error message is clean and doesn't contain server internals, IPs, or connection strings
    const hasLeak = /mongo|atlas|driver|topology|econnrefused|password|token|secret|stack|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i.test(error.message);
    if (!hasLeak && error.message.length < 150) {
      cleanMessage = error.message;
    }
  }

  return {
    success: false,
    error: fallbackMessage,
    message: cleanMessage,
    ...(isDev && error?.code ? { code: error.code } : {})
  };
}

module.exports = {
  sanitizeErrorResponse
};

