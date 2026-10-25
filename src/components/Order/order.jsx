import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '../../firebase/firebaseConfig';
import { collection, addDoc, onSnapshot, Timestamp, doc, updateDoc, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { 
  User, 
  CreditCard, 
  Package, 
  CheckCircle, 
  Copy, 
  Check, 
  ArrowLeft, 
  ShieldCheck, 
  Sparkles,
  ShoppingBag,
  ExternalLink,
  MapPin,
  Mail,
  Phone,
  Hash,
  AlertCircle
} from 'lucide-react';
import styles from './Order.module.css';
import { useTheme } from '../../contexts/ThemeContext';

function Order(props) {
  const { theme } = useTheme();
  const isClassic = theme === 'dark';
  const location = useLocation();
  const navigate = useNavigate();
  const selectedProduct = location.state?.selectedProduct;
  const editingOrder = props.editingOrder;
  const hasLoadedEditData = useRef(false);

  // ========================================
  // STATE MANAGEMENT
  // ========================================
  const [products, setProducts] = useState([]);
  const [selectedProductData, setSelectedProductData] = useState(null);
  
  const [formData, setFormData] = useState({
    fullName: '',
    bachelorDegree: '',
    section: '',
    address: '',
    email: '',
    phoneNumber: '',
    schoolID: '',
    productId: selectedProduct?.productId || '',
    productName: selectedProduct?.productName || '',
    size: '',
    color: '',
    quantity: 1,
    paymentMethod: 'Cash',
    onlinePaymentType: '',
    referenceNumber: '',
  });

  const [loading, setLoading] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [generatedOrderId, setGeneratedOrderId] = useState('');
  const [errors, setErrors] = useState({});
  const [copiedId, setCopiedId] = useState(false);

  // ========================================
  // FETCH PRODUCTS FROM FIREBASE
  // ========================================
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'products'), (snapshot) => {
      const productsData = snapshot.docs.map((doc) => ({
        productId: doc.id,
        ...doc.data(),
      }));
      setProducts(productsData);

      if (selectedProduct) {
        setSelectedProductData(selectedProduct);
      }
    });

    return () => unsubscribe();
  }, [selectedProduct]);

  // ========================================
  // HANDLE PRODUCT SELECTION CHANGE
  // ========================================
  const handleProductChange = (e) => {
    const productId = e.target.value;
    const product = products.find(p => p.productId === productId);
    
    setSelectedProductData(product);
    setFormData(prev => ({
      ...prev,
      productId: productId,
      productName: product?.productName || '',
      size: '',
      color: '',
    }));
  };

  // ========================================
  // HANDLE INPUT CHANGES
  // ========================================
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  // ========================================
  // FORM VALIDATION
  // ========================================
  const validateForm = () => {
    const newErrors = {};

    if (!formData.fullName.trim()) newErrors.fullName = 'Full name is required';
    if (!formData.bachelorDegree) newErrors.bachelorDegree = 'Degree program is required';
    if (!formData.section) newErrors.section = 'Year level is required';
    if (!formData.address.trim()) newErrors.address = 'Campus or complete delivery address is required';
    if (!formData.email.trim()) newErrors.email = 'Email is required';
    if (!formData.schoolID.trim()) newErrors.schoolID = 'Valid Student / School ID is required';
    if (!formData.phoneNumber.trim()) newErrors.phoneNumber = 'Active mobile number is required';
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (formData.email && !emailRegex.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (formData.phoneNumber && formData.phoneNumber.length < 10) {
      newErrors.phoneNumber = 'Please enter a valid 11-digit mobile number';
    }

    if (!formData.productId) newErrors.productId = 'Please select a product';
    if (selectedProductData?.sizeOptions?.length > 0 && !formData.size) {
      newErrors.size = 'Please select a garment size';
    }
    if (selectedProductData?.colorVariations?.length > 0 && !formData.color) {
      newErrors.color = 'Please choose a color variation';
    }
    if (!formData.quantity || formData.quantity < 1) {
      newErrors.quantity = 'Quantity must be at least 1';
    }
    if (selectedProductData && formData.quantity > selectedProductData.stockAvailable) {
      newErrors.quantity = `Only ${selectedProductData.stockAvailable} unit(s) available in current inventory`;
    }

    if (formData.paymentMethod === 'Online') {
      if (!formData.onlinePaymentType) {
        newErrors.onlinePaymentType = 'Select GCash or PayMaya';
      }
      if (!formData.referenceNumber.trim()) {
        newErrors.referenceNumber = 'Transaction reference number is required';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ========================================
  // GENERATE UNIQUE ORDER ID (Sequential Format: ORD-DB-0001)
  // ========================================
  const generateOrderId = async () => {
    try {
      const ordersRef = collection(db, 'orders');
      const q = query(ordersRef, orderBy('createdAt', 'desc'), limit(1));
      const querySnapshot = await getDocs(q);
      
      let nextNumber = 1;
      
      if (!querySnapshot.empty) {
        const lastOrder = querySnapshot.docs[0].data();
        const lastOrderId = lastOrder.orderId;
        
        if (lastOrderId && lastOrderId.startsWith('ORD-DB-')) {
          const lastNumber = parseInt(lastOrderId.split('-')[2]);
          if (!isNaN(lastNumber)) {
            nextNumber = lastNumber + 1;
          }
        }
      }
      
      const formattedNumber = String(nextNumber).padStart(4, '0');
      return `ORD-DB-${formattedNumber}`;
    } catch (error) {
      console.error('Error generating order ID:', error);
      const timestamp = Date.now();
      return `ORD-DB-${timestamp}`;
    }
  };

  // ========================================
  // CALCULATE TOTAL PRICE
  // ========================================
  const calculateTotal = () => {
    if (!selectedProductData) return 0;
    return selectedProductData.price * formData.quantity;
  };

  // ========================================
  // COPY ORDER ID TO CLIPBOARD
  // ========================================
  const copyOrderId = () => {
    if (!generatedOrderId) return;
    navigator.clipboard.writeText(generatedOrderId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2200);
  };

  // ========================================
  // HANDLE FORM SUBMISSION
  // ========================================
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      const firstError = Object.values(errors)[0];
      alert(`Please review the form: ${firstError || 'Ensure all required fields are filled'}`);
      return;
    }

    setLoading(true);

    try {
      const orderId = editingOrder ? editingOrder.orderId : await generateOrderId();
      const docId = editingOrder ? editingOrder.docId : null;

      const orderData = {
        orderId: orderId,
        customerInfo: {
          fullName: formData.fullName.trim(),
          bachelorDegree: formData.bachelorDegree,
          section: formData.section,
          address: formData.address.trim(),
          email: formData.email.trim(),
          phoneNumber: formData.phoneNumber.trim(),
          schoolID: formData.schoolID.trim(),
        },
        productInfo: {
          productId: formData.productId,
          productName: formData.productName,
          size: formData.size || 'N/A',
          color: formData.color || 'N/A',
          quantity: parseInt(formData.quantity),
          pricePerUnit: selectedProductData?.price || 0,
          totalPrice: calculateTotal(),
        },
        paymentInfo: {
          paymentMethod: formData.paymentMethod,
          onlinePaymentType: formData.paymentMethod === 'Online' ? formData.onlinePaymentType : null,
          referenceNumber: formData.paymentMethod === 'Online' ? formData.referenceNumber.trim() : null,
        },
        orderStatus: editingOrder ? editingOrder.orderStatus : 'Pending',
        dateOrdered: editingOrder ? editingOrder.dateOrdered : Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      if (editingOrder && docId) {
        const newQuantity = parseInt(formData.quantity);
        const productsSnapshot = await getDocs(collection(db, 'products'));
        const productDoc = productsSnapshot.docs.find(
          doc => doc.data().productId === formData.productId
        );

        if (productDoc) {
          const currentStock = productDoc.data().stockAvailable || 0;
          if (currentStock < newQuantity) {
            alert(`❌ Insufficient stock! Only ${currentStock} item(s) available.`);
            setLoading(false);
            return;
          }
        }

        await updateDoc(doc(db, 'orders', docId), orderData);
        alert('✅ Order updated successfully!');
        
        if (props.onSuccess) {
          props.onSuccess();
        }
      } else {
        const productsSnapshot = await getDocs(collection(db, 'products'));
        const productDoc = productsSnapshot.docs.find(
          doc => doc.data().productId === formData.productId
        );

        if (!productDoc) {
          alert('❌ Product was not found in catalog. Please reload.');
          setLoading(false);
          return;
        }

        const currentStock = productDoc.data().stockAvailable || 0;
        const orderQuantity = parseInt(formData.quantity);

        if (currentStock < orderQuantity) {
          alert(`❌ Insufficient stock! Only ${currentStock} items available.`);
          setLoading(false);
          return;
        }

        orderData.createdAt = Timestamp.now();
        await addDoc(collection(db, 'orders'), orderData);
        
        setGeneratedOrderId(orderId);
        setSubmitSuccess(true);
      }

      setLoading(false);

      if (!editingOrder) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

    } catch (error) {
      console.error('Error submitting order:', error);
      alert(`Error submitting order: ${error.message}. Please try again.`);
      setLoading(false);
    }
  };

  // ========================================
  // RESET FORM FOR NEW ORDER
  // ========================================
  const handleNewOrder = () => {
    if (editingOrder && props.onSuccess) {
      props.onSuccess();
      return;
    }
    
    setSubmitSuccess(false);
    setGeneratedOrderId('');
    setFormData({
      fullName: '',
      bachelorDegree: '',
      section: '',
      address: '',
      email: '',
      schoolID: '',
      phoneNumber: '',
      productId: '',
      productName: '',
      size: '',
      color: '',
      quantity: 1,
      paymentMethod: 'Cash',
      onlinePaymentType: '',
      referenceNumber: '',
    });
    setSelectedProductData(null);
    setErrors({});
  };

  // ========================================
  // HANDLE EDITING ORDER PROP
  // ========================================
  useEffect(() => {
    if (props.editingOrder && !hasLoadedEditData.current && products.length > 0) {
      const order = props.editingOrder;
      
      setFormData({
        fullName: order.customerInfo?.fullName || '',
        bachelorDegree: order.customerInfo?.bachelorDegree || '',
        section: order.customerInfo?.section || '',
        address: order.customerInfo?.address || '',
        email: order.customerInfo?.email || '',
        phoneNumber: order.customerInfo?.phoneNumber || '',
        schoolID: order.customerInfo?.schoolID || '',
        productId: order.productInfo?.productId || '',
        productName: order.productInfo?.productName || '',
        size: order.productInfo?.size || '',
        color: order.productInfo?.color || '',
        quantity: order.productInfo?.quantity || 1,
        paymentMethod: order.paymentInfo?.paymentMethod || 'Cash',
        onlinePaymentType: order.paymentInfo?.onlinePaymentType || '',
        referenceNumber: order.paymentInfo?.referenceNumber || '',
      });
      
      const product = products.find(p => p.productId === order.productInfo?.productId);
      if (product) {
        setSelectedProductData(product);
      }
      
      hasLoadedEditData.current = true;
    }
    
    return () => {
      if (!props.editingOrder) {
        hasLoadedEditData.current = false;
      }
    };
  }, [props.editingOrder, products]);

  // ========================================
  // RENDER: SUCCESS SCREEN
  // ========================================
  if (submitSuccess) {
    return (
      <div className={styles.container}>
        <div className={styles.successWrapper}>
          <div className={styles.successCard}>
            <div className={styles.successIconWrapper}>
              <div className={styles.successIcon}>
                <CheckCircle size={44} strokeWidth={2.4} />
              </div>
            </div>

            <div className={styles.badgeSuccess}>SSG Official Receipt Issued</div>
            <h1 className={styles.successTitle}>Order Placed Successfully!</h1>
            <p className={styles.successMessage}>
              Your purchase reservation is officially recorded in the Supreme Student Government portal.
            </p>
            
            <div className={styles.orderIdBox}>
              <div className={styles.orderIdHeader}>
                <span className={styles.orderIdLabel}>Official Tracking Reference</span>
                <span className={styles.orderIdStatus}>Status: Pending Review</span>
              </div>
              <div className={styles.orderIdRow}>
                <span className={styles.orderId}>{generatedOrderId}</span>
                <button 
                  type="button" 
                  onClick={copyOrderId} 
                  className={styles.copyButton}
                  title="Copy Reference ID"
                >
                  {copiedId ? (
                    <>
                      <Check size={16} /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={16} /> Copy ID
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className={styles.orderReceiptSummary}>
              <div className={styles.receiptRow}>
                <span className={styles.receiptLabel}>Student Name</span>
                <span className={styles.receiptValue}>{formData.fullName}</span>
              </div>
              <div className={styles.receiptRow}>
                <span className={styles.receiptLabel}>Program & Section</span>
                <span className={styles.receiptValue}>{formData.bachelorDegree} • {formData.section}</span>
              </div>
              <div className={styles.receiptRow}>
                <span className={styles.receiptLabel}>Item Ordered</span>
                <span className={styles.receiptValue}>{formData.productName} ({formData.quantity}x)</span>
              </div>
              <div className={styles.receiptRow}>
                <span className={styles.receiptLabel}>Payment Method</span>
                <span className={styles.receiptValue}>
                  {formData.paymentMethod === 'Online' 
                    ? `Online (${formData.onlinePaymentType || 'Verified'})` 
                    : 'Cash on Arrival'}
                </span>
              </div>
              <div className={`${styles.receiptRow} ${styles.receiptTotalRow}`}>
                <span className={styles.receiptLabel}>Total Amount Payable</span>
                <span className={styles.receiptPrice}>₱{calculateTotal().toFixed(2)}</span>
              </div>
            </div>

            <div className={styles.claimInstructions}>
              <ShieldCheck size={20} className={styles.claimIcon} />
              <p className={styles.successNote}>
                Present this <strong>Order ID</strong> along with your valid Student ID to any SSG officer at the SSG Operations Office during distribution hours.
              </p>
            </div>

            <div className={styles.successButtons}>
              <button 
                onClick={() => navigate('/track-order', { state: { orderId: generatedOrderId } })} 
                className={styles.trackOrderButton}
              >
                Track Order Status <ExternalLink size={16} />
              </button>
              <button onClick={handleNewOrder} className={styles.newOrderButton}>
                Place Another Order
              </button>
              <button onClick={() => navigate('/')} className={styles.homeButton}>
                <ArrowLeft size={16} /> Return to Home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========================================
  // RENDER: ORDER FORM
  // ========================================
  return (
    <div className={`${styles.container} ${editingOrder ? styles.modalMode : ''} ${isClassic ? styles.orderClassic : ''}`}>
      {/* Ethnic Tribal Gold Border (Classic Theme Only) */}
      {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}

      {/* Top Bar Header */}
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <div className={styles.eyebrowBadge}>
            <Sparkles size={13} />
            <span>SSG Merchandise Bureau</span>
          </div>
          <h1 className={styles.title}>
            {editingOrder ? 'Modify Student Order' : 'University Merchandise Order'}
          </h1>
          <p className={styles.subtitle}>
            Official student merchandise acquisition & reservation service • CTU Daanbantayan SSG
          </p>
        </div>
        
        {editingOrder ? (
          <button 
            type="button" 
            className={styles.modalCloseBtn}
            onClick={props.onCancel || handleNewOrder}
            title="Close"
          >
            ×
          </button>
        ) : (
          <button 
            type="button" 
            className={styles.backBtn}
            onClick={() => navigate('/')}
          >
            <ArrowLeft size={16} /> Back to Catalog
          </button>
        )}
      </header>

      {/* Main 2-Column Content */}
      <div className={styles.formWrapper}>
        <div className={styles.layoutGrid}>
          {/* LEFT COLUMN: Input Sections */}
          <div className={styles.formColumn}>
            <form onSubmit={handleSubmit} className={styles.form} noValidate>
              
              {/* STEP 1: CUSTOMER INFORMATION */}
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitleGroup}>
                    <div className={styles.sectionIcon}>
                      <User size={18} />
                    </div>
                    <div>
                      <h2 className={styles.sectionTitle}>Student Credentials</h2>
                      <p className={styles.sectionSubtitle}>Personal and academic affiliation details</p>
                    </div>
                  </div>
                  <span className={styles.sectionBadge}>Step 01</span>
                </div>

                <div className={styles.sectionBody}>
                  {/* Full Name */}
                  <div className={styles.formGroup}>
                    <label className={styles.label}>
                      Full Name <span className={styles.reqStar}>*</span>
                    </label>
                    <div className={styles.inputWrapper}>
                      <input
                        type="text"
                        name="fullName"
                        value={formData.fullName}
                        onChange={handleChange}
                        placeholder="e.g., Juan Dela Cruz"
                        className={`${styles.input} ${errors.fullName ? styles.inputError : ''}`}
                      />
                    </div>
                    {errors.fullName && <span className={styles.errorText}><AlertCircle size={13} /> {errors.fullName}</span>}
                  </div>

                  {/* Student ID */}
                  <div className={styles.formGroup}>
                    <label className={styles.label}>
                      Student ID Number <span className={styles.reqStar}>*</span>
                    </label>
                    <div className={styles.inputWrapper}>
                      <Hash size={16} className={styles.fieldIcon} />
                      <input
                        type="text"
                        name="schoolID"
                        value={formData.schoolID}
                        onChange={handleChange}
                        placeholder="e.g., 2024-10842"
                        className={`${styles.input} ${styles.hasIcon} ${errors.schoolID ? styles.inputError : ''}`}
                      />
                    </div>
                    {errors.schoolID && <span className={styles.errorText}><AlertCircle size={13} /> {errors.schoolID}</span>}
                  </div>

                  {/* Degree & Year Level */}
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>
                        Degree Program <span className={styles.reqStar}>*</span>
                      </label>
                      <select
                        name="bachelorDegree"
                        value={formData.bachelorDegree}
                        onChange={handleChange}
                        className={`${styles.select} ${errors.bachelorDegree ? styles.inputError : ''}`}
                      >
                        <option value="">Select Degree Program</option>
                        <option value="BSIT">BSIT - Information Technology</option>
                        <option value="BSCS">BSCS - Computer Science</option>
                        <option value="BSHM">BSHM - Hospitality Management</option>
                        <option value="BSED">BSED - Secondary Education</option>
                        <option value="BEED">BEED - Elementary Education</option>
                        <option value="BSFI">BSFI - Fisheries</option>
                        <option value="BSIE">BSIE - Industrial Engineering</option>
                        <option value="BIT-AUTO">BIT - Automotive Technology</option>
                        <option value="BIT-ELEC">BIT - Electrical Technology</option>
                        <option value="BIT-ET">BIT - Electronics Technology</option>
                      </select>
                      {errors.bachelorDegree && <span className={styles.errorText}><AlertCircle size={13} /> {errors.bachelorDegree}</span>}
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.label}>
                        Year Level <span className={styles.reqStar}>*</span>
                      </label>
                      <select
                        name="section"
                        value={formData.section}
                        onChange={handleChange}
                        className={`${styles.select} ${errors.section ? styles.inputError : ''}`}
                      >
                        <option value="">Select Year</option>
                        <option value="1st Year">1st Year</option>
                        <option value="2nd Year">2nd Year</option>
                        <option value="3rd Year">3rd Year</option>
                        <option value="4th Year">4th Year</option>
                      </select>
                      {errors.section && <span className={styles.errorText}><AlertCircle size={13} /> {errors.section}</span>}
                    </div>
                  </div>

                  {/* Complete Campus / Delivery Address */}
                  <div className={styles.formGroup}>
                    <label className={styles.label}>
                      Campus Dorm / Residence Address <span className={styles.reqStar}>*</span>
                    </label>
                    <div className={styles.inputWrapper}>
                      <MapPin size={16} className={styles.fieldIcon} />
                      <input
                        type="text"
                        name="address"
                        value={formData.address}
                        onChange={handleChange}
                        placeholder="e.g., Poblacion, Daanbantayan / Campus Dormitory"
                        className={`${styles.input} ${styles.hasIcon} ${errors.address ? styles.inputError : ''}`}
                      />
                    </div>
                    {errors.address && <span className={styles.errorText}><AlertCircle size={13} /> {errors.address}</span>}
                  </div>

                  {/* Email & Phone Contact */}
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>
                        Institutional / Personal Email <span className={styles.reqStar}>*</span>
                      </label>
                      <div className={styles.inputWrapper}>
                        <Mail size={16} className={styles.fieldIcon} />
                        <input
                          type="email"
                          name="email"
                          value={formData.email}
                          onChange={handleChange}
                          placeholder="student@ctu.edu.ph"
                          className={`${styles.input} ${styles.hasIcon} ${errors.email ? styles.inputError : ''}`}
                        />
                      </div>
                      {errors.email && <span className={styles.errorText}><AlertCircle size={13} /> {errors.email}</span>}
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.label}>
                        Active Mobile Number <span className={styles.reqStar}>*</span>
                      </label>
                      <div className={styles.inputWrapper}>
                        <Phone size={16} className={styles.fieldIcon} />
                        <input
                          type="tel"
                          name="phoneNumber"
                          value={formData.phoneNumber}
                          onChange={handleChange}
                          placeholder="0912 345 6789"
                          className={`${styles.input} ${styles.hasIcon} ${errors.phoneNumber ? styles.inputError : ''}`}
                        />
                      </div>
                      {errors.phoneNumber && <span className={styles.errorText}><AlertCircle size={13} /> {errors.phoneNumber}</span>}
                    </div>
                  </div>
                </div>
              </section>

              {/* STEP 2: PRODUCT SELECTION & VARIATIONS */}
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitleGroup}>
                    <div className={styles.sectionIcon}>
                      <Package size={18} />
                    </div>
                    <div>
                      <h2 className={styles.sectionTitle}>Product & Customization</h2>
                      <p className={styles.sectionSubtitle}>Select size, colorway, and order quantity</p>
                    </div>
                  </div>
                  <span className={styles.sectionBadge}>Step 02</span>
                </div>

                <div className={styles.sectionBody}>
                  {/* Product Dropdown */}
                  <div className={styles.formGroup}>
                    <label className={styles.label}>
                      Catalog Item <span className={styles.reqStar}>*</span>
                    </label>
                    <select
                      name="productId"
                      value={formData.productId}
                      onChange={handleProductChange}
                      disabled={!!selectedProduct}
                      className={`${styles.select} ${errors.productId ? styles.inputError : ''}`}
                    >
                      <option value="">Choose an SSG merchandise item</option>
                      {products.map((product) => (
                        <option key={product.productId} value={product.productId}>
                          {product.productName} — ₱{product.price} ({product.stockAvailable} in stock)
                        </option>
                      ))}
                    </select>
                    {errors.productId && <span className={styles.errorText}><AlertCircle size={13} /> {errors.productId}</span>}
                  </div>

                  {/* Size & Color Selections */}
                  <div className={styles.formRow}>
                    {selectedProductData?.sizeOptions?.length > 0 && (
                      <div className={styles.formGroup}>
                        <label className={styles.label}>
                          Size Specification <span className={styles.reqStar}>*</span>
                        </label>
                        <select
                          name="size"
                          value={formData.size}
                          onChange={handleChange}
                          className={`${styles.select} ${errors.size ? styles.inputError : ''}`}
                        >
                          <option value="">Select Size (XS - 3XL)</option>
                          {selectedProductData.sizeOptions.map((size, idx) => (
                            <option key={idx} value={size}>{size}</option>
                          ))}
                        </select>
                        {errors.size && <span className={styles.errorText}><AlertCircle size={13} /> {errors.size}</span>}
                      </div>
                    )}

                    {selectedProductData?.colorVariations?.length > 0 && (
                      <div className={styles.formGroup}>
                        <label className={styles.label}>
                          Color Option <span className={styles.reqStar}>*</span>
                        </label>
                        <select
                          name="color"
                          value={formData.color}
                          onChange={handleChange}
                          className={`${styles.select} ${errors.color ? styles.inputError : ''}`}
                        >
                          <option value="">Select Color Variation</option>
                          {selectedProductData.colorVariations.map((color, idx) => (
                            <option key={idx} value={color}>{color}</option>
                          ))}
                        </select>
                        {errors.color && <span className={styles.errorText}><AlertCircle size={13} /> {errors.color}</span>}
                      </div>
                    )}
                  </div>

                  {/* Quantity Input */}
                  <div className={styles.formGroup}>
                    <div className={styles.labelRow}>
                      <label className={styles.label}>
                        Order Quantity <span className={styles.reqStar}>*</span>
                      </label>
                      {selectedProductData && (
                        <span className={styles.stockNotice}>
                          Current Stock: <strong>{selectedProductData.stockAvailable} units</strong>
                        </span>
                      )}
                    </div>
                    <div className={styles.quantityControl}>
                      <input
                        type="number"
                        name="quantity"
                        value={formData.quantity}
                        onChange={handleChange}
                        min="1"
                        max={selectedProductData?.stockAvailable || 999}
                        className={`${styles.input} ${errors.quantity ? styles.inputError : ''}`}
                      />
                    </div>
                    {errors.quantity && <span className={styles.errorText}><AlertCircle size={13} /> {errors.quantity}</span>}
                  </div>
                </div>
              </section>

              {/* STEP 3: PAYMENT METHOD */}
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitleGroup}>
                    <div className={styles.sectionIcon}>
                      <CreditCard size={18} />
                    </div>
                    <div>
                      <h2 className={styles.sectionTitle}>Payment & Settlement</h2>
                      <p className={styles.sectionSubtitle}>Choose cash on pickup or digital wallet payment</p>
                    </div>
                  </div>
                  <span className={styles.sectionBadge}>Step 03</span>
                </div>

                <div className={styles.sectionBody}>
                  <div className={styles.paymentCardGrid}>
                    <label className={`${styles.paymentTile} ${formData.paymentMethod === 'Cash' ? styles.paymentTileActive : ''}`}>
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="Cash"
                        checked={formData.paymentMethod === 'Cash'}
                        onChange={handleChange}
                        className={styles.hiddenRadio}
                      />
                      <div className={styles.paymentTileHeader}>
                        <span className={styles.tileTitle}>Cash on Claiming</span>
                        <span className={styles.tilePill}>In-Person</span>
                      </div>
                      <p className={styles.tileDesc}>
                        Settle your payment upon inspecting and claiming your ordered merchandise at the SSG Office.
                      </p>
                    </label>

                    <label className={`${styles.paymentTile} ${formData.paymentMethod === 'Online' ? styles.paymentTileActive : ''}`}>
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="Online"
                        checked={formData.paymentMethod === 'Online'}
                        onChange={handleChange}
                        className={styles.hiddenRadio}
                      />
                      <div className={styles.paymentTileHeader}>
                        <span className={styles.tileTitle}>Digital E-Wallet</span>
                        <span className={styles.tilePillSpecial}>Instant Fast-Track</span>
                      </div>
                      <p className={styles.tileDesc}>
                        Pay upfront via GCash or Maya and provide your reference number for instant clearance.
                      </p>
                    </label>
                  </div>

                  {/* Online Payment Breakdown */}
                  {formData.paymentMethod === 'Online' && (
                    <div className={styles.onlineDetailsPanel}>
                      <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                          <label className={styles.label}>
                            E-Wallet Provider <span className={styles.reqStar}>*</span>
                          </label>
                          <select
                            name="onlinePaymentType"
                            value={formData.onlinePaymentType}
                            onChange={handleChange}
                            className={`${styles.select} ${errors.onlinePaymentType ? styles.inputError : ''}`}
                          >
                            <option value="">Choose Provider</option>
                            <option value="GCash">GCash (09XX-XXX-XXXX)</option>
                            <option value="PayMaya">Maya / PayMaya</option>
                          </select>
                          {errors.onlinePaymentType && <span className={styles.errorText}><AlertCircle size={13} /> {errors.onlinePaymentType}</span>}
                        </div>

                        <div className={styles.formGroup}>
                          <label className={styles.label}>
                            Transaction Reference Number <span className={styles.reqStar}>*</span>
                          </label>
                          <input
                            type="text"
                            name="referenceNumber"
                            value={formData.referenceNumber}
                            onChange={handleChange}
                            placeholder="e.g., 9021 8472 9182"
                            className={`${styles.input} ${errors.referenceNumber ? styles.inputError : ''}`}
                          />
                          {errors.referenceNumber && <span className={styles.errorText}><AlertCircle size={13} /> {errors.referenceNumber}</span>}
                        </div>
                      </div>

                      <div className={styles.onlineTip}>
                        <ShieldCheck size={16} />
                        <span>Ensure the reference number matches your payment receipt timestamp exactly.</span>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* ACTION BUTTONS (Mobile & Form Bottom) */}
              <div className={styles.actionToolbar}>
                <button 
                  type="submit" 
                  disabled={loading}
                  className={`${styles.submitButton} ${loading ? styles.submitButtonDisabled : ''}`}
                >
                  {loading ? (
                    <>
                      <span className={styles.spinner} /> Processing...
                    </>
                  ) : (
                    <>
                      <ShoppingBag size={18} />
                      {editingOrder ? 'Update Order Details' : 'Confirm & Place Reservation'}
                    </>
                  )}
                </button>

                <button 
                  type="button"
                  onClick={editingOrder ? (props.onCancel || handleNewOrder) : () => navigate('/')}
                  className={styles.cancelButton}
                >
                  {editingOrder ? 'Discard Changes' : 'Cancel & Return'}
                </button>
              </div>
            </form>
          </div>

          {/* RIGHT COLUMN: Live Order Summary Card */}
          <aside className={styles.summaryColumn}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryHeader}>
                <ShoppingBag size={18} className={styles.summaryIcon} />
                <h3 className={styles.summaryTitle}>Live Order Summary</h3>
              </div>

              {selectedProductData ? (
                <div className={styles.summaryProductPreview}>
                  {(selectedProductData.imageBase64 || selectedProductData.imageUrl) && (
                    <div className={styles.summaryImageWrapper}>
                      <img 
                        src={selectedProductData.imageBase64 || selectedProductData.imageUrl} 
                        alt={selectedProductData.productName}
                        onError={(e) => { 
                          e.target.src = 'https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=400&h=400&fit=crop'; 
                        }}
                      />
                    </div>
                  )}

                  <div className={styles.summaryProductMeta}>
                    <h4 className={styles.summaryProductName}>{selectedProductData.productName}</h4>
                    <p className={styles.summaryProductCategory}>
                      {selectedProductData.category || 'Official Merchandise'}
                    </p>
                    <div className={styles.summaryPriceUnit}>
                      ₱{Number(selectedProductData.price || 0).toFixed(2)} <span>/ unit</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.noProductNotice}>
                  <Package size={32} strokeWidth={1.5} />
                  <p>Select a product to view item details and live calculations</p>
                </div>
              )}

              {/* Order Specifications Breakdown */}
              <div className={styles.summaryDetailsList}>
                <div className={styles.summaryDetailItem}>
                  <span>Selected Size</span>
                  <strong>{formData.size || 'Not selected'}</strong>
                </div>
                <div className={styles.summaryDetailItem}>
                  <span>Color Option</span>
                  <strong>{formData.color || 'Standard'}</strong>
                </div>
                <div className={styles.summaryDetailItem}>
                  <span>Quantity</span>
                  <strong>{formData.quantity || 1} unit(s)</strong>
                </div>
                <div className={styles.summaryDetailItem}>
                  <span>Payment Channel</span>
                  <strong>
                    {formData.paymentMethod === 'Online' 
                      ? `Digital (${formData.onlinePaymentType || 'Pending'})` 
                      : 'Cash on Pickup'}
                  </strong>
                </div>
              </div>

              {/* Calculation Line Items */}
              <div className={styles.costCalculation}>
                <div className={styles.costRow}>
                  <span>Item Subtotal</span>
                  <span>₱{calculateTotal().toFixed(2)}</span>
                </div>
                <div className={styles.costRow}>
                  <span>Processing Fee</span>
                  <span className={styles.freeBadge}>FREE (SSG Subsidized)</span>
                </div>
                <div className={styles.costDivider} />
                <div className={styles.grandTotalRow}>
                  <span>Total Payable</span>
                  <span className={styles.grandTotalPrice}>
                    ₱{calculateTotal().toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Security & Guarantee Note */}
              <div className={styles.trustFooter}>
                <ShieldCheck size={16} />
                <p>SSG verified student transaction. No hidden surcharges.</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default Order;