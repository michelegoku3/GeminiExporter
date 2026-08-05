/**
 * Modello dati interno: rappresentazione neutra di una conversazione.
 *
 * Questo è il contratto fra estrazione e rendering. Non contiene nodi DOM,
 * non conosce Gemini e non conosce il PDF: è serializzabile e testabile.
 * @module core/model/conversation
 */

import { isSafeHtml } from './safe-html.js';

/** @typedef {'user'|'model'} MessageRole */

/**
 * @typedef {object} Attachment
 * @property {string} name Nome del file allegato.
 * @property {string} extension Estensione mostrata da Gemini (es. "PDF").
 */

/**
 * @typedef {object} Message
 * @property {MessageRole} role Autore del messaggio.
 * @property {string} text Rappresentazione testuale, sempre valorizzata.
 * @property {import('./safe-html.js').SafeHtml|null} html Contenuto ricco sanificato, se presente.
 * @property {readonly Attachment[]} attachments Allegati associati al messaggio.
 */

/**
 * @typedef {object} ConversationTurn
 * @property {Message} userMessage
 * @property {Message} modelMessage
 */

/**
 * @typedef {object} Conversation
 * @property {string} title Titolo del documento.
 * @property {Date} exportedAt Momento dell'esportazione.
 * @property {readonly ConversationTurn[]} turns Turni esportati (1 = singola risposta, N = chat intera).
 * @property {{ app: string, url: string }} source Provenienza dei dati.
 */

/**
 * @param {object} params
 * @param {string} params.name
 * @param {string} [params.extension]
 * @returns {Attachment}
 */
export function createAttachment({ name, extension = '' }) {
  return Object.freeze({ name: name.trim(), extension: extension.trim() });
}

/**
 * @param {object} params
 * @param {MessageRole} params.role
 * @param {string} [params.text]
 * @param {import('./safe-html.js').SafeHtml|null} [params.html]
 * @param {Attachment[]} [params.attachments]
 * @returns {Message}
 */
export function createMessage({ role, text = '', html = null, attachments = [] }) {
  if (html !== null && !isSafeHtml(html)) {
    throw new TypeError('Message.html accetta solo istanze di SafeHtml (contenuto sanificato).');
  }
  return Object.freeze({ role, text, html, attachments: Object.freeze([...attachments]) });
}

/**
 * @param {Message} userMessage
 * @param {Message} modelMessage
 * @returns {ConversationTurn}
 */
export function createTurn(userMessage, modelMessage) {
  return Object.freeze({ userMessage, modelMessage });
}

/**
 * @param {object} params
 * @param {string} params.title
 * @param {ConversationTurn[]} params.turns
 * @param {{ app: string, url: string }} params.source
 * @param {Date} [params.exportedAt]
 * @returns {Conversation}
 */
export function createConversation({ title, turns, source, exportedAt = new Date() }) {
  return Object.freeze({ title, exportedAt, turns: Object.freeze([...turns]), source });
}

/**
 * Testo del primo messaggio utente: usato per suggerire il nome del file.
 * @param {Conversation} conversation
 * @returns {string}
 */
export function firstUserText(conversation) {
  return conversation.turns[0]?.userMessage.text ?? '';
}

/**
 * @param {Conversation} conversation
 * @returns {boolean} true se nessun turno ha contenuto esportabile.
 */
export function isConversationEmpty(conversation) {
  return conversation.turns.every(
    (turn) =>
      (turn.modelMessage.html === null || turn.modelMessage.html.isEmpty()) &&
      turn.modelMessage.text.trim() === ''
  );
}
