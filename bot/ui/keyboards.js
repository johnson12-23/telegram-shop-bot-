const { Markup } = require('telegraf');
const { truncate } = require('../utils/helpers');

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛍️ Browse', 'menu_browse')],
    [Markup.button.callback('🛒 Cart', 'menu_cart')],
    [Markup.button.callback('📦 Track Order', 'menu_track')],
    [Markup.button.callback('✨ Recommended', 'menu_recommend')],
    [Markup.button.callback('🔔 Updates', 'menu_updates')],
    [Markup.button.callback('❓ Help', 'menu_help')]
  ]);
}

function categoryKeyboard(products) {
  const groups = new Map();
  for (const product of products) {
    const key = product.group || 'others';
    if (!groups.has(key)) {
      groups.set(key, 0);
    }
    groups.set(key, groups.get(key) + 1);
  }

  const rows = [...groups.entries()].map(([group, count]) => [
    Markup.button.callback(`${group.toUpperCase()} (${count})`, `cat_${group}`)
  ]);

  rows.push([Markup.button.callback('⬅️ Back', 'menu_home')]);
  return Markup.inlineKeyboard(rows);
}

function productsKeyboard(products, group) {
  const rows = products
    .filter((product) => product.group === group)
    .map((product) => [Markup.button.callback(`${truncate(product.name, 18)} • ₵${product.price}`, `product_${product.id}`)]);

  rows.push([Markup.button.callback('⬅️ Back', 'menu_browse')]);
  return Markup.inlineKeyboard(rows);
}

function productDetailKeyboard(productId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('+1', `add_${productId}_1`), Markup.button.callback('+2', `add_${productId}_2`)],
    [Markup.button.callback('+3', `add_${productId}_3`)],
    [Markup.button.callback('🛒 View Cart', 'menu_cart')],
    [Markup.button.callback('⬅️ Back', 'menu_browse'), Markup.button.callback('🏠 Home', 'menu_home')]
  ]);
}

function cartKeyboard(items) {
  const rows = [];

  for (const item of items) {
    const compactName = truncate(item.name, 8);
    rows.push([
      Markup.button.callback(`➖ ${compactName}`, `cart_dec_${item.productId}`),
      Markup.button.callback(`➕ ${compactName}`, `cart_inc_${item.productId}`)
    ]);
    rows.push([Markup.button.callback(`❌ Remove ${truncate(item.name, 14)}`, `cart_remove_${item.productId}`)]);
  }

  rows.push([Markup.button.callback('✅ Checkout', 'checkout_open')]);
  rows.push([Markup.button.callback('⬅️ Back', 'menu_home'), Markup.button.callback('🛍️ Browse', 'menu_browse')]);
  return Markup.inlineKeyboard(rows);
}

function checkoutKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirm', 'checkout_confirm')],
    [Markup.button.callback('⬅️ Cart', 'menu_cart'), Markup.button.callback('🏠 Home', 'menu_home')]
  ]);
}

function deliveryPendingKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'checkout_cancel')], [Markup.button.callback('🛒 Cart', 'menu_cart')]]);
}

function orderConfirmedKeyboard(orderId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💳 Pay Now', `pay_${orderId}`)],
    [Markup.button.callback('📦 Track Order', `track_${orderId}`)],
    [Markup.button.callback('⬅️ Home', 'menu_home')]
  ]);
}

function paymentKeyboard(orderId, paymentLink) {
  return Markup.inlineKeyboard([
    [Markup.button.url('💳 Open Payment', paymentLink)],
    [Markup.button.callback('🔗 Get Link', `getpay_${orderId}`)],
    [Markup.button.callback('📦 Track Order', `track_${orderId}`)],
    [Markup.button.callback('⬅️ Home', 'menu_home')]
  ]);
}

module.exports = {
  mainMenuKeyboard,
  categoryKeyboard,
  productsKeyboard,
  productDetailKeyboard,
  cartKeyboard,
  checkoutKeyboard,
  deliveryPendingKeyboard,
  orderConfirmedKeyboard,
  paymentKeyboard
};
