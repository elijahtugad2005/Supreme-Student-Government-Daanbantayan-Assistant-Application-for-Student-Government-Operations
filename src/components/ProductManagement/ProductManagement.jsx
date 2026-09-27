import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase/firebaseConfig';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import ProductFormPanelEnhanced from './ProductFormPanelEnhanced';
import styles from './productmanagement.module.css';

// ========================================
// IMAGE COMPRESSION UTILITY (unchanged)
// ========================================
const CompressImage = (file, maxWidth = 1000, quality = 0.8) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        if (compressedBase64.length > 1024 * 1024) {
          console.warn('Base64 string still exceeds 1MB after compression.');
        }
        resolve(compressedBase64);
      };
      img.onerror = reject;
      img.src = event.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// ========================================
// SIDEBAR COMPONENT
// ========================================
function Sidebar({ activeSection, onNavigate, productCount }) {
  const navItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
        </svg>
      ),
    },
    {
      id: 'products',
      label: 'Products',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      ),
      badge: productCount,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ];

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarBrand}>
        <div className={styles.sidebarLogo}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
          </svg>
        </div>
        <span className={styles.sidebarBrandName}>Inventory</span>
      </div>

      <nav className={styles.sidebarNav}>
        <p className={styles.sidebarNavLabel}>Main Menu</p>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`${styles.sidebarNavItem} ${activeSection === item.id ? styles.sidebarNavItemActive : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className={styles.sidebarNavIcon}>{item.icon}</span>
            <span className={styles.sidebarNavText}>{item.label}</span>
            {item.badge !== undefined && (
              <span className={styles.sidebarNavBadge}>{item.badge}</span>
            )}
          </button>
        ))}
      </nav>

      <div className={styles.sidebarFooter}>
        <div className={styles.sidebarFooterUser}>
          <div className={styles.sidebarFooterAvatar}>PM</div>
          <div>
            <p className={styles.sidebarFooterName}>Product Manager</p>
            <p className={styles.sidebarFooterRole}>Admin</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ========================================
// KPI CARD COMPONENT
// ========================================
function KpiCard({ label, value, sub, color, icon }) {
  return (
    <div className={`${styles.kpiCard} ${styles[`kpiCard${color}`]}`}>
      <div className={styles.kpiCardHeader}>
        <span className={styles.kpiCardLabel}>{label}</span>
        <span className={styles.kpiCardIcon}>{icon}</span>
      </div>
      <p className={styles.kpiCardValue}>{value}</p>
      {sub && <p className={styles.kpiCardSub}>{sub}</p>}
    </div>
  );
}

// ========================================
// DASHBOARD VIEW
// ========================================
function DashboardView({ products, onRestock }) {
  const totalProducts = products.length;
  const lowStock = products.filter((p) => p.stockAvailable > 0 && p.stockAvailable <= 10);
  const outOfStock = products.filter((p) => p.stockAvailable === 0);
  const totalValue = products.reduce((sum, p) => sum + (p.price || 0) * (p.stockAvailable || 0), 0);

  // Top 5 by stock value
  const top5 = [...products]
    .map((p) => ({ ...p, value: (p.price || 0) * (p.stockAvailable || 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const maxValue = top5[0]?.value || 1;

  return (
    <div className={styles.dashboardView}>
      {/* KPI Row */}
      <div className={styles.kpiRow}>
        <KpiCard
          label="Total Products"
          value={totalProducts}
          sub="across all categories"
          color="Blue"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" />
            </svg>
          }
        />
        <KpiCard
          label="Low Stock"
          value={lowStock.length}
          sub="≤ 10 units remaining"
          color="Amber"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          }
        />
        <KpiCard
          label="Out of Stock"
          value={outOfStock.length}
          sub="needs immediate restock"
          color="Red"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          }
        />
        <KpiCard
          label="Inventory Value"
          value={`₱${totalValue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub="total stock value"
          color="Green"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          }
        />
      </div>

      <div className={styles.dashboardGrid}>
        {/* Low Stock Alert Table */}
        <div className={styles.dashboardCard}>
          <div className={styles.dashboardCardHeader}>
            <h3 className={styles.dashboardCardTitle}>Low Stock Alerts</h3>
            <span className={styles.dashboardCardBadgeAmber}>{lowStock.length + outOfStock.length} items</span>
          </div>
          {lowStock.length === 0 && outOfStock.length === 0 ? (
            <div className={styles.dashboardEmptyAlert}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <p>All products are well-stocked!</p>
            </div>
          ) : (
            <div className={styles.alertTableWrapper}>
              <table className={styles.alertTable}>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Stock</th>
                    <th>Price</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[...outOfStock, ...lowStock].map((product) => (
                    <tr key={product.docId}>
                      <td>
                        <div className={styles.alertTableProduct}>
                          <img
                            src={product.imageBase64 || product.imageUrl || 'https://via.placeholder.com/32'}
                            alt={product.productName}
                            className={styles.alertTableThumb}
                            onError={(e) => { e.target.src = 'https://via.placeholder.com/32'; }}
                          />
                          <span>{product.productName}</span>
                        </div>
                      </td>
                      <td>
                        <span className={product.stockAvailable === 0 ? styles.stockBadgeOut : styles.stockBadgeLow}>
                          {product.stockAvailable === 0 ? 'Out of Stock' : `${product.stockAvailable} units`}
                        </span>
                      </td>
                      <td className={styles.alertTablePrice}>₱{product.price?.toFixed(2)}</td>
                      <td>
                        <button className={styles.restockBtn} onClick={() => onRestock(product)}>
                          Restock
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Top 5 Bar Chart */}
        <div className={styles.dashboardCard}>
          <div className={styles.dashboardCardHeader}>
            <h3 className={styles.dashboardCardTitle}>Top 5 by Stock Value</h3>
          </div>
          {top5.length === 0 ? (
            <div className={styles.dashboardEmptyAlert}>
              <p>No products to display.</p>
            </div>
          ) : (
            <div className={styles.barChart}>
              {top5.map((product, idx) => (
                <div key={product.docId || idx} className={styles.barChartRow}>
                  <div className={styles.barChartLabel} title={product.productName}>
                    {product.productName.length > 20 ? product.productName.slice(0, 18) + '…' : product.productName}
                  </div>
                  <div className={styles.barChartTrack}>
                    <div
                      className={styles.barChartFill}
                      style={{ width: `${(product.value / maxValue) * 100}%` }}
                    />
                  </div>
                  <div className={styles.barChartValue}>
                    ₱{product.value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ========================================
// LOADING SKELETON ROW
// ========================================
function SkeletonRow() {
  return (
    <tr className={styles.skeletonRow}>
      {[...Array(7)].map((_, i) => (
        <td key={i}><div className={styles.skeletonCell} /></td>
      ))}
    </tr>
  );
}

// ========================================
// PRODUCT TABLE VIEW
// ========================================
function ProductTableView({ products, onEdit, onDelete, onNewProduct, loading }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortKey, setSortKey] = useState('productName');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const PER_PAGE = 10;

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  };

  const filtered = useMemo(() => {
    let list = [...products];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.productName?.toLowerCase().includes(q));
    }
    if (filter === 'lowstock') list = list.filter((p) => p.stockAvailable > 0 && p.stockAvailable <= 10);
    if (filter === 'outofstock') list = list.filter((p) => p.stockAvailable === 0);
    list.sort((a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [products, search, filter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className={styles.sortIconNeutral}>↕</span>;
    return <span className={styles.sortIconActive}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className={styles.productsView}>
      {/* Toolbar */}
      <div className={styles.productsToolbar}>
        <div className={styles.productsToolbarLeft}>
          <div className={styles.searchWrapper}>
            <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search products…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className={styles.searchInput}
            />
          </div>
          <select
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setPage(1); }}
            className={styles.filterSelect}
          >
            <option value="all">All Products</option>
            <option value="lowstock">Low Stock</option>
            <option value="outofstock">Out of Stock</option>
          </select>
        </div>
        <button className={styles.newProductBtn} onClick={onNewProduct}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Product
        </button>
      </div>

      {/* Table */}
      <div className={styles.tableWrapper}>
        <table className={styles.productTable}>
          <thead>
            <tr>
              <th className={styles.thImage}>Image</th>
              <th className={styles.thSortable} onClick={() => handleSort('productName')}>
                Product Name <SortIcon col="productName" />
              </th>
              <th className={styles.thSortable} onClick={() => handleSort('price')}>
                Price <SortIcon col="price" />
              </th>
              <th className={styles.thSortable} onClick={() => handleSort('stockAvailable')}>
                Stock <SortIcon col="stockAvailable" />
              </th>
              <th>Supplier</th>
              <th>Variations</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
            ) : paginated.length === 0 ? (
              <tr>
                <td colSpan={7} className={styles.tableEmpty}>
                  <div className={styles.tableEmptyContent}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <p>No products match your search.</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginated.map((product) => (
                <tr key={product.docId} className={styles.tableRow}>
                  <td>
                    <img
                      src={product.imageBase64 || product.imageUrl || 'https://via.placeholder.com/48'}
                      alt={product.productName}
                      className={styles.tableThumb}
                      onError={(e) => { e.target.src = 'https://via.placeholder.com/48'; }}
                    />
                  </td>
                  <td className={styles.tableProductName}>{product.productName}</td>
                  <td className={styles.tablePrice}>₱{product.price?.toFixed(2)}</td>
                  <td>
                    {product.stockAvailable === 0 ? (
                      <span className={styles.stockBadgeOut}>Out of Stock</span>
                    ) : product.stockAvailable <= 10 ? (
                      <span className={styles.stockBadgeLow}>{product.stockAvailable} units</span>
                    ) : (
                      <span className={styles.stockBadgeOk}>{product.stockAvailable} units</span>
                    )}
                  </td>
                  <td className={styles.tableSupplier}>{product.supplier}</td>
                  <td>
                    {product.hasVariations ? (
                      <span className={styles.variationsBadge}>
                        {(product.sizeOptions?.length || 0) + (product.colorVariations?.length || 0)} var.
                      </span>
                    ) : (
                      <span className={styles.noVariations}>—</span>
                    )}
                  </td>
                  <td>
                    <div className={styles.tableActions}>
                      <button className={styles.tableEditBtn} onClick={() => onEdit(product)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        Edit
                      </button>
                      <button className={styles.tableDeleteBtn} onClick={() => onDelete(product.docId, product.productName)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className={styles.pagination}>
        <span className={styles.paginationInfo}>
          Showing {filtered.length === 0 ? 0 : (page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, filtered.length)} of {filtered.length}
        </span>
        <div className={styles.paginationControls}>
          <button
            className={styles.paginationBtn}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            ← Previous
          </button>
          <span className={styles.paginationPage}>{page} / {totalPages}</span>
          <button
            className={styles.paginationBtn}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

// ========================================
// SETTINGS VIEW
// ========================================
function SettingsView() {
  return (
    <div className={styles.settingsView}>
      <div className={styles.settingsPlaceholder}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <h3>Settings</h3>
        <p>Configuration options will appear here.</p>
      </div>
    </div>
  );
}

// ========================================
// MAIN COMPONENT
// ========================================
function ProductManagement() {
  // Navigation
  const [activeSection, setActiveSection] = useState('dashboard');

  // Product form data
  const [productData, setProductData] = useState({
    productName: '',
    stockAvailable: 0,
    hasVariations: false,
    sizeOptions: [],
    colorVariations: [],
    customVariations: [], // NEW: Array of {type: string, options: [{name: string, image: string, stock: number}]}
    description: '',
    supplier: '',
    price: 0,
    imageFile: null,
    imagePath: '',
    imageBase64: '',
  });

  // Products list from Firebase
  const [products, setProducts] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);

  // UI States
  const [loading, setLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [editingProductId, setEditingProductId] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [notification, setNotification] = useState({ show: false, message: '', type: '' });

  // ======================================
  // SHOW NOTIFICATION
  // ======================================
  const showNotification = (message, type = 'success') => {
    setNotification({ show: true, message, type });
    setTimeout(() => setNotification({ show: false, message: '', type: '' }), 4000);
  };

  // ======================================
  // FETCH PRODUCTS FROM FIREBASE
  // ======================================
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'products'), (snapshot) => {
      const productsData = snapshot.docs.map((doc) => ({
        docId: doc.id,
        productId: doc.data().productId,
        ...doc.data(),
      }));
      setProducts(productsData);
      setDataLoading(false);
    }, (error) => {
      console.error('Error fetching products:', error);
      setDataLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // ======================================
  // GENERATE UNIQUE PRODUCT ID
  // ======================================
  const generateProductId = () => {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `PROD-${timestamp}-${random}`;
  };

  // ======================================
  // VALIDATE FORM
  // ======================================
  const validateForm = () => {
    if (!productData.productName.trim()) { alert('Product name is required'); return false; }
    if (productData.stockAvailable < 0) { alert('Stock quantity cannot be negative'); return false; }
    if (!productData.description.trim()) { alert('Product description is required'); return false; }
    if (productData.price <= 0) { alert('Product price must be greater than 0'); return false; }
    if (!productData.supplier.trim()) { alert('Supplier name is required'); return false; }
    return true;
  };

  // ======================================
  // RESET FORM
  // ======================================
  const resetForm = () => {
    setProductData({
      productName: '',
      stockAvailable: 0,
      hasVariations: false,
      sizeOptions: [],
      colorVariations: [],
      customVariations: [], // NEW
      description: '',
      price: 0,
      supplier: '',
      imageFile: null,
      imageBase64: '',
    });
    setImagePreview(null);
    setEditingProductId(null);
  };

  // ======================================
  // OPEN PANEL FOR NEW PRODUCT
  // ======================================
  const handleNewProduct = () => {
    resetForm();
    setIsPanelOpen(true);
  };

  // ======================================
  // OPEN PANEL FOR EDIT
  // ======================================
  const handleEditClick = (product) => {
    setEditingProductId(product.docId);
    setProductData({
      productName: product.productName,
      stockAvailable: product.stockAvailable,
      hasVariations: product.hasVariations,
      description: product.description,
      price: product.price,
      supplier: product.supplier,
      sizeOptions: product.sizeOptions || [],
      colorVariations: product.colorVariations || [],
      customVariations: product.customVariations || [], // NEW
      imageBase64: product.imageBase64 || '',
      productId: product.productId,
      imageFile: null,
    });
    setImagePreview(product.imageBase64 || null);
    setIsPanelOpen(true);
    setActiveSection('products');
  };

  // ======================================
  // HANDLE ADD PRODUCT (Firebase)
  // ======================================
  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    try {
      const productId = generateProductId();
      const newProduct = {
        productId,
        productName: productData.productName,
        stockAvailable: parseInt(productData.stockAvailable),
        hasVariations: productData.hasVariations,
        sizeOptions: productData.hasVariations ? productData.sizeOptions : [],
        colorVariations: productData.hasVariations ? productData.colorVariations : [],
        customVariations: productData.hasVariations ? productData.customVariations : [], // NEW
        description: productData.description,
        price: parseFloat(productData.price),
        supplier: productData.supplier,
        imageUrl: productData.imageBase64 || '/products/default.jpg',
        imageBase64: productData.imageBase64 || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await addDoc(collection(db, 'products'), newProduct);
      showNotification(`Product "${productData.productName}" added successfully!`, 'success');
      resetForm();
      setIsPanelOpen(false);
    } catch (error) {
      console.error('Error adding product:', error);
      showNotification('Error adding product. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ======================================
  // HANDLE UPDATE PRODUCT (Firebase)
  // ======================================
  const handleUpdateProduct = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    try {
      const productRef = doc(db, 'products', editingProductId);
      const updatedProduct = {
        productName: productData.productName,
        stockAvailable: parseInt(productData.stockAvailable),
        hasVariations: productData.hasVariations,
        sizeOptions: productData.hasVariations ? productData.sizeOptions : [],
        colorVariations: productData.hasVariations ? productData.colorVariations : [],
        customVariations: productData.hasVariations ? productData.customVariations : [], // NEW
        description: productData.description,
        price: parseFloat(productData.price),
        supplier: productData.supplier,
        imageBase64: productData.imageBase64 || '/products/default.jpg',
        updatedAt: new Date().toISOString(),
      };
      await updateDoc(productRef, updatedProduct);
      showNotification('Product updated successfully!', 'success');
      resetForm();
      setIsPanelOpen(false);
    } catch (error) {
      console.error('Error updating product:', error);
      showNotification('Error updating product. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ======================================
  // HANDLE DELETE PRODUCT (Firebase)
  // ======================================
  const handleDeleteProduct = async (docId, productName) => {
    if (!window.confirm(`Are you sure you want to delete "${productName}"?\n\nThis action cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'products', docId));
      showNotification(`Product "${productName}" deleted successfully!`, 'success');
    } catch (error) {
      console.error('Error deleting product:', error);
      showNotification('Error deleting product. Please try again.', 'error');
    }
  };

  // ======================================
  // HANDLE RESTOCK PLACEHOLDER
  // ======================================
  const handleRestock = (product) => {
    handleEditClick(product);
    setActiveSection('products');
  };

  return (
    <div className={styles.pmContainer}>
      {/* Notification Toast */}
      {notification.show && (
        <div className={`${styles.notification} ${styles[`notification${notification.type.charAt(0).toUpperCase() + notification.type.slice(1)}`]}`}>
          <span className={styles.notificationIcon}>
            {notification.type === 'success' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            )}
          </span>
          <span className={styles.notificationMessage}>{notification.message}</span>
        </div>
      )}

      {/* Internal Tab Navigation */}
      <div className={styles.pmTabNav}>
        {[
          { id: 'dashboard', label: '📊 Dashboard' },
          { id: 'products',  label: '📦 Products' },
          { id: 'settings',  label: '⚙️ Settings' },
        ].map((tab) => (
          <button
            key={tab.id}
            className={`${styles.pmTabBtn} ${activeSection === tab.id ? styles.pmTabBtnActive : ''}`}
            onClick={() => setActiveSection(tab.id)}
          >
            {tab.label}
            {tab.id === 'products' && (
              <span className={styles.pmTabBadge}>{products.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Views */}
      <div className={styles.pmViewContent}>
        {activeSection === 'dashboard' && (
          <DashboardView products={products} onRestock={handleRestock} />
        )}
        {activeSection === 'products' && (
          <ProductTableView
            products={products}
            onEdit={handleEditClick}
            onDelete={handleDeleteProduct}
            onNewProduct={handleNewProduct}
            loading={dataLoading}
          />
        )}
        {activeSection === 'settings' && <SettingsView />}
      </div>

      {/* Slide-out Form Panel */}
      <ProductFormPanelEnhanced
        isOpen={isPanelOpen}
        onClose={() => { setIsPanelOpen(false); resetForm(); }}
        onSubmit={editingProductId ? handleUpdateProduct : handleAddProduct}
        editingProductId={editingProductId}
        loading={loading}
        productData={productData}
        setProductData={setProductData}
        imagePreview={imagePreview}
        setImagePreview={setImagePreview}
      />
    </div>
  );
}

export default ProductManagement;