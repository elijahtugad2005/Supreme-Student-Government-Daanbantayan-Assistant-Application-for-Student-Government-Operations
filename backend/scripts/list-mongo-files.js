// Script to list all files currently stored in MongoDB GridFS
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { listFiles } = require('../utils/gridfs');
const { closeDatabase } = require('../services/mongodb');

async function checkMongoFiles() {
  try {
    console.log('Connecting to MongoDB GridFS to inspect all uploaded files...');
    const files = await listFiles({}, 100);
    console.log(`\nFound ${files.length} file(s) in MongoDB GridFS:\n`);
    
    files.forEach((file, index) => {
      console.log(`[${index + 1}] ID: ${file._id}`);
      console.log(`    Filename:    ${file.filename}`);
      console.log(`    Size:        ${(file.length / 1024).toFixed(2)} KB (${file.length} bytes)`);
      console.log(`    Upload Date: ${file.uploadDate}`);
      console.log(`    Metadata:    ${JSON.stringify(file.metadata || {})}`);
      console.log('------------------------------------------------------------');
    });

    if (files.length === 0) {
      console.log('No files found in the MongoDB GridFS bucket.');
    }
  } catch (err) {
    console.error('Error listing MongoDB files:', err);
  } finally {
    try {
      await closeDatabase();
    } catch (_) {}
    process.exit(0);
  }
}

checkMongoFiles();
