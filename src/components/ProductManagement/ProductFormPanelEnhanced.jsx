import React, { useState } from 'react';
import styles from './productmanagement.module.css';

// ========================================
// IMAGE COMPRESSION UTILITY
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
// ENHANCED PRODUCT FORM PANEL
// ========================================
function ProductFormPanelEnhanced({ 
  isOpen, 
  onClose, 
  onSubmit, 
  editingProductId, 
  loading, 
  productData, 
  setProductData, 
  imagePreview, 
  setImagePreview 
}) {
  // Temporary input states
  const [tempSize, setTempSize] = useState('');
  const [tempColor, setTempColor] = useState('');
  
  // Custom variation states
  const [newVariationType, setNewVariationType] = useState('');
  const [newVariationOption, setNewVariationOption] = useState('');
  const [selectedVariationIndex, setSelectedVariationIndex] = useState(null);

  // ========================================
  // HANDLE FORM CHANGES
  // ========================================
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setProductData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  // ========================================
  // HANDLE MAIN IMAGE CHANGE
  // ========================================
  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) { 
      setProductData((prev) => ({ ...prev, imageBase64: '' })); 
      setImagePreview(null); 
      return; 
    }
    if (!file.type.startsWith('image/')) { 
      alert('Please select an image file'); 
      return; 
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Image size should be less than 5MB before processing.');
    }
    try {
      const compressedBase64 = await CompressImage(file, 1000, 0.8);
      setProductData((prev) => ({ ...prev, imageBase64: compressedBase64 }));
      setImagePreview(compressedBase64);
    } catch (error) {
      console.error('Error during image compression:', error);
      alert('Failed to process image. Please try a different file.');
      setProductData((prev) => ({ ...prev, imageBase64: '' }));
      setImagePreview(null);
    }
  };

  // ========================================
  // SIZE OPTIONS HANDLERS
  // ========================================
  const handleAddSize = () => {
    if (tempSize.trim()) {
      setProductData((prev) => ({ 
        ...prev, 
        sizeOptions: [...prev.sizeOptions, tempSize.trim()] 
      }));
      setTempSize('');
    }
  };

  const handleRemoveSize = (index) => {
    setProductData((prev) => ({ 
      ...prev, 
      sizeOptions: prev.sizeOptions.filter((_, i) => i !== index) 
    }));
  };

  // ========================================
  // COLOR OPTIONS HANDLERS
  // ========================================
  const handleAddColor = () => {
    if (tempColor.trim()) {
      setProductData((prev) => ({ 
        ...prev, 
        colorVariations: [...prev.colorVariations, tempColor.trim()] 
      }));
      setTempColor('');
    }
  };

  const handleRemoveColor = (index) => {
    setProductData((prev) => ({ 
      ...prev, 
      colorVariations: prev.colorVariations.filter((_, i) => i !== index) 
    }));
  };

  // ========================================
  // CUSTOM VARIATION TYPE HANDLERS
  // ========================================
  const handleAddVariationType = () => {
    if (!newVariationType.trim()) {
      alert('Please enter a variation type name (e.g., Team, Design, Style)');
      return;
    }
    
    const newVariation = {
      type: newVariationType.trim(),
      options: []
    };
    
    setProductData((prev) => ({
      ...prev,
      customVariations: [...prev.customVariations, newVariation]
    }));
    
    setNewVariationType('');
  };

  const handleRemoveVariationType = (index) => {
    if (window.confirm('Remove this variation type and all its options?')) {
      setProductData((prev) => ({
        ...prev,
        customVariations: prev.customVariations.filter((_, i) => i !== index)
      }));
    }
  };

  // ========================================
  // CUSTOM VARIATION OPTION HANDLERS
  // ========================================
  const handleAddVariationOption = async (variationIndex) => {
    if (!newVariationOption.trim()) {
      alert('Please enter an option name');
      return;
    }

    const newOption = {
      name: newVariationOption.trim(),
      image: '',
      stock: 0
    };

    setProductData((prev) => {
      const updated = [...prev.customVariations];
      updated[variationIndex].options.push(newOption);
      return { ...prev, customVariations: updated };
    });

    setNewVariationOption('');
  };

  const handleRemoveVariationOption = (variationIndex, optionIndex) => {
    setProductData((prev) => {
      const updated = [...prev.customVariations];
      updated[variationIndex].options = updated[variationIndex].options.filter((_, i) => i !== optionIndex);
      return { ...prev, customVariations: updated };
    });
  };

  const handleVariationOptionImageChange = async (e, variationIndex, optionIndex) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    try {
      const compressedBase64 = await CompressImage(file, 800, 0.8);
      
      setProductData((prev) => {
        const updated = [...prev.customVariations];
        updated[variationIndex].options[optionIndex].image = compressedBase64;
        return { ...prev, customVariations: updated };
      });
    } catch (error) {
      console.error('Error compressing variation image:', error);
      alert('Failed to process image');
    }
  };

  const handleVariationOptionStockChange = (variationIndex, optionIndex, stock) => {
    setProductData((prev) => {
      const updated = [...prev.customVariations];
      updated[variationIndex].options[optionIndex].stock = parseInt(stock) || 0;
      return { ...prev, customVariations: updated };
    });
  };

  // ========================================
  // RENDER
  // ========================================
  return (
    <>
      {/* Backdrop */}
      <div
        className={`${styles.panelBackdrop} ${isOpen ? styles.panelBackdropVisible : ''}`}
        onClick={onClose}
      />
      
      {/* Slide-out Panel */}
      <div className={`${styles.formPanel} ${isOpen ? styles.formPanelOpen : ''}`}>
        <div className={styles.formPanelHeader}>
          <h2 className={styles.formPanelTitle}>
            {editingProductId ? 'Edit Product' : 'New Product'}
          </h2>
          <button className={styles.formPanelClose} onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.formPanelBody}>
          <form onSubmit={onSubmit} className={styles.form} id="productForm">

            {/* Product Name */}
            <div className={styles.formGroup}>
              <label className={styles.label}>
                Product Name <span className={styles.required}>*</span>
              </label>
              <input 
                type="text" 
                name="productName" 
                value={productData.productName} 
                onChange={handleChange}
                placeholder="e.g., COED Lanyard" 
                className={styles.input} 
                required 
              />
            </div>

            {/* Stock and Price */}
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Stock Quantity <span className={styles.required}>*</span>
                </label>
                <input 
                  type="number" 
                  name="stockAvailable" 
                  value={productData.stockAvailable} 
                  onChange={handleChange}
                  min="0" 
                  placeholder="100" 
                  className={styles.input} 
                  required 
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Price (₱) <span className={styles.required}>*</span>
                </label>
                <input 
                  type="number" 
                  name="price" 
                  value={productData.price} 
                  onChange={handleChange}
                  min="0" 
                  step="0.01" 
                  placeholder="150.00" 
                  className={styles.input} 
                  required 
                />
              </div>
            </div>

            {/* Supplier */}
            <div className={styles.formGroup}>
              <label className={styles.label}>
                Supplier Name <span className={styles.required}>*</span>
              </label>
              <input 
                type="text" 
                name="supplier" 
                value={productData.supplier} 
                onChange={handleChange}
                placeholder="e.g., ABC Manufacturing Inc." 
                className={styles.input} 
                required 
              />
            </div>

            {/* Description */}
            <div className={styles.formGroup}>
              <label className={styles.label}>
                Description <span className={styles.required}>*</span>
              </label>
              <textarea 
                name="description" 
                value={productData.description} 
                onChange={handleChange}
                placeholder="Describe the product features, materials, etc." 
                rows="3"
                className={styles.textarea} 
                required 
              />
            </div>

            {/* Variations Checkbox */}
            <div className={styles.checkboxGroup}>
              <label className={styles.checkboxLabel}>
                <input 
                  type="checkbox" 
                  name="hasVariations" 
                  checked={productData.hasVariations}
                  onChange={handleChange} 
                  className={styles.checkbox} 
                />
                <span>This product has variations</span>
              </label>
            </div>

            {/* VARIATIONS SECTION */}
            {productData.hasVariations && (
              <div className={styles.variationsSection}>
                <h4 className={styles.variationsTitle}>Product Variations</h4>

                {/* Size Options */}
                <div className={styles.variationGroup}>
                  <label className={styles.label}>Size Options (Optional)</label>
                  <div className={styles.addVariationContainer}>
                    <input 
                      type="text" 
                      value={tempSize} 
                      onChange={(e) => setTempSize(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddSize())}
                      placeholder="e.g., Small, Medium, Large" 
                      className={styles.variationInput} 
                    />
                    <button type="button" onClick={handleAddSize} className={styles.addButton}>
                      + Add
                    </button>
                  </div>
                  {productData.sizeOptions.length > 0 && (
                    <div className={styles.tagsList}>
                      {productData.sizeOptions.map((size, index) => (
                        <div key={index} className={styles.tag}>
                          <span>{size}</span>
                          <button 
                            type="button" 
                            onClick={() => handleRemoveSize(index)} 
                            className={styles.removeTagButton}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Color Options */}
                <div className={styles.variationGroup}>
                  <label className={styles.label}>Color Variations (Optional)</label>
                  <div className={styles.addVariationContainer}>
                    <input 
                      type="text" 
                      value={tempColor} 
                      onChange={(e) => setTempColor(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddColor())}
                      placeholder="e.g., Red, Blue, Black" 
                      className={styles.variationInput} 
                    />
                    <button type="button" onClick={handleAddColor} className={styles.addButton}>
                      + Add
                    </button>
                  </div>
                  {productData.colorVariations.length > 0 && (
                    <div className={styles.tagsList}>
                      {productData.colorVariations.map((color, index) => (
                        <div key={index} className={styles.tag}>
                          <span>{color}</span>
                          <button 
                            type="button" 
                            onClick={() => handleRemoveColor(index)} 
                            className={styles.removeTagButton}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* CUSTOM VARIATIONS */}
                <div className={styles.customVariationsSection}>
                  <div className={styles.customVariationsHeader}>
                    <label className={styles.label}>Custom Variations (e.g., Team, Design)</label>
                    <p className={styles.helperText}>
                      Add custom variation types with individual photos and stock for each option
                    </p>
                  </div>

                  {/* Add New Variation Type */}
                  <div className={styles.addVariationContainer}>
                    <input 
                      type="text" 
                      value={newVariationType} 
                      onChange={(e) => setNewVariationType(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddVariationType())}
                      placeholder="e.g., Team, Design, Style" 
                      className={styles.variationInput} 
                    />
                    <button 
                      type="button" 
                      onClick={handleAddVariationType} 
                      className={styles.addButton}
                    >
                      + Add Type
                    </button>
                  </div>

                  {/* Display Custom Variation Types */}
                  {productData.customVariations.map((variation, varIndex) => (
                    <div key={varIndex} className={styles.customVariationCard}>
                      <div className={styles.customVariationCardHeader}>
                        <h5 className={styles.customVariationTitle}>{variation.type}</h5>
                        <button 
                          type="button" 
                          onClick={() => handleRemoveVariationType(varIndex)}
                          className={styles.removeVariationTypeBtn}
                        >
                          Remove Type
                        </button>
                      </div>

                      {/* Add Option to this Variation Type */}
                      <div className={styles.addVariationContainer}>
                        <input 
                          type="text" 
                          value={selectedVariationIndex === varIndex ? newVariationOption : ''}
                          onChange={(e) => {
                            setSelectedVariationIndex(varIndex);
                            setNewVariationOption(e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddVariationOption(varIndex);
                            }
                          }}
                          placeholder={`Add ${variation.type} option (e.g., Team A, Design 1)`}
                          className={styles.variationInput} 
                        />
                        <button 
                          type="button" 
                          onClick={() => handleAddVariationOption(varIndex)}
                          className={styles.addButton}
                        >
                          + Add Option
                        </button>
                      </div>

                      {/* Display Options */}
                      {variation.options.length > 0 && (
                        <div className={styles.variationOptionsList}>
                          {variation.options.map((option, optIndex) => (
                            <div key={optIndex} className={styles.variationOptionCard}>
                              <div className={styles.variationOptionHeader}>
                                <span className={styles.variationOptionName}>{option.name}</span>
                                <button 
                                  type="button" 
                                  onClick={() => handleRemoveVariationOption(varIndex, optIndex)}
                                  className={styles.removeOptionBtn}
                                >
                                  ×
                                </button>
                              </div>

                              <div className={styles.variationOptionBody}>
                                {/* Image Upload */}
                                <div className={styles.variationOptionImageSection}>
                                  {option.image ? (
                                    <div className={styles.variationOptionImagePreview}>
                                      <img 
                                        src={option.image} 
                                        alt={option.name}
                                        className={styles.variationOptionImage}
                                      />
                                      <label className={styles.changeVariationImageBtn}>
                                        Change
                                        <input 
                                          type="file" 
                                          accept="image/*"
                                          onChange={(e) => handleVariationOptionImageChange(e, varIndex, optIndex)}
                                          style={{ display: 'none' }}
                                        />
                                      </label>
                                    </div>
                                  ) : (
                                    <label className={styles.variationOptionImageUpload}>
                                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
                                        <rect x="3" y="3" width="18" height="18" rx="2" />
                                        <circle cx="8.5" cy="8.5" r="1.5" />
                                        <polyline points="21 15 16 10 5 21" />
                                      </svg>
                                      <span>Upload Image</span>
                                      <input 
                                        type="file" 
                                        accept="image/*"
                                        onChange={(e) => handleVariationOptionImageChange(e, varIndex, optIndex)}
                                        style={{ display: 'none' }}
                                      />
                                    </label>
                                  )}
                                </div>

                                {/* Stock Input */}
                                <div className={styles.variationOptionStockSection}>
                                  <label className={styles.variationOptionStockLabel}>Stock:</label>
                                  <input 
                                    type="number" 
                                    value={option.stock}
                                    onChange={(e) => handleVariationOptionStockChange(varIndex, optIndex, e.target.value)}
                                    min="0"
                                    className={styles.variationOptionStockInput}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Main Product Image */}
            <div className={styles.formGroup}>
              <label className={styles.label}>Main Product Image</label>
              {imagePreview ? (
                <div className={styles.imageUploadPreview}>
                  <img src={imagePreview} alt="Preview" className={styles.imagePreviewLarge} />
                  <label className={styles.changeImageBtn}>
                    Change Image
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleImageChange} 
                      style={{ display: 'none' }} 
                    />
                  </label>
                </div>
              ) : (
                <label className={styles.fileDropZone}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span className={styles.fileDropZoneText}>Click to upload image</span>
                  <span className={styles.fileDropZoneSub}>JPG, PNG up to 5MB</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleImageChange} 
                    style={{ display: 'none' }} 
                  />
                </label>
              )}
            </div>
          </form>
        </div>

        {/* Panel Footer */}
        <div className={styles.formPanelFooter}>
          <button type="button" onClick={onClose} className={styles.cancelButton}>
            Cancel
          </button>
          <button 
            type="submit" 
            form="productForm" 
            disabled={loading} 
            className={styles.submitButton}
          >
            {loading && <span className={styles.spinner} />}
            {loading ? 'Saving…' : editingProductId ? 'Update Product' : 'Add Product'}
          </button>
        </div>
      </div>
    </>
  );
}

export default ProductFormPanelEnhanced;
