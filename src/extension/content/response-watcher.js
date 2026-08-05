/**
 * Rilevamento delle risposte completate.
 *
 * Miglioramenti rispetto alla versione precedente (problemi P2-1 e P2-2):
 *  - le mutazioni sono raggruppate con un debounce: durante lo streaming Gemini
 *    ne emette migliaia al secondo, prima ognuna avviava una scansione completa;
 *  - la scansione avviene in idle time, per non competere con il rendering;
 *  - i turni già elaborati sono tracciati in un WeakSet invece che con un
 *    attributo scritto nel DOM di Google (che Angular può rigenerare);
 *  - il `setInterval` permanente ogni 3 secondi è stato rimosso: l'observer,
 *    riagganciato ai cambi di rotta della SPA, è sufficiente.
 * @module extension/content/response-watcher
 */

import { TIMING } from '../../shared/config.js';
import { queryAll } from '../../gemini/dom-query.js';
import { isTurnComplete } from '../../gemini/gemini-source.js';

/**
 * @param {object} deps
 * @param {(turnElement: Element) => void} deps.onTurnReady Invocato una volta per turno completato.
 * @param {Document} [deps.document]
 * @param {import('../../shared/logger.js').Logger} deps.logger
 */
export function createResponseWatcher({
  onTurnReady,
  document: doc = globalThis.document,
  logger,
}) {
  /** Turni già elaborati: WeakSet non impedisce la garbage collection. */
  const processedTurns = new WeakSet();

  /** @type {MutationObserver|null} */
  let observer = null;
  /** @type {number|undefined} */
  let debounceTimer;
  /** @type {number|undefined} */
  let idleHandle;

  function scan() {
    const turns = queryAll(doc, 'conversationTurn', { logger });

    for (const turnElement of turns) {
      if (processedTurns.has(turnElement)) continue;
      if (!isTurnComplete(turnElement, { logger })) continue;

      processedTurns.add(turnElement);
      try {
        onTurnReady(turnElement);
      } catch (error) {
        // Un turno problematico non deve fermare l'elaborazione degli altri.
        logger.error('Elaborazione del turno fallita:', error);
      }
    }
  }

  /** Raggruppa le mutazioni e scansiona quando il browser è libero. */
  function scheduleScan() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      cancelIdle(idleHandle);
      idleHandle = requestIdle(scan, TIMING.idleTimeoutMs);
    }, TIMING.observerDebounceMs);
  }

  return {
    start() {
      this.stop();
      scan();

      observer = new MutationObserver(scheduleScan);
      observer.observe(doc.body, { childList: true, subtree: true });
      logger.debug('Watcher avviato.');
    },

    stop() {
      observer?.disconnect();
      observer = null;
      clearTimeout(debounceTimer);
      cancelIdle(idleHandle);
    },

    /** Forza una scansione immediata (es. dopo un cambio di rotta). */
    refresh: scan,
  };
}

/**
 * `requestIdleCallback` non è disponibile su tutti i browser (Safari, alcune
 * versioni di Firefox): il fallback su setTimeout mantiene il comportamento.
 * @param {() => void} callback
 * @param {number} timeout
 * @returns {number}
 */
function requestIdle(callback, timeout) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    return globalThis.requestIdleCallback(callback, { timeout });
  }
  return setTimeout(callback, 0);
}

/** @param {number|undefined} handle */
function cancelIdle(handle) {
  if (handle === undefined) return;
  if (typeof globalThis.cancelIdleCallback === 'function') {
    globalThis.cancelIdleCallback(handle);
  } else {
    clearTimeout(handle);
  }
}
