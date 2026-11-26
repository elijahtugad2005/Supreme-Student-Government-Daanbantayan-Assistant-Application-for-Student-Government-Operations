/**
 * product-variation-pricing-tdd.mjs
 * Verifies per-size & custom-variation pricing in Edit Product and live order placement:
 *  - Regular sizes inherit base price (₱150) while Extra Large costs ₱200
 *  - Order line-item total computes exact centavo-safe subtotal (e.g., 3x XL = ₱600, 2x Regular = ₱300)
 *  - Price range helper formats ₱150.00 – ₱200.00 when sizes have distinct prices
 *  - Custom variation option prices work seamlessly and sanitize invalid/blank entries
 *  - Production files wire sizePrices & resolveProductUnitPrice into Edit Product and Order submission
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sanitizeVariationPriceMap,
  sanitizeCustomVariations,
  resolveProductUnitPrice,
  computeOrderLineTotal,
  getProductPriceRange,
} from '../src/utils/productPricing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const schoolUniform = {
  productId: 'PROD-UNIFORM-1',
  productName: 'CTU School Uniform',
  price: 150,
  hasVariations: true,
  sizeOptions: ['Small', 'Medium', 'Large', 'Extra Large', '2XL'],
  sizePrices: {
    'Extra Large': 200,
    '2XL': 220,
  },
  colorVariations: ['White'],
  customVariations: [],
};

console.log('Running Product Size/Variation Pricing TDD Suite...');

test('regular sizes fall back to base ₱150 while Extra Large resolves to ₱200', () => {
  assert.equal(resolveProductUnitPrice(schoolUniform, { size: 'Small' }), 150);
  assert.equal(resolveProductUnitPrice(schoolUniform, { size: 'Medium' }), 150);
  assert.equal(resolveProductUnitPrice(schoolUniform, { size: 'Large' }), 150);
  assert.equal(resolveProductUnitPrice(schoolUniform, { size: 'Extra Large' }), 200);
  assert.equal(resolveProductUnitPrice(schoolUniform, { size: '2XL' }), 220);
  // Case-insensitive lookup safety
  assert.equal(resolveProductUnitPrice(schoolUniform, { size: 'extra large' }), 200);
});

test('computeOrderLineTotal multiplies variation price accurately in centavos', () => {
  const regularOrder = computeOrderLineTotal(schoolUniform, {
    size: 'Medium',
    quantity: 2,
  });
  assert.equal(regularOrder.unitPrice, 150);
  assert.equal(regularOrder.totalPrice, 300);
  assert.equal(regularOrder.isVariationPriced, false);

  const xlOrder = computeOrderLineTotal(schoolUniform, {
    size: 'Extra Large',
    quantity: 3,
  });
  assert.equal(xlOrder.unitPrice, 200);
  assert.equal(xlOrder.totalPrice, 600);
  assert.equal(xlOrder.isVariationPriced, true);
});

test('getProductPriceRange formats ₱150.00 – ₱220.00 for variable sizes and single price otherwise', () => {
  const range = getProductPriceRange(schoolUniform);
  assert.equal(range.hasRange, true);
  assert.equal(range.minPrice, 150);
  assert.equal(range.maxPrice, 220);
  assert.equal(range.label, '₱150.00 – ₱220.00');

  const flatProduct = { price: 150, hasVariations: false, sizeOptions: [] };
  const flatRange = getProductPriceRange(flatProduct);
  assert.equal(flatRange.hasRange, false);
  assert.equal(flatRange.label, '₱150.00');
});

test('custom variation option prices resolve properly and sanitize blank/invalid inputs', () => {
  const cleaned = sanitizeCustomVariations([
    {
      type: 'Fit',
      options: [
        { name: 'Regular', stock: '20', price: '' },
        { name: 'Extra Large', stock: '15', price: '200' },
        { name: 'Bad', stock: '5', price: '-10' },
      ],
    },
  ]);

  assert.equal(cleaned[0].options[0].price, undefined);
  assert.equal(cleaned[0].options[1].price, 200);
  assert.equal(cleaned[0].options[2].price, undefined);

  const customProduct = {
    price: 150,
    hasVariations: true,
    sizeOptions: [],
    customVariations: cleaned,
  };
  assert.equal(
    resolveProductUnitPrice(customProduct, { selectedCustomVariations: { Fit: 'Regular' } }),
    150
  );
  assert.equal(
    resolveProductUnitPrice(customProduct, { selectedCustomVariations: { Fit: 'Extra Large' } }),
    200
  );
  assert.equal(getProductPriceRange(customProduct).label, '₱150.00 – ₱200.00');
});

test('sanitizeVariationPriceMap strips removed sizes and blank/zero entries', () => {
  const sanitized = sanitizeVariationPriceMap(
    { Small: '', 'Extra Large': '200', RemovedSize: '250', ZeroSize: '0' },
    ['Small', 'Extra Large']
  );
  assert.deepEqual(sanitized, { 'Extra Large': 200 });
});

test('Edit Product & Order placement components wire variation pricing end-to-end', () => {
  const formSrc = readFileSync(
    path.join(ROOT_DIR, 'src/components/ProductManagement/ProductFormPanelEnhanced.jsx'),
    'utf8'
  );
  const pmSrc = readFileSync(
    path.join(ROOT_DIR, 'src/components/ProductManagement/ProductManagement.jsx'),
    'utf8'
  );
  const orderSrc = readFileSync(
    path.join(ROOT_DIR, 'src/components/Order/order.jsx'),
    'utf8'
  );

  assert.match(formSrc, /handleSizePriceChange/);
  assert.match(formSrc, /handleVariationOptionPriceChange/);
  assert.match(pmSrc, /sanitizeVariationPriceMap/);
  assert.match(pmSrc, /sizePrices:/);
  assert.match(orderSrc, /computeOrderLineTotal/);
  assert.match(orderSrc, /pricePerUnit:\s*activePricing\.unitPrice/);
  assert.match(orderSrc, /totalPrice:\s*activePricing\.totalPrice/);
});

if (!process.exitCode) {
  console.log(`\nAll ${passed} Product Size/Variation Pricing tests passed!`);
}
