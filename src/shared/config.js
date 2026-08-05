/**
 * Configurazione centralizzata.
 * Ogni "magic number" o stringa condivisa del progetto vive qui.
 * @module shared/config
 */

/** Identità dell'estensione. Usata in log, UI e footer del documento. */
export const APP = Object.freeze({
  name: 'Gemini Chat Exporter',
  shortName: 'GEX',
  version: '2.0.0',
  logPrefix: '[Gemini Chat Exporter]',
});

/** Prefisso unico per ogni classe/attributo iniettato nel DOM di Gemini. */
export const CSS_PREFIX = 'gex';

/** Classi CSS usate dal content script. Devono restare allineate a assets/styles/content.css. */
export const UI_CLASS = Object.freeze({
  buttonWrapper: `${CSS_PREFIX}-btn-wrapper`,
  button: `${CSS_PREFIX}-btn`,
  loading: `${CSS_PREFIX}-loading`,
  success: `${CSS_PREFIX}-success`,
  toast: `${CSS_PREFIX}-toast`,
  toastVisible: `${CSS_PREFIX}-toast-visible`,
  dialogHost: `${CSS_PREFIX}-dialog-host`,
  /** Applicata al body mentre la selezione manuale dei turni è attiva. */
  selectionMode: `${CSS_PREFIX}-selecting`,
  /** Applicata al turno scelto dall'utente. */
  turnSelected: `${CSS_PREFIX}-turn-selected`,
});

/** Tempistiche (millisecondi). Nessun timeout hard-coded altrove nel codice. */
export const TIMING = Object.freeze({
  /** Debounce delle mutazioni DOM: Gemini ne emette migliaia durante lo streaming. */
  observerDebounceMs: 250,
  /** Budget massimo di attesa per l'idle callback prima di forzare la scansione. */
  idleTimeoutMs: 500,
  /** Durata del feedback "successo" sul bottone. */
  buttonSuccessMs: 2500,
  /** Durata di visualizzazione del toast. */
  toastVisibleMs: 5000,
  /** Durata dell'animazione di uscita del toast. */
  toastFadeMs: 400,
  /** Vita del blob URL del documento esportato (10 min: l'utente può stampare con calma). */
  blobLifetimeMs: 10 * 60 * 1000,
  /** Ritardo di cleanup del link temporaneo di download. */
  downloadCleanupMs: 5000,
  /**
   * Attesa massima per il download di una singola immagine. Oltre questa
   * soglia l'immagine viene saltata: meglio perderla che bloccare l'export.
   */
  imageFetchMs: 15000,
});

/** Vincoli sulle immagini incorporate nel documento. */
export const IMAGE = Object.freeze({
  /**
   * Dimensione massima di una singola immagine.
   *
   * Le immagini sono incorporate in base64, che aumenta il peso di circa un
   * terzo: 8 MB di sorgente diventano ~11 MB nel documento. Oltre questa
   * soglia il file risulterebbe scomodo da aprire e inviare.
   */
  maxBytes: 8 * 1024 * 1024,
  /** Larghezza massima nel documento, in pixel. */
  maxWidthPx: 620,
});

/**
 * Parametri della cattura dei contenuti interattivi.
 *
 * I grafici di Gemini vivono in iframe cross-origin: l'unica trasposizione
 * possibile è una fotografia dello schermo (vedi `gemini/app-capture.js`).
 */
export const CAPTURE = Object.freeze({
  /**
   * Attesa fra lo scorrimento e lo scatto.
   *
   * Deve coprire lo scorrimento e il ridisegno successivo. Un valore troppo
   * basso fotografa la pagina in movimento; troppo alto rende l'esportazione
   * inutilmente lenta, perché l'attesa si paga per ogni contenuto.
   */
  settleMs: 350,
  /** Margine dal bordo superiore: evita l'intestazione fissa di Gemini. */
  topMarginPx: 80,
  /**
   * Numero massimo di schermate ricucite per un singolo contenuto.
   *
   * Oltre questa soglia la cattura costerebbe più dell'informazione che
   * aggiunge: si conserva la prima schermata.
   */
  maxSlices: 4,
  /** Larghezza massima dell'immagine prodotta, in pixel. */
  maxWidthPx: 1240,
});

/** Limiti applicati alla generazione dei nomi file. */
export const FILENAME = Object.freeze({
  fallback: 'gemini-export',
  maxLength: 60,
  extension: '.html',
});

/** Preferenze utente di default (persistite via storage). */
export const DEFAULT_PREFERENCES = Object.freeze({
  /**
   * Titolo mostrato in cima al documento esportato.
   * Il tipo è dichiarato esplicitamente perché `Object.freeze` restringerebbe
   * il letterale, impedendo di assegnare il titolo scelto nel dialogo.
   * @type {string}
   */
  documentTitle: 'Gemini Chat',
  /** Locale usato per formattare il timestamp. */
  locale: 'it-IT',
  /** Includere l'elenco dei file allegati al messaggio utente. */
  includeAttachments: true,
  /** Mostrare il messaggio utente nel documento. */
  includeUserMessage: true,
  /** Incorpora nel documento le immagini generate da Gemini. */
  includeImages: true,
  /**
   * Traspone i grafici interattivi in immagine.
   *
   * Predefinito a `false`: la cattura richiede un permesso aggiuntivo e scorre
   * la pagina, quindi va attivata deliberatamente e non subita.
   */
  includeCharts: false,
  /** Livello di log: 'silent' | 'error' | 'warn' | 'info' | 'debug'. */
  logLevel: 'warn',
  /**
   * Ultimo ambito scelto nel dialogo, riproposto alla riapertura.
   * @type {string}
   */
  lastScope: 'turn',
  /**
   * Ultimo formato scelto nel dialogo, riproposto alla riapertura.
   * @type {string}
   */
  lastFormat: 'pdf',
  /**
   * Incorpora nel documento lo script che attiva il pulsante di stampa e la
   * verifica dei font. Va disattivato solo quando il documento è servito da
   * una pagina dell'estensione, la cui CSP vieta gli script inline.
   */
  inlineBehaviour: true,
});

/** @typedef {typeof DEFAULT_PREFERENCES} Preferences */

/** Chiave usata nello storage dell'estensione. */
export const STORAGE_KEY = 'gex.preferences';

/** Percorsi degli asset impacchettati nell'estensione. */
export const ASSET_PATH = Object.freeze({
  /** Font KaTeX come data URI: rendono il documento autosufficiente offline. */
  katexFontsCss: 'assets/styles/katex-fonts.css',
  katexCss: 'assets/styles/katex.min.css',
  documentCss: 'assets/styles/document.css',
  printCss: 'assets/styles/print.css',
  katexOverridesCss: 'assets/styles/katex-overrides.css',
});

/** Fallback remoto se l'asset locale di KaTeX non fosse leggibile. */
export const KATEX_CDN_IMPORT =
  '@import url("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css");';
