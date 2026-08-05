/**
 * Test di integrazione dell'intera catena: DOM di Gemini → documento stampabile.
 *
 * È la verifica di non-regressione che protegge le funzionalità elencate in
 * docs/ANALYSIS.md: se una di queste asserzioni cade, l'estensione ha perso una
 * capacità che aveva nella versione 1.3.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createGeminiSource } from '../../src/gemini/gemini-source.js';
import { createHtmlDocumentRenderer } from '../../src/render/html-document.renderer.js';
import { createPrintTabSink } from '../../src/export/print-tab.sink.js';
import { createExportConversationUseCase } from '../../src/core/usecases/export-conversation.js';
import { createAssetLoader } from '../../src/render/asset-loader.js';
import { createLogger } from '../../src/shared/logger.js';
import { DEFAULT_PREFERENCES } from '../../src/shared/config.js';
import {
  conversationTurn,
  RESPONSE_WITH_CODE,
  RESPONSE_WITH_KATEX,
  MALICIOUS_RESPONSE,
  USER_WITH_ATTACHMENTS,
} from '../fixtures/gemini-dom.js';

const logger = createLogger({ level: 'silent' });

/** Legge gli asset veri dal disco: verifica anche che i percorsi siano corretti. */
const assetLoader = createAssetLoader({
  fetchFn: async (path) => ({
    ok: true,
    text: () => readFile(path, 'utf-8'),
  }),
  resolveUrl: (path) => path,
  logger,
});

/** Cattura il documento consegnato, al posto di aprire una scheda. */
function captureSink() {
  const captured = { html: null, filename: null };
  const sink = {
    // Il sink riceve una funzione di rendering, non una stringa: è il canale
    // di consegna a decidere le opzioni del documento.
    deliver: async (renderDocument, filename) => {
      captured.html = await renderDocument({ inlineBehaviour: true });
      captured.filename = filename;
      return { method: 'tab' };
    },
  };
  return { sink, captured };
}

/**
 * @param {string} bodyHtml
 * @param {object} [preferences]
 */
async function exportPage(bodyHtml, preferences = {}) {
  document.body.innerHTML = bodyHtml;
  const { sink, captured } = captureSink();

  const useCase = createExportConversationUseCase({
    source: createGeminiSource({ logger, document }),
    pipelines: { pdf: { renderer: createHtmlDocumentRenderer({ assetLoader }), sink } },
    getPreferences: async () => ({ ...DEFAULT_PREFERENCES, ...preferences }),
    logger,
  });

  const result = await useCase({ scope: 'conversation' });
  return { result, ...captured };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('catena completa di esportazione', () => {
  it('produce un documento stampabile a partire dal DOM di Gemini', async () => {
    const { result, html, filename } = await exportPage(conversationTurn());

    expect(result.ok).toBe(true);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Risposta di prova');
    expect(html).toContain('Ciao Gemini');
    expect(filename).toBe('Ciao Gemini');
  });

  it('incorpora i fogli di stile reali, incluso KaTeX', async () => {
    const { html } = await exportPage(conversationTurn());

    // Il documento deve funzionare offline, senza richieste di rete.
    expect(html).toContain('.katex');
    expect(html).toContain('.print-toolbar');
    expect(html).toContain('@media print');
    expect(html.length).toBeGreaterThan(20000);
  });

  it('preserva codice, formule e allegati in un unico export', async () => {
    const { html } = await exportPage(
      conversationTurn({
        responseHtml: RESPONSE_WITH_CODE + RESPONSE_WITH_KATEX,
        userHtml: USER_WITH_ATTACHMENTS,
      })
    );

    expect(html).toContain('def saluta():');
    expect(html).toContain('katex-html');
    expect(html).toContain('bilancio');
    expect(html).toContain('PDF');
    // La UI di Gemini non deve finire nel PDF.
    expect(html).not.toContain('Copia codice');
  });

  it('non lascia passare codice eseguibile nel documento finale', async () => {
    const { html } = await exportPage(conversationTurn({ responseHtml: MALICIOUS_RESPONSE }));

    const body = html.slice(html.indexOf('<body>'));
    expect(body).not.toContain('onerror');
    expect(body).not.toContain('<iframe');
    expect(body).not.toContain('window.__pwned');
    // Nessun gestore inline: il pulsante di stampa usa addEventListener,
    // perché la CSP delle pagine dell'estensione vieta gli attributi on*.
    expect(body.match(/onclick=/g)).toBeNull();
  });

  it('esporta più turni con i relativi separatori', async () => {
    const { result, html } = await exportPage(
      conversationTurn({ userHtml: '<div class="query-text-line">Uno</div>' }) +
        conversationTurn({ userHtml: '<div class="query-text-line">Due</div>' })
    );

    expect(result.value.turnCount).toBe(2);
    expect(html).toContain('Uno');
    expect(html).toContain('Due');
    expect(html).toContain('turn-separator');
  });
});

/** jsdom non implementa le object URL: le simuliamo. */
const objectUrls = {
  createObjectURL: () => 'blob:fittizio',
  revokeObjectURL: () => {},
};

describe('consegna del documento', () => {
  it('apre una scheda quando il browser lo consente', async () => {
    const sink = createPrintTabSink({
      window: { open: () => ({}), setTimeout: () => 0 },
      document,
      browserApi: undefined,
      objectUrls,
      logger,
    });

    const outcome = await sink.deliver(async () => '<html></html>', 'prova');
    // Senza API dell'estensione disponibili si ricade sul blob in nuova scheda.
    expect(outcome.method).toBe('tab');
  });

  it('ricade sul download quando la scheda viene bloccata', async () => {
    const clicked = [];
    const fakeDocument = {
      createElement: () => ({
        style: {},
        remove() {},
        click() {
          clicked.push(this.download);
        },
      }),
      body: { appendChild() {} },
    };

    const sink = createPrintTabSink({
      window: { open: () => null, setTimeout: () => 0 },
      document: fakeDocument,
      browserApi: undefined,
      objectUrls,
      logger,
    });

    const outcome = await sink.deliver(async () => '<html></html>', 'prova');

    expect(outcome.method).toBe('download');
    expect(clicked).toEqual(['prova.html']);
  });
});
