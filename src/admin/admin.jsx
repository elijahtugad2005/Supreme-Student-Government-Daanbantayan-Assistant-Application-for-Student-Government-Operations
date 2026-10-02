
import { useState } from 'react';
import styles from './admin.module.css';
import MemberDashboard from '../components/MemberDashboard';
import ProductManagement from '../components/ProductManagement/ProductManagement';
import Data from '../components/Data/OrderManagement.jsx';
import UserManagement from '../components/UserManagement/UserManagement.jsx';

function Admin() {
    const [activeTab, setActiveTab] = useState('products');

    return (
        <div className={styles.container}>
            {/* Page Title */}
            <header className={styles.pagetitle}>
                <h1>Admin Dashboard</h1>
                <h2>Welcome back, Administrator</h2>
            </header>

            {/* Tab Navigation */}
            <div className={styles.tabNavigation}>
                <button
                    className={`${styles.tabButton} ${activeTab === 'products' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('products')}
                >
                    <span className={styles.tabIcon}>📦</span>
                    <span className={styles.tabLabel}>Product Management</span>
                </button>
                <button
                    className={`${styles.tabButton} ${activeTab === 'orders' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('orders')}
                >
                    <span className={styles.tabIcon}>🛒</span>
                    <span className={styles.tabLabel}>Order Management</span>
                </button>
                <button
                    className={`${styles.tabButton} ${activeTab === 'members' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('members')}
                >
                    <span className={styles.tabIcon}>👥</span>
                    <span className={styles.tabLabel}>Member Management</span>
                </button>
                
                <button
                    className={`${styles.tabButton} ${activeTab === 'users' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('users')}
                >
                    <span className={styles.tabIcon}>👑</span>
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