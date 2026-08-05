/**
 * Caso d'uso: esportare una conversazione.
 *
 * È l'unico punto in cui la sequenza estrai → renderizza → consegna è descritta.
 * Riceve tutte le collaborazioni per injection, quindi è verificabile senza
 * browser e riutilizzabile per sorgenti diverse da Gemini.
 * @module core/usecases/export-conversation
 */

import { isConversationEmpty, firstUserText } from '../model/conversation.js';
import { buildFilename } from '../../export/filename.js';
import { ExportError } from '../../shared/errors.js';
import { isFormatAvailable, DEFAULT_FORMAT_ID } from '../../shared/export-formats.js';
import { DEFAULT_PREFERENCES } from '../../shared/config.js';
import { ok, err } from '../../shared/result.js';

/**
 * @typedef {object} ExportRequest
 * @property {'turn'|'selection'|'conversation'} scope Cosa esportare.
 * @property {string} [format] Formato di destinazione. Default: PDF.
 * @property {Element} [turnElement] Turno da esportare, se scope === 'turn'.
 * @property {Element[]} [turnElements] Turni scelti, se scope === 'selection'.
 *
 * @typedef {object} ExportSuccess
 * @property {string} method
 * @property {string} format Formato effettivamente prodotto.
 * @property {number} turnCount Numero di turni esportati.
 */

/**
/**
 * Una pipeline associa a un formato il suo renderer e il suo canale di
 * consegna. Aggiungere un formato significa registrare una pipeline nella
 * composition root: questo caso d'uso non va modificato.
 *
 * @typedef {object} ExportPipeline
 * @property {{ render: (c: object, o: object) => Promise<string|Uint8Array> }} renderer
 * @property {{ deliver: (render: Function, name: string, fileType?: object) => Promise<{ method: string }> }} sink
 * @property {{ mimeType: string, extension: string }} [fileType] Richiesto dai formati scaricabili.
 */

/**
 * @param {object} deps
 * @param {{ extractTurn: Function, extractConversation: Function, extractSelection: Function }} deps.source
 * @param {Record<string, ExportPipeline>} deps.pipelines Pipeline per formato.
 * @param {(c: object, options: object) => Promise<{ conversation: object }>} [deps.embedImages]
 *   Incorpora le immagini prima del rendering. Opzionale: se assente, il
 *   documento viene prodotto senza immagini.
 * @param {() => Promise<import('../../shared/config.js').Preferences>} deps.getPreferences
 * @param {import('../../shared/logger.js').Logger} deps.logger
 */
export function createExportConversationUseCase({
  source,
  pipelines,
  getPreferences,
  logger,
  embedImages,
}) {
  /**
   * @param {ExportRequest} request
   * @returns {Promise<import('../../shared/result.js').Result<ExportSuccess, ExportError>>}
   */
  return async function exportConversation(request) {
    try {
      const preferences = await getPreferences();

      const format = request.format ?? DEFAULT_FORMAT_ID;
      const formatError = validateFormat(format, pipelines);
      if (formatError) return err(formatError);

      const { renderer, sink, fileType } = pipelines[format];

      const title = resolveTitle(preferences.documentTitle);
      const extraction = extract(source, request, title);
      if (!extraction.ok) return extraction;

      const extracted = extraction.value;
      if (isConversationEmpty(extracted)) return err(ExportError.emptyResponse());

      // Le immagini vanno scaricate prima del rendering: nel documento
      // esportato gli URL originali non sarebbero più raggiungibili. Le
      // preferenze passano di qui perché decidono quali contenuti includere.
      const conversation = embedImages
        ? (await embedImages(extracted, preferences)).conversation
        : extracted;

      // Il documento viene reso su richiesta del sink, perché il contenuto
      // dipende dal canale di consegna: la pagina dell'estensione non ammette
      // script inline, il file scaricato invece ne ha bisogno per funzionare.
      const renderDocument = (overrides = {}) =>
        renderer.render(conversation, { ...preferences, ...overrides });

      // Il nome del file segue il titolo scelto dall'utente. Il testo del primo
      // messaggio resta come ripiego per il titolo predefinito, che non
      // distinguerebbe una conversazione dall'altra.
      const filename = buildFilename(
        title === DEFAULT_PREFERENCES.documentTitle ? firstUserText(conversation) : title
      );
      const { method } = await sink.deliver(renderDocument, filename, fileType);

      logger.info(
        `Export completato: ${conversation.turns.length} turni, formato ${format}, via ${method}.`
      );
      return ok({ method, format, turnCount: conversation.turns.length });
    } catch (error) {
      const exportError = ExportError.from(error);
      logger.error('Export fallito:', exportError.message, exportError.context);
      return err(exportError);
    }
  };
}

/**
 * Il titolo effettivo del documento.
 *
 * Un campo lasciato vuoto — o riempito di soli spazi — non è una scelta: è
 * l'assenza di una scelta, e produrrebbe un documento con l'intestazione in
 * bianco. Si ricade sul valore predefinito, che è anche il segnaposto mostrato
 * nel campo di testo: ciò che l'utente vede scritto in grigio è ciò che
 * otterrà.
 *
 * La normalizzazione vive qui e non nel dialogo perché vale per **tutti** i
 * chiamanti, compreso il popup e qualunque preferenza salvata in passato.
 *
 * @param {string|undefined} title
 * @returns {string}
 */
function resolveTitle(title) {
  const trimmed = (title ?? '').trim();
  return trimmed === '' ? DEFAULT_PREFERENCES.documentTitle : trimmed;
}

/**
 * @param {{ extractTurn: Function, extractConversation: Function, extractSelection: Function }} source
 * @param {ExportRequest} request
 * @param {string} title
 */
function extract(source, request, title) {
  if (request.scope === 'conversation') return source.extractConversation({ title });

  if (request.scope === 'selection') {
    // L'elenco arriva dalla modalità di selezione: se è vuoto l'utente non ha
    // scelto nulla, e non c'è documento da produrre.
    return source.extractSelection(request.turnElements ?? [], { title });
  }

  if (!request.turnElement) {
    return err(ExportError.noConversation());
  }
  return source.extractTurn(request.turnElement, { title });
}

/**
 * Il dialogo non permette di scegliere formati non disponibili, ma la richiesta
 * può arrivare anche da una preferenza salvata o dal popup: la validazione qui
 * è l'unico punto che protegge tutti i chiamanti.
 *
 * Si verificano due condizioni distinte: che il formato sia dichiarato
 * disponibile, e che esista davvero una pipeline registrata. La seconda evita
 * che una svista nella configurazione produca un errore oscuro più a valle.
 * @param {string} format
 * @param {Record<string, ExportPipeline>} pipelines
 * @returns {ExportError|null}
 */
function validateFormat(format, pipelines) {
  if (!isFormatAvailable(format) || !pipelines[format]) {
    return ExportError.unsupportedFormat(format);
  }
  return null;
}
