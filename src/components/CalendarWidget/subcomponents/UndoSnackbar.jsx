// components/CalendarWidget/subcomponents/UndoSnackbar.jsx
import React, { useEffect, useState } from 'react';
import { FiRotateCcw, FiCheckCircle, FiX } from 'react-icons/fi';
import styles from './InlineCalendarStyles.module.css';

export default function UndoSnackbar({ message, onUndo, onDismiss, durationSeconds = 8 }) {
  const [secondsRemaining, setSecondsRemaining] = useState(durationSeconds);

  useEffect(() => {
    if (secondsRemaining <= 0) {
      onDismiss();
      return;
    }

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsRemaining, onDismiss]);

  return (
    <div className={styles.undoSnackbarContainer}>
      <div className={styles.undoLeft}>
        <FiCheckCircle className={styles.undoSuccessIcon} />
        <span className={styles.undoMessage}>{message}</span>
      </div>

      <div className={styles.undoRight}>
        <button type="button" onClick={onUndo} className={styles.undoButton}>
          <FiRotateCcw /> Undo ({secondsRemaining}s)
        </button>
        <button type="button" onClick={onDismiss} className={styles.undoDismissBtn} aria-label="Dismiss">
          <FiX />
        </button>
      </div>
    </div>
  );
}
