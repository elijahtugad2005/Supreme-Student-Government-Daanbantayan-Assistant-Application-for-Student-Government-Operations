// hooks/useCurrentTerm.js
// PURPOSE: Single source of truth for which academic term is "current".
// USAGE:
//   const { allTerms, currentTerm, setCurrentTerm, savingCurrent } = useCurrentTerm();
//
// The pinned term lives in settings/app. When no term has been pinned yet the
// newest term wins, so the app behaves exactly as it did before this hook.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc, collection } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { DEFAULT_TERMS } from '../components/orgUtils';

const SETTINGS_DOC_ID = 'app';

export function useCurrentTerm() {
    const [savedTerms, setSavedTerms] = useState([]);
    const [pinnedTerm, setPinnedTerm] = useState(null);
    const [savingCurrent, setSavingCurrent] = useState(false);

    // ── Every term that has ever been created ──
    useEffect(() => {
        return onSnapshot(
            collection(db, 'terms'),
            (snap) => setSavedTerms(snap.docs.map((d) => d.id)),
            (err) => console.error('terms listener:', err)
        );
    }, []);

    // ── Which one is flagged as current ──
    useEffect(() => {
        return onSnapshot(
            doc(db, 'settings', SETTINGS_DOC_ID),
            (snap) => setPinnedTerm(snap.exists() ? snap.data().currentTerm || null : null),
            (err) => console.error('settings listener:', err)
        );
    }, []);

    const allTerms = useMemo(
        () => Array.from(new Set([...DEFAULT_TERMS, ...savedTerms])).sort().reverse(),
        [savedTerms]
    );

    // Fall back to the newest term so the app always has a usable value.
    const currentTerm = useMemo(() => {
        if (pinnedTerm && allTerms.includes(pinnedTerm)) return pinnedTerm;
        return allTerms[0] || null;
    }, [pinnedTerm, allTerms]);

    const setCurrentTerm = useCallback(async (term) => {
        if (!term) return;
        setSavingCurrent(true);
        try {
            await setDoc(
                doc(db, 'settings', SETTINGS_DOC_ID),
                { currentTerm: term, updatedAt: new Date() },
                { merge: true }
            );
        } catch (error) {
            console.error('Error setting current term:', error);
            throw error;
        } finally {
            setSavingCurrent(false);
        }
    }, []);

    return { allTerms, currentTerm, pinnedTerm, setCurrentTerm, savingCurrent };
}

export default useCurrentTerm;