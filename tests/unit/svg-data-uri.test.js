/**
 * Test degli SVG trasportati come data URI.
 *
 * Contesto: KaTeX disegna radici, graffe orizzontali e frecce con un tracciato
 * SVG, che Gemini incapsula in `<img src="data:image/svg+xml;utf8,…">`.
 * Il sanitizer scartava quella `src`, cancellando i simboli dal PDF.
 * Vedi docs/BUGFIX-KATEX-SVG-DATAURI.md.
 *
 * Questi test coprono due esigenze in tensione fra loro: il tracciato deve
 * sopravvivere, il codice eseguibile no.
 */

import { describe, it, expect } from 'vitest';
import {
  isSvgDataUri,
  isRasterDataUri,
  sanitizeSvgDataUri,
} from '../../src/gemini/sanitize/svg-data-uri.js';
import { sanitizeElement } from '../../src/gemini/sanitize/html-sanitizer.js';

/** Data URI reale prodotto da Gemini per il segno di radice. */
const REAL_SQRT_URI =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400em" ' +
  'height="1.08em" viewBox="0 0 400000 1080" preserveAspectRatio="xMinYMin slice">' +
  '<path d="M95,702c-2.7,0,-7.17,-2.7,-13.5,-8c-5.8,-5.3,-9.5,-10,-9.5,-14"/></svg>';

/**
 * Decodifica il payload di un data URI SVG per poterlo ispezionare.
 * @param {string|null} uri
 */
function decodePayload(uri) {
  if (!uri) return '';
  return decodeURIComponent(uri.replace(/^data:image\/svg\+xml,/, ''));
}

/** @param {string} html */
function sanitizeHtml(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return sanitizeElement(root).value;
}

describe('riconoscimento dei data URI', () => {
  it('riconosce la forma ";utf8" usata da Gemini', () => {
    // Parametro non standard, ma è esattamente ciò che KaTeX emette.
    expect(isSvgDataUri(REAL_SQRT_URI)).toBe(true);
  });

  it('riconosce le altre forme diffuse', () => {
    expect(isSvgDataUri('data:image/svg+xml,<svg/>')).toBe(true);
    expect(isSvgDataUri('data:image/svg+xml;charset=utf-8,<svg/>')).toBe(true);
    expect(isSvgDataUri('data:image/svg+xml;base64,PHN2Zy8+')).toBe(true);
  });

  it('distingue gli SVG dalle immagini raster', () => {
    expect(isRasterDataUri('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isRasterDataUri(REAL_SQRT_URI)).toBe(false);
    expect(isSvgDataUri('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
  });
});

describe('sanitizzazione del payload SVG', () => {
  it('conserva tracciato, viewBox e proporzioni del segno di radice', () => {
    const payload = decodePayload(sanitizeSvgDataUri(REAL_SQRT_URI));

    expect(payload).toContain('<path');
    expect(payload).toContain('viewBox="0 0 400000 1080"');
    expect(payload).toContain('preserveAspectRatio="xMinYMin slice"');
    expect(payload).toContain('width="400em"');
  });

  it('mantiene la grafia camelCase richiesta dall\u2019SVG', () => {
    const payload = decodePayload(sanitizeSvgDataUri(REAL_SQRT_URI));

    // Un `viewbox` minuscolo verrebbe ignorato e il disegno sparirebbe.
    expect(payload).not.toContain('viewbox=');
    expect(payload).not.toContain('preserveaspectratio=');
  });

  it('rimuove script e gestori di eventi dal payload', () => {
    const hostile =
      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" ' +
      'onload="window.__pwned=1"><script>window.__pwned=1</' +
      'script><path d="M1 1" onclick="steal()"/></svg>';

    const payload = decodePayload(sanitizeSvgDataUri(hostile));

    expect(payload).not.toContain('onload');
    expect(payload).not.toContain('onclick');
    expect(payload).not.toContain('script');
    expect(payload).not.toContain('__pwned');
    // Il contenuto legittimo resta.
    expect(payload).toContain('<path');
  });

  it('rimuove i riferimenti navigabili, vettore di javascript:', () => {
    const hostile =
      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<a href="javascript:alert(1)"><path d="M1 1"/></a></svg>';

    const payload = decodePayload(sanitizeSvgDataUri(hostile));

    expect(payload).not.toContain('javascript:');
    expect(payload).not.toContain('href');
  });

  it('scarta i payload privi di contenuto disegnabile', () => {
    const empty = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(sanitizeSvgDataUri(empty)).toBeNull();
  });

  it('scarta i payload malformati invece di indovinarne il contenuto', () => {
    const broken = 'data:image/svg+xml;utf8,<svg><path d="M1 1"</svg>';
    expect(sanitizeSvgDataUri(broken)).toBeNull();
  });

  it('gestisce anche il payload codificato in base64', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 1"/></svg>';
    const uri = `data:image/svg+xml;base64,${btoa(svg)}`;

    const payload = decodePayload(sanitizeSvgDataUri(uri));

    expect(payload).toContain('<path');
    expect(payload).toContain('viewBox');
  });
});

describe('integrazione con il sanitizer HTML', () => {
  it('conserva l\u2019immagine del simbolo dentro il markup della formula', () => {
    const output = sanitizeHtml(
      `<span class="hide-tail"><img class="katex-svg" src='${REAL_SQRT_URI}'></span>`
    );

    expect(output).toContain('katex-svg');
    expect(output).toContain('src="data:image/svg+xml,');
    expect(decodePayload(output.match(/src="([^"]+)"/)[1])).toContain('<path');
  });

  it('rimuove la src se il payload non è recuperabile', () => {
    const output = sanitizeHtml(
      `<img class="katex-svg" src="data:image/svg+xml;utf8,<svg><script>x()</` + `script></svg>">`
    );

    expect(output).not.toContain('script');
    expect(output).not.toContain('src="data:');
  });

  it('continua ad accettare le immagini raster in base64', () => {
    const output = sanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="ok">');
    expect(output).toContain('data:image/png;base64');
  });

  it('continua a rifiutare i data URI non immagine', () => {
    const output = sanitizeHtml('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="ko">');
    expect(output).not.toContain('data:text/html');
  });
});
