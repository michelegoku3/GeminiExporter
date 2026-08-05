/**
 * Test del caso d'uso: verifica l'orchestrazione e la gestione degli errori,
 * con tutte le collaborazioni sostituite da test double.
 */

import { describe, it, expect, vi } from 'vitest';
import { createExportConversationUseCase } from '../../src/core/usecases/export-conversation.js';
import {
  createConversation,
  createTurn,
  createMessage,
} from '../../src/core/model/conversation.js';
import { sanitizeElement } from '../../src/gemini/sanitize/html-sanitizer.js';
import { ExportError, ErrorCode } from '../../src/shared/errors.js';
import { ok, err } from '../../src/shared/result.js';
import { createLogger } from '../../src/shared/logger.js';
import { DEFAULT_PREFERENCES } from '../../src/shared/config.js';

const logger = createLogger({ level: 'silent' });

function safeHtml(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return sanitizeElement(container);
}

function sampleConversation(text = 'Come funziona la fotosintesi?') {
  return createConversation({
    title: 'Gemini Chat',
    turns: [
      createTurn(
        createMessage({ role: 'user', text }),
        createMessage({ role: 'model', text: 'Risposta', html: safeHtml('<p>Risposta</p>') })
      ),
    ],
    source: { app: 'gemini', url: '' },
  });
}

/** Costruisce il caso d'uso con i doppi di test. */
function buildUseCase(overrides = {}) {
  const source = {
    extractTurn: vi.fn(() => ok(sampleConversation())),
    extractConversation: vi.fn(() => ok(sampleConversation())),
    ...overrides.source,
  };
  const renderer = { render: vi.fn(async () => '<html>doc</html>'), ...overrides.renderer };
  const sink = { deliver: vi.fn(async () => ({ method: 'tab' })), ...overrides.sink };

  const useCase = createExportConversationUseCase({
    source,
    pipelines: { pdf: { renderer, sink } },
    getPreferences: async () => DEFAULT_PREFERENCES,
    logger,
  });

  return { useCase, source, renderer, sink };
}

describe('exportConversation', () => {
  it('esporta un singolo turno passando dal renderer e dal sink', async () => {
    const { useCase, source, renderer, sink } = buildUseCase();
    const turnElement = document.createElement('div');

    const result = await useCase({ scope: 'turn', turnElement });

    expect(result.ok).toBe(true);
    expect(result.value.method).toBe('tab');
    expect(source.extractTurn).toHaveBeenCalledWith(turnElement, { title: 'Gemini Chat' });
    // Il terzo argomento è il tipo di file, valorizzato solo dai formati
    // scaricabili: per il PDF resta undefined.
    expect(sink.deliver).toHaveBeenCalledWith(expect.any(Function), expect.any(String), undefined);

    // Il rendering è differito: avviene quando il sink lo richiede, così il
    // canale di consegna può scegliere le opzioni del documento.
    expect(renderer.render).not.toHaveBeenCalled();
    const html = await sink.deliver.mock.calls[0][0]();
    expect(html).toBe('<html>doc</html>');
    expect(renderer.render).toHaveBeenCalledOnce();
  });

  it('usa il testo dell\u2019utente per suggerire il nome del file', async () => {
    const { useCase, sink } = buildUseCase();

    await useCase({ scope: 'turn', turnElement: document.createElement('div') });

    // Il punto interrogativo è vietato nei nomi file su Windows: viene rimosso.
    expect(sink.deliver.mock.calls[0][1]).toBe('Come funziona la fotosintesi');
  });

  it('esporta l\u2019intera conversazione quando richiesto', async () => {
    const { useCase, source } = buildUseCase();

    const result = await useCase({ scope: 'conversation' });

    expect(result.ok).toBe(true);
    expect(source.extractConversation).toHaveBeenCalledOnce();
    expect(source.extractTurn).not.toHaveBeenCalled();
  });

  it('propaga l\u2019errore di estrazione senza renderizzare nulla', async () => {
    const { useCase, renderer } = buildUseCase({
      source: { extractTurn: () => err(ExportError.selectorNotFound('responseContent')) },
    });

    const result = await useCase({ scope: 'turn', turnElement: document.createElement('div') });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(ErrorCode.SELECTOR_NOT_FOUND);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('rifiuta una conversazione priva di contenuto', async () => {
    const emptyConversation = createConversation({
      title: 'Vuota',
      turns: [
        createTurn(
          createMessage({ role: 'user', text: 'ciao' }),
          createMessage({ role: 'model', text: '' })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });

    const { useCase } = buildUseCase({ source: { extractTurn: () => ok(emptyConversation) } });

    const result = await useCase({ scope: 'turn', turnElement: document.createElement('div') });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(ErrorCode.EMPTY_RESPONSE);
  });

  it('riporta il metodo di consegna alternativo quando il popup è bloccato', async () => {
    const { useCase } = buildUseCase({ sink: { deliver: async () => ({ method: 'download' }) } });

    const result = await useCase({ scope: 'conversation' });

    expect(result.ok).toBe(true);
    expect(result.value.method).toBe('download');
  });

  it('converte un\u2019eccezione imprevista in un errore gestito', async () => {
    const { useCase } = buildUseCase({
      renderer: {
        render: async () => {
          throw new TypeError('boom');
        },
      },
      // Il sink deve invocare il renderer perché l'errore emerga.
      sink: {
        deliver: async (renderDocument) => ({ method: 'tab', html: await renderDocument() }),
      },
    });

    const result = await useCase({ scope: 'conversation' });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(ErrorCode.UNEXPECTED);
    expect(result.error.userMessage).toBeTruthy();
  });
});

describe('titolo del documento', () => {
  /**
   * Un campo lasciato vuoto non è una scelta: produrrebbe un documento con
   * l'intestazione in bianco. La normalizzazione vive nel caso d'uso perché
   * vale per tutti i chiamanti, non solo per il dialogo.
   */
  function useCaseCapturingTitle(documentTitle) {
    const captured = {};
    const useCase = createExportConversationUseCase({
      source: {
        extractTurn: (_element, { title }) => {
          captured.title = title;
          return ok(sampleConversation());
        },
        extractConversation: () => ok(sampleConversation()),
        extractSelection: () => ok(sampleConversation()),
      },
      pipelines: {
        pdf: {
          renderer: { render: async () => '<html></html>' },
          sink: { deliver: async () => ({ method: 'tab' }) },
        },
      },
      getPreferences: async () => ({ ...DEFAULT_PREFERENCES, documentTitle }),
      logger: createLogger({ level: 'silent' }),
    });
    return { useCase, captured };
  }

  it('usa il titolo scelto dall\u2019utente', async () => {
    const { useCase, captured } = useCaseCapturingTitle('Studio di funzione');

    await useCase({ scope: 'turn', turnElement: {} });

    expect(captured.title).toBe('Studio di funzione');
  });

  it('ricade sul predefinito quando il campo è vuoto', async () => {
    const { useCase, captured } = useCaseCapturingTitle('');

    await useCase({ scope: 'turn', turnElement: {} });

    expect(captured.title).toBe(DEFAULT_PREFERENCES.documentTitle);
  });

  it('ricade sul predefinito quando il campo contiene solo spazi', async () => {
    const { useCase, captured } = useCaseCapturingTitle('   ');

    await useCase({ scope: 'turn', turnElement: {} });

    expect(captured.title).toBe(DEFAULT_PREFERENCES.documentTitle);
  });

  it('rimuove gli spazi ai bordi del titolo', async () => {
    const { useCase, captured } = useCaseCapturingTitle('  Analisi  ');

    await useCase({ scope: 'turn', turnElement: {} });

    expect(captured.title).toBe('Analisi');
  });
});

describe('nome del file esportato', () => {
  /**
   * Il nome del file deve seguire il titolo scelto: era il difetto per cui un
   * titolo personalizzato compariva dentro il documento ma non sul file, che
   * conservava le prime parole del primo messaggio.
   */
  function useCaseCapturingFilename(documentTitle) {
    const captured = {};
    const useCase = createExportConversationUseCase({
      source: {
        extractTurn: (_element, { title }) => ok(conversationTitled(title)),
        extractConversation: () => ok(sampleConversation()),
        extractSelection: () => ok(sampleConversation()),
      },
      pipelines: {
        pdf: {
          renderer: { render: async () => '<html></html>' },
          sink: {
            deliver: async (_render, filename) => {
              captured.filename = filename;
              return { method: 'tab' };
            },
          },
        },
      },
      getPreferences: async () => ({ ...DEFAULT_PREFERENCES, documentTitle }),
      logger: createLogger({ level: 'silent' }),
    });
    return { useCase, captured };
  }

  /** @param {string} title */
  function conversationTitled(title) {
    return createConversation({
      title,
      turns: [
        createTurn(
          createMessage({ role: 'user', text: 'domanda molto lunga dell utente' }),
          createMessage({ role: 'model', text: 'risposta' })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });
  }

  it('usa il titolo scelto come nome del file', async () => {
    const { useCase, captured } = useCaseCapturingFilename('Report Dashboard');

    await useCase({ scope: 'turn', turnElement: {} });

    expect(captured.filename).toBe('Report Dashboard');
  });

  it('ricade sul primo messaggio quando il titolo è quello predefinito', async () => {
    // Il titolo predefinito è uguale per tutte le conversazioni: come nome di
    // file non ne distinguerebbe una dall'altra.
    const { useCase, captured } = useCaseCapturingFilename(DEFAULT_PREFERENCES.documentTitle);

    await useCase({ scope: 'turn', turnElement: {} });

    expect(captured.filename).toBe('domanda molto lunga dell utente');
  });

  it('usa il titolo anche quando il campo aveva spazi ai bordi', async () => {
    const { useCase, captured } = useCaseCapturingFilename('  Analisi Q3  ');

    await useCase({ scope: 'turn', turnElement: {} });

    expect(captured.filename).toBe('Analisi Q3');
  });
});
