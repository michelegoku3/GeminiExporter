/**
 * Astrazione sulle API dell'estensione.
 *
 * Chrome espone `chrome.*`, Firefox espone `browser.*` (con Promise native) e
 * anche `chrome.*` per compatibilità. Isolare l'accesso qui rende il resto del
 * codice testabile (basta iniettare un finto oggetto) e portabile.
 * @module extension/platform/browser
 */

/** @returns {typeof chrome | undefined} */
function runtimeApi() {
  if (typeof globalThis.browser !== 'undefined' && globalThis.browser?.runtime) {
    return globalThis.browser;
  }
  if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome?.runtime) {
    return globalThis.chrome;
  }
  return undefined;
}

/**
 * Risolve il percorso di un asset impacchettato in un URL assoluto.
 * @param {string} path Percorso relativo alla root dell'estensione.
 * @returns {string}
 */
export function getAssetUrl(path) {
  return runtimeApi()?.runtime.getURL(path) ?? path;
}

/** @returns {boolean} true se siamo dentro un contesto estensione. */
export function isExtensionContext() {
  return runtimeApi() !== undefined;
}

/**
 * Lettura dallo storage locale dell'estensione.
 * @param {string} key
 * @returns {Promise<unknown>}
 */
export async function storageGet(key) {
  const api = runtimeApi();
  if (!api?.storage?.local) return undefined;

  // Chrome MV3 supporta le Promise; manteniamo il ramo callback per sicurezza.
  const result = await new Promise((resolve) => {
    try {
      const maybePromise = /** @type {any} */ (api.storage.local.get(key, resolve));
      if (maybePromise?.then) maybePromise.then(resolve);
    } catch {
      resolve({});
    }
  });
  return result?.[key];
}

/**
 * Scrittura nello storage locale dell'estensione.
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
export async function storageSet(key, value) {
  const api = runtimeApi();
  if (!api?.storage?.local) return;

  await new Promise((resolve) => {
    try {
      const maybePromise = /** @type {any} */ (
        api.storage.local.set({ [key]: value }, /** @type {any} */ (resolve))
      );
      if (maybePromise?.then) maybePromise.then(resolve);
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Invia un messaggio al service worker.
 * @param {object} message
 * @returns {Promise<unknown>}
 */
export async function sendMessage(message) {
  const api = runtimeApi();
  if (!api?.runtime?.sendMessage) return undefined;

  return new Promise((resolve) => {
    try {
      const maybePromise = /** @type {any} */ (api.runtime.sendMessage(message, resolve));
      if (maybePromise?.then) maybePromise.then(resolve).catch(() => resolve(undefined));
    } catch {
      resolve(undefined);
    }
  });
}
