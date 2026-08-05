/**
 * Test di regressione sulla resa delle formule matematiche.
 *
 * Contesto: la pipeline di pulizia eliminava gli span di geometria di KaTeX
 * perché privi di testo, facendo collassare frazioni, integrali e matrici nel
 * PDF esportato. Vedi docs/BUGFIX-KATEX.md.
 *
 * Questi test lavorano su frammenti catturati dal DOM reale di Gemini.
 */

import { describe, it, expect } from 'vitest';
import { removeNoise } from '../../src/gemini/sanitize/noise-removal.js';
import { normalizeMath } from '../../src/gemini/sanitize/katex.js';
import {
  removeEmptyContainers,
  flattenSingleParagraphListItems,
} from '../../src/gemini/sanitize/structure.js';
import { sanitizeElement, unwrap } from '../../src/gemini/sanitize/html-sanitizer.js';
import {
  KATEX_INLINE_FRACTION,
  KATEX_DISPLAY_INTEGRAL,
  KATEX_DISPLAY_MATRIX,
} from '../fixtures/katex-real.js';

/**
 * Esegue l'intera pipeline di pulizia, nello stesso ordine dell'estrattore.
 * @param {string} html
 * @returns {string} HTML sanificato.
 */
function runPipeline(html) {
  const root = document.createElement('div');
  root.innerHTML = html;

  removeNoise(root, unwrap);
  normalizeMath(root);
  flattenSingleParagraphListItems(root, unwrap);
  removeEmptyContainers(root);

  return sanitizeElement(root).value;
}

/**
 * Conta le occorrenze di un pattern.
 * @param {string} html
 * @param {RegExp} pattern
 */
const count = (html, pattern) => (html.match(pattern) ?? []).length;

/** Elementi di geometria che devono sopravvivere alla pulizia. */
const GEOMETRY = [
  ['strut', /class="strut"/g],
  ['pstrut', /pstrut/g],
  ['mspace', /mspace/g],
  ['vlist', /vlist/g],
];

describe.each([
  ['frazione inline', KATEX_INLINE_FRACTION],
  ['integrale display', KATEX_DISPLAY_INTEGRAL],
  ['matrice display', KATEX_DISPLAY_MATRIX],
])('preservazione della formula: %s', (_name, fixture) => {
  it('conserva tutti gli span di geometria, anche se privi di testo', () => {
    const output = runPipeline(fixture);

    for (const [label, pattern] of GEOMETRY) {
      const before = count(fixture, pattern);
      const after = count(output, pattern);
      if (before > 0) {
        expect(after, `${label}: ${before} → ${after}`).toBe(before);
      }
    }
  });

  it('conserva gli stili inline che posizionano i simboli', () => {
    const output = runPipeline(fixture);

    // Gli `style` inline contengono height, top e margin calcolati da KaTeX:
    // senza di essi la formula perde l'allineamento verticale.
    expect(count(output, /style="/g)).toBe(count(fixture, /style="/g));
    expect(output).toMatch(/height:\s*[\d.]+em/);
  });

  it('mantiene la resa visiva e rimuove il MathML per screen reader', () => {
    const output = runPipeline(fixture);

    expect(output).toContain('katex-html');
    expect(output).not.toContain('katex-mathml');
  });

  it('non altera il numero di elementi della formula', () => {
    const source = document.createElement('div');
    source.innerHTML = fixture;
    const expected = source.querySelectorAll('.katex *').length;

    const result = document.createElement('div');
    result.innerHTML = runPipeline(fixture);

    expect(result.querySelectorAll('.katex *').length).toBe(expected);
  });
});

describe('removeEmptyContainers', () => {
  it('continua a rimuovere i contenitori vuoti fuori dalle formule', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>testo</p><div class="residuo"></div><span></span>';

    removeEmptyContainers(root);

    expect(root.querySelector('.residuo')).toBeNull();
    expect(root.querySelector('span')).toBeNull();
    expect(root.textContent).toContain('testo');
  });

  it('non entra nei sottoalberi di layout come .katex e svg', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<span class="katex"><span class="base"><span class="strut"></span></span></span>' +
      '<div class="vuoto"></div>';

    removeEmptyContainers(root);

    expect(root.querySelector('.strut')).not.toBeNull();
    expect(root.querySelector('.base')).not.toBeNull();
    expect(root.querySelector('.vuoto')).toBeNull();
  });
});

describe('allowlist del sanitizer per la matematica', () => {
  it('non rimuove le classi usate dal layout di KaTeX', () => {
    const output = runPipeline(KATEX_DISPLAY_MATRIX);

    for (const className of ['vlist-t', 'vlist-r', 'mord', 'delimsizing', 'mopen']) {
      expect(output, `classe ${className} mancante`).toContain(className);
    }
  });
});
