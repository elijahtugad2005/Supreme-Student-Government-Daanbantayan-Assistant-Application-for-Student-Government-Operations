// context/AuthContext.jsx
// PURPOSE: Manages user authentication state across the entire app
// FUNCTIONS:
//   - Tracks if user is logged in
//   - Stores user data (email, role, name)
//   - Provides login/logout/signup functions to all components

import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import { auth, db, googleProvider } from "../../firebase/firebaseConfig.js";
// Statically imported: this module is also imported by many others, so the
// dynamic import only produced a mixed-import warning without saving anything.
import { getDefaultPermissionsForRole, isProfileActive } from '../../utils/permissions.js';
import {
  INSTITUTIONAL_EMAIL_DOMAIN,
  REQUIRE_INSTITUTIONAL_CTU_EMAIL,
  evaluateMemberSessionPolicy,
  isAllowedRegistrationEmail,
  validateStudentRegistrationEmail,
} from '../../utils/authDomainPolicy.js';
import { ensureRoleClaim } from '../../services/roleClaims.js';
import { usingEmulators } from '../../firebase/emulators.js';
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult
} from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';

const DEACTIVATED_ACCOUNT_MESSAGE =
  'Your account has been deactivated. Please contact an SSG administrator.';

const INSTITUTIONAL_DOMAIN_ERROR_MESSAGE = REQUIRE_INSTITUTIONAL_CTU_EMAIL
  ? `Only official @${INSTITUTIONAL_EMAIL_DOMAIN} institutional email addresses may self-register as a Student Member. Officers with pre-provisioned accounts may still sign in normally.`
  : 'Please sign in with a valid email address.';

const UNVERIFIED_EMAIL_ERROR_MESSAGE = REQUIRE_INSTITUTIONAL_CTU_EMAIL
  ? `Please verify your @${INSTITUTIONAL_EMAIL_DOMAIN} email address using the link sent to your inbox before signing in.`
  : 'Please verify your email address using the link sent to your inbox before signing in.';

const createDeactivatedAccountError = () => {
  const err = new Error(DEACTIVATED_ACCOUNT_MESSAGE);
  err.code = 'auth/account-deactivated';
  return err;
};

const createInstitutionalDomainError = () => {
  const err = new Error(INSTITUTIONAL_DOMAIN_ERROR_MESSAGE);
  err.code = 'auth/invalid-institutional-domain';
  return err;
};

const createUnverifiedEmailError = () => {
  const err = new Error(UNVERIFIED_EMAIL_ERROR_MESSAGE);
  err.code = 'auth/email-not-verified';
  return err;
};

// Create context to share auth data across app
const AuthContext = createContext();

// Custom hook to easily access auth data in any component
export const useAuth = () => {
  return useContext(AuthContext);
};

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState(null);
  // Role defaults and per-user overrides, loaded from users/{uid}. Together
  // these decide what this account can actually reach.
  const [userPermissions, setUserPermissions] = useState({});
  const [userPermissionOverrides, setUserPermissionOverrides] = useState({});
  const [isAccountActive, setIsAccountActive] = useState(true);
  const [authError, setAuthError] = useState(null);
  const signupInProgressRef = useRef(false);
  const redirectPendingRef = useRef(false);

  const clearAuthError = () => setAuthError(null);

  const clearUserProfileState = ({ active = true } = {}) => {
    setCurrentUser(null);
    setUserRole(null);
    setUserName(null);
    setUserPermissions({});
    setUserPermissionOverrides({});
    setIsAccountActive(active);
  };

  // ========================================
  // SIGNUP FUNCTION
  // Restricts self-registration to official @ctu.edu.ph accounts,
  // sends Firebase email verification, and omits client-supplied permissions map.
  // ========================================
  const signup = async (email, password, name, role = 'member', additionalData = {}) => {
    signupInProgressRef.current = true;
    try {
      const domainCheck = validateStudentRegistrationEmail(email);
      if (!domainCheck.valid) {
        throw createInstitutionalDomainError();
      }

      // Self-registered accounts automatically get the 'member' role
      const assignedRole = role === 'guest' ? 'guest' : 'member';

      // Create Firebase Auth account
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const user = userCredential.user;

      // Sanitize additionalData so role/permissions cannot be overridden
      const {
        role: _ignoredRole,
        permissions: _ignoredPerms,
        permissionOverrides: _ignoredOverrides,
        ...safeAdditionalData
      } = additionalData || {};

      // Store user profile WITHOUT client-supplied `permissions` map (enforced by firestore.rules)
      const userData = {
        ...safeAdditionalData,
        uid: user.uid,
        email: user.email,
        name: name,
        studentId: safeAdditionalData.studentId || '',
        photoURL: null,
        role: assignedRole,
        provider: 'email',
        isEmailVerified: Boolean(user.emailVerified),
        isActive: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        department: safeAdditionalData.department || '',
        phone: safeAdditionalData.phone || '',
        address: safeAdditionalData.address || '',
        notes: safeAdditionalData.notes || ''
      };

      await setDoc(doc(db, 'users', user.uid), userData);

      // Send verification link to the @ctu.edu.ph inbox and require verification before sign-in
      try {
        await sendEmailVerification(user);
      } catch (verifyErr) {
        console.warn('[AuthContext] sendEmailVerification warning:', verifyErr.message);
      }

      clearUserProfileState({ active: true });
      await signOut(auth);

      return {
        ...userCredential,
        verificationRequired: true,
        email: user.email,
      };
    } catch (error) {
      console.error('Signup error:', error);
      throw error;
    } finally {
      signupInProgressRef.current = false;
    }
  };

  // ========================================
  // LOGIN FUNCTION
  // Authenticates user, enforces deactivation & @ctu.edu.ph email verification for members
  // ========================================
  const login = async (email, password) => {
    try {
      setAuthError(null);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);

      // Fetch user data from Firestore and verify account is not deactivated
      const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (!isProfileActive(userData)) {
          clearUserProfileState({ active: false });
          setAuthError(DEACTIVATED_ACCOUNT_MESSAGE);
          await signOut(auth);
          throw createDeactivatedAccountError();
        }

        // Enforce @ctu.edu.ph domain + email verification for student members
        const memberPolicy = evaluateMemberSessionPolicy({
          role: userData.role,
          email: userCredential.user.email,
          emailVerified: userCredential.user.emailVerified,
        });
        if (!memberPolicy.allowed) {
          if (memberPolicy.code === 'auth/email-not-verified') {
            try {
              await sendEmailVerification(userCredential.user);
            } catch {
              // Rate-limited or already recently sent
            }
            clearUserProfileState({ active: true });
            setAuthError(UNVERIFIED_EMAIL_ERROR_MESSAGE);
            await signOut(auth);
            throw createUnverifiedEmailError();
          }
          clearUserProfileState({ active: true });
          setAuthError(INSTITUTIONAL_DOMAIN_ERROR_MESSAGE);
          await signOut(auth);
          throw createInstitutionalDomainError();
        }

        setIsAccountActive(true);
        setUserRole(userData.role);
        setUserName(userData.name || null);
        setUserPermissions(userData.permissions || getDefaultPermissionsForRole(userData.role));
        setUserPermissionOverrides(userData.permissionOverrides || {});
      }

      return userCredential;
    } catch (error) {
      throw error;
    }
  };

  // ========================================
  // GOOGLE SIGN-IN FUNCTIONS
  // Handles Google OAuth authentication
  // ========================================
  
  // Shared Firestore profile sync for both popup and redirect Google sign-ins.
  const syncGoogleUserProfile = async (user, createdNotes) => {
    const userDocRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      // Enforce registration email policy + verified email before self-provisioning `member`
      if (!isAllowedRegistrationEmail(user.email) || !user.emailVerified) {
        clearUserProfileState({ active: true });
        setAuthError(INSTITUTIONAL_DOMAIN_ERROR_MESSAGE);
        await signOut(auth);
        throw createInstitutionalDomainError();
      }

      const defaultPermissions = getDefaultPermissionsForRole('member');
      const userData = {
        uid: user.uid,
        email: user.email,
        name: user.displayName || 'Google User',
        photoURL: user.photoURL,
        role: 'member',
        provider: 'google',
        isEmailVerified: true,
        isActive: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        department: '',
        phone: '',
        address: '',
        notes: createdNotes,
      };

      await setDoc(userDocRef, userData);
      setIsAccountActive(true);
      setAuthError(null);
      setUserRole('member');
      setUserName(user.displayName || 'Google User');
      setUserPermissions(defaultPermissions);
      setUserPermissionOverrides({});
      return;
    }

    const userData = userDoc.data();
    if (!isProfileActive(userData)) {
      clearUserProfileState({ active: false });
      setAuthError(DEACTIVATED_ACCOUNT_MESSAGE);
      await signOut(auth);
      throw createDeactivatedAccountError();
    }

    const memberPolicy = evaluateMemberSessionPolicy({
      role: userData.role,
      email: user.email,
      emailVerified: user.emailVerified,
    });
    if (!memberPolicy.allowed) {
      clearUserProfileState({ active: true });
      setAuthError(memberPolicy.reason);
      await signOut(auth);
      throw memberPolicy.code === 'auth/email-not-verified'
        ? createUnverifiedEmailError()
        : createInstitutionalDomainError();
    }

    await setDoc(userDocRef, { lastLoginAt: new Date().toISOString() }, { merge: true });
    setIsAccountActive(true);
    setAuthError(null);
    setUserRole(userData.role);
    setUserName(userData.name || user.displayName || 'Google User');
    setUserPermissions(userData.permissions || getDefaultPermissionsForRole(userData.role));
    setUserPermissionOverrides(userData.permissionOverrides || {});
  };

  // Sign in with Google using popup (recommended for web)
  const loginWithGooglePopup = async () => {
    try {
      setAuthError(null);
      const result = await signInWithPopup(auth, googleProvider);
      await syncGoogleUserProfile(result.user, 'Created via Google Sign-In');
      return result;
    } catch (error) {
      console.error('Google sign-in error:', error);
      throw error;
    }
  };

  // Sign in with Google using redirect (for mobile or popup-blocked environments)
  const loginWithGoogleRedirect = () => {
    setAuthError(null);
    return signInWithRedirect(auth, googleProvider);
  };

  // Handle redirect result (for redirect sign-in)
  const handleRedirectResult = async () => {
    redirectPendingRef.current = true;
    try {
      const result = await getRedirectResult(auth);
      if (result) {
        await syncGoogleUserProfile(result.user, 'Created via Google Sign-In (Redirect)');
      }
    } catch (error) {
      console.error('Redirect result error:', error);
    } finally {
      redirectPendingRef.current = false;
    }
  };

  // ========================================
  // LOGOUT FUNCTION
  // Signs out user and clears auth state
  // ========================================
  const logout = () => {
    // Clear all auth state before signing out
    setAuthError(null);
    clearUserProfileState({ active: true });
    return signOut(auth);
  };

  // ========================================
  // AUTH STATE LISTENER
  // Runs on app load and whenever auth state changes.
  // Subscribes in real time to users/{uid} so deactivating an officer in
  // User Management immediately terminates their live session.
  // ========================================
  useEffect(() => {
    // Check for redirect result on initial load
    handleRedirectResult();

    let unsubscribeUserDoc = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
        unsubscribeUserDoc = null;
      }

      if (signupInProgressRef.current) {
        return;
      }

      if (!user) {
        // User is logged out — preserve authError if sign-out was triggered by deactivation/policy
        setCurrentUser(null);
        setUserRole(null);
        setUserName(null);
        setUserPermissions({});
        setUserPermissionOverrides({});
        setLoading(false);
        return;
      }

      // Subscribe in real time to the user's Firestore profile BEFORE exposing
      // currentUser so a deactivated or unverified account can never flash past /login.
      unsubscribeUserDoc = onSnapshot(
        doc(db, 'users', user.uid),
        async (userDoc) => {
          if (signupInProgressRef.current) {
            return;
          }
          try {
            if (userDoc.exists()) {
              const userData = userDoc.data();

              if (!isProfileActive(userData)) {
                console.warn('[auth] Account deactivated — forcing immediate sign-out for UID:', user.uid);
                clearUserProfileState({ active: false });
                setAuthError(DEACTIVATED_ACCOUNT_MESSAGE);
                setLoading(false);
                try {
                  await signOut(auth);
                } catch (signOutError) {
                  console.error('[auth] Forced sign-out after deactivation failed:', signOutError);
                }
                return;
              }

              const memberPolicy = evaluateMemberSessionPolicy({
                role: userData.role,
                email: user.email,
                emailVerified: user.emailVerified,
              });
              if (!memberPolicy.allowed) {
                console.warn('[auth] Member session blocked by institutional policy:', memberPolicy.code);
                clearUserProfileState({ active: true });
                setAuthError(memberPolicy.reason);
                setLoading(false);
                try {
                  await signOut(auth);
                } catch (signOutError) {
                  console.error('[auth] Forced sign-out for unverified/non-CTU member failed:', signOutError);
                }
                return;
              }

              setIsAccountActive(true);
              setAuthError(null);
              setCurrentUser(user);
              setUserRole(userData.role);
              setUserName(userData.name || user.displayName || null);
              // Access data is read from the Firestore profile, not the Auth
              // object — Firebase Auth users carry no role or permission fields.
              // Without these, per-user permission overrides from User Management
              // would never reach the app.
              setUserPermissions(userData.permissions || {});
              setUserPermissionOverrides(userData.permissionOverrides || {});

              // Storage rules authorise on the role claim in the ID token, which
              // is separate from this Firestore document. Fire-and-forget: a
              // failure here must not interrupt sign-in, and most of the app works
              // without the claim because Firestore rules read the document.
              ensureRoleClaim(user, userData.role);
            } else if (usingEmulators()) {
              // With the Firestore emulator active, its data does NOT survive a
              // restart, so every fresh emulator begins empty. Auto-provisioning
              // is strictly gated on the emulator flag and never runs in production.
              try {
                await setDoc(
                  doc(db, 'users', user.uid),
                  {
                    role: 'admin',
                    name: user.displayName || user.email || 'Local developer',
                    permissions: getDefaultPermissionsForRole('admin'),
                    isActive: true,
                    provisionedLocally: true,
                    provisionedAt: new Date().toISOString(),
                  },
                  { merge: true }
                );
                console.warn(
                  '[auth] No profile found, so one was created with role=admin in the ' +
                    'EMULATOR database. This does not happen in production.'
                );
                setIsAccountActive(true);
                setCurrentUser(user);
                setUserRole('admin');
                setUserName(user.displayName || user.email || 'Local developer');
                setUserPermissions(getDefaultPermissionsForRole('admin'));
                setUserPermissionOverrides({});
                ensureRoleClaim(user, 'admin');
              } catch (provisionError) {
                console.error('[auth] Could not provision a local profile:', provisionError);
                clearUserProfileState({ active: true });
              }
            } else {
              // Never expose an unprofiled/orphan Firebase Auth session as logged in;
              // if Google redirect is still resolving, let handleRedirectResult() finish
              // provisioning (for @ctu.edu.ph) or rejecting & signing out (for outsiders).
              if (redirectPendingRef.current) {
                return;
              }
              console.warn('[auth] No user profile found in Firestore for UID:', user.uid);
              clearUserProfileState({ active: true });
              if (!isAllowedRegistrationEmail(user.email)) {
                setAuthError(INSTITUTIONAL_DOMAIN_ERROR_MESSAGE);
                try {
                  await signOut(auth);
                } catch (signOutError) {
                  console.error('[auth] Forced sign-out for orphan account failed:', signOutError);
                }
              }
            }
          } catch (error) {
            console.error('Error processing user profile snapshot:', error);
            setUserRole(null);
            setUserName(null);
            setUserPermissions({});
            setUserPermissionOverrides({});
          } finally {
            setLoading(false);
          }
        },
        (error) => {
          console.error('Error subscribing to user profile:', error);
          setCurrentUser(null);
          setUserRole(null);
          setUserName(null);
          setUserPermissions({});
          setUserPermissionOverrides({});
          setLoading(false);
        }
      );
    });

    // Cleanup listeners on unmount
    return () => {
      if (unsubscribeUserDoc) unsubscribeUserDoc();
      unsubscribeAuth();
    };
  }, []);

  // Values accessible to all components via useAuth()
  const value = {
    currentUser,      // Firebase user object
    userRole,         // 'admin', 'secretary', 'representative', or 'member'
    userName,         // User's display name from Firestore
    userPermissions,  // Role defaults snapshot from Firestore
    userPermissionOverrides, // Per-user grants/revocations set by an Admin
    isAccountActive,  // False when Firestore users/{uid}.isActive === false
    authError,        // Surfaced on Login page after forced deactivation sign-out
    clearAuthError,   // Resets authError when starting a fresh auth attempt
    login,            // Function to log in with email/password
    signup,           // Function to create account with email/password
    loginWithGooglePopup,  // Function to sign in with Google (popup)
    loginWithGoogleRedirect, // Function to sign in with Google (redirect)
    logout,           // Function to log out
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}