# Authentication & Role Management Test Plan

## Overview
This document outlines the testing procedures for the Google Sign-In authentication system and Role Management Dashboard implemented in the SSG App.

## Test Environment Setup

### Prerequisites
1. Firebase Project configured with Google OAuth enabled
2. Google OAuth credentials added to `.env.local`
3. Development server running (`npm run dev`)
4. Admin user account with role "admin" exists

### Environment Variables Check
```bash
# Run the configuration check
npm run check-auth
```

## Test Cases

### Test Case 1: Google Sign-In Authentication

#### Test Steps:
1. **Navigate to Login Page**
   - Open browser to `http://localhost:3000/login`
   - Verify login page loads with both Google Sign-In button and email/password form

2. **Google Sign-In (New User)**
   - Click "Continue with Google" button
   - Complete Google OAuth consent screen
   - Verify successful redirect to homepage
   - Check user role defaults to "member"
   - Verify user appears in User Management dashboard

3. **Google Sign-In (Existing User)**
   - Logout current user
   - Sign in again with same Google account
   - Verify user data persists (role, permissions)
   - Verify last login timestamp updates

4. **Google Sign-In Errors**
   - Test with invalid/revoked OAuth credentials
   - Test popup blocked scenario
   - Verify error messages display correctly

#### Expected Results:
- Google Sign-In button works correctly
- New users get "member" role by default
- User data persists between logins
- Error handling works properly

### Test Case 2: Role-Based Access Control

#### Test Steps:
1. **Admin Access Tests**
   - Login as admin user
   - Verify access to `/admin`, `/admin/users`, `/admin/audit`
   - Verify User Management dashboard loads
   - Verify all admin features are accessible

2. **Secretary Access Tests**
   - Create/use secretary account
   - Verify access to `/finance`, `/inventory`, `/announcement`
   - Verify NO access to `/admin/users`
   - Verify appropriate permissions in User Management

3. **Representative Access Tests**
   - Create/use representative account
   - Verify access to `/commerce`, `/inventory`, `/announcement`
   - Verify NO access to `/finance`, `/admin`
   - Verify appropriate permissions

4. **Member Access Tests**
   - Create/use member account (Google Sign-In default)
   - Verify access to `/order`, `/track-order`, `/commerce`
   - Verify NO access to admin/management features
   - Verify basic permissions

5. **Guest Access Tests**
   - Create/use guest account (email sign-up)
   - Verify limited access to public pages only
   - Verify NO access to member features

#### Expected Results:
- Each role has correct access permissions
- Access denied pages show appropriate messages
- Sidebar navigation filters correctly

### Test Case 3: Role Management Dashboard

#### Test Steps:
1. **Dashboard Access**
   - Login as admin
   - Navigate to `/admin/users`
   - Verify User Management dashboard loads
   - Verify statistics show correctly

2. **User Search & Filter**
   - Search for users by name/email
   - Filter users by role
   - Filter users by status (active/inactive)
   - Test pagination functionality

3. **Role Assignment**
   - Select a non-admin user
   - Change their role (e.g., member → secretary)
   - Verify role change success
   - Check audit trail for role change log

4. **User Status Management**
   - Deactivate an active user
   - Verify user cannot login
   - Reactivate the user
   - Verify user can login again

5. **Export Functionality**
   - Export user list to CSV
   - Verify CSV file downloads
   - Verify file contains correct data

6. **Audit Trail**
   - Navigate to `/admin/audit`
   - Verify role changes appear in audit log
   - Test search and filter in audit trail
   - Export audit log to CSV

#### Expected Results:
- Admin can view all users
- Role changes work correctly
- Status changes work correctly
- Export functionality works
- Audit trail logs all changes

### Test Case 4: Permission System Integration

#### Test Steps:
1. **Component-Level Permission Checks**
   - Test `usePermissions` hook in components
   - Verify `renderIf` conditional rendering works
   - Test permission-based UI elements

2. **Route-Level Permission Checks**
   - Test ProtectedRoute with various permissions
   - Verify custom AccessDenied components display
   - Test route access with insufficient permissions

3. **Navigation Filtering**
   - Login with different roles
   - Verify Sidebar shows correct navigation items
   - Test permission-based menu filtering

4. **API/Service Integration**
   - Test userManagementService functions
   - Verify permission checking in service layer
   - Test audit logging functionality

#### Expected Results:
- Permission system integrates seamlessly
- Components respect permission rules
- Navigation adapts to user permissions

### Test Case 5: Error Handling & Edge Cases

#### Test Steps:
1. **Invalid Role Assignments**
   - Try to assign invalid role
   - Try to demote admin (self-demotion prevention)
   - Test role assignment validation

2. **Database Schema Validation**
   - Test user creation with missing required fields
   - Test permission validation
   - Test duplicate user handling

3. **Authentication Edge Cases**
   - Test login with revoked Google account
   - Test concurrent login sessions
   - Test session timeout handling

4. **Permission Edge Cases**
   - Test with corrupted permission data
   - Test with undefined/null permissions
   - Test permission inheritance

#### Expected Results:
- System handles errors gracefully
- Validation prevents invalid operations
- Edge cases don't break core functionality

## Test Data

### Test Users
Create these test accounts:

1. **Admin User**
   - Email: `admin@test.com`
   - Password: `Admin123!`
   - Role: `admin`

2. **Secretary User**
   - Email: `secretary@test.com`
   - Password: `Secretary123!`
   - Role: `secretary`

3. **Representative User**
   - Email: `representative@test.com`
   - Password: `Rep123!`
   - Role: `representative`

4. **Member User (Google)**
   - Use personal Google account
   - Role should default to `member`

5. **Guest User**
   - Email: `guest@test.com`
   - Password: `Guest123!`
   - Role: `guest`

## Testing Tools

### Manual Testing
1. Browser developer tools for network monitoring
2. Firebase Console for user verification
3. Firestore database viewer

### Automated Testing (Future)
1. Jest test suite for permission utilities
2. React Testing Library for component tests
3. Cypress for E2E testing

## Success Criteria

### Must Have:
- ✅ Google Sign-In works for new and existing users
- ✅ Role-based access control works correctly
- ✅ Admin can manage user roles
- ✅ Permission system integrates throughout app
- ✅ Error handling works for common scenarios

### Should Have:
- ✅ User Management dashboard fully functional
- ✅ Audit trail logs all admin actions
- ✅ Export functionality works
- ✅ Navigation filters correctly by role/permissions

### Nice to Have:
- ✅ Comprehensive test coverage
- ✅ Performance optimization for large user lists
- ✅ Advanced search capabilities
- ✅ Bulk operations for user management

## Troubleshooting Guide

### Common Issues:

1. **Google Sign-In Not Working**
   - Check Google OAuth configuration in Firebase Console
   - Verify `.env.local` has correct credentials
   - Check browser console for OAuth errors
   - Ensure redirect URIs are configured

2. **Role Changes Not Reflecting**
   - Check Firestore user document updates
   - Verify AuthContext reloads user data
   - Clear browser cache and localStorage
   - Check audit trail for role change logs

3. **Permission Issues**
   - Verify user permissions in Firestore
   - Check role permissions configuration
   - Test with different user accounts
   - Check browser console for permission errors

4. **Dashboard Not Loading**
   - Check admin user role
   - Verify Firestore connection
   - Check network requests in dev tools
   - Verify component imports are correct

### Debugging Steps:
1. Open browser developer tools
2. Check Console tab for errors
3. Check Network tab for failed requests
4. Check Application tab for localStorage
5. Check Firebase Console for authentication logs
6. Check Firestore for data consistency

## Test Report Template

```markdown
# Test Report - [Date]

## Test Environment
- Browser: [Browser Version]
- Node: [Node Version]
- Firebase: [Project ID]
- Test Date: [Date]

## Test Results

### Test Case 1: Google Sign-In Authentication
- [ ] New user registration
- [ ] Existing user login
- [ ] Error handling
- [ ] Role assignment

### Test Case 2: Role-Based Access Control
- [ ] Admin access
- [ ] Secretary access
- [ ] Representative access
- [ ] Member access
- [ ] Guest access

### Test Case 3: Role Management Dashboard
- [ ] Dashboard access
- [ ] User search/filter
- [ ] Role assignment
- [ ] Status management
- [ ] Export functionality
- [ ] Audit trail

### Test Case 4: Permission System Integration
- [ ] Component permissions
- [ ] Route permissions
- [ ] Navigation filtering
- [ ] Service integration

### Test Case 5: Error Handling & Edge Cases
- [ ] Invalid operations
- [ ] Validation errors
- [ ] Edge case handling

## Issues Found
1. [Issue description]
   - Severity: [High/Medium/Low]
   - Status: [Open/In Progress/Resolved]
   - Steps to reproduce: [Steps]
   - Expected behavior: [Expected]
   - Actual behavior: [Actual]

## Recommendations
1. [Recommendation 1]
2. [Recommendation 2]
3. [Recommendation 3]

## Overall Assessment
[Overall assessment of system readiness]
```

## Next Steps After Testing

1. **Address Critical Issues**
   - Fix any blocking issues found
   - Verify fixes don't introduce regressions

2. **Performance Optimization**
   - Optimize large user list loading
   - Implement pagination improvements
   - Add loading states where needed

3. **Security Review**
   - Review permission validation
   - Check audit trail completeness
   - Verify no unauthorized access paths

4. **Documentation Updates**
   - Update user guides
   - Update admin documentation
   - Update deployment guides

5. **Production Readiness**
   - Final security review
   - Performance testing
   - User acceptance testing
   - Deployment planning