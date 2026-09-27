import React, { useState } from 'react';
import { ShoppingBag, Package, BarChart3 } from 'lucide-react';
import OrderManagement from '../Data/OrderManagement.jsx';
import ProductManagement from '../ProductManagement/ProductManagement.jsx';
import styles from './CommerceHub.module.css';

function CommerceHub() {
  // ========================================
  // STATE MANAGEMENT
  // ========================================
  const [activeTab, setActiveTab] = useState('orders'); // 'orders' | 'products' | 'analytics'

  // ========================================
  // RENDER TAB CONTENT
  // ========================================
  const renderTabContent = () => {
    switch (activeTab) {
      case 'orders':
        return <OrderManagement />;
      case 'products':
        return <ProductManagement />;
      case 'analytics':
        return renderAnalytics();
      default:
        return <OrderManagement />;
    }
  };

  // ========================================
  // RENDER ANALYTICS (PLACEHOLDER)
  // ========================================
  const renderAnalytics = () => (
    <div className={styles.analyticsPlaceholder}>
      <div className={styles.placeholderIcon}>
        <BarChart3 size={48} />
      </div>
      <h3 className={styles.placeholderTitle}>Commerce Analytics</h3>
      <p className={styles.placeholderText}>
        Comprehensive analytics and reports for orders and products will be available here.
      </p>
      <p className={styles.placeholderSubtext}>
        Track sales trends, popular products, revenue insights, and more.
      </p>
    </div>
  );

  // ========================================
  // RENDER
  // ========================================
  return (
    <div className={styles.wrapper}>
      <div className={styles.container}>
        {/* Top Bar */}
        <div className={styles.topBar}>
          <div className={styles.topBarContent}>
            <div className={styles.topBarLeft}>
              <p className={styles.eyebrow}>Commerce Management</p>
              <h1 className={styles.title}>Commerce Hub</h1>
              <p className={styles.subtitle}>
                Manage orders, products, and track commerce performance
              </p>
            </div>
            <div className={styles.topBarRight}>
              <div className={styles.hubBadge}>
                <ShoppingBag size={18} />
                <span>Representative Portal</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className={styles.tabNavigation}>
          <button
            className={`${styles.tabButton} ${activeTab === 'orders' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            <Package size={17} />
            <span>Order Management</span>
            <span className={styles.tabBadge}>Orders</span>
          </button>

          <button
            className={`${styles.tabButton} ${activeTab === 'products' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('products')}
          >
            <ShoppingBag size={17} />
            <span>Product Management</span>
            <span className={styles.tabBadge}>Products</span>
          </button>

          <button
            className={`${styles.tabButton} ${activeTab === 'analytics' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            <BarChart3 size={17} />
            <span>Analytics</span>
            <span className={styles.tabBadge}>Insights</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className={styles.tabContent} key={activeTab}>
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
}

export default CommerceHub;
