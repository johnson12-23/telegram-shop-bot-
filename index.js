require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');

const botToken = process.env.BOT_TOKEN;
const botTokenMissing = !botToken || !botToken.trim();
const defaultApiBaseUrl = process.env.RENDER
  ? 'https://telegram-shop-api.onrender.com'
  : 'http://localhost:4000';
const apiBaseUrl = (process.env.API_BASE_URL || defaultApiBaseUrl).replace(/\/+$/, '');
const botMode = (process.env.BOT_MODE || 'auto').toLowerCase();
const webhookUrl = (process.env.WEBHOOK_URL || '').trim().replace(/\/+$/, '');
const webhookPath = process.env.WEBHOOK_PATH || '/telegram/webhook';
const webhookSecretToken = process.env.WEBHOOK_SECRET_TOKEN || undefined;
const pendingSearchUsers = new Set();
const pendingTrackUsers = new Set();
const userCarts = new Map();
const pendingCheckoutSessions = new Map();
const pendingDeliverySessions = new Map();
const localOrders = new Map();
const actionLocks = new Map();
const promptCooldowns = new Map();
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

const bot = new Telegraf(botTokenMissing ? '000000:missing-token' : botToken);

function getContextKey(ctx) {
  return String(ctx.from?.id ?? ctx.senderChat?.id ?? ctx.chat?.id ?? 'anonymous');
}

function getCartKey(ctx) {
  // Prefer chat scope for stable cart continuity across callback and message updates.
  return String(ctx.chat?.id ?? ctx.from?.id ?? ctx.senderChat?.id ?? 'anonymous');
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

function getUserKey(ctx) {
  return String(ctx.from?.id ?? ctx.chat?.id ?? ctx.senderChat?.id ?? 'anonymous');
}

function getLocalOrderById(orderId) {
  for (const [, orders] of localOrders.entries()) {
    const found = orders.find((entry) => Number(entry.orderId) === Number(orderId));
    if (found) {
      return found;
    }
  }

  return null;
}

healthApp.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'telegram-shop-bot-worker',
    botTokenConfigured: !botTokenMissing
  });
});

healthApp.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'telegram-shop-bot-worker',
    botTokenConfigured: !botTokenMissing
  });
});

function startHealthServer() {
  if (healthServerStarted) {
    console.log('[Health] Server already started, skipping...');
    return;
  }

  healthServerStarted = true;
  
  return new Promise((resolve) => {
    const server = healthApp.listen(healthPort, '0.0.0.0', () => {
      console.log(`✅ Health server listening on 0.0.0.0:${healthPort}`);
      console.log(`   → GET http://localhost:${healthPort}/health`);
      console.log(`   → GET http://localhost:${healthPort}/`);
      resolve(server);
    });
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

  return 'polling';
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

function buildActionLockKey(ctx, actionName) {
  const cartKey = getCartKey(ctx);
  const messageId = ctx.callbackQuery?.message?.message_id || 'no_message';
  return `${actionName}:${cartKey}:${messageId}`;
}

function tryAcquireActionLock(ctx, actionName, lockMs = 1200) {
  const key = buildActionLockKey(ctx, actionName);
  const now = Date.now();
  const existingAt = actionLocks.get(key);

  if (existingAt && now - existingAt < lockMs) {
    return null;
  }

  actionLocks.set(key, now);
  return key;
}

function releaseActionLock(lockKey, cooldownMs = 900) {
  setTimeout(() => {
    actionLocks.delete(lockKey);
  }, cooldownMs);
}

async function replyWithCooldown(ctx, key, text, extra = undefined, cooldownMs = 2000) {
  const now = Date.now();
  const lastShown = promptCooldowns.get(key) || 0;
  if (now - lastShown < cooldownMs) {
    return;
  }

  promptCooldowns.set(key, now);
  if (extra) {
    await ctx.reply(text, extra);
    return;
  }

  await ctx.reply(text);
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

async function submitCartOrder(customerName, cartItems, retries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    let timeout;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 7000);
      const response = await fetch(`${apiBaseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
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

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(500 * attempt);
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  throw lastError || new Error('Checkout failed after retries');
}

function getUserCart(userId) {
  const cartKey = String(userId);

  if (!userCarts.has(cartKey)) {
    userCarts.set(cartKey, []);
  }

  return userCarts.get(cartKey);
}

function cloneCartItems(cartItems) {
  return cartItems.map((item) => ({
    productId: Number(item.productId),
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    lineTotal: Number(item.lineTotal)
  }));
}

function generateOrderId() {
  return Math.floor(1000 + Math.random() * 9000);
}

function normalizeDeliveryDetails(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').slice(0, 240);
}

function buildGroupedCartSummary(cartItems, products) {
  const sections = new Map();

  for (const group of productGroups) {
    sections.set(group.id, {
      heading: `${group.icon} ${group.name}`,
      lines: []
    });
  }

  sections.set('other', {
    heading: '📦 OTHER',
    lines: []
  });

  for (const item of cartItems) {
    const product = products.find((entry) => Number(entry.id) === Number(item.productId));
    const groupId = product?.group || 'other';
    const section = sections.get(groupId) || sections.get('other');
    const productName = product?.name || `Product #${item.productId}`;
    const unit = getProductUnit(product);
    section.lines.push(`• ${item.quantity}${unit} ${productName} - ₵${item.lineTotal}`);
  }

  const orderedGroupIds = [...productGroups.map((group) => group.id), 'other'];
  const groupedLines = [];

  for (const groupId of orderedGroupIds) {
    const section = sections.get(groupId);
    if (!section || section.lines.length === 0) {
      continue;
    }

    groupedLines.push(section.heading);
    groupedLines.push(...section.lines);
    groupedLines.push('');
  }

  if (groupedLines[groupedLines.length - 1] === '') {
    groupedLines.pop();
  }

  const total = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  return {
    groupedText: groupedLines.join('\n'),
    total
  };
}

function formatCartMessage(cartItems, products) {
  if (!cartItems.length) {
    return '🛒 Your Cart\n\nYour cart is empty. Add products to continue shopping.';
  }

  const { groupedText, total } = buildGroupedCartSummary(cartItems, products);
  return `🛒 Your Cart\n\n${groupedText}\n\nTotal: ₵${total}`;
}

function buildCartKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add More', 'open_products')],
    [Markup.button.callback('❌ Remove Item', 'cart_remove_menu')],
    [Markup.button.callback('💳 Checkout', 'cart_checkout')]
  ]);
}

async function showCart(ctx) {
  const cartKey = getCartKey(ctx);
  const cartItems = getUserCart(cartKey);
  const { products } = await loadProducts();

  await ctx.reply(formatCartMessage(cartItems, products), buildCartKeyboard());
}

async function addToCartFlow(ctx, productId, grams) {
  const cartKey = getCartKey(ctx);
  const cartItems = getUserCart(cartKey);
  pendingCheckoutSessions.delete(cartKey);
  pendingDeliverySessions.delete(cartKey);
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
  try {
    const response = await fetch(`${apiBaseUrl}/api/orders`);
    if (response.ok) {
      const orders = await response.json();
      if (Array.isArray(orders)) {
        const remoteOrder = orders.find((order) => Number(order.id) === Number(orderId));
        if (remoteOrder) {
          return remoteOrder;
        }
      }
    }
  } catch (error) {
    console.warn('Remote order lookup failed, trying local cache:', error.message);
  }

  const localOrder = getLocalOrderById(orderId);
  if (localOrder) {
    return {
      id: localOrder.orderId,
      status: localOrder.status || 'pending',
      total: localOrder.total || 0,
      createdAt: localOrder.createdAt || new Date().toISOString()
    };
  }

  return null;
}

function buildMainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛍️ View Products', 'menu_products')],
    [Markup.button.callback('🔍 Search', 'menu_search')],
    [Markup.button.callback('📦 Track Order', 'menu_track')],
    [Markup.button.callback('🛒 My Cart', 'menu_cart')],
    [Markup.button.callback('❓ Help', 'menu_help')]
  ]);
}

async function showHelp(ctx) {
  await ctx.replyWithHTML(
    '<b>Quick guide</b>\n\n🛍️ View Products - browse collections\n🔍 Search - find a product fast\n📦 Track Order - check status\n🛒 My Cart - view your cart\n❓ Help - open this guide',
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
  return (product?.group || 'goodies') === 'drinks' ? 'L' : 'g';
}

function getProductUnitLabel(product) {
  return (product?.group || 'goodies') === 'drinks' ? 'litre' : 'gram';
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

  for (const product of groupProducts) {
    const unit = getProductUnit(product);
    productButtons.push([
      Markup.button.callback(`${product.name} • ₵${product.price}/${unit}`, `category_${product.id}`)
    ]);
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
      'Browse the items below.',
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
      'Choose a collection below.'
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

function resetSessionState(ctx) {
  const contextKey = getContextKey(ctx);
  const cartKey = getCartKey(ctx);

  pendingSearchUsers.delete(contextKey);
  pendingTrackUsers.delete(contextKey);
  pendingSearchUsers.delete(cartKey);
  pendingTrackUsers.delete(cartKey);
  pendingCheckoutSessions.delete(cartKey);
  pendingDeliverySessions.delete(cartKey);
  userCarts.set(cartKey, []);
}

async function sendWelcomeMessage(ctx, options = {}) {
  const { restarted = false } = options;

  resetSessionState(ctx);

  const anonymousSessionNote = ctx.from
    ? ''
    : '\n\n<b>Anonymous-safe session active.</b> Replies and cart state are scoped to this chat.';

  const restartNote = restarted
    ? '\n\n<b>Session restarted.</b> Previous cart and pending actions were cleared.'
    : '';

  await ctx.replyWithHTML(
    `Welcome to our private collection.\n\nQuick access for mobile: browse collections, search products, track orders, and manage your cart.\n\n🛍️ <b>What you can do:</b>\n• Browse GOODIES, EDIBLES, and DRINKS\n• View item details and add to cart\n• Check order status\n• Complete checkout in one cart\n\nTap "View Products" to begin.${restartNote}${anonymousSessionNote}`,
    buildMainMenu()
  );
}

bot.start(async (ctx) => {
  await sendWelcomeMessage(ctx, { restarted: true });
});

bot.hears(/^\?start$/i, async (ctx) => {
  await sendWelcomeMessage(ctx, { restarted: true });
});

bot.hears(/^start$/i, async (ctx) => {
  await sendWelcomeMessage(ctx, { restarted: true });
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

  await ctx.reply(`Bot status: online\n${details}\nMode: ${mode}`, buildMainMenu());
});

bot.action('menu_products', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Opening products');
  const contextKey = getContextKey(ctx);
  pendingSearchUsers.delete(contextKey);
  pendingTrackUsers.delete(contextKey);
  await sendCategorySelection(ctx);
});

bot.action('menu_search', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Search ready');
  const contextKey = getContextKey(ctx);
  pendingSearchUsers.add(contextKey);
  pendingTrackUsers.delete(contextKey);
  await ctx.reply('Send one keyword. Example: gold, cake, sobolo.', buildMainMenu());
});

bot.action('menu_track', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Tracking ready');
  const contextKey = getContextKey(ctx);
  pendingTrackUsers.add(contextKey);
  pendingSearchUsers.delete(contextKey);
  await ctx.reply('Send your order ID, like 12.', buildMainMenu());
});

bot.action('menu_cart', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Opening cart');
  const contextKey = getContextKey(ctx);
  pendingSearchUsers.delete(contextKey);
  pendingTrackUsers.delete(contextKey);
  await showCart(ctx);
});

bot.action('menu_help', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Opening help');
  const contextKey = getContextKey(ctx);
  pendingSearchUsers.delete(contextKey);
  pendingTrackUsers.delete(contextKey);
  await showHelp(ctx);
});

// Backward compatibility for older reply-keyboard users.
bot.on('text', async (ctx, next) => {
  const userId = getContextKey(ctx);
  const cartKey = getCartKey(ctx);
  const userKey = getUserKey(ctx);
  const text = (ctx.message?.text || '').trim();

  if (!text || text.startsWith('/')) {
    return next();
  }

  if (pendingDeliverySessions.has(cartKey)) {
    const deliveryDetails = normalizeDeliveryDetails(text);

    if (!deliveryDetails || deliveryDetails.length < 6) {
      await ctx.reply('Please send complete delivery details (name, area, and phone).');
      return;
    }

    const session = pendingDeliverySessions.get(cartKey);
    pendingDeliverySessions.delete(cartKey);

    if (!session?.items?.length) {
      await ctx.reply('Your checkout session expired. Please open your cart and checkout again.', buildCartKeyboard());
      return;
    }

    const customerName = getContextLabel(ctx);
    const localOrderId = generateOrderId();
    const localTotal = session.total;

    const localOrder = {
      orderId: localOrderId,
      items: cloneCartItems(session.items),
      total: localTotal,
      status: 'pending',
      deliveryDetails,
      createdAt: new Date().toISOString()
    };

    if (!localOrders.has(userKey)) {
      localOrders.set(userKey, []);
    }
    localOrders.get(userKey).push(localOrder);

    console.log('order_details_received', {
      cartKey,
      userKey,
      orderId: localOrderId,
      total: localTotal,
      deliveryDetails
    });

    let order = null;
    try {
      order = await submitCartOrder(customerName, session.items);
      console.log('order_saved_remote', order);
    } catch (error) {
      console.warn('Remote order save failed; using local order snapshot:', error.message);
    }

    userCarts.set(cartKey, []);
    pendingCheckoutSessions.delete(cartKey);

    const finalOrderId = order?.id || localOrderId;
    const finalTotal = order?.total || localTotal;
    const finalStatus = order?.status || 'pending';

    await ctx.reply(
      [
        '✅ Order Confirmed!',
        `Order ID: #${finalOrderId}`,
        `Status: ${finalStatus}`,
        `Total: ₵${finalTotal}`,
        `Delivery: ${deliveryDetails}`,
        '',
        'Tap Pay Now to continue.'
      ].join('\n'),
      Markup.inlineKeyboard([
        [Markup.button.callback('💳 Pay Now', `payment_prompt_${finalOrderId}`)],
        [Markup.button.callback('🛍️ View Products', 'open_products')]
      ])
    );
    return;
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
    return;
  }

  await ctx.reply('Use the inline buttons below to continue.', buildMainMenu());
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
  const lockKey = tryAcquireActionLock(ctx, 'cart_remove_menu');
  if (!lockKey) {
    await safeAnswerCbQuery(ctx, 'Please wait...');
    return;
  }

  try {
  await safeAnswerCbQuery(ctx, 'Choose item to remove');
  const cartKey = getCartKey(ctx);
  const cartItems = getUserCart(cartKey);

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
  } finally {
    releaseActionLock(lockKey);
  }
});

bot.action(/cart_remove_(\d+)/, async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Removing item...');
  const cartKey = getCartKey(ctx);
  const productId = Number(ctx.match[1]);
  const cartItems = getUserCart(cartKey);
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
  const cartKey = getCartKey(ctx);
  const productId = Number(ctx.match[1]);
  const cartItems = getUserCart(cartKey);
  const updated = cartItems.filter((item) => Number(item.productId) !== productId);
  userCarts.set(cartKey, updated);
  pendingCheckoutSessions.delete(cartKey);
  pendingDeliverySessions.delete(cartKey);

  await showCart(ctx);
});

bot.action(/cart_reduce_(\d+)/, async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Reducing quantity...');
  const cartKey = getCartKey(ctx);
  const productId = Number(ctx.match[1]);
  const cartItems = getUserCart(cartKey);
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
    userCarts.set(cartKey, updated);
  }

  pendingCheckoutSessions.delete(cartKey);
  pendingDeliverySessions.delete(cartKey);

  await showCart(ctx);
});

bot.action('cart_show', async (ctx) => {
  await safeAnswerCbQuery(ctx, 'Opening cart');
  await showCart(ctx);
});

bot.action('cart_checkout', async (ctx) => {
  const lockKey = tryAcquireActionLock(ctx, 'cart_checkout');
  if (!lockKey) {
    await safeAnswerCbQuery(ctx, 'Checkout already opened');
    return;
  }

  try {
    await safeAnswerCbQuery(ctx, 'Processing checkout...');
    const cartKey = getCartKey(ctx);
    const cartItems = getUserCart(cartKey);

    if (pendingDeliverySessions.has(cartKey)) {
      await replyWithCooldown(
        ctx,
        `delivery_pending_checkout:${cartKey}`,
        'Delivery details are pending. Please send your name, area, and phone number.'
      );
      return;
    }

    const existingCheckout = pendingCheckoutSessions.get(cartKey);
    if (existingCheckout && !existingCheckout.processing) {
      await safeAnswerCbQuery(ctx, 'Confirmation already opened');
      return;
    }

    if (!cartItems.length) {
      await ctx.reply('Your cart is empty. Add products first.', buildCartKeyboard());
      return;
    }

    const { products } = await loadProducts();
    const checkoutItems = cloneCartItems(cartItems);
    const { groupedText, total } = buildGroupedCartSummary(checkoutItems, products);
    pendingCheckoutSessions.set(cartKey, {
      items: checkoutItems,
      total,
      processing: false,
      createdAt: Date.now()
    });

    const confirmationMsg = [
      '📋 Order Confirmation',
      '',
      'Reviewing your complete cart (all groups):',
      '',
      groupedText,
      '',
      `Final Total: ₵${total}`,
      '',
      'Tap Confirm Order to complete your purchase.'
    ].join('\n');

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Confirm Order', 'confirm_order')],
      [Markup.button.callback('❌ Cancel', 'cancel_order')]
    ]);

    try {
      await ctx.editMessageText(confirmationMsg, keyboard);
    } catch (editError) {
      await ctx.reply(confirmationMsg, keyboard);
    }
  } catch (error) {
    console.error('Checkout error:', error);
    await ctx.reply('Could not process checkout. Please try again.');
  } finally {
    releaseActionLock(lockKey);
  }
});

async function processConfirmOrder(ctx) {
  const cartKey = getCartKey(ctx);
  const userKey = getUserKey(ctx);
  const pendingCheckout = pendingCheckoutSessions.get(cartKey);
  const cartItems = pendingCheckout?.items || cloneCartItems(getUserCart(cartKey));

  if (!cartItems.length) {
    await replyWithCooldown(
      ctx,
      `empty_confirm:${cartKey}`,
      'Your cart is empty. Add products first.',
      buildCartKeyboard()
    );
    return;
  }

  if (pendingDeliverySessions.has(cartKey)) {
    await replyWithCooldown(
      ctx,
      `delivery_pending_confirm:${cartKey}`,
      'Delivery details are pending. Please send your name, area, and phone number.'
    );
    return;
  }

  if (pendingCheckout?.processing) {
    await safeAnswerCbQuery(ctx, 'Order already being processed...');
    return;
  }

  if (pendingCheckout) {
    pendingCheckout.processing = true;
  }

  try {
    console.log('confirm_order triggered', {
      cartKey,
      userKey,
      itemCount: cartItems.length
    });

    pendingCheckoutSessions.delete(cartKey);
    const total = cartItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
    pendingDeliverySessions.set(cartKey, {
      items: cloneCartItems(cartItems),
      total,
      createdAt: Date.now(),
      userKey
    });

    const doneMsg = [
      '✅ Cart validated',
      `Items: ${cartItems.length}`,
      `Total: ₵${total}`,
      '',
      'Send your delivery details in one message:',
      'Name, area, phone number.'
    ].join('\n');

    try {
      await ctx.editMessageText(doneMsg, Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'cancel_order')]
      ]));
    } catch (editError) {
      await ctx.reply(doneMsg, Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'cancel_order')]
      ]));
    }
  } catch (error) {
    console.error('Final checkout error:', error);
    if (pendingCheckout) {
      pendingCheckout.processing = false;
    }
    await ctx.reply('❌ Checkout failed. Please try again in a moment. If it persists, contact support.');
  }
}

bot.action('confirm_order', async (ctx) => {
  const lockKey = tryAcquireActionLock(ctx, 'confirm_order');
  if (!lockKey) {
    await safeAnswerCbQuery(ctx, 'Already confirming...');
    return;
  }

  try {
  await safeAnswerCbQuery(ctx, 'Confirming order...');
  await processConfirmOrder(ctx);
  } finally {
    releaseActionLock(lockKey);
  }
});

bot.action('cancel_order', async (ctx) => {
  const lockKey = tryAcquireActionLock(ctx, 'cancel_order');
  if (!lockKey) {
    await safeAnswerCbQuery(ctx, 'Already cancelled');
    return;
  }

  try {
    await safeAnswerCbQuery(ctx, 'Order cancelled');
    const cartKey = getCartKey(ctx);
    pendingCheckoutSessions.delete(cartKey);
    pendingDeliverySessions.delete(cartKey);
    userCarts.set(cartKey, []);

    try {
      await ctx.editMessageText('❌ Order cancelled\n\nYour cart has been cleared.', Markup.inlineKeyboard([
        [Markup.button.callback('🛍️ View Products', 'open_products')]
      ]));
    } catch (error) {
      await ctx.reply('❌ Order cancelled\n\nYour cart has been cleared.', Markup.inlineKeyboard([
        [Markup.button.callback('🛍️ View Products', 'open_products')]
      ]));
    }
  } finally {
    releaseActionLock(lockKey);
  }
});

bot.action('cart_confirm_final', async (ctx) => {
  const lockKey = tryAcquireActionLock(ctx, 'cart_confirm_final');
  if (!lockKey) {
    await safeAnswerCbQuery(ctx, 'Already confirming...');
    return;
  }

  try {
  await safeAnswerCbQuery(ctx, 'Confirming order...');
  await processConfirmOrder(ctx);
  } finally {
    releaseActionLock(lockKey);
  }
});

bot.action(/payment_prompt_(\d+)/, async (ctx) => {
  const lockKey = tryAcquireActionLock(ctx, 'payment_prompt');
  if (!lockKey) {
    await safeAnswerCbQuery(ctx, 'Payment options already opened');
    return;
  }

  try {
    const orderId = Number(ctx.match[1]);
    await safeAnswerCbQuery(ctx, 'Opening payment options...');

    const paymentMsg = [
      '💳 Payment Prompt',
      `Order ID: #${orderId}`,
      '',
      'Choose a payment option and complete payment.',
      'After payment, tap "I Have Paid".'
    ].join('\n');

    try {
      await ctx.editMessageText(paymentMsg, Markup.inlineKeyboard([
        [Markup.button.callback('✅ I Have Paid', `payment_done_${orderId}`)],
        [Markup.button.callback('📞 Contact Support', 'open_products')]
      ]));
    } catch (error) {
      await ctx.reply(paymentMsg, Markup.inlineKeyboard([
        [Markup.button.callback('✅ I Have Paid', `payment_done_${orderId}`)],
        [Markup.button.callback('📞 Contact Support', 'open_products')]
      ]));
    }
  } finally {
    releaseActionLock(lockKey);
  }
});

bot.action(/payment_done_(\d+)/, async (ctx) => {
  const lockKey = tryAcquireActionLock(ctx, 'payment_done');
  if (!lockKey) {
    await safeAnswerCbQuery(ctx, 'Payment already submitted');
    return;
  }

  try {
    const orderId = Number(ctx.match[1]);
    await safeAnswerCbQuery(ctx, 'Payment status received');

    const localOrder = getLocalOrderById(orderId);
    if (localOrder) {
      localOrder.status = 'payment_submitted';
      localOrder.paymentUpdatedAt = new Date().toISOString();
    }

    await ctx.reply(
      `✅ Payment noted for Order #${orderId}.\nWe will verify and update your order status shortly.`,
      Markup.inlineKeyboard([[Markup.button.callback('📦 Track Order', `track_${orderId}`)]])
    );
  } finally {
    releaseActionLock(lockKey);
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

  if (botTokenMissing) {
    console.warn('BOT_TOKEN is missing. Starting health server only so Render stays live.');
    console.warn('Add BOT_TOKEN in the Render service environment to enable the bot.');
    await startHealthServer();
    return;
  }

  if (runtimeMode === 'webhook' && !webhookUrl) {
    throw new Error('WEBHOOK_URL must be set when BOT_MODE is webhook or auto resolves to webhook');
  }

  // Always start the health server first (needed for Render health checks in both modes)
  try {
    await startHealthServer();
  } catch (error) {
    console.error('❌ Failed to start health server:', error);
    throw error;
  }

  while (true) {
    try {
      acquireBotLock();

      if (runtimeMode === 'webhook') {
        console.log(`🔗 Starting bot in webhook mode at ${webhookPath} on port ${healthPort}...`);
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
        console.log('✅ Webhook connected and receiving updates.');
      } else {
        console.log('📡 Starting bot in polling mode...');
        await bot.telegram.deleteWebhook({ drop_pending_updates: false });
        await bot.launch({ dropPendingUpdates: false });
        console.log('✅ Polling connected and listening for updates.');
      }

      const me = await bot.telegram.getMe();
      console.log(`🤖 Bot is running as @${me.username} (${runtimeMode})`);
      return;
    } catch (error) {
      releaseBotLock();
      attempt += 1;
      const isConflict = error?.response?.error_code === 409;
      const backoffMs = Math.min(2000 * attempt, maxBackoffMs);

      if (isConflict) {
        console.warn(`⚠️  Telegram conflict (409): Another instance active. Retrying in ${backoffMs}ms...`);
      } else {
        console.error(`❌ Failed to launch bot (attempt ${attempt}):`, error.message);
        console.log(`🔄 Retrying launch in ${backoffMs}ms...`);
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