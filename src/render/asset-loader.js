/**
 * Caricamento asincrono e cache dei fogli di stile impacchettati.
 *
 * Sostituisce l'XMLHttpRequest *sincrona* della versione precedente
 * (problema P0-2), che bloccava il thread principale di gemini.google.com a
 * ogni esportazione. I fogli vengono letti una sola volta e memorizzati.
 * @module render/asset-loader
 */

import { ASSET_PATH, KATEX_CDN_IMPORT } from '../shared/config.js';
import { logger as defaultLogger } from '../shared/logger.js';

/**
 * @typedef {object} StyleBundle
 * @property {string} katexFonts Dichiarazioni @font-face con i font incorporati.
 * @property {string} katex CSS della libreria KaTeX.
 * @property {string} document Stili del documento.
 * @property {string} katexOverrides Correzioni KaTeX per la stampa.
 * @property {string} print Regole @media print.
 * @property {{ ok: boolean, missing: string[] }} integrity Esito del caricamento.
 */

/**
 * @param {object} deps
 * @param {(path: string) => string} deps.resolveUrl Traduce un percorso
 *   relativo in un URL raggiungibile. Iniettata dalla composition root: questo
 *   livello non deve conoscere le API dell'estensione, altrimenti la
 *   dipendenza fra i livelli si invertirebbe (render → extension).
 * @param {typeof fetch} [deps.fetchFn]
 * @param {import('../shared/logger.js').Logger} [deps.logger]
 */
export function createAssetLoader({
  resolveUrl,
  fetchFn = globalThis.fetch?.bind(globalThis),
  logger = defaultLogger,
}) {
  if (typeof resolveUrl !== 'function') {
    throw new TypeError('createAssetLoader richiede resolveUrl');
  }

  /** @type {Promise<StyleBundle>|null} Cache: gli asset non cambiano a runtime. */
  let cachedBundle = null;

  /**
   * @param {string} path
   * @param {object} [options]
   * @param {string} [options.fallback] Contenuto usato se il caricamento fallisce.
   * @param {boolean} [options.required] Se true, il fallimento viene segnalato come errore.
   * @returns {Promise<{ content: string, ok: boolean, path: string }>}
   */
  async function loadText(path, { fallback = '', required = true } = {}) {
    try {
      const response = await fetchFn(resolveUrl(path));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const content = await response.text();
      // Un asset vuoto è indistinguibile da un fallimento silenzioso.
      if (content.trim() === '') throw new Error('contenuto vuoto');

      return { content, ok: true, path };
    } catch (error) {
      const level = required ? 'error' : 'warn';
      logger[level](`Asset non caricato (${path}):`, error);
      return { content: fallback, ok: false, path };
    }
  }

  return {
    /**
     * Carica tutti i fogli di stile in parallelo.
     * @returns {Promise<StyleBundle>}
     */
    loadStyles() {
      if (cachedBundle) return cachedBundle;

      cachedBundle = Promise.all([
        // I font sono incorporati come data URI: senza di essi i delimitatori
        // grandi e le radici verrebbero resi come rettangoli vuoti. Il fallback
        // remoto è un'ultima spiaggia e funziona solo se la pagina ha rete.
        loadText(ASSET_PATH.katexFontsCss, { fallback: KATEX_CDN_IMPORT }),
        loadText(ASSET_PATH.katexCss),
        loadText(ASSET_PATH.documentCss),
        loadText(ASSET_PATH.katexOverridesCss),
        loadText(ASSET_PATH.printCss),
      ]).then((results) => {
        const [katexFonts, katex, documentCss, katexOverrides, print] = results;
        const failed = results.filter((result) => !result.ok).map((result) => result.path);

        if (failed.length > 0) {
          logger.error(
            'Alcuni fogli di stile non sono stati caricati: il documento avrà una ' +
              'formattazione ridotta (formule senza i glifi corretti). Asset mancanti:',
            failed
          );
        }

        return {
          katexFonts: katexFonts.content,
          katex: katex.content,
          document: documentCss.content,
          katexOverrides: katexOverrides.content,
          print: print.content,
          /** Diagnostica esposta al renderer e ai test. */
          integrity: { ok: failed.length === 0, missing: failed },
        };
      });

      return cachedBundle;
    },

    /** Svuota la cache. Usato nei test. */
    clearCache() {
      cachedBundle = null;
    },
  };
}
