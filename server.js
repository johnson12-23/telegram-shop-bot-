require('dotenv').config();
const express = require('express');

const app = express();
const port = Number(process.env.API_PORT || 4000);
const MAX_ITEMS_PER_ORDER = 100;
const MAX_CUSTOMER_NAME_LENGTH = 120;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_FINGERPRINT_TTL_MS = 8000;
const allowedOrderStatuses = new Set(['pending', 'payment_submitted', 'confirmed', 'processing', 'completed', 'cancelled']);

app.use(express.json({ limit: '64kb' }));

const products = [
  {
    id: 1,
    name: 'GH GOLD',
    group: 'goodies',
    price: 50,
    description: 'Premium quality, smooth profile, and a clean finish.'
  },
  {
    id: 2,
    name: 'PURPLE HAZE',
    group: 'goodies',
    price: 65,
    description: 'A classic curated selection with a rich aroma.'
  },
  {
    id: 3,
    name: 'WHITE WIDOW',
    group: 'goodies',
    price: 60,
    description: 'Popular choice with a balanced, refined profile.'
  },
  {
    id: 4,
    name: 'FOREIGN INDOORS KUSH',
    group: 'goodies',
    price: 75,
    description: 'Top-shelf indoor curated product with premium character.'
  },
  {
    id: 5,
    name: 'JELLY TOFFEES',
    group: 'edibles',
    price: 30,
    description: 'Sweet infused chewables with a soft bite.'
  },
  {
    id: 6,
    name: 'CAKE',
    group: 'edibles',
    price: 45,
    description: 'Soft-bake infused slices with a rich finish.'
  },
  {
    id: 7,
    name: 'NKATECAKE',
    group: 'edibles',
    price: 40,
    description: 'Peanut-rich local style cake with a premium touch.'
  },
  {
    id: 8,
    name: 'GROUND',
    group: 'edibles',
    price: 35,
    description: 'Fine-ground edible blend for a smooth experience.'
  },
  {
    id: 9,
    name: 'INFUSED SOBOLO',
    group: 'drinks',
    price: 25,
    description: 'Chilled hibiscus fusion drink with a bold twist.'
  },
  {
    id: 10,
    name: 'INFUSED LAMOGIN',
    group: 'drinks',
    price: 38,
    description: 'Herbal local spirit infusion with a smooth profile.'
  },
  {
    id: 11,
    name: 'ALCOHOLIC HERB DRINK',
    group: 'drinks',
    price: 42,
    description: 'Bold botanical adult blend with a polished finish.'
  }
];

const orders = [];
let nextOrderId = 1;
const ordersById = new Map();
const idempotencyStore = new Map();
const recentPayloadFingerprints = new Map();

function buildProductsById() {
  return new Map(products.map((product) => [Number(product.id), product]));
}

const productsById = buildProductsById();

function pruneMapByExpiry(store, now = Date.now()) {
  for (const [key, value] of store.entries()) {
    if (!value || typeof value.expiresAt !== 'number' || value.expiresAt <= now) {
      store.delete(key);
    }
  }
}

function sanitizeCustomerName(customerName) {
  if (typeof customerName !== 'string') {
    return null;
  }

  const sanitized = customerName.trim().replace(/\s+/g, ' ');
  if (!sanitized || sanitized.length > MAX_CUSTOMER_NAME_LENGTH) {
    return null;
  }

  return sanitized;
}

function normalizeOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS_PER_ORDER) {
    return { error: 'Invalid items. Provide 1 to 100 items.' };
  }

  const merged = new Map();

  for (const item of items) {
    const productId = Number(item?.productId);
    const quantity = Number(item?.quantity ?? 1);

    if (!Number.isInteger(productId) || !productsById.has(productId)) {
      return { error: `Invalid productId: ${item?.productId}` };
    }

    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1000) {
      return { error: `Invalid quantity for productId ${productId}.` };
    }

    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }

  const normalized = [];
  let total = 0;

  for (const [productId, quantity] of merged.entries()) {
    const product = productsById.get(productId);
    const unitPrice = Number(product.price);
    const lineTotal = unitPrice * quantity;

    normalized.push({
      productId,
      quantity,
      unitPrice,
      lineTotal
    });
    total += lineTotal;
  }

  normalized.sort((a, b) => a.productId - b.productId);
  return { normalized, total };
}

function buildPayloadFingerprint(customerName, normalizedItems) {
  return JSON.stringify({ customerName, items: normalizedItems });
}

function extractIdempotencyKey(req) {
  const headerKey = req.get('x-idempotency-key');
  const bodyKey = req.body && typeof req.body.idempotencyKey === 'string' ? req.body.idempotencyKey : '';
  const key = String(headerKey || bodyKey || '').trim();

  if (!key) {
    return null;
  }

  if (key.length > 120) {
    return null;
  }

  return key;
}

function findOrderById(orderId) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return ordersById.get(id) || null;
}

function createOrder({ customerName, normalizedItems, total }) {
  const nowIso = new Date().toISOString();
  const order = {
    id: nextOrderId,
    customerName,
    items: normalizedItems,
    total,
    status: 'pending',
    createdAt: nowIso,
    updatedAt: nowIso
  };

  nextOrderId += 1;
  orders.push(order);
  ordersById.set(order.id, order);
  return order;
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'telegram-shop-api',
    endpoints: [
      '/health',
      '/api/products',
      '/api/orders',
      '/api/orders/:id',
      '/api/orders/:id/status'
    ]
  });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'telegram-shop-api',
    uptimeSeconds: Math.floor(process.uptime()),
    products: products.length,
    orders: orders.length
  });
});

app.get('/api/products', (req, res) => {
  res.json(products);
});

app.get('/api/orders', (req, res) => {
  res.json(orders);
});

app.get('/api/orders/:id', (req, res) => {
  const order = findOrderById(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  return res.json(order);
});

app.post('/api/orders', (req, res) => {
  const customerName = sanitizeCustomerName(req.body?.customerName);
  const { normalized: normalizedItems, total, error } = normalizeOrderItems(req.body?.items);

  if (!customerName) {
    return res.status(400).json({
      error: `Invalid customerName. Use a non-empty string up to ${MAX_CUSTOMER_NAME_LENGTH} characters.`
    });
  }

  if (error) {
    return res.status(400).json({ error });
  }

  const now = Date.now();
  pruneMapByExpiry(idempotencyStore, now);
  pruneMapByExpiry(recentPayloadFingerprints, now);

  const idempotencyKey = extractIdempotencyKey(req);
  const payloadFingerprint = buildPayloadFingerprint(customerName, normalizedItems);

  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
    const existing = idempotencyStore.get(idempotencyKey);
    return res.status(200).json({ ...existing.order, duplicateSuppressed: true });
  }

  // Fallback duplicate suppression for very fast repeated submissions with same payload.
  if (!idempotencyKey && recentPayloadFingerprints.has(payloadFingerprint)) {
    const existing = recentPayloadFingerprints.get(payloadFingerprint);
    return res.status(200).json({ ...existing.order, duplicateSuppressed: true });
  }

  const order = createOrder({ customerName, normalizedItems, total });

  if (idempotencyKey) {
    idempotencyStore.set(idempotencyKey, {
      order,
      expiresAt: now + IDEMPOTENCY_TTL_MS
    });
  }

  recentPayloadFingerprints.set(payloadFingerprint, {
    order,
    expiresAt: now + DUPLICATE_FINGERPRINT_TTL_MS
  });

  return res.status(201).json(order);
});

app.patch('/api/orders/:id/status', (req, res) => {
  const order = findOrderById(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const incomingStatus = String(req.body?.status || '').trim().toLowerCase();
  if (!allowedOrderStatuses.has(incomingStatus)) {
    return res.status(400).json({
      error: `Invalid status. Allowed: ${Array.from(allowedOrderStatuses).join(', ')}`
    });
  }

  order.status = incomingStatus;
  order.updatedAt = new Date().toISOString();
  return res.json(order);
});

app.use((error, req, res, next) => {
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  console.error('Unhandled API error:', error);
  return res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Route not found',
    path: req.originalUrl
  });
});

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});