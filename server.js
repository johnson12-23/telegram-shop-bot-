require('dotenv').config();
const crypto = require('crypto');
const express = require('express');

const app = express();
const port = Number(process.env.API_PORT || 4000);
const MAX_ITEMS_PER_ORDER = 100;
const MAX_CUSTOMER_NAME_LENGTH = 120;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_FINGERPRINT_TTL_MS = 8000;
const LOW_STOCK_DEFAULT = 5;
const orderStatuses = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
const orderStatusSet = new Set(orderStatuses);

const PAYSTACK_SECRET_KEY = (process.env.PAYSTACK_SECRET_KEY || '').trim();
const PAYSTACK_WEBHOOK_SECRET = (process.env.PAYSTACK_WEBHOOK_SECRET || '').trim();
const FLUTTERWAVE_SECRET_KEY = (process.env.FLUTTERWAVE_SECRET_KEY || '').trim();
const FLUTTERWAVE_WEBHOOK_SECRET = (process.env.FLUTTERWAVE_WEBHOOK_SECRET || '').trim();
const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || '').trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

const jsonParser = express.json({ limit: '128kb' });
app.use((req, res, next) => {
  if (req.path === '/api/payments/webhook/paystack') {
    return next();
  }

  return jsonParser(req, res, next);
});

const products = [
  { id: 1, name: 'GH GOLD', group: 'goodies', price: 50, description: 'Premium quality, smooth profile, and a clean finish.', stock: 50, lowStockThreshold: 8, soldCount: 0 },
  { id: 2, name: 'PURPLE HAZE', group: 'goodies', price: 65, description: 'A classic curated selection with a rich aroma.', stock: 35, lowStockThreshold: 6, soldCount: 0 },
  { id: 3, name: 'WHITE WIDOW', group: 'goodies', price: 60, description: 'Popular choice with a balanced, refined profile.', stock: 25, lowStockThreshold: 5, soldCount: 0 },
  { id: 4, name: 'FOREIGN INDOORS KUSH', group: 'goodies', price: 75, description: 'Top-shelf indoor curated product with premium character.', stock: 20, lowStockThreshold: 4, soldCount: 0 },
  { id: 5, name: 'JELLY TOFFEES', group: 'edibles', price: 30, description: 'Sweet infused chewables with a soft bite.', stock: 70, lowStockThreshold: 10, soldCount: 0 },
  { id: 6, name: 'CAKE', group: 'edibles', price: 45, description: 'Soft-bake infused slices with a rich finish.', stock: 40, lowStockThreshold: 8, soldCount: 0 },
  { id: 7, name: 'NKATECAKE', group: 'edibles', price: 40, description: 'Peanut-rich local style cake with a premium touch.', stock: 38, lowStockThreshold: 7, soldCount: 0 },
  { id: 8, name: 'GROUND', group: 'edibles', price: 35, description: 'Fine-ground edible blend for a smooth experience.', stock: 65, lowStockThreshold: 10, soldCount: 0 },
  { id: 9, name: 'INFUSED SOBOLO', group: 'drinks', price: 25, description: 'Chilled hibiscus fusion drink with a bold twist.', stock: 80, lowStockThreshold: 12, soldCount: 0 },
  { id: 10, name: 'INFUSED LAMOGIN', group: 'drinks', price: 38, description: 'Herbal local spirit infusion with a smooth profile.', stock: 45, lowStockThreshold: 8, soldCount: 0 },
  { id: 11, name: 'ALCOHOLIC HERB DRINK', group: 'drinks', price: 42, description: 'Bold botanical adult blend with a polished finish.', stock: 30, lowStockThreshold: 5, soldCount: 0 }
];

const orders = [];
const ordersById = new Map();
const idempotencyStore = new Map();
const recentPayloadFingerprints = new Map();
const notifications = [];
const productsById = new Map(products.map((product) => [Number(product.id), product]));

function log(level, event, meta = {}) {
  const payload = { ts: new Date().toISOString(), level, event, ...meta };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
}

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

function normalizeDeliveryDetails(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 240);
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
    if (product.stock < quantity) {
      return { error: `${product.name} is out of stock. Available: ${product.stock}` };
    }

    const unitPrice = Number(product.price);
    const lineTotal = unitPrice * quantity;
    normalized.push({ productId, quantity, unitPrice, lineTotal });
    total += lineTotal;
  }

  normalized.sort((a, b) => a.productId - b.productId);
  return { normalized, total };
}

function buildPayloadFingerprint(customerName, normalizedItems, userId) {
  return JSON.stringify({ customerName, userId, items: normalizedItems });
}

function extractIdempotencyKey(req) {
  const headerKey = req.get('x-idempotency-key');
  const bodyKey = req.body && typeof req.body.idempotencyKey === 'string' ? req.body.idempotencyKey : '';
  const key = String(headerKey || bodyKey || '').trim();
  if (!key || key.length > 120) {
    return null;
  }

  return key;
}

function generateOrderId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const entropy = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ORD-${stamp}-${entropy}`;
}

function findOrderById(orderId) {
  return ordersById.get(String(orderId)) || null;
}

function pushNotification({ userId, type, title, message, orderId }) {
  const notice = {
    id: crypto.randomUUID(),
    userId: String(userId || 'all'),
    type,
    title,
    message,
    orderId: orderId || null,
    createdAt: new Date().toISOString()
  };
  notifications.push(notice);
  log('info', 'notification.created', { userId: notice.userId, type, orderId: orderId || null });
}

function applyStockChanges(normalizedItems) {
  for (const item of normalizedItems) {
    const product = productsById.get(Number(item.productId));
    product.stock -= item.quantity;
    product.soldCount += item.quantity;

    if (product.stock <= (product.lowStockThreshold || LOW_STOCK_DEFAULT)) {
      pushNotification({
        userId: 'admin',
        type: 'low_stock',
        title: 'Low stock alert',
        message: `${product.name} is running low (${product.stock} left).`
      });
    }
  }
}

function createOrder({ customerName, userId, normalizedItems, total, deliveryDetails }) {
  const nowIso = new Date().toISOString();
  const order = {
    id: generateOrderId(),
    customerName,
    userId: String(userId || 'anonymous'),
    items: normalizedItems,
    total,
    deliveryDetails,
    status: 'pending',
    payment: { status: 'unpaid', provider: null, reference: null, link: null },
    timeline: [{ status: 'pending', at: nowIso }],
    createdAt: nowIso,
    updatedAt: nowIso
  };

  applyStockChanges(normalizedItems);
  orders.push(order);
  ordersById.set(order.id, order);

  pushNotification({
    userId: order.userId,
    type: 'order_confirmed',
    title: 'Order confirmed',
    message: `Order ${order.id} was created successfully.`,
    orderId: order.id
  });

  return order;
}

function updateOrderStatus(order, nextStatus) {
  if (!orderStatusSet.has(nextStatus)) {
    throw new Error(`Invalid status: ${nextStatus}`);
  }

  order.status = nextStatus;
  order.updatedAt = new Date().toISOString();
  order.timeline.push({ status: nextStatus, at: order.updatedAt });

  if (nextStatus === 'paid') {
    pushNotification({
      userId: order.userId,
      type: 'payment_received',
      title: 'Payment received',
      message: `Payment has been received for ${order.id}.`,
      orderId: order.id
    });
  }

  if (nextStatus === 'shipped') {
    pushNotification({
      userId: order.userId,
      type: 'order_shipped',
      title: 'Order shipped',
      message: `${order.id} is now on the way.`,
      orderId: order.id
    });
  }

  if (nextStatus === 'delivered') {
    pushNotification({
      userId: order.userId,
      type: 'order_delivered',
      title: 'Order delivered',
      message: `${order.id} was delivered successfully.`,
      orderId: order.id
    });
  }

  return order;
}

function buildFallbackPaymentLink(order, provider) {
  const providerName = provider === 'flutterwave' ? 'flutterwave' : 'paystack';
  const baseUrl = APP_PUBLIC_URL || `http://localhost:${port}`;
  return `${baseUrl}/pay/${providerName}?orderId=${encodeURIComponent(order.id)}&amount=${encodeURIComponent(order.total)}`;
}

async function initializePaystackPayment(order) {
  if (!PAYSTACK_SECRET_KEY) {
    return buildFallbackPaymentLink(order, 'paystack');
  }

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: `${order.userId}@telegram.local`,
      amount: Math.round(order.total * 100),
      reference: order.id,
      metadata: { orderId: order.id, userId: order.userId }
    })
  });

  if (!response.ok) {
    throw new Error(`Paystack init failed: ${response.status}`);
  }

  const payload = await response.json();
  return payload?.data?.authorization_url || buildFallbackPaymentLink(order, 'paystack');
}

async function initializeFlutterwavePayment(order) {
  if (!FLUTTERWAVE_SECRET_KEY) {
    return buildFallbackPaymentLink(order, 'flutterwave');
  }

  const response = await fetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tx_ref: order.id,
      amount: String(order.total),
      currency: 'GHS',
      redirect_url: APP_PUBLIC_URL || `http://localhost:${port}`,
      customer: { email: `${order.userId}@telegram.local`, name: order.customerName },
      customizations: { title: 'Telegram Shop Order', description: `Payment for ${order.id}` },
      meta: { orderId: order.id, userId: order.userId }
    })
  });

  if (!response.ok) {
    throw new Error(`Flutterwave init failed: ${response.status}`);
  }

  const payload = await response.json();
  return payload?.data?.link || buildFallbackPaymentLink(order, 'flutterwave');
}

function verifyPaystackSignature(rawBody, signature) {
  if (!PAYSTACK_WEBHOOK_SECRET || !signature) {
    return false;
  }

  const hash = crypto.createHmac('sha512', PAYSTACK_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return hash === signature;
}

function verifyFlutterwaveSignature(signature) {
  if (!FLUTTERWAVE_WEBHOOK_SECRET || !signature) {
    return false;
  }

  return signature === FLUTTERWAVE_WEBHOOK_SECRET;
}

function getPopularRecommendations(limit = 3, exclude = []) {
  const excluded = new Set(exclude.map((id) => Number(id)));
  return [...products]
    .filter((product) => product.stock > 0 && !excluded.has(Number(product.id)))
    .sort((a, b) => (b.soldCount - a.soldCount) || (a.price - b.price))
    .slice(0, limit);
}

async function getAiRecommendations(userId, limit = 3) {
  if (!OPENAI_API_KEY || typeof fetch !== 'function') {
    return null;
  }

  const userOrders = orders.filter((entry) => entry.userId === String(userId)).slice(-5);
  const catalog = products.map((product) => ({ id: product.id, name: product.name, group: product.group, price: product.price, stock: product.stock }));

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: `Pick up to ${limit} recommended product IDs from this catalog JSON based on user recent orders JSON. Return strict JSON array of IDs only. Catalog=${JSON.stringify(catalog)} Orders=${JSON.stringify(userOrders)}`
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const payload = await response.json();
  const text = payload?.output?.map((entry) => entry?.content?.map((c) => c?.text || '').join('')).join('') || '';
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    return null;
  }

  const recommendedIds = parsed.map((id) => Number(id)).filter((id) => Number.isInteger(id));
  return products.filter((product) => recommendedIds.includes(product.id)).slice(0, limit);
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
      '/api/orders/:id/status',
      '/api/orders/:id/payment-link',
      '/api/recommendations',
      '/api/notifications/:userId',
      '/api/payments/webhook/paystack',
      '/api/payments/webhook/flutterwave'
    ]
  });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'telegram-shop-api',
    uptimeSeconds: Math.floor(process.uptime()),
    products: products.length,
    orders: orders.length,
    pendingOrders: orders.filter((order) => order.status === 'pending').length
  });
});

app.get('/api/products', (req, res) => {
  res.json(products);
});

app.get('/api/products/:id', (req, res) => {
  const product = productsById.get(Number(req.params.id));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  return res.json(product);
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
  const userId = String(req.body?.userId || 'anonymous');
  const deliveryDetails = normalizeDeliveryDetails(req.body?.deliveryDetails);
  const { normalized: normalizedItems, total, error } = normalizeOrderItems(req.body?.items);

  if (!customerName) {
    return res.status(400).json({
      error: `Invalid customerName. Use a non-empty string up to ${MAX_CUSTOMER_NAME_LENGTH} characters.`
    });
  }

  if (!deliveryDetails || deliveryDetails.length < 6) {
    return res.status(400).json({ error: 'Delivery details are required (name, area, phone).' });
  }

  if (error) {
    return res.status(400).json({ error });
  }

  const now = Date.now();
  pruneMapByExpiry(idempotencyStore, now);
  pruneMapByExpiry(recentPayloadFingerprints, now);
  const idempotencyKey = extractIdempotencyKey(req);
  const payloadFingerprint = buildPayloadFingerprint(customerName, normalizedItems, userId);

  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
    const existing = idempotencyStore.get(idempotencyKey);
    return res.status(200).json({ ...existing.order, duplicateSuppressed: true });
  }

  if (!idempotencyKey && recentPayloadFingerprints.has(payloadFingerprint)) {
    const existing = recentPayloadFingerprints.get(payloadFingerprint);
    return res.status(200).json({ ...existing.order, duplicateSuppressed: true });
  }

  const order = createOrder({
    customerName,
    userId,
    normalizedItems,
    total,
    deliveryDetails
  });

  if (idempotencyKey) {
    idempotencyStore.set(idempotencyKey, { order, expiresAt: now + IDEMPOTENCY_TTL_MS });
  }

  recentPayloadFingerprints.set(payloadFingerprint, {
    order,
    expiresAt: now + DUPLICATE_FINGERPRINT_TTL_MS
  });

  log('info', 'order.created', { orderId: order.id, userId: order.userId, total: order.total });
  return res.status(201).json(order);
});

app.patch('/api/orders/:id/status', (req, res) => {
  const order = findOrderById(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const nextStatus = String(req.body?.status || '').trim().toLowerCase();
  if (!orderStatusSet.has(nextStatus)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${orderStatuses.join(', ')}` });
  }

  try {
    updateOrderStatus(order, nextStatus);
    log('info', 'order.status_updated', { orderId: order.id, status: order.status });
    return res.json(order);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/orders/:id/payment-link', async (req, res) => {
  const order = findOrderById(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const provider = String(req.body?.provider || 'paystack').trim().toLowerCase();
  if (!['paystack', 'flutterwave'].includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider. Use paystack or flutterwave.' });
  }

  try {
    const link = provider === 'flutterwave'
      ? await initializeFlutterwavePayment(order)
      : await initializePaystackPayment(order);

    order.payment.provider = provider;
    order.payment.status = 'pending';
    order.payment.link = link;
    order.payment.reference = order.id;
    order.updatedAt = new Date().toISOString();

    return res.json({ ok: true, orderId: order.id, provider, paymentLink: link });
  } catch (error) {
    log('error', 'payment.link_failed', { orderId: order.id, provider, message: error.message });
    return res.status(500).json({ error: 'Could not initialize payment link' });
  }
});

app.post('/api/payments/webhook/paystack', express.raw({ type: '*/*' }), (req, res) => {
  try {
    const signature = req.get('x-paystack-signature');
    const rawBody = req.body?.toString?.('utf8') || '';
    if (PAYSTACK_WEBHOOK_SECRET && !verifyPaystackSignature(rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const payload = JSON.parse(rawBody || '{}');
    const reference = payload?.data?.reference;
    const status = payload?.data?.status;
    const order = findOrderById(reference);

    if (!order) {
      return res.status(404).json({ error: 'Order not found for payment reference' });
    }

    if (status === 'success') {
      order.payment.status = 'success';
      updateOrderStatus(order, 'paid');
    }

    log('info', 'payment.webhook_paystack', { orderId: order.id, status });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: 'Invalid paystack webhook payload' });
  }
});

app.post('/api/payments/webhook/flutterwave', (req, res) => {
  const signature = req.get('verif-hash');
  if (FLUTTERWAVE_WEBHOOK_SECRET && !verifyFlutterwaveSignature(signature)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const reference = req.body?.data?.tx_ref || req.body?.tx_ref;
  const status = String(req.body?.data?.status || req.body?.status || '').toLowerCase();
  const order = findOrderById(reference);

  if (!order) {
    return res.status(404).json({ error: 'Order not found for payment reference' });
  }

  if (status === 'successful' || status === 'success') {
    order.payment.status = 'success';
    updateOrderStatus(order, 'paid');
  }

  log('info', 'payment.webhook_flutterwave', { orderId: order.id, status });
  return res.json({ ok: true });
});

app.get('/api/recommendations', async (req, res) => {
  const userId = String(req.query.userId || 'anonymous');
  const limit = Math.min(Number(req.query.limit || 3), 10);

  try {
    let recommendations = null;
    try {
      recommendations = await getAiRecommendations(userId, limit);
    } catch (aiError) {
      log('error', 'recommendations.ai_failed', { message: aiError.message });
    }

    if (!Array.isArray(recommendations) || recommendations.length === 0) {
      recommendations = getPopularRecommendations(limit);
    }

    return res.json({ ok: true, userId, recommendations });
  } catch (error) {
    return res.status(500).json({ error: 'Could not load recommendations' });
  }
});

app.get('/api/notifications/:userId', (req, res) => {
  const userId = String(req.params.userId || '').trim();
  const items = notifications.filter((item) => item.userId === userId || item.userId === 'all' || item.userId === 'admin');
  return res.json({ ok: true, notifications: items.slice(-100) });
});

app.use((error, req, res, next) => {
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  log('error', 'api.unhandled_error', { message: error?.message || 'unknown error' });
  return res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Route not found', path: req.originalUrl });
});

app.listen(port, () => {
  log('info', 'api.started', { url: `http://localhost:${port}`, port });
});