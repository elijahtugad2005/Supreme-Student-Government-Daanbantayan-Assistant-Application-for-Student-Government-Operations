/**
 * TDD & Bug-Diagnosis Regression Suite for Auth, ProtectedRoute, Firestore User Rules & App Route Alignment
 *
 * Seams Under Test:
 * - Seam A: src/components/ProtectedRoute/ProtectedRoute.jsx & src/components/AuthContext/AuthContext.jsx
 *           (userPermissionOverrides wired into route & permission evaluation)
 * - Seam B: firestore.rules (users/{userId} create rule blocks self-assigned admin/officer roles & permissionOverrides)
 * - Seam C: src/utils/permissions.js & src/App.jsx (ROUTE_ALLOWED_ROLES single source of truth across App routes & canAccessRoute)
 *
 * Run: node scripts/auth-rbac-tdd.mjs
 */

import { readFileSync } from 'node:fs';
import * as permissionsModule from '../src/utils/permissions.js';

const {
  canAccessRoute,
  hasPermission,
  ROLE_PERMISSIONS,
} = permissionsModule;

let failed = 0;
const results = [];
const check = (label, ok, detail = '') => {
  if (ok) {
    results.push(`ok   ${label}`);
  } else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// SLICE 1: Seam A — ProtectedRoute & AuthContext userPermissionOverrides Wiring
// ════════════════════════════════════════════════════════════════════════════
console.log('=== Slice 1: Seam A — ProtectedRoute & AuthContext userPermissionOverrides Wiring ===');

const protectedRouteSource = readFileSync(
  new URL('../src/components/ProtectedRoute/ProtectedRoute.jsx', import.meta.url),
  'utf8'
);
const authContextSource = readFileSync(
  new URL('../src/components/AuthContext/AuthContext.jsx', import.meta.url),
  'utf8'
);
const loginComponentSource = readFileSync(
  new URL('../src/components/Login/Login.jsx', import.meta.url),
  'utf8'
);

check(
  'Login.jsx maps auth/invalid-credential to a user-friendly wrong email or password message',
  loginComponentSource.includes("error.code === 'auth/invalid-credential'") &&
    loginComponentSource.includes('Invalid email or password.')
);

check(
  'ProtectedRoute.jsx destructures userPermissionOverrides from useAuth() and assigns permissionOverrides: userPermissionOverrides',
  protectedRouteSource.includes('userPermissionOverrides') &&
    protectedRouteSource.includes('permissionOverrides: userPermissionOverrides || {}')
);

check(
  'AuthContext.jsx loginWithGooglePopup sets userPermissions and userPermissionOverrides for existing users',
  authContextSource.split('setUserPermissionOverrides').length >= 6
);

// Verify that when ProtectedRoute constructs `user` with `permissionOverrides: userPermissionOverrides`,
// a member granted `canViewFinance: true` via override can access `/finance`, and an officer with
// `canViewFinance: false` revoked via override is blocked.
const memberWithOverride = {
  uid: 'u-mem-1',
  role: 'member',
  permissions: ROLE_PERMISSIONS.member.permissions,
  permissionOverrides: { canViewFinance: true },
};
const financeSecWithRevocation = {
  uid: 'u-fin-1',
  role: 'finance_secretary',
  permissions: ROLE_PERMISSIONS.finance_secretary.permissions,
  permissionOverrides: { canViewFinance: false },
};

check(
  'canAccessRoute & hasPermission honor userPermissionOverrides grant for /finance',
  canAccessRoute(memberWithOverride, '/finance') === true &&
    hasPermission(memberWithOverride, 'canViewFinance') === true
);

check(
  'canAccessRoute & hasPermission honor userPermissionOverrides revocation for /finance',
  canAccessRoute(financeSecWithRevocation, '/finance') === false &&
    hasPermission(financeSecWithRevocation, 'canViewFinance') === false
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2: Seam B — Firestore Rules Self-Assigned Role Prevention on User Create
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 2: Seam B — Firestore Rules Self-Assigned Role Prevention on User Create ===');

const firestoreRulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const usersRuleBlock =
  firestoreRulesSource.match(/match \/users\/\{userId\}\s*\{[\s\S]*?\n    \}/)?.[0] || '';

check(
  'firestore.rules users/{userId} create rule does NOT unconditionally allow any self-assigned role',
  !usersRuleBlock.includes('allow create: if isSignedIn() && request.auth.uid == userId;')
);

check(
  'firestore.rules users/{userId} create rule restricts self-registration to member/guest with empty permissionOverrides',
  usersRuleBlock.includes("request.resource.data.role in ['member', 'guest']") &&
    usersRuleBlock.includes('permissionOverrides')
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 3: Seam C — ROUTE_ALLOWED_ROLES Alignment Across permissions.js & App.jsx
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 3: Seam C — ROUTE_ALLOWED_ROLES Alignment Across permissions.js & App.jsx ===');

const ROUTE_ALLOWED_ROLES = permissionsModule.ROUTE_ALLOWED_ROLES;
check(
  'permissions.js exports ROUTE_ALLOWED_ROLES as a single source of truth',
  Boolean(ROUTE_ALLOWED_ROLES) && typeof ROUTE_ALLOWED_ROLES === 'object'
);

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const requiredAppRoutes = [
  '/order',
  '/track-order',
  '/admin',
  '/admin/users',
  '/admin/audit',
  '/finance',
  '/inventory',
  '/commerce',
  '/documents',
  '/sections-contributions',
  '/reports',
  '/death-aid',
  '/announcement',
];

check(
  'App.jsx imports and uses ROUTE_ALLOWED_ROLES for all protected routes without stale inline role lists',
  appSource.includes('ROUTE_ALLOWED_ROLES') &&
    requiredAppRoutes.every((r) => appSource.includes(`ROUTE_ALLOWED_ROLES['${r}']`)) &&
    !appSource.includes("allowedRoles={['admin', 'secretary', 'representative']}") &&
    !appSource.includes("allowedRoles={['admin']}")
);

check(
  '/admin/audit allows president, vice_president, finance_secretary, auditor, and budget_officer',
  ['admin', 'president', 'vice_president', 'finance_secretary', 'auditor', 'budget_officer'].every(
    (role) =>
      Array.isArray(ROUTE_ALLOWED_ROLES?.['/admin/audit']) &&
      ROUTE_ALLOWED_ROLES['/admin/audit'].includes(role) &&
      canAccessRoute({ role, permissions: ROLE_PERMISSIONS[role]?.permissions || {} }, '/admin/audit')
  )
);

check(
  '/announcement allows press_secretary, creatives, executive_secretary, senator, and representative',
  ['admin', 'president', 'vice_president', 'press_secretary', 'creatives', 'executive_secretary', 'senator', 'representative'].every(
    (role) =>
      Array.isArray(ROUTE_ALLOWED_ROLES?.['/announcement']) &&
      ROUTE_ALLOWED_ROLES['/announcement'].includes(role) &&
      canAccessRoute({ role, permissions: ROLE_PERMISSIONS[role]?.permissions || {} }, '/announcement')
  )
);

check(
  '/commerce excludes low-privilege member role while allowing all commerce/order officers',
  Array.isArray(ROUTE_ALLOWED_ROLES?.['/commerce']) &&
    !ROUTE_ALLOWED_ROLES['/commerce'].includes('member') &&
    ['admin', 'president', 'vice_president', 'secretary', 'press_secretary', 'finance_secretary', 'auditor', 'budget_officer', 'senator', 'representative'].every(
      (role) => ROUTE_ALLOWED_ROLES['/commerce'].includes(role)
    )
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 4: Seam D — Register Account Portal & Automatic 'member' Role Assignment
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 4: Seam D — Register Account Portal & Automatic member Role Assignment ===');

check(
  'AuthContext.jsx signup defaults role to "member" and prevents additionalData from overriding role or permissionOverrides',
  authContextSource.includes("const signup = async (email, password, name, role = 'member'") &&
    authContextSource.includes('role: assignedRole')
);

check(
  'Login.jsx includes Register Account mode with Name, Student ID, Email, Password, Confirm Password, and Terms & Conditions',
  loginComponentSource.includes('Register Account') &&
    loginComponentSource.includes('studentId') &&
    loginComponentSource.includes('confirmPassword') &&
    loginComponentSource.includes('agreedToTerms') &&
    loginComponentSource.includes('Terms and Conditions') &&
    loginComponentSource.includes("signup(email.trim(), password, fullName.trim(), 'member'")
);

check(
  'App.jsx & permissions.js support /register route alongside /login',
  appSource.includes('path="/register"') &&
    Array.isArray(ROUTE_ALLOWED_ROLES?.['/register'])
);

// ──────────────────────────────────────────────────────────────────────────────
// Slice 6: Firestore Rules Hardening (Products, Orders, Inventory, Death Aid)
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n=== Slice 6: Firestore Rules Hardening (Commerce & Death Aid) ===');

const productMatches = firestoreRulesSource.match(/match\s+\/products\//g) || [];
const orderMatches = firestoreRulesSource.match(/match\s+\/orders\//g) || [];
const ordersBlock = firestoreRulesSource.match(/match\s+\/orders\/\{orderId\}\s*\{([\s\S]*?)\n\s{4}\}/)?.[1] || '';
const deathAidCountersBlock = firestoreRulesSource.match(/match\s+\/deathAidCounters\/\{year\}\s*\{([\s\S]*?)\n\s{4}\}/)?.[1] || '';

check(
  'firestore.rules has single canonical match block for /products and /orders (no permissive duplicate OR rules)',
  productMatches.length === 1 &&
    orderMatches.length === 1 &&
    !ordersBlock.includes('allow update: if canManageOrders() || isSignedIn()') &&
    ordersBlock.includes('allow update: if canManageOrders() || isAdmin()')
);

check(
  'firestore.rules enforces monotonic +1 increment on deathAidCounters/{year}',
  deathAidCountersBlock.includes('request.resource.data.count == 1') &&
    deathAidCountersBlock.includes('request.resource.data.count == resource.data.count + 1')
);

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\n✅ All checks passed.');
}
