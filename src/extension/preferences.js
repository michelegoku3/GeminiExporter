/**
 * Preferenze utente persistite.
 *
 * Sono lette una sola volta e mantenute in memoria; la scrittura dal popup
 * aggiorna la cache tramite l'evento di storage.
 * @module extension/preferences
 */

import { DEFAULT_PREFERENCES, STORAGE_KEY } from '../shared/config.js';
import { storageGet, storageSet } from './platform/browser.js';

/**
 * @typedef {typeof DEFAULT_PREFERENCES} Preferences
 */

/**
 * @param {object} [deps]
 * @param {(key: string) => Promise<unknown>} [deps.get]
 * @param {(key: string, value: unknown) => Promise<void>} [deps.set]
 */
export function createPreferencesStore({ get = storageGet, set = storageSet } = {}) {
  /** @type {Preferences|null} */
  let cache = null;

  return {
    /** @returns {Promise<Preferences>} */
    async load() {
      if (cache) return cache;

      const stored = await get(STORAGE_KEY);
      // I default coprono le chiavi aggiunte in versioni successive:
      // nessuna migrazione necessaria quando si introduce una preferenza nuova.
      cache = { ...DEFAULT_PREFERENCES, ...(isRecord(stored) ? stored : {}) };
      return cache;
    },

    /**
     * @param {Partial<Preferences>} changes
     * @returns {Promise<Preferences>}
     */
    async save(changes) {
      const current = await this.load();
      cache = { ...current, ...changes };
      await set(STORAGE_KEY, cache);
      return cache;
    },

    /** Invalida la cache: la prossima load rilegge dallo storage. */
    invalidate() {
      cache = null;
    },
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null;
}
