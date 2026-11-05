/**
 * src/services/inventoryService.js
 * Domain service for SSG Physical Asset & Inventory Management.
 * Enforces institutional procurement rules:
 * - Inventory items are strictly funded via IGF (Income Generated Funds) or IGP (Income-Generating Projects).
 * - Debits the corresponding fund account atomically (fund_igf_main or fund_igp_main).
 * - Tracks borrowedCount and quantity atomically via transactions.
 */

export const INVENTORY_FUND_SOURCES = {
  IGF: 'IGF',
  IGP: 'IGP',
};

export const FUND_ACCOUNT_IDS = {
  IGF: 'fund_igf_main',
  IGP: 'fund_igp_main',
};

export function createInventoryService({ db }) {
  if (!db) throw new Error('Database adapter is required to create InventoryService');

  return {
    /**
     * Get available balance in PHP for a specific fund source (IGF or IGP).
     */
    async getFundBalance(fundSource) {
      const fundKey = (fundSource || '').toUpperCase();
      const accountId = FUND_ACCOUNT_IDS[fundKey];
      if (!accountId) throw new Error(`Unknown inventory fund source: ${fundSource}`);

      const accountDoc = await db.getDoc('fundAccounts', accountId);
      if (!accountDoc) return 0;
      const centavos = accountDoc.balanceCentavos || 0;
      return centavos / 100;
    },

    /**
     * Procure and register a new inventory item.
     * Enforces fund validation, checks balance, creates item, debits fund, and records expense transaction.
     */
    async addInventoryItem(itemData) {
      const fundSource = (itemData.fundSource || '').toUpperCase();
      if (fundSource !== INVENTORY_FUND_SOURCES.IGF && fundSource !== INVENTORY_FUND_SOURCES.IGP) {
        throw new Error(`Inventory items must be procured via IGF or IGP. Received: ${itemData.fundSource}`);
      }

      const quantity = parseInt(itemData.quantity, 10) || 0;
      const amount = parseFloat(itemData.amount) || 0;
      const totalCostPhp = amount * quantity;
      const costCentavos = Math.round(totalCostPhp * 100);
      const accountId = FUND_ACCOUNT_IDS[fundSource];

      return await db.runTransaction(async (tx) => {
        // 1. Verify fund balance if procuring with non-zero cost
        const fundSnap = await tx.get('fundAccounts', accountId);
        const currentBalanceCentavos = fundSnap?.balanceCentavos || 0;

        if (costCentavos > 0 && currentBalanceCentavos < costCentavos) {
          const availablePhp = (currentBalanceCentavos / 100).toFixed(2);
          const requiredPhp = totalCostPhp.toFixed(2);
          throw new Error(
            `Insufficient ${fundSource} balance. Available: ₱${availablePhp}, Required: ₱${requiredPhp}`
          );
        }

        // 2. Debit the fund account
        const updatedBalanceCentavos = currentBalanceCentavos - costCentavos;
        await tx.update('fundAccounts', accountId, {
          balanceCentavos: updatedBalanceCentavos,
          updatedAt: new Date().toISOString(),
        });

        // 3. Auto-generate expense ledger record in financeTransactions if cost > 0
        if (costCentavos > 0) {
          const refNumber = `INV-${fundSource}-${Date.now()}`;
          await tx.add('financeTransactions', {
            refNumber,
            fundAccountId: accountId,
            fundCategory: fundSource,
            transactionType: 'EXPENSE',
            expensePurpose: `Inventory Procurement: ${itemData.name}`,
            amountCentavos: costCentavos,
            description: `Procured ${quantity} units of "${itemData.name}" @ ₱${amount.toFixed(2)}/unit`,
            performer: itemData.lastUpdatedBy || 'Authorized Officer',
            status: 'POSTED',
            createdAt: new Date().toISOString(),
            postedAt: new Date().toISOString(),
          });
        }

        // 4. Save item to inventory collection
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const newItem = await tx.add('inventory', itemPayload);
        return {
          id: newItem.id || newItem,
          ...itemPayload,
        };
      });
    },

    /**
     * Borrow item requisition: Decrements physical quantity and increments borrowedCount atomically.
     */
    async borrowItem(borrowData) {
      const quantityBorrowed = parseInt(borrowData.quantityBorrowed, 10) || 1;

      return await db.runTransaction(async (tx) => {
        const item = await tx.get('inventory', borrowData.itemId);
        if (!item) throw new Error(`Inventory item ${borrowData.itemId} not found`);

        if (quantityBorrowed > (item.quantity || 0)) {
          throw new Error('Cannot borrow more than available stock quantity');
        }

        const newQuantity = Math.max(0, item.quantity - quantityBorrowed);
        const newBorrowedCount = (item.borrowedCount || 0) + quantityBorrowed;

        await tx.update('inventory', borrowData.itemId, {
          quantity: newQuantity,
          borrowedCount: newBorrowedCount,
          updatedAt: new Date().toISOString(),
        });

        const logPayload = {
          itemId: borrowData.itemId,
          itemName: item.name,
          quantityBorrowed,
          borrowerName: borrowData.borrowerName || 'Student',
          borrowerEmail: borrowData.borrowerEmail || '',
          purpose: borrowData.purpose || 'Institutional Activity',
          expectedReturnDate: borrowData.expectedReturnDate || '',
          borrowDate: new Date().toISOString(),
          status: 'borrowed',
          returned: false,
          processedBy: borrowData.processedBy || 'Authorized Officer',
          createdAt: new Date().toISOString(),
        };

        const logRef = await tx.add('borrowingLogs', logPayload);
        return {
          id: logRef.id || logRef,
          ...logPayload,
        };
      });
    },

    /**
     * Return item check-in: Restores physical quantity and decrements borrowedCount atomically.
     */
    async returnItem(logId, returnData) {
      return await db.runTransaction(async (tx) => {
        const log = await tx.get('borrowingLogs', logId);
        if (!log) throw new Error(`Borrowing log ${logId} not found`);
        if (log.returned) throw new Error('Item is already marked as returned');

        const item = await tx.get('inventory', log.itemId);
        if (item) {
          const newQuantity = (item.quantity || 0) + (log.quantityBorrowed || 1);
          const newBorrowedCount = Math.max(0, (item.borrowedCount || 0) - (log.quantityBorrowed || 1));

          await tx.update('inventory', log.itemId, {
            quantity: newQuantity,
            borrowedCount: newBorrowedCount,
            updatedAt: new Date().toISOString(),
          });
        }

        await tx.update('borrowingLogs', logId, {
          returned: true,
          status: 'returned',
          returnedDate: new Date().toISOString(),
          condition: returnData.condition || 'good',
          notes: returnData.notes || '',
          processedBy: returnData.processedBy || 'Authorized Officer',
          updatedAt: new Date().toISOString(),
        });

        return { success: true };
      });
    },
  };
}

