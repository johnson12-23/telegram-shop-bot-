const fs = require('fs');
const path = require('path');
const { createClient } = require('redis');
const { logger } = require('../utils/logger');

const STATE_FILE_PATH = path.join(__dirname, 'store-data.json');
const SAVE_DEBOUNCE_MS = 300;
const WAITING_DELIVERY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let saveTimer = null;
let redisClient = null;
let redisConnected = false;
let persistenceKey = 'telegram-shop-bot:state:v1';
let storesInitialized = false;

function readPersistedFileState() {
  try {
    if (!fs.existsSync(STATE_FILE_PATH)) {
      return { carts: {}, waitingDelivery: {}, waitingTrack: [] };
    }

    const raw = fs.readFileSync(STATE_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      carts: parsed?.carts && typeof parsed.carts === 'object' ? parsed.carts : {},
      waitingDelivery:
        parsed?.waitingDelivery && typeof parsed.waitingDelivery === 'object'
          ? parsed.waitingDelivery
          : {},
      waitingTrack: Array.isArray(parsed?.waitingTrack) ? parsed.waitingTrack : []
    };
  } catch (error) {
    logger.warn('state.load_file_failed', { message: error.message });
    return { carts: {}, waitingDelivery: {}, waitingTrack: [] };
  }
}

function writePersistedFileState(payload) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE_PATH), { recursive: true });
    const tempPath = `${STATE_FILE_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload), 'utf8');
    fs.renameSync(tempPath, STATE_FILE_PATH);
  } catch (error) {
    logger.error('state.save_file_failed', { message: error.message });
  }
}

async function readPersistedRedisState() {
  if (!redisConnected || !redisClient) {
    return null;
  }

  try {
    const raw = await redisClient.get(persistenceKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return {
      carts: parsed?.carts && typeof parsed.carts === 'object' ? parsed.carts : {},
      waitingDelivery:
        parsed?.waitingDelivery && typeof parsed.waitingDelivery === 'object'
          ? parsed.waitingDelivery
          : {},
      waitingTrack: Array.isArray(parsed?.waitingTrack) ? parsed.waitingTrack : []
    };
  } catch (error) {
    logger.warn('state.load_redis_failed', { message: error.message });
    return null;
  }
}

async function writePersistedRedisState(payload) {
  if (!redisConnected || !redisClient) {
    return;
  }

  try {
    await redisClient.set(persistenceKey, JSON.stringify(payload));
  } catch (error) {
    logger.warn('state.save_redis_failed', { message: error.message });
  }
}

class CartStore {
  constructor(onChange) {
    this.onChange = onChange;
    this.userCarts = new Map();
  }

  hydrate(initialCarts = {}) {
    this.userCarts = new Map();
    for (const [userId, items] of Object.entries(initialCarts || {})) {
      const map = new Map();
      if (items && typeof items === 'object') {
        for (const [productId, item] of Object.entries(items)) {
          const safeProductId = Number(productId);
          const safeQuantity = Number(item?.quantity ?? item);
          if (!Number.isInteger(safeProductId) || !Number.isInteger(safeQuantity) || safeQuantity <= 0) {
            continue;
          }

          map.set(safeProductId, { productId: safeProductId, quantity: safeQuantity });
        }
      }

      if (map.size > 0) {
        this.userCarts.set(String(userId), map);
      }
    }
  }

  getItems(userId) {
    if (!this.userCarts.has(userId)) {
      this.userCarts.set(userId, new Map());
    }

    const itemMap = this.userCarts.get(userId);
    return [...itemMap.values()];
  }

  setItem(userId, item) {
    if (!this.userCarts.has(userId)) {
      this.userCarts.set(userId, new Map());
    }

    const itemMap = this.userCarts.get(userId);
    itemMap.set(Number(item.productId), {
      productId: Number(item.productId),
      quantity: Number(item.quantity)
    });

    this.onChange();
  }

  removeItem(userId, productId) {
    if (!this.userCarts.has(userId)) {
      return;
    }

    const itemMap = this.userCarts.get(userId);
    itemMap.delete(Number(productId));
    if (itemMap.size === 0) {
      this.userCarts.delete(userId);
    }

    this.onChange();
  }

  clear(userId) {
    this.userCarts.delete(userId);
    this.onChange();
  }

  hasItems(userId) {
    return this.getItems(userId).length > 0;
  }

  toJSON() {
    const payload = {};
    for (const [userId, itemMap] of this.userCarts.entries()) {
      payload[userId] = {};
      for (const [productId, item] of itemMap.entries()) {
        payload[userId][productId] = {
          productId: Number(item.productId),
          quantity: Number(item.quantity)
        };
      }
    }

    return payload;
  }
}

class SessionStore {
  constructor(onChange) {
    this.onChange = onChange;
    this.waitingDelivery = new Map();
    this.waitingTrack = new Set();
    this.tapLock = new Map();
    this.promptLock = new Map();
    this.suppressionCounts = new Map();
  }

  hydrate(initialState = {}) {
    this.waitingDelivery = new Map(Object.entries(initialState.waitingDelivery || {}));
    this.waitingTrack = new Set((initialState.waitingTrack || []).map((value) => String(value)));
  }

  setWaitingDelivery(userId, payload) {
    this.waitingDelivery.set(userId, {
      ...payload,
      createdAt: Number(payload?.createdAt || Date.now())
    });
    this.onChange();
  }

  getWaitingDelivery(userId) {
    const pending = this.waitingDelivery.get(userId) || null;
    if (!pending) {
      return null;
    }

    const age = Date.now() - Number(pending.createdAt || 0);
    if (age > WAITING_DELIVERY_MAX_AGE_MS) {
      this.waitingDelivery.delete(userId);
      this.onChange();
      return null;
    }

    return pending;
  }

  clearWaitingDelivery(userId) {
    this.waitingDelivery.delete(userId);
    this.onChange();
  }

  enableTrackInput(userId) {
    this.waitingTrack.add(userId);
    this.onChange();
  }

  isTrackInputPending(userId) {
    return this.waitingTrack.has(userId);
  }

  clearTrackInput(userId) {
    this.waitingTrack.delete(userId);
    this.onChange();
  }

  isDuplicateTap(userId, messageId, data, cooldownMs = 1200) {
    const key = `${userId}:${messageId || 'no_message'}:${data || 'no_data'}`;
    const now = Date.now();
    const last = this.tapLock.get(key) || 0;

    if (now - last < cooldownMs) {
      return true;
    }

    this.tapLock.set(key, now);

    if (this.tapLock.size > 2500) {
      const cutoff = now - 60000;
      for (const [entryKey, timestamp] of this.tapLock.entries()) {
        if (timestamp < cutoff) {
          this.tapLock.delete(entryKey);
        }
      }
    }

    return false;
  }

  isDuplicatePrompt(userId, promptSignature, cooldownMs = 1500) {
    const key = `${userId}:${promptSignature || 'prompt'}`;
    const now = Date.now();
    const last = this.promptLock.get(key) || 0;

    if (now - last < cooldownMs) {
      return true;
    }

    this.promptLock.set(key, now);

    if (this.promptLock.size > 3000) {
      const cutoff = now - 90000;
      for (const [entryKey, timestamp] of this.promptLock.entries()) {
        if (timestamp < cutoff) {
          this.promptLock.delete(entryKey);
        }
      }
    }

    return false;
  }

  markSuppressed(userId, type) {
    const key = `${userId}:${type}`;
    const next = (this.suppressionCounts.get(key) || 0) + 1;
    this.suppressionCounts.set(key, next);
    return next;
  }

  toJSON() {
    const waitingDelivery = {};
    for (const [userId, payload] of this.waitingDelivery.entries()) {
      waitingDelivery[userId] = payload;
    }

    return {
      waitingDelivery,
      waitingTrack: [...this.waitingTrack]
    };
  }
}

const cartStore = new CartStore(schedulePersist);
const sessionStore = new SessionStore(schedulePersist);

function getSnapshot() {
  return {
    carts: cartStore.toJSON(),
    ...sessionStore.toJSON()
  };
}

function hydrateStores(snapshot) {
  cartStore.hydrate(snapshot?.carts || {});
  sessionStore.hydrate({
    waitingDelivery: snapshot?.waitingDelivery || {},
    waitingTrack: snapshot?.waitingTrack || []
  });
}

async function persistNow() {
  const snapshot = getSnapshot();
  writePersistedFileState(snapshot);
  await writePersistedRedisState(snapshot);
}

function schedulePersist() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow().catch((error) => {
      logger.warn('state.persist_failed', { message: error.message });
    });
  }, SAVE_DEBOUNCE_MS);
}

async function initStores(options = {}) {
  if (storesInitialized) {
    return;
  }

  persistenceKey = String(options.stateStoreKey || process.env.STATE_STORE_KEY || persistenceKey);
  const redisUrl = String(options.redisUrl || process.env.REDIS_URL || '').trim();

  const fileState = readPersistedFileState();
  hydrateStores(fileState);

  if (!redisUrl) {
    logger.warn('state.redis_not_configured', { fallback: 'file' });
    storesInitialized = true;
    return;
  }

  redisClient = createClient({ url: redisUrl });
  redisClient.on('error', (error) => {
    logger.warn('state.redis_client_error', { message: error.message });
  });

  try {
    await redisClient.connect();
    redisConnected = true;

    const redisState = await readPersistedRedisState();
    if (redisState) {
      hydrateStores(redisState);
      writePersistedFileState(redisState);
      logger.info('state.hydrated', { source: 'redis', key: persistenceKey });
    } else {
      await writePersistedRedisState(fileState);
      logger.info('state.hydrated', { source: 'file', key: persistenceKey });
    }
  } catch (error) {
    logger.warn('state.redis_unavailable', { message: error.message, fallback: 'file' });
    redisConnected = false;
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch (quitError) {
        logger.warn('state.redis_quit_failed', { message: quitError.message });
      }
    }
    redisClient = null;
  }

  storesInitialized = true;
}

async function closeStores() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  try {
    await persistNow();
  } catch (error) {
    logger.warn('state.persist_on_close_failed', { message: error.message });
  }

  if (!redisClient) {
    return;
  }

  try {
    await redisClient.quit();
  } catch (error) {
    logger.warn('state.redis_close_failed', { message: error.message });
  }

  redisClient = null;
  redisConnected = false;
}

module.exports = {
  cartStore,
  sessionStore,
  initStores,
  closeStores
};
