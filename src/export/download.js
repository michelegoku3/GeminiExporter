/**
 * Salvataggio di un contenuto come file scaricato.
 *
 * Meccanismo condiviso dai sink: il PDF vi ricorre quando il browser blocca
 * l'apertura della scheda, Word lo usa come canale primario. Una sola
 * implementazione evita che i due percorsi divergano.
 * @module export/download
 */

import { TIMING } from '../shared/config.js';

/**
 * Avvia il download di un blob con il nome indicato.
 *
 * @param {object} params
 * @param {Blob} params.blob Contenuto da salvare.
 * @param {string} params.filename Nome completo, estensione inclusa.
 * @param {Document} params.document
 * @param {{ createObjectURL: (blob: Blob) => string, revokeObjectURL: (url: string) => void }} params.objectUrls
 * @returns {string} Il nome effettivamente usato, utile per i log.
 */
export function downloadBlob({ blob, filename, document: doc, objectUrls }) {
  const url = objectUrls.createObjectURL(blob);
  const link = doc.createElement('a');

  link.href = url;
  link.download = filename;
  link.style.display = 'none';

  // Il link deve trovarsi nel documento perché il click abbia effetto.
  doc.body.appendChild(link);
  link.click();

  // La revoca è differita: revocare subito annullerebbe il download in corso.
  setTimeout(() => {
    link.remove();
    objectUrls.revokeObjectURL(url);
  }, TIMING.downloadCleanupMs);

  return filename;
}
