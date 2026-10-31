
import React, { createContext, useState, useContext, useEffect } from 'react';
import { db } from "../../firebase/firebaseConfig.js";
import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp 
} from 'firebase/firestore';

const InventoryContext = createContext();

export const useInventory = () => useContext(InventoryContext);

export function InventoryProvider({ children }) {
  const [inventory, setInventory] = useState([]);
  const [categories] = useState([
    'Event Materials',
    'Office Supplies', 
    'Electronic Equipment',
    'Furniture',
    'Tools',
    'Consumables',
    'Merchandise'
  ]);
  const [loading, setLoading] = useState(false);
  const [borrowedItems, setBorrowedItems] = useState([]);

  // Fetch all inventory items
  const fetchInventory = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'inventory'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const items = [];
      querySnapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() });
      });
      setInventory(items);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch borrowed items
  const fetchBorrowedItems = async () => {
    try {
      const q = query(collection(db, 'borrowingLogs'), 
        orderBy('borrowDate', 'desc'));
      const querySnapshot = await getDocs(q);
      const items = [];
      querySnapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() });
      });
      setBorrowedItems(items);
    } catch (error) {
      console.error('Error fetching borrowed items:', error);
    }
  };

  // Add new inventory item
  const addInventoryItem = async (itemData) => {
    try {
      const docRef = await addDoc(collection(db, 'inventory'), {
        ...itemData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await fetchInventory(); // Refresh the list
      return docRef.id;
    } catch (error) {
      console.error('Error adding inventory:', error);
      throw error;
    }
  };

  // Update inventory item
  const updateInventoryItem = async (itemId, updatedData) => {
    try {
      const itemRef = doc(db, 'inventory', itemId);
      await updateDoc(itemRef, {
        ...updatedData,
        updatedAt: serverTimestamp(),
      });

      // Synchronize with linked product in Product Management if applicable
      const currentItem = inventory.find(i => i.id === itemId);
      const linkedProductId = updatedData.linkedProductId || currentItem?.linkedProductId;
      if (linkedProductId) {
        try {
          const prodQ = query(collection(db, 'products'), where('productId', '==', linkedProductId));
          const prodSnap = await getDocs(prodQ);
          if (!prodSnap.empty) {
            const prodUpdate = { updatedAt: new Date().toISOString() };
            if (updatedData.quantity !== undefined) prodUpdate.stockAvailable = updatedData.quantity;
            if (updatedData.amount !== undefined) prodUpdate.price = updatedData.amount;
            if (updatedData.name !== undefined) prodUpdate.productName = updatedData.name;
            await updateDoc(doc(db, 'products', prodSnap.docs[0].id), prodUpdate);
          }
        } catch (syncErr) {
          console.warn('Sync inventory update to product error:', syncErr);
        }
      }

      await fetchInventory(); // Refresh the list
    } catch (error) {
      console.error('Error updating inventory:', error);
      throw error;
    }
  };

  // Delete inventory item
  const deleteInventoryItem = async (itemId) => {
    try {
      await deleteDoc(doc(db, 'inventory', itemId));
      await fetchInventory(); // Refresh the list
    } catch (error) {
      console.error('Error deleting inventory:', error);
      throw error;
    }
  };

  // Borrow item
  const borrowItem = async (borrowData) => {
    try {
      const docRef = await addDoc(collection(db, 'borrowingLogs'), {
        ...borrowData,
        borrowDate: serverTimestamp(),
        status: 'borrowed',
        returned: false,
      });
      
      // Update inventory quantity
      const itemRef = doc(db, 'inventory', borrowData.itemId);
      const item = inventory.find(i => i.id === borrowData.itemId);
      if (item) {
        const newQuantity = Math.max(0, item.quantity - borrowData.quantityBorrowed);
        await updateDoc(itemRef, {
          quantity: newQuantity
        });

        // Sync with linked Product in Commerce / Product Management
        if (item.linkedProductId) {
          try {
            const prodQ = query(collection(db, 'products'), where('productId', '==', item.linkedProductId));
            const prodSnap = await getDocs(prodQ);
            if (!prodSnap.empty) {
              await updateDoc(doc(db, 'products', prodSnap.docs[0].id), {
                stockAvailable: newQuantity,
                updatedAt: new Date().toISOString(),
              });
            }
          } catch (syncErr) {
            console.warn('Sync borrowed quantity to product error:', syncErr);
          }
        }
      }
      
      await fetchInventory();
      await fetchBorrowedItems();
      return docRef.id;
    } catch (error) {
      console.error('Error borrowing item:', error);
      throw error;
    }
  };

  // Return item
  const returnItem = async (logId, returnData) => {
    try {
      const logRef = doc(db, 'borrowingLogs', logId);
      await updateDoc(logRef, {
        returnDate: serverTimestamp(),
        returnNotes: returnData.notes || '',
        returned: true,
        status: 'returned',
        conditionOnReturn: returnData.condition || 'good'
      });
      
      // Update inventory quantity
      const logItem = borrowedItems.find(i => i.id === logId);
      if (logItem) {
        const itemRef = doc(db, 'inventory', logItem.itemId);
        const item = inventory.find(i => i.id === logItem.itemId);
        if (item) {
          const newQuantity = item.quantity + logItem.quantityBorrowed;
          await updateDoc(itemRef, {
            quantity: newQuantity
          });

          // Sync return with linked Product in Commerce / Product Management
          if (item.linkedProductId) {
            try {
              const prodQ = query(collection(db, 'products'), where('productId', '==', item.linkedProductId));
              const prodSnap = await getDocs(prodQ);
              if (!prodSnap.empty) {
                await updateDoc(doc(db, 'products', prodSnap.docs[0].id), {
                  stockAvailable: newQuantity,
                  updatedAt: new Date().toISOString(),
                });
              }
            } catch (syncErr) {
              console.warn('Sync returned quantity to product error:', syncErr);
            }
          }
        }
      }
      
      await fetchInventory();
      await fetchBorrowedItems();
    } catch (error) {
      console.error('Error returning item:', error);
      throw error;
    }
  };

  // Convert image to base64
  const convertImageToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
    });
  };

  useEffect(() => {
    fetchInventory();
    fetchBorrowedItems();
  }, []);

  const value = {
    inventory,
    categories,
    loading,
    borrowedItems,
    addInventoryItem,
    updateInventoryItem,
    deleteInventoryItem,
    borrowItem,
    returnItem,
    convertImageToBase64,
    fetchInventory,
    fetchBorrowedItems,
  };

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
}

export default InventoryProvider;
