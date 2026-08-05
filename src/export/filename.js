/**
 * Generazione dei nomi file.
 *
 * Unifica le due funzioni quasi identiche della versione precedente
 * (`suggestFilename` e `_sanitizeFilename`), che applicavano regex diverse
 * allo stesso scopo.
 * @module export/filename
 */

import { FILENAME } from '../shared/config.js';

/** Caratteri non ammessi nei nomi file su Windows, macOS e Linux. */
const ILLEGAL_CHARACTERS = /[<>:"/\\|?*\u0000-\u001F]/g;

/**
 * Costruisce un nome file leggibile a partire dal testo dell'utente.
 * @param {string} sourceText Testo da cui derivare il nome.
 * @param {object} [options]
 * @param {boolean} [options.withExtension] Aggiunge l'estensione .html.
 * @returns {string}
 */
export function buildFilename(sourceText, { withExtension = false } = {}) {
  const base = sanitize(sourceText) || FILENAME.fallback;
  return withExtension ? `${base}${FILENAME.extension}` : base;
}

/**
 * @param {string} text
 * @returns {string}
 */
function sanitize(text) {
  return (
    String(text ?? '')
      .replace(ILLEGAL_CHARACTERS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, FILENAME.maxLength)
      .trim()
      // Windows non accetta nomi che terminano con un punto.
      .replace(/\.+$/, '')
  );
}
