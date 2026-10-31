import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

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

async function inspectDuplicates() {
  console.log('--- Inspecting Duplicates ---');

  const orderIds = [
    'HCX2z4XVwPX75ZZ6Mu3q',
    'JFZ9Lm0zdkE0PnvDUMie',
    'nnno3zTloNvAVWLowl6o',
    'tfyxj2ch1UBFWeAIM78J'
  ];

  for (const docId of orderIds) {
    const snap = await getDoc(doc(db, 'orders', docId));
    if (snap.exists()) {
      const d = snap.data();
      console.log(`Order doc [${docId}]: orderId=${d.orderId}, customer=${d.customerInfo?.fullName || d.customerName}, product=${d.productInfo?.productName || d.productName}, total=${d.totalPrice || d.productInfo?.totalPrice}, igfTxRef=${d.igfTxRef}, igfSynced=${d.igfSynced}`);
    } else {
      console.log(`Order doc [${docId}] NOT FOUND`);
    }
  }

  const txIds = [
    'LThozRovHIhhOvE6edts',
    '0tYY24b27Qh6cqfpP1MA',
    'PXQ1udNPA5KsmD3nR5aJ',
    'VUY2rk3XVvGS2bCEDIML',
    'Vm8BIX4K7f8cK4DS2wE7',
    'yRv5dGf4BargyRxlVqDd',
    '1PcLmf2BmfH7VAxRdqAY'
  ];

  for (const docId of txIds) {
    const snap = await getDoc(doc(db, 'transactions', docId));
    if (snap.exists()) {
      const d = snap.data();
      console.log(`Transaction doc [${docId}]: refNumber=${d.refNumber}, orderId=${d.orderId}, orderDocId=${d.orderDocId}, amountCentavos=${d.amountCentavos}, payeeOrPayer=${d.payeeOrPayer}, desc=${d.description}`);
    } else {
      console.log(`Transaction doc [${docId}] NOT FOUND`);
    }
  }
}

inspectDuplicates().catch(console.error);
