/**
 * productPricing.js
 * Pure variation-aware pricing utilities for Merchandise Management, Homepage catalog,
 * and Student Order placement.
 *
 * Supports:
 *  - Base product `price` (fallback for any variation without an override)
 *  - Per-size price overrides via `sizePrices: { [sizeName]: number }`
 *    (e.g., Regular: 150, Extra Large: 200)
 *  - Per-custom-variation option `price` overrides on `customVariations[].options[].price`
 *  - Optional `colorPrices: { [colorName]: number }`
 *  - Centavo-safe line-item total calculation
 */

function toPositivePrice(value) {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100) / 100;
}

function lookupPriceInMap(priceMap, key) {
  if (!priceMap || typeof priceMap !== 'object' || !key) return null;
  if (Object.prototype.hasOwnProperty.call(priceMap, key)) {
    return toPositivePrice(priceMap[key]);
  }
  const normalized = String(key).trim().toLowerCase();
  for (const [k, v] of Object.entries(priceMap)) {
    if (String(k).trim().toLowerCase() === normalized) {
      return toPositivePrice(v);
    }
  }
  return null;
}

/**
 * Sanitizes a price override map (`sizePrices` / `colorPrices`) to retain only
 * positive finite numeric prices for currently active option keys.
 */
export function sanitizeVariationPriceMap(priceMap = {}, allowedKeys = []) {
  const result = {};
  if (!priceMap || typeof priceMap !== 'object') return result;
  const allowedSet =
    Array.isArray(allowedKeys) && allowedKeys.length > 0
      ? new Set(allowedKeys.map((k) => String(k)))
      : null;

  for (const [key, rawVal] of Object.entries(priceMap)) {
    if (allowedSet && !allowedSet.has(String(key))) continue;
    const price = toPositivePrice(rawVal);
    if (price !== null) {
      result[key] = price;
    }
  }
  return result;
}

/**
 * Sanitizes customVariations array so each option preserves an optional positive `price`
 * (or omits/nulls it when unset).
 */
export function sanitizeCustomVariations(customVariations = []) {
  if (!Array.isArray(customVariations)) return [];
  return customVariations
    .filter((v) => v && String(v.type || '').trim())
    .map((variation) => ({
      type: String(variation.type).trim(),
      options: Array.isArray(variation.options)
        ? variation.options
            .filter((opt) => opt && String(opt.name || '').trim())
            .map((opt) => {
              const price = toPositivePrice(opt.price);
              const cleaned = {
                name: String(opt.name).trim(),
                image: opt.image || '',
                stock: Math.max(0, parseInt(opt.stock, 10) || 0),
              };
              if (price !== null) {
                cleaned.price = price;
              }
              return cleaned;
            })
        : [],
    }));
}

/**
 * Resolves the active unit price (in PHP) for a product given selected variations.
 * Precedence:
 *   1. Size-specific price (`product.sizePrices[size]`)
 *   2. Selected custom variation option price (`option.price`)
 *   3. Color-specific price (`product.colorPrices[color]`)
 *   4. Base `product.price`
 */
export function resolveProductUnitPrice(
  product,
  { size = '', color = '', selectedCustomVariations = {} } = {}
) {
  const basePrice = toPositivePrice(product?.price) || 0;
  if (!product) return 0;

  if (size) {
    const sizePrice = lookupPriceInMap(product.sizePrices, size);
    if (sizePrice !== null) return sizePrice;
  }

  if (
    selectedCustomVariations &&
    typeof selectedCustomVariations === 'object' &&
    Array.isArray(product.customVariations)
  ) {
    for (const variation of product.customVariations) {
      if (!variation?.type || !Array.isArray(variation.options)) continue;
      const chosenOptionName = selectedCustomVariations[variation.type];
      if (!chosenOptionName) continue;
      const matchedOpt = variation.options.find(
        (opt) =>
          String(opt?.name || '').trim().toLowerCase() ===
          String(chosenOptionName).trim().toLowerCase()
      );
      const optPrice = toPositivePrice(matchedOpt?.price);
      if (optPrice !== null) return optPrice;
    }
  }

  if (color) {
    const colorPrice = lookupPriceInMap(product.colorPrices, color);
    if (colorPrice !== null) return colorPrice;
  }

  return basePrice;
}

/**
 * Computes centavo-safe unit price and line-item total for an order.
 */
export function computeOrderLineTotal(
  product,
  { size = '', color = '', selectedCustomVariations = {}, quantity = 1 } = {}
) {
  const basePrice = toPositivePrice(product?.price) || 0;
  const unitPrice = resolveProductUnitPrice(product, {
    size,
    color,
    selectedCustomVariations,
  });
  const qty = Math.max(0, parseInt(quantity, 10) || 0);
  const totalCentavos = Math.round(unitPrice * 100) * qty;
  const totalPrice = totalCentavos / 100;

  return {
    basePrice,
    unitPrice,
    totalPrice,
    isVariationPriced: unitPrice !== basePrice,
  };
}

/**
 * Computes the min/max price range for a product across base and variation prices.
 */
export function getProductPriceRange(product) {
  const basePrice = toPositivePrice(product?.price) || 0;
  const prices = [];

  const sizeOptions = Array.isArray(product?.sizeOptions) ? product.sizeOptions : [];
  if (product?.hasVariations && sizeOptions.length > 0) {
    for (const size of sizeOptions) {
      const override = lookupPriceInMap(product.sizePrices, size);
      prices.push(override !== null ? override : basePrice);
    }
  } else if (product?.sizePrices && typeof product.sizePrices === 'object') {
    for (const val of Object.values(product.sizePrices)) {
      const p = toPositivePrice(val);
      if (p !== null) prices.push(p);
    }
  }

  if (product?.colorPrices && typeof product.colorPrices === 'object') {
    for (const val of Object.values(product.colorPrices)) {
      const p = toPositivePrice(val);
      if (p !== null) prices.push(p);
    }
  }

  if (Array.isArray(product?.customVariations)) {
    for (const variation of product.customVariations) {
      if (!Array.isArray(variation?.options)) continue;
      for (const opt of variation.options) {
        const p = toPositivePrice(opt?.price);
        if (p !== null) prices.push(p);
      }
    }
  }

  if (prices.length === 0) {
    prices.push(basePrice);
  } else if (basePrice > 0 && sizeOptions.length === 0) {
    prices.push(basePrice);
  }

  const positivePrices = prices.filter((p) => p > 0);
  const minPrice = positivePrices.length > 0 ? Math.min(...positivePrices) : basePrice;
  const maxPrice = positivePrices.length > 0 ? Math.max(...positivePrices) : basePrice;
  const hasRange = maxPrice > minPrice;

  return {
    minPrice,
    maxPrice,
    hasRange,
    label: hasRange
      ? `₱${minPrice.toFixed(2)} – ₱${maxPrice.toFixed(2)}`
      : `₱${minPrice.toFixed(2)}`,
  };
}
