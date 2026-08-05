/**
 * Consegna di un documento binario tramite download.
 *
 * Usato dai formati che non si stampano ma si scaricano, come Word. A
 * differenza del PDF non serve alcuna scheda intermedia: il file viene salvato
 * e l'utente lo apre con la propria applicazione.
 * @module export/file-download.sink
 */

import { buildFilename } from './filename.js';
import { downloadBlob } from './download.js';
import { logger as defaultLogger } from '../shared/logger.js';

/**
 * @param {object} [deps]
 * @param {Document} [deps.document]
 * @param {{ createObjectURL: (blob: Blob) => string, revokeObjectURL: (url: string) => void }} [deps.objectUrls]
 * @param {import('../shared/logger.js').Logger} [deps.logger]
 */
export function createFileDownloadSink({
  document: doc = globalThis.document,
  objectUrls = globalThis.URL,
  logger = defaultLogger,
} = {}) {
  return {
    /**
     * @param {(overrides?: object) => Promise<Uint8Array|string>} renderDocument
     * @param {string} suggestedName Nome file suggerito, senza estensione.
     * @param {{ mimeType: string, extension: string }} fileType
     * @returns {Promise<{ method: 'download' }>}
     */
    async deliver(renderDocument, suggestedName, fileType) {
      const content = await renderDocument();
      const blob = new Blob([/** @type {BlobPart} */ (content)], { type: fileType.mimeType });

      const filename = downloadBlob({
        blob,
        filename: buildFilename(suggestedName) + fileType.extension,
        document: doc,
        objectUrls,
      });

      logger.info(`Documento scaricato come ${filename}.`);
      return { method: 'download' };
    },
  };
}
