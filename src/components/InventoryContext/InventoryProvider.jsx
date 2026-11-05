import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { db } from "../../firebase/firebaseConfig.js";
import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  runTransaction,
  increment
} from 'firebase/firestore';
import { INVENTORY_FUND_SOURCES, FUND_ACCOUNT_IDS } from '../../services/inventoryService.js';

const InventoryContext = createContext();

export const useInventory = () => useContext(InventoryContext);

const DEFAULT_CATEGORIES = [
  'Event Materials',
  'Office Supplies', 
  'Electronic Equipment',
  'Furniture',
  'Tools',
  'Consumables',
  'Merchandise'
];

export function InventoryProvider({ children }) {
  const [inventory, setInventory] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(false);
  const [borrowedItems, setBorrowedItems] = useState([]);
  const [fundBalances, setFundBalances] = useState({
    IGF: 0,
    IGP: 0,
  });

  // Fetch real-time available fund balances for IGF & IGP
  const fetchFundBalances = useCallback(async () => {
    try {
      const [igfSnap, igpSnap] = await Promise.all([
        getDoc(doc(db, 'fundAccounts', FUND_ACCOUNT_IDS.IGF)),
        getDoc(doc(db, 'fundAccounts', FUND_ACCOUNT_IDS.IGP)),
      ]);

      setFundBalances({
        IGF: igfSnap.exists() ? (igfSnap.data().balanceCentavos || 0) / 100 : 0,
        IGP: igpSnap.exists() ? (igpSnap.data().balanceCentavos || 0) / 100 : 0,
      });
    } catch (err) {
      console.warn('Could not fetch fund balances:', err);
    }
  }, []);

  // Fetch all inventory items
  const fetchInventory = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'inventory'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const items = [];
      querySnapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...docSnap.data() });
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
      const q = query(collection(db, 'borrowingLogs'), orderBy('borrowDate', 'desc'));
      const querySnapshot = await getDocs(q);
      const items = [];
      querySnapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...docSnap.data() });
      });
      setBorrowedItems(items);
    } catch (error) {
      console.error('Error fetching borrowed items:', error);
    }
  };

  // Add category persistence
  const addCategory = useCallback((newCat) => {
    const trimmed = (newCat || '').trim();
    if (!trimmed) return;
    setCategories((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  }, []);

  // Add new inventory item with atomic ledger debiting and balance checks
  const addInventoryItem = async (itemData) => {
    try {
      const fundSource = (itemData.fundSource || INVENTORY_FUND_SOURCES.IGF).toUpperCase();
      if (fundSource !== INVENTORY_FUND_SOURCES.IGF && fundSource !== INVENTORY_FUND_SOURCES.IGP) {
        throw new Error(`Inventory item must be funded via IGF or IGP. Received: ${itemData.fundSource}`);
      }

      const quantity = parseInt(itemData.quantity, 10) || 0;
      const amount = parseFloat(itemData.amount) || 0;
      const totalCostPhp = amount * quantity;
      const costCentavos = Math.round(totalCostPhp * 100);
      const accountId = FUND_ACCOUNT_IDS[fundSource];

      const newDocId = await runTransaction(db, async (tx) => {
        const fundRef = doc(db, 'fundAccounts', accountId);
        const fundSnap = await tx.get(fundRef);
        const currentBalanceCentavos = fundSnap.exists() ? fundSnap.data().balanceCentavos || 0 : 0;

        if (costCentavos > 0 && currentBalanceCentavos < costCentavos) {
          const availablePhp = (currentBalanceCentavos / 100).toFixed(2);
          const requiredPhp = totalCostPhp.toFixed(2);
          throw new Error(
            `Insufficient ${fundSource} balance. Available: ₱${availablePhp}, Required: ₱${requiredPhp}`
          );
        }

        // Debit the fund account
        if (costCentavos > 0) {
          const newBal = currentBalanceCentavos - costCentavos;
          tx.set(
            fundRef,
            {
              balanceCentavos: newBal,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );

          // Auto-generate expense ledger record in financeTransactions
          const txRef = doc(collection(db, 'financeTransactions'));
          const refNumber = `INV-${fundSource}-${Date.now().toString().slice(-6)}`;
          tx.set(txRef, {
            refNumber,
            fundAccountId: accountId,
            fundCategory: fundSource,
            transactionType: 'EXPENSE',
            expensePurpose: `Inventory Procurement: ${itemData.name}`,
            amountCentavos: costCentavos,
            description: `Procured ${quantity} units of "${itemData.name}" @ ₱${amount.toFixed(2)}/unit`,
            performer: itemData.lastUpdatedBy || 'Authorized Officer',
            status: 'POSTED',
            createdAt: serverTimestamp(),
            postedAt: serverTimestamp(),
          });
        }

        // Create the inventory item document
        const itemRef = doc(collection(db, 'inventory'));
        const itemPayload = {
          name: (itemData.name || '').trim(),
          category: itemData.category || 'Office Supplies',
          quantity,
          amount,
          unitPrice: amount,
          minQuantity: parseInt(itemData.minQuantity, 10) || 5,
          reorderPoint: parseInt(itemData.minQuantity, 10) || 5,
          storageLocation: (itemData.storageLocation || 'Unassigned').trim(),
          description: (itemData.description || '').trim(),
          receipt: itemData.receipt || '',
          fundSource,
          isIGFOrigin: fundSource === 'IGF',
          borrowedCount: 0,
          lastUpdatedBy: itemData.lastUpdatedBy || 'Authorized Officer',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        tx.set(itemRef, itemPayload);
        return itemRef.id;
      });

      await Promise.all([fetchInventory(), fetchFundBalances()]);
      return newDocId;
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
        unitPrice: updatedData.amount !== undefined ? updatedData.amount : undefined,
        reorderPoint: updatedData.minQuantity !== undefined ? updatedData.minQuantity : undefined,
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

      await fetchInventory();
    } catch (error) {
      console.error('Error updating inventory:', error);
      throw error;
    }
  };

  // Delete inventory item
  const deleteInventoryItem = async (itemId) => {
    try {
      await deleteDoc(doc(db, 'inventory', itemId));
      await fetchInventory();
    } catch (error) {
      console.error('Error deleting inventory:', error);
      throw error;
    }
  };

  // Borrow item with atomic transaction and borrowedCount maintenance
  const borrowItem = async (borrowData) => {
    try {
      const quantityBorrowed = parseInt(borrowData.quantityBorrowed, 10) || 1;

      const logId = await runTransaction(db, async (tx) => {
        const itemRef = doc(db, 'inventory', borrowData.itemId);
        const itemSnap = await tx.get(itemRef);
        if (!itemSnap.exists()) throw new Error('Inventory item does not exist');

        const item = itemSnap.data();
        if (quantityBorrowed > (item.quantity || 0)) {
          throw new Error('Cannot borrow more than available stock quantity');
        }

        const newQuantity = Math.max(0, (item.quantity || 0) - quantityBorrowed);
        const newBorrowedCount = (item.borrowedCount || 0) + quantityBorrowed;

        tx.update(itemRef, {
          quantity: newQuantity,
          borrowedCount: newBorrowedCount,
          updatedAt: serverTimestamp(),
        });

        const logRef = doc(collection(db, 'borrowingLogs'));
        tx.set(logRef, {
          ...borrowData,
          quantityBorrowed,
          borrowDate: serverTimestamp(),
          status: 'borrowed',
          returned: false,
          createdAt: serverTimestamp(),
        });

        return logRef.id;
      });

      // Sync with linked Product in Commerce / Product Management
      const currentItem = inventory.find(i => i.id === borrowData.itemId);
      if (currentItem?.linkedProductId) {
        try {
          const prodQ = query(collection(db, 'products'), where('productId', '==', currentItem.linkedProductId));
          const prodSnap = await getDocs(prodQ);
          if (!prodSnap.empty) {
            await updateDoc(doc(db, 'products', prodSnap.docs[0].id), {
              stockAvailable: Math.max(0, currentItem.quantity - quantityBorrowed),
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (syncErr) {
          console.warn('Sync borrowed quantity to product error:', syncErr);
        }
      }

      await Promise.all([fetchInventory(), fetchBorrowedItems()]);
      return logId;
    } catch (error) {
      console.error('Error borrowing item:', error);
      throw error;
    }
  };

  // Return item with atomic transaction and borrowedCount reduction
  const returnItem = async (logId, returnData) => {
    try {
      await runTransaction(db, async (tx) => {
        const logRef = doc(db, 'borrowingLogs', logId);
        const logSnap = await tx.get(logRef);
        if (!logSnap.exists()) throw new Error('Borrow log not found');

        const log = logSnap.data();
        if (log.returned) throw new Error('Item has already been marked as returned');

        const itemRef = doc(db, 'inventory', log.itemId);
        const itemSnap = await tx.get(itemRef);
        if (itemSnap.exists()) {
          const item = itemSnap.data();
          const newQuantity = (item.quantity || 0) + (log.quantityBorrowed || 1);
          const newBorrowedCount = Math.max(0, (item.borrowedCount || 0) - (log.quantityBorrowed || 1));

          tx.update(itemRef, {
            quantity: newQuantity,
            borrowedCount: newBorrowedCount,
            updatedAt: serverTimestamp(),
          });
        }

        tx.update(logRef, {
          returned: true,
          status: 'returned',
          returnDate: serverTimestamp(),
          returnedDate: serverTimestamp(),
          returnNotes: returnData.notes || '',
          conditionOnReturn: returnData.condition || 'good',
          processedBy: returnData.processedBy || 'Authorized Officer',
          updatedAt: serverTimestamp(),
        });
      });

      await Promise.all([fetchInventory(), fetchBorrowedItems()]);
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
    fetchFundBalances();
  }, [fetchFundBalances]);

  const value = {
    inventory,
    categories,
    addCategory,
    loading,
    borrowedItems,
    fundBalances,
    fetchFundBalances,
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
