/**
 * Test dei registry di ambiti e formati.
 *
 * Sono la sorgente unica da cui si costruisce il dialogo: un'incoerenza qui si
 * propaga silenziosamente nella UI. I test presidiano anche il confine fra
 * "voce mostrata come futura" e "voce realmente esportabile".
 */

import { describe, it, expect, vi } from 'vitest';
import {
  EXPORT_FORMATS,
  listFormats,
  isFormatAvailable,
  DEFAULT_FORMAT_ID,
} from '../../src/shared/export-formats.js';
import {
  isDeferredScope,
  EXPORT_SCOPES,
  listScopes,
  DEFAULT_SCOPE_ID,
} from '../../src/shared/export-scopes.js';
import { createExportConversationUseCase } from '../../src/core/usecases/export-conversation.js';
import {
  createConversation,
  createTurn,
  createMessage,
} from '../../src/core/model/conversation.js';
import { sanitizeElement } from '../../src/gemini/sanitize/html-sanitizer.js';
import { ErrorCode } from '../../src/shared/errors.js';
import { ok } from '../../src/shared/result.js';
import { createLogger } from '../../src/shared/logger.js';
import { DEFAULT_PREFERENCES } from '../../src/shared/config.js';

describe('registry dei formati e degli ambiti', () => {
  it('ogni voce ha identificatore, etichetta e descrizione', () => {
    for (const entry of [...listFormats(), ...listScopes()]) {
      expect(entry.id).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(typeof entry.available).toBe('boolean');
    }
  });

  it('la chiave del registry coincide con l\u2019identificatore', () => {
    for (const [key, entry] of Object.entries({ ...EXPORT_FORMATS, ...EXPORT_SCOPES })) {
      expect(entry.id).toBe(key);
    }
  });

  it('i valori predefiniti sono disponibili', () => {
    expect(isFormatAvailable(DEFAULT_FORMAT_ID)).toBe(true);
    expect(EXPORT_SCOPES[DEFAULT_SCOPE_ID].available).toBe(true);
  });

  it('PDF e Word sono disponibili, gli altri sono annunciati come futuri', () => {
    expect(isFormatAvailable('pdf')).toBe(true);
    expect(isFormatAvailable('word')).toBe(true);
    expect(isFormatAvailable('html')).toBe(false);
    expect(isFormatAvailable('sconosciuto')).toBe(false);
  });

  it('le etichette non contengono puntini di sospensione', () => {
    // I puntini suggerivano un secondo dialogo; la modalità si apre invece
    // sulla pagina stessa.
    for (const scope of Object.values(EXPORT_SCOPES)) {
      expect(scope.label, scope.id).not.toContain('\u2026');
    }
  });

  it('la selezione manuale dei turni è disponibile e differita', () => {
    // `deferred` distingue gli ambiti che non producono subito un documento:
    // la conferma avvia una fase di scelta sulla pagina.
    expect(EXPORT_SCOPES.selection.available).toBe(true);
    expect(isDeferredScope('selection')).toBe(true);
  });

  it('gli altri ambiti esportano immediatamente', () => {
    expect(isDeferredScope('turn')).toBe(false);
    expect(isDeferredScope('conversation')).toBe(false);
  });
});

describe('validazione del formato nel caso d\u2019uso', () => {
  const logger = createLogger({ level: 'silent' });

  function buildUseCase() {
    const root = document.createElement('div');
    root.innerHTML = '<p>Risposta</p>';

    const conversation = createConversation({
      title: 'Test',
      turns: [
        createTurn(
          createMessage({ role: 'user', text: 'Domanda' }),
          createMessage({ role: 'model', text: 'Risposta', html: sanitizeElement(root) })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });

    const renderer = { render: vi.fn(async () => '<html>doc</html>') };
    const sink = { deliver: vi.fn(async () => ({ method: 'extension-page' })) };

    const useCase = createExportConversationUseCase({
      source: {
        extractTurn: () => ok(conversation),
        extractConversation: () => ok(conversation),
      },
      pipelines: { pdf: { renderer, sink } },
      getPreferences: async () => DEFAULT_PREFERENCES,
      logger,
    });

    return { useCase, renderer, sink };
  }

  it('accetta il formato PDF', async () => {
    const { useCase } = buildUseCase();
    const result = await useCase({ scope: 'conversation', format: 'pdf' });

    expect(result.ok).toBe(true);
  });

  it('accetta una richiesta senza formato esplicito', async () => {
    const { useCase } = buildUseCase();
    const result = await useCase({ scope: 'conversation' });

    expect(result.ok).toBe(true);
  });

  it('rifiuta un formato non disponibile senza avviare il rendering', async () => {
    const { useCase, renderer, sink } = buildUseCase();
    const result = await useCase({ scope: 'conversation', format: 'html' });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(ErrorCode.UNSUPPORTED_FORMAT);
    expect(result.error.userMessage).toContain('PDF');
    // Nessun lavoro inutile: il rifiuto avviene prima di tutto il resto.
    expect(renderer.render).not.toHaveBeenCalled();
    expect(sink.deliver).not.toHaveBeenCalled();
  });
});

describe('opzioni di contenuto applicate all\u2019esportazione', () => {
  /**
   * Le fasi che arricchiscono il documento hanno effetti collaterali costosi:
   * la cattura scorre la pagina, il recupero delle immagini fa richieste di
   * rete. Un'opzione disattivata deve impedirli, non solo scartare il risultato.
   */
  function enrichmentSpy() {
    const calls = [];
    /** @param {string} name */
    const phase = (name) => async (conversation) => {
      calls.push(name);
      return { conversation };
    };
    return { calls, phase };
  }

  /**
   * Riproduce la composizione usata nella composition root.
   * @param {Array<{ when: string, phase: Function }>} phases
   */
  function compose(phases) {
    return async function enrich(conversation, options = {}) {
      let current = conversation;
      for (const { when, phase } of phases) {
        if (options[when] !== true) continue;
        current = (await phase(current)).conversation;
      }
      return { conversation: current };
    };
  }

  it('salta le fasi la cui opzione è disattivata', async () => {
    const { calls, phase } = enrichmentSpy();
    const enrich = compose([
      { when: 'includeCharts', phase: phase('grafici') },
      { when: 'includeImages', phase: phase('immagini') },
    ]);

    await enrich({}, { includeCharts: false, includeImages: true });

    expect(calls).toEqual(['immagini']);
  });

  it('esegue le fasi nell\u2019ordine dichiarato', async () => {
    // Le catture producono data URI che la fase successiva incorpora: invertire
    // l'ordine lascerebbe i grafici fuori dal documento.
    const { calls, phase } = enrichmentSpy();
    const enrich = compose([
      { when: 'includeCharts', phase: phase('grafici') },
      { when: 'includeImages', phase: phase('immagini') },
    ]);

    await enrich({}, { includeCharts: true, includeImages: true });

    expect(calls).toEqual(['grafici', 'immagini']);
  });

  it('non esegue nulla quando ogni opzione è disattivata', async () => {
    const { calls, phase } = enrichmentSpy();
    const enrich = compose([{ when: 'includeImages', phase: phase('immagini') }]);

    await enrich({}, {});

    expect(calls).toEqual([]);
  });
});
