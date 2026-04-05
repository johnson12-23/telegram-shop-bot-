function formatPrice(value) {
  return `₵${Number(value || 0)}`;
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

  const lines = cartRows.map((item, index) => `${index + 1}. ${item.name} x ${item.quantity} = ${formatPrice(item.lineTotal)}`);
  const total = cartRows.reduce((sum, item) => sum + item.lineTotal, 0);
  return ['🛒 Your Cart', '', ...lines, '', `Total: ${formatPrice(total)}`].join('\n');
}

function buildCheckoutSummary(cartRows) {
  const lines = cartRows.map((item) => `• ${item.name} x ${item.quantity} = ${formatPrice(item.lineTotal)}`);
  const total = cartRows.reduce((sum, item) => sum + item.lineTotal, 0);
  return {
    total,
    text: ['📋 Checkout Summary', '', ...lines, '', `Total: ${formatPrice(total)}`, '', 'Tap Confirm Order to continue.'].join('\n')
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
