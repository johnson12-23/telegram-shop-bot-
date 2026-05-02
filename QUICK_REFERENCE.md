# 🎯 QUICK REFERENCE - Telegram Bot Deployment

## 📋 Environment Variables

```env
# REQUIRED for Production
BOT_TOKEN=your_token_from_botfather
WEBHOOK_URL=https://your-bot.onrender.com
WEBHOOK_SECRET=random-secret-token

# OPTIONAL (defaults provided)
BOT_MODE=webhook                           # webhook or polling
ENABLE_KEEP_ALIVE=true                     # Keep Render awake
API_BASE_URL=https://telegram-shop-api.onrender.com
PAYMENT_PROVIDER=paystack                  # paystack or flutterwave
STATE_STORE_KEY=telegram-shop-bot:state:v1
NODE_ENV=production
PORT=3000
```

---

## 🚀 One-Command Deployment

```bash
# 1. Push to GitHub
git add . && git commit -m "Deploy: Webhook mode" && git push origin main

# 2. Go to Render → New Web Service → Select repo → Build from render.yaml

# 3. After worker deploys, set webhook (replace values):
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<RENDER_URL>/webhook/<SECRET>" \
  -d "secret_token=<SECRET>"

# 4. Verify webhook:
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

---

## 🔑 Key Concepts

| Concept | What It Is | Why It Matters |
|---------|-----------|----------------|
| **Webhook** | HTTP endpoint that Telegram calls | Works 24/7, doesn't need polling |
| **Keep-Alive** | Pings every 10 min | Prevents Render free tier sleep |
| **PM2** | Process manager | Auto-restarts if bot crashes |
| **Secret Token** | Verification token | Ensures only Telegram can call webhook |

---

## 🛠️ Commands Cheat Sheet

### Get Bot Info
```bash
# From @BotFather on Telegram
/mybots → Select bot → See token
```

### Set Webhook (One-time)
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://your-url.onrender.com/webhook/<SECRET>" \
  -d "secret_token=<SECRET>"
```

### Check Webhook Status
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"

# Should show:
# "url": "https://your-url.onrender.com/webhook/...",
# "pending_update_count": 0
```

### Delete Webhook (Emergency Only)
```bash
curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
```

### Local Testing with PM2
```bash
# Install PM2
npm install -g pm2

# Start
pm2 start ecosystem.config.js

# View logs
pm2 logs

# Stop
pm2 delete all
```

---

## ✅ Pre-Deployment Checklist

- [ ] Code pushed to GitHub
- [ ] BOT_TOKEN obtained from @BotFather
- [ ] WEBHOOK_SECRET generated (random string)
- [ ] Render services created from render.yaml
- [ ] Environment variables set in Render
- [ ] Worker service deployed successfully
- [ ] Webhook URL is HTTPS (Render provides)
- [ ] setWebhook command executed
- [ ] getWebhookInfo shows correct URL
- [ ] Bot responds to /start on Telegram

---

## 🐛 Common Issues & Fixes

### "Bot doesn't respond"
```bash
# Step 1: Check webhook
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
# Should show: "pending_update_count": 0

# Step 2: Check logs
# Render → Worker → Logs (look for errors)

# Step 3: Re-register webhook
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://your-url.onrender.com/webhook/<SECRET>" \
  -d "secret_token=<SECRET>"
```

### "Render service keeps restarting"
```bash
# Check logs for errors
# Common causes:
# - BOT_TOKEN not set or invalid
# - WEBHOOK_URL pointing to old service
# - Redis connection failed

# Fix: Set correct environment variables and restart
```

### "Keep-alive not working"
```bash
# Check logs for: "bot.keep_alive_pong"
# Should appear every 10 minutes

# If missing:
# - Check ENABLE_KEEP_ALIVE=true
# - Restart worker service
# - Check logs for "keep_alive_ping_failed"
```

### "Webhook says pending updates"
```bash
# This means Telegram tried to deliver but failed
# Cause: Handler crashed or webhook URL wrong

# Fix:
# 1. Check handler errors in logs
# 2. Fix the error
# 3. Restart service
# Telegram will auto-retry pending messages
```

---

## 📊 Monitoring

### What to Watch

✅ **Healthy**
- Logs show `bot.keep_alive_pong` every 10 min
- Bot responds to messages instantly
- `pending_update_count` = 0 in webhook info

❌ **Unhealthy**
- No keep-alive pongs in logs
- Messages show as pending in webhook info
- Worker service restarting frequently
- Error messages in logs

### Where to Check

| Where | How | What to Look For |
|-------|-----|------------------|
| Render Logs | Dashboard → Worker → Logs | Errors, keep-alive pongs |
| Webhook Info | `curl getWebhookInfo` | pending_update_count, url |
| Bot Response | Send message on Telegram | Should reply in < 1 sec |

---

## 🔐 Security Checklist

- [ ] BOT_TOKEN stored in Render secrets (not code)
- [ ] WEBHOOK_SECRET is random/strong
- [ ] HTTPS enforced (Render auto-provides)
- [ ] Secret token validated on each request
- [ ] All API calls have timeouts
- [ ] Error messages don't leak sensitive info

---

## 📈 Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| Startup time | < 5s | ✅ |
| /start response | < 1s | ✅ |
| Cart operations | < 3s | ✅ |
| Webhook latency | < 100ms | ✅ |
| Keep-alive ping | < 8s | ✅ |
| Memory usage | < 512MB | ✅ |

---

## 🎯 File Quick Reference

| File | Purpose | Key Change |
|------|---------|------------|
| `bot/webhook.js` | NEW: Webhook server | Replaces polling |
| `bot/keepalive.js` | NEW: Keep-alive | Prevents Render sleep |
| `ecosystem.config.js` | NEW: PM2 config | Auto-restart on crash |
| `index.js` | UPDATED: Entry point | Loads webhook mode |
| `bot/config.js` | UPDATED: Config | Webhook variables |
| `render.yaml` | UPDATED: Deployment | Webhook + PM2 setup |
| `.env.example` | UPDATED: Template | New variables |

---

## 🚀 Deployment Flow

```
1. Push code to GitHub
        ↓
2. Render auto-deploys from render.yaml
   └─ Creates 4 services (Redis, API, Bot, Cart)
        ↓
3. Get Render worker URL
   └─ Format: https://telegram-shop-bot-xyz.onrender.com
        ↓
4. Set environment variables in Render
   └─ BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET, etc.
        ↓
5. Register webhook with Telegram
   └─ Telegram will push updates to your URL
        ↓
6. Verify webhook
   └─ Check getWebhookInfo shows correct URL
        ↓
7. Test on Telegram
   └─ Send /start, add to cart, checkout
        ↓
8. Monitor logs
   └─ Watch for keep-alive pongs, errors
        ↓
✅ 24/7 Bot Running!
```

---

## 💬 Quick Telegram Commands

Send these to your bot after deployment:

```
/start        - See welcome menu
/track        - Track orders
/status       - Bot status
```

Test buttons:
- 🛍️ Browse - View products
- 🛒 Cart - See cart items
- 💳 Checkout - Start payment
- ↩️ Back - Return to menu

---

## 📞 Quick Help

**Bot not responding?**
→ Check webhook info with `getWebhookInfo`
→ Look for errors in Render logs

**Render service keeps crashing?**
→ Check env variables are set correctly
→ Check logs for startup errors

**Keep-alive not working?**
→ Verify `ENABLE_KEEP_ALIVE=true`
→ Look for `keep_alive_pong` in logs

**Mobile issues?**
→ Test on actual phone/slow network
→ Check button sizes (44x44px minimum)
→ Verify all timeouts working

---

## 🎉 Success Indicators

After deployment, you should see:

✅ Bot responds instantly on Telegram  
✅ Render logs show `bot.keep_alive_pong` every 10 min  
✅ webhook info shows `pending_update_count: 0`  
✅ Cart works smoothly on mobile  
✅ No errors in logs  
✅ Bot is live 24/7 (even with local machine OFF)  

---

**Print this page for quick reference during deployment!**
