/**
 * authDomainPolicy.js
 * Email domain & verification policy for public student self-registration.
 *
 * Flip `REQUIRE_INSTITUTIONAL_CTU_EMAIL` to `true` when ready to restrict
 * public self-registration and Student Member sessions strictly to `@ctu.edu.ph`.
 * While `false` (demonstration mode), standard Gmail and institutional emails
 * are allowed, while email verification and officer/admin RBAC remain enforced.
 */

export const INSTITUTIONAL_EMAIL_DOMAIN = 'ctu.edu.ph';
export const REQUIRE_INSTITUTIONAL_CTU_EMAIL = false;

const CTU_EMAIL_RE = /^[^\s@]+@ctu\.edu\.ph$/i;
const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isInstitutionalCtuEmail(email) {
  return CTU_EMAIL_RE.test(String(email || '').trim());
}

export function isAllowedRegistrationEmail(email) {
  const clean = String(email || '').trim();
  if (!BASIC_EMAIL_RE.test(clean)) return false;
  return REQUIRE_INSTITUTIONAL_CTU_EMAIL ? isInstitutionalCtuEmail(clean) : true;
}

export function validateStudentRegistrationEmail(email) {
  const clean = String(email || '').trim();
  if (!clean) {
    return { valid: false, error: 'Email address is required.' };
  }
  if (!BASIC_EMAIL_RE.test(clean)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }
  if (REQUIRE_INSTITUTIONAL_CTU_EMAIL && !isInstitutionalCtuEmail(clean)) {
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
  return isAllowedRegistrationEmail(email) && emailVerified === true;
}

export function evaluateMemberSessionPolicy({ role, email, emailVerified } = {}) {
  if (String(role || '').toLowerCase() !== 'member') {
    return { allowed: true, code: null, reason: '' };
  }
  if (!isAllowedRegistrationEmail(email)) {
    return {
      allowed: false,
      code: 'auth/invalid-institutional-domain',
      reason: REQUIRE_INSTITUTIONAL_CTU_EMAIL
        ? `Only official @${INSTITUTIONAL_EMAIL_DOMAIN} institutional email addresses may access Student Member accounts.`
        : 'Please use a valid email address to access Student Member accounts.',
    };
  }
  if (emailVerified !== true) {
    return {
      allowed: false,
      code: 'auth/email-not-verified',
      reason: REQUIRE_INSTITUTIONAL_CTU_EMAIL
        ? `Please verify your @${INSTITUTIONAL_EMAIL_DOMAIN} email address using the link sent to your inbox before signing in.`
        : 'Please verify your email address using the link sent to your inbox before signing in.',
    };
  }
  return { allowed: true, code: null, reason: '' };
}
