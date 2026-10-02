import { useState, useEffect } from 'react';
import styles from './Header.module.css';

function Header({ sidebarOpen, toggleSidebar }) {
  const [isShrunk, setIsShrunk] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY && currentScrollY > 50) {
        setIsShrunk(true);
      } else if (currentScrollY < lastScrollY) {
        setIsShrunk(false);
      }
      setLastScrollY(currentScrollY);
    };

    let ticking = false;
    const throttledHandleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', throttledHandleScroll, { passive: true });
    return () => window.removeEventListener('scroll', throttledHandleScroll);
  }, [lastScrollY]);

  return (
    <header
      className={`${styles.header} ${isShrunk ? styles.shrink : ''} ${!sidebarOpen ? styles.headerSidebarClosed : ''}`}
    >
      {/* Hamburger — left side, always visible */}
      {toggleSidebar && (
        <button
          className={styles.hamburger}
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
          title={sidebarOpen ? 'Close navigation' : 'Open navigation'}
        >
          <span className={`${styles.hamburgerBar} ${sidebarOpen ? styles.barTop : ''}`} />
          <span className={`${styles.hamburgerBar} ${sidebarOpen ? styles.barMid : ''}`} />
          <span className={`${styles.hamburgerBar} ${sidebarOpen ? styles.barBot : ''}`} />
        </button>
      )}

      {/* Centre — editorial title block */}
      <div className={styles.titleBlock}>
        <p className={styles.eyebrow}>Official Student Government Platform</p>
        <h1 className={styles.ssgtitle}>Supreme Student Government</h1>
        <p className={styles.subtitle}>Cebu Technological University — Daanbantayan Campus</p>
      </div>

      {/* Right — campus detail & clock */}
      <div className={styles.rightSection}>
        <div className={styles.clock}>
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
        <div className={styles.campusDetail}>
          <span className={styles.campusName}>CTU Daanbantayan</span>
          <span className={styles.campusLocation}>Agujo, Daanbantayan, Cebu</span>
        </div>
      </div>
    </header>
  );
}

export default Header;
