import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, Package, Clock, CheckCircle, XCircle, Truck, CreditCard, User, AlertCircle, ShieldCheck } from 'lucide-react';
import { trackPublicOrder } from '../../services/orderApiService';
import styles from './TrackOrder.module.css';
import { useTheme } from '../../contexts/ThemeContext';

function TrackOrder() {
  const { theme } = useTheme();
  const isClassic = theme === 'dark';
  const navigate = useNavigate();
  const location = useLocation();
  
  // ========================================
  // STATE MANAGEMENT
  // ========================================
  const [orderIdInput, setOrderIdInput] = useState('');
  const [verifierInput, setVerifierInput] = useState('');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  // ========================================
  // SEARCH ORDER VIA MASKED SERVER ENDPOINT
  // ========================================
  const handleSearch = useCallback(async (orderIdVal = orderIdInput, verifierVal = verifierInput) => {
    const cleanOrderId = String(orderIdVal || '').trim();
    const cleanVerifier = String(verifierVal || '').trim();

    if (!cleanOrderId || !cleanVerifier) {
      setError('Please enter both your Order ID and Student ID (or Email / Verification Code).');
      return;
    }

    setLoading(true);
    setError('');
    setOrder(null);
    setSearched(true);

    try {
      const found = await trackPublicOrder({
        orderId: cleanOrderId,
        verifier: cleanVerifier,
      });

      if (!found) {
        setError('No matching order found. Please check your Order ID and Student ID / Email.');
        setLoading(false);
        return;
      }

      setOrder(found);
      setLoading(false);
    } catch (err) {
      console.error('Error searching order:', err);
      setError(err.message || 'An error occurred while searching. Please try again.');
      setLoading(false);
    }
  }, [orderIdInput, verifierInput]);

  // ========================================
  // AUTO-SEARCH IF ORDER ID & VERIFIER PROVIDED IN NAVIGATION STATE
  // ========================================
  useEffect(() => {
    if (location.state?.orderId) {
      const incomingId = location.state.orderId;
      const incomingVerifier = location.state.verifier || '';
      setOrderIdInput(incomingId);
      if (incomingVerifier) {
        setVerifierInput(incomingVerifier);
        handleSearch(incomingId, incomingVerifier);
      }
    }
  }, [location.state, handleSearch]);

  // ========================================
  // FORMAT DATE
  // ========================================
  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    
    let date;
    if (timestamp.toDate) {
      date = timestamp.toDate();
    } else {
      date = new Date(timestamp);
    }

    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // ========================================
  // GET STATUS INFO
  // ========================================
  const getStatusInfo = (status) => {
    switch (status) {
      case 'Pending':
        return {
          icon: <Clock size={24} />,
          color: '#E66B3D',
          bgColor: '#fffbeb',
          label: 'Pending',
          description: 'Your order has been received and is awaiting payment confirmation.'
        };
      case 'Paid':
        return {
          icon: <CreditCard size={24} />,
          color: '#10b981',
          bgColor: '#ecfdf5',
          label: 'Payment Confirmed',
          description: 'Payment has been confirmed. Your order is being prepared.'
        };
      case 'Ongoing':
        return {
          icon: <Truck size={24} />,
          color: '#3b82f6',
          bgColor: '#eff6ff',
          label: 'In Progress',
          description: 'Your order is currently being processed and prepared for pickup.'
        };
      case 'Completed':
        return {
          icon: <CheckCircle size={24} />,
          color: '#10b981',
          bgColor: '#ecfdf5',
          label: 'Completed',
          description: 'Your order has been completed and is ready for pickup or has been delivered.'
        };
      case 'Cancelled':
        return {
          icon: <XCircle size={24} />,
          color: '#ef4444',
          bgColor: '#fef2f2',
          label: 'Cancelled',
          description: 'This order has been cancelled. Please contact support for more information.'
        };
      default:
        return {
          icon: <Package size={24} />,
          color: '#94a3b8',
          bgColor: '#f1f5f9',
          label: status,
          description: 'Order status information.'
        };
    }
  };

  // ========================================
  // GET PROGRESS PERCENTAGE
  // ========================================
  const getProgressPercentage = (status) => {
    switch (status) {
      case 'Pending': return 25;
      case 'Paid':
      case 'Online Paid': return 50;
      case 'Ongoing': return 75;
      case 'Completed':
      case 'Claimed': return 100;
      case 'Cancelled': return 0;
      default: return 25;
    }
  };

  // ========================================
  // RENDER SEARCH FORM
  // ========================================
  const renderSearchForm = () => (
    <div className={styles.searchSection}>
      <div className={styles.searchCard}>
        <div className={styles.searchHeader}>
          <div className={styles.searchIcon}>
            <Search size={28} />
          </div>
          <h2 className={styles.searchTitle}>Track Your Order</h2>
          <p className={styles.searchSubtitle}>
            Enter your Order ID together with your Student ID, Email, or Verification Code to protect student privacy
          </p>
        </div>

        <div className={styles.searchForm}>
          {/* Order ID Input */}
          <div className={styles.searchInputWrapper}>
            <Search className={styles.searchInputIcon} size={18} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Order ID (e.g., ORD-DB-0001)"
              value={orderIdInput}
              onChange={(e) => setOrderIdInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              aria-label="Order ID"
            />
          </div>

          {/* Verifier Input */}
          <div className={styles.searchInputWrapper}>
            <ShieldCheck className={styles.searchInputIcon} size={18} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Student ID, Email, or Verification Code"
              value={verifierInput}
              onChange={(e) => setVerifierInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              aria-label="Student ID, Email, or Verification Code"
            />
          </div>

          {/* Search Button */}
          <button
            className={styles.searchButton}
            onClick={() => handleSearch()}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className={styles.spinner} />
                Searching...
              </>
            ) : (
              <>
                <Search size={18} />
                Track Order
              </>
            )}
          </button>

          {/* Error Message */}
          {error && (
            <div className={styles.errorMessage}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ========================================
  // RENDER ORDER DETAILS
  // ========================================
  const renderOrderDetails = () => {
    if (!order) return null;

    const statusInfo = getStatusInfo(order.orderStatus);
    const progress = getProgressPercentage(order.orderStatus);

    return (
      <div className={styles.orderDetailsSection}>
        {/* Status Card */}
        <div className={styles.statusCard} style={{ borderColor: statusInfo.color }}>
          <div className={styles.statusHeader}>
            <div className={styles.statusIconWrapper} style={{ backgroundColor: statusInfo.bgColor, color: statusInfo.color }}>
              {statusInfo.icon}
            </div>
            <div className={styles.statusInfo}>
              <h3 className={styles.statusLabel}>{statusInfo.label}</h3>
              <p className={styles.statusDescription}>{statusInfo.description}</p>
            </div>
          </div>

          {/* Progress Bar */}
          {order.orderStatus !== 'Cancelled' && (
            <div className={styles.progressSection}>
              <div className={styles.progressBar}>
                <div 
                  className={styles.progressFill} 
                  style={{ width: `${progress}%`, backgroundColor: statusInfo.color }}
                />
              </div>
              <span className={styles.progressText}>{progress}% Complete</span>
            </div>
          )}

          {/* Timeline */}
          <div className={styles.timeline}>
            <div className={`${styles.timelineItem} ${['Pending', 'Paid', 'Ongoing', 'Completed'].includes(order.orderStatus) ? styles.timelineItemActive : ''}`}>
              <div className={styles.timelineDot} />
              <div className={styles.timelineContent}>
                <span className={styles.timelineLabel}>Order Placed</span>
                <span className={styles.timelineDate}>{formatDate(order.dateOrdered)}</span>
              </div>
            </div>

            <div className={`${styles.timelineItem} ${['Paid', 'Ongoing', 'Completed'].includes(order.orderStatus) ? styles.timelineItemActive : ''}`}>
              <div className={styles.timelineDot} />
              <div className={styles.timelineContent}>
                <span className={styles.timelineLabel}>Payment Confirmed</span>
                <span className={styles.timelineDate}>{order.orderStatus === 'Pending' ? 'Pending' : 'Confirmed'}</span>
              </div>
            </div>

            <div className={`${styles.timelineItem} ${['Ongoing', 'Completed'].includes(order.orderStatus) ? styles.timelineItemActive : ''}`}>
              <div className={styles.timelineDot} />
              <div className={styles.timelineContent}>
                <span className={styles.timelineLabel}>Processing</span>
                <span className={styles.timelineDate}>{['Ongoing', 'Completed'].includes(order.orderStatus) ? 'In Progress' : 'Waiting'}</span>
              </div>
            </div>

            <div className={`${styles.timelineItem} ${order.orderStatus === 'Completed' ? styles.timelineItemActive : ''}`}>
              <div className={styles.timelineDot} />
              <div className={styles.timelineContent}>
                <span className={styles.timelineLabel}>Ready for Pickup</span>
                <span className={styles.timelineDate}>{order.orderStatus === 'Completed' ? 'Ready' : 'Waiting'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Order Information Grid */}
        <div className={styles.infoGrid}>
          {/* Order Details Card */}
          <div className={styles.infoCard}>
            <div className={styles.infoCardHeader}>
              <Package size={20} />
              <h3 className={styles.infoCardTitle}>Order Details</h3>
            </div>
            <div className={styles.infoCardBody}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Order ID</span>
                <span className={styles.infoValue}>{order.orderId}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Product</span>
                <span className={styles.infoValue}>{order.productInfo?.productName}</span>
              </div>
              {order.productInfo?.size !== 'N/A' && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Size</span>
                  <span className={styles.infoValue}>{order.productInfo?.size}</span>
                </div>
              )}
              {order.productInfo?.color !== 'N/A' && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Color</span>
                  <span className={styles.infoValue}>{order.productInfo?.color}</span>
                </div>
              )}
              {order.productInfo?.customVariations &&
                Object.entries(order.productInfo.customVariations).map(([varType, optVal]) => (
                  <div key={varType} className={styles.infoRow}>
                    <span className={styles.infoLabel}>{varType}</span>
                    <span className={styles.infoValue}>{optVal}</span>
                  </div>
                ))}
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Quantity</span>
                <span className={styles.infoValue}>{order.productInfo?.quantity}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Unit Price</span>
                <span className={styles.infoValue}>₱{Number(order.productInfo?.pricePerUnit || 0).toFixed(2)}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Total Price</span>
                <span className={styles.infoValueHighlight}>₱{Number(order.productInfo?.totalPrice || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Customer Information Card (Privacy-Masked) */}
          <div className={styles.infoCard}>
            <div className={styles.infoCardHeader}>
              <User size={20} />
              <h3 className={styles.infoCardTitle}>Customer Information</h3>
            </div>
            <div className={styles.infoCardBody}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Name</span>
                <span className={styles.infoValue}>{order.customerInfo?.fullName}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>School ID</span>
                <span className={styles.infoValue}>{order.customerInfo?.schoolID}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Program</span>
                <span className={styles.infoValue}>{order.customerInfo?.bachelorDegree}</span>
              </div>
              {order.customerInfo?.section && (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Year Level</span>
                  <span className={styles.infoValue}>{order.customerInfo?.section}</span>
                </div>
              )}
            </div>
          </div>

          {/* Payment Information Card */}
          <div className={styles.infoCard}>
            <div className={styles.infoCardHeader}>
              <CreditCard size={20} />
              <h3 className={styles.infoCardTitle}>Payment Information</h3>
            </div>
            <div className={styles.infoCardBody}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Payment Method</span>
                <span className={styles.infoValue}>{order.paymentInfo?.paymentMethod}</span>
              </div>
              {order.paymentInfo?.paymentMethod === 'Online' && (
                <>
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>Payment Type</span>
                    <span className={styles.infoValue}>{order.paymentInfo?.onlinePaymentType}</span>
                  </div>
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>Reference Number</span>
                    <span className={styles.infoValue}>{order.paymentInfo?.referenceNumber}</span>
                  </div>
                </>
              )}
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Order Date</span>
                <span className={styles.infoValue}>{formatDate(order.dateOrdered)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className={styles.actionButtons}>
          <button
            className={styles.searchAgainButton}
            onClick={() => {
              setOrder(null);
              setOrderIdInput('');
              setVerifierInput('');
              setSearched(false);
              setError('');
            }}
          >
            <Search size={18} />
            Track Another Order
          </button>
          <button className={styles.homeButton} onClick={() => navigate('/')}>
            Back to Home
          </button>
        </div>
      </div>
    );
  };

  // ========================================
  // RENDER NO RESULTS
  // ========================================
  const renderNoResults = () => {
    if (!searched || order || loading) return null;

    return (
      <div className={styles.noResults}>
        <div className={styles.noResultsIcon}>
          <Package size={48} />
        </div>
        <h3 className={styles.noResultsTitle}>No Order Found</h3>
        <p className={styles.noResultsText}>
          We couldn&apos;t find an order matching your Order ID and verification details. Please double-check and try again.
        </p>
      </div>
    );
  };

  // ========================================
  // RENDER
  // ========================================
  return (
    <div className={`${styles.container} ${isClassic ? styles.trackOrderClassic : ''}`}>
      {/* Ethnic Tribal Gold Border (Classic Theme Only) */}
      {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}

      {/* Top Bar */}
      <div className={styles.topBar}>
        <p className={styles.eyebrow}>Order Tracking</p>
        <h1 className={styles.title}>Track My Order</h1>
        <p className={styles.subtitle}>Check the status of your order in real-time</p>
      </div>

      <div className={styles.content}>
        {renderSearchForm()}
        {renderNoResults()}
        {renderOrderDetails()}
      </div>
    </div>
  );
}

export default TrackOrder;
