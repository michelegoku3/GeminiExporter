/**
 * Formati di esportazione disponibili.
 *
 * Registry dichiarativo: aggiungere un formato significa aggiungere una voce
 * qui e collegare il renderer corrispondente nella composition root. La UI si
 * costruisce da questo elenco, quindi non va toccata.
 *
 * I formati con `available: false` comparirebbero nel dialogo disattivati, per
 * comunicare la direzione del prodotto senza promettere una funzione assente.
 * Nessuno è al momento in questo stato.
 * @module shared/export-formats
 */

/**
 * @typedef {object} ExportFormat
 * @property {string} id Identificatore stabile, usato nelle preferenze.
 * @property {string} label Nome mostrato all'utente.
 * @property {string} description Spiegazione breve.
 * @property {boolean} available Se false, la voce è visibile ma disabilitata.
 */

/** @type {Record<string, ExportFormat>} */
export const EXPORT_FORMATS = Object.freeze({
  pdf: {
    id: 'pdf',
    label: 'PDF',
    description: 'Documento stampabile, con formule e codice formattati',
    available: true,
  },
  word: {
    id: 'word',
    label: 'Word',
    description: 'Documento .docx modificabile, con stili, liste e tabelle',
    available: true,
  },
});

/** @returns {ExportFormat[]} Formati in ordine di presentazione. */
export function listFormats() {
  return Object.values(EXPORT_FORMATS);
}

/** Formato usato quando la preferenza salvata non è più valida. */
export const DEFAULT_FORMAT_ID = 'pdf';

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isFormatAvailable(id) {
  return EXPORT_FORMATS[id]?.available === true;
}
