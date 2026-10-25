// components/Login/Login.jsx
// PURPOSE: Official Student Government Authentication Portal
// AESTHETICS: Classic Royal Maroon & Imperial Gold with Traditional Ethnic Border Art

import React, { useState } from 'react';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  HiLockClosed, 
  HiMail, 
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

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Get the page user tried to access before being redirected to login
  const from = location.state?.from?.pathname || '/';

  // ========================================
  // HANDLE LOGIN SUBMISSION
  // ========================================
  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      setError('');
      setLoading(true);
      
      await login(email, password);
      
      // Success! Redirect to target page
      navigate(from, { replace: true });
      
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        setError('No account found with this email address.');
      } else if (error.code === 'auth/wrong-password') {
        setError('Incorrect password. Please verify your credentials.');
      } else if (error.code === 'auth/invalid-email') {
        setError('Invalid email address format.');
      } else if (error.code === 'auth/too-many-requests') {
        setError('Too many failed login attempts. Please wait a moment.');
      } else {
        setError('Authentication failed: ' + (error.message || 'Please check your connection.'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      {/* Top & Bottom Page-Level Ethnic Tribal Border Bands */}
      <div className={styles.tribalBorderTop} aria-hidden="true" />
      <div className={styles.tribalBorderBottom} aria-hidden="true" />

      {/* Atmospheric ambient radiant glow */}
      <div className={styles.ambientGlow} aria-hidden="true" />

      {/* Main Login Card */}
      <div className={styles.loginCard}>
        {/* Card Top Tribal Accent Ribbon */}
        <div className={styles.cardTribalStripTop} aria-hidden="true" />

        {/* Four Authentic Ethnic Gold Inlaid Corner Brackets */}
        <EthnicCornerBracket className={`${styles.cornerBracket} ${styles.cornerTopLeft}`} />
        <EthnicCornerBracket className={`${styles.cornerBracket} ${styles.cornerTopRight}`} />
        <EthnicCornerBracket className={`${styles.cornerBracket} ${styles.cornerBottomLeft}`} />
        <EthnicCornerBracket className={`${styles.cornerBracket} ${styles.cornerBottomRight}`} />

        <div className={styles.cardInner}>
          {/* Institutional Header Block (Text Only) */}
          <div className={styles.headerBlock}>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrowDiamond}>◆</span>
              <span className={styles.eyebrowText}>OFFICIAL STUDENT GOVERNMENT PORTAL</span>
              <span className={styles.eyebrowDiamond}>◆</span>
            </div>

            <h1 className={styles.title}>LOGIN TO SSG APP</h1>
            <p className={styles.subtitle}>Cebu Technological University — Daanbantayan Campus</p>
            <div className={styles.ethnicDividerMini} aria-hidden="true">
              <span className={styles.dividerLine} />
              <span className={styles.dividerGlyph}>❖</span>
              <span className={styles.dividerLine} />
            </div>
          </div>

          {error && (
            <div className={styles.errorBox} role="alert">
              <span className={styles.errorIcon}>⚠️</span>
              <span className={styles.errorText}>{error}</span>
            </div>
          )}

          {/* Google Sign-In Option */}
          <GoogleSignInButton />

          {/* Traditional Email / Password Form */}
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="login-email">
                Institutional Email
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
                Password
              </label>
              <div className={styles.inputWrapper}>
                <HiLockClosed className={styles.inputIcon} aria-hidden="true" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your security credentials"
                  className={`${styles.input} ${styles.inputWithToggle}`}
                  required
                  autoComplete="current-password"
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

            <button 
              type="submit" 
              disabled={loading}
              className={styles.loginButton}
            >
              {loading ? (
                <span className={styles.btnContent}>
                  <span className={styles.btnSpinner} />
                  <span>Authenticating...</span>
                </span>
              ) : (
                <span className={styles.btnContent}>
                  <HiSparkles className={styles.btnIcon} />
                  <span>Sign In to SSG Portal</span>
                </span>
              )}
            </button>

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