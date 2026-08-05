/**
 * Registry dei selettori del DOM di Gemini.
 *
 * REGOLA FONDAMENTALE DI MANUTENZIONE
 * -----------------------------------
 * Questo è l'UNICO file che va toccato quando Google cambia l'HTML di Gemini.
 * Ogni concetto è una LISTA ORDINATA di selettori, dal più preciso al più
 * generico. `queryFirst` prova i candidati in ordine e segnala nei log quando
 * deve ricorrere a un fallback ("selector drift"): è il campanello d'allarme
 * che avvisa che il DOM sta cambiando, prima che l'estensione smetta di funzionare.
 *
 * Quando aggiungi un selettore nuovo: mettilo in TESTA se è più specifico,
 * in CODA se è una rete di sicurezza. Non rimuovere i vecchi finché non sei
 * certo che nessun utente stia più usando quella versione di Gemini.
 * @module gemini/selectors
 */

/**
 * @typedef {object} SelectorConcept
 * @property {string} description A cosa serve, in linguaggio umano.
 * @property {string[]} candidates Selettori in ordine di preferenza.
 */

/** @type {Record<string, SelectorConcept>} */
export const SELECTORS = Object.freeze({
  chatRoot: {
    description: 'Contenitore scrollabile che racchiude tutta la cronologia della chat',
    candidates: [
      'infinite-scroller[data-test-id="chat-history-container"]',
      'infinite-scroller[data-test-id*="chat-history"]',
      'infinite-scroller',
      'chat-window',
      'main',
    ],
  },

  conversationTurn: {
    description: 'Coppia domanda utente + risposta modello',
    candidates: ['.conversation-container', 'div[class*="conversation-container"]'],
  },

  userQuery: {
    description: 'Blocco del messaggio inviato dall\u2019utente',
    candidates: ['user-query', '[data-test-id="user-query"]', 'div[class*="user-query"]'],
  },

  userQueryText: {
    description: 'Righe di testo del messaggio utente',
    candidates: ['.query-text-line', '.query-text', '[class*="query-text"]'],
  },

  modelResponse: {
    description: 'Blocco della risposta generata dal modello',
    candidates: ['model-response', '[data-test-id="model-response"]'],
  },

  responseContent: {
    description: 'Contenuto markdown renderizzato della risposta',
    candidates: [
      'message-content .markdown.markdown-main-panel',
      'message-content .markdown',
      'message-content [class*="markdown"]',
      '.model-response-text .markdown',
      '.markdown-main-panel',
      'message-content',
    ],
  },

  actionsBar: {
    description: 'Barra con i pulsanti 👍 👎 Copia sotto la risposta',
    candidates: [
      'message-actions .buttons-container-v2',
      'message-actions .buttons-container',
      'message-actions [class*="buttons-container"]',
      'message-actions',
    ],
  },

  responseFooter: {
    description: 'Footer della risposta: la classe "complete" indica streaming terminato',
    candidates: ['.response-footer', '[class*="response-footer"]'],
  },

  embeddedApp: {
    description:
      'Contenitore di un contenuto interattivo incorporato (grafico, simulazione, anteprima web)',
    candidates: ['mini-app', 'web-preview', '[data-test-id="preview-block"]'],
  },

  embeddedAppFrame: {
    description: 'Iframe che ospita il contenuto interattivo: il rettangolo da catturare',
    candidates: ['iframe'],
  },

  generatedFile: {
    description: 'Chip di un file generato da Gemini e offerto in download',
    candidates: ['generated-file', '[data-test-id="file-name"]'],
  },

  generatedFileName: {
    description: 'Nome del file generato',
    candidates: ['[data-test-id="file-name"]', '.file-name-lr'],
  },

  generatedFileType: {
    description: 'Tipo del file generato (HTML, PDF, …)',
    candidates: ['.file-type-lr', '[class*="file-type"]'],
  },

  uploadedFile: {
    description: 'Chip di un file allegato dall\u2019utente',
    candidates: [
      '[data-test-id="uploaded-file"]',
      '[data-test-id*="uploaded-file"]',
      'uploaded-file-preview',
    ],
  },

  uploadedFileName: {
    description: 'Nome del file allegato',
    candidates: ['[data-test-id="filename-label"]', '[class*="filename"]'],
  },

  uploadedFileExtension: {
    description: 'Estensione del file allegato',
    candidates: ['[data-test-id="extension-label"]', '[class*="extension-label"]'],
  },
});

/** Classe che Gemini applica al footer quando lo streaming è terminato. */
export const COMPLETE_MARKER_CLASS = 'complete';

/**
 * Nomi dei concetti, utili per i test di contratto sulle fixture.
 * @type {string[]}
 */
export const SELECTOR_CONCEPTS = Object.keys(SELECTORS);
