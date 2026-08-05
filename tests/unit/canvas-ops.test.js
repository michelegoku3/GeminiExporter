/**
 * Test delle operazioni su canvas della cattura.
 *
 * Il punto critico è il tipo del rettangolo: `getBoundingClientRect` non
 * restituisce un oggetto semplice ma un `DOMRect`, le cui proprietà stanno sul
 * **prototipo**. Copiarlo con lo spread produce un oggetto vuoto, e le misure
 * diventano `undefined` senza che nulla segnali l'anomalia.
 */

import { describe, it, expect, vi } from 'vitest';
import { crop, stack, limitWidth } from '../../src/gemini/canvas-ops.js';

/** Finto documento: jsdom non implementa il contesto di disegno. */
function fakeDocument() {
  const created = [];
  return {
    created,
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toDataURL: () => 'data:image/png;base64,UE5H',
      };
      created.push(canvas);
      return canvas;
    },
  };
}

describe('ritaglio', () => {
  it('accetta un DOMRect vero, non solo un oggetto semplice', () => {
    // È il caso reale: `getBoundingClientRect` restituisce un DOMRect.
    const doc = fakeDocument();
    const box = new window.DOMRect(50, 100, 600, 400);

    const canvas = crop({
      document: /** @type {any} */ (doc),
      screenshot: /** @type {any} */ ({}),
      box,
      height: 400,
      ratio: 2,
    });

    expect(canvas.width).toBe(1200);
    expect(canvas.height).toBe(800);
  });

  it('rifiuta misure non numeriche invece di produrre un canvas vuoto', () => {
    // Uno spread di DOMRect lascia `width` undefined: senza questo controllo
    // il canvas avrebbe dimensione NaN e `toDataURL` restituirebbe un PNG
    // vuoto, cioè l'immagine rotta osservata nel documento.
    const doc = fakeDocument();
    const box = { ...new window.DOMRect(50, 100, 600, 400), top: 120 };

    expect(() =>
      crop({
        document: /** @type {any} */ (doc),
        screenshot: /** @type {any} */ ({}),
        box: /** @type {any} */ (box),
        height: 400,
        ratio: 2,
      })
    ).toThrow(/Dimensioni di ritaglio non valide/);
  });

  it('rifiuta un\u2019altezza nulla', () => {
    const doc = fakeDocument();

    expect(() =>
      crop({
        document: /** @type {any} */ (doc),
        screenshot: /** @type {any} */ ({}),
        box: { top: 0, left: 0, width: 600 },
        height: 0,
        ratio: 1,
      })
    ).toThrow(/Dimensioni di ritaglio non valide/);
  });

  it('riporta le misure ricevute, per rendere diagnosticabile la causa', () => {
    const doc = fakeDocument();

    expect(() =>
      crop({
        document: /** @type {any} */ (doc),
        screenshot: /** @type {any} */ ({}),
        box: /** @type {any} */ ({ top: 0 }),
        height: 400,
        ratio: 2,
      })
    ).toThrow(/box\.width=undefined/);
  });
});

describe('impilamento', () => {
  it('restituisce l\u2019unica cattura quando non c\u2019è nulla da unire', () => {
    const only = { width: 100, height: 50 };

    expect(stack(/** @type {any} */ (fakeDocument()), [/** @type {any} */ (only)])).toBe(only);
  });

  it('somma le altezze e prende la larghezza massima', () => {
    const doc = fakeDocument();
    const shots = [
      { width: 100, height: 50 },
      { width: 140, height: 70 },
    ];

    const result = stack(/** @type {any} */ (doc), /** @type {any} */ (shots));

    expect(result.width).toBe(140);
    expect(result.height).toBe(120);
  });
});

describe('limite di larghezza', () => {
  it('non tocca le catture già entro il limite', () => {
    const canvas = { width: 800, height: 600 };

    expect(limitWidth(/** @type {any} */ (fakeDocument()), /** @type {any} */ (canvas), 1240)).toBe(
      canvas
    );
  });

  it('riduce mantenendo le proporzioni', () => {
    const doc = fakeDocument();
    const canvas = { width: 2480, height: 1000 };

    const result = limitWidth(/** @type {any} */ (doc), /** @type {any} */ (canvas), 1240);

    expect(result.width).toBe(1240);
    expect(result.height).toBe(500);
  });
});
