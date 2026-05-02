const express = require('express');
const { Telegraf } = require('telegraf');
const { config } = require('./config');
const { logger } = require('./utils/logger');
const { registerCommands } = require('./commands/registerCommands');
const { registerActions } = require('./actions/registerActions');
const backendService = require('./services/backendService');
const { cartStore, sessionStore, initStores, closeStores } = require('./state/stores');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'telegram-shop-bot-secret';
const WEBHOOK_PATH = `/webhook/${WEBHOOK_SECRET}`;

let activeBot = null;
let isShuttingDown = false;
const BOT_STARTUP_TIMEOUT_MS = Number(process.env.BOT_STARTUP_TIMEOUT_MS || 15000);

function isPermanentStartupError(error) {
  const code = Number(error?.response?.error_code || 0);
  return code === 401 || code === 403;
}

function isLikelyValidBotToken(token) {
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(String(token || '').trim());
}

async function withTimeout(promise, timeoutMs, step) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Timeout in ${step} after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function buildDependencies() {
  return {
    config,
    backendService,
    cartStore,
    sessionStore
  };
}

function buildBot() {
  const bot = new Telegraf(config.botToken);
  const deps = buildDependencies();

  registerCommands(bot, deps);
  registerActions(bot, deps);

  bot.catch((error, ctx) => {
    try {
      logger.error('bot.uncaught', {
        message: error.message,
        updateType: ctx?.updateType || null,
        chatId: ctx?.chat?.id || null,
        userId: ctx?.from?.id || null,
        stack: error.stack
      });

      if (ctx && ctx.chat?.id) {
        ctx.reply('Something went wrong. Please try again.').catch((e) => {
          logger.error('bot.error_reply_failed', { message: e.message });
        });
      }
    } catch (e) {
      logger.error('bot.catch_handler_failed', { message: e.message });
    }
  });

  return bot;
}

async function setupWebhook() {
  if (!config.botToken) {
    throw new Error('BOT_TOKEN is required');
  }

  if (!isLikelyValidBotToken(config.botToken)) {
    throw new Error('BOT_TOKEN does not look valid');
  }

  if (!config.webhookUrl) {
    throw new Error('WEBHOOK_URL is required for webhook mode');
  }

  const bot = buildBot();

  logger.info('bot.webhook_setup_start', {
    webhookUrl: config.webhookUrl,
    webhookPath: WEBHOOK_PATH
  });

  try {
    await withTimeout(bot.telegram.getMe(), BOT_STARTUP_TIMEOUT_MS, 'getMe');
    logger.info('bot.identity_verified', {});

    await withTimeout(
      bot.telegram.deleteWebhook({ drop_pending_updates: false }),
      BOT_STARTUP_TIMEOUT_MS,
      'deleteWebhook'
    );
    logger.info('bot.webhook_deleted', {});

    const webhookUrl = `${config.webhookUrl}${WEBHOOK_PATH}`;
    await withTimeout(
      bot.telegram.setWebhook(webhookUrl, {
        secret_token: WEBHOOK_SECRET,
        max_connections: 40,
        allowed_updates: ['message', 'callback_query', 'my_chat_member']
      }),
      BOT_STARTUP_TIMEOUT_MS,
      'setWebhook'
    );

    const webhookInfo = await withTimeout(bot.telegram.getWebhookInfo(), BOT_STARTUP_TIMEOUT_MS, 'getWebhookInfo');
    logger.info('bot.webhook_set', {
      url: webhookInfo.url,
      pending_update_count: webhookInfo.pending_update_count,
      max_connections: webhookInfo.max_connections
    });

    const me = await withTimeout(bot.telegram.getMe(), BOT_STARTUP_TIMEOUT_MS, 'getMe');
    logger.info('bot.identity', {
      username: me.username,
      id: me.id,
      mode: 'webhook'
    });

    return bot;
  } catch (error) {
    logger.error('bot.webhook_setup_failed', {
      message: error.message,
      description: error?.response?.description || '',
      code: error?.response?.error_code || null
    });
    throw error;
  }
}

async function startWebhookServer(bot) {
  await initStores({
    redisUrl: config.redisUrl,
    stateStoreKey: config.stateStoreKey
  });

  const app = express();

  app.use(express.json());

  app.post(WEBHOOK_PATH, (req, res) => {
    if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
      logger.warn('bot.webhook_invalid_secret', {});
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      bot.handleUpdate(req.body).catch((error) => {
        logger.error('bot.update_handler_failed', {
          message: error.message,
          updateId: req.body?.update_id
        });
      });

      res.json({ ok: true });
    } catch (error) {
      logger.error('bot.webhook_endpoint_error', {
        message: error.message
      });
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'telegram-shop-bot-webhook', botReady: Boolean(bot) });
  });

  app.get('/', (req, res) => {
    res.json({ ok: true, service: 'telegram-shop-bot-webhook', botReady: Boolean(bot) });
  });

  const port = config.port;
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => {
      logger.info('bot.webhook_server_started', { port });
      resolve(server);
    });

    server.on('error', (error) => {
      logger.error('bot.webhook_server_failed', { message: error.message });
      reject(error);
    });
  });
}

async function startBot() {
  const maxRetries = 10;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const bot = await setupWebhook();
      const server = await startWebhookServer(bot);
      activeBot = bot;

      const stop = async (signal) => {
        if (isShuttingDown) {
          return;
        }

        isShuttingDown = true;
        logger.info('bot.stopping', { signal });

        if (bot) {
          try {
            await bot.telegram.deleteWebhook({ drop_pending_updates: false });
            logger.info('bot.webhook_deleted_on_shutdown', {});
          } catch (e) {
            logger.warn('bot.webhook_delete_on_shutdown_failed', { message: e.message });
          }
        }

        if (server) {
          await new Promise((resolve) => {
            server.close(() => {
              logger.info('bot.webhook_server_stopped', { signal });
              resolve();
            });
          });
        }

        await closeStores();
        process.exit(0);
      };

      process.once('SIGINT', () => void stop('SIGINT'));
      process.once('SIGTERM', () => void stop('SIGTERM'));

      return bot;
    } catch (error) {
      attempt += 1;
      const backoffMs = Math.min(2000 * attempt, 30000);

      logger.error('bot.startup_failed', {
        attempt,
        maxRetries,
        message: error.message,
        description: error?.response?.description || '',
        retryInMs: backoffMs
      });

      if (isPermanentStartupError(error)) {
        throw error;
      }

      if (attempt >= maxRetries) {
        throw new Error(`Failed to start bot after ${maxRetries} attempts`);
      }

      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

async function bootstrap() {
  try {
    logger.info('bot.webhook_bootstrap_start', {
      botTokenLoaded: Boolean(config.botToken),
      webhookUrl: config.webhookUrl,
      port: config.port
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('bot.unhandled_rejection', {
        message: reason instanceof Error ? reason.message : String(reason)
      });
      process.exit(1);
    });

    process.on('uncaughtException', (error) => {
      logger.error('bot.uncaught_exception', {
        message: error.message,
        stack: error.stack
      });
      process.exit(1);
    });

    await startBot();
  } catch (error) {
    logger.error('bot.bootstrap_failed', {
      message: error.message,
      description: error?.response?.description || '',
      code: error?.response?.error_code || null
    });
    process.exit(1);
  }
}

module.exports = { bootstrap, WEBHOOK_PATH, WEBHOOK_SECRET };
