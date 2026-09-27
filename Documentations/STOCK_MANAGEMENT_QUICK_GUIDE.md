# 📦 Stock Management Quick Reference

## 🎯 Core Principle
**Stock is ONLY deducted when an order status changes to "Completed"**

---

## 📋 Quick Reference Table

| Action | Stock Change | Location |
|--------|--------------|----------|
| Create Order | ❌ No change | `order.jsx` |
| Edit Order | ❌ No change | `order.jsx` |
| Status → Completed | ✅ Deduct stock | `OrderManagement.jsx` |
| Completed → Other | ✅ Restore stock | `OrderManagement.jsx` |
| Completed → Cancelled | ✅ Restore stock | `OrderManagement.jsx` |
| Delete Completed Order | ✅ Restore stock | `OrderManagement.jsx` |
| Delete Other Order | ❌ No change | `OrderManagement.jsx` |

---

## 🔄 Order Lifecycle

```
┌─────────────────────────────────────────────────────────┐
│                    ORDER CREATED                        │
│                   Stock: UNCHANGED                      │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  Status: "Pending"                      │
│                   Stock: UNCHANGED                      │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   Status: "Paid"                        │
│                   Stock: UNCHANGED                      │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  Status: "Ongoing"                      │
│                   Stock: UNCHANGED                      │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                Status: "Completed"                      │
│              ✅ STOCK DEDUCTED HERE                     │
└─────────────────────────────────────────────────────────┘
```

---

## ⚡ Common Scenarios

### Scenario 1: Normal Order
```
Customer orders 5 units (Stock: 100)
→ Order created: Stock = 100 ✅
→ Mark as Paid: Stock = 100 ✅
→ Mark as Ongoing: Stock = 100 ✅
→ Mark as Completed: Stock = 95 ✅
```

### Scenario 2: Order Cancellation
```
Order is Completed (Stock: 95)
→ Mark as Cancelled: Stock = 100 ✅ (restored)
```

### Scenario 3: Order Deletion
```
Delete Pending order: Stock unchanged ✅
Delete Completed order: Stock restored ✅
```

### Scenario 4: Status Reversal
```
Order is Completed (Stock: 95)
→ Change to Ongoing: Stock = 100 ✅ (restored)
→ Change to Completed: Stock = 95 ✅ (deducted)
```

---

## 🛡️ Safety Checks

### Before Deducting Stock
```javascript
if (newStock < 0) {
  alert('❌ Insufficient stock!');
  return; // Prevent operation
}
```

### Before Creating Order
```javascript
if (currentStock < orderQuantity) {
  alert('❌ Only X items available');
  return; // Prevent order
}
```

---

## 🎯 Key Functions

### In `OrderManagement.jsx`

#### `updateOrderStatus(docId, newStatus, order)`
Handles all stock changes based on status transitions.

**Triggers stock deduction:**
- Any status → "Completed"

**Triggers stock restoration:**
- "Completed" → Any other status
- "Completed" → "Cancelled"

#### `handleDeleteOrder(docId, orderId, order)`
Restores stock only if order was "Completed".

---

## 📱 Admin Interface

### Status Dropdown
Located in Order Management table:
```
[Pending ▼]
 ├─ Pending
 ├─ Paid
 ├─ Ongoing
 ├─ Completed ← Stock deducted here
 └─ Cancelled
```

### Confirmation Dialog
```
"Change order ORD-DB-0001 status to 'Completed'?"
[Cancel] [OK]
```

---

## ✅ Testing Checklist

- [ ] Create order → Stock unchanged
- [ ] Mark as Paid → Stock unchanged
- [ ] Mark as Ongoing → Stock unchanged
- [ ] Mark as Completed → Stock deducted
- [ ] Completed → Cancelled → Stock restored
- [ ] Completed → Ongoing → Stock restored
- [ ] Delete Pending order → Stock unchanged
- [ ] Delete Completed order → Stock restored
- [ ] Edit order quantity → Stock unchanged
- [ ] Insufficient stock → Order blocked

---

## 🚨 Important Notes

1. **Single Source of Truth**: All stock changes happen in `OrderManagement.jsx`
2. **Order Creation**: Only validates stock, doesn't modify it
3. **Order Editing**: Only validates stock, doesn't modify it
4. **Status Changes**: The ONLY way to modify stock
5. **Deletion**: Restores stock only for completed orders

---

## 🔍 Debugging

### Check Stock Value
```javascript
console.log('Current Stock:', productDoc.data().stockAvailable);
console.log('Order Quantity:', order.productInfo.quantity);
console.log('Order Status:', order.orderStatus);
```

### Verify Stock Change
```javascript
console.log('Old Status:', oldStatus);
console.log('New Status:', newStatus);
console.log('Stock Before:', currentStock);
console.log('Stock After:', newStock);
```

---

## 📞 Quick Help

**Stock not deducting?**
→ Check if order status is "Completed"

**Stock deducted twice?**
→ Verify order.jsx doesn't have stock deduction code

**Stock not restoring?**
→ Check if order was "Completed" before deletion/cancellation

**Negative stock?**
→ Safety check should prevent this - check validation logic

---

**Last Updated:** May 4, 2026  
**Version:** 2.0 (Fixed)
