/**
 * Ambiti di esportazione: cosa viene incluso nel documento.
 *
 * Come per i formati, l'elenco è dichiarativo e la UI si costruisce da qui.
 * @module shared/export-scopes
 */

/**
 * @typedef {object} ExportScope
 * @property {string} id Identificatore stabile.
 * @property {string} label Nome mostrato all'utente.
 * @property {string} description Spiegazione breve.
 * @property {boolean} available Se false, la voce è visibile ma disabilitata.
 * @property {boolean} [deferred] Se true, la conferma non esporta ma avvia una
 *   fase intermedia sulla pagina.
 */

/** @type {Record<string, ExportScope>} */
export const EXPORT_SCOPES = Object.freeze({
  turn: {
    id: 'turn',
    label: 'Solo questa risposta',
    description: 'Esporta la domanda e la risposta di questo turno',
    available: true,
  },
  selection: {
    id: 'selection',
    label: 'Scegli i turni',
    description: 'Seleziona sulla pagina i messaggi da esportare',
    available: true,
    // La scelta non produce subito un documento: apre una modalità in cui
    // l'utente indica i turni cliccandoli. Il dialogo lo segnala cambiando
    // l'etichetta del pulsante di conferma.
    deferred: true,
  },
  conversation: {
    id: 'conversation',
    label: 'Tutta la conversazione',
    description: 'Esporta ogni turno completato della chat',
    available: true,
  },
});

/** @returns {ExportScope[]} Ambiti in ordine di presentazione. */
export function listScopes() {
  return Object.values(EXPORT_SCOPES);
}

/** Ambito preselezionato all'apertura del dialogo. */
export const DEFAULT_SCOPE_ID = 'turn';

/**
 * @param {string} id
 * @returns {boolean} true se l'ambito richiede un passaggio sulla pagina prima
 *   di poter esportare.
 */
export function isDeferredScope(id) {
  return EXPORT_SCOPES[id]?.deferred === true;
}
