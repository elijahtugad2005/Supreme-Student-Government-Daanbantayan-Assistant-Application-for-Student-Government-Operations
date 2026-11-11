// components/Login/Login.jsx
// PURPOSE: Official Student Government Authentication & Registration Portal
// AESTHETICS: Classic Royal Maroon & Imperial Gold with Traditional Ethnic Border Art

import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  HiLockClosed, 
  HiMail, 
  HiUser,
  HiIdentification,
  HiEye, 
  HiEyeOff, 
  HiArrowLeft, 
  HiShieldCheck, 
  HiSparkles 
} from 'react-icons/hi';
import styles from './Login.module.css';
import GoogleSignInButton from './GoogleSignInButton.jsx';

/**
 * Traditional Ethnic Gold Corner Bracket SVG
 */
const EthnicCornerBracket = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M3 29V7C3 4.79086 4.79086 3 7 3H29"
      stroke="#d4af37"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <path
      d="M7 16V7H16"
      stroke="#e5b842"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <circle cx="7" cy="7" r="2.2" fill="#d4af37" />
    <polygon points="14,14 18,10 22,14 18,18" fill="#d4af37" opacity="0.85" />
  </svg>
);

function Login({ initialMode = 'login' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { login, signup } = useAuth();

  const [mode, setMode] = useState(
    location.pathname === '/register' ? 'register' : initialMode
  );
  const [fullName, setFullName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (location.pathname === '/register') {
      setMode('register');
    } else if (location.pathname === '/login' && initialMode === 'login') {
      setMode('login');
    }
  }, [location.pathname, initialMode]);

  // Get the page user tried to access before being redirected to login
  const from = location.state?.from?.pathname || '/';

  const switchMode = (targetMode) => {
    setError('');
    setMode(targetMode);
  };

  // ========================================
  // HANDLE LOGIN OR REGISTRATION SUBMISSION
  // ========================================
  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      setError('');

      if (mode === 'register') {
        if (!fullName.trim()) {
          setError('Full Name is required.');
          return;
        }
        if (!studentId.trim()) {
          setError('Student ID is required.');
          return;
        }
        if (!email.trim()) {
          setError('Email address is required.');
          return;
        }
        if (!password || password.length < 6) {
          setError('Password must be at least 6 characters long.');
          return;
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match. Please verify your Confirm Password.');
          return;
        }
        if (!agreedToTerms) {
          setError('You must agree to the Terms and Conditions before registering.');
          return;
        }

        setLoading(true);
        // Registered users automatically get the 'member' role
        await signup(email.trim(), password, fullName.trim(), 'member', {
          studentId: studentId.trim(),
          agreedToTerms: true,
          agreedToTermsAt: new Date().toISOString(),
        });

        navigate(from, { replace: true });
        return;
      }

      setLoading(true);
      await login(email.trim(), password);

      // Success! Redirect to target page
      navigate(from, { replace: true });
    } catch (error) {
      if (
        error.code === 'auth/invalid-credential' ||
        error.code === 'auth/invalid-login-credentials' ||
        error.code === 'auth/user-not-found' ||
        error.code === 'auth/wrong-password'
      ) {
        setError('Invalid email or password. Please check your credentials and try again.');
      } else if (error.code === 'auth/email-already-in-use') {
        setError('An account with this email already exists. Please sign in instead.');
      } else if (error.code === 'auth/weak-password') {
        setError('Password is too weak. Please use at least 6 characters.');
      } else if (error.code === 'auth/invalid-email') {
        setError('Invalid email address format.');
      } else if (error.code === 'auth/user-disabled') {
        setError('This account has been disabled. Please contact your administrator.');
      } else if (error.code === 'auth/too-many-requests') {
        setError('Too many failed login attempts. Please wait a moment.');
      } else {
        setError('Authentication failed: ' + (error.message || 'Please check your connection.'));
      }
    } finally {
      setLoading(false);
    }
  };

  const isRegister = mode === 'register';

  return (
    <div className={styles.container}>
      {/* Top & Bottom Page-Level Ethnic Tribal Border Bands */}
      <div className={styles.tribalBorderTop} aria-hidden="true" />
      <div className={styles.tribalBorderBottom} aria-hidden="true" />

      {/* Atmospheric ambient radiant glow */}
      <div className={styles.ambientGlow} aria-hidden="true" />

      {/* Main Login / Register Card */}
      <div className={styles.loginCard}>
        {/* Card Top Tribal Accent Ribbon */}
        <div className={styles.cardTribalStripTop} aria-hidden="true" />

        {/* Four Authentic Ethnic Gold Inlaid Corner Brackets */}
        <EthnicCornerBracket className={`${styles.cornerBracket} ${styles.cornerTopLeft}`} />
        <EthnicCornerBracket className={`${styles.cornerBracket} ${styles.cornerTopRight}`} />
        <EthnicCornerBracket className={`${styles.cornerBracket} ${styles.cornerBottomLeft}`} />
        <EthnicCornerBracket className={`${styles.cornerBracket} ${styles.cornerBottomRight}`} />

        <div className={styles.cardInner}>
          {/* Institutional Header Block */}
          <div className={styles.headerBlock}>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrowDiamond}>◆</span>
              <span className={styles.eyebrowText}>OFFICIAL STUDENT GOVERNMENT PORTAL</span>
              <span className={styles.eyebrowDiamond}>◆</span>
            </div>

            <h1 className={styles.title}>
              {isRegister ? 'REGISTER ACCOUNT' : 'LOGIN TO SSG APP'}
            </h1>
            <p className={styles.subtitle}>Cebu Technological University — Daanbantayan Campus</p>
            <div className={styles.ethnicDividerMini} aria-hidden="true">
              <span className={styles.dividerLine} />
              <span className={styles.dividerGlyph}>❖</span>
              <span className={styles.dividerLine} />
            </div>
          </div>

          {/* Mode Toggle Tabs: Sign In vs Register Account */}
          <div className={styles.modeTabs} role="tablist" aria-label="Authentication Mode">
            <button
              type="button"
              role="tab"
              aria-selected={!isRegister}
              disabled={loading}
              onClick={() => switchMode('login')}
              className={`${styles.modeTab} ${!isRegister ? styles.modeTabActive : ''}`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRegister}
              disabled={loading}
              onClick={() => switchMode('register')}
              className={`${styles.modeTab} ${isRegister ? styles.modeTabActive : ''}`}
            >
              Register Account
            </button>
          </div>

          {error && (
            <div className={styles.errorBox} role="alert">
              <span className={styles.errorIcon}>⚠️</span>
              <span className={styles.errorText}>{error}</span>
            </div>
          )}

          {/* Google Sign-In Option */}
          <GoogleSignInButton />

          {/* Email / Password Form (Login or Register) */}
          <form onSubmit={handleSubmit} className={styles.form}>
            {isRegister && (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="register-name">
                    Full Name *
                  </label>
                  <div className={styles.inputWrapper}>
                    <HiUser className={styles.inputIcon} aria-hidden="true" />
                    <input
                      id="register-name"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Juan Dela Cruz"
                      className={styles.input}
                      required
                      autoComplete="name"
                    />
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="register-student-id">
                    Student ID *
                  </label>
                  <div className={styles.inputWrapper}>
                    <HiIdentification className={styles.inputIcon} aria-hidden="true" />
                    <input
                      id="register-student-id"
                      type="text"
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      placeholder="e.g. 1334567"
                      className={styles.input}
                      required
                    />
                  </div>
                </div>
              </>
            )}

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="login-email">
                Institutional Email {isRegister ? '*' : ''}
              </label>
              <div className={styles.inputWrapper}>
                <HiMail className={styles.inputIcon} aria-hidden="true" />
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@ctu.edu.ph"
                  className={styles.input}
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="login-password">
                Password {isRegister ? '*' : ''}
              </label>
              <div className={styles.inputWrapper}>
                <HiLockClosed className={styles.inputIcon} aria-hidden="true" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isRegister ? "Create a password (min. 6 characters)" : "Enter your security credentials"}
                  className={`${styles.input} ${styles.inputWithToggle}`}
                  required
                  minLength={isRegister ? 6 : undefined}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={styles.togglePasswordButton}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <HiEyeOff size={18} /> : <HiEye size={18} />}
                </button>
              </div>
            </div>

            {isRegister && (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="register-confirm-password">
                    Confirm Password *
                  </label>
                  <div className={styles.inputWrapper}>
                    <HiLockClosed className={styles.inputIcon} aria-hidden="true" />
                    <input
                      id="register-confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter your password"
                      className={`${styles.input} ${styles.inputWithToggle}`}
                      required
                      minLength={6}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className={styles.togglePasswordButton}
                      aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                      title={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    >
                      {showConfirmPassword ? <HiEyeOff size={18} /> : <HiEye size={18} />}
                    </button>
                  </div>
                </div>

                <div className={styles.termsRow}>
                  <input
                    id="register-terms"
                    type="checkbox"
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    className={styles.termsCheckbox}
                    required
                  />
                  <label htmlFor="register-terms" className={styles.termsLabel}>
                    I agree to the <span className={styles.termsHighlight}>Terms and Conditions</span> and CTU-DB Supreme Student Government data privacy policies.
                    <br />
                    <span className={styles.roleBadgeHint}>
                      ✓ New accounts are automatically registered as a Student.
                    </span>
                  </label>
                </div>
              </>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className={styles.loginButton}
            >
              {loading ? (
                <span className={styles.btnContent}>
                  <span className={styles.btnSpinner} />
                  <span>{isRegister ? 'Creating Account...' : 'Authenticating...'}</span>
                </span>
              ) : (
                <span className={styles.btnContent}>
                  <HiSparkles className={styles.btnIcon} />
                  <span>{isRegister ? 'Register Student Account' : 'Sign In to SSG Portal'}</span>
                </span>
              )}
            </button>

            <div className={styles.switchModeFooter}>
              {isRegister ? (
                <>
                  <span>Already have an account?</span>
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className={styles.switchModeLink}
                  >
                    Sign In
                  </button>
                </>
              ) : (
                <>
                  <span>Don&apos;t have an account yet?</span>
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className={styles.switchModeLink}
                  >
                    Register Account
                  </button>
                </>
              )}
            </div>

            <button 
              type="button"
              onClick={() => navigate('/')}
              className={styles.homeButton}
              disabled={loading}
            >
              <HiArrowLeft size={16} />
              <span>Return to Campus Home</span>
            </button>
          </form>

          {/* Card Footer Security & Admin Notice */}
          <div className={styles.footerNote}>
            <HiShieldCheck className={styles.shieldIcon} />
            <span>Authorized Student Government & Collegiate Access Portal</span>
          </div>
        </div>

        {/* Card Bottom Tribal Accent Ribbon */}
        <div className={styles.cardTribalStripBottom} aria-hidden="true" />
      </div>
    </div>
  );
}

export default Login;
