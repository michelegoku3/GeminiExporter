/**
 * Caso d'uso: incorporare le immagini nel documento.
 *
 * Costituisce una fase distinta perché ha una natura diversa dall'estrazione:
 * quest'ultima legge il DOM ed è sincrona, mentre il recupero delle immagini
 * richiede I/O di rete. Tenerle separate evita di rendere asincrona l'intera
 * catena di estrazione e permette di esportare il testo anche quando le
 * immagini non sono recuperabili.
 *
 * Il risultato è una `Conversation` in cui ogni `<img>` porta i dati con sé:
 * i renderer non devono più sapere da dove provenissero.
 * @module core/usecases/embed-images
 */

import { createConversation, createMessage, createTurn } from '../model/conversation.js';

/**
 * @typedef {object} EmbedOutcome
 * @property {import('../model/conversation.js').Conversation} conversation
 * @property {number} resolved Immagini incorporate.
 * @property {number} failed Immagini non recuperabili, rimosse dal documento.
 */

/**
 * @param {object} deps
 * @param {{ embedAll: (root: Element) => Promise<{ resolved: number, failed: number }> }} deps.imageResolver
 * @param {(html: string) => Element} deps.parseHtml Costruisce un elemento dal
 *   markup; iniettata per non dipendere dal DOM globale.
 * @param {(element: Element) => import('../model/safe-html.js').SafeHtml} deps.sanitize
 *   Ri-sanifica il markup dopo la modifica: nulla può rientrare nel modello
 *   senza passare dall'allowlist.
 * @param {import('../../shared/logger.js').Logger} deps.logger
 */
export function createEmbedImagesUseCase({ imageResolver, parseHtml, sanitize, logger }) {
  /**
   * @param {import('../model/conversation.js').Conversation} conversation
   * @returns {Promise<EmbedOutcome>}
   */
  return async function embedImages(conversation) {
    let resolved = 0;
    let failed = 0;

    const turns = await Promise.all(
      conversation.turns.map(async (turn) => {
        const message = turn.modelMessage;
        if (!message.html) return turn;

        const container = parseHtml(message.html.value);
        // Nessuna immagine: si evita la ricostruzione del messaggio.
        if (!container.querySelector('img')) return turn;

        const outcome = await imageResolver.embedAll(container);
        resolved += outcome.resolved;
        failed += outcome.failed;

        return createTurn(
          turn.userMessage,
          createMessage({
            role: message.role,
            text: message.text,
            html: sanitize(container),
            attachments: [...message.attachments],
          })
        );
      })
    );

    if (resolved > 0 || failed > 0) {
      logger.info(`Immagini incorporate: ${resolved}, non recuperate: ${failed}.`);
    }

    return {
      conversation: createConversation({
        title: conversation.title,
        turns,
        source: conversation.source,
        exportedAt: conversation.exportedAt,
      }),
      resolved,
      failed,
    };
  };
}
