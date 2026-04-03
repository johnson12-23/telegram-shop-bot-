require('dotenv').config();
const express = require('express');

const app = express();
const port = Number(process.env.API_PORT || 4000);

app.use(express.json());

const products = [
  { id: 1, name: 'GH GOLD', price: 50, description: 'Premium quality, smooth profile' },
  { id: 2, name: 'PURPLE HAZE', price: 65, description: 'A classic curated selection' },
  { id: 3, name: 'WHITE WIDOW', price: 60, description: 'Popular choice with balanced profile' },
  { id: 4, name: 'FOREIGN INDOORS KUSH', price: 75, description: 'Top-shelf indoor curated product' }
];

const orders = [];

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'telegram-shop-api',
    endpoints: ['/health', '/api/products', '/api/orders']
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'telegram-shop-api' });
});

app.get('/api/products', (req, res) => {
  res.json(products);
});

app.get('/api/orders', (req, res) => {
  res.json(orders);
});

app.post('/api/orders', (req, res) => {
  const { customerName, items } = req.body;

  if (!customerName || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: 'Invalid payload. Expected: { customerName, items: [{ productId, quantity }] }'
    });
  }

  let total = 0;
  const normalizedItems = [];

  for (const item of items) {
    const productId = Number(item.productId);
    const quantity = Number(item.quantity || 1);
    const product = products.find((entry) => entry.id === productId);

    if (!product || quantity <= 0) {
      return res.status(400).json({ error: `Invalid order item for productId ${item.productId}` });
    }

    total += product.price * quantity;
    normalizedItems.push({
      productId,
      quantity,
      unitPrice: product.price,
      lineTotal: product.price * quantity
    });
  }

  const order = {
    id: orders.length + 1,
    customerName,
    items: normalizedItems,
    total,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  orders.push(order);
  return res.status(201).json(order);
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