function formatPrice(value) {
  return `₵${Number(value || 0)}`;
}

function compactName(name, maxLen = 22) {
  const value = String(name || '');
  if (value.length <= maxLen) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxLen - 1))}…`;
}

function formatProductDetails(product) {
  return [
    `${product.name}`,
    `Category: ${(product.group || 'others').toUpperCase()}`,
    `Price: ${formatPrice(product.price)}`,
    `Stock: ${product.stock}`,
    '',
    product.description || 'No description available.'
  ].join('\n');
}

function buildCartView(cartRows) {
  if (!cartRows.length) {
    return '🛒 Your cart is empty. Tap Browse to add items.';
  }

  const lines = cartRows.map((item, index) => `${index + 1}. ${compactName(item.name)} x${item.quantity} • ${formatPrice(item.lineTotal)}`);
  const total = cartRows.reduce((sum, item) => sum + item.lineTotal, 0);
  return ['🛒 Your Cart', '', ...lines, '', `Total: ${formatPrice(total)}`].join('\n');
}

function buildCheckoutSummary(cartRows) {
  const lines = cartRows.map((item) => `• ${compactName(item.name)} x${item.quantity} • ${formatPrice(item.lineTotal)}`);
  const total = cartRows.reduce((sum, item) => sum + item.lineTotal, 0);
  return {
    total,
    text: ['📋 Checkout', '', ...lines, '', `Total: ${formatPrice(total)}`, '', 'Tap Confirm to continue.'].join('\n')
  };
}

function buildTrackingMessage(order) {
  return [
    '📦 Order Tracking',
    `Order ID: ${order.id}`,
    `Status: ${order.status}`,
    `Total: ${formatPrice(order.total)}`,
    `Created: ${order.createdAt}`,
    order.updatedAt ? `Updated: ${order.updatedAt}` : ''
  ].filter(Boolean).join('\n');
}

module.exports = {
  formatPrice,
  formatProductDetails,
  buildCartView,
  buildCheckoutSummary,
  buildTrackingMessage
};
