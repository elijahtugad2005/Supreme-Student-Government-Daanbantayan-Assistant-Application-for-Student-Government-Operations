import React, { useState, useMemo } from 'react';
import styles from './PDFDashboard.module.css';
import { 
  HiSearch, 
  HiEye, 
  HiDownload, 
  HiTrash,
  HiExternalLink,
  HiRefresh,
  HiX
} from 'react-icons/hi';

function PDFList({ pdfs, onPreview, onView, onDownload, onDelete, onStatusChange, loading }) {
  // Filter and search state
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('date'); // 'date', 'name', 'size'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc', 'desc'

  // Get unique categories and statuses with counts
  const categoryOptions = useMemo(() => {
    const categoryCount = {};
    pdfs.forEach(pdf => {
      const cat = pdf.pdfCategory || 'Uncategorized';
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    });
    return Object.entries(categoryCount).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pdfs]);

  const statusOptions = useMemo(() => {
    const statusCount = {};
    pdfs.forEach(pdf => {
      const stat = pdf.pdfStatus || 'unknown';
      statusCount[stat] = (statusCount[stat] || 0) + 1;
    });
    return Object.entries(statusCount).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pdfs]);

  // Filter and sort PDFs
  const filteredAndSortedPDFs = useMemo(() => {
    let result = pdfs.filter(pdf => {
      const matchesCategory = filterCategory === 'all' || pdf.pdfCategory === filterCategory;
      const matchesStatus = filterStatus === 'all' || pdf.pdfStatus === filterStatus;
      
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = 
        (pdf.pdfName?.toLowerCase() || '').includes(searchLower) ||
        (pdf.pdfCreator?.toLowerCase() || '').includes(searchLower) ||
        (pdf.fileName?.toLowerCase() || '').includes(searchLower) ||
        (pdf.pdfCategory?.toLowerCase() || '').includes(searchLower);
      
      return matchesCategory && matchesStatus && matchesSearch;
    });

    // Sort results
    result.sort((a, b) => {
      let compareA, compareB;
      
      switch(sortBy) {
        case 'name':
          compareA = (a.pdfName || '').toLowerCase();
          compareB = (b.pdfName || '').toLowerCase();
          break;
        case 'size':
          compareA = a.fileSize || 0;
          compareB = b.fileSize || 0;
          break;
        case 'date':
        default:
          compareA = new Date(a.uploadedAt || a.pdfDate || 0).getTime();
          compareB = new Date(b.uploadedAt || b.pdfDate || 0).getTime();
          break;
      }

      if (sortOrder === 'asc') {
        return compareA > compareB ? 1 : -1;
      } else {
        return compareA < compareB ? 1 : -1;
      }
    });

    return result;
  }, [pdfs, filterCategory, filterStatus, searchTerm, sortBy, sortOrder]);

  // Format date safely
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid Date';
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return 'Invalid Date';
    }
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return 'N/A';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Get status emoji and label
  const getStatusDisplay = (status) => {
    const statusMap = {
      approved: { emoji: '✅', label: 'Approved' },
      pending: { emoji: '⏳', label: 'Pending' },
      completed: { emoji: '🏁', label: 'Completed' },
      archived: { emoji: '📦', label: 'Archived' },
      ongoing: { emoji: '🚧', label: 'Ongoing' },
      draft: { emoji: '📝', label: 'Draft' }
    };
    return statusMap[status] || { emoji: '❓', label: status || 'Unknown' };
  };

  // Toggle sort
  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  // Clear all filters
  const clearFilters = () => {
    setFilterCategory('all');
    setFilterStatus('all');
    setSearchTerm('');
  };

  const hasActiveFilters = filterCategory !== 'all' || filterStatus !== 'all' || searchTerm !== '';

  return (
    <div className={styles.pdfListContainer}>
      {/* Filters Section */}
      <div className={styles.filtersSection}>
        <div className={styles.searchBar}>
          <HiSearch className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search by name, creator, or filename..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles.searchInput}
            disabled={loading}
          />
          {searchTerm && (
            <button 
              className={styles.clearSearchBtn}
              onClick={() => setSearchTerm('')}
              title="Clear search"
            >
              <HiX />
            </button>
          )}
        </div>
        
        <div className={styles.filters}>
          <select 
            value={filterCategory} 
            onChange={(e) => setFilterCategory(e.target.value)}
            className={styles.filterSelect}
            disabled={loading}
          >
            <option value="all">All Categories ({pdfs.length})</option>
            {categoryOptions.map(([cat, count]) => (
              <option key={cat} value={cat}>
                {cat} ({count})
              </option>
            ))}
          </select>
          
          <select 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value)}
            className={styles.filterSelect}
            disabled={loading}
          >
            <option value="all">All Status ({pdfs.length})</option>
            {statusOptions.map(([status, count]) => {
              const { emoji, label } = getStatusDisplay(status);
              return (
                <option key={status} value={status}>
                  {emoji} {label} ({count})
                </option>
              );
            })}
          </select>

          {hasActiveFilters && (
            <button 
              onClick={clearFilters}
              className={styles.clearFiltersBtn}
              disabled={loading}
            >
              <HiX /> Clear
            </button>
          )}
        </div>

        {/* Sort Options */}
        <div className={styles.sortOptions}>
          <label>Sort by:</label>
          <button 
            onClick={() => handleSort('date')}
            className={`${styles.sortBtn} ${sortBy === 'date' ? styles.active : ''}`}
            disabled={loading}
          >
            Date {sortBy === 'date' && (sortOrder === 'asc' ? '↑' : '↓')}
          </button>
          <button 
            onClick={() => handleSort('name')}
            className={`${styles.sortBtn} ${sortBy === 'name' ? styles.active : ''}`}
            disabled={loading}
          >
            Name {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
          </button>
          <button 
            onClick={() => handleSort('size')}
            className={`${styles.sortBtn} ${sortBy === 'size' ? styles.active : ''}`}
            disabled={loading}
          >
            Size {sortBy === 'size' && (sortOrder === 'asc' ? '↑' : '↓')}
          </button>
        </div>
      </div>

      {/* PDF Table */}
      <div className={styles.tableContainer}>
        <table className={styles.pdfTable}>
          <thead>
            <tr>
              <th className={styles.nameColumn}>Document Name</th>
              <th>Creator</th>
              <th>Category</th>
              <th>Status</th>
              <th>Date</th>
              <th>Size</th>
              <th className={styles.actionsColumn}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedPDFs.length > 0 ? (
              filteredAndSortedPDFs.map((pdf) => {
                const statusDisplay = getStatusDisplay(pdf.pdfStatus);
                return (
                  <tr key={pdf.id} className={styles.pdfRow}>
                    <td className={styles.pdfNameCell}>
                      <div className={styles.nameWrapper}>
                        <strong className={styles.pdfTitle}>{pdf.pdfName || 'Untitled'}</strong>
                        {pdf.fileName && (
                          <small className={styles.fileName}>{pdf.fileName}</small>
                        )}
                      </div>
                    </td>
                    <td className={styles.creatorCell}>
                      {pdf.pdfCreator || 'Unknown'}
                    </td>
                    <td>
                      <span className={`${styles.categoryBadge} ${styles[pdf.pdfCategory?.toLowerCase()]}`}>
                        {pdf.pdfCategory || 'N/A'}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.statusBadge} ${styles[pdf.pdfStatus?.toLowerCase()]}`}>
                        {statusDisplay.emoji} {statusDisplay.label}
                      </span>
                    </td>
                    <td className={styles.dateCell}>
                      {formatDate(pdf.pdfDate || pdf.uploadedAt)}
                    </td>
                    <td className={styles.sizeCell}>
                      {formatFileSize(pdf.fileSize)}
                    </td>
                    <td>
                      <div className={styles.actionCell}>
                        <button 
                          onClick={() => onPreview(pdf)}
                          className={styles.actionBtn}
                          title="Preview in Modal"
                          disabled={loading}
                        >
                          <HiEye />
                        </button>
                        <button 
                          onClick={() => onView(pdf.pdfBase64)}
                          className={styles.actionBtn}
                          title="Open in New Tab"
                          disabled={loading}
                        >
                          <HiExternalLink />
                        </button>
                        <button 
                          onClick={() => onDownload(pdf.pdfBase64, pdf.fileName)}
                          className={styles.actionBtn}
                          title="Download PDF"
                          disabled={loading}
                        >
                          <HiDownload />
                        </button>
                        <button 
                          onClick={() => onStatusChange(pdf)}
                          className={`${styles.actionBtn} ${styles.statusBtn}`}
                          title="Change Status"
                          disabled={loading}
                        >
                          <HiRefresh />
                        </button>
                        <button 
                          onClick={() => onDelete(pdf.id, pdf.pdfName)}
                          className={`${styles.actionBtn} ${styles.deleteBtn}`}
                          title="Delete PDF"
                          disabled={loading}
                        >
                          <HiTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan="7" className={styles.noData}>
                  {pdfs.length === 0 ? (
                    <>
                      <div className={styles.noDataIcon}>📭</div>
                      <p>No PDF documents found.</p>
                      <small>Upload your first PDF to get started!</small>
                    </>
                  ) : (
                    <>
                      <div className={styles.noDataIcon}>🔍</div>
                      <p>No PDFs match your filters.</p>
                      <small>Try adjusting your search criteria.</small>
                      <button onClick={clearFilters} className={styles.clearFiltersBtn}>
                        Clear Filters
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Results Summary */}
      {pdfs.length > 0 && (
        <div className={styles.listSummary}>
          <span className={styles.resultCount}>
            Showing <strong>{filteredAndSortedPDFs.length}</strong> of <strong>{pdfs.length}</strong> PDFs
          </span>
          {hasActiveFilters && (
            <span className={styles.filterSummary}>
              {filterCategory !== 'all' && ` • Category: ${filterCategory}`}
              {filterStatus !== 'all' && ` • Status: ${getStatusDisplay(filterStatus).label}`}
              {searchTerm && ` • Search: "${searchTerm}"`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default PDFList;