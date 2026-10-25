
import { useState } from 'react';
import styles from './admin.module.css';
import { useTheme } from '../contexts/ThemeContext';
import MemberDashboard from '../components/MemberDashboard';
import ProductManagement from '../components/ProductManagement/ProductManagement';
import Data from '../components/Data/OrderManagement.jsx';
import UserManagement from '../components/UserManagement/UserManagement.jsx';
import { HiCube, HiShoppingCart, HiUsers, HiShieldCheck } from 'react-icons/hi';

function Admin() {
    const [activeTab, setActiveTab] = useState('products');
    const { theme } = useTheme();
    const isClassic = theme === 'dark';

    return (
        <div className={`${styles.container} ${isClassic ? styles.adminClassic : ''}`}>
            {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}
            {/* Page Title */}
            <header className={styles.pagetitle}>
                <div className={styles.titleInfo}>
                    {isClassic && (
                        <div className={styles.eyebrowRow}>
                            <span className={styles.eyebrowDot}></span>
                            <span className={styles.eyebrowText}>SSG EXECUTIVE ADMINISTRATION</span>
                        </div>
                    )}
                    <h1>Admin Dashboard</h1>
                    <h2>Welcome back, Administrator</h2>
                </div>
            </header>

            {/* Tab Navigation */}
            <div className={styles.tabNavigation}>
                <button
                    className={`${styles.tabButton} ${activeTab === 'products' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('products')}
                >
                    <span className={styles.tabIcon}><HiCube /></span>
                    <span className={styles.tabLabel}>Product Management</span>
                </button>
                <button
                    className={`${styles.tabButton} ${activeTab === 'orders' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('orders')}
                >
                    <span className={styles.tabIcon}><HiShoppingCart /></span>
                    <span className={styles.tabLabel}>Order Management</span>
                </button>
                <button
                    className={`${styles.tabButton} ${activeTab === 'members' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('members')}
                >
                    <span className={styles.tabIcon}><HiUsers /></span>
                    <span className={styles.tabLabel}>Member Management</span>
                </button>
                
                <button
                    className={`${styles.tabButton} ${activeTab === 'users' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('users')}
                >
                    <span className={styles.tabIcon}><HiShieldCheck /></span>
                    <span className={styles.tabLabel}>User Management</span>
                </button>
            </div>

            {/* Tab Content */}
            <div className={styles.tabContent}>
                {activeTab === 'products' && (
                    <div className={styles.dashboard_card}>
                        <ProductManagement />
                    </div>
                )}

                {activeTab === 'orders' && (
                    <div className={styles.dashboard_card}>
                        <Data />
                    </div>
                )}

                {activeTab === 'members' && (
                    <div className={styles.dashboard_card}>
                        <MemberDashboard />
                    </div>
                )}
                
                {activeTab === 'users' && (
                    <div className={styles.dashboard_card}>
                        <UserManagement />
                    </div>
                )}
            </div>
        </div>
    );
}

export default Admin;