/**
 * functions/src/extract.js
 *
 * Turn an uploaded file into something Gemini can read.
 *
 * The important decision here is that PDFs and images are sent to Gemini
 * NATIVELY as binary rather than being parsed into text first. Gemini reads
 * both directly and performs its own OCR on scans, which avoids maintaining a
 * PDF text-extraction library and handles scanned documents far better.
 *
 * DOCX is the exception — Gemini cannot accept it, so it is converted to text.
 */

/** Inline request payloads are capped; anything larger is rejected with advice. */
export const MAX_INLINE_BYTES = 15 * 1024 * 1024;

/** A page of plain text keeps the request small on long documents. */
const TEXT_INLINE_LIMIT = 400 * 1024;

export const isNativeGeminiType = (mimeType) =>
  mimeType === 'application/pdf' ||
  /^image\/(jpeg|jpg|png|webp|heic|heif)$/.test(mimeType || '');

export const isTextLike = (mimeType) =>
  mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'text/markdown';

export const isDocx = (mimeType) =>
  mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Build the `parts` array for a generation request.
 *
 * @param {Object} file { buffer: Buffer, mimeType: string, name: string }
 * @returns {Promise<{parts: Array, note: string, native: boolean}>}
 */
export const buildFileParts = async (file) => {
  const { buffer, mimeType, name } = file;
  const fileHint = `\n\nFile name: ${name}`;

  if (isNativeGeminiType(mimeType)) {
    if (buffer.length > MAX_INLINE_BYTES) {
      const error = new Error(
        `${name} is ${(buffer.length / 1024 / 1024).toFixed(1)} MB. The limit for AI analysis is ${
          MAX_INLINE_BYTES / 1024 / 1024
        } MB — the document is still safely archived, but AI analysis is skipped for it.`
      );
      error.code = 'FILE_TOO_LARGE_FOR_AI';
      throw error;
    }
    return {
      native: true,
      note: 'sent natively',
      parts: [
        { inlineData: { mimeType, data: buffer.toString('base64') } },
        { text: fileHint },
      ],
    };
  }

  if (isDocx(mimeType)) {
    // Imported lazily so the other paths do not pay the module load.
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    const text = String(value || '').trim();
    if (!text) {
      const error = new Error(`${name} produced no readable text.`);
      error.code = 'UNREADABLE';
      throw error;
    }
    return {
      native: false,
      note: 'DOCX converted to text',
      parts: [{ text: `${text.slice(0, TEXT_INLINE_LIMIT)}${fileHint}` }],
    };
  }

  if (isTextLike(mimeType)) {
    const text = buffer.toString('utf8').slice(0, TEXT_INLINE_LIMIT);
    return {
      native: false,
      note: 'plain text',
      parts: [{ text: `${text}${fileHint}` }],
    };
  }

  // Legacy .doc and anything else unrecognised.
  const error = new Error(
    `${name} (${mimeType || 'unknown type'}) cannot be read by the AI. Convert it to PDF or DOCX.`
  );
  error.code = 'UNSUPPORTED_FOR_AI';
  throw error;
};