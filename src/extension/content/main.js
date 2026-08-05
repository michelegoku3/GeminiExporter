/**
 * Composition root del content script.
 *
 * È l'unico file che conosce tutti i moduli: costruisce le dipendenze concrete
 * e le collega. Ogni altro modulo riceve ciò che gli serve per injection, quindi
 * resta isolato e testabile. Per sostituire un componente (es. un renderer
 * Markdown al posto di quello HTML) si cambia solo questo file.
 * @module extension/content/main
 */

import { APP } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { ErrorCode } from '../../shared/errors.js';
/** @typedef {import('../../shared/errors.js').ExportError} ExportError */
import { createGeminiSource } from '../../gemini/gemini-source.js';
import { createImageResolver } from '../../gemini/image-resolver.js';
import { createAppCapture } from '../../gemini/app-capture.js';
import { createEmbedImagesUseCase } from '../../core/usecases/embed-images.js';
import { createEmbedAppCapturesUseCase } from '../../core/usecases/embed-app-captures.js';
import { sanitizeElement } from '../../gemini/sanitize/html-sanitizer.js';
import { APP_ID_ATTRIBUTE, clearLiveMarkers } from '../../gemini/sanitize/embedded-apps.js';
import { sendMessage } from '../platform/browser.js';
import {
  requestCapturePermissionState,
  requestCapturePermissionVia,
  revokeCapturePermissionVia,
} from '../platform/capture-permission.js';
import { documentOptionIds } from '../../shared/document-options.js';
import { isDeferredScope } from '../../shared/export-scopes.js';
import { createTurnSelection } from './turn-selection.js';
import { createAssetLoader } from '../../render/asset-loader.js';
import { createHtmlDocumentRenderer } from '../../render/html-document.renderer.js';
import { createPrintTabSink } from '../../export/print-tab.sink.js';
import { createFileDownloadSink } from '../../export/file-download.sink.js';
import { createDocxRenderer, DOCX_MIME, DOCX_EXTENSION } from '../../export/docx/docx.renderer.js';
import { createExportConversationUseCase } from '../../core/usecases/export-conversation.js';
import { createPreferencesStore } from '../preferences.js';
import { getAssetUrl } from '../platform/browser.js';
import { createResponseWatcher } from './response-watcher.js';
import { createButtonInjector } from './button-injector.js';
import { createExportDialog } from './export-dialog.js';
import { createToaster } from './toast.js';

/** Messaggi di esito mostrati all'utente. */
const MESSAGE = Object.freeze({
  openedInTab: '📄 Pagina aperta — attendi il caricamento, poi clicca "Salva come PDF"',
  downloaded: '📄 File HTML scaricato — aprilo e stampa come PDF',
  wordDownloaded: '📝 Documento Word scaricato',
});

/** Il documento viene aperto in una scheda, con qualunque canale di consegna. */
const TAB_METHODS = new Set(['extension-page', 'tab']);

/**
 * Traduce l'esito in messaggio e tono per il toast.
 * @param {{ method: string, format: string }} outcome
 * @returns {[string, 'success'|'info']}
 */
function describeOutcome({ method, format }) {
  if (format === 'word') return [MESSAGE.wordDownloaded, 'success'];
  if (TAB_METHODS.has(method)) return [MESSAGE.openedInTab, 'success'];
  return [MESSAGE.downloaded, 'info'];
}

/**
 * Registro dei formati: per ciascuno, come si costruisce il documento e come
 * viene consegnato. Aggiungere un formato significa aggiungere una voce qui.
 *
 * @param {import('../../shared/logger.js').Logger} logger
 * @returns {Record<string, import('../../core/usecases/export-conversation.js').ExportPipeline>}
 */
function createPipelines(logger) {
  const assetLoader = createAssetLoader({ resolveUrl: getAssetUrl, logger });

  return {
    pdf: {
      renderer: createHtmlDocumentRenderer({ assetLoader }),
      sink: createPrintTabSink({ logger }),
    },
    word: {
      renderer: createDocxRenderer(),
      sink: createFileDownloadSink({ logger }),
      fileType: { mimeType: DOCX_MIME, extension: DOCX_EXTENSION },
    },
  };
}

/**
 * Costruisce la fase di incorporamento delle immagini.
 *
 * Gli URL `blob:` di Gemini non sono raggiungibili dal documento esportato:
 * le immagini vanno scaricate e trasformate in dati prima del rendering.
 *
 * @param {import('../../shared/logger.js').Logger} logger
 * @returns {ReturnType<typeof createEmbedImagesUseCase>}
 */
function createImageEmbedder(logger) {
  return createEmbedImagesUseCase({
    imageResolver: createImageResolver({ logger }),
    parseHtml,
    // Il contenuto modificato torna nel modello solo passando dall'allowlist.
    sanitize: sanitizeElement,
    logger,
  });
}

/**
 * Costruisce un elemento a partire da markup.
 * Condivisa dalle fasi che rielaborano il messaggio già estratto.
 * @param {string} html
 * @returns {Element}
 */
function parseHtml(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

/**
 * Costruisce la fase di cattura dei contenuti interattivi.
 *
 * I grafici di Gemini vivono in iframe cross-origin e sandboxed: il loro
 * contenuto non è leggibile in alcun modo, quindi l'unica trasposizione
 * possibile è una fotografia dello schermo. Lo scatto compete al service
 * worker, l'unico contesto da cui `tabs.captureVisibleTab` è invocabile.
 *
 * @param {import('../../shared/logger.js').Logger} logger
 * @returns {ReturnType<typeof createEmbedAppCapturesUseCase>}
 */
function createAppCaptureEmbedder(logger) {
  const appCapture = createAppCapture({
    captureVisibleTab: async () => {
      const response = /** @type {{ ok: boolean, dataUrl?: string, error?: string }} */ (
        await sendMessage({ type: 'gex:capture-tab' })
      );
      if (!response?.ok || !response.dataUrl) {
        throw new Error(response?.error ?? 'cattura non riuscita');
      }
      return response.dataUrl;
    },
    logger,
    // `captureVisibleTab` esige il permesso `<all_urls>`, che è opzionale e
    // viene concesso dal popup. Verificarlo prima evita di scorrere la
    // cronologia per un'operazione destinata comunque a fallire.
    //
    // La verifica passa dal service worker: `chrome.permissions` non è
    // accessibile ai content script e qui risulterebbe sempre negata.
    canCapture: () => requestCapturePermissionState(sendMessage),
  });

  return createEmbedAppCapturesUseCase({
    appCapture,
    idAttribute: APP_ID_ATTRIBUTE,
    parseHtml,
    sanitize: sanitizeElement,
    logger,
  });
}

/**
 * Concatena le fasi asincrone che arricchiscono la conversazione estratta.
 *
 * Sono operazioni distinte ma con la stessa forma: prendono una conversazione
 * e ne restituiscono una con più contenuto. Comporle qui evita che il caso
 * d'uso di esportazione debba conoscerle una per una.
 *
 * L'ordine conta: le catture producono immagini già in forma di data URI,
 * quindi devono precedere la fase che le incorpora nel documento.
 *
 * Ogni fase dichiara l'opzione da cui dipende. Saltare una fase disattivata è
 * più che un'ottimizzazione: la cattura scorre la pagina e il recupero delle
 * immagini fa richieste di rete, effetti che l'utente ha esplicitamente escluso.
 *
 * @param {Array<{ when: string, phase: (c: object) => Promise<{ conversation: object }> }>} phases
 * @returns {(c: object, options: Record<string, unknown>) => Promise<{ conversation: object }>}
 */
function composeEnrichment(phases) {
  return async function enrich(conversation, options = {}) {
    let current = conversation;
    for (const { when, phase } of phases) {
      if (options[when] !== true) continue;
      current = (await phase(current)).conversation;
    }
    return { conversation: current };
  };
}

/**
 * Costruisce la funzione che chiede all'utente cosa esportare e poi procede.
 *
 * @param {object} deps
 * @param {ReturnType<typeof createPreferencesStore>} deps.preferences
 * @param {(request: object) => Promise<boolean>} deps.runExport
 * @param {import('./turn-selection.js').TurnSelection} deps.selection
 * @param {{ show: (message: string, tone: string) => void }} deps.toaster
 * @returns {(turnElement: Element, feedback: object) => Promise<void>}
 */
function createPrompt({ preferences, runExport, selection, toaster }) {
  const dialog = createExportDialog();

  /**
   * @param {Element} turnElement Turno da cui è partita l'azione.
   * @param {{ start: () => void, succeed: () => void, stop: () => void }} feedback
   */
  return async function promptAndExport(turnElement, feedback) {
    // Selezione già in corso: il pulsante non riapre il dialogo per scegliere
    // di nuovo, esporta ciò che l'utente ha indicato. È il secondo tempo del
    // flusso, e riproporre le stesse domande sarebbe una ripetizione inutile.
    if (selection.isActive()) {
      const done = await exportSelection({ feedback, selection, preferences, runExport });
      // Nessun turno scelto: invece di rimproverare, si riapre il dialogo.
      // Chi non ha selezionato nulla ha probabilmente sbagliato modalità, e
      // rimandarlo alla scelta è più utile di un avviso.
      if (done) return;
      selection.disable();
    }

    const preferred = await preferences.load();

    // Il permesso di cattura decide se l'opzione sui grafici è attivabile: il
    // dialogo non può richiederlo, quindi ne riceve soltanto lo stato.
    const canCapture = await requestCapturePermissionState(sendMessage);

    const choice = await dialog.open({
      scope: preferred.lastScope,
      format: preferred.lastFormat,
      documentTitle: preferred.documentTitle,
      options: pickDocumentOptions(preferred),
      canCapture,
      // Passate come funzioni, non come esito: vanno invocate dentro il
      // gestore del click perché il gesto dell'utente arrivi fino all'API.
      requestPermission: () => requestCapturePermissionVia(sendMessage),
      revokePermission: () => revokeCapturePermissionVia(sendMessage),
    });

    if (!choice) {
      feedback.stop();
      return;
    }

    feedback.start();
    // Le scelte diventano i valori predefiniti della volta successiva: il
    // dialogo è ora l'unico punto in cui si impostano, quindi deve ricordarle.
    await preferences.save({
      lastScope: choice.scope,
      lastFormat: choice.format,
      documentTitle: choice.documentTitle,
      ...choice.options,
    });

    // «Scegli i turni…» non esporta: apre la modalità di selezione e
    // restituisce il controllo alla pagina.
    if (isDeferredScope(choice.scope)) {
      selection.enable();
      feedback.stop();
      toaster.show(
        'Clicca i messaggi da esportare, poi premi di nuovo 📄. Esc per annullare.',
        'info'
      );
      return;
    }

    const succeeded = await runExport(
      /** @type {import('../../core/usecases/export-conversation.js').ExportRequest} */ ({
        scope: choice.scope,
        format: choice.format,
        turnElement,
      })
    );

    if (succeeded) feedback.succeed();
    else feedback.stop();
  };
}

/**
 * Esporta i turni indicati durante la modalità di selezione.
 *
 * @param {object} params
 * @param {{ start: () => void, succeed: () => void, stop: () => void }} params.feedback
 * @param {import('./turn-selection.js').TurnSelection} params.selection
 * @param {ReturnType<typeof createPreferencesStore>} params.preferences
 * @param {(request: object) => Promise<boolean>} params.runExport
 * @returns {Promise<boolean>} false se non c'era alcun turno selezionato.
 */
async function exportSelection({ feedback, selection, preferences, runExport }) {
  const turnElements = selection.selected();

  // Selezione vuota: non c'è nulla da esportare, e il chiamante decide come
  // proseguire. Restituire `false` invece di mostrare un avviso mantiene qui
  // la sola responsabilità dell'esportazione.
  if (turnElements.length === 0) return false;

  feedback.start();
  const preferred = await preferences.load();

  const succeeded = await runExport(
    /** @type {import('../../core/usecases/export-conversation.js').ExportRequest} */ ({
      scope: 'selection',
      format: preferred.lastFormat,
      turnElements,
    })
  );

  // La modalità si chiude in ogni caso: lasciarla attiva dopo un errore
  // intrappolerebbe l'utente in uno stato da cui non sa come uscire.
  selection.disable();

  if (succeeded) feedback.succeed();
  else feedback.stop();
  return true;
}

/**
 * Estrae dalle preferenze le sole opzioni di contenuto.
 *
 * Il dialogo non deve ricevere l'intero oggetto delle preferenze: gli servono
 * le chiavi che sa mostrare, e restituire il resto lo esporrebbe a modificare
 * impostazioni che non gli competono.
 *
 * @param {import('../../shared/config.js').Preferences} preferences
 * @returns {Record<string, boolean>}
 */
function pickDocumentOptions(preferences) {
  return Object.fromEntries(documentOptionIds().map((id) => [id, preferences[id] === true]));
}

/**
 * Assembla il caso d'uso di esportazione con tutte le sue collaborazioni.
 *
 * @param {import('../../shared/logger.js').Logger} logger
 * @param {ReturnType<typeof createPreferencesStore>} preferences
 * @returns {ReturnType<typeof createExportConversationUseCase>}
 */
function createExporter(logger, preferences) {
  return createExportConversationUseCase({
    source: createGeminiSource({ logger, captureEmbeddedApps: true }),
    pipelines: createPipelines(logger),
    getPreferences: () => preferences.load(),
    logger,
    embedImages: composeEnrichment([
      // Ogni fase è subordinata alla propria opzione: disattivarla non deve
      // costare né una richiesta di rete né uno scorrimento della pagina.
      { when: 'includeCharts', phase: createAppCaptureEmbedder(logger) },
      { when: 'includeImages', phase: createImageEmbedder(logger) },
    ]),
  });
}

export function bootstrap() {
  const logger = createLogger();
  const preferences = createPreferencesStore();

  // Il livello di log viene allineato alle preferenze appena disponibili.
  preferences.load().then((values) => logger.setLevel(values.logLevel));

  const exportConversation = createExporter(logger, preferences);

  const toaster = createToaster();

  /**
   * Esegue l'export e traduce l'esito in un messaggio per l'utente.
   * @param {import('../../core/usecases/export-conversation.js').ExportRequest} request
   */
  async function runExport(request) {
    let result;
    try {
      result = await exportConversation(request);
    } finally {
      // I marcatori applicati al DOM vivo per ritrovare i grafici vanno tolti
      // in ogni caso: lasciarli li farebbe accumulare a ogni esportazione.
      clearLiveMarkers(document);
    }

    if (result.ok === true) {
      toaster.show(...describeOutcome(result.value));
      return true;
    }

    const { error } = /** @type {{ ok: false, error: ExportError }} */ (result);

    // Il messaggio è già comprensibile e specifico per il codice di errore.
    const isRecoverable = error.code === ErrorCode.POPUP_BLOCKED;
    toaster.show(error.userMessage, isRecoverable ? 'info' : 'error');
    return false;
  }

  const selection = createTurnSelection({
    onChange: (count) => {
      if (count > 0) toaster.show(`${count} selezionati — premi 📄 per esportare`, 'info');
    },
  });

  const promptAndExport = createPrompt({ preferences, runExport, selection, toaster });

  const injector = createButtonInjector({
    onActivate: (feedback, turnElement) => promptAndExport(turnElement, feedback),
    logger,
  });

  const watcher = createResponseWatcher({
    onTurnReady: (turnElement) => injector.injectInto(turnElement),
    logger,
  });

  watcher.start();
  observeRouteChanges(() => watcher.refresh());
  listenForPopupRequests(runExport, preferences, logger);

  logger.info(`v${APP.version} caricata.`);
}

/**
 * Gemini è una single page application: cambiando chat l'URL cambia senza
 * ricaricare la pagina. Sostituisce il vecchio polling ogni 3 secondi.
 * @param {() => void} onChange
 */
function observeRouteChanges(onChange) {
  let lastUrl = location.href;

  const check = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    onChange();
  };

  window.addEventListener('popstate', check);
  // I cambi di rotta programmatici di Angular non emettono popstate.
  const originalPushState = history.pushState;
  history.pushState = function patchedPushState(...args) {
    originalPushState.apply(this, args);
    check();
  };
}

/**
 * Riceve le richieste inviate dal popup tramite il service worker.
 * @param {(request: any) => Promise<boolean>} runExport
 * @param {ReturnType<typeof createPreferencesStore>} preferences
 * @param {ReturnType<typeof createLogger>} logger
 */
function listenForPopupRequests(runExport, preferences, logger) {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.runtime?.onMessage) return;

  api.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'gex:export-active-chat') return;

    // Le preferenze possono essere state modificate dal popup poco prima.
    preferences.invalidate();
    preferences.load().then((values) => {
      logger.setLevel(values.logLevel);
      // Il pulsante del popup dichiara già "Esporta tutta la conversazione":
      // chiedere di nuovo l'ambito in un dialogo sarebbe ridondante.
      runExport({ scope: 'conversation', format: values.lastFormat });
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
