const express = require('express');
const { Telegraf } = require('telegraf');
const { config } = require('./config');
const { logger } = require('./utils/logger');
const { registerCommands } = require('./commands/registerCommands');
const { registerActions } = require('./actions/registerActions');
const backendService = require('./services/backendService');
const { cartStore, sessionStore, initStores, closeStores } = require('./state/stores');

const healthApp = express();
let healthServer;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function startHealthServer() {
  if (healthServer) {
    return;
  }

  await new Promise((resolve, reject) => {
    healthServer = healthApp.listen(config.port, '0.0.0.0', () => {
      logger.info('bot.health_started', { port: config.port });
      resolve();
    });

    healthServer.on('error', (error) => {
      logger.error('bot.health_failed', { message: error.message, port: config.port });
      reject(error);
    });
  });
}

function setupHealthRoutes() {
  healthApp.get('/', (req, res) => {
    res.json({ ok: true, service: 'telegram-shop-bot-worker', botReady: Boolean(activeBot) });
  });

  healthApp.get('/health', (req, res) => {
    res.json({ ok: true, service: 'telegram-shop-bot-worker', botReady: Boolean(activeBot) });
  });
}

function resolveRuntimeMode() {
  // Polling is the only supported mode for this project.
  if (config.botMode && config.botMode !== 'polling') {
    logger.warn('bot.mode_overridden', {
      requestedMode: config.botMode,
      enforcedMode: 'polling'
    });
  }

  return 'polling';
}

function buildBot() {
  const bot = new Telegraf(config.botToken);
  const deps = buildDependencies();

  registerCommands(bot, deps);
  registerActions(bot, deps);

  bot.catch((error, ctx) => {
    logger.error('bot.uncaught', {
      message: error.message,
      updateType: ctx?.updateType || null,
      chatId: ctx?.chat?.id || null,
      userId: ctx?.from?.id || null
    });
  });

  return bot;
}

async function launchBot(runtimeMode) {
  const bot = buildBot();

  logger.info('bot.launching', { mode: runtimeMode });
  await withTimeout(bot.telegram.getMe(), BOT_STARTUP_TIMEOUT_MS, 'getMe');
  logger.info('bot.identity_verified', { mode: runtimeMode });
  await withTimeout(
    bot.telegram.deleteWebhook({ drop_pending_updates: false }),
    BOT_STARTUP_TIMEOUT_MS,
    'deleteWebhook'
  );
  await withTimeout(
    bot.launch({ dropPendingUpdates: false }),
    BOT_STARTUP_TIMEOUT_MS,
    'launch'
  );
  logger.info('bot.started', { mode: 'polling' });

  const me = await withTimeout(bot.telegram.getMe(), BOT_STARTUP_TIMEOUT_MS, 'getMe');
  logger.info('bot.identity', { username: me.username, id: me.id, mode: runtimeMode });
  return bot;
}

async function startBot() {
  if (!config.botToken) {
    throw new Error('BOT_TOKEN is required');
  }

  if (!isLikelyValidBotToken(config.botToken)) {
    throw new Error('BOT_TOKEN does not look valid');
  }

  await initStores({
    redisUrl: config.redisUrl,
    stateStoreKey: config.stateStoreKey
  });

  setupHealthRoutes();
  await startHealthServer();

  const runtimeMode = resolveRuntimeMode();

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
        description: error?.response?.description || '',
        message: error.message,
        retryInMs: backoffMs
      });

      if (isPermanentStartupError(error)) {
        throw error;
      }

      await sleep(backoffMs);
    }
  }

  const stop = async (signal) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logger.info('bot.stopping', { signal });
    if (activeBot) {
      activeBot.stop(signal);
      activeBot = null;
    }

    if (healthServer) {
      await new Promise((resolve) => {
        healthServer.close(() => {
          logger.info('bot.health_stopped', { signal });
          resolve();
        });
      });
      healthServer = null;
    }

    await closeStores();
  };

  process.once('SIGINT', () => {
    void stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    void stop('SIGTERM');
  });

  return activeBot;
}

async function bootstrap() {
  try {
    logger.info('bot.bootstrap_start', {
      botTokenLoaded: Boolean(config.botToken),
      botMode: config.botMode,
      apiBaseUrl: config.apiBaseUrl,
      port: config.port
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('bot.unhandled_rejection', {
        message: reason instanceof Error ? reason.message : String(reason)
      });
    });

    process.on('uncaughtException', (error) => {
      logger.error('bot.uncaught_exception', { message: error.message });
      process.exit(1);
    });

    await startBot();
  } catch (error) {
    logger.error('bot.bootstrap_failed', {
      message: error.message,
      description: error?.response?.description || '',
      code: error?.response?.error_code || null
    });
    process.exitCode = 1;
  }
}

module.exports = {
  bootstrap,
  startBot
};
