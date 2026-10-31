import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

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

async function inspectFundAccountsAndAllocations() {
  console.log('=== FUND ACCOUNTS ===');
  const funds = await getDocs(collection(db, 'fundAccounts'));
  funds.forEach(doc => {
    console.log(`[${doc.id}]:`, JSON.stringify(doc.data(), null, 2));
  });

  console.log('\n=== BUDGET ALLOCATIONS ===');
  const allocs = await getDocs(collection(db, 'budgetAllocations'));
  allocs.forEach(doc => {
    console.log(`[${doc.id}]:`, JSON.stringify(doc.data(), null, 2));
  });
}

inspectFundAccountsAndAllocations().catch(console.error);
