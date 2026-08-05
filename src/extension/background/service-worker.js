/**
 * Service worker (MV3).
 *
 * Volutamente minimale: l'esportazione avviene interamente nel content script,
 * perché ha accesso al DOM di Gemini e non richiede permessi aggiuntivi.
 * Qui restano solo le responsabilità che il content script non può assolvere:
 * inizializzare le preferenze e rispondere alle richieste del popup.
 * @module extension/background/service-worker
 */

import { DEFAULT_PREFERENCES, STORAGE_KEY, APP } from '../../shared/config.js';
import {
  hasCapturePermission,
  requestCapturePermission,
  revokeCapturePermission,
} from '../platform/capture-permission.js';

const api = globalThis.browser ?? globalThis.chrome;

/** Messaggi accettati dal service worker. */
const MessageType = Object.freeze({
  GET_VERSION: 'gex:get-version',
  EXPORT_ACTIVE_CHAT: 'gex:export-active-chat',
  CAPTURE_TAB: 'gex:capture-tab',
  CAN_CAPTURE: 'gex:can-capture',
  REQUEST_CAPTURE: 'gex:request-capture',
  REVOKE_CAPTURE: 'gex:revoke-capture',
});

api.runtime.onInstalled.addListener(async () => {
  // Scrive i default solo se assenti: un aggiornamento non deve resettare le
  // scelte dell'utente.
  const stored = await api.storage.local.get(STORAGE_KEY);
  if (!stored?.[STORAGE_KEY]) {
    await api.storage.local.set({ [STORAGE_KEY]: DEFAULT_PREFERENCES });
  }
});

/**
 * Gestori dei messaggi, uno per tipo.
 *
 * Una tabella invece di una catena di `if`: aggiungere un messaggio significa
 * aggiungere una voce, e ogni gestore resta leggibile da solo. Tutti sono
 * asincroni, quindi il listener risponde sempre in differita.
 *
 * @type {Record<string, (message: object) => Promise<object>>}
 */
const HANDLERS = Object.freeze({
  [MessageType.GET_VERSION]: async () => ({ version: APP.version }),
  [MessageType.EXPORT_ACTIVE_CHAT]: (message) => forwardToActiveTab(message),
  [MessageType.CAPTURE_TAB]: () => captureVisibleTab(),
  // `chrome.permissions` non è esposta ai content script: interrogarla e
  // modificarla compete a questo contesto, e l'esito viaggia come messaggio.
  [MessageType.CAN_CAPTURE]: async () => ({ granted: await hasCapturePermission() }),
  // Il gesto dell'utente si propaga dal content script fino a qui attraverso il
  // messaggio, quindi `permissions.request` è invocabile. Se una versione di
  // Chrome non lo riconoscesse, la richiesta fallisce e la casella torna
  // deselezionata: nessun permesso viene concesso di nascosto.
  [MessageType.REQUEST_CAPTURE]: async () => ({ granted: await requestCapturePermission() }),
  [MessageType.REVOKE_CAPTURE]: async () => ({ revoked: await revokeCapturePermission() }),
});

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;

  handler(message).then(sendResponse);
  return true; // Risposta asincrona.
});

/**
 * Fotografa la porzione visibile della scheda attiva.
 *
 * Vive qui perché `tabs.captureVisibleTab` non è invocabile da un content
 * script. È l'unico modo per trasporre i grafici interattivi di Gemini, che
 * risiedono in iframe cross-origin il cui contenuto non è altrimenti leggibile
 * (vedi docs/GRAFICI-INTERATTIVI.md).
 *
 * @returns {Promise<{ ok: true, dataUrl: string } | { ok: false, error: string }>}
 */
async function captureVisibleTab() {
  // Chrome limita le catture a MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND (2) e
  // **rigetta** le chiamate eccedenti invece di accodarle. Con più grafici, o
  // con un grafico catturato a fasce, il limite viene superato con facilità:
  // senza ritentativo la seconda cattura fallirebbe sistematicamente.
  for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt += 1) {
    try {
      // `windowId` omesso: si intende la finestra corrente, cioè quella in cui
      // l'utente ha avviato l'esportazione.
      const dataUrl = await api.tabs.captureVisibleTab({ format: 'png' });
      return { ok: true, dataUrl };
    } catch (error) {
      const isLastAttempt = attempt === CAPTURE_ATTEMPTS - 1;
      if (isLastAttempt) return { ok: false, error: String(error) };

      // L'attesa cresce a ogni tentativo: se la causa è il limite di frequenza
      // basta poco, se è un ridisegno in corso serve più tempo.
      await delay(CAPTURE_RETRY_BASE_MS * (attempt + 1));
    }
  }

  // Irraggiungibile: il ciclo esce sempre da uno dei due rami.
  return { ok: false, error: 'cattura non riuscita' };
}

/** Tentativi di cattura prima di rinunciare. */
const CAPTURE_ATTEMPTS = 3;

/** Attesa base fra due tentativi: il limite di Chrome è di 2 catture/secondo. */
const CAPTURE_RETRY_BASE_MS = 600;

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Inoltra una richiesta del popup al content script della scheda attiva.
 * @param {object} message
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function forwardToActiveTab(message) {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { ok: false, error: 'Nessuna scheda attiva.' };

    await api.tabs.sendMessage(tab.id, message);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
