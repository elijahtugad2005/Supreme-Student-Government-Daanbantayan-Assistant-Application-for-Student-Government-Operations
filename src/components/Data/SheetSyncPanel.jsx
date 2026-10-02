import React, { useState, useRef, useEffect } from 'react';
import {
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Upload,
  FileSpreadsheet,
  Link,
  ChevronDown,
  ChevronUp,
  Info,
  Sparkles,
  Check,
  X,
  FileText,
  SlidersHorizontal,
} from 'lucide-react';
import { allMappings } from './sheetMappingConfig.js';
import {
  syncSourceToFirestore,
  fetchSheetData,
  parseExcelFile,
  detectDynamicColumnMappings,
  transformAllRows,
  getMaxOrderNumber,
} from './sheetSyncService.js';
import styles from './SheetSyncPanel.module.css';

function SheetSyncPanel({ onSyncCompleted }) {
  // ── Source Selection & Inputs ──
  const [sourceMode, setSourceMode] = useState('excel'); // 'excel' | 'sheets'
  const [sheetUrl, setSheetUrl] = useState('');
  const [excelFile, setExcelFile] = useState(null);
  const [selectedType, setSelectedType] = useState('orders'); // 'orders' | 'products'

  // ── Sync & Preview State ──
  const [syncing, setSyncing] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [rawRows, setRawRows] = useState([]);
  const [detectedColumns, setDetectedColumns] = useState([]);
  const [resolvedMappings, setResolvedMappings] = useState({});
  const [matchesInfo, setMatchesInfo] = useState({});
  const [previewDocs, setPreviewDocs] = useState([]);
  const [previewSummary, setPreviewSummary] = useState(null);
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);

  // ── Progress Tracking State ──
  const [processingProgress, setProcessingProgress] = useState({
    stage: '', // 'parsing', 'detecting', 'transforming', 'syncing'
    currentRow: 0,
    totalRows: 0,
    percentage: 0,
    substage: '' // More detailed step description
  });
  const [syncProgress, setSyncProgress] = useState({
    stage: '', // 'fetching', 'processing', 'uploading'
    currentBatch: 0,
    totalBatches: 0,
    percentage: 0,
    details: ''
  });
  const [syncSteps, setSyncSteps] = useState([
    { id: 'prepare', name: 'Prepare Data', completed: false, active: false },
    { id: 'fetch', name: 'Fetch Existing Records', completed: false, active: false },
    { id: 'process', name: 'Process Records', completed: false, active: false },
    { id: 'upload', name: 'Upload to Firestore', completed: false, active: false },
    { id: 'complete', name: 'Complete', completed: false, active: false }
  ]);
  const [maxOrderNumber, setMaxOrderNumber] = useState(0);

  // ── UI Toggles ──
  const [showMappingAdjuster, setShowMappingAdjuster] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const logsRef = useRef(null);
  const fileInputRef = useRef(null);
  const mappingConfig = allMappings[selectedType];

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (message, type = 'info') => {
    setLogs((prev) => [...prev, { message, type, time: new Date().toLocaleTimeString() }]);
  };

  const updateSyncStep = (stepId, completed = false, active = true) => {
    setSyncSteps(prev => prev.map(step => ({
      ...step,
      completed: step.id === stepId ? completed : (step.completed || (prev.findIndex(s => s.id === stepId) > prev.findIndex(s => s.id === step.id) ? false : step.completed)),
      active: step.id === stepId ? active : false
    })));
  };

  const resetSyncSteps = () => {
    setSyncSteps(prev => prev.map(step => ({ ...step, completed: false, active: false })));
  };

  const clearState = () => {
    setLogs([]);
    setResult(null);
    setRawRows([]);
    setDetectedColumns([]);
    setResolvedMappings({});
    setMatchesInfo({});
    setPreviewDocs([]);
    setPreviewSummary(null);
    setMaxOrderNumber(0);
    resetSyncSteps();
  };

  // ── File Handlers ──
  const handleFileChange = async (file) => {
    if (!file) return;
    setExcelFile(file);
    clearState();
    addLog(`Selected file: "${file.name}" (${(file.size / 1024).toFixed(1)} KB)`, 'info');
    addLog('File ready. Click "Preview Extraction" to analyze the data.', 'info');
    // Remove automatic processing - user must click Preview Extraction
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      await handleFileChange(file);
    }
  };

  // ── Core Parsing & Dynamic Column Algorithm ──
  const processData = async (sourceOverride = null) => {
    const activeSource = sourceOverride || (sourceMode === 'excel' ? excelFile : sheetUrl.trim());

    if (!activeSource) {
      addLog(
        sourceMode === 'excel'
          ? 'Please select or drop an Excel (.xlsx/.xls) or CSV file.'
          : 'Please enter a published Google Sheets URL.',
        'error'
      );
      return;
    }

    setPreviewLoading(true);
    setResult(null);
    setProcessingProgress({ stage: 'parsing', currentRow: 0, totalRows: 0, percentage: 0, substage: 'Reading file...' });
    addLog('Extracting and reading data rows...', 'info');

    try {
      let rows = [];
      if (typeof activeSource === 'string') {
        setProcessingProgress(prev => ({ ...prev, substage: 'Fetching Google Sheet data...' }));
        rows = await fetchSheetData(activeSource);
      } else {
        setProcessingProgress(prev => ({ ...prev, substage: `Parsing ${activeSource.name}...` }));
        rows = await parseExcelFile(activeSource);
      }

      if (!rows || rows.length === 0) {
        throw new Error('No readable data rows found in the provided source.');
      }

      setProcessingProgress({ stage: 'detecting', currentRow: 0, totalRows: rows.length, percentage: 25, substage: 'Analyzing column headers...' });
      const columns = Object.keys(rows[0] || {});
      setRawRows(rows);
      setDetectedColumns(columns);

      // Run our dynamic keyword detection algorithm
      setProcessingProgress(prev => ({ ...prev, substage: 'Running dynamic keyword detection...' }));
      const detection = detectDynamicColumnMappings(columns, mappingConfig);
      setResolvedMappings(detection.resolvedMappings);
      setMatchesInfo(detection.matchesInfo);

      // Get the real max order number from database for accurate preview
      setProcessingProgress(prev => ({ ...prev, substage: 'Checking existing Order IDs in database...' }));
      const currentMaxOrderNumber = await getMaxOrderNumber(mappingConfig.collection);
      setMaxOrderNumber(currentMaxOrderNumber);
      addLog(`Found existing records. Next Order ID will start from: SSGDB-${String(currentMaxOrderNumber + 1).padStart(3, '0')}`, 'info');

      // Perform sample transformation with detected mappings
      setProcessingProgress({ stage: 'transforming', currentRow: 0, totalRows: rows.length, percentage: 50, substage: 'Transforming sample data...' });
      const { docs, skippedCount, errors, autoGeneratedIds } = transformAllRows(
        rows,
        mappingConfig,
        detection.resolvedMappings,
        (progress) => {
          setProcessingProgress(progress);
        },
        currentMaxOrderNumber // Use real max from database
      );

      setProcessingProgress({ stage: 'transforming', currentRow: rows.length, totalRows: rows.length, percentage: 100, substage: 'Completed processing' });
      setPreviewDocs(docs.slice(0, 5)); // show first 5
      setPreviewSummary({
        totalRows: rows.length,
        validDocs: docs.length,
        skipped: skippedCount,
        errorsCount: errors.length,
        matchedFields: Object.keys(detection.resolvedMappings).length,
        autoGeneratedIds: autoGeneratedIds || 0,
      });

      addLog(
        `Dynamic Algorithm detected ${Object.keys(detection.resolvedMappings).length} fields! (e.g. Name, Email, Order ID)`,
        'success'
      );
      addLog(
        `Preview ready: ${rows.length} total rows, ${docs.length} extracted and ready to sync.`,
        'info'
      );
    } catch (err) {
      addLog(`Error parsing data: ${err.message}`, 'error');
    } finally {
      setPreviewLoading(false);
      setProcessingProgress({ stage: '', currentRow: 0, totalRows: 0, percentage: 0, substage: '' });
    }
  };

  // ── Manual Mapping Adjustment ──
  const handleOverrideColumn = (firebaseField, newSheetCol) => {
    const updated = {
      ...resolvedMappings,
      [firebaseField]: newSheetCol,
    };
    if (!newSheetCol) {
      delete updated[firebaseField];
    }
    setResolvedMappings(updated);

    // Re-transform preview
    if (rawRows.length > 0) {
      const { docs, skippedCount, errors, autoGeneratedIds } = transformAllRows(rawRows, mappingConfig, updated, null, maxOrderNumber);
      setPreviewDocs(docs.slice(0, 5));
      setPreviewSummary((prev) => ({
        ...prev,
        validDocs: docs.length,
        skipped: skippedCount,
        errorsCount: errors.length,
        matchedFields: Object.keys(updated).length,
        autoGeneratedIds: autoGeneratedIds || 0,
      }));
    }
  };

  // ── Modal State ──
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', type: 'warning' });
  const [successModal, setSuccessModal] = useState({ isOpen: false, created: 0, updated: 0 });

  // ── Execute Sync to Firebase ──
  const handleExecuteSync = async () => {
    const activeSource = sourceMode === 'excel' ? excelFile : sheetUrl.trim();

    if (!activeSource) {
      addLog('No active data source selected for syncing.', 'error');
      return;
    }

    // Show warning modal if there are auto-generated IDs
    if (previewSummary?.autoGeneratedIds > 0) {
      setConfirmModal({
        isOpen: true,
        title: '⚠️ Auto-Generated ID Notice',
        message: `${previewSummary.validDocs} records are ready to sync. ${previewSummary.autoGeneratedIds} records will receive auto-generated SSGDB-### IDs due to missing or non-standard format in the sheet.`,
        type: 'warning'
      });
      return;
    }

    await performSync();
  };

  const performSync = async () => {
    setConfirmModal({ isOpen: false, title: '', message: '', type: 'warning' });
    setSyncing(true);
    setResult(null);
    resetSyncSteps();
    updateSyncStep('prepare', false, true);
    setSyncProgress({ stage: 'fetching', currentBatch: 0, totalBatches: 0, percentage: 0, details: 'Preparing sync...' });
    addLog(`Syncing to Firestore collection "${mappingConfig.collection}"...`, 'info');

    try {
      const activeSource = sourceMode === 'excel' ? excelFile : sheetUrl.trim();
      // syncSourceToFirestore takes a single options object. Passing positional
      // arguments made every named parameter undefined, so it threw on
      // `mappingConfig.collection` before parsing anything.
      await syncSourceToFirestore({
        source: activeSource,
        mappingConfig,
        customMappings: resolvedMappings,
        callbacks: {
          onProgress: (msg, progress) => {
            if (msg) addLog(msg, 'info');
            if (progress) {
              setSyncProgress(progress);
              switch (progress.stage) {
                case 'fetching':
                  if (progress.percentage <= 10) {
                    updateSyncStep('prepare', true);
                    updateSyncStep('fetch', false, true);
                  }
                  break;
                case 'processing':
                  updateSyncStep('fetch', true);
                  updateSyncStep('process', false, true);
                  break;
                case 'uploading':
                  updateSyncStep('process', true);
                  updateSyncStep('upload', false, true);
                  break;
                case 'completed':
                  updateSyncStep('upload', true);
                  updateSyncStep('complete', true, true);
                  break;
                default:
                  break;
              }
            }
          },
          onComplete: (res) => {
            updateSyncStep('complete', true, false);
            setSyncProgress({ stage: 'completed', currentBatch: 0, totalBatches: 0, percentage: 100, details: 'Sync completed successfully!' });
            setResult(res);
            if (res.errors.length > 0) {
              addLog(`${res.errors.length} errors encountered during sync.`, 'warning');
            } else {
              addLog(
                `Sync successful! ${res.created} records created, ${res.updated} records updated.`,
                'success'
              );
            }
            if (onSyncCompleted) {
              onSyncCompleted(res);
            }
          },
          onError: (err) => {
            addLog(`Sync failed: ${err.message}`, 'error');
            setSyncProgress({ stage: 'error', currentBatch: 0, totalBatches: 0, percentage: 0, details: `Error: ${err.message}` });
            resetSyncSteps();
          },
        },
      });
    } catch (err) {
      addLog(`Unexpected sync error: ${err.message}`, 'error');
      setSyncProgress({ stage: 'error', currentBatch: 0, totalBatches: 0, percentage: 0, details: `Error: ${err.message}` });
      resetSyncSteps();
    } finally {
      setSyncing(false);
      setTimeout(() => {
        setSyncProgress({ stage: '', currentBatch: 0, totalBatches: 0, percentage: 0, details: '' });
        if (!result || result.errors.length === 0) {
          resetSyncSteps();
        }
      }, 5000);
    }
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h3 className={styles.title}>
            <Sparkles size={20} className={styles.sparkleIcon} />
            Smart Sheet & Excel Sync
          </h3>
          <p className={styles.subtitle}>
            Dynamically extracts crucial fields like <strong>FULL NAME</strong>, <strong>EMAIL</strong>,{' '}
            <strong>CONTACT</strong>, and <strong>ORDER DETAILS</strong> from Google Sheets or Excel files
            and uploads them to Firebase.
          </p>
        </div>
      </div>

      {/* Mode Selector (Excel File vs Google Sheets URL) */}
      <div className={styles.modeTabs}>
        <button
          className={`${styles.modeTab} ${sourceMode === 'excel' ? styles.modeTabActive : ''}`}
          onClick={() => {
            setSourceMode('excel');
            clearState();
          }}
          type="button"
        >
          <FileSpreadsheet size={18} />
          Upload Excel File (.xlsx, .xls, .csv)
        </button>

        <button
          className={`${styles.modeTab} ${sourceMode === 'sheets' ? styles.modeTabActive : ''}`}
          onClick={() => {
            setSourceMode('sheets');
            clearState();
          }}
          type="button"
        >
          <Link size={18} />
          Google Sheets Web Link
        </button>
      </div>

      {/* Target Collection Type */}
      <div className={styles.section}>
        <label className={styles.label}>Target Database Collection</label>
        <div className={styles.typeSelector}>
          {Object.entries(allMappings).map(([key, m]) => (
            <button
              key={key}
              type="button"
              className={`${styles.typeBtn} ${selectedType === key ? styles.typeBtnActive : ''}`}
              onClick={() => {
                setSelectedType(key);
                clearState();
              }}
              disabled={syncing}
            >
              {key === 'orders' ? '📦' : '🏷️'} {m.label} ({m.collection})
            </button>
          ))}
        </div>
      </div>

      {/* Excel Upload Area */}
      {sourceMode === 'excel' && (
        <div className={styles.section}>
          <label className={styles.label}>Upload File</label>
          <div
            className={`${styles.dropzone} ${isDragOver ? styles.dropzoneActive : ''} ${excelFile ? styles.dropzoneHasFile : ''
              }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv"
              style={{ display: 'none' }}
              onChange={(e) => handleFileChange(e.target.files?.[0])}
            />
            <div className={styles.dropzoneContent}>
              <div className={styles.dropzoneIconWrapper}>
                <FileSpreadsheet size={32} />
              </div>
              {excelFile ? (
                <div>
                  <div className={styles.selectedFileName}>{excelFile.name}</div>
                  <div className={styles.selectedFileSize}>
                    {(excelFile.size / 1024).toFixed(1)} KB • Uploaded & Ready
                  </div>
                  <button
                    type="button"
                    className={styles.changeFileBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExcelFile(null);
                      clearState();
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >
                    <RefreshCw size={14} /> Upload Different / Wrong Excel File
                  </button>
                </div>
              ) : (
                <div>
                  <p className={styles.dropzoneTitle}>
                    Drag & Drop your Excel or CSV file here, or <span className={styles.browseLink}>browse</span>
                  </p>
                  <p className={styles.dropzoneHint}>Supports Microsoft Excel (.xlsx, .xls) and CSV</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Google Sheets URL Input */}
      {sourceMode === 'sheets' && (
        <div className={styles.section}>
          <label className={styles.label}>Google Sheet URL</label>
          <div className={styles.urlInputGroup}>
            <input
              type="text"
              className={styles.urlInput}
              placeholder="https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit?usp=sharing"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              disabled={syncing}
            />
            <button
              type="button"
              className={styles.fetchBtn}
              onClick={() => processData()}
              disabled={syncing || previewLoading || !sheetUrl.trim()}
            >
              {previewLoading ? <RefreshCw size={16} className={styles.spin} /> : <Upload size={16} />}
              Load & Detect
            </button>
          </div>
          <p className={styles.hint}>
            <Info size={13} />
            Make sure the sheet is published: <strong>File → Share → Publish to web → CSV</strong>
          </p>
        </div>
      )}

      {/* Dynamic Keyword Detection Results */}
      {detectedColumns.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeaderRow}>
            <label className={styles.label}>
              <Sparkles size={14} className={styles.sparkleSmall} />
              Dynamic Keyword Matching Algorithm Results
            </label>
            <button
              type="button"
              className={styles.toggleAdjusterBtn}
              onClick={() => setShowMappingAdjuster(!showMappingAdjuster)}
            >
              <SlidersHorizontal size={14} />
              {showMappingAdjuster ? 'Hide Column Adjuster' : 'Customize Column Matches'}
              {showMappingAdjuster ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>

          <div className={styles.algorithmCardsGrid}>
            {Object.entries(matchesInfo)
              .filter(([_, info]) => info.isImportant || info.matchedColumn)
              .map(([field, info]) => (
                <div
                  key={field}
                  className={`${styles.algoCard} ${info.matchedColumn ? styles.algoCardMatched : styles.algoCardMissing
                    }`}
                >
                  <div className={styles.algoCardTop}>
                    <span className={styles.algoFieldLabel}>{info.targetLabel}</span>
                    {info.matchedColumn ? (
                      <span className={styles.algoBadgeSuccess}>
                        <Check size={12} /> Detected
                      </span>
                    ) : (
                      <span className={styles.algoBadgeMissing}>
                        <AlertTriangle size={12} /> Unmapped
                      </span>
                    )}
                  </div>
                  <div className={styles.algoCardMatch}>
                    {info.matchedColumn ? (
                      <div className={styles.matchedColName}>
                        Sheet Column: <strong>"{resolvedMappings[field]}"</strong>
                      </div>
                    ) : (
                      <div className={styles.unmatchedColName}>Not found in sheet (default used)</div>
                    )}
                  </div>
                </div>
              ))}
          </div>

          {/* Detailed column adjustment table if toggled */}
          {showMappingAdjuster && (
            <div className={styles.adjusterContainer}>
              <div className={styles.adjusterHeader}>
                <span>Target Field</span>
                <span>Detected Sheet Column</span>
              </div>
              {Object.entries(mappingConfig.fieldMappings).map(([field, label]) => (
                <div key={field} className={styles.adjusterRow}>
                  <div className={styles.adjusterFieldCol}>
                    <strong>{label}</strong>
                    <span className={styles.adjusterFieldPath}>{field}</span>
                  </div>
                  <div className={styles.adjusterSelectCol}>
                    <select
                      className={styles.columnSelect}
                      value={resolvedMappings[field] || ''}
                      onChange={(e) => handleOverrideColumn(field, e.target.value)}
                    >
                      <option value="">-- Do Not Extract / Skip --</option>
                      {detectedColumns.map((col) => (
                        <option key={col} value={col}>
                          {col} {resolvedMappings[field] === col ? '(Detected)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Summary Stats */}
      {previewSummary && (
        <div className={styles.previewSummary}>
          <div className={styles.previewStat}>
            <span className={styles.previewStatValue}>{previewSummary.totalRows}</span>
            <span className={styles.previewStatLabel}>Total Rows</span>
          </div>
          <div className={styles.previewStat}>
            <span className={styles.previewStatValue}>{previewSummary.matchedFields}</span>
            <span className={styles.previewStatLabel}>Matched Fields</span>
          </div>
          <div className={styles.previewStat}>
            <span className={styles.previewStatValue}>{previewSummary.validDocs}</span>
            <span className={styles.previewStatLabel}>Valid for Sync</span>
          </div>
          <div className={styles.previewStat}>
            <span className={styles.previewStatValue}>{previewSummary.errorsCount}</span>
            <span className={styles.previewStatLabel}>Parse Errors</span>
          </div>
          <div className={styles.previewStat}>
            <span className={`${styles.previewStatValue} ${previewSummary.autoGeneratedIds > 0 ? styles.previewStatWarning : ''}`}>
              {previewSummary.autoGeneratedIds}
            </span>
            <span className={styles.previewStatLabel}>Auto-Generated IDs</span>
          </div>
        </div>
      )}

      {/* Sample Extracted Records Preview */}
      {previewDocs.length > 0 && (
        <div className={styles.section}>
          <label className={styles.label}>
            Sample Extracted Records (First {previewDocs.length} shown)
          </label>
          <div className={styles.sampleTableWrapper}>
            <table className={styles.sampleTable}>
              <thead>
                <tr>
                  {selectedType === 'orders' ? (
                    <>
                      <th>Order ID</th>
                      <th>Full Name</th>
                      <th>Email</th>
                      <th>Contact</th>
                      <th>Product</th>
                      <th>Quantity</th>
                      <th>Total Price</th>
                    </>
                  ) : (
                    <>
                      <th>Product ID</th>
                      <th>Product Name</th>
                      <th>Price</th>
                      <th>Stock</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {previewDocs.map((doc, idx) => (
                  <tr key={idx}>
                    {selectedType === 'orders' ? (
                      <>
                        <td className={styles.codeCell}>
                          {doc.orderId || 'Auto-generated'}
                          {doc._autoGeneratedId && (
                            <span className={styles.autoIdBadge} title="No Order ID found in sheet — generated automatically">
                              auto
                            </span>
                          )}
                        </td>
                        <td className={styles.highlightName}>
                          {doc.customerInfo?.fullName || '—'}
                        </td>
                        <td className={styles.highlightEmail}>
                          {doc.customerInfo?.email || '—'}
                        </td>
                        <td>{doc.customerInfo?.phoneNumber || '—'}</td>
                        <td>{doc.productInfo?.productName || '—'}</td>
                        <td>{doc.productInfo?.quantity}</td>
                        <td>₱{Number(doc.productInfo?.totalPrice || 0).toFixed(2)}</td>
                      </>
                    ) : (
                      <>
                        <td className={styles.codeCell}>{doc.productId}</td>
                        <td className={styles.highlightName}>{doc.productName}</td>
                        <td>₱{Number(doc.price || 0).toFixed(2)}</td>
                        <td>{doc.stockAvailable}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Main Action Buttons */}
      <div className={styles.actions}>
        {(excelFile || sheetUrl.trim()) && (
          <button
            type="button"
            className={styles.resetFileBtn}
            onClick={() => {
              setExcelFile(null);
              setSheetUrl('');
              clearState();
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
            disabled={syncing}
            title="Clear current file/link and select a different file"
          >
            <RefreshCw size={16} /> Upload Another / Replace File
          </button>
        )}

        <button
          type="button"
          className={styles.previewBtn}
          onClick={() => processData()}
          disabled={syncing || previewLoading || (!excelFile && !sheetUrl.trim())}
        >
          {previewLoading ? (
            <>
              <RefreshCw size={16} className={styles.spin} /> Processing...
            </>
          ) : (
            <>
              <Upload size={16} /> Preview Extraction
            </>
          )}
        </button>

        <button
          type="button"
          className={styles.syncBtn}
          onClick={handleExecuteSync}
          disabled={syncing || (!excelFile && !sheetUrl.trim()) || (previewSummary && previewSummary.validDocs === 0)}
        >
          {syncing ? (
            <>
              <RefreshCw size={16} className={styles.spin} /> Uploading to Firebase...
            </>
          ) : (
            <>
              <RefreshCw size={16} /> Sync to Firebase Database
            </>
          )}
        </button>
      </div>

      {/* Step-by-Step Sync Progress */}
      {syncing && (
        <div className={styles.section}>
          <div className={styles.stepProgressContainer}>
            <div className={styles.stepProgressHeader}>
              <label className={styles.label}>Sync Progress Steps</label>
            </div>
            <div className={styles.stepsContainer}>
              {syncSteps.map((step, index) => (
                <div key={step.id} className={styles.stepWrapper}>
                  <div 
                    className={`${styles.step} ${
                      step.completed ? styles.stepCompleted : 
                      step.active ? styles.stepActive : styles.stepPending
                    }`}
                  >
                    <div className={styles.stepNumber}>
                      {step.completed ? (
                        <CheckCircle size={16} />
                      ) : step.active ? (
                        <RefreshCw size={16} className={styles.spin} />
                      ) : (
                        <span>{index + 1}</span>
                      )}
                    </div>
                    <div className={styles.stepContent}>
                      <div className={styles.stepName}>{step.name}</div>
                      {step.active && syncProgress.details && (
                        <div className={styles.stepDetails}>{syncProgress.details}</div>
                      )}
                    </div>
                  </div>
                  {index < syncSteps.length - 1 && (
                    <div className={`${styles.stepConnector} ${
                      step.completed ? styles.stepConnectorCompleted : ''
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Progress Indicators */}
      {(previewLoading && processingProgress.stage) && (
        <div className={styles.section}>
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <label className={styles.label}>Processing Progress</label>
              <span className={styles.progressPercent}>{processingProgress.percentage}%</span>
            </div>
            <div className={styles.progressBar}>
              <div 
                className={styles.progressFill} 
                style={{ width: `${processingProgress.percentage}%` }}
              />
            </div>
            <div className={styles.progressDetails}>
              <span className={styles.progressStage}>{processingProgress.stage.toUpperCase()}</span>
              <span className={styles.progressSubstage}>{processingProgress.substage}</span>
              {processingProgress.totalRows > 0 && (
                <span className={styles.progressRows}>
                  Row {processingProgress.currentRow} of {processingProgress.totalRows}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {(syncing && syncProgress.stage) && (
        <div className={styles.section}>
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <label className={styles.label}>Sync Progress</label>
              <span className={styles.progressPercent}>{syncProgress.percentage}%</span>
            </div>
            <div className={styles.progressBar}>
              <div 
                className={styles.progressFill} 
                style={{ width: `${syncProgress.percentage}%` }}
              />
            </div>
            <div className={styles.progressDetails}>
              <span className={styles.progressStage}>{syncProgress.stage.toUpperCase()}</span>
              <span className={styles.progressSubstage}>{syncProgress.details}</span>
              {syncProgress.totalBatches > 0 && (
                <span className={styles.progressRows}>
                  Batch {syncProgress.currentBatch} of {syncProgress.totalBatches}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Results Alert */}
      {result && (
        <div
          className={`${styles.resultBanner} ${result.errors.length > 0 ? styles.resultWarning : styles.resultSuccess
            }`}
        >
          {result.errors.length > 0 ? <AlertTriangle size={22} /> : <CheckCircle size={22} />}
          <div>
            <strong>Sync to Firebase Completed!</strong>
            <p>
              Created: <strong>{result.created}</strong> | Updated: <strong>{result.updated}</strong> |{' '}
              Errors: <strong>{result.errors.length}</strong>
            </p>
          </div>
        </div>
      )}

      {/* Live Sync Log */}
      {logs.length > 0 && (
        <div className={styles.section}>
          <div className={styles.logsHeader}>
            <label className={styles.label}>Execution & Extraction Logs</label>
            <button className={styles.clearLogsBtn} onClick={() => setLogs([])} type="button">
              Clear Logs
            </button>
          </div>
          <div className={styles.logsContainer} ref={logsRef}>
            {logs.map((log, i) => (
              <div
                key={i}
                className={`${styles.logEntry} ${styles[`log${log.type.charAt(0).toUpperCase() + log.type.slice(1)}`]
                  }`}
              >
                <span className={styles.logTime}>{log.time}</span>
                <span className={styles.logMessage}>{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <AlertTriangle className={styles.modalWarningIcon} size={24} />
              <h4>{confirmModal.title}</h4>
            </div>
            <div className={styles.modalBody}>
              <p>{confirmModal.message}</p>
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                onClick={() => {
                  setConfirmModal({ isOpen: false, title: '', message: '', type: 'warning' });
                  addLog('Sync cancelled by user.', 'info');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.modalOkBtn}
                onClick={performSync}
              >
                OK, Proceed Sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Alert Modal */}
      {successModal.isOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <CheckCircle className={styles.modalSuccessIcon} size={24} />
              <h4>Sync Completed Successfully!</h4>
            </div>
            <div className={styles.modalBody}>
              <p>Your Excel data has been successfully processed and synced to Firebase.</p>
              <div className={styles.modalStatsRow}>
                <span>Created: <strong>{successModal.created}</strong></span>
                <span>Updated: <strong>{successModal.updated}</strong></span>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.modalOkBtn}
                onClick={() => setSuccessModal({ isOpen: false, created: 0, updated: 0 })}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SheetSyncPanel;
