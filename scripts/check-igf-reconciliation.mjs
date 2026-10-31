import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';

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

async function checkOrderAndIGF() {
  const orderSnap = await getDoc(doc(db, 'orders', '2YstKrt49Y897uDIzJJX'));
  console.log('Order 2YstKrt49Y897uDIzJJX:', orderSnap.exists() ? orderSnap.data() : 'NOT FOUND');

  const igfSnap = await getDoc(doc(db, 'fundAccounts', 'fund_igf_main'));
  console.log('IGF Fund Account:', igfSnap.exists() ? igfSnap.data() : 'NOT FOUND');

  // Also sum all transactions on fund_igf_main
  const txSnaps = await getDocs(collection(db, 'transactions'));
  let totalTxCentavos = 0;
  let count = 0;
  txSnaps.forEach(d => {
    const data = d.data();
    if (data.fundAccountId === 'fund_igf_main') {
      count++;
      if (data.transactionType === 'disbursement') {
        totalTxCentavos -= (data.amountCentavos || 0);
      } else {
        totalTxCentavos += (data.amountCentavos || 0);
      }
      console.log(`TX [${d.id}]: ref=${data.refNumber}, type=${data.transactionType}, amount=${data.amountCentavos / 100}, orderDocId=${data.orderDocId}`);
    }
  });

  console.log(`\nTotal Transactions for IGF: ${count}`);
  console.log(`Sum of transaction amounts: ₱${(totalTxCentavos / 100).toFixed(2)}`);
  console.log(`IGF Recorded balanceCentavos: ₱${((igfSnap.data()?.balanceCentavos || 0) / 100).toFixed(2)}`);
}

checkOrderAndIGF().catch(console.error);
