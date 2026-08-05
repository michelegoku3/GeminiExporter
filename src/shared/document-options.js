/**
 * Opzioni che governano il contenuto del documento esportato.
 *
 * Registry dichiarativo, come `export-scopes` e `export-formats`: il dialogo si
 * costruisce da questo elenco, quindi aggiungere un'opzione non richiede di
 * toccare la UI.
 *
 * Sono le scelte che rispondono alla domanda «cosa finisce nel documento», e
 * stanno nel dialogo di esportazione perché è lì che l'utente decide **questa**
 * esportazione. Le impostazioni che valgono per tutte le esportazioni — lingua,
 * livello di log, permesso di cattura — restano nel popup dell'estensione.
 * @module shared/document-options
 */

/**
 * @typedef {object} DocumentOption
 * @property {string} id Chiave nelle preferenze.
 * @property {string} label Testo mostrato accanto alla casella.
 * @property {string} [hint] Nota esplicativa, mostrata sotto l'etichetta.
 * @property {boolean} [requiresPermission] Se true, l'opzione dipende da un
 *   permesso che solo il popup può richiedere.
 */

/**
 * Ordine di presentazione: dal contenuto sempre disponibile a quello che
 * richiede un permesso aggiuntivo.
 * @type {readonly DocumentOption[]}
 */
export const DOCUMENT_OPTIONS = Object.freeze(
  /** @type {DocumentOption[]} */ ([
    {
      id: 'includeUserMessage',
      label: 'Includi il messaggio dell’utente',
    },
    {
      id: 'includeAttachments',
      label: 'Includi l’elenco dei file allegati',
    },
    {
      id: 'includeImages',
      label: 'Includi le immagini',
    },
    {
      id: 'includeCharts',
      label: 'Includi i grafici interattivi',
      requiresPermission: true,
    },
  ])
);

/** @returns {DocumentOption[]} */
export function listDocumentOptions() {
  return [...DOCUMENT_OPTIONS];
}

/** @returns {string[]} Identificatori delle opzioni, per la persistenza. */
export function documentOptionIds() {
  return DOCUMENT_OPTIONS.map((option) => option.id);
}
