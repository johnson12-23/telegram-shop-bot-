const { bootstrap } = require('./bot/webhook');
const { KeepAlive } = require('./bot/keepalive');
const { config } = require('./bot/config');
const { logger } = require('./bot/utils/logger');

let keepAlive = null;

async function main() {
  try {
    logger.info('bot.mode_check', {
      botMode: config.botMode,
      nodeEnv: config.nodeEnv
    });

    await bootstrap();

    if (config.enableKeepAlive && config.botMode === 'webhook') {
      keepAlive = new KeepAlive(config);
      keepAlive.start();
    }
  } catch (error) {
    logger.error('bot.main_error', {
      message: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

process.on('exit', () => {
  if (keepAlive) {
    keepAlive.stop();
  }
});

main();
