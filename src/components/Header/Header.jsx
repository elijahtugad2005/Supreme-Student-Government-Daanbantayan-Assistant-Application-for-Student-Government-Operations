import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { Clock, MapPin } from 'lucide-react';
import styles from './Header.module.css';

function Header({ sidebarOpen, toggleSidebar }) {
  const [isShrunk, setIsShrunk] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [time, setTime] = useState(new Date());
  const { theme } = useTheme();
  const isClassicMaroon = theme === 'dark';

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY && currentScrollY > 40) {
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
      className={`${styles.header} ${isShrunk ? styles.shrink : ''} ${!sidebarOpen ? styles.headerSidebarClosed : ''} ${isClassicMaroon ? styles.headerMaroon : ''}`}
    >
      {/* Left Area: Hamburger Navigation */}
      <div className={styles.leftSection}>
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
      </div>

      {/* Centre: Preserved Font Institutional Title Block */}
      <div className={styles.titleBlock}>
        <div className={styles.eyebrowWrapper}>
          <span className={styles.eyebrowDot} />
          <p className={styles.eyebrow}>Official Student Government Platform</p>
        </div>
        <h1 className={styles.ssgtitle}>Supreme Student Government</h1>
        <p className={styles.subtitle}>Cebu Technological University — Daanbantayan Campus</p>
      </div>

      {/* Right Area: Telemetry Clock & Campus Meta */}
      <div className={styles.rightSection}>
        <div className={styles.clockCard}>
          <Clock size={13} className={styles.clockIcon} />
          <span className={styles.clockTime}>
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

        <div className={styles.campusCard}>
          <div className={styles.campusTop}>
            <MapPin size={12} className={styles.pinIcon} />
            <span className={styles.campusName}>CTU Daanbantayan</span>
          </div>
          <span className={styles.campusLocation}>Agujo, Daanbantayan, Cebu</span>
        </div>
      </div>
    </header>
  );
}

export default Header;
