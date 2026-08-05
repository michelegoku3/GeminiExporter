/**
 * Formattazione condivisa fra i renderer.
 *
 * Vive in `shared/` perché serve a più formati di esportazione: duplicarla in
 * ciascun renderer significherebbe correggere gli stessi difetti più volte.
 * @module shared/format
 */

/**
 * Formatta una data secondo il locale richiesto.
 *
 * @param {Date} date
 * @param {string} locale Tag BCP-47, es. `it-IT`.
 * @returns {string} Data e ora estese; ISO 8601 se il locale non è valido.
 */
export function formatTimestamp(date, locale) {
  try {
    return date.toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' });
  } catch {
    // Un locale non riconosciuto non deve impedire l'esportazione.
    return date.toISOString();
  }
}

/**
 * Estrae il codice di lingua da un tag di locale.
 *
 * @param {string} locale Es. `it-IT`.
 * @param {string} [fallback]
 * @returns {string} Es. `it`.
 */
export function languageOf(locale, fallback = 'it') {
  return String(locale ?? '').split('-')[0] || fallback;
}
