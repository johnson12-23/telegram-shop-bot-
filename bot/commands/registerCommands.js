const { withHandler, getUserId } = require('../utils/helpers');
const { mainMenuKeyboard } = require('../ui/keyboards');
const { buildTrackingMessage } = require('../ui/messages');
const { logger } = require('../utils/logger');

function registerCommands(bot, deps) {
  const { backendService, sessionStore } = deps;

  const handleStart = withHandler('command.start', async (ctx) => {
    const startText = String(ctx.message?.text || '');
    const userId = getUserId(ctx);

    logger.info('bot.start_received', { userId, text: startText });

    sessionStore.clearTrackInput(getUserId(ctx));
    sessionStore.clearWaitingDelivery(getUserId(ctx));

    await ctx.reply(
      [
        'Welcome to Telegram Shop.',
        'Flow: Browse → Cart → Checkout → Payment → Tracking',
        'Use the inline buttons below.'
      ].join('\n'),
      mainMenuKeyboard()
    );
  });

  bot.use(async (ctx, next) => {
    const startText = String(ctx.message?.text || '');
    if (/^\/start(?:@\w+)?(?:\s+.*)?$/i.test(startText)) {
      await handleStart(ctx, next);
      return;
    }

    await next();
  });

  bot.command('track', withHandler('command.track', async (ctx) => {
    const chunks = String(ctx.message?.text || '').trim().split(/\s+/);
    if (chunks.length >= 2) {
      const orderId = chunks[1].trim();
      const order = await backendService.getOrderById(orderId);
      await ctx.reply(buildTrackingMessage(order), mainMenuKeyboard());
      return;
    }

    sessionStore.enableTrackInput(getUserId(ctx));
    await ctx.reply('Send your order ID to track. Example: /track ORD-XXXX', mainMenuKeyboard());
  }));

  bot.command('status', withHandler('command.status', async (ctx) => {
    await ctx.reply('Bot is online and ready.', mainMenuKeyboard());
  }));
}

module.exports = { registerCommands };
