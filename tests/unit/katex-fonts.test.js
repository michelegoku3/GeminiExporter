/**
 * Test di regressione sui font e sugli SVG delle formule.
 *
 * Contesto: i delimitatori grandi (parentesi graffe, tonde, quadre) e i segni
 * di radice venivano resi come rettangoli vuoti, perché i font KaTeX_Size1-4
 * non venivano caricati e perché gli SVG perdevano l'attributo `viewBox`.
 * Vedi docs/BUGFIX-KATEX-FONTS.md.
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { sanitizeElement } from '../../src/gemini/sanitize/html-sanitizer.js';
import { createAssetLoader } from '../../src/render/asset-loader.js';
import { createHtmlDocumentRenderer } from '../../src/render/html-document.renderer.js';
import {
  createConversation,
  createTurn,
  createMessage,
} from '../../src/core/model/conversation.js';
import { createLogger } from '../../src/shared/logger.js';
import { ASSET_PATH } from '../../src/shared/config.js';

const logger = createLogger({ level: 'silent' });

/** Carica gli asset veri dal disco. */
const assetLoader = createAssetLoader({
  fetchFn: async (path) => ({ ok: true, text: () => readFile(path, 'utf-8') }),
  resolveUrl: (path) => path,
  logger,
});

/** @param {string} html */
function sanitize(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return sanitizeElement(root).value;
}

describe('foglio dei font KaTeX', () => {
  it('dichiara tutte e quattro le famiglie dei delimitatori estensibili', async () => {
    const css = await readFile(ASSET_PATH.katexFontsCss, 'utf-8');

    // Size1-4 contengono parentesi graffe/tonde grandi e segni di radice:
    // sono i font la cui assenza produce i rettangoli vuoti.
    for (const size of [1, 2, 3, 4]) {
      expect(css, `KaTeX_Size${size} mancante`).toContain(`font-family:KaTeX_Size${size}`);
    }
  });

  it('dichiara tutte le venti varianti usate da KaTeX', async () => {
    const css = await readFile(ASSET_PATH.katexFontsCss, 'utf-8');
    expect((css.match(/@font-face/g) ?? []).length).toBe(20);
  });

  it('incorpora i font come data URI, senza riferimenti remoti', async () => {
    const css = await readFile(ASSET_PATH.katexFontsCss, 'utf-8');

    expect(css).toContain('url(data:font/woff2;base64,');
    expect(css).not.toContain('http://');
    expect(css).not.toContain('https://');
  });

  it('usa font-display:block per non stampare prima del caricamento', async () => {
    const css = await readFile(ASSET_PATH.katexFontsCss, 'utf-8');
    expect(css).toContain('font-display:block');
  });

  it('il foglio di layout non reintroduce @font-face remote', async () => {
    const css = await readFile(ASSET_PATH.katexCss, 'utf-8');

    expect(css).not.toContain('@font-face');
    expect(css).not.toContain('cdn.jsdelivr.net');
  });
});

describe('SVG delle formule (radici e delimitatori)', () => {
  /** Frammento reale prodotto da KaTeX per il segno di radice. */
  const SQRT_SVG =
    '<span class="hide-tail" style="height:1.08em;min-width:0.853em">' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="400em" height="1.08em" ' +
    'viewBox="0 0 400000 1080" preserveAspectRatio="xMinYMin slice">' +
    '<path d="M95 622c-2.7 0-7.17.41-10.1 8.4"></path></svg></span>';

  it('conserva viewBox con la grafia camelCase richiesta dall\u2019SVG', () => {
    const output = sanitize(SQRT_SVG);

    // Un `viewbox` minuscolo verrebbe ignorato: l'SVG resterebbe invisibile.
    expect(output).toContain('viewBox="0 0 400000 1080"');
    expect(output).not.toContain('viewbox=');
  });

  it('conserva preserveAspectRatio con la grafia corretta', () => {
    const output = sanitize(SQRT_SVG);

    expect(output).toContain('preserveAspectRatio="xMinYMin slice"');
    expect(output).not.toContain('preserveaspectratio=');
  });

  it('conserva il tracciato e le dimensioni del disegno', () => {
    const output = sanitize(SQRT_SVG);

    expect(output).toContain('<path');
    expect(output).toContain('d="M95 622c-2.7 0-7.17.41-10.1 8.4"');
    expect(output).toContain('width="400em"');
  });

  it('conserva gli attributi di tratto usati dai delimitatori', () => {
    const output = sanitize(
      '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" fill="none">' +
        '<path d="M1 1" stroke-linecap="round"></path></svg>'
    );

    expect(output).toContain('stroke-width="2"');
    expect(output).toContain('stroke-linecap="round"');
    expect(output).toContain('stroke-linejoin="round"');
  });

  it('continua a rimuovere gli attributi pericolosi dagli SVG', () => {
    const output = sanitize(
      '<svg viewBox="0 0 10 10" onload="alert(1)"><path d="M1 1" onclick="x()"></path></svg>'
    );

    expect(output).toContain('viewBox');
    expect(output).not.toContain('onload');
    expect(output).not.toContain('onclick');
  });
});

describe('documento esportato', () => {
  /** @returns {import('../../src/core/model/conversation.js').Conversation} */
  function conversationWithFormula() {
    const root = document.createElement('div');
    root.innerHTML = '<p>Formula</p>';

    return createConversation({
      title: 'Test',
      turns: [
        createTurn(
          createMessage({ role: 'user', text: 'Domanda' }),
          createMessage({ role: 'model', text: 'Formula', html: sanitizeElement(root) })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });
  }

  it('incorpora i font: il PDF è leggibile offline e dopo il salvataggio', async () => {
    const renderer = createHtmlDocumentRenderer({ assetLoader });
    const html = await renderer.render(conversationWithFormula());

    expect(html).toContain('font-family:KaTeX_Size4');
    expect(html).toContain('url(data:font/woff2;base64,');
  });

  it('non contiene alcun riferimento a risorse remote', async () => {
    const renderer = createHtmlDocumentRenderer({ assetLoader });
    const html = await renderer.render(conversationWithFormula());

    expect(html).not.toContain('cdn.jsdelivr.net');
    expect(html).not.toContain('@import');
  });
});
