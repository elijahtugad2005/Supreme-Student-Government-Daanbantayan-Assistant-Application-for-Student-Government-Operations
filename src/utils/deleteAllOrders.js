// src/utils/deleteAllOrders.js
// Temporary script – run once to wipe the entire "orders" collection.
// After execution, you can delete this file.

import { db } from '../firebase/firebaseConfig.js';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';

(async () => {
  console.log('🧹 Starting bulk delete of all orders...');
  try {
    const snapshot = await getDocs(collection(db, 'orders'));
    if (snapshot.empty) {
      console.log('✅ No orders found – nothing to delete.');
      return;
    }
    const deletePromises = snapshot.docs.map((orderDoc) =>
      deleteDoc(doc(db, 'orders', orderDoc.id))
    );
    await Promise.all(deletePromises);
    console.log(`✅ Deleted ${snapshot.size} order(s) successfully!`);
  } catch (error) {
    console.error('❌ Error deleting orders:', error);
  }
  process.exit();
})();
