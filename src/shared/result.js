/**
 * Tipo Result minimale.
 *
 * Motivazione: distinguere i fallimenti *attesi* (selettore mancante, risposta
 * vuota) dai bug. Gli attesi viaggiano come valore di ritorno, così il chiamante
 * è obbligato a gestirli; le eccezioni restano riservate agli imprevisti.
 * @module shared/result
 */

/**
 * @template T, E
 * @typedef {{ ok: true, value: T } | { ok: false, error: E }} Result
 */

/**
 * @template T
 * @param {T} value
 * @returns {{ ok: true, value: T }}
 */
export const ok = (value) => ({ ok: true, value });

/**
 * @template E
 * @param {E} error
 * @returns {{ ok: false, error: E }}
 */
export const err = (error) => ({ ok: false, error });

/**
 * @template T, E
 * @param {Result<T, E>} result
 * @returns {result is { ok: true, value: T }}
 */
export const isOk = (result) => result.ok === true;

/**
 * Estrae il valore o lancia l'errore. Da usare solo ai confini del sistema.
 * @template T, E
 * @param {Result<T, E>} result
 * @returns {T}
 */
export function unwrap(result) {
  if (result.ok === true) return result.value;
  throw /** @type {{ ok: false, error: E }} */ (result).error;
}
