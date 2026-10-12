// Inspect actual text content from MongoDB GridFS files
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { downloadFileFromGridFS } = require('../utils/gridfs');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

async function inspectDoc(id, label) {
  try {
    console.log(`\n================== [ ${label} (ID: ${id}) ] ==================`);
    const buffer = await downloadFileFromGridFS(id);
    console.log(`File size: ${buffer.length} bytes`);
    
    if (label.endsWith('.docx')) {
      const { value } = await mammoth.extractRawText({ buffer });
      console.log('--- EXTRACTED DOCX TEXT ---');
      console.log(value);
      console.log('--- END DOCX TEXT ---');
    } else if (label.endsWith('.pdf')) {
      try {
        const parsed = await pdfParse(buffer);
        console.log('--- EXTRACTED PDF TEXT ---');
        console.log(parsed.text.slice(0, 3000));
        console.log('--- END PDF TEXT ---');
      } catch (err) {
        console.log('PDF text extraction error:', err.message);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

async function run() {
  await inspectDoc('6ac8bc2d994aa36e82e4b4c9', 'TRANSMITTAL LETTER.docx');
  await inspectDoc('6ac8cf52994aa36e82e4b4cc', 'LETTER FOR RESEARCH SOP 1.pdf');
  process.exit(0);
}

run();
