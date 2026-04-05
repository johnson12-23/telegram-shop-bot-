const { logger } = require('./logger');

function getUserId(ctx) {
  return String(ctx.from?.id ?? ctx.chat?.id ?? 'anonymous');
}

function getDisplayName(ctx) {
  return (
    ctx.from?.username ||
    [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') ||
    'Telegram Customer'
  );
}

function truncate(text, maxLen = 20) {
  const value = String(text || '');
  if (value.length <= maxLen) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxLen - 1))}…`;
}

function createIdempotencyKey(userId) {
  return `${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
}

async function safeAnswerCbQuery(ctx, text) {
  if (!ctx.callbackQuery) {
    return;
  }

  try {
    await ctx.answerCbQuery(text);
  } catch (error) {
    const description = error?.response?.description || '';
    if (!description.includes('query is too old') && !description.includes('query ID is invalid')) {
      logger.warn('bot.answer_cb_failed', { message: error.message });
    }
  }
}

function withHandler(name, handler) {
  return async (ctx, next) => {
    try {
      await handler(ctx, next);
    } catch (error) {
      logger.error('bot.handler_failed', {
        handler: name,
        message: error.message,
        userId: getUserId(ctx)
      });

      try {
        await ctx.reply('Something went wrong. Please try again.');
      } catch (replyError) {
        logger.error('bot.handler_reply_failed', { handler: name, message: replyError.message });
      }
    }
  };
}

module.exports = {
  getUserId,
  getDisplayName,
  truncate,
  createIdempotencyKey,
  safeAnswerCbQuery,
  withHandler
};
