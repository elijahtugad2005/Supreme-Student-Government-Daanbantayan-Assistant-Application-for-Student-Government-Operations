// components/Login/GoogleSignInButton.jsx
// PURPOSE: Google Sign-In button component with consistent styling
// FEATURES:
//   - Google branding and styling
//   - Loading states
//   - Error handling
//   - Responsive design

import React, { useState } from 'react';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import { useNavigate } from 'react-router-dom';
import styles from './Login.module.css';

const GOOGLE_AUTH_ERROR_MESSAGES = {
  'auth/popup-closed-by-user': 'Sign-in popup was closed. Please try again.',
  'auth/cancelled-popup-request': 'Previous sign-in popup was superseded. Please try again.',
  'auth/popup-blocked':
    'Pop-up was blocked by your browser. Allow pop-ups or use Redirect Sign-In below.',
  'auth/unauthorized-domain':
    'This domain is not listed under Firebase Authentication Authorized Domains.',
  'auth/configuration-not-found':
    'Google Sign-In is not configured in Firebase Authentication.',
  'auth/operation-not-allowed':
    'Google Sign-In provider is disabled in Firebase Console.',
  'auth/web-storage-unsupported':
    'Browser blocked third-party storage required for Google pop-up sign-in. Disable strict tracking/cookie shields or try Redirect Sign-In below.',
  'auth/internal-error':
    'Google Auth failed internally (auth/internal-error). Commonly caused by strict browser tracker/cookie shields blocking third-party storage or apis.google.com, or mismatched VITE_FIREBASE_AUTH_DOMAIN / OAuth settings.',
};

const REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/internal-error',
  'auth/web-storage-unsupported',
]);

function GoogleSignInButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [offerRedirect, setOfferRedirect] = useState(false);

  const { loginWithGooglePopup, loginWithGoogleRedirect } = useAuth();
  const navigate = useNavigate();

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setError('');
      setOfferRedirect(false);

      await loginWithGooglePopup();

      // Redirect to home/dashboard after successful login
      navigate('/');
    } catch (err) {
      console.error('Google Sign-In error:', err);
      const mapped = GOOGLE_AUTH_ERROR_MESSAGES[err.code];
      setError(mapped || `Google Sign-In failed: ${err.message}`);
      setOfferRedirect(REDIRECT_FALLBACK_CODES.has(err.code));
    } finally {
      setLoading(false);
    }
  };

  const handleRedirectSignIn = async () => {
    try {
      setLoading(true);
      setError('');
      await loginWithGoogleRedirect();
    } catch (err) {
      console.error('Google Redirect Sign-In error:', err);
      const mapped = GOOGLE_AUTH_ERROR_MESSAGES[err.code];
      setError(mapped || `Google Redirect Sign-In failed: ${err.message}`);
      setLoading(false);
    }
  };

  return (
    <div className={styles.googleSignInContainer}>
      {error && (
        <div className={styles.googleErrorBox}>
          <div>⚠️ {error}</div>
          {offerRedirect && (
            <button
              type="button"
              onClick={handleRedirectSignIn}
              disabled={loading}
              style={{
                marginTop: '0.6rem',
                background: 'rgba(212, 175, 55, 0.16)',
                color: '#ffea9f',
                border: '1px solid rgba(212, 175, 55, 0.5)',
                borderRadius: '6px',
                padding: '0.4rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try Redirect Sign-In instead
            </button>
          )}
        </div>
      )}
      
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={loading}
        className={styles.googleSignInButton}
        aria-label="Sign in with Google"
      >
        {loading ? (
          <span className={styles.googleButtonContent}>
            <span className={styles.googleSpinner}></span>
            Signing in with Google...
          </span>
        ) : (
          <span className={styles.googleButtonContent}>
            <svg className={styles.googleIcon} viewBox="0 0 24 24">
              <path 
                fill="#4285F4" 
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path 
                fill="#34A853" 
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path 
                fill="#FBBC05" 
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path 
                fill="#EA4335" 
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span>Continue with Google</span>
          </span>
        )}
      </button>

      <div className={styles.googleDivider}>
        <span className={styles.dividerText}>or</span>
      </div>
      
      <p className={styles.googleHelpText}>
        By signing in with Google, you agree to our Terms of Service and Privacy Policy.
        New Google users will be assigned "member" role by default.
      </p>
    </div>
  );
}

export default GoogleSignInButton;