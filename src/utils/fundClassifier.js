/**
 * src/utils/fundClassifier.js
 * Domain classifier and predicates for SSG Funds (Fiscal, FSG, IGF, IGP).
 * Resolves Primitive Obsession and prevents cross-fund classifier leakage.
 */

export const FUND_DOMAINS = {
  ALL: 'ALL',
  PPMP: 'PPMP', // Fiscal Year Budget & FSG Remittance
  IGF: 'IGF',   // Income Generated Funds (Merchandise, Uniforms, Apparel)
  IGP: 'IGP',   // Income-Generating Projects (Vending, Lockers, Enterprises)
};

export function isBudgetIGF(b) {
  if (!b) return false;
  return b.fundCategory === 'IGF' || b.fundAccountId === 'fund_igf_main';
}

export function isBudgetIGP(b) {
  if (!b) return false;
  return b.fundCategory === 'IGP' || b.fundAccountId === 'fund_igp_main';
}

export function isBudgetFSG(b) {
  if (!b) return false;
  // If it is explicitly IGF or IGP, it cannot be FSG
  if (isBudgetIGF(b) || isBudgetIGP(b)) return false;
  return b.fundAccountId === 'fund_fsg_remittance' || b.fundCategory === 'FSG_REMITTANCE' || Boolean(b.isFSG);
}

export function isBudgetPPMP(b) {
  if (!b) return false;
  // Strict precedence guard: enterprise funds (IGF/IGP) NEVER leak into PPMP
  if (isBudgetIGF(b) || isBudgetIGP(b)) {
    return false;
  }
  return (
    isBudgetFSG(b) ||
    b.fundAccountId === 'fund_fiscal_year_budget' ||
    b.fundCategory === 'FISCAL_YEAR_BUDGET' ||
    !b.fundAccountId
  );
}

export function classifyBudgetFund(b) {
  if (isBudgetIGF(b)) return FUND_DOMAINS.IGF;
  if (isBudgetIGP(b)) return FUND_DOMAINS.IGP;
  return FUND_DOMAINS.PPMP;
}

/**
 * Standard fallback enterprise distributions when no individual allocations exist yet.
 * Eliminates duplicate mock definitions across views.
 */
export const DEFAULT_ENTERPRISE_DISTRIBUTIONS = {
  IGP: (totalIgp = 0) => [
    { name: 'Vending Machines', allocated: totalIgp * 0.45, spent: 0, value: totalIgp * 0.45 || 1 },
    { name: 'Campus Lockers (HM)', allocated: totalIgp * 0.30, spent: 0, value: totalIgp * 0.30 || 1 },
    { name: 'Campus Lockers (ED)', allocated: totalIgp * 0.25, spent: 0, value: totalIgp * 0.25 || 1 },
  ],
  IGF: (totalIgf = 0) => [
    { name: 'Uniforms & Apparel', allocated: totalIgf * 0.50, spent: 0, value: totalIgf * 0.50 || 1 },
    { name: 'Lanyards & Badges', allocated: totalIgf * 0.30, spent: 0, value: totalIgf * 0.30 || 1 },
    { name: 'Student Accessories', allocated: totalIgf * 0.20, spent: 0, value: totalIgf * 0.20 || 1 },
  ],
};

