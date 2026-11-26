/**
 * authDomainPolicy.js
 * Institutional email domain & verification policy for public student self-registration.
 *
 * Security invariants:
 *  - Public self-registration (Email/Password or new Google Sign-In) is restricted to
 *    official `@ctu.edu.ph` institutional accounts so arbitrary internet users cannot
 *    self-provision `role: 'member'`.
 *  - Self-registered `member` accounts must verify their `@ctu.edu.ph` email before
 *    entering member-scoped screens (e.g. Class Rosters & Death Aid).
 *  - Existing pre-provisioned SSG officers/admins in `users/{uid}` are unaffected.
 */

export const INSTITUTIONAL_EMAIL_DOMAIN = 'ctu.edu.ph';

const CTU_EMAIL_RE = /^[^\s@]+@ctu\.edu\.ph$/i;

export function isInstitutionalCtuEmail(email) {
  return CTU_EMAIL_RE.test(String(email || '').trim());
}

export function validateStudentRegistrationEmail(email) {
  const clean = String(email || '').trim();
  if (!clean) {
    return { valid: false, error: 'Email address is required.' };
  }
  if (!isInstitutionalCtuEmail(clean)) {
    return {
      valid: false,
      error: `Only official @${INSTITUTIONAL_EMAIL_DOMAIN} institutional email addresses may self-register as a Student Member.`,
    };
  }
  return { valid: true, error: '' };
}

export function isVerifiedMemberSession({ role, email, emailVerified } = {}) {
  if (String(role || '').toLowerCase() !== 'member') {
    return true;
  }
  return isInstitutionalCtuEmail(email) && emailVerified === true;
}

export function evaluateMemberSessionPolicy({ role, email, emailVerified } = {}) {
  if (String(role || '').toLowerCase() !== 'member') {
    return { allowed: true, code: null, reason: '' };
  }
  if (!isInstitutionalCtuEmail(email)) {
    return {
      allowed: false,
      code: 'auth/invalid-institutional-domain',
      reason: `Only official @${INSTITUTIONAL_EMAIL_DOMAIN} institutional email addresses may access Student Member accounts.`,
    };
  }
  if (emailVerified !== true) {
    return {
      allowed: false,
      code: 'auth/email-not-verified',
      reason: `Please verify your @${INSTITUTIONAL_EMAIL_DOMAIN} email address using the link sent to your inbox before signing in.`,
    };
  }
  return { allowed: true, code: null, reason: '' };
}
