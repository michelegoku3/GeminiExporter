/**
 * Estrazione della risposta del modello: clone → pulizia → sanitizzazione.
 *
 * L'ordine delle fasi è significativo ed è documentato passo per passo:
 * togliere prima il rumore riduce il lavoro del sanitizer e evita che le
 * euristiche sui blocchi di codice operino su nodi già spacchettati.
 * @module gemini/extractors/model-response
 */

import { queryFirst, queryAll } from '../dom-query.js';
import { createMessage, createAttachment } from '../../core/model/conversation.js';
import { sanitizeElement, unwrap } from '../sanitize/html-sanitizer.js';
import { removeNoise } from '../sanitize/noise-removal.js';
import { normalizeCodeBlocks } from '../sanitize/code-blocks.js';
import { normalizeMath } from '../sanitize/katex.js';
import { flattenSingleParagraphListItems, removeEmptyContainers } from '../sanitize/structure.js';
import { normalizeImages } from '../sanitize/images.js';
import { markEmbeddedApps } from '../sanitize/embedded-apps.js';
import { ExportError } from '../../shared/errors.js';

/**
 * @param {Element} turnElement Elemento `.conversation-container`.
 * @param {object} [deps]
 * @param {import('../../shared/logger.js').Logger} [deps.logger]
 * @param {() => string} [deps.nextAppId] Generatore di identificatori per i
 *   contenuti interattivi. In sua assenza i grafici non vengono marcati: è il
 *   caso dei contesti privi di capacità di cattura, come i test.
 * @returns {import('../../core/model/conversation.js').Message}
 * @throws {ExportError} se il contenuto della risposta non è individuabile.
 */
export function extractModelResponse(turnElement, deps = {}) {
  const contentElement = queryFirst(turnElement, 'responseContent', deps);
  if (!contentElement) throw ExportError.selectorNotFound('responseContent');

  // Si lavora sempre su un clone: il DOM di Gemini non va mai modificato.
  const workingCopy = /** @type {Element} */ (contentElement.cloneNode(true));

  // I contenuti interattivi si marcano per primi, prima che le altre fasi
  // possano rimuoverli: `<iframe>` è un tag pericoloso e il sanitizer lo
  // eliminerebbe con tutto ciò che lo circonda. È anche l'unico momento in cui
  // clone e originale sono ancora strutturalmente allineati, condizione
  // necessaria a metterli in corrispondenza.
  if (deps.nextAppId) markEmbeddedApps(workingCopy, contentElement, deps.nextAppId);

  removeNoise(workingCopy, unwrap);
  normalizeCodeBlocks(workingCopy);
  normalizeMath(workingCopy);
  // Le immagini vengono ripulite qui, ma i dati sono scaricati più tardi:
  // l'estrazione resta sincrona (vedi core/usecases/embed-images.js).
  normalizeImages(workingCopy);
  flattenSingleParagraphListItems(workingCopy, unwrap);
  removeEmptyContainers(workingCopy);

  // La sanitizzazione è l'ULTIMA fase: nulla la può scavalcare.
  const html = sanitizeElement(workingCopy);

  return createMessage({
    role: 'model',
    text: (workingCopy.textContent ?? '').trim(),
    html,
    // I file generati si leggono dall'elemento **originale**: il chip vive
    // dentro un pulsante, che le fasi di pulizia rimuovono dal clone.
    attachments: extractGeneratedFiles(contentElement, deps),
  });
}

/**
 * File prodotti da Gemini e offerti in download.
 *
 * Sono contenuti veri e propri della risposta — un HTML, un CSV, un PDF — ma
 * scaricabili solo dall'interfaccia: nel documento esportato ne resta la
 * menzione, così chi legge sa che esistono e come si chiamano.
 *
 * Il nome completo sta nell'attributo `title`; il testo visibile è troncato e
 * privo di estensione.
 *
 * @param {Element} root
 * @param {object} deps
 * @returns {import('../../core/model/conversation.js').Attachment[]}
 */
function extractGeneratedFiles(root, deps) {
  return queryAll(root, 'generatedFile', deps)
    .map((chip) => {
      const nameElement = queryFirst(chip, 'generatedFileName', deps) ?? chip;
      const fullName = nameElement.getAttribute('title') ?? nameElement.textContent ?? '';
      const type = queryFirst(chip, 'generatedFileType', deps)?.textContent ?? '';

      return createAttachment({
        // L'estensione è già nel nome completo: ripeterla come tipo
        // produrrebbe «pagina.html [HTML]».
        name: fullName.trim(),
        extension: fullName.includes('.') ? '' : type.trim(),
      });
    })
    .filter((file) => file.name !== '');
}
