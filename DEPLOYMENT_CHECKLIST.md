# 🚀 DEPLOYMENT CHECKLIST - Telegram Shop Bot

## ✅ Production Readiness Verification

### Code Quality
- [x] Webhook mode implemented (`bot/webhook.js`)
- [x] Keep-alive mechanism added (`bot/keepalive.js`)
- [x] PM2 configuration created (`ecosystem.config.js`)
- [x] All handlers have try/catch protection
- [x] All API calls have timeout protection (8-15 seconds)
- [x] Graceful error responses for all failures
- [x] Environment variables documented (`.env.example`)
- [x] Mobile keyboard layouts optimized
- [x] Structured logging throughout

### Configuration
- [x] `render.yaml` updated for webhook mode
- [x] Worker service configured to use PM2
- [x] Redis connection configured
- [x] Environment variables properly scoped
- [x] API base URL routing correct
- [x] Port configuration verified (3000 for webhook, 4000 for API)

### Architecture
- [x] **Webhook** instead of polling (Telegram pushes → Express handler)
- [x] **Express server** listening on port 3000 for webhook
- [x] **Health checks** at `/health` and `/` endpoints
- [x] **Graceful shutdown** with webhook cleanup
- [x] **Keep-alive pings** every 10 minutes to prevent Render sleep
- [x] **Redis for state** with file fallback for development
- [x] **PM2 auto-restart** on crash with exponential backoff

### Reliability
- [x] Handles bot token validation failures gracefully
- [x] Timeout protection on all network calls
- [x] Unhandled promise rejection handler
- [x] Uncaught exception handler
- [x] Duplicate request detection
- [x] Cart and session state persistence
- [x] Offline product fallback data

---

## 📋 PRE-DEPLOYMENT CHECKLIST

### Before Deploying to Render:

- [ ] **Git Repository**
  - [ ] Code committed: `git add .`
  - [ ] Commit message: `git commit -m "Production: Webhook mode, PM2, keep-alive"`
  - [ ] Pushed to main: `git push origin main`

- [ ] **Local Testing**
  - [ ] Run: `npm install`
  - [ ] Copy: `cp .env.example .env`
  - [ ] Edit `.env`: Set your BOT_TOKEN, set `BOT_MODE=polling` for local test
  - [ ] Test: `npm run start:bot` or `pm2 start ecosystem.config.js`
  - [ ] Verify: Bot responds to `/start` command
  - [ ] Check logs: `pm2 logs` shows no errors
  - [ ] Stop: `pm2 delete all`

- [ ] **Telegram Bot Setup**
  - [ ] Have @BotFather token ready
  - [ ] Token format: `123456:ABC-DEF1234...` (numbers, colon, alphanumeric)
  - [ ] Bot is not already using other webhooks/polling

- [ ] **Render Account**
  - [ ] GitHub repository connected
  - [ ] Account has deployment quota
  - [ ] Free tier limits understood (auto-sleep, 100GB/month bandwidth)

---

## 🎯 DEPLOYMENT STEPS

### Step 1: Create Render Services

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Select your GitHub repository
4. Create from `render.yaml`:
   - **Redis service**: `telegram-shop-state` (free tier)
   - **Web service**: `telegram-shop-api` (Node.js)
   - **Worker service**: `telegram-shop-bot-worker` (Node.js)
   - **Static site**: `telegram-shop-cart` (Vite)

### Step 2: Get Your Webhook URL

After services deploy:
1. Open **Worker service** → **Settings** → **URL**
2. Copy the URL (format: `https://telegram-shop-bot-xyz123.onrender.com`)
3. Note: Render auto-provides HTTPS ✅

### Step 3: Set Environment Variables

In Render Dashboard → Worker Service → Environment:

```
BOT_TOKEN          = your_token_from_botfather
WEBHOOK_URL        = https://telegram-shop-bot-xyz123.onrender.com
WEBHOOK_SECRET     = your-random-secret-token
BOT_MODE           = webhook
ENABLE_KEEP_ALIVE  = true
NODE_ENV           = production
```

**Where to get these:**
- `BOT_TOKEN`: From @BotFather on Telegram
- `WEBHOOK_URL`: Auto-filled from Render worker URL above
- `WEBHOOK_SECRET`: Generate one: `openssl rand -hex 32` or use any random string

### Step 4: Register Webhook with Telegram

Once the worker is deployed and logs show no errors, register the webhook:

**Option A: cURL command**
```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://telegram-shop-bot-xyz123.onrender.com/webhook/<WEBHOOK_SECRET>" \
  -d "secret_token=<WEBHOOK_SECRET>" \
  -d "max_connections=40" \
  -d "allowed_updates=message,callback_query,my_chat_member"
```

Replace:
- `<BOT_TOKEN>` with your actual token from @BotFather
- `<WEBHOOK_SECRET>` with the secret you set in environment
- `telegram-shop-bot-xyz123.onrender.com` with your actual Render URL

**Option B: Direct URL** (simpler)
```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://telegram-shop-bot-xyz123.onrender.com/webhook/<WEBHOOK_SECRET>&secret_token=<WEBHOOK_SECRET>&max_connections=40
```

Open this URL in your browser to set the webhook.

### Step 5: Verify Webhook Setup

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

**✅ If successful:**
- `url` shows your Render webhook path ✓
- `has_custom_certificate` is `false` (Render HTTPS) ✓
- `pending_update_count` is 0 ✓

**❌ If failed:**
- `pending_update_count` > 0 → Telegram has queued messages; webhook failed
- `url` is empty → Webhook not registered; re-run setWebhook command
- Error about HTTPS → Make sure webhook URL starts with `https://`

---

## 🧪 TESTING

### Test 1: Bot Responds to Commands

1. **Find your bot** on Telegram: Search for `@your_bot_username`
2. **Send `/start`** - Should receive welcome message with menu
3. **Browse products** - Should load product list
4. **Add to cart** - Should show confirmation
5. **View cart** - Should show items with price
6. **Checkout** - Should show payment options

### Test 2: Webhook is Working

1. Open Render worker logs
2. Send bot a message
3. You should see in logs:
   ```
   "bot.update_handler_failed" OR your handler logs
   "bot.start_received"
   ```

### Test 3: Keep-Alive is Running

1. Open Render worker logs
2. Wait 10+ minutes
3. You should see:
   ```
   "bot.keep_alive_pong"
   ```

### Test 4: Mobile Experience

1. **iPhone/Android**: Open Telegram and search for your bot
2. **Slow network**: Throttle to 3G speed in DevTools
3. **Verify**:
   - All buttons tappable (44x44px minimum)
   - Text readable (not tiny)
   - Cart works smoothly
   - No timeout errors

### Test 5: Error Handling

1. **Disconnect internet** - Bot should respond with fallback data
2. **Send rapid messages** - Bot should not crash
3. **Long cart session** - State should persist
4. **Close app, reopen** - Session should resume

---

## 🔧 TROUBLESHOOTING

### Problem: Bot doesn't respond

**Check 1: Webhook registered?**
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```
If `url` is empty, run setWebhook command again.

**Check 2: Webhook URL correct?**
- Must start with `https://`
- Must match Render worker URL exactly
- Must include `/webhook/<SECRET>` path

**Check 3: Logs show errors?**
- Open Render worker → Logs
- Look for `bot.error`, `bot.uncaught`, `Error`
- Check BOT_TOKEN is valid (not truncated, not empty)

### Problem: Render worker keeps restarting

**Check 1: Is BOT_TOKEN set?**
```
BOT_TOKEN should not be empty
```

**Check 2: Check startup logs**
```
bot.bootstrap_start
bot.webhook_setup_failed (if error here)
```

**Check 3: PM2 errors?**
- `Max restarts reached` → Process crashing on startup
- Check env vars are correct
- Verify WEBHOOK_URL is accessible

### Problem: Keep-alive not pinging

**Check 1: Is it enabled?**
```
ENABLE_KEEP_ALIVE = true
BOT_MODE = webhook
```

**Check 2: Logs show pings?**
```
"bot.keep_alive_pong" in logs every 10 minutes
```

**Check 3: Service keeps sleeping?**
- Render free tier can still sleep if no traffic
- Consider upgrading to paid tier for critical services

---

## 📊 MONITORING

### Key Metrics to Watch

**Healthy System:**
- ✅ Logs show `bot.keep_alive_pong` every 10 minutes
- ✅ Bot responds to `/start` within 1 second
- ✅ No `bot.uncaught` errors in logs
- ✅ `pending_update_count` in webhook info is 0

**Unhealthy System:**
- ❌ No keep-alive pings in logs
- ❌ Messages show as "pending updates" on webhook info
- ❌ Worker keeps restarting (check logs for errors)
- ❌ Users report slow/no response

### Where to Check Logs

1. **Render Dashboard**: Worker service → Logs (real-time)
2. **Local PM2**: `pm2 logs telegram-shop-bot`
3. **PM2 Plus**: Monitor auto-restarts, memory usage, uptime

---

## 🎉 SUCCESS INDICATORS

Once deployed, you should see:

✅ **In Render logs:**
```
bot.bootstrap_start
bot.identity_verified
bot.webhook_set
bot.webhook_server_started
bot.keep_alive_started
```

✅ **On Telegram:**
- `/start` gets instant response
- Products load smoothly
- Cart works on mobile
- Checkout completes

✅ **In webhook info:**
```json
"url": "https://your-bot.onrender.com/webhook/...",
"pending_update_count": 0,
"max_connections": 40
```

---

## 🔄 ROLLBACK PLAN

If something goes wrong:

1. **Disable webhook** (fall back to polling locally):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
   ```

2. **Revert code** on GitHub:
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

3. **Restart Render** services from dashboard

4. **Re-register webhook** once stable:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=..."
   ```

---

## 📞 SUPPORT RESOURCES

- [Telegraf Docs](https://telegraf.js.org/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Render Docs](https://render.com/docs)
- [Express.js Guide](https://expressjs.com/)
- [Redis Docs](https://redis.io/docs/)

---

**Last Updated**: 2024
**Status**: Production Ready
**Mode**: Webhook + PM2 + Keep-Alive
