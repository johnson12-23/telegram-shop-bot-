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
  if (config.botMode === 'webhook') {
    return 'webhook';
  }

  return 'polling';
}

async function startBot() {
  if (!config.botToken) {
    throw new Error('BOT_TOKEN is required');
  }

  setupHealthRoutes();
  await startHealthServer();

  const bot = new Telegraf(config.botToken);
  const deps = buildDependencies();

  registerCommands(bot, deps);
  registerActions(bot, deps);

  bot.catch((error) => {
    logger.error('bot.uncaught', { message: error.message });
  });

  const runtimeMode = resolveRuntimeMode();

  if (runtimeMode === 'webhook') {
    if (!config.webhookUrl) {
      throw new Error('WEBHOOK_URL is required when BOT_MODE=webhook');
    }

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

  const stop = (signal) => {
    logger.info('bot.stopping', { signal });
    bot.stop(signal);
  };

  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  return bot;
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
