/**
 * Test del permesso richiesto dalla cattura dei grafici.
 *
 * Il punto delicato è che Chrome **non conserva** la stringa `<all_urls>`: la
 * normalizza in pattern equivalenti. Verificare il letterale produce un falso
 * negativo — permesso concesso, controllo fallito — che si manifesta come un
 * messaggio che invita a concedere un permesso già concesso.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  hasCapturePermission,
  requestCapturePermission,
  revokeCapturePermission,
  requestCapturePermissionState,
} from '../../src/extension/platform/capture-permission.js';

/**
 * Installa una finta API `chrome.permissions`.
 * @param {object} api
 */
function withPermissionsApi(api) {
  globalThis.chrome = /** @type {any} */ ({ permissions: api });
}

afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.browser;
});

describe('rilevamento del permesso di cattura', () => {
  // Ogni forma osservata in cui Chrome riporta un permesso universale.
  it.each([
    ['<all_urls>', ['<all_urls>']],
    ['*://*/*', ['*://*/*']],
    ['coppia http/https', ['http://*/*', 'https://*/*']],
    ['insieme ad altre origini', ['https://gemini.google.com/*', '*://*/*']],
  ])('riconosce il permesso concesso nella forma %s', async (_label, origins) => {
    withPermissionsApi({ getAll: async () => ({ origins }) });

    await expect(hasCapturePermission()).resolves.toBe(true);
  });

  it('non lo riconosce se è concesso solo il dominio di Gemini', async () => {
    // È la situazione di partenza: `captureVisibleTab` rifiuta comunque, quindi
    // segnalarla come concessa porterebbe a scorrere la pagina per nulla.
    withPermissionsApi({ getAll: async () => ({ origins: ['https://gemini.google.com/*'] }) });

    await expect(hasCapturePermission()).resolves.toBe(false);
  });

  it('non usa contains(), che darebbe un falso negativo', async () => {
    // `contains({origins:['<all_urls>']})` risponde false quando il browser ha
    // normalizzato il pattern: è la causa esatta del difetto.
    const contains = vi.fn(async () => false);
    withPermissionsApi({ contains, getAll: async () => ({ origins: ['*://*/*'] }) });

    await expect(hasCapturePermission()).resolves.toBe(true);
    expect(contains).not.toHaveBeenCalled();
  });

  it('risponde false quando non c\u2019è alcuna origine', async () => {
    withPermissionsApi({ getAll: async () => ({ origins: [] }) });

    await expect(hasCapturePermission()).resolves.toBe(false);
  });

  it('risponde false fuori da un contesto estensione', async () => {
    await expect(hasCapturePermission()).resolves.toBe(false);
  });

  it('non propaga gli errori della piattaforma', async () => {
    withPermissionsApi({
      getAll: async () => {
        throw new Error('API non disponibile');
      },
    });

    await expect(hasCapturePermission()).resolves.toBe(false);
  });
});

describe('richiesta del permesso', () => {
  it('considera concesso il permesso normalizzato dal browser', async () => {
    // `request()` può restituire un valore inaffidabile: conta lo stato reale.
    withPermissionsApi({
      request: vi.fn(async () => false),
      getAll: async () => ({ origins: ['*://*/*'] }),
    });

    await expect(requestCapturePermission()).resolves.toBe(true);
  });

  it('richiede la forma dichiarata in optional_host_permissions', async () => {
    const request = vi.fn(async () => true);
    withPermissionsApi({ request, getAll: async () => ({ origins: ['*://*/*'] }) });

    await requestCapturePermission();

    expect(request).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
  });

  it('riporta il rifiuto dell\u2019utente', async () => {
    withPermissionsApi({
      request: vi.fn(async () => false),
      getAll: async () => ({ origins: [] }),
    });

    await expect(requestCapturePermission()).resolves.toBe(false);
  });
});

describe('revoca del permesso', () => {
  it('rimuove tutte le forme equivalenti', async () => {
    // La forma registrata dipende dalla normalizzazione: rimuoverne una sola
    // lascerebbe il permesso attivo.
    const remove = vi.fn(async () => true);
    withPermissionsApi({ remove, getAll: async () => ({ origins: [] }) });

    await revokeCapturePermission();

    const { origins } = remove.mock.calls[0][0];
    expect(origins).toEqual(expect.arrayContaining(['<all_urls>', '*://*/*']));
  });

  it('conferma la revoca solo se il permesso non risulta più concesso', async () => {
    withPermissionsApi({
      remove: vi.fn(async () => true),
      getAll: async () => ({ origins: ['*://*/*'] }),
    });

    await expect(revokeCapturePermission()).resolves.toBe(false);
  });
});

describe('verifica dal content script', () => {
  /**
   * `chrome.permissions` non è esposta ai content script: invocarla lì trova
   * `undefined` e restituisce sempre "non concesso", anche con il permesso
   * attivo. La verifica deve quindi passare dal service worker.
   */
  it('non interroga direttamente l\u2019API dei permessi', async () => {
    // Nessun `chrome.permissions`: è la situazione reale di un content script.
    const sendMessage = vi.fn(async () => ({ granted: true }));

    await expect(requestCapturePermissionState(sendMessage)).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'gex:can-capture' });
  });

  it('riporta il diniego del service worker', async () => {
    const sendMessage = vi.fn(async () => ({ granted: false }));

    await expect(requestCapturePermissionState(sendMessage)).resolves.toBe(false);
  });

  it('non propaga gli errori del canale di messaggistica', async () => {
    // Se il service worker è stato sospeso il messaggio può fallire: vale come
    // "non concesso", e l'esportazione prosegue senza i grafici.
    const sendMessage = vi.fn(async () => {
      throw new Error('canale chiuso');
    });

    await expect(requestCapturePermissionState(sendMessage)).resolves.toBe(false);
  });

  it('tratta una risposta assente come diniego', async () => {
    const sendMessage = vi.fn(async () => undefined);

    await expect(requestCapturePermissionState(sendMessage)).resolves.toBe(false);
  });

  it('la verifica diretta fallisce senza chrome.permissions', async () => {
    // Documenta la ragione dell'indirezione: è esattamente ciò che accadeva
    // invocando hasCapturePermission() da un content script.
    await expect(hasCapturePermission()).resolves.toBe(false);
  });
});
