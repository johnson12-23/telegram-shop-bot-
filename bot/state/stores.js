class CartStore {
  constructor() {
    this.userCarts = new Map();
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
  }

  removeItem(userId, productId) {
    if (!this.userCarts.has(userId)) {
      return;
    }

    this.userCarts.get(userId).delete(Number(productId));
  }

  clear(userId) {
    this.userCarts.set(userId, new Map());
  }

  hasItems(userId) {
    return this.getItems(userId).length > 0;
  }
}

class SessionStore {
  constructor() {
    this.waitingDelivery = new Map();
    this.waitingTrack = new Set();
    this.tapLock = new Map();
    this.promptLock = new Map();
    this.suppressionCounts = new Map();
  }

  setWaitingDelivery(userId, payload) {
    this.waitingDelivery.set(userId, payload);
  }

  getWaitingDelivery(userId) {
    return this.waitingDelivery.get(userId) || null;
  }

  clearWaitingDelivery(userId) {
    this.waitingDelivery.delete(userId);
  }

  enableTrackInput(userId) {
    this.waitingTrack.add(userId);
  }

  isTrackInputPending(userId) {
    return this.waitingTrack.has(userId);
  }

  clearTrackInput(userId) {
    this.waitingTrack.delete(userId);
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
}

const cartStore = new CartStore();
const sessionStore = new SessionStore();

module.exports = {
  cartStore,
  sessionStore
};
