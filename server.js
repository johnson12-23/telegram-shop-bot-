require('dotenv').config();
const express = require('express');

const app = express();
const port = Number(process.env.API_PORT || 4000);

app.use(express.json());

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