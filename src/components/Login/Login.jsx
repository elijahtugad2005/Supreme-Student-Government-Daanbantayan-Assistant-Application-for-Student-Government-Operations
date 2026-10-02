// components/Login/Login.jsx
// PURPOSE: Login page for users to authenticate
// FEATURES:
//   - Email/password login form
//   - Error handling with user-friendly messages
//   - Redirects to previous page after login
//   - Shows loading state during authentication

import React, { useState } from 'react';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import { useNavigate, useLocation } from 'react-router-dom';
import styles from './Login.module.css';
import GoogleSignInButton from './GoogleSignInButton.jsx';

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
  // Authenticates user and redirects to intended page
  // ========================================
  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      setError('');
      setLoading(true);
      
      await login(email, password);
      
      // Success! Redirect to where they came from
      navigate(from, { replace: true });
      
    } catch (error) {
      // Handle specific error messages
      if (error.code === 'auth/user-not-found') {
        setError('No account found with this email');
      } else if (error.code === 'auth/wrong-password') {
        setError('Incorrect password');
      } else if (error.code === 'auth/invalid-email') {
        setError('Invalid email address');
      } else {
        setError('Failed to log in: ' + error.message);
      }
    }

    setLoading(false);
  };

  return (
    <div className={styles.container}>
      <div className={styles.loginCard}>
        <h1 className={styles.title}>Login to SSG APP</h1>
        <p className={styles.subtitle}>Student Government Management System</p>

        {error && (
          <div className={styles.errorBox}>
            ❌ {error}
          </div>
        )}
           
        {/* Google Sign-In Option */}
        <GoogleSignInButton />
        
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your.email@example.com"
              className={styles.input}
              required
            />
          </div>
              
          <div className={styles.formGroup}>
            <label className={styles.label}>Password</label>
            <div className={styles.passwordWrapper}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className={styles.input}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={styles.togglePasswordButton}
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className={styles.loginButton}
          >
            {loading ? 'Logging in...' : ' Login'}
          </button>

         <button 
            type="button"
            onClick={() => navigate('/')}
            className={styles.homeButton}
            disabled={loading}
            >
            Go Home
            </button>
          
        </form>

        <p className={styles.helpText}>
          Don't have an account? Contact your administrator.
        </p>
      </div>
    </div>
  );
}

export default Login;