require('dotenv').config();

const config = {
  botToken: (process.env.BOT_TOKEN || '').trim(),
  apiBaseUrl: (process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/+$/, ''),
  botMode: (process.env.BOT_MODE || 'polling').trim().toLowerCase(),
  port: Number(process.env.PORT || 3000),
  provider: (process.env.PAYMENT_PROVIDER || 'paystack').trim().toLowerCase()
};

module.exports = { config };
