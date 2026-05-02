const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadEnvironmentFiles() {
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '..', '..', '.env')
  ];

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const result = dotenv.config({ path: envPath, override: false });
    if (!result.error) {
      break;
    }
  }
}

loadEnvironmentFiles();

const config = {
  botToken: (process.env.BOT_TOKEN || '').trim(),
  apiBaseUrl: (process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/+$/, ''),
  botMode: (process.env.BOT_MODE || 'webhook').trim().toLowerCase(),
  webhookUrl: (process.env.WEBHOOK_URL || '').trim(),
  webhookSecret: (process.env.WEBHOOK_SECRET || 'telegram-shop-bot-secret').trim(),
  port: Number(process.env.PORT || 3000),
  provider: (process.env.PAYMENT_PROVIDER || 'paystack').trim().toLowerCase(),
  redisUrl: (process.env.REDIS_URL || '').trim(),
  stateStoreKey: (process.env.STATE_STORE_KEY || 'telegram-shop-bot:state:v1').trim(),
  nodeEnv: (process.env.NODE_ENV || 'development').trim().toLowerCase(),
  enableKeepAlive: process.env.ENABLE_KEEP_ALIVE !== 'false'
};

module.exports = { config };
