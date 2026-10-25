import React, { useState, useCallback, useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import { useTheme } from '../../contexts/ThemeContext';
import usePermissions from '../../hooks/usePermissions.js';
import styles from './Sidebar.module.css';
// Professional icon imports from react-icons
import {
  HiHome,
  HiShoppingCart,
  HiChartBar,
  HiCurrencyDollar,
  HiDocumentText,
  HiCube,
  HiSpeakerphone,
  HiFolder,
  HiLogout,
  HiLogin,
  HiSearch,
  HiShoppingBag,
  HiCog,
  HiMoon,
  HiSun,
  HiX,
  HiLocationMarker
} from 'react-icons/hi';

const THEMES = [
  {
    id: 'dark',
    name: 'Classic Mode',
    description: 'Original maroon editorial theme',
    icon: HiMoon,
    preview: 'linear-gradient(135deg, #2D0A0A 0%, #D94F1F 100%)'
  },
  {
    id: 'light',
    name: 'Light Mode',
    description: 'Clean white theme',
    icon: HiSun,
    preview: 'linear-gradient(135deg, #FFFFFF 0%, #3B82F6 100%)'
  },
  {
    id: 'corporate',
    name: 'Formal Corporate Theme',
    description: 'Blue modern minimalist',
    icon: HiCog,
    preview: 'linear-gradient(135deg, #060b18 0%, #2563eb 100%)'
  }
];

const ALL_SECRETARY_ROLES = ['secretary', 'executive_secretary', 'press_secretary', 'linkages_secretary', 'deputy_secretary'];
const ALL_FINANCE_ROLES = ['finance_secretary', 'auditor', 'budget_officer'];
const ALL_EXECUTIVE_ROLES = ['admin', 'president', 'vice_president'];
const ALL_LEGISLATIVE_ROLES = ['senator', 'representative'];

const NAV_ITEMS = [
  { to: "/", text: "Home", icon: HiHome, roles: ['public', ...ALL_EXECUTIVE_ROLES, ...ALL_SECRETARY_ROLES, ...ALL_FINANCE_ROLES, ...ALL_LEGISLATIVE_ROLES, 'creatives', 'governor', 'member', 'guest'] },

  // Order Placement & Tracking (Open to all students, members, guests, and officers)
  { to: "/order", text: "Order", icon: HiShoppingCart, roles: ['public', ...ALL_EXECUTIVE_ROLES, ...ALL_SECRETARY_ROLES, ...ALL_FINANCE_ROLES, ...ALL_LEGISLATIVE_ROLES, 'creatives', 'governor', 'member', 'guest'], publicAccess: true },
  { to: "/commerce", text: "Commerce Hub", icon: HiShoppingBag, roles: ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', ...ALL_FINANCE_ROLES, ...ALL_LEGISLATIVE_ROLES], permissions: ['canManageOrders'] },

  // Admin Section — President has full general access; VP & Finance have Audit Trail
  { to: "/admin", text: "Admin Dashboard", icon: HiChartBar, roles: ['admin', 'president'], permissions: ['canManageUsers'] },
  { to: "/admin/users", text: "User Management", icon: HiCog, roles: ['admin', 'president'], permissions: ['canManageUsers'] },
  { to: "/admin/audit", text: "Audit Trail", icon: HiDocumentText, roles: ['admin', 'president', 'vice_president', ...ALL_FINANCE_ROLES], permissions: ['canManageUsers', 'canViewFinance'] },

  // Finance & Analytics — President, VP, Finance Secretary, Auditor, Budget Officer have Higher Access; Secretary can view
  { to: "/finance", text: "Finance", icon: HiCurrencyDollar, roles: ['admin', 'president', 'vice_president', 'secretary', 'executive_secretary', ...ALL_FINANCE_ROLES], permissions: ['canViewFinance'] },

  // Sections & Contributions (Combined Class Roster & Death Aid) — Mayors submit without signing up, so 'public' is included
  { to: "/sections-contributions", text: "Sections & Contributions", icon: HiDocumentText, roles: ['public', ...ALL_EXECUTIVE_ROLES, ...ALL_SECRETARY_ROLES, ...ALL_FINANCE_ROLES, ...ALL_LEGISLATIVE_ROLES, 'governor', 'member', 'guest'], permissions: ['canSubmitRoster'], publicAccess: true },

  // Inventory & Products — President, VP, Secretaries, Finance/Audit, Senators, Representatives
  { to: "/inventory", text: "Inventory", icon: HiCube, roles: ['admin', 'president', 'vice_president', ...ALL_SECRETARY_ROLES, ...ALL_FINANCE_ROLES, ...ALL_LEGISLATIVE_ROLES], permissions: ['canManageProducts'] },

  // Announcements & Documents — Creatives has Announcements; Legislative has Announcements & Documents
  { to: "/announcement", text: "Announcements", icon: HiSpeakerphone, roles: ['admin', 'president', 'vice_president', ...ALL_SECRETARY_ROLES, ...ALL_LEGISLATIVE_ROLES, 'creatives'], permissions: ['canSendNotifications'] },
  { to: "/documents", text: "Documents", icon: HiFolder, roles: ['admin', 'president', 'vice_president', ...ALL_SECRETARY_ROLES, ...ALL_FINANCE_ROLES, ...ALL_LEGISLATIVE_ROLES], permissions: ['canExportData'] },

  // Campus Interactive 2D Eagle-Eye Sky Map — Open to all
  { to: "/campus-map", text: "Campus Map (Experimental)", icon: HiLocationMarker, roles: ['public', ...ALL_EXECUTIVE_ROLES, ...ALL_SECRETARY_ROLES, ...ALL_FINANCE_ROLES, ...ALL_LEGISLATIVE_ROLES, 'creatives', 'governor', 'member', 'guest'], publicAccess: true }
];

function Sidebar({ isOpen, toggleSidebar }) {
  const { currentUser, userRole, logout, loading, userName } = useAuth();
  const { theme, changeTheme } = useTheme();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [showThemeModal, setShowThemeModal] = useState(false);

  const isClassic = theme === 'dark';
  const role = currentUser ? (userRole || 'public') : 'public';
  const name = currentUser ? (userName || 'user ') : 'name';

  const closeSidebar = useCallback(() => {
    if (window.innerWidth <= 768) {
      toggleSidebar();
    }
  }, [toggleSidebar]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
      navigate('/login');
      if (window.innerWidth <= 768) {
        toggleSidebar();
      }
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }, [logout, navigate, toggleSidebar]);

  const handleThemeChange = useCallback((newTheme) => {
    changeTheme(newTheme);
    setShowThemeModal(false);
  }, [changeTheme]);

  // Memoize active visible nav items so we do not re-filter on every render
  const visibleNavItems = useMemo(() => {
    return permissions.filterNavigation(NAV_ITEMS).filter((item) => {
      const hasRequiredPermissions = item.publicAccess
        ? true
        : (item.permissions ? permissions.checkAnyPermission(item.permissions) : true);
      const hasRequiredRole = item.roles.includes(role);
      return hasRequiredRole && hasRequiredPermissions;
    });
  }, [permissions, role]);

  if (loading) {
    return null;
  }

  return (
    <>
      {/* Overlay when sidebar is open */}
      {isOpen && (
        <div
          className={styles.overlay}
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      <nav className={`${styles.container} ${isOpen ? styles.open : styles.closed} ${isClassic ? styles.sidebarClassic : ''}`}>
        {/* Ethnic Tribal Gold Accent Band (Top) */}
        {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}

        <div className={styles.listContainer}>
          {/* Sidebar header */}
          <div className={styles.sidebarHeader}>
            <div className={styles.logoSection}>
              {isOpen && <h2 className={styles.logoText}>Supremo Gobyerno</h2>}
            </div>

            {isOpen && (
              <div className={styles.userInfo}>
                <div className={styles.userAvatar}>
                  {String(name).charAt(0).toUpperCase()}
                </div>
                <div className={styles.userDetails}>
                  <p className={styles.userName}>{currentUser ? String(name).charAt(0).toUpperCase() + String(name).slice(1) : 'Guest'}</p>
                  <span className={styles.userRole}>{String(role).toUpperCase()}</span>
                </div>
              </div>
            )}
          </div>

          <ul className={styles.navList}>
            {visibleNavItems.map((item) => {
              const IconComponent = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
                    }
                    onClick={() => {
                      if (isOpen) toggleSidebar();
                    }}
                    title={!isOpen ? item.text : ''}
                  >
                    <IconComponent className={styles.navIcon} />
                    {isOpen && <span className={styles.linkText}>{item.text}</span>}
                  </NavLink>
                </li>
              );
            })}
          </ul>

          <div className={styles.buttonSection}>
            {/* Theme Settings Button */}
            <button
              className={styles.settingsButton}
              onClick={() => setShowThemeModal(true)}
              title={!isOpen ? 'Theme Settings' : ''}
            >
              <HiCog className={styles.navIcon} />
              {isOpen && <span>Theme Settings</span>}
            </button>

            {currentUser ? (
              <button
                className={styles.logoutButton}
                onClick={handleLogout}
                title={!isOpen ? 'Logout' : ''}
              >
                <HiLogout className={styles.navIcon} />
                {isOpen && <span>Logout</span>}
              </button>
            ) : (
              <NavLink
                to="/login"
                className={styles.loginButton}
                onClick={() => { if (isOpen) toggleSidebar(); }}
                title={!isOpen ? 'Login' : ''}
              >
                <HiLogin className={styles.navIcon} />
                {isOpen && <span>Login</span>}
              </NavLink>
            )}
          </div>
        </div>

        {/* Ethnic Tribal Gold Accent Band (Bottom) */}
        {isClassic && <div className={styles.tribalBorderBottom} aria-hidden="true" />}
      </nav>

      {/* Theme Settings Modal */}
      {showThemeModal && (
        <div className={styles.themeModalOverlay} onClick={() => setShowThemeModal(false)}>
          <div className={`${styles.themeModal} ${isClassic ? styles.themeModalClassic : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.themeModalHeader}>
              <h2 className={styles.themeModalTitle}>Choose Theme</h2>
              <button
                className={styles.themeModalClose}
                onClick={() => setShowThemeModal(false)}
                aria-label="Close"
              >
                <HiX />
              </button>
            </div>

            <div className={styles.themeModalBody}>
              {THEMES.map((themeOption) => {
                const IconComponent = themeOption.icon;
                return (
                  <button
                    key={themeOption.id}
                    className={`${styles.themeOption} ${theme === themeOption.id ? styles.themeOptionActive : ''}`}
                    onClick={() => handleThemeChange(themeOption.id)}
                  >
                    <div
                      className={styles.themePreview}
                      style={{ background: themeOption.preview }}
                    >
                      <IconComponent className={styles.themePreviewIcon} />
                    </div>
                    <div className={styles.themeOptionContent}>
                      <h3 className={styles.themeOptionName}>{themeOption.name}</h3>
                      <p className={styles.themeOptionDesc}>{themeOption.description}</p>
                    </div>
                    {theme === themeOption.id && (
                      <div className={styles.themeOptionCheck}>✓</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default React.memo(Sidebar);