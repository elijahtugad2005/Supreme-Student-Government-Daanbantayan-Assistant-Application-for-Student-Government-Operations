// utils/providerAccessGates.js
// PURPOSE: Fail-closed client-side access gates for global React Context providers
// (InventoryProvider & FinanceProvider) so public visitors, guests, students, and
// unauthorized roles never trigger permission-denied Firestore queries on mount.
// Mirrors firestore.rules `inventory`, `borrowingLogs`, `fundAccounts`, and `budgetAllocations`.

import { isProfileActive, hasPermission } from './permissions.js';

const INVENTORY_PROVIDER_ROLES = new Set([
  'admin',
  'president',
  'vice_president',
  'secretary',
  'executive_secretary',
  'deputy_secretary',
  'press_secretary',
  'linkages_secretary',
  'finance_secretary',
  'auditor',
  'budget_officer',
  'governor',
  'representative',
  'senator',
]);

const FINANCE_PROVIDER_ROLES = new Set([
  'admin',
  'president',
  'vice_president',
  'secretary',
  'executive_secretary',
  'finance_secretary',
  'auditor',
  'budget_officer',
]);

const normalizeRole = (role) =>
  typeof role === 'string' ? role.trim().toLowerCase() : '';

const hasExplicitOverride = (user, key) =>
  Boolean(user?.permissionOverrides && user.permissionOverrides[key] === true);

export const canFetchInventoryProvider = (user) => {
  if (!user || !user.uid || !isProfileActive(user)) return false;
  const role = normalizeRole(user.role);
  if (hasExplicitOverride(user, 'canManageInventory') || hasExplicitOverride(user, 'canManageOrders')) {
    return true;
  }
  return INVENTORY_PROVIDER_ROLES.has(role);
};

export const canFetchFinanceProvider = (user) => {
  if (!user || !user.uid || !isProfileActive(user)) return false;
  const role = normalizeRole(user.role);
  if (
    hasExplicitOverride(user, 'canViewFinance') ||
    hasExplicitOverride(user, 'canEditFinance')
  ) {
    return true;
  }
  if (FINANCE_PROVIDER_ROLES.has(role)) return true;
  return hasPermission(user, 'canViewFinance');
};
