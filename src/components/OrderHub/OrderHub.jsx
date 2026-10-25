import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import Order from '../Order/order.jsx';
import TrackOrder from '../TrackOrder/TrackOrder.jsx';
import { ShoppingCart, Search, Sparkles } from 'lucide-react';
import styles from './OrderHub.module.css';

/**
 * @component OrderHub
 * @description Unified Order experience combining Order Placement and Order Tracking.
 * Provides a responsive switcher button bar and deep-linking support via query param or route state.
 */
function OrderHub() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isClassic = theme === 'dark';

  // Determine initial active mode:
  // - from query string (?mode=track or ?mode=place)
  // - from router location.state (mode: 'track' or 'place' or presence of orderId)
  // - if pathname was /track-order default to 'track'
  const getInitialMode = () => {
    const params = new URLSearchParams(location.search);
    const modeParam = params.get('mode');
    if (modeParam === 'track' || modeParam === 'place') {
      return modeParam;
    }
    if (location.state?.mode === 'track' || location.state?.orderId || location.pathname.includes('track-order')) {
      return 'track';
    }
    return 'place';
  };

  const [activeMode, setActiveMode] = useState(getInitialMode);

  // Sync mode whenever location or state changes (e.g. from Order success or external navigation)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const modeParam = params.get('mode');
    if (modeParam === 'track' || modeParam === 'place') {
      setActiveMode(modeParam);
    } else if (location.state?.mode === 'track' || location.state?.orderId || location.pathname.includes('track-order')) {
      setActiveMode('track');
    }
  }, [location.search, location.state, location.pathname]);

  const handleModeSwitch = (mode) => {
    setActiveMode(mode);
    // Update URL query param cleanly without full page reload
    const currentParams = new URLSearchParams(location.search);
    currentParams.set('mode', mode);
    navigate({
      pathname: '/order',
      search: currentParams.toString()
    }, { replace: true, state: location.state });
  };

  return (
    <div className={`${styles.orderHubContainer} ${isClassic ? styles.orderHubClassic : ''}`}>
      {/* Ethnic Tribal Gold Border (Classic Theme Only) */}
      {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}

      {/* Switcher Navigation Bar */}
      <div className={styles.switcherToolbar}>
        <div className={styles.brandBadge}>
          <Sparkles size={14} className={styles.badgeIcon} />
          <span>SSG Official Orders</span>
        </div>

        <div className={styles.segmentedControl} role="tablist" aria-label="Order Mode Switcher">
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === 'place'}
            className={`${styles.segmentButton} ${activeMode === 'place' ? styles.segmentActive : ''}`}
            onClick={() => handleModeSwitch('place')}
          >
            <ShoppingCart size={17} className={styles.buttonIcon} />
            <span className={styles.buttonLabel}>Place Order</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeMode === 'track'}
            className={`${styles.segmentButton} ${activeMode === 'track' ? styles.segmentActive : ''}`}
            onClick={() => handleModeSwitch('track')}
          >
            <Search size={17} className={styles.buttonIcon} />
            <span className={styles.buttonLabel}>Track Order</span>
          </button>
        </div>
      </div>

      {/* Pane Content */}
      <div className={styles.hubContentPane}>
        {activeMode === 'place' ? (
          <div key="place-pane" className={styles.paneFade}>
            <Order />
          </div>
        ) : (
          <div key="track-pane" className={styles.paneFade}>
            <TrackOrder />
          </div>
        )}
      </div>
    </div>
  );
}

export default OrderHub;
