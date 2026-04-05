const { config } = require('../config');

async function request(path, options = {}, timeoutMs = 8000) {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch is unavailable in this Node runtime');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error || `${response.status} ${response.statusText}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function getProducts() {
  return request('/api/products', { method: 'GET' }, 5000);
}

function getProduct(productId) {
  return request(`/api/products/${productId}`, { method: 'GET' }, 5000);
}

function createOrder({ userId, customerName, deliveryDetails, items, idempotencyKey }) {
  return request('/api/orders', {
    method: 'POST',
    headers: {
      'x-idempotency-key': idempotencyKey
    },
    body: JSON.stringify({ userId, customerName, deliveryDetails, items, idempotencyKey })
  });
}

function getOrderById(orderId) {
  return request(`/api/orders/${encodeURIComponent(orderId)}`, { method: 'GET' }, 5000);
}

function getRecommendations(userId, limit = 3) {
  return request(`/api/recommendations?userId=${encodeURIComponent(userId)}&limit=${limit}`, { method: 'GET' }, 6000);
}

function createPaymentLink(orderId, provider) {
  return request(`/api/orders/${encodeURIComponent(orderId)}/payment-link`, {
    method: 'POST',
    body: JSON.stringify({ provider })
  });
}

function getNotifications(userId) {
  return request(`/api/notifications/${encodeURIComponent(userId)}`, { method: 'GET' }, 5000);
}

module.exports = {
  getProducts,
  getProduct,
  createOrder,
  getOrderById,
  getRecommendations,
  createPaymentLink,
  getNotifications
};
