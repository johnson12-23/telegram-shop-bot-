const { config } = require('../config');

const fallbackProducts = [
  { id: 1, name: 'GH GOLD', group: 'goodies', price: 50, description: 'Premium quality, smooth profile, and a clean finish.', stock: 50 },
  { id: 2, name: 'PURPLE HAZE', group: 'goodies', price: 65, description: 'A classic curated selection with a rich aroma.', stock: 35 },
  { id: 3, name: 'WHITE WIDOW', group: 'goodies', price: 60, description: 'Popular choice with a balanced, refined profile.', stock: 25 },
  { id: 4, name: 'FOREIGN INDOORS KUSH', group: 'goodies', price: 75, description: 'Top-shelf indoor curated product with premium character.', stock: 20 },
  { id: 5, name: 'JELLY TOFFEES', group: 'edibles', price: 30, description: 'Sweet infused chewables with a soft bite.', stock: 70 },
  { id: 6, name: 'CAKE', group: 'edibles', price: 45, description: 'Soft-bake infused slices with a rich finish.', stock: 40 },
  { id: 7, name: 'NKATECAKE', group: 'edibles', price: 40, description: 'Peanut-rich local style cake with a premium touch.', stock: 38 },
  { id: 8, name: 'GROUND', group: 'edibles', price: 35, description: 'Fine-ground edible blend for a smooth experience.', stock: 65 },
  { id: 9, name: 'INFUSED SOBOLO', group: 'drinks', price: 25, description: 'Chilled hibiscus fusion drink with a bold twist.', stock: 80 },
  { id: 10, name: 'INFUSED LAMOGIN', group: 'drinks', price: 38, description: 'Herbal local spirit infusion with a smooth profile.', stock: 45 },
  { id: 11, name: 'ALCOHOLIC HERB DRINK', group: 'drinks', price: 42, description: 'Bold botanical adult blend with a polished finish.', stock: 30 }
];

const localOrders = new Map();

function generateLocalOrderId() {
  return `LOCAL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

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
  return request('/api/products', { method: 'GET' }, 5000).catch(() => fallbackProducts);
}

function getProduct(productId) {
  return request(`/api/products/${productId}`, { method: 'GET' }, 5000).catch(() => {
    const found = fallbackProducts.find((item) => Number(item.id) === Number(productId));
    if (!found) {
      throw new Error('Product not found');
    }

    return found;
  });
}

async function createOrder({ userId, customerName, deliveryDetails, items, idempotencyKey }) {
  try {
    return await request('/api/orders', {
      method: 'POST',
      headers: {
        'x-idempotency-key': idempotencyKey
      },
      body: JSON.stringify({ userId, customerName, deliveryDetails, items, idempotencyKey })
    });
  } catch (error) {
    const products = await getProducts();
    const productMap = new Map(products.map((product) => [Number(product.id), product]));
    const normalizedItems = items.map((item) => {
      const product = productMap.get(Number(item.productId));
      const unitPrice = Number(product?.price || 0);
      return {
        productId: Number(item.productId),
        quantity: Number(item.quantity),
        unitPrice,
        lineTotal: unitPrice * Number(item.quantity)
      };
    });

    const total = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const order = {
      id: generateLocalOrderId(),
      userId: String(userId || 'anonymous'),
      customerName,
      deliveryDetails,
      items: normalizedItems,
      total,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      localFallback: true
    };

    localOrders.set(order.id, order);
    return order;
  }
}

async function getOrderById(orderId) {
  try {
    return await request(`/api/orders/${encodeURIComponent(orderId)}`, { method: 'GET' }, 5000);
  } catch (error) {
    const local = localOrders.get(String(orderId));
    if (!local) {
      throw error;
    }

    return local;
  }
}

async function getRecommendations(userId, limit = 3) {
  try {
    return await request(`/api/recommendations?userId=${encodeURIComponent(userId)}&limit=${limit}`, { method: 'GET' }, 6000);
  } catch (error) {
    return {
      ok: true,
      userId,
      recommendations: fallbackProducts.slice(0, Math.max(1, Number(limit) || 3))
    };
  }
}

async function createPaymentLink(orderId, provider) {
  try {
    const payload = await request(`/api/orders/${encodeURIComponent(orderId)}/payment-link`, {
      method: 'POST',
      body: JSON.stringify({ provider })
    });

    return {
      ...payload,
      amount: Number(payload.amount || 0)
    };
  } catch (error) {
    return {
      ok: true,
      orderId,
      provider,
      amount: 0,
      paymentLink: `${config.apiBaseUrl}/pay/fallback?orderId=${encodeURIComponent(orderId)}`,
      localFallback: true
    };
  }
}

async function getNotifications(userId) {
  try {
    return await request(`/api/notifications/${encodeURIComponent(userId)}`, { method: 'GET' }, 5000);
  } catch (error) {
    return { ok: true, notifications: [] };
  }
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
