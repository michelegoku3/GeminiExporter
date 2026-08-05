/**
 * SafeHtml: contenitore per HTML *già sanificato*.
 *
 * Motivazione (fix del problema P0-1 dell'analisi): nella versione precedente il
 * renderer interpolava `element.innerHTML` grezzo proveniente dal modello. Qui
 * il renderer accetta soltanto istanze di SafeHtml, e SafeHtml può essere creato
 * unicamente dal sanitizer che possiede il token privato. È una barriera
 * strutturale: dimenticare di sanificare diventa un errore a runtime immediato,
 * non una vulnerabilità silenziosa.
 * @module core/model/safe-html
 */

/** Token non esportabile: garantisce che solo questo modulo autorizzi la creazione. */
const CREATION_TOKEN = Symbol('SafeHtml.create');

export class SafeHtml {
  /**
   * Non chiamare direttamente: usa `createSafeHtml` dal sanitizer.
   * @param {symbol} token
   * @param {string} html
   */
  constructor(token, html) {
    if (token !== CREATION_TOKEN) {
      throw new TypeError(
        'SafeHtml non può essere istanziato direttamente: usa il sanitizer (createSafeHtml).'
      );
    }
    /** @type {string} */
    this.value = html;
    Object.freeze(this);
  }

  /** @returns {boolean} true se non contiene contenuto significativo. */
  isEmpty() {
    return this.value.trim().length === 0;
  }

  /** @returns {string} */
  toString() {
    return this.value;
  }
}

/**
 * Unica fabbrica autorizzata. Deve essere invocata solo dal modulo di
 * sanitizzazione, dopo aver applicato l'allowlist.
 * @param {string} sanitizedHtml HTML già passato attraverso il sanitizer.
 * @returns {SafeHtml}
 */
export function createSafeHtml(sanitizedHtml) {
  return new SafeHtml(CREATION_TOKEN, sanitizedHtml);
}

/**
 * @param {unknown} candidate
 * @returns {candidate is SafeHtml}
 */
export function isSafeHtml(candidate) {
  return candidate instanceof SafeHtml;
}
