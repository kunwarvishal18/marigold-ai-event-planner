/**
 * @file A localStorage wrapper that never throws. Storage can be full, blocked or unavailable
 * (private windows, sandboxed frames), so every call reports failure instead of throwing.
 */

/** Storage keys used by Marigold. */
export const STORAGE_KEYS = {
  plans: "mg2.plans",
  lastPlanId: "mg2.last",
  tab: "mg2.tab",
  legacyPlans: "mg.plans",
  migrated: "mg2.migrated",
};

export const localStore = {
  /**
   * Reads and parses a JSON value.
   * @param {string} key
   * @param {*} fallback returned when the key is missing, unreadable or storage is blocked
   */
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },

  /**
   * Stores a value as JSON.
   * @returns {boolean} false if it couldn't be saved
   */
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  /** Raw text access, used to back up unreadable data instead of overwriting it. */
  raw(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  /** @returns {boolean} false if it couldn't be saved */
  setRaw(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
};
