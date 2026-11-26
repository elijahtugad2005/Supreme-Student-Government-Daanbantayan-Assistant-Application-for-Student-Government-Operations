/**
 * src/services/orderApiService.js
 * Frontend client for the authoritative backend commerce endpoints:
 *  - POST /api/orders       (server-verified variation pricing, stock check, Pending status)
 *  - GET  /api/orders/track (masked public tracking requiring Order ID + verifier)
 */

const BACKEND_URL = (
  import.meta.env.VITE_MONGODB_BACKEND_URL || 'http://localhost:3000'
).replace(/\/+$/, '');

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function createPublicOrder(payload) {
  const res = await fetch(`${BACKEND_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok || !data?.success) {
    const err = new Error(
      data?.error || `Order submission failed (HTTP ${res.status}). Please try again.`
    );
    err.status = res.status;
    throw err;
  }
  return data.order;
}

export async function trackPublicOrder({ orderId, verifier }) {
  const params = new URLSearchParams({
    orderId: String(orderId || '').trim(),
    verifier: String(verifier || '').trim(),
  });
  const res = await fetch(`${BACKEND_URL}/api/orders/track?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const data = await parseJsonSafe(res);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok || !data?.success) {
    const err = new Error(
      data?.error || `Unable to check order status (HTTP ${res.status}).`
    );
    err.status = res.status;
    throw err;
  }
  return data.order;
}
