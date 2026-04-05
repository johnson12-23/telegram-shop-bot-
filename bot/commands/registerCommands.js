const { withHandler, getUserId } = require('../utils/helpers');
const { mainMenuKeyboard } = require('../ui/keyboards');
const { buildTrackingMessage } = require('../ui/messages');

function registerCommands(bot, deps) {
  const { backendService, sessionStore } = deps;

  bot.start(withHandler('command.start', async (ctx) => {
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
  }));

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
