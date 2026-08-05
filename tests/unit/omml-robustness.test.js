/**
 * Robustezza del convertitore su input arbitrari.
 *
 * PERCHÉ QUESTO FILE ESISTE
 * -------------------------
 * I test basati su fixture verificano le formule di *un* documento reale: sono
 * utili ma insufficienti, perché garantiscono che quel documento funzioni, non
 * che funzioni il prossimo. Ogni conversazione con Gemini produce LaTeX diverso,
 * e i difetti più costosi sono emersi proprio su costrutti che nessuna fixture
 * conteneva.
 *
 * Qui si verificano le **invarianti**, cioè le proprietà che devono valere per
 * qualunque input, incluso quello malformato:
 *
 *   1. nessuna eccezione — una formula imperfetta è meglio di un export fallito;
 *   2. nessun elemento OMML vuoto — Word scarta il paragrafo che lo contiene;
 *   3. XML sempre bilanciato;
 *   4. font matematico dichiarato su ogni run — senza, Word mostra «EQUAZIONE»
 *      e riflowa il documento dopo l'apertura.
 *
 * Il fuzzing usa un seme fisso: ogni fallimento è riproducibile.
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { latexToOmml } from '../../src/export/docx/latex/omml.js';
import { validateOmml } from '../helpers/ooxml-validator.js';

/** Elementi contenitore che Word rifiuta se vuoti. */
const EMPTY_SLOT_PATTERN =
  /<m:(e|sub|sup|deg|num|den|lim)\/>|<m:(e|sub|sup|deg|num|den|lim)><\/m:\2>/;

/**
 * Verifica tutte le invarianti su una formula.
 * @param {string} latex
 * @returns {string[]} Violazioni riscontrate; vuoto se conforme.
 */
function checkInvariants(latex) {
  const problems = [];
  let xml;

  try {
    xml = latexToOmml(latex);
  } catch (error) {
    return [`eccezione: ${error.message}`];
  }

  if (EMPTY_SLOT_PATTERN.test(xml)) problems.push('elemento OMML vuoto');

  const opening = (xml.match(/<m:[a-zA-Z]+(?![^>]*\/>)[^>]*>/g) ?? []).length;
  const closing = (xml.match(/<\/m:[a-zA-Z]+>/g) ?? []).length;
  if (opening !== closing) problems.push('XML sbilanciato');

  const runs = (xml.match(/<m:r>/g) ?? []).length;
  const fonts = (xml.match(/<w:rFonts /g) ?? []).length;
  if (runs !== fonts) problems.push(`font mancante su ${runs - fonts} run`);

  return problems;
}

/** Generatore deterministico: un fallimento è sempre riproducibile. */
function createDeterministicRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const COMMANDS = [
  '\\frac',
  '\\sqrt',
  '\\sum',
  '\\int',
  '\\lim',
  '\\mathbf',
  '\\text',
  '\\begin{pmatrix}',
  '\\left(',
  '\\overbrace',
  '\\underset',
  '\\binom',
  '\\overline',
  '\\comandoIgnoto',
  '\\begin{cases}',
  '\\begin{aligned}',
];

const ATOMS = [
  'x',
  '1',
  '\\alpha',
  '&',
  '\\\\',
  '^',
  '_',
  '{',
  '}',
  '[',
  ']',
  '\\end{pmatrix}',
  '\\right)',
  '%',
  '#',
  '~',
  '{}',
  '\\pi',
];

/**
 * Genera una formula LaTeX casuale, spesso malformata.
 * @param {() => number} random
 * @returns {string}
 */
function randomLatex(random) {
  const length = 1 + Math.floor(random() * 16);
  let latex = '';

  for (let index = 0; index < length; index += 1) {
    const pool = random() < 0.4 ? COMMANDS : ATOMS;
    latex += pool[Math.floor(random() * pool.length)];
  }
  return latex;
}

describe('formule di domini non rappresentati nelle fixture', () => {
  const FORMULAS = {
    'finanza (Black-Scholes)': 'C = S_0 N(d_1) - K e^{-rT} N(d_2)',
    'biologia (logistica)': '\\frac{dN}{dt} = rN\\left(1 - \\frac{N}{K}\\right)',
    logica: '\\forall x \\in A, \\exists y : P(x) \\Rightarrow Q(y)',
    trigonometria: '\\cos^2\\theta + \\sin^2\\theta = 1',
    combinatoria: '\\binom{n}{k} = \\frac{n!}{k!(n-k)!}',
    'limite notevole': '\\lim_{n \\to \\infty} \\left(1+\\frac{1}{n}\\right)^n = e',
    'teoria degli insiemi': 'A \\cup B \\subseteq C \\setminus D',
    'determinante 3x3': '\\begin{vmatrix} 1 & 2 & 3 \\\\ 4 & 5 & 6 \\\\ 7 & 8 & 9 \\end{vmatrix}',
    'derivate di ordine alto': '\\frac{d^3y}{dx^3} + \\ddot{q} - \\dot{p} = 0',
    'prodotto di Eulero': '\\prod_{p} \\frac{1}{1-p^{-s}}',
    'radice n-esima': '\\sqrt[n]{x^m} = x^{m/n}',
    'notazione bra-ket': '\\langle \\psi | \\hat{H} | \\psi \\rangle',
    'allineamento a tre righe': '\\begin{aligned} a &= 1 \\\\ b &= 2 \\\\ c &= 3 \\end{aligned}',
    'casi multipli': '\\begin{cases} a & x<0 \\\\ b & x=0 \\\\ c & x>0 \\end{cases}',
  };

  it.each(Object.entries(FORMULAS))('rispetta le invarianti: %s', (_name, latex) => {
    expect(checkInvariants(latex)).toEqual([]);
  });

  it.each(Object.entries(FORMULAS))('produce OMML conforme: %s', (_name, latex) => {
    expect(validateOmml(latexToOmml(latex))).toEqual([]);
  });
});

describe('costrutti degeneri', () => {
  // Un gruppo vuoto `{}` è LaTeX legittimo e Gemini lo produce (`\Vert{}`).
  // Ogni slot che lo riceve resterebbe vuoto senza protezione sistematica.
  const DEGENERATE = [
    '\\frac{}{}',
    '\\sqrt{}',
    'x^{}',
    'x_{}',
    '\\lim_{}',
    '\\underbrace{}',
    '\\overline{}',
    '\\binom{}{}',
    '\\mathbf{}',
    '\\text{}',
    '\\begin{pmatrix}\\end{pmatrix}',
    '\\begin{cases}\\end{cases}',
    '\\left(\\right)',
    '{}',
    '',
  ];

  it.each(DEGENERATE)('gestisce senza slot vuoti: %s', (latex) => {
    expect(checkInvariants(latex)).toEqual([]);
  });
});

describe('input malformati', () => {
  const MALFORMED = [
    '\\frac{a}',
    '\\begin{pmatrix} a',
    '\\left( x',
    '{{{{{',
    '}}}}}',
    '\\sqrt[',
    'x^',
    '_',
    '&&&',
    '\\\\\\\\',
    '\\comandoInesistente{x}',
    '\\begin{ambienteIgnoto} a \\end{ambienteIgnoto}',
    '\\text{parentesi } { non chiusa',
  ];

  it.each(MALFORMED)('non solleva eccezioni né produce XML rotto: %s', (latex) => {
    expect(checkInvariants(latex)).toEqual([]);
  });
});

describe('fuzzing su LaTeX generato', () => {
  it('mantiene le invarianti su 5000 formule casuali', () => {
    const random = createDeterministicRandom(20260725);
    const failures = [];

    for (let attempt = 0; attempt < 5000; attempt += 1) {
      const latex = randomLatex(random);
      const problems = checkInvariants(latex);
      if (problems.length > 0) failures.push({ latex, problems });
    }

    // In caso di fallimento il messaggio mostra l'input esatto da riprodurre.
    expect(failures.slice(0, 5)).toEqual([]);
  });
});

describe('font matematico su qualunque contenuto', () => {
  /**
   * La dichiarazione di Cambria Math su ogni run è ciò che permette a Word di
   * impaginare le equazioni durante il caricamento. Se anche un solo run ne
   * fosse privo, Word mostrerebbe «EQUAZIONE» e ricalcolerebbe le altezze a
   * documento aperto, spingendo il testo fuori pagina.
   * Vedi docs/BUGFIX-DOCX-EQUAZIONE-REFLOW.md.
   */
  it('dichiara il font su ogni run, per 3000 formule casuali', () => {
    const random = createDeterministicRandom(99991);
    const failures = [];
    let totalRuns = 0;

    for (let attempt = 0; attempt < 3000; attempt += 1) {
      const latex = randomLatex(random);
      const xml = latexToOmml(latex);

      const runs = (xml.match(/<m:r>/g) ?? []).length;
      const fonts = (xml.match(/<w:rFonts /g) ?? []).length;
      totalRuns += runs;

      if (runs !== fonts) failures.push({ latex, runs, fonts });
    }

    expect(totalRuns).toBeGreaterThan(1000);
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('dichiara il font anche negli slot di riempimento', () => {
    // EMPTY_SLOT è generato a parte: era l'unico run che sfuggiva.
    const xml = latexToOmml('\\sqrt{}');

    expect((xml.match(/<m:r>/g) ?? []).length).toBe((xml.match(/<w:rFonts /g) ?? []).length);
  });

  it('definisce il font in un solo punto dell\u2019intero sorgente', async () => {
    // Tre copie duplicate della stessa stringa hanno già causato una
    // regressione quando una sola di esse è stata aggiornata. Il controllo
    // copre tutti i moduli, non solo quello che la ospita oggi.
    const modules = [
      'src/export/docx/latex/omml.js',
      'src/export/docx/latex/omml-primitives.js',
      'src/export/docx/html-to-ooxml.js',
      'src/export/docx/docx.renderer.js',
    ];

    const occurrences = await Promise.all(
      modules.map(
        async (path) => (await readFile(path, 'utf-8')).match(/w:ascii="Cambria Math"/g) ?? []
      )
    );

    expect(occurrences.flat().length).toBe(1);
  });
});

describe('caratteri compatibili con il font matematico', () => {
  /**
   * Cambria Math non contiene gli spazi tipografici Unicode (U+2003 em space,
   * U+2009 thin space, …). Un carattere assente dal font impedisce a Word di
   * comporre il run: l'equazione resta bloccata sul segnaposto «[Equazione]».
   * Vedi docs/BUGFIX-DOCX-SPAZI-UNICODE.md.
   */
  const RISKY_CODEPOINT = (codePoint) =>
    (codePoint >= 0x2000 && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202f) ||
    (codePoint >= 0x205f && codePoint <= 0x206f);

  /** @param {string} xml */
  const riskyCharacters = (xml) => {
    const text = [...xml.matchAll(/<m:t[^>]*>([^<]*)</g)].map((match) => match[1]).join('');
    return [...new Set(text)].filter((char) => RISKY_CODEPOINT(char.codePointAt(0)));
  };

  it.each([
    ['\\quad', 'a \\quad b'],
    ['\\qquad', 'a \\qquad b'],
    ['\\,', 'f(x) \\, dx'],
    ['\\:', 'a \\: b'],
    ['\\;', 'a \\; b'],
    ['\\enspace', 'a \\enspace b'],
    ['\\thinspace', 'a \\thinspace b'],
  ])('non emette spazi Unicode esotici per %s', (_name, latex) => {
    expect(riskyCharacters(latexToOmml(latex))).toEqual([]);
  });

  it('non emette spazi esotici su 2000 formule casuali', () => {
    const random = createDeterministicRandom(31337);
    const failures = [];

    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const latex = randomLatex(random);
      const risky = riskyCharacters(latexToOmml(latex));
      if (risky.length > 0) failures.push({ latex, risky });
    }

    expect(failures.slice(0, 5)).toEqual([]);
  });
});

describe('allineamento delle formule in blocco', () => {
  it('dichiara esplicitamente l\u2019allineamento a sinistra', () => {
    // Il valore predefinito di <m:oMathPara> è "centerGroup": senza <m:jc>
    // le formule appaiono spostate verso destra.
    const xml = latexToOmml('x = 1', { block: true });

    expect(xml).toContain('<m:oMathParaPr>');
    expect(xml).toContain('<m:jc m:val="left"/>');
  });

  it('non aggiunge oMathPara alle formule inline', () => {
    expect(latexToOmml('x')).not.toContain('oMathPara');
  });
});
