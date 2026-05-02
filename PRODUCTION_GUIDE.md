# Telegram Bot - Production Setup Guide

## 🚀 Quick Start

### Local Development (Polling Mode)

```bash
# 1. Clone and install
git clone <repo>
cd telegram-shop-bot
npm install

# 2. Create .env file
cat > .env << EOF
BOT_TOKEN=your_bot_token_here
API_BASE_URL=http://localhost:4000
BOT_MODE=polling
PORT=3000
NODE_ENV=development
ENABLE_KEEP_ALIVE=false
EOF

# 3. Start with PM2
npm install -g pm2
pm2 start ecosystem.config.js

# 4. Monitor logs
pm2 logs
```

### Production Deployment (Webhook Mode on Render)

#### Step 1: Set Up Render

1. Go to [render.com](https://render.com)
2. Connect your GitHub repository
3. Create three services from `render.yaml`:
   - **Redis** (for state)
   - **Web Service** (API)
   - **Worker** (Bot with webhook)
   - **Static Site** (Cart UI)

#### Step 2: Get Your Webhook URL

Once the worker is deployed, Render will provide a URL like:
```
https://telegram-shop-bot-xyz123.onrender.com
```

#### Step 3: Configure Environment Variables

In Render dashboard, set these for the **worker**:

```env
BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
WEBHOOK_URL=https://telegram-shop-bot-xyz123.onrender.com
WEBHOOK_SECRET=your-secret-token-here
BOT_MODE=webhook
ENABLE_KEEP_ALIVE=true
NODE_ENV=production
```

#### Step 4: Set the Telegram Webhook

Run this command **once** after deployment:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://telegram-shop-bot-xyz123.onrender.com/webhook/<WEBHOOK_SECRET>" \
  -d "secret_token=<WEBHOOK_SECRET>" \
  -d "max_connections=40" \
  -d "allowed_updates=message,callback_query,my_chat_member"
```

Or use this simpler format:

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://telegram-shop-bot-xyz123.onrender.com/webhook/<WEBHOOK_SECRET>&secret_token=<WEBHOOK_SECRET>&max_connections=40
```

#### Step 5: Verify Webhook

Check webhook status:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

Expected response:
```json
{
  "ok": true,
  "result": {
    "url": "https://telegram-shop-bot-xyz123.onrender.com/webhook/your-secret",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "max_connections": 40,
    "allowed_updates": ["message", "callback_query", "my_chat_member"]
  }
}
```

## 📋 Environment Variables Reference

### Core Bot Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BOT_TOKEN` | ✅ | - | Telegram bot token from @BotFather |
| `BOT_MODE` | ❌ | `webhook` | `webhook` (production) or `polling` (dev) |
| `WEBHOOK_URL` | ✅ (webhook) | - | Public HTTPS URL: `https://your-domain.com` |
| `WEBHOOK_SECRET` | ❌ | `telegram-shop-bot-secret` | Secret token for webhook verification |
| `PORT` | ❌ | `3000` | Port for webhook server |

### API Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_BASE_URL` | ❌ | `http://localhost:4000` | Backend API URL |
| `API_PORT` | ❌ | `4000` | API server port |
| `PAYMENT_PROVIDER` | ❌ | `paystack` | Payment processor: `paystack` or `flutterwave` |

### Persistence & State

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | ❌ | - | Redis connection URL for cart state |
| `STATE_STORE_KEY` | ❌ | `telegram-shop-bot:state:v1` | Redis key prefix |

### Operational

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | ❌ | `production` | `production` or `development` |
| `ENABLE_KEEP_ALIVE` | ❌ | `true` | Keep Render from sleeping (ping every 10 min) |
| `BOT_STARTUP_TIMEOUT_MS` | ❌ | `15000` | Startup timeout in milliseconds |

## 🔧 How It Works

### Webhook Mode (Production)

1. **Bot receives updates via HTTPS POST** instead of polling
2. **Telegram pushes updates to your webhook URL**
3. **Keep-alive pings every 10 minutes** prevent Render free tier sleep
4. **PM2 auto-restarts** if the process crashes
5. **Redis stores state** so cart/session survives restarts

### Key Files

- `bot/webhook.js` - Webhook server and bot setup
- `bot/keepalive.js` - Keep-alive mechanism for Render
- `index.js` - Main entry point
- `ecosystem.config.js` - PM2 configuration
- `render.yaml` - Render deployment blueprint

## 📱 Testing from Mobile

1. **Search for your bot** on Telegram by username
2. **Tap `/start`** - Bot should respond instantly
3. **Browse products** - Should work smoothly on slow networks
4. **Add to cart** - First add opens cart, others show toast
5. **Checkout** - Complete the flow

## 🐛 Troubleshooting

### Bot doesn't respond

**Check webhook status:**
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

**Common issues:**
- ❌ `"has_custom_certificate": false` - HTTPS required, but HTTP was set
- ❌ `"pending_update_count": > 0` - Telegram has queued updates; webhook endpoint failing
- ❌ `"url": ""` - Webhook not set; re-run setWebhook command

### Render service keeps crashing

**Check logs:**
```bash
# In Render dashboard, click "Logs" on the worker service
# Look for error messages in the output
```

**Common fixes:**
- ✅ Make sure `BOT_TOKEN` is set (not empty)
- ✅ Make sure `WEBHOOK_URL` is set for webhook mode
- ✅ Check Redis connection if using cart state
- ✅ Restart service from Render dashboard

### Keep-alive not working

- Check if `ENABLE_KEEP_ALIVE=true` in Render environment
- Render will show in logs: `"bot.keep_alive_started"` and periodic `"bot.keep_alive_pong"`

## 📊 Monitoring

### View Logs

**Render Dashboard:**
- Open worker service → Logs → tail output

**Local with PM2:**
```bash
pm2 logs telegram-shop-bot
pm2 logs telegram-shop-api
```

### Key Log Events

- `bot.bootstrap_start` - Bot is starting
- `bot.identity_verified` - Telegram connection works
- `bot.webhook_set` - Webhook successfully registered
- `bot.webhook_server_started` - Server listening for updates
- `bot.keep_alive_ping` - Keep-alive is running
- `bot.start_received` - User sent /start command
- `bot.uncaught` - Unhandled error in handler

## 🔐 Security

### Webhook Secret Token

The `WEBHOOK_SECRET` ensures only Telegram can send updates:
- Telegram includes header: `x-telegram-bot-api-secret-token`
- Server verifies it matches `WEBHOOK_SECRET`
- Requests without valid secret return 401 Unauthorized

### Best Practices

✅ **DO:**
- Use strong random `WEBHOOK_SECRET` (UUID recommended)
- Keep `BOT_TOKEN` secret in environment (Render secret variables)
- Use HTTPS only (Render provides free HTTPS)
- Enable Redis for production state management
- Monitor error logs regularly

❌ **DON'T:**
- Hardcode tokens in source code
- Use HTTP for webhook (only HTTPS works)
- Expose logs publicly
- Use weak secrets

## 🚀 Scaling

For higher traffic:

1. **Horizontal Scaling** - Render can add more instances
2. **Redis Cluster** - Move to Redis Enterprise if needed
3. **Load Balancing** - Render handles automatically
4. **Database** - Currently in-memory; consider PostgreSQL for orders

## 📞 Support

For issues:

1. Check Render logs
2. Verify webhook setup with `getWebhookInfo`
3. Check environment variables are set
4. Restart worker service
5. Check GitHub Actions for deployment errors
