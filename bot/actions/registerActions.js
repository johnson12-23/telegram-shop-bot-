const { getUserId, getDisplayName, createIdempotencyKey, safeAnswerCbQuery, withHandler } = require('../utils/helpers');
const {
  mainMenuKeyboard,
  categoryKeyboard,
  productsKeyboard,
  productDetailKeyboard,
  cartKeyboard,
  checkoutKeyboard,
  deliveryPendingKeyboard,
  orderConfirmedKeyboard,
  paymentKeyboard
} = require('../ui/keyboards');
const {
  formatProductDetails,
  buildCartView,
  buildCheckoutSummary,
  buildTrackingMessage,
  formatPrice
} = require('../ui/messages');
const { logger } = require('../utils/logger');

function buildProductMap(products) {
  return new Map(products.map((product) => [Number(product.id), product]));
}

function resolveCartRows(cartItems, productMap) {
  return cartItems
    .map((item) => {
      const product = productMap.get(Number(item.productId));
      if (!product) {
        return null;
      }

      return {
        productId: Number(product.id),
        name: product.name,
        quantity: Number(item.quantity),
        unitPrice: Number(product.price),
        lineTotal: Number(product.price) * Number(item.quantity),
        stock: Number(product.stock)
      };
    })
    .filter(Boolean);
}

function registerActions(bot, deps) {
  const { backendService, cartStore, sessionStore, config } = deps;

  async function editOrReply(ctx, text, extra) {
    const userId = getUserId(ctx);
    const textSignature = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);

    if (ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageText(text, extra);
        return;
      } catch (error) {
        const description = error?.response?.description || '';
        if (description.includes('message is not modified')) {
          return;
        }
      }
    }

    if (sessionStore.isDuplicatePrompt(userId, textSignature)) {
      return;
    }

    await ctx.reply(text, extra);
  }

  bot.use(withHandler('middleware.callback_dedupe', async (ctx, next) => {
    if (!ctx.callbackQuery) {
      await next();
      return;
    }

    const userId = getUserId(ctx);
    const messageId = ctx.callbackQuery?.message?.message_id;
    const data = ctx.callbackQuery?.data;
    if (sessionStore.isDuplicateTap(userId, messageId, data)) {
      await safeAnswerCbQuery(ctx, 'Already processing...');
      return;
    }

    await next();
  }));

  bot.action('menu_home', withHandler('action.menu_home', async (ctx) => {
    await safeAnswerCbQuery(ctx, 'Home');
    await editOrReply(ctx, 'Main menu', mainMenuKeyboard());
  }));

  bot.action('menu_browse', withHandler('action.menu_browse', async (ctx) => {
    await safeAnswerCbQuery(ctx, 'Loading categories...');
    const products = await backendService.getProducts();
    await editOrReply(ctx, 'Choose a category:', categoryKeyboard(products));
  }));

  bot.action(/cat_(.+)/, withHandler('action.category', async (ctx) => {
    const group = ctx.match[1];
    await safeAnswerCbQuery(ctx, 'Loading products...');
    const products = await backendService.getProducts();
    const groupItems = products.filter((product) => product.group === group);

    if (!groupItems.length) {
      await editOrReply(ctx, 'No products found in this category.', mainMenuKeyboard());
      return;
    }

    await editOrReply(
      ctx,
      `${group.toUpperCase()} products\nTap any item for details.`,
      productsKeyboard(products, group)
    );
  }));

  bot.action(/product_(\d+)/, withHandler('action.product_detail', async (ctx) => {
    const productId = Number(ctx.match[1]);
    await safeAnswerCbQuery(ctx, 'Opening product...');
    const product = await backendService.getProduct(productId);

    await editOrReply(ctx, formatProductDetails(product), productDetailKeyboard(productId));
  }));

  bot.action(/add_(\d+)_(\d+)/, withHandler('action.add_to_cart', async (ctx) => {
    const productId = Number(ctx.match[1]);
    const quantityToAdd = Number(ctx.match[2]);
    await safeAnswerCbQuery(ctx, 'Adding to cart...');

    const userId = getUserId(ctx);
    const product = await backendService.getProduct(productId);
    const existing = cartStore.getItems(userId).find((item) => Number(item.productId) === productId);
    const nextQty = Number(existing?.quantity || 0) + quantityToAdd;

    if (nextQty > Number(product.stock)) {
      await editOrReply(
        ctx,
        `Only ${product.stock} left for ${product.name}. Please reduce quantity.`,
        productDetailKeyboard(productId)
      );
      return;
    }

    cartStore.setItem(userId, { productId, quantity: nextQty });
    await editOrReply(
      ctx,
      `Added ${quantityToAdd} x ${product.name} to cart.\nCurrent quantity: ${nextQty}`,
      mainMenuKeyboard()
    );
  }));

  bot.action('menu_cart', withHandler('action.menu_cart', async (ctx) => {
    await safeAnswerCbQuery(ctx, 'Opening cart...');
    const userId = getUserId(ctx);
    const products = await backendService.getProducts();
    const productMap = buildProductMap(products);
    const cartRows = resolveCartRows(cartStore.getItems(userId), productMap);

    await editOrReply(ctx, buildCartView(cartRows), cartKeyboard(cartRows));
  }));

  bot.action(/cart_inc_(\d+)/, withHandler('action.cart_inc', async (ctx) => {
    const productId = Number(ctx.match[1]);
    await safeAnswerCbQuery(ctx, 'Updating quantity...');
    const userId = getUserId(ctx);
    const product = await backendService.getProduct(productId);
    const existing = cartStore.getItems(userId).find((item) => Number(item.productId) === productId);
    const nextQty = Number(existing?.quantity || 0) + 1;

    if (nextQty > Number(product.stock)) {
      await safeAnswerCbQuery(ctx, 'Stock limit reached');
      await editOrReply(ctx, `${product.name} has only ${product.stock} in stock.`, mainMenuKeyboard());
      return;
    }

    cartStore.setItem(userId, { productId, quantity: nextQty });
    const products = await backendService.getProducts();
    const rows = resolveCartRows(cartStore.getItems(userId), buildProductMap(products));
    await editOrReply(ctx, buildCartView(rows), cartKeyboard(rows));
  }));

  bot.action(/cart_dec_(\d+)/, withHandler('action.cart_dec', async (ctx) => {
    const productId = Number(ctx.match[1]);
    await safeAnswerCbQuery(ctx, 'Updating quantity...');
    const userId = getUserId(ctx);
    const existing = cartStore.getItems(userId).find((item) => Number(item.productId) === productId);

    if (!existing) {
      await editOrReply(ctx, 'Item not found in cart.', mainMenuKeyboard());
      return;
    }

    const nextQty = Number(existing.quantity) - 1;
    if (nextQty <= 0) {
      cartStore.removeItem(userId, productId);
    } else {
      cartStore.setItem(userId, { productId, quantity: nextQty });
    }

    const products = await backendService.getProducts();
    const rows = resolveCartRows(cartStore.getItems(userId), buildProductMap(products));
    await editOrReply(ctx, buildCartView(rows), cartKeyboard(rows));
  }));

  bot.action(/cart_remove_(\d+)/, withHandler('action.cart_remove', async (ctx) => {
    const productId = Number(ctx.match[1]);
    await safeAnswerCbQuery(ctx, 'Removing item...');
    const userId = getUserId(ctx);
    cartStore.removeItem(userId, productId);

    const products = await backendService.getProducts();
    const rows = resolveCartRows(cartStore.getItems(userId), buildProductMap(products));
    await editOrReply(ctx, buildCartView(rows), cartKeyboard(rows));
  }));

  bot.action('checkout_open', withHandler('action.checkout_open', async (ctx) => {
    await safeAnswerCbQuery(ctx, 'Preparing checkout...');
    const userId = getUserId(ctx);
    const products = await backendService.getProducts();
    const rows = resolveCartRows(cartStore.getItems(userId), buildProductMap(products));

    if (!rows.length) {
      await editOrReply(ctx, 'Cart is empty. Add products first.', mainMenuKeyboard());
      return;
    }

    const summary = buildCheckoutSummary(rows);
    await editOrReply(ctx, summary.text, checkoutKeyboard());
  }));

  bot.action('checkout_confirm', withHandler('action.checkout_confirm', async (ctx) => {
    await safeAnswerCbQuery(ctx, 'Awaiting delivery details...');
    const userId = getUserId(ctx);
    const products = await backendService.getProducts();
    const rows = resolveCartRows(cartStore.getItems(userId), buildProductMap(products));

    if (!rows.length) {
      await editOrReply(ctx, 'Cart is empty. Add products first.', mainMenuKeyboard());
      return;
    }

    sessionStore.setWaitingDelivery(userId, {
      items: rows.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      total: rows.reduce((sum, item) => sum + item.lineTotal, 0),
      createdAt: Date.now()
    });

    const summary = buildCheckoutSummary(rows);
    await editOrReply(
      ctx,
      [
        summary.text,
        '',
        'Send delivery details in one message:',
        'Name, area, phone.'
      ].join('\n'),
      deliveryPendingKeyboard()
    );
  }));

  bot.action('checkout_cancel', withHandler('action.checkout_cancel', async (ctx) => {
    await safeAnswerCbQuery(ctx, 'Checkout cancelled');
    const userId = getUserId(ctx);
    sessionStore.clearWaitingDelivery(userId);
    await editOrReply(ctx, 'Checkout cancelled. You can continue shopping.', mainMenuKeyboard());
  }));

  bot.action('menu_track', withHandler('action.menu_track', async (ctx) => {
    await safeAnswerCbQuery(ctx, 'Tracking ready');
    const userId = getUserId(ctx);
    sessionStore.enableTrackInput(userId);
    await editOrReply(ctx, 'Send your order ID to track (example: ORD-XXXX).', mainMenuKeyboard());
  }));

  bot.action(/track_(.+)/, withHandler('action.track_button', async (ctx) => {
    await safeAnswerCbQuery(ctx, 'Loading order...');
    const orderId = String(ctx.match[1]).trim();
    const order = await backendService.getOrderById(orderId);
    await editOrReply(ctx, buildTrackingMessage(order), mainMenuKeyboard());
  }));

  bot.action(/pay_(.+)/, withHandler('action.payment_link', async (ctx) => {
    await safeAnswerCbQuery(ctx, 'Generating payment link...');
    const orderId = String(ctx.match[1]).trim();
    const payload = await backendService.createPaymentLink(orderId, config.provider);
    const amountText = Number(payload.amount) > 0 ? `Amount: ${formatPrice(payload.amount)}` : 'Amount will show on payment page.';
    const fallbackNote = payload.localFallback ? '\nUsing backup payment link.' : '';

    await editOrReply(
      ctx,
      `Payment ready for ${orderId}.\n${amountText}${fallbackNote}`,
      paymentKeyboard(orderId, payload.paymentLink)
    );
  }));

  bot.action('menu_recommend', withHandler('action.menu_recommend', async (ctx) => {
    await safeAnswerCbQuery(ctx, 'Loading recommendations...');
    const userId = getUserId(ctx);
    const response = await backendService.getRecommendations(userId, 3);
    const rows = response.recommendations || [];

    if (!rows.length) {
      await editOrReply(ctx, 'No recommendations available yet.', mainMenuKeyboard());
      return;
    }

    const lines = rows.map((item, index) => `${index + 1}. ${item.name} • ₵${item.price}`);
    await editOrReply(ctx, ['✨ You may also like', '', ...lines].join('\n'), mainMenuKeyboard());
  }));

  bot.action('menu_updates', withHandler('action.menu_updates', async (ctx) => {
    await safeAnswerCbQuery(ctx, 'Loading updates...');
    const userId = getUserId(ctx);
    const result = await backendService.getNotifications(userId);
    const items = result.notifications || [];

    if (!items.length) {
      await editOrReply(ctx, 'No updates yet.', mainMenuKeyboard());
      return;
    }

    const lines = items.slice(-5).map((item) => `• ${item.title}: ${item.message}`);
    await editOrReply(ctx, ['🔔 Recent updates', '', ...lines].join('\n'), mainMenuKeyboard());
  }));

  bot.action('menu_help', withHandler('action.menu_help', async (ctx) => {
    await safeAnswerCbQuery(ctx, 'Help');
    await editOrReply(
      ctx,
      [
        'How to shop:',
        '1) Browse categories',
        '2) Open product and add quantity',
        '3) Open cart and checkout',
        '4) Confirm order and send delivery details',
        '5) Pay and track order'
      ].join('\n'),
      mainMenuKeyboard()
    );
  }));

  bot.on('text', withHandler('text.checkout_and_track', async (ctx, next) => {
    const userId = getUserId(ctx);
    const text = String(ctx.message?.text || '').trim();

    if (!text || text.startsWith('/')) {
      if (typeof next === 'function') {
        await next();
      }
      return;
    }

    if (sessionStore.isTrackInputPending(userId)) {
      sessionStore.clearTrackInput(userId);
      const order = await backendService.getOrderById(text);
      await ctx.reply(buildTrackingMessage(order), mainMenuKeyboard());
      return;
    }

    const pending = sessionStore.getWaitingDelivery(userId);
    if (!pending) {
      await ctx.reply('Use inline buttons to continue.', mainMenuKeyboard());
      return;
    }

    const deliveryDetails = text.replace(/\s+/g, ' ').slice(0, 240);
    if (deliveryDetails.length < 6) {
      await ctx.reply('Delivery details are too short. Send name, area, and phone.', deliveryPendingKeyboard());
      return;
    }

    const idempotencyKey = createIdempotencyKey(userId);
    const order = await backendService.createOrder({
      userId,
      customerName: getDisplayName(ctx),
      deliveryDetails,
      items: pending.items,
      idempotencyKey
    });

    sessionStore.clearWaitingDelivery(userId);
    cartStore.clear(userId);

    logger.info('bot.order_confirmed', { userId, orderId: order.id, total: order.total });
    await ctx.reply(
      [
        '✅ Order confirmed',
        `Order ID: ${order.id}`,
        `Status: ${order.status}`,
        `Total: ${formatPrice(order.total)}`,
        `Delivery: ${order.deliveryDetails}`
      ].join('\n'),
      orderConfirmedKeyboard(order.id)
    );
  }));
}

module.exports = { registerActions };
