#!/usr/bin/env node

/**
 * Authentication Flow Test Script
 * Verifies that the authentication system components are properly configured
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Authentication Flow Test - Starting...\n');
console.log('📋 This script checks for common configuration issues.\n');

// Check if we're in the project root
const projectRoot = process.cwd();
console.log(`📁 Project Root: ${projectRoot}`);

// List of required files to check
const requiredFiles = [
  { path: 'src/firebase/firebaseConfig.js', description: 'Firebase Configuration' },
  { path: 'src/components/AuthContext/AuthContext.jsx', description: 'Authentication Context' },
  { path: 'src/components/Login/Login.jsx', description: 'Login Component' },
  { path: 'src/components/Login/GoogleSignInButton.jsx', description: 'Google Sign-In Button' },
  { path: 'src/components/ProtectedRoute/ProtectedRoute.jsx', description: 'Protected Route Wrapper' },
  { path: 'src/components/UserManagement/UserManagement.jsx', description: 'User Management Dashboard' },
  { path: 'src/components/AccessDenied/AccessDenied.jsx', description: 'Access Denied Component' },
  { path: 'src/utils/permissions.js', description: 'Permissions Utility' },
  { path: 'src/services/userManagementService.js', description: 'User Management Service' },
  { path: 'src/hooks/usePermissions.js', description: 'Permissions Hook' },
];

// List of configuration files
const configFiles = [
  { path: '.env.example', description: 'Environment Example' },
  { path: '.env.local', description: 'Local Environment (optional)' },
  { path: 'SETUP_GOOGLE_OAUTH.md', description: 'Google OAuth Setup Guide' },
  { path: 'DATABASE_SCHEMA.md', description: 'Database Schema Documentation' },
  { path: 'TEST_PLAN.md', description: 'Test Plan' },
];

let allFilesExist = true;
let configIssues = [];

console.log('📂 Checking Required Files...\n');

// Check required files
requiredFiles.forEach(file => {
  const fullPath = path.join(projectRoot, file.path);
  const exists = fs.existsSync(fullPath);
  
  if (exists) {
    console.log(`✅ ${file.description}: ${file.path}`);
    
    // Check file content for Google Auth imports
    if (file.path === 'src/firebase/firebaseConfig.js') {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (!content.includes('GoogleAuthProvider')) {
        configIssues.push(`❌ ${file.path}: GoogleAuthProvider not imported`);
      }
      if (!content.includes('googleProvider')) {
        configIssues.push(`❌ ${file.path}: googleProvider not exported`);
      }
    }
    
    // Check AuthContext for Google functions
    if (file.path === 'src/components/AuthContext/AuthContext.jsx') {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (!content.includes('loginWithGooglePopup')) {
        configIssues.push(`❌ ${file.path}: loginWithGooglePopup function missing`);
      }
      if (!content.includes('signInWithPopup')) {
        configIssues.push(`❌ ${file.path}: signInWithPopup import missing`);
      }
    }
    
  } else {
    console.log(`❌ ${file.description}: ${file.path} - MISSING`);
    allFilesExist = false;
  }
});

console.log('\n📄 Checking Configuration Files...\n');

// Check configuration files
configFiles.forEach(file => {
  const fullPath = path.join(projectRoot, file.path);
  const exists = fs.existsSync(fullPath);
  
  if (exists) {
    console.log(`✅ ${file.description}: ${file.path}`);
    
    // Check .env.local for Google OAuth config
    if (file.path === '.env.local') {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (!content.includes('VITE_GOOGLE_OAUTH_CLIENT_ID')) {
        configIssues.push(`⚠️  ${file.path}: Google OAuth Client ID placeholder found (update with actual credentials)`);
      }
    }
    
  } else {
    console.log(`⚠️  ${file.description}: ${file.path} - NOT FOUND (optional)`);
  }
});

console.log('\n🔧 Checking Package.json Scripts...\n');

// Check package.json
const packageJsonPath = path.join(projectRoot, 'package.json');
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  if (packageJson.scripts && packageJson.scripts['check-auth']) {
    console.log('✅ check-auth script found in package.json');
  } else {
    configIssues.push('❌ package.json: check-auth script missing');
  }
} else {
  console.log('❌ package.json not found');
  allFilesExist = false;
}

console.log('\n🔍 Checking Directory Structure...\n');

// Check directory structure
const directories = [
  'src/components/UserManagement',
  'src/components/AccessDenied',
  'src/components/AuditTrail',
  'src/utils',
  'src/services',
  'src/hooks'
];

directories.forEach(dir => {
  const fullPath = path.join(projectRoot, dir);
  if (fs.existsSync(fullPath)) {
    console.log(`✅ Directory exists: ${dir}`);
  } else {
    console.log(`❌ Directory missing: ${dir}`);
    allFilesExist = false;
  }
});

console.log('\n📊 Summary of Issues Found:\n');

if (configIssues.length > 0) {
  configIssues.forEach(issue => {
    console.log(issue);
  });
} else {
  console.log('✅ No configuration issues found!');
}

console.log('\n🎯 Manual Testing Required:\n');

console.log('The following tests must be performed manually:');
console.log('1. Google OAuth Configuration');
console.log('   - Enable Google Sign-In in Firebase Console');
console.log('   - Add actual OAuth credentials to .env.local');
console.log('   - Test Google Sign-In button functionality');
console.log('');
console.log('2. Role Assignment Testing');
console.log('   - Login as admin user');
console.log('   - Navigate to /admin/users');
console.log('   - Test role changes for test users');
console.log('   - Verify audit trail logs changes');
console.log('');
console.log('3. Permission System Testing');
console.log('   - Test different user roles');
console.log('   - Verify access control works');
console.log('   - Test AccessDenied component');
console.log('');
console.log('4. Navigation Filtering');
console.log('   - Login with different roles');
console.log('   - Verify sidebar shows correct items');
console.log('   - Test route access permissions');
console.log('');

if (!allFilesExist) {
  console.log('❌ Some required files are missing. Please check the list above.');
  console.log('   Run the setup steps in SETUP_GOOGLE_OAUTH.md to complete configuration.');
  process.exit(1);
} else if (configIssues.length > 0) {
  console.log('⚠️  Configuration issues found. Please fix them before testing.');
  console.log('   Refer to the setup guides for proper configuration.');
  process.exit(0);
} else {
  console.log('✅ All checks passed!');
  console.log('🎉 The authentication system is properly configured.');
  console.log('📋 Proceed with manual testing using the TEST_PLAN.md guide.');
  process.exit(0);
}