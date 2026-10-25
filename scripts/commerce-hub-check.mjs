import { readFileSync } from 'fs';
import { resolve } from 'path';

// Automated diagnostic test for Commerce Hub bug detection and optimization
const omPath = resolve('src/components/Data/OrderManagement.jsx');
const chPath = resolve('src/components/CommerceHub/CommerceHub.jsx');

const omCode = readFileSync(omPath, 'utf8');
const chCode = readFileSync(chPath, 'utf8');

const checks = [];

function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'}: ${name} ${detail ? '(' + detail + ')' : ''}`);
}

// 1. Status change select must be wired to handleStatusChange so officers can change order status
const isStatusSelectRendered = omCode.includes('handleStatusChange(order') && omCode.includes('<select');
check('Order status dropdown is wired in orders table', isStatusSelectRendered, 'Allows updating order status from Pending/Paid/Ongoing/Completed/Cancelled');

// 2. Dead code cleanup: renderSettingsView should not be an unused dangling function
const hasRenderSettings = omCode.includes('const renderSettingsView = () =>') && omCode.includes("activeSection === 'settings' && renderSettingsView()");
check('renderSettingsView is used and renders settings view', hasRenderSettings);

// 3. Batch/bulk queries: In handleBulkDelete, products query must not be executed inside the loop
const bulkDeleteFn = omCode.substring(omCode.indexOf('handleBulkDelete = async'), omCode.indexOf('handleDeleteAllOrders'));
const hasGetDocsInsideBulkLoop = bulkDeleteFn.includes('for (const order of ordersToDelete)') && 
  bulkDeleteFn.substring(bulkDeleteFn.indexOf('for (const order of ordersToDelete)')).includes('await getDocs');
check('Bulk delete stock query is hoisted outside the loop', !hasGetDocsInsideBulkLoop);

// 4. Analytics tab in Commerce Hub: should provide live statistics or dashboard view instead of empty placeholder
const hasLiveAnalytics = !chCode.includes('analyticsPlaceholder');
check('Commerce Hub analytics tab provides live operational telemetry', hasLiveAnalytics);

const allPassed = checks.every(c => c.pass);
if (!allPassed) {
  console.error('\nCommerce Hub diagnostic check found bugs or optimization issues.');
  process.exit(1);
} else {
  console.log('\nAll Commerce Hub checks passed!');
  process.exit(0);
}
