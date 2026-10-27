import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShoppingBag, Package, BarChart3, TrendingUp, CheckCircle2, 
  Clock, AlertTriangle, ArrowRight, Sparkles, Layers, ShieldCheck, 
  PieChart as PieChartIcon, Activity, Landmark
} from 'lucide-react';
import PesoSign from '../Common/PesoSign.jsx';
import { 
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/firebaseConfig';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { fromCentavos } from '../../utils/financeConstants.js';
import OrderManagement from '../Data/OrderManagement.jsx';
import ProductManagement from '../ProductManagement/ProductManagement.jsx';
import styles from './CommerceHub.module.css';

function CommerceHub() {
  const { theme } = useTheme();
  const isClassic = theme === 'dark';

  // ========================================
  // STATE MANAGEMENT
  // ========================================
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'orders' | 'products'
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [igfAccount, setIgfAccount] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [analyticsViewType, setAnalyticsViewType] = useState('revenue'); // 'revenue' | 'volume'

  // Subscribe to real-time stats for analytics dashboard
  useEffect(() => {
    let unsubProducts = () => {};
    let unsubIgf = () => {};

    const unsubOrders = onSnapshot(collection(db, 'orders'), (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setOrders(docs);
      setLoadingStats(false);
    }, (err) => {
      console.error('Error fetching orders for analytics:', err);
      setLoadingStats(false);
    });

    try {
      unsubProducts = onSnapshot(collection(db, 'products'), (snapshot) => {
        const prodDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setProducts(prodDocs);
      });
    } catch (err) {
      console.error('Error fetching products for analytics:', err);
    }

    try {
      unsubIgf = onSnapshot(doc(db, 'fundAccounts', 'fund_igf_main'), (docSnap) => {
        if (docSnap.exists()) {
          setIgfAccount({ id: docSnap.id, ...docSnap.data() });
        } else {
          setIgfAccount({ balanceCentavos: 0 });
        }
      }, (err) => {
        console.warn('Error reading IGF account in CommerceHub:', err);
      });
    } catch (err) {
      console.error('Error subscribing to IGF account:', err);
    }

    return () => {
      unsubOrders();
      unsubProducts();
      unsubIgf();
    };
  }, []);

  // Compute live analytics metrics
  const totalRevenue = useMemo(() => {
    return orders.reduce((sum, o) => {
      const val = Number(o.productInfo?.totalPrice || o.totalPrice) || 0;
      return o.orderStatus !== 'Cancelled' ? sum + val : sum;
    }, 0);
  }, [orders]);

  const completedOrders = useMemo(() => orders.filter(o => o.orderStatus === 'Completed' || o.claimed).length, [orders]);
  const pendingOrders = useMemo(() => orders.filter(o => o.orderStatus === 'Pending').length, [orders]);
  const ongoingOrders = useMemo(() => orders.filter(o => o.orderStatus === 'Ongoing' || o.orderStatus === 'Paid').length, [orders]);
  const cancelledOrders = useMemo(() => orders.filter(o => o.orderStatus === 'Cancelled').length, [orders]);
  const unclaimedOrders = useMemo(() => orders.length - completedOrders, [orders, completedOrders]);
  const claimRate = orders.length > 0 ? Math.round((completedOrders / orders.length) * 100) : 0;
  const lowStockProducts = useMemo(() => products.filter(p => Number(p.stockAvailable) <= 5), [products]);

  const totalCatalogValue = useMemo(() => {
    return products.reduce((sum, p) => sum + (Number(p.price) || 0) * (Number(p.stockAvailable) || 0), 0);
  }, [products]);

  const igfBalance = useMemo(() => fromCentavos(igfAccount?.balanceCentavos || 0), [igfAccount]);
  const syncedOrdersCount = useMemo(() => orders.filter(o => o.igfSynced).length, [orders]);

  // Chronological revenue & order trend calculation for Recharts AreaChart
  const trendData = useMemo(() => {
    if (!orders.length) {
      return [
        { name: 'Mon', revenue: 0, orders: 0 },
        { name: 'Tue', revenue: 0, orders: 0 },
        { name: 'Wed', revenue: 0, orders: 0 },
        { name: 'Thu', revenue: 0, orders: 0 },
        { name: 'Fri', revenue: 0, orders: 0 },
        { name: 'Sat', revenue: 0, orders: 0 },
        { name: 'Sun', revenue: 0, orders: 0 },
      ];
    }

    const dayMap = {};
    orders.forEach(o => {
      let dateLabel = 'Recent';
      if (o.createdAt) {
        if (typeof o.createdAt.toDate === 'function') {
          const d = o.createdAt.toDate();
          dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } else if (typeof o.createdAt === 'string') {
          const d = new Date(o.createdAt);
          if (!isNaN(d.getTime())) {
            dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }
        }
      }
      if (!dayMap[dateLabel]) {
        dayMap[dateLabel] = { name: dateLabel, revenue: 0, orders: 0 };
      }
      const val = Number(o.productInfo?.totalPrice || o.totalPrice) || 0;
      if (o.orderStatus !== 'Cancelled') {
        dayMap[dateLabel].revenue += val;
      }
      dayMap[dateLabel].orders += 1;
    });

    const list = Object.values(dayMap);
    if (list.length === 1) {
      return [
        { name: 'Base', revenue: Math.round(list[0].revenue * 0.35), orders: Math.max(1, Math.round(list[0].orders * 0.5)) },
        list[0]
      ];
    }
    return list.slice(-8);
  }, [orders]);

  // Order status breakdown for Recharts Donut PieChart
  const statusDistributionData = useMemo(() => {
    const raw = [
      { name: 'Pending Verification', value: pendingOrders, color: '#e5b842' },
      { name: 'Paid & Processing', value: ongoingOrders, color: '#3b82f6' },
      { name: 'Completed & Claimed', value: completedOrders, color: '#10b981' },
      { name: 'Cancelled Orders', value: cancelledOrders, color: '#b91c1c' }
    ];
    const filtered = raw.filter(item => item.value > 0);
    return filtered.length > 0 ? filtered : [{ name: 'Awaiting Orders', value: 1, color: '#64748b' }];
  }, [pendingOrders, ongoingOrders, completedOrders, cancelledOrders]);

  // Product inventory velocity for Recharts BarChart
  const productVelocityData = useMemo(() => {
    const orderCountByProduct = {};
    orders.forEach(o => {
      const pName = o.productInfo?.productName || o.productName || 'Catalog Product';
      const qty = Number(o.productInfo?.quantity || o.quantity) || 1;
      orderCountByProduct[pName] = (orderCountByProduct[pName] || 0) + qty;
    });

    return products.slice(0, 6).map(p => ({
      name: p.productName?.length > 14 ? p.productName.slice(0, 13) + '…' : p.productName,
      fullName: p.productName,
      stock: Number(p.stockAvailable) || 0,
      ordered: orderCountByProduct[p.productName] || 0,
      price: Number(p.price) || 0
    }));
  }, [products, orders]);

  // Custom Recharts Tooltip styled in royal maroon & gold
  const CustomChartTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className={styles.chartTooltip}>
          <p className={styles.chartTooltipLabel}>{label}</p>
          {payload.map((entry, index) => (
            <p key={`tooltip-${index}`} className={styles.chartTooltipValue} style={{ color: entry.color || '#ffea9f' }}>
              <span>{entry.name}: </span>
              <strong>
                {entry.name.toLowerCase().includes('revenue')
                  ? `₱${Number(entry.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : `${entry.value} ${entry.name.toLowerCase().includes('stock') ? 'units' : 'orders'}`}
              </strong>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // ========================================
  // RENDER TAB CONTENT
  // ========================================
  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
      case 'analytics':
        return renderDashboardAndAnalytics();
      case 'orders':
        return <OrderManagement />;
      case 'products':
        return <ProductManagement />;
      default:
        return renderDashboardAndAnalytics();
    }
  };

  // ========================================
  // RENDER UNIFIED DASHBOARD & ANALYTICS
  // ========================================
  const renderDashboardAndAnalytics = () => (
    <div className={styles.analyticsDashboard}>
      {/* KPI Overview Grid - Combining Order Dashboard & Commerce Analytics */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <span className={styles.statLabel}>Total Orders</span>
            <div className={`${styles.statIcon} ${styles.iconGold}`}><Package size={20} /></div>
          </div>
          <div className={styles.statValue}>{loadingStats ? '...' : orders.length}</div>
          <div className={styles.statSubtext}>All time orders volume</div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <span className={styles.statLabel}>Claimed Orders</span>
            <div className={`${styles.statIcon} ${styles.iconGreen}`}><CheckCircle2 size={20} /></div>
          </div>
          <div className={styles.statValue}>{loadingStats ? '...' : completedOrders}</div>
          <div className={styles.statSubtext}>{claimRate}% fulfillment & claim rate</div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <span className={styles.statLabel}>Unclaimed Orders</span>
            <div className={`${styles.statIcon} ${styles.iconAmber}`}><Clock size={20} /></div>
          </div>
          <div className={styles.statValue}>{loadingStats ? '...' : unclaimedOrders}</div>
          <div className={styles.statSubtext}>{pendingOrders} pending verification</div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <span className={styles.statLabel}>Gross Revenue</span>
            <div className={`${styles.statIcon} ${styles.iconGold}`}><PesoSign size={20} /></div>
          </div>
          <div className={styles.statValue}>
            {loadingStats ? '...' : `₱${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
          <div className={styles.statSubtext}>Active non-cancelled transactions</div>
        </div>

        <div className={`${styles.statCard} ${styles.statCardIgf}`}>
          <div className={styles.statHeader}>
            <span className={styles.statLabel}>
              <span className={styles.igfLabelBadge}>IGF Fund</span>
              Treasury Balance
            </span>
            <div className={`${styles.statIcon} ${styles.iconGold}`}><Landmark size={20} /></div>
          </div>
          <div className={styles.statValue}>
            {loadingStats ? '...' : `₱${igfBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
          <div className={styles.statSubtext}>
            <span className={styles.igfLinkDot} /> {syncedOrdersCount} orders credited to IGF
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <span className={styles.statLabel}>Inventory Valuation</span>
            <div className={`${styles.statIcon} ${styles.iconPurple}`}><Layers size={20} /></div>
          </div>
          <div className={styles.statValue}>
            {loadingStats ? '...' : `₱${totalCatalogValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
          <div className={styles.statSubtext}>{products.length} active catalog SKUs</div>
        </div>
      </div>

      {/* IGF Profit & Treasury Integration Banner */}
      <div className={styles.igfIntegrationBanner}>
        <div className={styles.igfBannerLeft}>
          <div className={styles.igfBannerIcon}>
            <Landmark size={24} />
          </div>
          <div>
            <div className={styles.igfBannerTitleRow}>
              <h4 className={styles.igfBannerTitle}>Income Generated Fund (IGF) Integration</h4>
              <span className={styles.igfStatusTag}>Live Treasury Link</span>
            </div>
            <p className={styles.igfBannerDesc}>
              SSG Merchandise profits directly fuel the Income Generated Fund (IGF). Official sales from shirts, uniforms, and student merchandise are tracked and credited into the IGF general ledger.
            </p>
          </div>
        </div>
        <div className={styles.igfBannerRight}>
          <div className={styles.igfBannerMetric}>
            <span className={styles.igfMetricLabel}>Merchandise Revenue</span>
            <span className={styles.igfMetricValue}>
              ₱{totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <button 
            type="button"
            className={styles.igfBannerActionBtn}
            onClick={() => setActiveTab('orders')}
          >
            <span>Manage Order Sync</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* Visual Charts Grid */}
      <div className={styles.chartsGrid}>
        {/* Chart 1: Revenue & Order Performance Trend */}
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <div>
              <h3 className={styles.chartTitle}>
                <TrendingUp size={18} />
                <span>Revenue & Order Velocity</span>
              </h3>
              <p className={styles.chartSubtitle}>Chronological performance across active order cycles</p>
            </div>
            <div className={styles.chartFilterToggle}>
              <button 
                className={`${styles.chartToggleBtn} ${analyticsViewType === 'revenue' ? styles.chartToggleBtnActive : ''}`}
                onClick={() => setAnalyticsViewType('revenue')}
              >
                Revenue (₱)
              </button>
              <button 
                className={`${styles.chartToggleBtn} ${analyticsViewType === 'volume' ? styles.chartToggleBtnActive : ''}`}
                onClick={() => setAnalyticsViewType('volume')}
              >
                Volume (Orders)
              </button>
            </div>
          </div>

          <div className={styles.chartContentArea}>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trendData} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="maroonGoldGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={isClassic ? '#e5b842' : '#3b82f6'} stopOpacity={0.65}/>
                    <stop offset="95%" stopColor={isClassic ? '#8a6520' : '#3b82f6'} stopOpacity={0.02}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={isClassic ? 'rgba(212, 175, 55, 0.15)' : 'rgba(0,0,0,0.06)'} />
                <XAxis 
                  dataKey="name" 
                  stroke={isClassic ? '#ffea9f' : '#64748b'} 
                  fontSize={11} 
                  tickLine={false} 
                />
                <YAxis 
                  stroke={isClassic ? '#ffea9f' : '#64748b'} 
                  fontSize={11} 
                  tickLine={false} 
                  tickFormatter={(val) => analyticsViewType === 'revenue' ? `₱${val >= 1000 ? `${(val/1000).toFixed(1)}k` : val}` : val}
                />
                <Tooltip content={<CustomChartTooltip />} />
                <Area 
                  type="monotone" 
                  dataKey={analyticsViewType === 'revenue' ? 'revenue' : 'orders'} 
                  name={analyticsViewType === 'revenue' ? 'Revenue' : 'Order Count'} 
                  stroke={isClassic ? '#d4af37' : '#2563eb'} 
                  strokeWidth={2.5}
                  fillOpacity={1} 
                  fill="url(#maroonGoldGrad)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Order Pipeline Status Donut */}
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <div>
              <h3 className={styles.chartTitle}>
                <PieChartIcon size={18} />
                <span>Order Pipeline Distribution</span>
              </h3>
              <p className={styles.chartSubtitle}>Real-time fulfillment breakdown by status</p>
            </div>
            <div className={styles.pieMetricTag}>
              <span>{orders.length} Total</span>
            </div>
          </div>

          <div className={styles.pieChartWrapper}>
            <div className={styles.donutContainer}>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={statusDistributionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {statusDistributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke={isClassic ? '#1b0407' : '#ffffff'} strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className={styles.donutCenterLabel}>
                <span className={styles.donutCenterValue}>{claimRate}%</span>
                <span className={styles.donutCenterSub}>Claimed</span>
              </div>
            </div>

            <div className={styles.pieLegendList}>
              {statusDistributionData.map((item, idx) => (
                <div key={idx} className={styles.pieLegendItem}>
                  <div className={styles.pieLegendColor} style={{ backgroundColor: item.color }} />
                  <span className={styles.pieLegendName}>{item.name}</span>
                  <span className={styles.pieLegendCount}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Detail Row: Top Products Velocity & Stock Action Center */}
      <div className={styles.analyticsDetailRow}>
        {/* Chart 3: Top Products Velocity */}
        <div className={styles.analyticsSectionCard}>
          <div className={styles.chartHeader}>
            <div>
              <h3 className={styles.chartTitle}>
                <Activity size={18} />
                <span>Product Demand & Inventory Levels</span>
              </h3>
              <p className={styles.chartSubtitle}>Stock on hand compared to demand volume</p>
            </div>
          </div>

          <div className={styles.barChartContainer}>
            {productVelocityData.length === 0 ? (
              <p className={styles.emptyChartNotice}>No product catalog entries available yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={productVelocityData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isClassic ? 'rgba(212, 175, 55, 0.15)' : 'rgba(0,0,0,0.06)'} />
                  <XAxis dataKey="name" stroke={isClassic ? '#ffea9f' : '#64748b'} fontSize={10} tickLine={false} />
                  <YAxis stroke={isClassic ? '#ffea9f' : '#64748b'} fontSize={10} tickLine={false} />
                  <Tooltip content={<CustomChartTooltip />} />
                  <Bar dataKey="stock" name="Stock Available" fill={isClassic ? '#d4af37' : '#10b981'} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="ordered" name="Units Ordered" fill={isClassic ? '#8a1a24' : '#3b82f6'} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Inventory Alerts & Action Panel */}
        <div className={styles.analyticsSectionCard}>
          <h3 className={styles.analyticsCardTitle}>
            <AlertTriangle size={18} />
            <span>Stock Health & Fast Operations</span>
          </h3>
          <p className={styles.analyticsCardDesc}>
            {lowStockProducts.length > 0 
              ? `There are ${lowStockProducts.length} product(s) at or below critical stock threshold (≤ 5 units). Prioritize replenishment to ensure uninterrupted student service.`
              : 'All catalog items are currently within safe operational stock levels.'}
          </p>

          {lowStockProducts.length > 0 && (
            <div className={styles.lowStockPreviewList}>
              {lowStockProducts.slice(0, 3).map((item) => (
                <div key={item.id} className={styles.lowStockRow}>
                  <span className={styles.lowStockName}>{item.productName}</span>
                  <span className={styles.lowStockPill}>
                    {Number(item.stockAvailable) === 0 ? 'Out of Stock' : `${item.stockAvailable} left`}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className={styles.actionsRow}>
            <button 
              className={styles.jumpBtn}
              onClick={() => setActiveTab('orders')}
            >
              Go to Order Operations <ArrowRight size={15} />
            </button>
            <button 
              className={styles.jumpBtnSecondary}
              onClick={() => setActiveTab('products')}
            >
              Manage Products <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // ========================================
  // RENDER
  // ========================================
  return (
    <div className={`${styles.wrapper} ${isClassic ? styles.commerceHubClassic : ''}`}>
      <div className={styles.container}>
        {/* Ethnic Tribal Border Accent in Maroon Theme */}
        {isClassic && <div className={styles.tribalBorderTop} />}

        {/* Top Bar */}
        <div className={styles.topBar}>
          <div className={styles.topBarContent}>
            <div className={styles.topBarLeft}>
              <div className={styles.eyebrowBox}>
                <span className={styles.eyebrowDot} />
                <p className={styles.eyebrow}>
                  {isClassic ? 'SUPREMO GOBYERNO • COMMERCE HUB' : 'Commerce Management'}
                </p>
              </div>
              <h1 className={styles.title}>Commerce Hub</h1>
              <p className={styles.subtitle}>
                Unified command center for student merchandising, orders, and real-time revenue analytics
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
            className={`${styles.tabButton} ${activeTab === 'dashboard' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <BarChart3 size={17} />
            <span>Dashboard & Analysis</span>
            <span className={styles.tabBadge}>Live Analytics</span>
          </button>

          <button
            className={`${styles.tabButton} ${activeTab === 'orders' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            <Package size={17} />
            <span>Order Management</span>
            <span className={styles.tabBadge}>{orders.length}</span>
          </button>

          <button
            className={`${styles.tabButton} ${activeTab === 'products' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('products')}
          >
            <ShoppingBag size={17} />
            <span>Product Management</span>
            <span className={styles.tabBadge}>{products.length}</span>
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

