/**
 * Caso d'uso: incorporare le catture dei contenuti interattivi.
 *
 * Ha la stessa forma di `embed-images`, e per la stessa ragione: l'estrazione
 * dal DOM è sincrona, mentre ottenere l'immagine di un grafico richiede di
 * scorrere la pagina e attendere. Tenere le due fasi separate permette di
 * esportare il testo anche quando la cattura non è possibile.
 *
 * Il core non sa come si cattura: riceve un collaboratore che sostituisce i
 * segnaposto con immagini e si limita a ricostruire il modello.
 * @module core/usecases/embed-app-captures
 */

import { createConversation, createMessage, createTurn } from '../model/conversation.js';

/**
 * @typedef {object} CaptureOutcome
 * @property {import('../model/conversation.js').Conversation} conversation
 * @property {number} captured Contenuti trasposti in immagine.
 * @property {number} failed Contenuti non catturabili, ridotti a didascalia.
 */

/**
 * @param {object} deps
 * @param {{ captureAll: (root: Element, attribute: string) => Promise<{ captured: number, failed: number }> }} deps.appCapture
 * @param {string} deps.idAttribute Attributo che marca i segnaposto.
 * @param {(html: string) => Element} deps.parseHtml
 * @param {(element: Element) => import('../model/safe-html.js').SafeHtml} deps.sanitize
 *   Ri-sanifica dopo la modifica: nulla rientra nel modello senza allowlist.
 * @param {import('../../shared/logger.js').Logger} deps.logger
 */
export function createEmbedAppCapturesUseCase({
  appCapture,
  idAttribute,
  parseHtml,
  sanitize,
  logger,
}) {
  /**
   * @param {import('../model/conversation.js').Conversation} conversation
   * @returns {Promise<CaptureOutcome>}
   */
  return async function embedAppCaptures(conversation) {
    let captured = 0;
    let failed = 0;

    // I turni si elaborano in sequenza, non in parallelo: ogni cattura scorre
    // la pagina, e due scorrimenti simultanei si annullerebbero a vicenda.
    const turns = [];

    for (const turn of conversation.turns) {
      const message = turn.modelMessage;

      if (!message.html) {
        turns.push(turn);
        continue;
      }

      const container = parseHtml(message.html.value);
      // Nessun contenuto interattivo: si evita la ricostruzione del messaggio.
      if (!container.querySelector(`[${idAttribute}]`)) {
        turns.push(turn);
        continue;
      }

      const outcome = await appCapture.captureAll(container, idAttribute);
      captured += outcome.captured;
      failed += outcome.failed;

      turns.push(
        createTurn(
          turn.userMessage,
          createMessage({
            role: message.role,
            text: message.text,
            html: sanitize(container),
            attachments: [...message.attachments],
          })
        )
      );
    }

    if (captured > 0 || failed > 0) {
      logger.info(`Contenuti interattivi catturati: ${captured}, non catturati: ${failed}.`);
    }

    return {
      conversation: createConversation({
        title: conversation.title,
        turns,
        source: conversation.source,
        exportedAt: conversation.exportedAt,
      }),
      captured,
      failed,
    };
  };
}
