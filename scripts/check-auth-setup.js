#!/usr/bin/env node

/**
 * Authentication Setup Check Script
 * Verifies that Google OAuth and Firebase are properly configured
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Checking Authentication Configuration...\n');

// Check environment files
const envFiles = [
  { path: '.env.local', required: true },
  { path: '.env.example', required: false },
];

let hasErrors = false;

// Check if required environment files exist
envFiles.forEach(file => {
  const exists = fs.existsSync(file.path);
  if (file.required && !exists) {
    console.log(`❌ Missing required file: ${file.path}`);
    hasErrors = true;
  } else if (exists) {
    console.log(`✅ Found: ${file.path}`);
    
    // Read and check for required variables
    if (file.path === '.env.local') {
      const content = fs.readFileSync(file.path, 'utf8');
      const requiredVars = [
        'VITE_FIREBASE_API_KEY',
        'VITE_FIREBASE_AUTH_DOMAIN',
        'VITE_FIREBASE_PROJECT_ID',
        'VITE_GOOGLE_OAUTH_CLIENT_ID'
      ];
      
      requiredVars.forEach(variable => {
        if (content.includes(variable) && !content.includes(`${variable}= your_`)) {
          console.log(`   ✅ ${variable} is configured`);
        } else {
          console.log(`   ⚠️  ${variable} needs to be configured (check SETUP_GOOGLE_OAUTH.md)`);
          hasErrors = true;
        }
      });
    }
  }
});

// Check Firebase configuration file
const firebaseConfigPath = 'src/firebase/firebaseConfig.js';
if (fs.existsSync(firebaseConfigPath)) {
  console.log(`✅ Found: ${firebaseConfigPath}`);
  const content = fs.readFileSync(firebaseConfigPath, 'utf8');
  
  if (content.includes('GoogleAuthProvider')) {
    console.log('   ✅ GoogleAuthProvider is imported');
  } else {
    console.log('   ❌ GoogleAuthProvider is missing from imports');
    hasErrors = true;
  }
  
  if (content.includes('googleProvider')) {
    console.log('   ✅ googleProvider is exported');
  } else {
    console.log('   ❌ googleProvider export is missing');
    hasErrors = true;
  }
} else {
  console.log(`❌ Missing: ${firebaseConfigPath}`);
  hasErrors = true;
}

// Check AuthContext
const authContextPath = 'src/components/AuthContext/AuthContext.jsx';
if (fs.existsSync(authContextPath)) {
  console.log(`✅ Found: ${authContextPath}`);
} else {
  console.log(`❌ Missing: ${authContextPath}`);
  hasErrors = true;
}

// Check Login component
const loginComponentPath = 'src/components/Login/Login.jsx';
if (fs.existsSync(loginComponentPath)) {
  console.log(`✅ Found: ${loginComponentPath}`);
} else {
  console.log(`❌ Missing: ${loginComponentPath}`);
  hasErrors = true;
}

console.log('\n📋 Summary:');
if (hasErrors) {
  console.log('❌ Configuration issues found.');
  console.log('\n🚀 Next steps:');
  console.log('1. Complete the Google OAuth setup in SETUP_GOOGLE_OAUTH.md');
  console.log('2. Update your .env.local file with actual credentials');
  console.log('3. Enable Google Sign-In in Firebase Console');
  console.log('4. Run this check script again');
  process.exit(1);
} else {
  console.log('✅ All checks passed! Google OAuth should be ready.');
  console.log('\n🎯 To enable Google Sign-In:');
  console.log('1. Update Login.jsx to add Google Sign-In button');
  console.log('2. Update AuthContext.jsx to handle Google authentication');
  console.log('3. Test the authentication flow');
  process.exit(0);
}