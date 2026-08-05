/**
 * Logger minimale con livelli e prefisso.
 * Motivazione: il codice deve poter segnalare il "drift" dei selettori di Gemini
 * senza inondare la console dell'utente in condizioni normali.
 * @module shared/logger
 */

import { APP } from './config.js';

/** @typedef {'silent'|'error'|'warn'|'info'|'debug'} LogLevel */

/**
 * Interfaccia del logger, usata come tipo dai moduli che lo ricevono
 * per injection.
 * @typedef {object} Logger
 * @property {(...args: unknown[]) => void} error
 * @property {(...args: unknown[]) => void} warn
 * @property {(...args: unknown[]) => void} info
 * @property {(...args: unknown[]) => void} debug
 * @property {(level: LogLevel) => void} setLevel
 * @property {() => LogLevel} getLevel
 * @property {(scope: string) => Logger} child
 */

/** Ordinamento dei livelli: un messaggio è emesso se il suo peso <= peso configurato. */
const WEIGHT = Object.freeze({ silent: 0, error: 1, warn: 2, info: 3, debug: 4 });

/**
 * Crea un logger. Il livello è mutabile perché le preferenze utente
 * vengono caricate in modo asincrono dopo la costruzione.
 * @param {object} [options]
 * @param {LogLevel} [options.level] Livello iniziale.
 * @param {string} [options.prefix] Prefisso dei messaggi.
 * @param {Console} [options.sink] Destinazione (iniettabile nei test).
 */
export function createLogger({ level = 'warn', prefix = APP.logPrefix, sink = console } = {}) {
  let currentLevel = level;

  /**
   * @param {LogLevel} messageLevel
   * @returns {boolean} true se il messaggio va emesso
   */
  const enabled = (messageLevel) => WEIGHT[messageLevel] <= WEIGHT[currentLevel];

  /**
   * @param {LogLevel} messageLevel
   * @param {'error'|'warn'|'info'|'debug'} method
   * @returns {(...args: unknown[]) => void}
   */
  const emit =
    (messageLevel, method) =>
    (...args) => {
      if (enabled(messageLevel)) sink[method](prefix, ...args);
    };

  return {
    error: emit('error', 'error'),
    warn: emit('warn', 'warn'),
    info: emit('info', 'info'),
    debug: emit('debug', 'debug'),

    /** @param {LogLevel} next */
    setLevel(next) {
      if (next in WEIGHT) currentLevel = next;
    },

    /** @returns {LogLevel} */
    getLevel() {
      return currentLevel;
    },

    /**
     * Logger figlio che aggiunge un contesto al prefisso.
     * @param {string} scope
     */
    child(scope) {
      return createLogger({ level: currentLevel, prefix: `${prefix}[${scope}]`, sink });
    },
  };
}

/** Logger di default condiviso dai moduli che non ricevono injection. */
export const logger = createLogger();
