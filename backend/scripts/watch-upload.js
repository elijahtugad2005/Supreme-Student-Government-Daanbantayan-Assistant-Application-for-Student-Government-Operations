// Real-time listener for uploads and AI analysis
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { listFiles, getFileMetadata } = require('../utils/gridfs');
const { getDatabase } = require('../services/mongodb');

console.log('[WATCHER] Monitoring MongoDB GridFS for new uploads...');

let knownFileIds = new Set();
let initialized = false;

async function check() {
  try {
    const files = await listFiles({}, 20);
    const sorted = files.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

    if (!initialized) {
      sorted.forEach(f => knownFileIds.add(f._id.toString()));
      initialized = true;
      console.log(`[WATCHER] Initialized with ${knownFileIds.size} existing files. Waiting for new upload...`);
      return;
    }

    for (const f of sorted) {
      const idStr = f._id.toString();
      if (!knownFileIds.has(idStr)) {
        knownFileIds.add(idStr);
        console.log(`\n================== NEW UPLOAD DETECTED ==================`);
        console.log(`[NEW FILE] ID:       ${idStr}`);
        console.log(`[NEW FILE] Name:     ${f.filename}`);
        console.log(`[NEW FILE] Size:     ${(f.length / 1024).toFixed(2)} KB (${f.length} bytes)`);
        console.log(`[NEW FILE] Uploaded: ${f.uploadDate}`);
        console.log(`[NEW FILE] Metadata: ${JSON.stringify(f.metadata || {})}`);
        console.log(`=========================================================\n`);
      }
    }
  } catch (err) {
    console.error('[WATCHER] Error polling:', err.message);
  }
}

// Poll every 1.5 seconds
setInterval(check, 1500);
check();
