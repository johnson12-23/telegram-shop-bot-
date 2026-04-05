require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');

const botToken = process.env.BOT_TOKEN;
const apiBaseUrl = (process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');
const botMode = (process.env.BOT_MODE || 'auto').toLowerCase();
const webhookUrl = (process.env.WEBHOOK_URL || '').trim().replace(/\/+$/, '');
const webhookPath = process.env.WEBHOOK_PATH || '/telegram/webhook';
const webhookSecretToken = process.env.WEBHOOK_SECRET_TOKEN || undefined;
const pendingSearchUsers = new Set();
const pendingTrackUsers = new Set();
const userCarts = new Map();
const productGroups = [
  {
    id: 'goodies',
    name: 'GOODIES',
    icon: '🍬',
    tagline: 'Premium classics and bestsellers',
    blurb: 'Curated originals and top picks'
  },
  {
    id: 'edibles',
    name: 'EDIBLES',
    icon: '🍰',
    tagline: 'Sweets, bakes, and infused treats',
    blurb: 'Soft, sweet, and carefully prepared'
  },
  {
    id: 'drinks',
    name: 'DRINKS',
    icon: '🥤',
    tagline: 'Infused drinks and liquid blends',
    blurb: 'Refreshing blends with a premium finish'
  }
];
const fallbackProducts = [
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
let healthServerStarted = false;

if (!botToken) {
  throw new Error('BOT_TOKEN is missing. Add it to telegram-shop-bot/.env or your environment.');
}

const bot = new Telegraf(botToken);

function getContextKey(ctx) {
  return String(ctx.from?.id ?? ctx.senderChat?.id ?? ctx.chat?.id ?? 'anonymous');
}

function getContextLabel(ctx) {
  return (
    ctx.from?.username ||
    [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') ||
    ctx.senderChat?.title ||
    ctx.chat?.title ||
    'Telegram Customer'
  );
}

healthApp.get('/', (req, res) => {
  res.status(200).send('Bot is running');
});

healthApp.get('/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'telegram-shop-bot-worker' });
});

function startHealthServer() {
  if (healthServerStarted) {
    return;
  }

  healthServerStarted = true;
  healthApp.listen(healthPort, () => {
    console.log(`Health server listening on port ${healthPort}`);
  });
}

if (webhookSecretToken) {
  healthApp.use((req, res, next) => {
    if (req.path !== webhookPath) {
      next();
      return;
    }

    const incomingSecret = req.get('x-telegram-bot-api-secret-token');
    if (incomingSecret !== webhookSecretToken) {
      res.status(403).send('Forbidden');
      return;
    }

    next();
  });
}

healthApp.use(webhookPath, bot.webhookCallback(webhookPath));

function resolveRuntimeMode() {
  if (botMode === 'webhook') {
    return 'webhook';
  }

  if (botMode === 'polling') {
    return 'polling';
  }

  return webhookUrl ? 'webhook' : 'polling';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    .map((product, index) => `${index + 1}. ${product.name} - ₵${product.price}\n${product.description}`)
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
  const cartKey = String(userId);

  if (!userCarts.has(cartKey)) {
    userCarts.set(cartKey, []);
  }

  return userCarts.get(cartKey);
}

function formatCartMessage(cartItems, products) {
  if (!cartItems.length) {
    return '🛒 Your Cart\n\nYour cart is empty. Add products to continue shopping.';
  }

  const lines = cartItems.map((item, index) => {
    const product = products.find((entry) => Number(entry.id) === Number(item.productId));
    const productName = product?.name || `Product #${item.productId}`;
    return `${index + 1}x ${productName} - ₵${item.lineTotal}`;
  });

  const total = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  return `🛒 Your Cart\n\n${lines.join('\n')}\n\nTotal: ₵${total}`;
}

function buildCartKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add More', 'open_products')],
    [Markup.button.callback('❌ Remove Item', 'cart_remove_menu')],
    [Markup.button.callback('💳 Checkout', 'cart_checkout')]
  ]);
}

async function showCart(ctx) {
  const userId = getContextKey(ctx);
  const cartItems = getUserCart(userId);
  const { products } = await loadProducts();

  await ctx.reply(formatCartMessage(cartItems, products), buildCartKeyboard());
}

async function addToCartFlow(ctx, productId, grams) {
  const userId = getContextKey(ctx);
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

  const unit = getProductUnit(product);
  await ctx.reply(
    `Added to cart: ${grams}${unit} ${product.name}\nCurrent line total: ₵${(existing || cartItems[cartItems.length - 1]).lineTotal}`,
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
    ['🛍️ View Products'],
    ['🔍 Search'],
    ['📦 Track Order'],
    ['🛒 My Cart'],
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
    `Order update\nOrder ID: ${order.id}\nStatus: ${order.status}\nTotal: ₵${order.total}\nCreated: ${order.createdAt}`,
    Markup.inlineKeyboard([[Markup.button.callback('View Products', 'open_products')]])
  );
}

function formatCategoryList(products = fallbackProducts) {
  return productGroups
    .map((group, index) => {
      const count = getProductsByGroup(products, group.id).length;
      return `${index + 1}. ${group.icon} ${group.name} (${count}) — ${group.tagline}`;
    })
    .join('\n');
}

function buildCategoryKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🍬 GOODIES', 'group_goodies')],
    [Markup.button.callback('🍰 EDIBLES', 'group_edibles')],
    [Markup.button.callback('🥤 DRINKS', 'group_drinks')]
  ]);
}

function getProductsByGroup(products, groupId) {
  return products.filter((product) => (product.group || 'goodies') === groupId);
}

function getProductUnit(product) {
  return (product.group || 'goodies') === 'drinks' ? 'L' : 'g';
}

function getProductUnitLabel(product) {
  return (product.group || 'goodies') === 'drinks' ? 'litre' : 'gram';
}

function formatGroupProducts(groupName, groupProducts) {
  if (!groupProducts.length) {
    return `${groupName}\n\nNo products available right now.`;
  }

  const lines = groupProducts.map((product, index) => {
    const unit = getProductUnit(product);
    return `${index + 1}. ${product.name} - ₵${product.price}/${unit}`;
  });
  return [groupName, '', `${groupProducts.length} item${groupProducts.length === 1 ? '' : 's'} available`, '', lines.join('\n')].join('\n');
}

function formatProductDetail(product) {
  const group = productGroups.find((entry) => entry.id === (product.group || 'goodies'));
  const collectionLabel = group ? `${group.icon} ${group.name}` : 'COLLECTION';
  const unit = getProductUnit(product);
  const unitLabel = getProductUnitLabel(product);

  return [
    `Selected: ${product.name}`,
    `Collection: ${collectionLabel}`,
    `Price: ₵${product.price}/${unit}`,
    '',
    'About this item:',
    product.description,
    '',
    `Choose ${unitLabel}s to continue:`
  ].join('\n');
}

function buildQuantityKeyboard(product) {
  const productId = product.id;
  const unit = getProductUnit(product);
  
  return Markup.inlineKeyboard([
    [Markup.button.callback(`1${unit}`, `grams_${productId}_1`)],
    [Markup.button.callback(`2${unit}`, `grams_${productId}_2`)],
    [Markup.button.callback(`3${unit}`, `grams_${productId}_3`)],
    [Markup.button.callback('⬅️ Back to collections', 'open_products')]
  ]);
}

function buildGroupProductsKeyboard(groupId, groupProducts) {
  const productButtons = [];

  for (let index = 0; index < groupProducts.length; index += 2) {
    const row = groupProducts.slice(index, index + 2).map((product) => {
      const unit = getProductUnit(product);
      return Markup.button.callback(`${product.name} - ₵${product.price}/${unit}`, `category_${product.id}`);
    });
    productButtons.push(row);
  }

  productButtons.push([Markup.button.callback('⬅️ Back to collections', 'open_products')]);
  return Markup.inlineKeyboard(productButtons);
}

async function sendGroupProducts(ctx, groupId) {
  const group = productGroups.find((entry) => entry.id === groupId);
  if (!group) {
    await ctx.reply('That collection is unavailable right now.', buildCategoryKeyboard());
    return;
  }

  const { products } = await loadProducts();
  const groupProducts = getProductsByGroup(products, groupId);
  await ctx.reply(
    [
      `${group.icon} ${group.name}`,
      group.blurb,
      '',
      `Browse the ${group.name.toLowerCase()} lineup below.`,
      '',
      formatGroupProducts(`${group.name} selection`, groupProducts)
    ].join('\n'),
    buildGroupProductsKeyboard(groupId, groupProducts)
  );
}

async function sendCategorySelection(ctx, useEditMessage = false) {
  try {
    const { products } = await loadProducts();
    const message = [
      'Premium collections',
      '',
      formatCategoryList(products),
      '',
      'Tap a collection to open its products.'
    ].join('\n');
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
  const contextKey = getContextKey(ctx);
  pendingSearchUsers.delete(contextKey);
  pendingTrackUsers.delete(contextKey);

  const anonymousSessionNote = ctx.from
    ? ''
    : '\n\n<b>Anonymous-safe session active.</b> Replies and cart state are scoped to this chat.';

  await ctx.replyWithHTML(
    `Welcome to our private collection.\n\nYou\'ve been granted access to a discreet, premium storefront designed for clients who value quality, privacy, and a seamless experience.\n\n🛍️ <b>Inside, you\'ll find:</b>\n• <b>GOODIES</b> for the current classics\n• <b>EDIBLES</b> for sweets and baked treats\n• <b>DRINKS</b> for infused beverages\n• Clear collection cards with item counts\n• Polished item pages with quick gram selection\n• Smooth and secure ordering\n• Real-time order updates\n\n🔒 <b>Discretion is our standard</b>\nEvery interaction is handled with professionalism and strict confidentiality.\n\nTake your time, explore the collection, and choose what suits you best.\n\n👉 Tap "View Products" to begin.\n\nFor assistance, simply send a message - dedicated support is always available.${anonymousSessionNote}`,
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
  const contextKey = getContextKey(ctx);
  pendingSearchUsers.delete(contextKey);
  pendingTrackUsers.delete(contextKey);
  await sendCategorySelection(ctx);
});

bot.hears('🔍 Search', async (ctx) => {
  const contextKey = getContextKey(ctx);
  pendingSearchUsers.add(contextKey);
  pendingTrackUsers.delete(contextKey);
  await ctx.reply('Send a product keyword. Try: gold, jelly, cake, sobolo, or lamogin.', buildMainMenu());
});

bot.hears('📦 Track Order', async (ctx) => {
  const contextKey = getContextKey(ctx);
  pendingTrackUsers.add(contextKey);
  pendingSearchUsers.delete(contextKey);
  await ctx.reply('Send your order ID (example: 12).', buildMainMenu());
});

bot.hears('🛒 My Cart', async (ctx) => {
  const contextKey = getContextKey(ctx);
  pendingSearchUsers.delete(contextKey);
  pendingTrackUsers.delete(contextKey);
  await showCart(ctx);
});

bot.hears('❓ Help', async (ctx) => {
  const contextKey = getContextKey(ctx);
  pendingSearchUsers.delete(contextKey);
  pendingTrackUsers.delete(contextKey);
  await showHelp(ctx);
});

bot.on('text', async (ctx, next) => {
  const userId = getContextKey(ctx);
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
  await safeAnswerCbQuery(ctx, 'Collections refreshed');
  await sendCategorySelection(ctx, true);
});

bot.action(/group_(goodies|edibles|drinks)/, async (ctx) => {
  const groupId = ctx.match[1];

  try {
    await safeAnswerCbQuery(ctx, 'Opening collection');
    await sendGroupProducts(ctx, groupId);
  } catch (error) {
    await safeAnswerCbQuery(ctx, 'Collection failed');
    await ctx.reply('Could not open this collection right now. Please try again.');
  }
});

bot.action(/category_(\d+)/, async (ctx) => {
  const productId = Number(ctx.match[1]);

  try {
    await safeAnswerCbQuery(ctx, 'Category opened');
    const { products } = await loadProducts();
    const product = products.find((entry) => Number(entry.id) === productId);

    if (!product) {
      await ctx.reply('This product is currently unavailable. Choose another product.', buildCategoryKeyboard());
      return;
    }

    await ctx.reply(
      formatProductDetail(product),
      buildQuantityKeyboard(product)
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
      formatProductDetail(product),
      buildQuantityKeyboard(product)
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
  const userId = getContextKey(ctx);
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
  const userId = getContextKey(ctx);
  const productId = Number(ctx.match[1]);
  const cartItems = getUserCart(userId);
  const itemIndex = cartItems.findIndex((item) => Number(item.productId) === productId);

  if (itemIndex === -1) {
    await ctx.reply('Item not found in cart.');
    return;
  }

  const item = cartItems[itemIndex];
  
  // Show options to adjust quantity
  const { products } = await loadProducts();
  const product = products.find((entry) => Number(entry.id) === productId);
  const unit = product ? getProductUnit(product) : 'unit';
  const productName = product?.name || `Product #${productId}`;

  await ctx.reply(
    `Adjusting: ${productName}\nCurrent quantity: ${item.quantity}${unit}\n\nWhat would you like to do?`,
    Markup.inlineKeyboard([
      [Markup.button.callback(`Remove all (${item.quantity}${unit})`, `cart_remove_all_${productId}`)],
      [Markup.button.callback(`Reduce by 1${unit}`, `cart_reduce_${productId}`)],
      [Markup.button.callback('Keep as is', 'cart_show')]
    ])
  );
});

bot.action(/cart_remove_all_(\d+)/, async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Removing...');
  const userId = getContextKey(ctx);
  const productId = Number(ctx.match[1]);
  const cartItems = getUserCart(userId);
  const updated = cartItems.filter((item) => Number(item.productId) !== productId);
  userCarts.set(userId, updated);

  await showCart(ctx);
});

bot.action(/cart_reduce_(\d+)/, async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Reducing quantity...');
  const userId = getContextKey(ctx);
  const productId = Number(ctx.match[1]);
  const cartItems = getUserCart(userId);
  const item = cartItems.find((entry) => Number(entry.productId) === productId);

  if (!item) {
    await ctx.reply('Item not found.');
    return;
  }

  if (item.quantity > 1) {
    item.quantity -= 1;
    item.lineTotal = item.quantity * item.unitPrice;
  } else {
    const updated = cartItems.filter((entry) => Number(entry.productId) !== productId);
    userCarts.set(userId, updated);
  }

  await showCart(ctx);
});

bot.action('cart_show', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Opening cart');
  await showCart(ctx);
});

bot.action('cart_checkout', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Processing checkout...');
  const userId = getContextKey(ctx);
  const cartItems = getUserCart(userId);

  if (!cartItems.length) {
    await ctx.reply('Your cart is empty. Add products first.', buildCartKeyboard());
    return;
  }

  const { products } = await loadProducts();
  const customerName = getContextLabel(ctx);

  try {
    // Show order summary before final confirmation
    const itemLines = cartItems.map((item) => {
      const product = products.find((entry) => Number(entry.id) === Number(item.productId));
      const productName = product?.name || `Product #${item.productId}`;
      return `• ${item.quantity} ${getProductUnit(product)} ${productName} = ₵${item.lineTotal}`;
    });

    const total = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const confirmationMsg = [
      '📋 Order Confirmation',
      '',
      'Reviewing your complete order:',
      '',
      itemLines.join('\n'),
      '',
      `Final Total: ₵${total}`,
      '',
      'Click "Confirm Order" to complete your purchase.'
    ].join('\n');

    await ctx.reply(
      confirmationMsg,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirm Order', 'cart_confirm_final')],
        [Markup.button.callback('❌ Cancel', 'cart_show')]
      ])
    );
  } catch (error) {
    console.error('Checkout error:', error);
    await ctx.reply('Could not process checkout. Please try again.');
  }
});

bot.action('cart_confirm_final', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Finalizing order...');
  const userId = getContextKey(ctx);
  const cartItems = getUserCart(userId);

  if (!cartItems.length) {
    await ctx.reply('Your cart is empty. Add products first.', buildCartKeyboard());
    return;
  }

  const customerName = getContextLabel(ctx);

  try {
    const response = await fetch(`${apiBaseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName,
        items: cartItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity
        }))
      })
    });

    if (!response.ok) {
      throw new Error(`Checkout request failed: ${response.status}`);
    }

    const order = await response.json();
    userCarts.set(userId, []);

    await ctx.reply(
      `✅ Checkout complete!\n\nOrder ID: ${order.id}\nTotal: ₵${order.total}\nStatus: ${order.status}\nCreated: ${order.createdAt}\n\nNext step: track your order or continue shopping.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📦 Track this order', `track_${order.id}`)],
        [Markup.button.callback('🛍️ View Products', 'open_products')]
      ])
    );
  } catch (error) {
    console.error('Final checkout error:', error);
    await ctx.reply('❌ Checkout failed. Please try again or contact support.');
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
  await safeAnswerCbQuery(ctx, 'Opening collections');
  await sendCategorySelection(ctx);
});

bot.catch((error, ctx) => {
  console.error('Bot error:', error);
  if (ctx) {
    ctx.reply('Something went wrong. Please try again.');
  }
});

async function startBot() {
  const runtimeMode = resolveRuntimeMode();
  const maxBackoffMs = 30000;
  let attempt = 0;

  if (runtimeMode === 'webhook' && !webhookUrl) {
    throw new Error('WEBHOOK_URL must be set when BOT_MODE is webhook or auto resolves to webhook');
  }

  if (runtimeMode === 'polling') {
    startHealthServer();
  }

  while (true) {
    try {
      acquireBotLock();

      if (runtimeMode === 'webhook') {
        console.log(`Starting bot in webhook mode at ${webhookPath} on port ${healthPort}...`);
        await bot.launch({
          webhook: {
            domain: webhookUrl,
            hookPath: webhookPath,
            port: healthPort,
            host: '0.0.0.0',
            cb: healthApp,
            secretToken: webhookSecretToken
          }
        });
        console.log('Webhook connected.');
      } else {
        console.log('Starting bot in polling mode...');
        await bot.telegram.deleteWebhook({ drop_pending_updates: false });
        await bot.launch({ dropPendingUpdates: false });
        console.log('Polling connected.');
      }

      const me = await bot.telegram.getMe();
      console.log(`Bot is running as @${me.username} (${runtimeMode})`);
      return;
    } catch (error) {
      releaseBotLock();
      attempt += 1;
      const isConflict = error?.response?.error_code === 409;
      const backoffMs = Math.min(2000 * attempt, maxBackoffMs);

      if (isConflict) {
        console.warn(`Telegram conflict detected. Retrying in ${backoffMs}ms...`);
      } else {
        console.error(`Failed to launch bot (attempt ${attempt}):`, error);
        console.log(`Retrying launch in ${backoffMs}ms...`);
      }

      await sleep(backoffMs);
    }
  }
}

startBot();

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

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