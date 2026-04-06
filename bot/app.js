const express = require('express');
const { Telegraf } = require('telegraf');
const { config } = require('./config');
const { logger } = require('./utils/logger');
const { withHandler } = require('./utils/helpers');
const { registerCommands } = require('./commands/registerCommands');
const { registerActions } = require('./actions/registerActions');
const backendService = require('./services/backendService');
const { cartStore, sessionStore } = require('./state/stores');

const healthApp = express();
let healthServer;
let activeBot = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDependencies() {
  return {
    config,
    backendService,
    cartStore,
    sessionStore
  };
}

async function startHealthServer() {
  if (healthServer) {
    return;
  }

  await new Promise((resolve) => {
    healthServer = healthApp.listen(config.port, '0.0.0.0', () => {
      logger.info('bot.health_started', { port: config.port });
      resolve();
    });
  });
}

function setupHealthRoutes() {
  healthApp.get('/', (req, res) => {
    res.json({ ok: true, service: 'telegram-shop-bot-worker' });
  });

  healthApp.get('/health', (req, res) => {
    res.json({ ok: true, service: 'telegram-shop-bot-worker' });
  });
}

function resolveRuntimeMode() {
  // Render worker should run polling mode so users can access the bot independently of local machines.
  if (process.env.RENDER) {
    return 'polling';
  }

  if (config.botMode === 'webhook') {
    return 'webhook';
  }

  return 'polling';
}

function buildBot() {
  const bot = new Telegraf(config.botToken);
  const deps = buildDependencies();

  registerCommands(bot, deps);
  registerActions(bot, deps);

  bot.catch((error) => {
    logger.error('bot.uncaught', { message: error.message });
  });

  return bot;
}

async function launchBot(runtimeMode) {
  const bot = buildBot();

  if (runtimeMode === 'webhook') {
    healthApp.use(config.webhookPath, bot.webhookCallback(config.webhookPath));
    await bot.launch({
      webhook: {
        domain: config.webhookUrl,
        hookPath: config.webhookPath,
        port: config.port,
        host: '0.0.0.0',
        cb: healthApp,
        secretToken: config.webhookSecretToken
      }
    });

    logger.info('bot.started', { mode: 'webhook', webhookPath: config.webhookPath });
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    await bot.launch({ dropPendingUpdates: false });
    logger.info('bot.started', { mode: 'polling' });
  }

  const me = await bot.telegram.getMe();
  logger.info('bot.identity', { username: me.username, id: me.id, mode: runtimeMode });
  return bot;
}

async function startBot() {
  if (!config.botToken) {
    throw new Error('BOT_TOKEN is required');
  }

  setupHealthRoutes();
  await startHealthServer();

  const runtimeMode = resolveRuntimeMode();
  if (runtimeMode === 'webhook' && !config.webhookUrl) {
    throw new Error('WEBHOOK_URL is required when BOT_MODE=webhook');
  }

  const maxBackoffMs = 30000;
  let attempt = 0;

  while (true) {
    try {
      activeBot = await launchBot(runtimeMode);
      break;
    } catch (error) {
      attempt += 1;
      const backoffMs = Math.min(2000 * attempt, maxBackoffMs);
      const isConflict = error?.response?.error_code === 409;

      logger.error('bot.launch_failed', {
        attempt,
        mode: runtimeMode,
        conflict409: Boolean(isConflict),
        message: error.message,
        retryInMs: backoffMs
      });

      await sleep(backoffMs);
    }
  }

  const stop = (signal) => {
    logger.info('bot.stopping', { signal });
    if (activeBot) {
      activeBot.stop(signal);
    }
  };

  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  return activeBot;
}

async function bootstrap() {
  try {
    await startBot();
  } catch (error) {
    logger.error('bot.bootstrap_failed', { message: error.message });
    process.exitCode = 1;
  }
}

module.exports = {
  bootstrap,
  startBot
};
