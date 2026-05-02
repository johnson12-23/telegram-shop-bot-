const http = require('http');
const https = require('https');
const { logger } = require('./utils/logger');

class KeepAlive {
  constructor(config) {
    this.config = config;
    this.interval = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      return;
    }

    if (!this.config.enableKeepAlive || !this.config.webhookUrl) {
      logger.info('bot.keep_alive_disabled', {});
      return;
    }

    this.isRunning = true;
    const intervalMs = 10 * 60 * 1000;

    logger.info('bot.keep_alive_started', { intervalMs, url: this.config.webhookUrl });

    this.interval = setInterval(() => {
      this.ping();
    }, intervalMs);

    this.interval.unref();
  }

  async ping() {
    try {
      const protocol = this.config.webhookUrl.startsWith('https') ? https : http;
      const url = new URL(this.config.webhookUrl);

      return await new Promise((resolve, reject) => {
        const req = protocol.request(
          {
            method: 'GET',
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            timeout: 8000
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              logger.info('bot.keep_alive_pong', { statusCode: res.statusCode });
              resolve();
            });
          }
        );

        req.on('timeout', () => {
          req.abort();
          reject(new Error('Keep-alive ping timeout'));
        });

        req.on('error', (error) => {
          reject(error);
        });

        req.end();
      });
    } catch (error) {
      logger.warn('bot.keep_alive_ping_failed', { message: error.message });
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    logger.info('bot.keep_alive_stopped', {});
  }
}

module.exports = { KeepAlive };
