/**
 * Errori applicativi tipizzati.
 *
 * Regola: ogni errore che l'utente può incontrare ha un codice stabile e un
 * messaggio comprensibile. Niente "Errore generico". I codici permettono alla UI
 * di decidere il tono del messaggio senza fare parsing di stringhe.
 * @module shared/errors
 */

/**
 * Codici di errore. Stabili: non rinominare, sono usati nei test e nella UI.
 * @readonly
 */
export const ErrorCode = Object.freeze({
  /** Un selettore Gemini non ha prodotto risultati: l'HTML è cambiato. */
  SELECTOR_NOT_FOUND: 'SELECTOR_NOT_FOUND',
  /** La risposta esiste ma è vuota dopo la pulizia. */
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',
  /** Nessun turno di conversazione trovato nella pagina. */
  NO_CONVERSATION: 'NO_CONVERSATION',
  /** Il browser ha bloccato l'apertura della nuova scheda. */
  POPUP_BLOCKED: 'POPUP_BLOCKED',
  /** Un asset dell'estensione non è stato caricato. */
  ASSET_LOAD_FAILED: 'ASSET_LOAD_FAILED',
  /** Formato di esportazione non ancora disponibile. */
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  /** Errore non previsto: da investigare nei log. */
  UNEXPECTED: 'UNEXPECTED',
});

/** @typedef {typeof ErrorCode[keyof typeof ErrorCode]} ExportErrorCode */

/** Messaggi rivolti all'utente finale, in italiano, azionabili. */
const USER_MESSAGE = Object.freeze({
  [ErrorCode.SELECTOR_NOT_FOUND]:
    "Gemini sembra aver cambiato la sua interfaccia: non trovo il contenuto da esportare. Aggiorna l'estensione o segnala il problema.",
  [ErrorCode.EMPTY_RESPONSE]:
    'La risposta di Gemini risulta vuota: non c\u2019è nulla da esportare.',
  [ErrorCode.NO_CONVERSATION]: 'Nessuna conversazione trovata in questa pagina.',
  [ErrorCode.POPUP_BLOCKED]:
    'Il browser ha bloccato la nuova scheda: ho scaricato il file HTML, aprilo e stampalo come PDF.',
  [ErrorCode.UNSUPPORTED_FORMAT]:
    'Questo formato di esportazione non è ancora disponibile. Scegli PDF.',
  [ErrorCode.ASSET_LOAD_FAILED]:
    "Non sono riuscito a caricare le risorse di stile: l'export potrebbe avere una formattazione ridotta.",
  [ErrorCode.UNEXPECTED]: "Errore imprevisto durante l'esportazione. Riprova.",
});

/**
 * Errore applicativo con codice, messaggio utente e contesto diagnostico.
 */
export class ExportError extends Error {
  /**
   * @param {ExportErrorCode} code
   * @param {string} technicalMessage Messaggio per gli sviluppatori (log).
   * @param {object} [options]
   * @param {Record<string, unknown>} [options.context] Dati diagnostici.
   * @param {unknown} [options.cause] Errore originario.
   */
  constructor(code, technicalMessage, { context = {}, cause } = {}) {
    super(technicalMessage, { cause });
    this.name = 'ExportError';
    this.code = code;
    this.context = context;
    this.userMessage = USER_MESSAGE[code] ?? USER_MESSAGE[ErrorCode.UNEXPECTED];
  }

  /**
   * Un selettore concettuale non ha trovato alcun nodo.
   * @param {string} concept Nome logico del concetto (es. 'responseContent').
   * @param {string[]} [candidates] Selettori provati.
   */
  static selectorNotFound(concept, candidates = []) {
    return new ExportError(
      ErrorCode.SELECTOR_NOT_FOUND,
      `Nessun selettore valido per "${concept}"`,
      { context: { concept, candidates } }
    );
  }

  /** @param {string} [detail] */
  static emptyResponse(detail = '') {
    return new ExportError(ErrorCode.EMPTY_RESPONSE, `Risposta vuota. ${detail}`.trim());
  }

  /** Nessun turno di conversazione presente. */
  static noConversation() {
    return new ExportError(ErrorCode.NO_CONVERSATION, 'Nessun turno di conversazione nel DOM');
  }

  /** Il popup è stato bloccato dal browser. */
  static popupBlocked() {
    return new ExportError(ErrorCode.POPUP_BLOCKED, 'window.open ha restituito null');
  }

  /**
   * @param {string} path Percorso dell'asset.
   * @param {unknown} [cause]
   */
  static assetLoadFailed(path, cause) {
    return new ExportError(ErrorCode.ASSET_LOAD_FAILED, `Asset non caricato: ${path}`, {
      context: { path },
      cause,
    });
  }

  /**
   * @param {string} format Identificatore del formato richiesto.
   */
  static unsupportedFormat(format) {
    return new ExportError(ErrorCode.UNSUPPORTED_FORMAT, `Formato non disponibile: "${format}"`, {
      context: { format },
    });
  }

  /**
   * Normalizza un errore sconosciuto in ExportError, preservando la causa.
   * @param {unknown} error
   */
  static from(error) {
    if (error instanceof ExportError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new ExportError(ErrorCode.UNEXPECTED, message, { cause: error });
  }
}
