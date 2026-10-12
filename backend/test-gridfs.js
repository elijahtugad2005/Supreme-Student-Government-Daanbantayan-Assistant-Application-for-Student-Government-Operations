require('dotenv').config();
const fs = require('fs');
const { uploadFileToGridFS, downloadFileFromGridFS, getFileMetadata, deleteFileFromGridFS } = require('./utils/gridfs');
const { closeConnection } = require('./services/mongodb');

async function testGridFS() {
  try {
    console.log('🧪 Testing GridFS operations...\n');

    // Test 1: Upload
    console.log('📤 Test 1: Uploading test file...');
    const testContent = Buffer.from('This is a test document for SSG Office Assistant');
    const uploadResult = await uploadFileToGridFS(
      testContent,
      'test-document.txt',
      {
        documentType: 'test',
        uploadedBy: 'test-user',
        purpose: 'integration-test'
      }
    );
    console.log('✅ Upload successful:', uploadResult);
    const fileId = uploadResult.fileId;

    // Test 2: Get Metadata
    console.log('\n📋 Test 2: Fetching file metadata...');
    const metadata = await getFileMetadata(fileId);
    console.log('✅ Metadata:', {
      _id: metadata._id,
      filename: metadata.filename,
      length: metadata.length,
      uploadDate: metadata.uploadDate,
      metadata: metadata.metadata
    });

    // Test 3: Download
    console.log('\n📥 Test 3: Downloading file...');
    const downloadedBuffer = await downloadFileFromGridFS(fileId);
    const downloadedContent = downloadedBuffer.toString();
    console.log('✅ Downloaded content:', downloadedContent);

    // Test 4: Verify content matches
    console.log('\n🔍 Test 4: Verifying content integrity...');
    if (downloadedContent === testContent.toString()) {
      console.log('✅ Content matches original!');
    } else {
      console.error('❌ Content mismatch!');
    }

    // Test 5: Delete
    console.log('\n🗑️  Test 5: Deleting test file...');
    await deleteFileFromGridFS(fileId);
    console.log('✅ File deleted successfully');

    console.log('\n✅ All tests passed!');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
  } finally {
    await closeConnection();
    process.exit(0);
  }
}

testGridFS();
