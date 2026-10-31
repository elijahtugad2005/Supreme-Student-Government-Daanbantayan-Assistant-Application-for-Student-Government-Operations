import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, deleteDoc, runTransaction } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBPxd8ag3HyPM6qywsDdpM-cgCXCdjWBVo",
  authDomain: "ssg-prototype.firebaseapp.com",
  projectId: "ssg-prototype",
  storageBucket: "ssg-prototype.firebasestorage.app",
  messagingSenderId: "661854012909",
  appId: "1:661854012909:web:1fd13f3d5cc29260e7d3e4",
  measurementId: "G-BD6BHD6F0J"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function healDatabase() {
  console.log('====================================================');
  console.log('EXECUTING FINANCE DATABASE HEALING & INTEGRITY RECOVERY');
  console.log('====================================================');

  // Step 1: Remove duplicate transaction LThozRovHIhhOvE6edts and adjust IGF balance
  console.log('\n[Step 1] Resolving duplicate transaction LThozRovHIhhOvE6edts...');
  const dupTxSnap = await getDoc(doc(db, 'transactions', 'LThozRovHIhhOvE6edts'));
  if (dupTxSnap.exists()) {
    const dupData = dupTxSnap.data();
    console.log(`Found duplicate transaction: ref=${dupData.refNumber}, amountCentavos=${dupData.amountCentavos}`);
    
    // Decrement fund_igf_main balanceCentavos by 10000 (duplicate credit)
    const igfRef = doc(db, 'fundAccounts', 'fund_igf_main');
    const igfSnap = await getDoc(igfRef);
    if (igfSnap.exists()) {
      const currentBal = igfSnap.data().balanceCentavos || 0;
      const newBal = Math.max(0, currentBal - dupData.amountCentavos);
      await updateDoc(igfRef, {
        balanceCentavos: newBal,
        lastHoldingReconciliationReason: 'Removed duplicate transaction LThozRovHIhhOvE6edts'
      });
      console.log(`Adjusted fund_igf_main balanceCentavos: ${currentBal} -> ${newBal} (₱${(newBal / 100).toFixed(2)})`);
    }

    // Delete the duplicate transaction record
    await deleteDoc(doc(db, 'transactions', 'LThozRovHIhhOvE6edts'));
    console.log('Successfully deleted duplicate transaction LThozRovHIhhOvE6edts.');
  } else {
    console.log('Duplicate transaction LThozRovHIhhOvE6edts already removed.');
  }

  // Step 2: Disambiguate overlapping transaction reference numbers
  console.log('\n[Step 2] Disambiguating colliding transaction references for ORD-DB-0001...');
  const disambiguationMap = [
    {
      txId: '1PcLmf2BmfH7VAxRdqAY',
      orderDocId: 'tfyxj2ch1UBFWeAIM78J',
      newRef: 'IGF-ORD-ORD-DB-0001-EAIM78J'
    },
    {
      txId: 'PXQ1udNPA5KsmD3nR5aJ',
      orderDocId: 'HCX2z4XVwPX75ZZ6Mu3q',
      newRef: 'IGF-ORD-ORD-DB-0001-Z6MU3Q'
    },
    {
      txId: 'VUY2rk3XVvGS2bCEDIML',
      orderDocId: 'DveAUC0Fat6pyxRVNVM4',
      newRef: 'IGF-ORD-ORD-DB-0001-RVNVM4'
    },
    {
      txId: 'Vm8BIX4K7f8cK4DS2wE7',
      orderDocId: 'nnno3zTloNvAVWLowl6o',
      newRef: 'IGF-ORD-ORD-DB-0001-OWL6O'
    },
    {
      txId: 'yRv5dGf4BargyRxlVqDd',
      orderDocId: 'JFZ9Lm0zdkE0PnvDUMie',
      newRef: 'IGF-ORD-ORD-DB-0001-NDUMIE'
    }
  ];

  for (const item of disambiguationMap) {
    // Update Transaction
    const txDocRef = doc(db, 'transactions', item.txId);
    const txSnap = await getDoc(txDocRef);
    if (txSnap.exists()) {
      await updateDoc(txDocRef, {
        refNumber: item.newRef,
        updatedAt: new Date().toISOString()
      });
      console.log(`Updated transaction [${item.txId}]: refNumber -> "${item.newRef}"`);
    }

    // Update corresponding Order
    const orderDocRef = doc(db, 'orders', item.orderDocId);
    const orderSnap = await getDoc(orderDocRef);
    if (orderSnap.exists()) {
      await updateDoc(orderDocRef, {
        igfTxRef: item.newRef,
        updatedAt: new Date().toISOString()
      });
      console.log(`Updated order [${item.orderDocId}]: igfTxRef -> "${item.newRef}"`);
    }
  }

  console.log('\n====================================================');
  console.log('DATABASE HEALING COMPLETE');
  console.log('====================================================');
}

healDatabase().catch(console.error);
