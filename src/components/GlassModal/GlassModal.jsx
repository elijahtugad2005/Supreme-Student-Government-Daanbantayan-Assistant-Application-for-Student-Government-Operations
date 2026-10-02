// components/GlassModal/GlassModal.jsx
// PURPOSE: Frosted-glass replacement for window.alert / window.confirm.
// FEATURES:
//   - info (single "OK") and confirm (Cancel / action) modes
//   - Closes on overlay click and on the Escape key
//   - Tone variants: info, success, error, danger
//   - Children render as the message body, so rich content is allowed

import React, { useEffect } from 'react';
import styles from './GlassModal.module.css';

function GlassModal({
  open,
  tone = 'info',
  title = '',
  message,
  children,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  showCancel = false,
  onConfirm,
  onCancel,
}) {
  // Escape closes the dialog, matching native confirm behaviour
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const toneClass = styles[tone] ? styles[tone] : styles.info;

  return (
    <div
      className={styles.overlay}
      onClick={() => onCancel?.()}
      role="presentation"
    >
      <div
        className={`${styles.modal} ${toneClass}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Dialog'}
      >
        <span className={styles.glow} aria-hidden="true" />
        <span className={styles.glowAlt} aria-hidden="true" />

        {title && <h3 className={styles.title}>{title}</h3>}

        <div className={styles.body}>
          {message && <p className={styles.message}>{message}</p>}
          {children}
        </div>

        <div className={styles.actions}>
          {showCancel && (
            <button type="button" className={styles.cancelBtn} onClick={() => onCancel?.()}>
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={styles.confirmBtn}
            onClick={() => onConfirm?.()}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default GlassModal;
