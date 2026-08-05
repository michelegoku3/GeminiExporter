/**
 * Loader del content script.
 *
 * Perché esiste: i content script dichiarati nel manifest vengono eseguiti come
 * script classici, senza supporto per `import`. L'`import()` dinamico invece è
 * consentito, e mantiene il codice nel "isolated world" (quindi con accesso alle
 * API dell'estensione e senza interferire con l'applicazione web).
 *
 * È l'unico file non modulare del progetto e deve restare minimale.
 */

(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const moduleUrl = api.runtime.getURL('src/extension/content/main.js');

  import(moduleUrl).catch((error) => {
    console.error('[Gemini Chat Exporter] Avvio fallito:', error);
  });
})();
