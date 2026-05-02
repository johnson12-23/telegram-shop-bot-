#!/bin/bash

# Telegram Bot - Pre-Deployment Verification Checklist
# Run this before deploying to production

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🤖 Telegram Bot - Pre-Deployment Checklist${NC}\n"

# 1. Check Node.js version
echo -e "${YELLOW}1️⃣  Checking Node.js version...${NC}"
NODE_VERSION=$(node -v)
echo "   Node.js version: $NODE_VERSION"
if [[ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 14 ]]; then
  echo -e "   ${RED}✗ Node.js 14+ required${NC}"
  exit 1
fi
echo -e "   ${GREEN}✓ Node.js version OK${NC}\n"

# 2. Check npm packages
echo -e "${YELLOW}2️⃣  Checking npm packages...${NC}"
if npm list telegraf express redis dotenv > /dev/null 2>&1; then
  echo -e "   ${GREEN}✓ All dependencies installed${NC}\n"
else
  echo -e "   ${RED}✗ Missing dependencies${NC}"
  echo "   Run: npm install"
  exit 1
fi

# 3. Check critical files exist
echo -e "${YELLOW}3️⃣  Checking critical files...${NC}"
FILES_REQUIRED=(
  "bot/webhook.js"
  "bot/config.js"
  "bot/keepalive.js"
  "bot/app.js"
  "bot/commands/registerCommands.js"
  "bot/actions/registerActions.js"
  "bot/services/backendService.js"
  "bot/state/stores.js"
  "bot/utils/helpers.js"
  "bot/utils/logger.js"
  "index.js"
  "server.js"
  "package.json"
  "render.yaml"
  "ecosystem.config.js"
)

MISSING_FILES=0
for file in "${FILES_REQUIRED[@]}"; do
  if [ -f "$file" ]; then
    echo "   ✓ $file"
  else
    echo -e "   ${RED}✗ Missing: $file${NC}"
    MISSING_FILES=$((MISSING_FILES + 1))
  fi
done

if [ $MISSING_FILES -eq 0 ]; then
  echo -e "   ${GREEN}✓ All critical files present${NC}\n"
else
  echo -e "   ${RED}✗ $MISSING_FILES files missing${NC}\n"
  exit 1
fi

# 4. Check environment variables locally
echo -e "${YELLOW}4️⃣  Checking environment variables...${NC}"
if [ -f ".env" ]; then
  echo -e "   ${GREEN}✓ .env file found${NC}"
  if grep -q "BOT_TOKEN" .env; then
    echo -e "   ${GREEN}✓ BOT_TOKEN is set${NC}"
  else
    echo -e "   ${RED}✗ BOT_TOKEN is missing from .env${NC}"
    exit 1
  fi
else
  echo -e "   ${YELLOW}⚠ .env file not found (OK for production, set in Render)${NC}"
fi
echo ""

# 5. Check bot syntax
echo -e "${YELLOW}5️⃣  Checking JavaScript syntax...${NC}"
node --check bot/webhook.js && echo -e "   ${GREEN}✓ bot/webhook.js${NC}" || {
  echo -e "   ${RED}✗ Syntax error in bot/webhook.js${NC}"
  exit 1
}
node --check bot/config.js && echo -e "   ${GREEN}✓ bot/config.js${NC}" || {
  echo -e "   ${RED}✗ Syntax error in bot/config.js${NC}"
  exit 1
}
node --check bot/keepalive.js && echo -e "   ${GREEN}✓ bot/keepalive.js${NC}" || {
  echo -e "   ${RED}✗ Syntax error in bot/keepalive.js${NC}"
  exit 1
}
node --check index.js && echo -e "   ${GREEN}✓ index.js${NC}" || {
  echo -e "   ${RED}✗ Syntax error in index.js${NC}"
  exit 1
}
echo -e "   ${GREEN}✓ All syntax checks passed${NC}\n"

# 6. Check Render configuration
echo -e "${YELLOW}6️⃣  Checking Render configuration...${NC}"
if grep -q "telegram-shop-bot-worker" render.yaml; then
  echo -e "   ${GREEN}✓ Worker service configured${NC}"
else
  echo -e "   ${RED}✗ Worker service not found in render.yaml${NC}"
  exit 1
fi

if grep -q "pm2-runtime" render.yaml; then
  echo -e "   ${GREEN}✓ PM2 start command configured${NC}"
else
  echo -e "   ${RED}✗ PM2 command not in render.yaml${NC}"
  exit 1
fi
echo ""

# 7. Check package.json scripts
echo -e "${YELLOW}7️⃣  Checking package.json...${NC}"
if grep -q "telegraf" package.json; then
  echo -e "   ${GREEN}✓ Telegraf dependency found${NC}"
else
  echo -e "   ${RED}✗ Telegraf not in package.json${NC}"
  exit 1
fi
echo -e "   ${GREEN}✓ package.json OK${NC}\n"

# 8. Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ All checks passed!${NC}\n"

echo -e "${YELLOW}📋 Next steps for production:${NC}"
echo "   1. Push code to GitHub"
echo "   2. On Render dashboard, create 4 services from render.yaml:"
echo "      - Redis (free tier)"
echo "      - Web (API server)"
echo "      - Worker (bot with webhook)"
echo "      - Static Site (cart UI)"
echo ""
echo "   3. Set environment variables in Render:"
echo "      - BOT_TOKEN (from @BotFather)"
echo "      - WEBHOOK_URL (auto-filled: your Render worker URL)"
echo "      - WEBHOOK_SECRET (random token)"
echo ""
echo "   4. Once worker deploys, set the webhook:"
echo "      curl -X POST \"https://api.telegram.org/bot<TOKEN>/setWebhook\" \\"
echo "        -d \"url=https://your-worker-url.onrender.com/webhook/<SECRET>\" \\"
echo "        -d \"secret_token=<SECRET>\""
echo ""
echo "   5. Verify webhook:"
echo "      curl \"https://api.telegram.org/bot<TOKEN>/getWebhookInfo\""
echo ""
echo "   6. Test from mobile:"
echo "      - Search for your bot on Telegram"
echo "      - Send /start"
echo "      - Browse products"
echo "      - Test add to cart"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
