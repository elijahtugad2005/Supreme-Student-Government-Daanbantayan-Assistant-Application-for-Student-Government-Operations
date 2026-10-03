// services/roleClaims.js
// PURPOSE: Keep the ID token's `role` claim in step with the Firestore profile.
//
// Why this exists: storage.rules authorises on request.auth.token.role, because
// Storage rules cannot read Firestore. Without the claim, every document upload
// fails with "permission denied" even though Firestore allowed the metadata
// write — leaving an orphaned record and a file nobody can find.
//
// The claim is never set from the client. syncClaims() asks the function to copy
// the role from the user's own Firestore document, so the token cannot be used to
// escalate.

import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app';

const FUNCTIONS_REGION = 'us-central1';

const callable = (name) => {
  const fns = getFunctions(getApp(), FUNCTIONS_REGION);
  return httpsCallable(fns, name);
};

/**
 * Ask the function to refresh this user's role claim.
 * @returns {Promise<{ok: boolean, role: string|null, changed: boolean}>}
 */
export const syncClaims = async () => {
  const { data } = await callable('syncClaims')();
  return data;
};

/**
 * Ensure the signed-in user's token carries their current role.
 *
 * Called on every auth state change, but only does real work when the token is
 * actually stale — comparing the local claim costs nothing, whereas an
 * unnecessary setCustomUserClaims call would invalidate the token and force a
 * refresh on every page load.
 *
 * @param {import('firebase/auth').User} user
 * @param {string|null} firestoreRole the role just read from Firestore
 * @returns {Promise<boolean>} whether the token was refreshed
 */
export const ensureRoleClaim = async (user, firestoreRole) => {
  if (!user) return false;

  try {
    const token = await user.getIdTokenResult();
    const tokenRole = token.claims?.role || null;

    if (tokenRole === (firestoreRole || null)) return false;

    await syncClaims();
    // Force a fresh token so the new claim is present immediately rather than
    // on the next hourly refresh.
    await user.getIdToken(true);
    return true;
  } catch (error) {
    // A missing claims function must never block sign-in. Firestore rules read
    // the role from the user document, so most of the app keeps working; only
    // Storage access needs the claim.
    console.warn('[roleClaims] could not sync the role claim:', error.message);
    return false;
  }
};

/**
 * Admin-only: push a role change to another user's token straight away.
 */
export const syncClaimsForUser = async (targetUid) => {
  const { data } = await callable('setRoleClaims')({ targetUid });
  return data;
};