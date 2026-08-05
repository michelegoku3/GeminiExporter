/**
 * Test della diagnostica sugli asset.
 *
 * Contesto: quando un foglio di stile non veniva caricato, il documento veniva
 * generato ugualmente, senza font e senza alcun avviso. L'utente scopriva il
 * problema solo guardando il PDF, e non aveva modo di distinguere un difetto di
 * installazione da un difetto dell'estensione.
 * Vedi docs/BUGFIX-KATEX-DELIMITERS.md.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAssetLoader } from '../../src/render/asset-loader.js';
import { createHtmlDocumentRenderer } from '../../src/render/html-document.renderer.js';
import {
  createConversation,
  createTurn,
  createMessage,
} from '../../src/core/model/conversation.js';
import { sanitizeElement } from '../../src/gemini/sanitize/html-sanitizer.js';
import { createLogger } from '../../src/shared/logger.js';

const silentLogger = createLogger({ level: 'silent' });

/** Conversazione minima per il rendering. */
function sampleConversation() {
  const root = document.createElement('div');
  root.innerHTML = '<p>Contenuto</p>';

  return createConversation({
    title: 'Test',
    turns: [
      createTurn(
        createMessage({ role: 'user', text: 'Domanda' }),
        createMessage({ role: 'model', text: 'Contenuto', html: sanitizeElement(root) })
      ),
    ],
    source: { app: 'gemini', url: '' },
  });
}

/**
 * Loader con esito controllabile per singolo asset.
 * @param {(path: string) => { ok: boolean, body?: string }} behaviour
 * @param {object} [logger]
 */
function loaderWith(behaviour, logger = silentLogger) {
  return createAssetLoader({
    fetchFn: async (path) => {
      const result = behaviour(path);
      if (!result.ok) throw new Error('rete non disponibile');
      return { ok: true, text: async () => result.body ?? `/* ${path} */ .x{}` };
    },
    resolveUrl: (path) => path,
    logger,
  });
}

describe('rilevamento degli asset mancanti', () => {
  it('segnala integrità completa quando tutto si carica', async () => {
    const styles = await loaderWith(() => ({ ok: true })).loadStyles();

    expect(styles.integrity.ok).toBe(true);
    expect(styles.integrity.missing).toEqual([]);
  });

  it('elenca gli asset che non si sono caricati', async () => {
    const styles = await loaderWith((path) => ({ ok: !path.includes('katex-fonts') })).loadStyles();

    expect(styles.integrity.ok).toBe(false);
    expect(styles.integrity.missing).toEqual(['assets/styles/katex-fonts.css']);
  });

  it('considera mancante anche un asset che risponde vuoto', async () => {
    // Un file vuoto è indistinguibile da un fallimento: va trattato come tale.
    const styles = await loaderWith((path) => ({
      ok: true,
      body: path.includes('document') ? '   ' : '.x{}',
    })).loadStyles();

    expect(styles.integrity.missing).toContain('assets/styles/document.css');
  });

  it('registra un errore nei log, non un semplice avviso', async () => {
    const error = vi.fn();
    const logger = { ...silentLogger, error, warn: vi.fn() };

    await loaderWith((path) => ({ ok: !path.includes('katex.min') }), logger).loadStyles();

    expect(error).toHaveBeenCalled();
  });
});

describe('diagnostica degli asset', () => {
  /**
   * Gli avvisi sugli asset mancanti restano nel log e non nel documento:
   * sono informazione per chi sviluppa, non per chi legge. Un riquadro giallo
   * in testa a ogni copia esportata sarebbe rumore permanente, e l'utente non
   * può comunque installare i font mancanti.
   */
  it('non stampa alcun avviso nel documento quando tutto è a posto', async () => {
    const renderer = createHtmlDocumentRenderer({ assetLoader: loaderWith(() => ({ ok: true })) });
    const html = await renderer.render(sampleConversation());

    expect(html).not.toContain('gex-warning');
    expect(html).not.toContain('Formattazione ridotta');
  });

  it('non stampa alcun avviso nemmeno con gli asset mancanti', async () => {
    const renderer = createHtmlDocumentRenderer({
      assetLoader: loaderWith((path) => ({ ok: !path.includes('katex-fonts') })),
    });
    const html = await renderer.render(sampleConversation());

    expect(html).not.toContain('gex-warning');
    expect(html).not.toContain('Formattazione ridotta');
  });

  it('la verifica dei font segnala in console, non nel documento', async () => {
    const renderer = createHtmlDocumentRenderer({ assetLoader: loaderWith(() => ({ ok: true })) });
    const html = await renderer.render(sampleConversation());

    expect(html).toContain('console.warn');
    expect(html).not.toContain('gex-font-warning');
  });

  it('include la verifica automatica dei font nel documento', async () => {
    const renderer = createHtmlDocumentRenderer({ assetLoader: loaderWith(() => ({ ok: true })) });
    const html = await renderer.render(sampleConversation());

    // Controlla i font realmente applicabili, non solo il CSS presente.
    expect(html).toContain('document.fonts');
    expect(html).toContain('KaTeX_Size4');
    expect(html).toContain('getBoundingClientRect');
  });

  it('il documento resta utilizzabile anche con gli asset mancanti', async () => {
    const renderer = createHtmlDocumentRenderer({ assetLoader: loaderWith(() => ({ ok: false })) });
    const html = await renderer.render(sampleConversation());

    // Degrado controllato: il contenuto c'è comunque.
    expect(html).toContain('Contenuto');
    expect(html).toContain('Salva come PDF');
  });
});
