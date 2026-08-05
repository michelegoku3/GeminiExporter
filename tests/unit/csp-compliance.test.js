/**
 * Test di conformità alla Content Security Policy.
 *
 * Contesto: il documento veniva aperto come `blob:` creato dal content script,
 * e in quanto tale ereditava la CSP di gemini.google.com. Google vieta
 * `font-src data:`, quindi i venti font KaTeX incorporati venivano bloccati e
 * le formule perdevano delimitatori e simboli speciali.
 * Vedi docs/BUGFIX-CSP-BLOB.md.
 *
 * Questi test presidiano le tre condizioni che rendono il documento immune:
 * consegna da una pagina dell'estensione, CSP dichiarata nel manifest, assenza
 * di codice inline quando il contesto non lo consente.
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createPrintTabSink } from '../../src/export/print-tab.sink.js';
import { createLogger } from '../../src/shared/logger.js';

const logger = createLogger({ level: 'silent' });

/** jsdom non implementa le object URL. */
const objectUrls = { createObjectURL: () => 'blob:fittizio', revokeObjectURL: () => {} };

/**
 * Finto ambiente estensione con storage in memoria.
 * @param {object} [options]
 */
function fakeBrowserApi({ storageFails = false } = {}) {
  const store = new Map();
  return {
    store,
    api: {
      storage: {
        local: {
          set: async (entries) => {
            if (storageFails) throw new Error('quota superata');
            Object.entries(entries).forEach(([k, v]) => store.set(k, v));
          },
          remove: async (key) => void store.delete(key),
          get: async (key) => (store.has(key) ? { [key]: store.get(key) } : {}),
        },
      },
      runtime: { getURL: (path) => `chrome-extension://abc/${path}` },
    },
  };
}

describe('consegna tramite pagina dell\u2019estensione', () => {
  it('apre il viewer dell\u2019estensione, non un URL blob', async () => {
    const { api } = fakeBrowserApi();
    const opened = [];

    const sink = createPrintTabSink({
      window: { open: (url) => (opened.push(url), {}), setTimeout: () => 0 },
      document,
      browserApi: api,
      objectUrls,
      logger,
    });

    const outcome = await sink.deliver(async () => '<html>doc</html>', 'prova');

    expect(outcome.method).toBe('extension-page');
    expect(opened[0]).toContain('chrome-extension://');
    expect(opened[0]).toContain('viewer.html');
    // Un blob erediterebbe la CSP di Gemini e bloccherebbe i font.
    expect(opened[0]).not.toContain('blob:');
  });

  it('rende il documento SENZA script inline per la pagina dell\u2019estensione', async () => {
    const { api } = fakeBrowserApi();
    const received = [];

    const sink = createPrintTabSink({
      window: { open: () => ({}), setTimeout: () => 0 },
      document,
      browserApi: api,
      objectUrls,
      logger,
    });

    await sink.deliver(async (options) => {
      received.push(options);
      return '<html>doc</html>';
    }, 'prova');

    expect(received[0]).toEqual({ inlineBehaviour: false });
  });

  it('passa il documento tramite storage, non tramite URL', async () => {
    const { api, store } = fakeBrowserApi();
    const opened = [];

    const sink = createPrintTabSink({
      window: { open: (url) => (opened.push(url), {}), setTimeout: () => 0 },
      document,
      browserApi: api,
      objectUrls,
      logger,
    });

    await sink.deliver(async () => '<html>documento molto grande</html>', 'prova');

    // Con i font incorporati il documento supera i 600 KB: non può stare in un URL.
    expect(opened[0].length).toBeLessThan(300);
    expect([...store.values()][0]).toContain('documento molto grande');
  });

  it('non lascia documenti orfani nello storage se il popup è bloccato', async () => {
    const { api, store } = fakeBrowserApi();

    const sink = createPrintTabSink({
      window: { open: () => null, setTimeout: () => 0 },
      document: {
        createElement: () => ({ style: {}, remove() {}, click() {} }),
        body: { appendChild() {} },
      },
      browserApi: api,
      objectUrls,
      logger,
    });

    await sink.deliver(async () => '<html>doc</html>', 'prova');

    expect(store.size).toBe(0);
  });

  it('ricade sul blob se lo storage non è utilizzabile', async () => {
    const { api } = fakeBrowserApi({ storageFails: true });

    const sink = createPrintTabSink({
      window: { open: () => ({}), setTimeout: () => 0 },
      document,
      browserApi: api,
      objectUrls,
      logger,
    });

    const outcome = await sink.deliver(async () => '<html>doc</html>', 'prova');

    // Degrado controllato: meglio un documento soggetto alla CSP che nessuno.
    expect(outcome.method).toBe('tab');
  });

  it('include lo script inline nel file scaricato, che ne ha bisogno', async () => {
    const received = [];
    const sink = createPrintTabSink({
      window: { open: () => null, setTimeout: () => 0 },
      document: {
        createElement: () => ({ style: {}, remove() {}, click() {} }),
        body: { appendChild() {} },
      },
      browserApi: undefined,
      objectUrls,
      logger,
    });

    await sink.deliver(async (options) => {
      received.push(options);
      return '<html>doc</html>';
    }, 'prova');

    expect(received[0]).toEqual({ inlineBehaviour: true });
  });
});

describe('manifest', () => {
  it('dichiara una CSP che consente i font incorporati', async () => {
    const manifest = JSON.parse(await readFile('manifest.json', 'utf-8'));
    const policy = manifest.content_security_policy?.extension_pages ?? '';

    // È la direttiva che la CSP di Google negava.
    expect(policy).toContain('font-src');
    expect(policy).toMatch(/font-src[^;]*data:/);
    expect(policy).toContain("script-src 'self'");
  });

  it('rende accessibile la pagina del viewer', async () => {
    const manifest = JSON.parse(await readFile('manifest.json', 'utf-8'));
    const resources = manifest.web_accessible_resources[0].resources;

    expect(resources.some((pattern) => pattern.includes('viewer'))).toBe(true);
  });

  it('mantiene la stessa configurazione per Firefox', async () => {
    const firefox = JSON.parse(await readFile('manifest.firefox.json', 'utf-8'));
    const policy = firefox.content_security_policy?.extension_pages ?? '';

    expect(policy).toMatch(/font-src[^;]*data:/);
  });
});

describe('assenza di codice inline nel viewer', () => {
  it('la pagina del viewer non contiene script inline', async () => {
    const html = await readFile('src/extension/viewer/viewer.html', 'utf-8');

    // I commenti vanno esclusi: possono citare la parola "script".
    const markup = html.replace(/<!--[\s\S]*?-->/g, '');

    // Solo <script src="...">: un blocco inline verrebbe bloccato dalla CSP.
    const inlineScripts = markup.match(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/g);
    expect(inlineScripts).toBeNull();
    expect(markup).toContain('<script type="module" src="viewer.js">');
  });

  it('il comportamento del documento è un modulo condiviso, non duplicato', async () => {
    const source = await readFile('src/render/document-behaviour.js', 'utf-8');

    // Un'unica definizione, serializzata per i contesti senza moduli:
    // evita che i due percorsi divergano nel tempo.
    expect(source).toContain('export function applyDocumentBehaviour');
    expect(source).toContain('applyDocumentBehaviour.toString()');
  });
});
