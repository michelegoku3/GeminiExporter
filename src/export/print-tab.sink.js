/**
 * Consegna del documento: apertura in una nuova scheda pronta per la stampa.
 *
 * Il documento viene servito da una **pagina dell'estensione**
 * (`chrome-extension://…/viewer.html`) e non più da un URL `blob:`.
 *
 * Motivo (vedi docs/BUGFIX-CSP-BLOB.md): una pagina `blob:` eredita la Content
 * Security Policy del documento che l'ha creata. Poiché il blob nasceva nel
 * content script iniettato in gemini.google.com, il documento ereditava la CSP
 * di Google, che vieta `font-src data:`. I venti font KaTeX incorporati come
 * data URI venivano quindi bloccati dal browser, e le formule perdevano i
 * delimitatori grandi e i simboli speciali.
 *
 * Le pagine dell'estensione hanno una CSP propria, dichiarata nel manifest, e
 * non ereditano nulla dalla pagina ospite.
 *
 * Perché non una libreria PDF (jsPDF, pdfmake): la stampa nativa del browser
 * preserva font, KaTeX, interruzioni di pagina e selezione del testo, senza
 * aggiungere dipendenze né permessi.
 * @module export/print-tab.sink
 */

import { TIMING } from '../shared/config.js';
import { buildFilename } from './filename.js';
import { downloadBlob } from './download.js';
import { logger as defaultLogger } from '../shared/logger.js';

/**
 * @typedef {'extension-page'|'tab'|'download'} DeliveryMethod
 * @typedef {{ method: DeliveryMethod }} DeliveryOutcome
 */

/** Prefisso delle chiavi temporanee nello storage. */
const DOCUMENT_KEY_PREFIX = 'gex.document.';

/** Percorso della pagina che ospita il documento. */
const VIEWER_PATH = 'src/extension/viewer/viewer.html';

/**
 * @param {object} [deps]
 * @param {Window} [deps.window]
 * @param {Document} [deps.document]
 * @param {typeof chrome} [deps.browserApi]
 * @param {{ createObjectURL: (blob: Blob) => string, revokeObjectURL: (url: string) => void }} [deps.objectUrls]
 * @param {import('../shared/logger.js').Logger} [deps.logger]
 */
export function createPrintTabSink({
  window: win = globalThis.window,
  document: doc = globalThis.document,
  browserApi = globalThis.browser ?? globalThis.chrome,
  objectUrls = globalThis.URL,
  logger = defaultLogger,
} = {}) {
  /**
   * Deposita il documento nello storage e apre la pagina dell'estensione.
   * @param {(overrides?: object) => Promise<string>} renderDocument
   * @returns {Promise<boolean>} true se la scheda è stata aperta.
   */
  async function deliverViaExtensionPage(renderDocument) {
    if (!browserApi?.storage?.local || !browserApi?.runtime?.getURL) return false;

    // La CSP delle pagine dell'estensione vieta gli script inline: il
    // comportamento verrà applicato da viewer.js.
    const html = await renderDocument({ inlineBehaviour: false });

    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await browserApi.storage.local.set({ [DOCUMENT_KEY_PREFIX + key]: html });

    const url = browserApi.runtime.getURL(`${VIEWER_PATH}?doc=${encodeURIComponent(key)}`);
    const tab = win.open(url, '_blank');

    if (!tab) {
      // Popup bloccato: il documento resterebbe orfano nello storage.
      await browserApi.storage.local.remove(DOCUMENT_KEY_PREFIX + key);
      return false;
    }
    return true;
  }

  return {
    /**
     * @param {(overrides?: object) => Promise<string>} renderDocument
     *   Produce il documento; riceve le opzioni specifiche del canale.
     * @param {string} suggestedName Nome file suggerito (senza estensione).
     * @returns {Promise<DeliveryOutcome>}
     */
    async deliver(renderDocument, suggestedName) {
      try {
        if (await deliverViaExtensionPage(renderDocument)) {
          return { method: 'extension-page' };
        }
      } catch (error) {
        // Storage pieno o API non disponibile: si prosegue con il blob, che
        // funziona sempre anche se soggetto alla CSP della pagina ospite.
        logger.warn('Apertura tramite pagina dell\u2019estensione fallita:', error);
      }

      // Fallback: qui lo script inline serve, perché non c'è viewer.js.
      const html = await renderDocument({ inlineBehaviour: true });
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const blobUrl = objectUrls.createObjectURL(blob);
      const tab = win.open(blobUrl, '_blank');

      if (!tab) {
        logger.info('Apertura scheda bloccata, passo al download del file HTML.');
        objectUrls.revokeObjectURL(blobUrl);
        downloadAsFile(blob, suggestedName, doc, objectUrls);
        return { method: 'download' };
      }

      win.setTimeout(() => objectUrls.revokeObjectURL(blobUrl), TIMING.blobLifetimeMs);
      return { method: 'tab' };
    },
  };
}

/**
 * Fallback: salva il documento come file HTML.
 *
 * Un file aperto da disco (`file://`) non eredita alcuna policy esterna,
 * quindi i font incorporati funzionano regolarmente.
 * @param {Blob} blob
 * @param {string} suggestedName
 * @param {Document} doc
 * @param {{ createObjectURL: (blob: Blob) => string, revokeObjectURL: (url: string) => void }} objectUrls
 */
function downloadAsFile(blob, suggestedName, doc, objectUrls) {
  downloadBlob({
    blob,
    filename: buildFilename(suggestedName, { withExtension: true }),
    document: doc,
    objectUrls,
  });
}
