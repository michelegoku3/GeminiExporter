/**
 * Adapter Gemini → modello dati.
 *
 * È l'implementazione della porta `ConversationSource` del core. Tutto ciò che
 * riguarda la struttura HTML di Gemini termina qui: i livelli superiori
 * ricevono soltanto oggetti `Conversation`.
 * @module gemini/gemini-source
 */

import { queryAll, queryFirst } from './dom-query.js';
import { COMPLETE_MARKER_CLASS } from './selectors.js';
import { extractUserMessage } from './extractors/user-message.js';
import { extractModelResponse } from './extractors/model-response.js';
import { createConversation, createTurn } from '../core/model/conversation.js';
import { ok, err } from '../shared/result.js';
import { ExportError } from '../shared/errors.js';
import { logger as defaultLogger } from '../shared/logger.js';

/**
 * @param {object} [deps]
 * @param {import('../shared/logger.js').Logger} [deps.logger]
 * @param {Document} [deps.document]
 * @param {() => Date} [deps.now] Orologio iniettabile (test deterministici).
 * @param {boolean} [deps.captureEmbeddedApps] Se marcare i contenuti
 *   interattivi per la cattura. Va attivato solo quando esiste davvero un
 *   catturatore: altrimenti si produrrebbero segnaposto che nessuno riempie.
 */
export function createGeminiSource({
  logger = defaultLogger,
  document: doc = globalThis.document,
  now = () => new Date(),
  captureEmbeddedApps = false,
} = {}) {
  // Il progressivo è per sorgente, non globale: identificatori univoci
  // all'interno di una singola esportazione sono sufficienti a metterli in
  // corrispondenza, e uno stato di modulo renderebbe i test interdipendenti.
  let appCounter = 0;
  const nextAppId = () => `app-${(appCounter += 1)}`;

  const deps = { logger, nextAppId: captureEmbeddedApps ? nextAppId : undefined };

  return {
    /**
     * Estrae un singolo turno.
     * @param {Element} turnElement
     * @param {{ title: string }} options
     * @returns {import('../shared/result.js').Result<import('../core/model/conversation.js').Conversation, ExportError>}
     */
    extractTurn(turnElement, { title }) {
      try {
        return ok(
          createConversation({
            title,
            turns: [buildTurn(turnElement, deps)],
            source: { app: 'gemini', url: doc.location?.href ?? '' },
            exportedAt: now(),
          })
        );
      } catch (error) {
        return err(ExportError.from(error));
      }
    },

    /**
     * Estrae un insieme di turni scelti esplicitamente dall'utente.
     *
     * A differenza di `extractConversation` non filtra i turni incompleti: se
     * l'utente ne ha selezionato uno, va esportato — è una scelta deliberata,
     * non il risultato di una scansione automatica.
     *
     * @param {Element[]} turnElements
     * @param {{ title: string }} options
     * @returns {import('../shared/result.js').Result<import('../core/model/conversation.js').Conversation, ExportError>}
     */
    extractSelection(turnElements, { title }) {
      return collect(turnElements, { title, label: 'Turno selezionato' });
    },

    /**
     * Estrae tutti i turni completati presenti nella pagina.
     * I turni che falliscono singolarmente vengono saltati con un warning:
     * un turno malformato non deve impedire l'export dell'intera chat.
     * @param {{ title: string }} options
     * @returns {import('../shared/result.js').Result<import('../core/model/conversation.js').Conversation, ExportError>}
     */
    extractConversation({ title }) {
      const turnElements = queryAll(doc, 'conversationTurn', deps).filter((element) =>
        isTurnComplete(element, deps)
      );

      return collect(turnElements, { title, label: 'Turno' });
    },
  };

  /**
   * Costruisce una conversazione da un elenco di elementi.
   *
   * I turni che falliscono singolarmente vengono saltati con un avviso: uno
   * malformato non deve impedire l'esportazione degli altri.
   *
   * @param {Element[]} turnElements
   * @param {{ title: string, label: string }} options
   * @returns {import('../shared/result.js').Result<import('../core/model/conversation.js').Conversation, ExportError>}
   */
  function collect(turnElements, { title, label }) {
    if (turnElements.length === 0) return err(ExportError.noConversation());

    const turns = [];
    for (const [index, element] of turnElements.entries()) {
      try {
        turns.push(buildTurn(element, deps));
      } catch (error) {
        logger.warn(`${label} #${index + 1} saltato:`, ExportError.from(error).message);
      }
    }

    if (turns.length === 0) return err(ExportError.emptyResponse('Nessun turno estraibile.'));

    return ok(
      createConversation({
        title,
        turns,
        source: { app: 'gemini', url: doc.location?.href ?? '' },
        exportedAt: now(),
      })
    );
  }
}

/**
 * @param {Element} turnElement
 * @param {object} deps
 * @returns {import('../core/model/conversation.js').ConversationTurn}
 */
function buildTurn(turnElement, deps) {
  return createTurn(extractUserMessage(turnElement, deps), extractModelResponse(turnElement, deps));
}

/**
 * Un turno è esportabile solo quando lo streaming è terminato.
 * Se il footer non esiste più (cambio HTML), consideriamo il turno completo:
 * è preferibile un export potenzialmente parziale a nessun export.
 * @param {Element} turnElement
 * @param {object} deps
 * @returns {boolean}
 */
export function isTurnComplete(turnElement, deps = {}) {
  const footer = queryFirst(turnElement, 'responseFooter', deps);
  if (!footer) return true;
  return footer.classList.contains(COMPLETE_MARKER_CLASS);
}
