import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '../../firebase/firebaseConfig';
import { collection, addDoc, onSnapshot, Timestamp, doc, updateDoc, query, orderBy, limit, getDocs } from 'firebase/firestore';
import styles from './Order.module.css';

function Order(props) {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedProduct = location.state?.selectedProduct;
  const editingOrder = props.editingOrder;
  const hasLoadedEditData = useRef(false); // Track if we've loaded edit data

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
    if (!formData.bachelorDegree) newErrors.bachelorDegree = 'Bachelor degree is required';
    if (!formData.section) newErrors.section = 'Section is required';
    if (!formData.address.trim()) newErrors.address = 'Address is required';
    if (!formData.email.trim()) newErrors.email = 'Email is required';
    if (!formData.schoolID.trim()) newErrors.schoolID = 'School ID is required';
    if (!formData.phoneNumber.trim()) newErrors.phoneNumber = 'Phone number is required';
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (formData.email && !emailRegex.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }

    if (formData.phoneNumber && formData.phoneNumber.length < 10) {
      newErrors.phoneNumber = 'Please enter a valid phone number';
    }

    if (!formData.productId) newErrors.productId = 'Please select a product';
    if (selectedProductData?.sizeOptions?.length > 0 && !formData.size) {
      newErrors.size = 'Please select a size';
    }
    if (selectedProductData?.colorVariations?.length > 0 && !formData.color) {
      newErrors.color = 'Please select a color';
    }
    if (!formData.quantity || formData.quantity < 1) {
      newErrors.quantity = 'Quantity must be at least 1';
    }
    if (selectedProductData && formData.quantity > selectedProductData.stockAvailable) {
      newErrors.quantity = `Only ${selectedProductData.stockAvailable} items available`;
    }

    if (formData.paymentMethod === 'Online') {
      if (!formData.onlinePaymentType) {
        newErrors.onlinePaymentType = 'Please select payment type';
      }
      if (!formData.referenceNumber.trim()) {
        newErrors.referenceNumber = 'Reference number is required for online payment';
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
      // Query the orders collection to get the latest order
      const ordersRef = collection(db, 'orders');
      const q = query(ordersRef, orderBy('createdAt', 'desc'), limit(1));
      const querySnapshot = await getDocs(q);
      
      let nextNumber = 1; // Start from 0001
      
      if (!querySnapshot.empty) {
        // Get the last order ID
        const lastOrder = querySnapshot.docs[0].data();
        const lastOrderId = lastOrder.orderId;
        
        // Extract the number from the last order ID (e.g., "ORD-DB-0042" -> 42)
        if (lastOrderId && lastOrderId.startsWith('ORD-DB-')) {
          const lastNumber = parseInt(lastOrderId.split('-')[2]);
          if (!isNaN(lastNumber)) {
            nextNumber = lastNumber + 1;
          }
        }
      }
      
      // Format the number with leading zeros (e.g., 1 -> "0001")
      const formattedNumber = String(nextNumber).padStart(4, '0');
      
      return `ORD-DB-${formattedNumber}`;
    } catch (error) {
      console.error('Error generating order ID:', error);
      // Fallback to timestamp-based ID if there's an error
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
  // HANDLE FORM SUBMISSION
  // ========================================
  const handleSubmit = async (e) => {
  e.preventDefault();

  if (!validateForm()) {
    alert('Please fill in all required fields correctly');
    return;
  }

  setLoading(true);

  try {
    const orderId = editingOrder ? editingOrder.orderId : await generateOrderId();
    const docId = editingOrder ? editingOrder.docId : null;

    const orderData = {
      orderId: orderId,
      customerInfo: {
        fullName: formData.fullName,
        bachelorDegree: formData.bachelorDegree,
        section: formData.section, // Fixed: was 'year', should be 'section'
        address: formData.address,
        email: formData.email,
        phoneNumber: formData.phoneNumber,
        schoolID: formData.schoolID,
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
        referenceNumber: formData.paymentMethod === 'Online' ? formData.referenceNumber : null,
      },
      orderStatus: editingOrder ? editingOrder.orderStatus : 'Pending',
      dateOrdered: editingOrder ? editingOrder.dateOrdered : Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    // Check if editing or creating new
    if (editingOrder && docId) {
      // UPDATE existing order
      // Stock is NOT adjusted here - it's only managed when order status changes to "Completed"
      // Just verify stock availability for the new quantity
      const newQuantity = parseInt(formData.quantity);

      // Find the product document to verify stock
      const productsSnapshot = await getDocs(collection(db, 'products'));
      const productDoc = productsSnapshot.docs.find(
        doc => doc.data().productId === formData.productId
      );

      if (productDoc) {
        const currentStock = productDoc.data().stockAvailable || 0;
        
        // Only check if there's enough stock available (don't deduct)
        if (currentStock < newQuantity) {
          alert(`❌ Insufficient stock! Only ${currentStock} items available.`);
          setLoading(false);
          return;
        }
      }

      // Update the order without changing stock
      await updateDoc(doc(db, 'orders', docId), orderData);
      alert('✅ Order updated successfully!');
      
      // Call onSuccess to close modal in OrderManagement
      if (props.onSuccess) {
        props.onSuccess();
      }
    } else {
      // CREATE new order - Stock will be deducted when order status changes to "Completed"
      // Find the product document in Firebase to verify stock availability
      const productsSnapshot = await getDocs(collection(db, 'products'));
      const productDoc = productsSnapshot.docs.find(
        doc => doc.data().productId === formData.productId
      );

      if (!productDoc) {
        alert('❌ Product not found. Please try again.');
        setLoading(false);
        return;
      }

      const currentStock = productDoc.data().stockAvailable || 0;
      const orderQuantity = parseInt(formData.quantity);

      // Check stock availability (but don't deduct yet)
      if (currentStock < orderQuantity) {
        alert(`❌ Insufficient stock! Only ${currentStock} items available.`);
        setLoading(false);
        return;
      }

      // Create the order WITHOUT deducting stock
      // Stock will be deducted in OrderManagement when status changes to "Completed"
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
    console.error('Error details:', error.message);
    alert(`Error submitting order: ${error.message}. Please try again.`);
    setLoading(false);
  }
};
  


  // ========================================
  // RESET FORM FOR NEW ORDER
  // ========================================
 const handleNewOrder = () => {
  // If in edit mode (in modal), just close the modal
  if (editingOrder && props.onSuccess) {
    props.onSuccess();
    return;
  }
  
  // Only reset for new orders
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
  // Only load edit data once when component mounts with editingOrder
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
    
    // Update the selectedProductData
    const product = products.find(p => p.productId === order.productInfo?.productId);
    if (product) {
      setSelectedProductData(product);
    }
    
    // Mark as loaded so we don't reset again
    hasLoadedEditData.current = true;
  }
  
  // Reset the flag when editingOrder changes or component unmounts
  return () => {
    if (!props.editingOrder) {
      hasLoadedEditData.current = false;
    }
  };
}, [props.editingOrder, products]);

  // ========================================
  // RENDER: SUCCESS MESSAGE
  // ========================================
  if (submitSuccess) {
    return (
      <div className={styles.container}>
        <div className={styles.successCard}>
          <div className={styles.successIcon}>✓</div>
          <h1 className={styles.successTitle}>Order Placed Successfully!</h1>
          <p className={styles.successMessage}>
            Thank you for your order. Your order has been received and is being processed.
          </p>
          
          <div className={styles.orderIdBox}>
            <span className={styles.orderIdLabel}>Your Order ID:</span>
            <span className={styles.orderId}>{generatedOrderId}</span>
          </div>

          <p className={styles.successNote}>
            Kindly save this order and show it to your fellow officer when claiming your item.
            A confirmation email has been sent to <strong>{formData.email}</strong>
          </p>

          <div className={styles.successButtons}>
            <button onClick={() => navigate('/track-order', { state: { orderId: generatedOrderId } })} className={styles.trackOrderButton}>
              Track My Order
            </button>
            <button onClick={handleNewOrder} className={styles.newOrderButton}>
              Place Another Order
            </button>
            <button onClick={() => navigate('/')} className={styles.homeButton}>
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ========================================
  // RENDER: ORDER FORM
  // ========================================
  return (
    <div className={styles.container}>
      {/* Top Bar - matches ProductManagement style */}
      <div className={styles.topBar}>
        <p className={styles.eyebrow}>Order Management</p>
        <h1 className={styles.title}>{editingOrder ? 'Edit Order' : 'Place Your Order'}</h1>
        <p className={styles.subtitle}>Fill in the details below to complete your order</p>
      </div>

      <div className={styles.formWrapper}>
        <form onSubmit={handleSubmit} className={styles.form}>
          
          {/* CUSTOMER INFORMATION */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Customer Information</h2>
              <span className={styles.sectionBadge}>Step 1</span>
            </div>
            <div className={styles.sectionBody}>
            
            <div className={styles.formGroup}>
              <label className={styles.label}>Full Name *</label>
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                placeholder="Elijah Glenn malake et- oops"
                className={`${styles.input} ${errors.fullName ? styles.inputError : ''}`}
              />
              {errors.fullName && <span className={styles.errorText}>{errors.fullName}</span>}
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>School ID *</label>
              <input
                type="text"
                name="schoolID"
                value={formData.schoolID}
                onChange={handleChange}
                placeholder="8304433"
                className={`${styles.input} ${errors.schoolID ? styles.inputError : ''}`}
              />
              {errors.schoolID && <span className={styles.errorText}>{errors.schoolID}</span>}
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Bachelor Degree *</label>
                <select
                  name="bachelorDegree"
                  value={formData.bachelorDegree}
                  onChange={handleChange}
                  className={`${styles.select} ${errors.bachelorDegree ? styles.inputError : ''}`}
                >
                  <option value="">Select Degree</option>
                  <option value="BSIT">BSIT - Information Technology</option>
                  <option value="BSCS">BSCS - Computer Science</option>
                  <option value="BSHM">BSHM - Hospitality Management</option>
                  <option value="BEED">BSED - Education</option>
                  <option value = "BSFI">BSFI - Fishries</option>
                  <option value = "BIT AUTO"> BIT AUTO - Automotive</option>
                  <option value = "BIT ELEC"> BIT ELEC - Electricity</option>
                  <option value = "BSIE"> BSIE - Enginnering </option>
                </select>
                {errors.bachelorDegree && <span className={styles.errorText}>{errors.bachelorDegree}</span>}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Section *</label>
                <select
                  name="section"
                  value={formData.section}
                  onChange={handleChange}
                  className={`${styles.select} ${errors.section ? styles.inputError : ''}`}
                >
                  <option value="">Select Year Level</option>
                  <option value = "1st year">First Year</option>
                  <option value = "2nd year">Second Year</option>
                  <option value = "3rd year">Third Year</option>
                  <option value = "4th year">Fourth Year</option>
                </select>
                {errors.section && <span className={styles.errorText}>{errors.section}</span>}
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Address *</label>
              <input
                type="text"
                name="address"
                value={formData.address}
                onChange={handleChange}
                placeholder="Complete Address"
                className={`${styles.input} ${errors.address ? styles.inputError : ''}`}
              />
              {errors.address && <span className={styles.errorText}>{errors.address}</span>}
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Email Address *</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="juan@example.com"
                  className={`${styles.input} ${errors.email ? styles.inputError : ''}`}
                />
                {errors.email && <span className={styles.errorText}>{errors.email}</span>}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Phone Number *</label>
                <input
                  type="tel"
                  name="phoneNumber"
                  value={formData.phoneNumber}
                  onChange={handleChange}
                  placeholder="09123456789"
                  className={`${styles.input} ${errors.phoneNumber ? styles.inputError : ''}`}
                />
                {errors.phoneNumber && <span className={styles.errorText}>{errors.phoneNumber}</span>}
              </div>
            </div>
            </div>
          </div>

          {/* PRODUCT SELECTION */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Product Selection</h2>
              <span className={styles.sectionBadge}>Step 2</span>
            </div>
            <div className={styles.sectionBody}>
            
            <div className={styles.formGroup}>
              <label className={styles.label}>Select Product *</label>
              <select
                name="productId"
                value={formData.productId}
                onChange={handleProductChange}
                disabled={!!selectedProduct}
                className={`${styles.select} ${errors.productId ? styles.inputError : ''}`}
              >
                <option value="">Choose a product</option>
                {products.map((product) => (
                  <option key={product.productId} value={product.productId}>
                    {product.productName} - ₱{product.price} 
                    ({product.stockAvailable} available)
                  </option>
                ))}
              </select>
              {errors.productId && <span className={styles.errorText}>{errors.productId}</span>}
            </div>

            {selectedProductData && (
              <div className={styles.productPreview}>
                {selectedProductData.imageUrl && (
                  <div className={styles.productPreviewImage}>
                    <img 
                      src={selectedProductData.imageUrl} 
                      alt={selectedProductData.productName}
                      onError={(e) => { 
                        e.target.src = 'https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=400&h=400&fit=crop'; 
                      }}
                    />
                  </div>
                )}
                <div className={styles.productPreviewContent}>
                  <h3 className={styles.productPreviewTitle}>{selectedProductData.productName}</h3>
                  <p className={styles.productPreviewDesc}>{selectedProductData.description}</p>
                  <div className={styles.productPreviewMeta}>
                    <span className={styles.productPreviewPrice}>₱{selectedProductData.price} per unit</span>
                    <span className={styles.productPreviewStock}>
                      {selectedProductData.stockAvailable} in stock
                    </span>
                  </div>
                </div>
              </div>
            )}

            {selectedProductData?.sizeOptions?.length > 0 && (
              <div className={styles.formGroup}>
                <label className={styles.label}>Select Size *</label>
                <select
                  name="size"
                  value={formData.size}
                  onChange={handleChange}
                  className={`${styles.select} ${errors.size ? styles.inputError : ''}`}
                >
                  <option value="">Choose size</option>
                  {selectedProductData.sizeOptions.map((size, idx) => (
                    <option key={idx} value={size}>{size}</option>
                  ))}
                </select>
                {errors.size && <span className={styles.errorText}>{errors.size}</span>}
              </div>
            )}

            {selectedProductData?.colorVariations?.length > 0 && (
              <div className={styles.formGroup}>
                <label className={styles.label}>Select Color *</label>
                <select
                  name="color"
                  value={formData.color}
                  onChange={handleChange}
                  className={`${styles.select} ${errors.color ? styles.inputError : ''}`}
                >
                  <option value="">Choose color</option>
                  {selectedProductData.colorVariations.map((color, idx) => (
                    <option key={idx} value={color}>{color}</option>
                  ))}
                </select>
                {errors.color && <span className={styles.errorText}>{errors.color}</span>}
              </div>
            )}

            <div className={styles.formGroup}>
              <label className={styles.label}>Quantity *</label>
              <input
                type="number"
                name="quantity"
                value={formData.quantity}
                onChange={handleChange}
                min="1"
                max={selectedProductData?.stockAvailable || 999}
                className={`${styles.input} ${errors.quantity ? styles.inputError : ''}`}
              />
              {errors.quantity && <span className={styles.errorText}>{errors.quantity}</span>}
            </div>

            {selectedProductData && formData.quantity > 0 && (
              <div className={styles.totalBox}>
                <span className={styles.totalLabel}>Total Price:</span>
                <span className={styles.totalPrice}>₱{calculateTotal().toFixed(2)}</span>
              </div>
            )}
            </div>
          </div>

          {/* PAYMENT INFORMATION */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Payment Information</h2>
              <span className={styles.sectionBadge}>Step 3</span>
            </div>
            <div className={styles.sectionBody}>
            
            <div className={styles.formGroup}>
              <label className={styles.label}>Payment Method *</label>
              <div className={styles.radioGroup}>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="Cash"
                    checked={formData.paymentMethod === 'Cash'}
                    onChange={handleChange}
                    className={styles.radio}
                  />
                  Cash on Arrival
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="Online"
                    checked={formData.paymentMethod === 'Online'}
                    onChange={handleChange}
                    className={styles.radio}
                  />
                  Online Payment
                </label>
              </div>
            </div>

            {formData.paymentMethod === 'Online' && (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Online Payment Type *</label>
                  <select
                    name="onlinePaymentType"
                    value={formData.onlinePaymentType}
                    onChange={handleChange}
                    className={`${styles.select} ${errors.onlinePaymentType ? styles.inputError : ''}`}
                  >
                    <option value="">Select payment type</option>
                    <option value="GCash">GCash</option>
                    <option value="PayMaya">PayMaya</option>
                  </select>
                  {errors.onlinePaymentType && <span className={styles.errorText}>{errors.onlinePaymentType}</span>}
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>Reference Number *</label>
                  <input
                    type="text"
                    name="referenceNumber"
                    value={formData.referenceNumber}
                    onChange={handleChange}
                    placeholder="Enter transaction reference number"
                    className={`${styles.input} ${errors.referenceNumber ? styles.inputError : ''}`}
                  />
                  {errors.referenceNumber && <span className={styles.errorText}>{errors.referenceNumber}</span>}
                </div>
              </>
            )}
            </div>
          </div>

          {/* SUBMIT BUTTONS */}
          <div className={styles.buttonGroup}>
            <button 
              type="submit" 
              disabled={loading}
              className={`${styles.submitButton} ${loading ? styles.submitButtonDisabled : ''}`}
            >
              {loading && <span className={styles.spinner} />}
              {loading ? 'Processing Order...' : editingOrder ? 'Update Order' : 'Place Order'}
            </button>

            <button 
            type="button"
              onClick={editingOrder ? handleNewOrder : () => navigate('/')}
              className={styles.cancelButton}
            >
              {editingOrder ? 'Cancel' : 'Cancel & Go Back'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Order;