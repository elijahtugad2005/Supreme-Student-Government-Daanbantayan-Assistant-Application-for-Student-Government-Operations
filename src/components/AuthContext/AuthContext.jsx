// context/AuthContext.jsx
// PURPOSE: Manages user authentication state across the entire app
// FUNCTIONS:
//   - Tracks if user is logged in
//   - Stores user data (email, role, name)
//   - Provides login/logout/signup functions to all components

import React, { createContext, useState, useEffect, useContext } from 'react';
import { auth, db, googleProvider } from "../../firebase/firebaseConfig.js";
// Statically imported: this module is also imported by many others, so the
// dynamic import only produced a mixed-import warning without saving anything.
import { getDefaultPermissionsForRole } from '../../utils/permissions.js';
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

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

  // ========================================
  // SIGNUP FUNCTION
  // Creates new user account with comprehensive schema and permissions
  // ========================================
  const signup = async (email, password, name, role = 'guest', additionalData = {}) => {
    try {
      // Create Firebase Auth account
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      // Get default permissions for the role
      const defaultPermissions = getDefaultPermissionsForRole(role);
      
      // Create comprehensive user document
      const userData = {
        uid: user.uid,
        email: user.email,
        name: name,
        photoURL: null,
        
        // Role and permissions
        role: role,
        permissions: defaultPermissions,
        
        // Authentication information
        provider: 'email',
        isEmailVerified: false,
        isActive: true,
        
        // Timestamps
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        
        // Additional information
        department: additionalData.department || '',
        phone: additionalData.phone || '',
        address: additionalData.address || '',
        notes: additionalData.notes || '',
        
        // Merge any additional data
        ...additionalData
      };
      
      // Store user data in Firestore
      await setDoc(doc(db, 'users', user.uid), userData);
      
      // Set local state
      setUserRole(role);
      setUserName(name);
      
      return userCredential;
    } catch (error) {
      console.error('Signup error:', error);
      throw error;
    }
  };

  // ========================================
  // LOGIN FUNCTION
  // Authenticates user and fetches their role from Firestore
  // ========================================
  const login = async (email, password) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // Fetch user data from Firestore
      const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        setUserRole(userData.role);
        setUserName(userData.name || null);
        setUserPermissions(userData.permissions || {});
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
  
  // Sign in with Google using popup (recommended for web)
  const loginWithGooglePopup = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      // Check if user exists in Firestore
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      
      if (!userDoc.exists()) {
        // Get default permissions for member role (default for Google users)
        const defaultPermissions = getDefaultPermissionsForRole('member');
        
        // First-time Google sign-in, create comprehensive user record
        const userData = {
          uid: user.uid,
          email: user.email,
          name: user.displayName || 'Google User',
          photoURL: user.photoURL,
          
          // Role and permissions
          role: 'member', // Default role for new Google users
          permissions: defaultPermissions,
          
          // Authentication information
          provider: 'google',
          isEmailVerified: user.emailVerified,
          isActive: true,
          
          // Timestamps
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          
          // Additional information
          department: '',
          phone: '',
          address: '',
          notes: 'Created via Google Sign-In',
        };
        
        await setDoc(doc(db, 'users', user.uid), userData);
        
        // Set local state
        setUserRole('member');
        setUserName(user.displayName || 'Google User');
      } else {
        // Existing user, fetch their data and update last login
        const userData = userDoc.data();
        
        // Update last login timestamp
        await setDoc(doc(db, 'users', user.uid), {
          lastLoginAt: new Date().toISOString()
        }, { merge: true });
        
        setUserRole(userData.role);
        setUserName(userData.name || user.displayName || 'Google User');
      }
      
      return result;
    } catch (error) {
      console.error('Google sign-in error:', error);
      throw error;
    }
  };

  // Sign in with Google using redirect (for mobile or popup-blocked environments)
  const loginWithGoogleRedirect = () => {
    return signInWithRedirect(auth, googleProvider);
  };

  // Handle redirect result (for redirect sign-in)
  const handleRedirectResult = async () => {
    try {
      const result = await getRedirectResult(auth);
      if (result) {
        const user = result.user;
        
        // Check if user exists in Firestore
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        
        if (!userDoc.exists()) {
          // Get default permissions for member role
          const defaultPermissions = getDefaultPermissionsForRole('member');
          
          // First-time Google sign-in, create comprehensive user record
          const userData = {
            uid: user.uid,
            email: user.email,
            name: user.displayName || 'Google User',
            photoURL: user.photoURL,
            
            // Role and permissions
            role: 'member', // Default role for new Google users
            permissions: defaultPermissions,
            
            // Authentication information
            provider: 'google',
            isEmailVerified: user.emailVerified,
            isActive: true,
            
            // Timestamps
            createdAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
            
            // Additional information
            department: '',
            phone: '',
            address: '',
            notes: 'Created via Google Sign-In (Redirect)',
          };
          
          await setDoc(doc(db, 'users', user.uid), userData);
          
          setUserRole('member');
          setUserName(user.displayName || 'Google User');
        }
      }
    } catch (error) {
      console.error('Redirect result error:', error);
    }
  };

  // ========================================
  // LOGOUT FUNCTION
  // Signs out user and clears auth state
  // ========================================
  const logout = () => {
    // Clear all auth state before signing out
    setUserRole(null);
    setUserName(null);
    setUserPermissions({});
    setUserPermissionOverrides({});
    return signOut(auth);
  };

  // ========================================
  // AUTH STATE LISTENER
  // Runs on app load and whenever auth state changes
  // Automatically fetches user data from Firestore
  // ========================================
  useEffect(() => {
    // Check for redirect result on initial load
    handleRedirectResult();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('Auth state changed - User:', user);
      setCurrentUser(user);
      
      if (user) {
        // User is logged in, fetch their data
        try {
          console.log('Fetching user data for UID:', user.uid);
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          console.log('User document exists:', userDoc.exists());
          
          if (userDoc.exists()) {
            const userData = userDoc.data();
            console.log('User data:', userData);
            console.log('User role:', userData.role);
            console.log('User name:', userData.name);
            
            setUserRole(userData.role);
            setUserName(userData.name || user.displayName || null); // Set name or null if not present
            // Access data is read from the Firestore profile, not the Auth
            // object â€” Firebase Auth users carry no role or permission fields.
            // Without these, per-user permission overrides from User Management
            // would never reach the app.
            setUserPermissions(userData.permissions || {});
            setUserPermissionOverrides(userData.permissionOverrides || {});
          } else {
            console.log('No user document found for UID:', user.uid);
            setUserRole(null);
            setUserName(null);
            setUserPermissions({});
            setUserPermissionOverrides({});
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
          setUserRole(null);
          setUserName(null);
          setUserPermissions({});
          setUserPermissionOverrides({});
        }
      } else {
        // User is logged out
        console.log('No user logged in');
        setUserRole(null);
        setUserName(null);
        setUserPermissions({});
        setUserPermissionOverrides({});
      }
      
      setLoading(false);
    });

    // Cleanup listener on unmount
    return unsubscribe;
  }, []);

  // Values accessible to all components via useAuth()
  const value = {
    currentUser,      // Firebase user object
    userRole,         // 'admin', 'secretary', 'representative', or 'member'
    userName,         // User's display name from Firestore
    userPermissions,  // Role defaults snapshot from Firestore
    userPermissionOverrides, // Per-user grants/revocations set by an Admin
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