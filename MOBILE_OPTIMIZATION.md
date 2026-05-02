# Mobile Optimization Guide

## 🚀 Key Principles for Instant Mobile Response

### 1. **Non-Blocking Operations**

All handlers must return responses immediately without waiting for long operations.

✅ **GOOD:**
```javascript
ctx.reply('Processing...').then(() => {
  // Do slow work in background
  slowBackgroundTask().catch(err => logger.error(...));
}).catch(err => logger.error(...));
```

❌ **BAD:**
```javascript
const result = await slowBackgroundTask(); // Blocks mobile user
ctx.reply(`Result: ${result}`);
```

### 2. **Timeout Protection**

All API calls must have timeouts to prevent hung handlers.

✅ **GOOD:**
```javascript
async function getProducts() {
  return Promise.race([
    fetch('https://api.example.com/products'),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), 8000)
    )
  ]);
}
```

❌ **BAD:**
```javascript
async function getProducts() {
  return fetch('https://api.example.com/products'); // Can hang forever
}
```

### 3. **Graceful Fallbacks**

Always provide fallback data for slow/offline scenarios.

✅ **GOOD:**
```javascript
async function getProducts() {
  try {
    return await backendService.getProducts(); // 8s timeout
  } catch (error) {
    logger.warn('api.products_failed', { message: error.message });
    return FALLBACK_PRODUCTS; // Return cached/bundled products
  }
}
```

### 4. **Quick Acknowledgments**

Respond to user immediately, process later.

✅ **GOOD:**
```javascript
bot.action('add_to_cart', async (ctx) => {
  // Instant reply
  await ctx.answerCallbackQuery('✅ Added to cart!', { show_alert: false });
  
  // Update UI immediately with optimistic state
  await editOrReply(ctx, 'Cart updated', getCartKeyboard());
  
  // Persist in background
  cartStore.save(ctx.from.id, cart).catch(err => logger.error(...));
});
```

### 5. **Mobile-Safe Keyboard Layouts**

Vertical buttons fit mobile screens better.

✅ **GOOD:**
```javascript
const keyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🛍️ Browse', 'action:browse')],
  [Markup.button.callback('🛒 Cart (2)', 'action:cart')],
  [Markup.button.callback('💳 Checkout', 'action:checkout')]
]);
```

❌ **BAD:**
```javascript
const keyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback('Browse', 'browse'),
    Markup.button.callback('Cart', 'cart'),
    Markup.button.callback('Checkout', 'checkout')
  ]
]);
```

### 6. **Error Handling with User Feedback**

Always tell users what happened.

✅ **GOOD:**
```javascript
try {
  await processPayment(order);
} catch (error) {
  logger.error('payment.failed', { message: error.message });
  await ctx.reply('❌ Payment failed. Please try again.', {
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('Retry', 'action:retry')]
    ]).reply_markup
  });
}
```

## 📱 Mobile Testing Checklist

Before releasing:

- [ ] **Test on slow network** (throttle to 3G in DevTools)
- [ ] **Test on small screen** (375px width iPhone 5/SE)
- [ ] **All buttons tappable** (44x44px minimum)
- [ ] **Instant feedback** (typing indicator shows within 100ms)
- [ ] **No hanging** (all handlers respond within 3 seconds)
- [ ] **Readable text** (12pt+ font, high contrast)
- [ ] **Emoji support** (displays correctly on all devices)
- [ ] **Touch-friendly** (no double-tap zoom needed)
- [ ] **Works offline** (graceful fallbacks for API failures)
- [ ] **Resume after disconnect** (reconnects without user action)

## 🔧 Recommended Handler Pattern

```javascript
bot.action('your_action', async (ctx) => {
  try {
    // 1. Immediate visual feedback
    await ctx.answerCallbackQuery('Processing...', { show_alert: false });
    
    // 2. Show loading state quickly
    const message = await ctx.reply('⏳ Loading...');
    
    // 3. Do work with timeout
    const result = await Promise.race([
      doSlowWork(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 5000)
      )
    ]);
    
    // 4. Update with result (edit instead of sending new message)
    await ctx.editMessageText(`✅ Done!`, {
      chat_id: message.chat.id,
      message_id: message.message_id
    });
    
    // 5. Persist in background (don't await)
    persistToRedis(result).catch(err => logger.warn(...));
  } catch (error) {
    logger.error('action.failed', { error: error.message });
    
    // Always show user something, even on error
    await ctx.answerCallbackQuery(
      '❌ Something went wrong. Please try again.',
      { show_alert: false }
    );
  }
});
```

## 📊 Performance Targets

| Metric | Target | Bad |
|--------|--------|-----|
| Initial response time | < 100ms | > 500ms |
| Full page load | < 3s | > 5s |
| Button feedback | < 50ms | > 200ms |
| Cart add-to-cart | < 1s | > 3s |
| Product image load | < 2s | > 4s |
| Search/filter | < 1s | > 3s |

## 🔐 Security on Mobile

1. **No sensitive data in URLs** - Cart IDs, user tokens should be in headers
2. **HTTPS everywhere** - Webhook HTTPS, API HTTPS
3. **Token rotation** - Short-lived session tokens (1 hour)
4. **Rate limiting** - Prevent spam/abuse (5 requests per second)
5. **Validation on server** - Never trust mobile input

## 📈 Monitoring Mobile Experience

Log these metrics:

```javascript
logger.info('mobile.interaction', {
  action: 'add_to_cart',
  responseTime: endTime - startTime, // milliseconds
  userAgent: ctx.from?.username || 'unknown',
  deviceType: detectMobileType(ctx),
  networkCondition: 'good|slow|offline'
});
```

Track with:
- Response times < 100ms = Good
- Response times 100-500ms = Acceptable  
- Response times > 500ms = Poor (investigate)
