require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');

const botToken = process.env.BOT_TOKEN;
const apiBaseUrl = (process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');
const pendingSearchUsers = new Set();
const pendingTrackUsers = new Set();
const userCarts = new Map();
const categories = [
  { id: 1, name: 'GH GOLD' },
  { id: 2, name: 'PURPLE HAZE' },
  { id: 3, name: 'WHITE WIDOW' },
  { id: 4, name: 'FOREIGN INDOORS KUSH' }
];
const fallbackProducts = [
  { id: 1, name: 'GH GOLD', price: 50, description: 'Premium quality, smooth profile' },
  { id: 2, name: 'PURPLE HAZE', price: 65, description: 'A classic curated selection' },
  { id: 3, name: 'WHITE WIDOW', price: 60, description: 'Popular choice with balanced profile' },
  { id: 4, name: 'FOREIGN INDOORS KUSH', price: 75, description: 'Top-shelf indoor curated product' }
];
const botLockPath = path.join(__dirname, '.bot.lock');
const shouldUseLocalLock = !process.env.RENDER && process.env.BOT_LOCK !== 'false';
let botLockFd = null;
let productsCache = {
  products: fallbackProducts,
  fromFallback: true,
  fetchedAt: 0
};
const PRODUCTS_CACHE_TTL_MS = 30000;

const healthApp = express();
const healthPort = Number(process.env.PORT || 3000);

if (!botToken) {
  throw new Error('BOT_TOKEN is missing. Add it to telegram-shop-bot/.env or your environment.');
}

const bot = new Telegraf(botToken);

healthApp.get('/', (req, res) => {
  res.status(200).send('Bot is running');
});

healthApp.get('/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'telegram-shop-bot-worker' });
});

healthApp.listen(healthPort, () => {
  console.log(`Health server listening on port ${healthPort}`);
});

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function releaseBotLock() {
  if (!shouldUseLocalLock) {
    return;
  }

  try {
    if (botLockFd !== null) {
      fs.closeSync(botLockFd);
      botLockFd = null;
    }

    if (fs.existsSync(botLockPath)) {
      fs.unlinkSync(botLockPath);
    }
  } catch (error) {
    console.warn('Failed to release bot lock:', error.message);
  }
}

function acquireBotLock() {
  if (!shouldUseLocalLock) {
    return;
  }

  try {
    botLockFd = fs.openSync(botLockPath, 'wx');
    fs.writeFileSync(botLockFd, `${process.pid}\n${new Date().toISOString()}`);
    return;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }

  try {
    const lockContents = fs.readFileSync(botLockPath, 'utf8').split(/\r?\n/)[0].trim();
    const existingPid = Number(lockContents);

    if (!Number.isInteger(existingPid) || !isProcessRunning(existingPid)) {
      fs.unlinkSync(botLockPath);
      botLockFd = fs.openSync(botLockPath, 'wx');
      fs.writeFileSync(botLockFd, `${process.pid}\n${new Date().toISOString()}`);
      return;
    }

    throw new Error(
      `Another local bot instance is already running (PID ${existingPid}). Stop it before starting a new one.`
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      botLockFd = fs.openSync(botLockPath, 'wx');
      fs.writeFileSync(botLockFd, `${process.pid}\n${new Date().toISOString()}`);
      return;
    }

    throw error;
  }
}

async function safeAnswerCbQuery(ctx, text) {
  try {
    await ctx.answerCbQuery(text);
  } catch (error) {
    const description = error?.response?.description || '';
    if (!description.includes('query is too old') && !description.includes('query ID is invalid')) {
      throw error;
    }
  }
}

function formatProducts(products) {
  return products
    .map((product, index) => `${index + 1}. ${product.name} - $${product.price}\n${product.description}`)
    .join('\n\n');
}

async function getProductsFromApi() {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch is not available in this Node.js version');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  const response = await fetch(`${apiBaseUrl}/api/products`, { signal: controller.signal });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Products request failed: ${response.status}`);
  }

  const products = await response.json();
  if (!Array.isArray(products)) {
    throw new Error('Invalid products response format');
  }

  return products;
}

async function loadProducts() {
  const now = Date.now();
  if (now - productsCache.fetchedAt < PRODUCTS_CACHE_TTL_MS) {
    return { products: productsCache.products, fromFallback: productsCache.fromFallback };
  }

  try {
    const products = await getProductsFromApi();
    productsCache = { products, fromFallback: false, fetchedAt: now };
    return { products, fromFallback: false };
  } catch (error) {
    console.error('Failed to load products from API, using fallback products:', error.message);
    const fallback = productsCache.products?.length ? productsCache.products : fallbackProducts;
    productsCache = { products: fallback, fromFallback: true, fetchedAt: now };
    return { products: fallback, fromFallback: true };
  }
}

async function getApiHealth() {
  if (typeof fetch !== 'function') {
    return { ok: false, reason: 'fetch-unavailable' };
  }

  try {
    const response = await fetch(`${apiBaseUrl}/health`);
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function createOrder(customerName, productId, quantity = 1) {
  const response = await fetch(`${apiBaseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName,
      items: [{ productId, quantity }]
    })
  });

  if (!response.ok) {
    throw new Error(`Order request failed: ${response.status}`);
  }

  return response.json();
}

function getUserCart(userId) {
  if (!userCarts.has(userId)) {
    userCarts.set(userId, []);
  }

  return userCarts.get(userId);
}

function formatCartMessage(cartItems, products) {
  if (!cartItems.length) {
    return '🛒 Your Cart\n\nYour cart is empty. Add products to continue shopping.';
  }

  const lines = cartItems.map((item, index) => {
    const product = products.find((entry) => Number(entry.id) === Number(item.productId));
    const productName = product?.name || `Product #${item.productId}`;
    return `${index + 1}x ${productName} - $${item.lineTotal}`;
  });

  const total = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  return `🛒 Your Cart\n\n${lines.join('\n')}\n\nTotal: $${total}`;
}

function buildCartKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add More', 'open_products')],
    [Markup.button.callback('❌ Remove Item', 'cart_remove_menu')],
    [Markup.button.callback('💳 Checkout', 'cart_checkout')]
  ]);
}

async function showCart(ctx) {
  const userId = ctx.from?.id;
  const cartItems = getUserCart(userId);
  const { products } = await loadProducts();

  await ctx.reply(formatCartMessage(cartItems, products), buildCartKeyboard());
}

async function addToCartFlow(ctx, productId, grams) {
  const userId = ctx.from?.id;
  const cartItems = getUserCart(userId);
  const { products } = await loadProducts();
  const product = products.find((entry) => Number(entry.id) === productId);

  if (!product) {
    throw new Error('Selected product not found');
  }

  const existing = cartItems.find((item) => Number(item.productId) === productId);
  if (existing) {
    existing.quantity += grams;
    existing.lineTotal = existing.quantity * existing.unitPrice;
  } else {
    cartItems.push({
      productId,
      quantity: grams,
      unitPrice: Number(product.price),
      lineTotal: grams * Number(product.price)
    });
  }

  await ctx.reply(
    `Added to cart: ${grams}g ${product.name}\nCurrent line total: $${(existing || cartItems[cartItems.length - 1]).lineTotal}`,
    buildCartKeyboard()
  );
}

async function getOrderById(orderId) {
  const response = await fetch(`${apiBaseUrl}/api/orders`);
  if (!response.ok) {
    throw new Error(`Orders request failed: ${response.status}`);
  }

  const orders = await response.json();
  if (!Array.isArray(orders)) {
    throw new Error('Invalid orders response format');
  }

  return orders.find((order) => order.id === orderId) || null;
}

function buildMainMenu() {
  return Markup.keyboard([
    ['🛍️ View Products', '🔍 Search'],
    ['📦 Track Order', '🛒 My Cart'],
    ['❓ Help']
  ]).resize();
}

async function showHelp(ctx) {
  await ctx.replyWithHTML(
    '<b>How to use the bot</b>\n\n🛍️ View Products: Browse products and place orders\n🔍 Search: Find products by keyword\n📦 Track Order: Check your order status\n🛒 My Cart: View your current cart guide\n❓ Help: Open this guide',
    buildMainMenu()
  );
}

async function trackOrderById(ctx, orderId) {
  const order = await getOrderById(orderId);
  if (!order) {
    await ctx.reply('That order could not be found.', buildMainMenu());
    return;
  }

  await ctx.reply(
    `Order update\nOrder ID: ${order.id}\nStatus: ${order.status}\nTotal: $${order.total}\nCreated: ${order.createdAt}`,
    Markup.inlineKeyboard([[Markup.button.callback('View Products', 'open_products')]])
  );
}

function formatCategoryList() {
  return [
    'Choose a category:',
    '1. GH GOLD',
    '2. PURPLE HAZE',
    '3. WHITE WIDOW',
    '4. FOREIGN INDOORS KUSH'
  ].join('\n');
}

function buildCategoryKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('1. GH GOLD', 'category_1')],
    [Markup.button.callback('2. PURPLE HAZE', 'category_2')],
    [Markup.button.callback('3. WHITE WIDOW', 'category_3')],
    [Markup.button.callback('4. FOREIGN INDOORS KUSH', 'category_4')]
  ]);
}

async function sendCategorySelection(ctx, useEditMessage = false) {
  try {
    const message = formatCategoryList();
    const keyboard = buildCategoryKeyboard();

    if (useEditMessage) {
      await ctx.editMessageText(message, keyboard);
      return;
    }

    await ctx.reply(message, keyboard);
  } catch (error) {
    console.error('Failed to load category selection:', error);
    await ctx.reply('Could not open categories right now. Please try again.');
  }
}

bot.start(async (ctx) => {
  pendingSearchUsers.delete(ctx.from?.id);
  pendingTrackUsers.delete(ctx.from?.id);

  await ctx.replyWithHTML(
    'Welcome to our private collection.\n\nYou\'ve been granted access to a discreet, premium storefront designed for clients who value quality, privacy, and a seamless experience.\n\n🛍️ <b>Inside, you\'ll find:</b>\n• Carefully curated, high-quality selections\n• Smooth and secure ordering\n• Real-time order updates\n• A refined, stress-free shopping experience\n\n🔒 <b>Discretion is our standard</b>\nEvery interaction is handled with professionalism and strict confidentiality.\n\nTake your time, explore the collection, and choose what suits you best.\n\n👉 Tap "View Products" to begin.\n\nFor assistance, simply send a message - dedicated support is always available.',
    buildMainMenu()
  );
});

bot.command('products', async (ctx) => {
  await sendCategorySelection(ctx);
});

bot.command('status', async (ctx) => {
  const health = await getApiHealth();
  const mode = health.ok ? 'Live API mode' : 'Fallback sample mode';
  const details = health.ok
    ? `API status: OK (${health.status})`
    : `API status: Unavailable (${health.reason || health.status || 'unknown'})`;

  await ctx.reply(`Bot status: online\n${details}\nMode: ${mode}`);
});

bot.hears('🛍️ View Products', async (ctx) => {
  pendingSearchUsers.delete(ctx.from?.id);
  pendingTrackUsers.delete(ctx.from?.id);
  await sendCategorySelection(ctx);
});

bot.hears('🔍 Search', async (ctx) => {
  pendingSearchUsers.add(ctx.from?.id);
  pendingTrackUsers.delete(ctx.from?.id);
  await ctx.reply('Send a product keyword (example: sneaker, bag, sunglass).', buildMainMenu());
});

bot.hears('📦 Track Order', async (ctx) => {
  pendingTrackUsers.add(ctx.from?.id);
  pendingSearchUsers.delete(ctx.from?.id);
  await ctx.reply('Send your order ID (example: 12).', buildMainMenu());
});

bot.hears('🛒 My Cart', async (ctx) => {
  pendingSearchUsers.delete(ctx.from?.id);
  pendingTrackUsers.delete(ctx.from?.id);
  await showCart(ctx);
});

bot.hears('❓ Help', async (ctx) => {
  pendingSearchUsers.delete(ctx.from?.id);
  pendingTrackUsers.delete(ctx.from?.id);
  await showHelp(ctx);
});

bot.on('text', async (ctx, next) => {
  const userId = ctx.from?.id;
  const text = (ctx.message?.text || '').trim();

  if (!text || text.startsWith('/')) {
    return next();
  }

  if (pendingSearchUsers.has(userId)) {
    pendingSearchUsers.delete(userId);
    const query = text.toLowerCase();
    const { products } = await loadProducts();
    const matches = products.filter((product) => {
      const haystack = `${product.name} ${product.description}`.toLowerCase();
      return haystack.includes(query);
    });

    if (matches.length === 0) {
      await ctx.reply(`No products matched "${text}". Try another keyword.`, buildMainMenu());
      return;
    }

    await ctx.reply(`Search results:\n\n${formatProducts(matches)}`, buildMainMenu());
    return;
  }

  if (pendingTrackUsers.has(userId)) {
    pendingTrackUsers.delete(userId);
    const orderId = Number(text);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      await ctx.reply('Invalid order ID. Please send a number like 12.', buildMainMenu());
      return;
    }

    try {
      await trackOrderById(ctx, orderId);
    } catch (error) {
      await ctx.reply('Could not fetch order status right now.', buildMainMenu());
    }
  }
});

bot.action('refresh_products', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Categories refreshed');
  await sendCategorySelection(ctx, true);
});

bot.action(/category_(\d+)/, async (ctx) => {
  const productId = Number(ctx.match[1]);

  try {
    await safeAnswerCbQuery(ctx, 'Category opened');
    const { products } = await loadProducts();
    const product = products.find((entry) => Number(entry.id) === productId);

    if (!product) {
      await ctx.reply('This category is currently unavailable. Try another category.', buildCategoryKeyboard());
      return;
    }

    await ctx.reply(
      `Selected: ${product.name}\nPrice: $${product.price}/g\n${product.description}\n\nChoose grams:`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('1g', `grams_${productId}_1`),
          Markup.button.callback('2g', `grams_${productId}_2`),
          Markup.button.callback('3g', `grams_${productId}_3`)
        ],
        [Markup.button.callback('Back to categories', 'open_products')]
      ])
    );
  } catch (error) {
    await safeAnswerCbQuery(ctx, 'Category failed');
    await ctx.reply('Could not open this category right now. Please try again.');
  }
});

bot.action(/buy_(\d+)/, async (ctx) => {
  const productId = Number(ctx.match[1]);

  try {
    await safeAnswerCbQuery(ctx, 'Select grams');
    const { products } = await loadProducts();
    const product = products.find((entry) => Number(entry.id) === productId);

    if (!product) {
      await ctx.reply('Product not found. Please refresh products and try again.');
      return;
    }

    await ctx.reply(
      `Selected: ${product.name} ($${product.price}/g)\n\nChoose grams:`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('1g', `grams_${productId}_1`),
          Markup.button.callback('2g', `grams_${productId}_2`),
          Markup.button.callback('3g', `grams_${productId}_3`)
        ],
        [Markup.button.callback('Back to categories', 'open_products')]
      ])
    );
  } catch (error) {
    await safeAnswerCbQuery(ctx, 'Order failed');
    await ctx.reply('Could not open quantity selection. Please try again.');
  }
});

bot.action(/grams_(\d+)_(\d+)/, async (ctx) => {
  const productId = Number(ctx.match[1]);
  const grams = Number(ctx.match[2]);

  try {
    await safeAnswerCbQuery(ctx, 'Adding to cart...');
    await addToCartFlow(ctx, productId, grams);
  } catch (error) {
    await safeAnswerCbQuery(ctx, 'Add to cart failed');
    await ctx.reply('Could not add to cart right now. Please try again.');
  }
});

bot.action(/quantity_(\d+)_(\d+)/, async (ctx) => {
  const productId = Number(ctx.match[1]);
  const grams = Number(ctx.match[2]);

  try {
    await safeAnswerCbQuery(ctx, 'Adding to cart...');
    await addToCartFlow(ctx, productId, grams);
  } catch (error) {
    await safeAnswerCbQuery(ctx, 'Add to cart failed');
    await ctx.reply('Could not add to cart right now. Please try again.');
  }
});

bot.action('cart_remove_menu', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Choose item to remove');
  const userId = ctx.from?.id;
  const cartItems = getUserCart(userId);

  if (!cartItems.length) {
    await ctx.reply('Your cart is empty.', buildCartKeyboard());
    return;
  }

  const { products } = await loadProducts();
  const buttons = cartItems.map((item) => {
    const product = products.find((entry) => Number(entry.id) === Number(item.productId));
    const label = `Remove ${product?.name || `#${item.productId}`}`;
    return [Markup.button.callback(label, `cart_remove_${item.productId}`)];
  });

  buttons.push([Markup.button.callback('Back to Cart', 'cart_show')]);
  await ctx.reply('Select an item to remove from cart:', Markup.inlineKeyboard(buttons));
});

bot.action(/cart_remove_(\d+)/, async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Removing item...');
  const userId = ctx.from?.id;
  const productId = Number(ctx.match[1]);
  const cartItems = getUserCart(userId);
  const updated = cartItems.filter((item) => Number(item.productId) !== productId);
  userCarts.set(userId, updated);

  await showCart(ctx);
});

bot.action('cart_show', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Opening cart');
  await showCart(ctx);
});

bot.action('cart_checkout', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Processing checkout...');
  const userId = ctx.from?.id;
  const cartItems = getUserCart(userId);

  if (!cartItems.length) {
    await ctx.reply('Your cart is empty. Add products first.', buildCartKeyboard());
    return;
  }

  const customerName =
    ctx.from?.username ||
    [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') ||
    'Telegram Customer';

  try {
    const response = await fetch(`${apiBaseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName,
        items: cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity }))
      })
    });

    if (!response.ok) {
      throw new Error(`Checkout request failed: ${response.status}`);
    }

    const order = await response.json();
    userCarts.set(userId, []);

    await ctx.reply(
      `Checkout complete.\n\nOrder ID: ${order.id}\nTotal: $${order.total}\nStatus: ${order.status}\n\nNext step: track your order or continue shopping.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Track this order', `track_${order.id}`)],
        [Markup.button.callback('View Products', 'open_products')]
      ])
    );
  } catch (error) {
    await ctx.reply('Checkout failed right now. Please try again.');
  }
});

bot.action(/track_(\d+)/, async (ctx) => {
  const orderId = Number(ctx.match[1]);

  try {
    await safeAnswerCbQuery(ctx, 'Loading status...');
    await trackOrderById(ctx, orderId);
  } catch (error) {
    await safeAnswerCbQuery(ctx, 'Status failed');
    await ctx.reply('Could not fetch order status right now.');
  }
});

bot.action('open_products', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Opening categories');
  await sendCategorySelection(ctx);
});

bot.catch((error, ctx) => {
  console.error('Bot error:', error);
  if (ctx) {
    ctx.reply('Something went wrong. Please try again.');
  }
});

async function startBot() {
  try {
    acquireBotLock();
    console.log('Starting bot polling...');
    await bot.launch();
    console.log('Polling connected.');
    const me = await bot.telegram.getMe();
    console.log(`Bot is running as @${me.username}`);
  } catch (error) {
    releaseBotLock();
    const isConflict = error?.response?.error_code === 409;
    if (isConflict) {
      console.warn('Telegram conflict detected. Retrying bot launch in 5 seconds...');
      setTimeout(() => {
        startBot();
      }, 5000);
      return;
    }

    console.error('Failed to launch bot:', error);
    process.exit(1);
  }
}

startBot();

process.once('SIGINT', () => {
  releaseBotLock();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  releaseBotLock();
  bot.stop('SIGTERM');
});

process.once('exit', () => {
  releaseBotLock();
});