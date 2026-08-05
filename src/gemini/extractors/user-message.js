/**
 * Estrazione del messaggio utente da un turno di conversazione.
 * @module gemini/extractors/user-message
 */

import { queryFirst, queryAll, queryTextContent } from '../dom-query.js';
import { createMessage, createAttachment } from '../../core/model/conversation.js';

/**
 * @param {Element} turnElement Elemento `.conversation-container`.
 * @param {object} [deps]
 * @param {import('../../shared/logger.js').Logger} [deps.logger]
 * @returns {import('../../core/model/conversation.js').Message}
 */
export function extractUserMessage(turnElement, deps = {}) {
  const queryRoot = queryFirst(turnElement, 'userQuery', deps);

  // Un turno senza messaggio utente è legittimo (es. risposta rigenerata):
  // restituiamo un messaggio vuoto invece di fallire.
  if (!queryRoot) {
    return createMessage({ role: 'user', text: '', attachments: [] });
  }

  return createMessage({
    role: 'user',
    text: extractText(queryRoot, deps),
    attachments: extractAttachments(queryRoot, deps),
  });
}

/**
 * @param {Element} queryRoot
 * @param {object} deps
 * @returns {string}
 */
function extractText(queryRoot, deps) {
  const text = queryTextContent(queryRoot, 'userQueryText', deps);
  // Fallback: se i selettori di riga non corrispondono più, usiamo il testo grezzo
  // del blocco. Meglio un testo con qualche spazio in più che nessun testo.
  return text || (queryRoot.textContent ?? '').trim();
}

/**
 * @param {Element} queryRoot
 * @param {object} deps
 * @returns {import('../../core/model/conversation.js').Attachment[]}
 */
function extractAttachments(queryRoot, deps) {
  return queryAll(queryRoot, 'uploadedFile', deps)
    .map((fileElement) => {
      const nameElement = queryFirst(fileElement, 'uploadedFileName', deps);
      if (!nameElement) return null;

      const extensionElement = queryFirst(fileElement, 'uploadedFileExtension', deps);
      return createAttachment({
        name: nameElement.textContent ?? '',
        extension: extensionElement?.textContent ?? '',
      });
    })
    .filter((attachment) => attachment !== null && attachment.name !== '');
}
