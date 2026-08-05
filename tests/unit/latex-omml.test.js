/**
 * Test della conversione LaTeX → OMML.
 *
 * OMML è il formato matematico nativo di Word. Prima di questa conversione le
 * formule finivano nel documento come sorgente LaTeX grezzo, illeggibile.
 *
 * I casi provengono dalle formule realmente generate da Gemini in ambito
 * scientifico e ingegneristico.
 */

import { describe, it, expect } from 'vitest';
import { latexToOmml } from '../../src/export/docx/latex/omml.js';
import { parseLatex, tokenize } from '../../src/export/docx/latex/parser.js';

/**
 * Testo contenuto negli elementi `<m:t>`, per verificare i simboli prodotti.
 * @param {string} xml
 */
function textOf(xml) {
  return [...xml.matchAll(/<m:t[^>]*>([^<]*)<\/m:t>/g)].map((match) => match[1]).join('');
}

describe('tokenizzazione', () => {
  it('riconosce comandi, gruppi e operatori di posizione', () => {
    expect(tokenize('\\frac{a}{b}')).toEqual(['\\frac', '{', 'a', '}', '{', 'b', '}']);
    expect(tokenize('x^2_i')).toEqual(['x', '^', '2', '_', 'i']);
  });

  it('emette un token spazio, che il parser scarta fuori da \\text{}', () => {
    // Gli spazi servono dentro \\text{}: si conservano nel flusso di token e
    // si ignorano in fase di analisi. Gli spazi consecutivi collassano.
    expect(tokenize('a  +  b')).toEqual(['a', ' ', '+', ' ', 'b']);
    expect(parseLatex('a  +  b')).toHaveLength(3);
  });
});

describe('struttura delle formule', () => {
  it('produce un elemento oMath ben formato', () => {
    const xml = latexToOmml('x + y');

    expect(xml.startsWith('<m:oMath>')).toBe(true);
    expect(xml.endsWith('</m:oMath>')).toBe(true);
  });

  it('non centra le formule: seguono l\u2019allineamento del testo', () => {
    // La centratura è stata rimossa: sommandosi a quella del paragrafo
    // spostava le formule oltre il centro.
    const xml = latexToOmml('x = 1');

    expect(xml).not.toContain('<m:oMathPara>');
    expect(xml).not.toContain('m:jc');
  });

  it('non lascia mai slot vuoti, che i lettori rendono come quadratini', () => {
    // `\Vert{}` produce un gruppo deliberatamente vuoto.
    for (const latex of ['\\Vert{}\\mathbf{A}\\Vert{}_F', '{}^2', '\\sum x']) {
      const xml = latexToOmml(latex);
      expect(xml, latex).not.toContain('<m:e></m:e>');
      expect(xml, latex).not.toContain('<m:e/>');
    }
  });
});

describe('costrutti matematici', () => {
  it('converte le frazioni', () => {
    const xml = latexToOmml('\\frac{a}{b}');

    expect(xml).toContain('<m:f>');
    expect(xml).toContain('<m:num>');
    expect(xml).toContain('<m:den>');
  });

  it('converte le radici, nascondendo il grado nella radice quadrata', () => {
    expect(latexToOmml('\\sqrt{x}')).toContain('<m:degHide m:val="1"/>');
    expect(latexToOmml('\\sqrt[3]{x}')).toContain('<m:degHide m:val="0"/>');
  });

  it('gestisce le radici annidate', () => {
    const xml = latexToOmml('\\sqrt{1 + \\sqrt{2 + x}}');
    expect((xml.match(/<m:rad>/g) ?? []).length).toBe(2);
  });

  it('distingue apici, pedici e la loro combinazione', () => {
    expect(latexToOmml('x^2')).toContain('<m:sSup>');
    expect(latexToOmml('x_i')).toContain('<m:sSub>');
    expect(latexToOmml('x_i^2')).toContain('<m:sSubSup>');
  });

  it('usa l\u2019elemento n-ario per gli operatori grandi', () => {
    for (const latex of ['\\sum_{i=1}^{n} x_i', '\\int_0^1 f(x)', '\\prod_{k} a_k']) {
      expect(latexToOmml(latex), latex).toContain('<m:nary>');
    }
  });

  it('posiziona gli estremi sopra e sotto l\u2019operatore', () => {
    expect(latexToOmml('\\sum_{i=1}^{n} x')).toContain('<m:limLoc m:val="undOvr"/>');
  });

  it('include l\u2019operando nell\u2019operatore n-ario', () => {
    // Un operando vuoto verrebbe reso con un glifo segnaposto.
    const xml = latexToOmml('\\sum_{i=1}^{r} \\sigma_i');
    expect(xml).not.toContain('<m:e/>');
    expect(textOf(xml)).toContain('σ');
  });

  it('interrompe l\u2019operando alle relazioni', () => {
    // In `∑ x = y` l'operatore agisce su `x`, non sull'intera uguaglianza.
    const xml = latexToOmml('\\sum_{i} x_i = y');
    expect(xml.indexOf('</m:nary>')).toBeLessThan(xml.lastIndexOf('y'));
  });

  it('pone i limiti sotto il nome della funzione', () => {
    expect(latexToOmml('\\lim_{x \\to 0} f(x)')).toContain('<m:limLow>');
  });

  it('converte matrici e ambienti allineati', () => {
    const matrix = latexToOmml('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');

    expect(matrix).toContain('<m:m>');
    expect((matrix.match(/<m:mr>/g) ?? []).length).toBe(2);
    expect(matrix).toContain('<m:begChr m:val="("/>');
  });

  it('applica i delimitatori corretti a ogni ambiente matrice', () => {
    expect(latexToOmml('\\begin{bmatrix} a \\end{bmatrix}')).toContain('m:val="["');
    expect(latexToOmml('\\begin{vmatrix} a \\end{vmatrix}')).toContain('m:val="|"');
    expect(latexToOmml('\\begin{cases} a \\end{cases}')).toContain('m:val="{"');
  });

  it('gestisce i delimitatori dimensionati automaticamente', () => {
    const xml = latexToOmml('\\left( \\frac{a}{b} \\right)');

    expect(xml).toContain('<m:d>');
    expect(xml).toContain('<m:f>');
  });

  it('converte accenti e sopralinee', () => {
    expect(latexToOmml('\\dot{x}')).toContain('<m:acc>');
    expect(latexToOmml('\\overline{AB}')).toContain('<m:bar>');
    expect(latexToOmml('\\underbrace{a+b}_{s}')).toContain('<m:groupChr>');
  });

  it('converte i coefficienti binomiali', () => {
    expect(latexToOmml('\\binom{n}{k}')).toContain('<m:type m:val="noBar"/>');
  });
});

describe('simboli', () => {
  it('traduce le lettere greche in Unicode', () => {
    expect(textOf(latexToOmml('\\alpha\\beta\\Omega'))).toBe('αβΩ');
  });

  it('traduce operatori e relazioni', () => {
    expect(textOf(latexToOmml('a \\neq b \\leq c'))).toContain('≠');
    expect(textOf(latexToOmml('a \\neq b \\leq c'))).toContain('≤');
  });

  it('traduce i simboli usati in analisi vettoriale', () => {
    const text = textOf(latexToOmml('\\nabla \\cdot \\mathbf{F} \\times \\partial'));

    expect(text).toContain('∇');
    expect(text).toContain('⋅');
    expect(text).toContain('×');
    expect(text).toContain('∂');
  });

  it('scrive i nomi di funzione in tondo', () => {
    expect(latexToOmml('\\sin(x)')).toContain('<m:sty m:val="p"/>');
  });

  it('applica il grassetto ai vettori', () => {
    expect(latexToOmml('\\mathbf{v}')).toContain('<m:sty m:val="b"/>');
  });

  it('usa i caratteri degli insiemi numerici', () => {
    expect(textOf(latexToOmml('\\mathbb{R}'))).toBe('ℝ');
  });
});

describe('robustezza', () => {
  it('non solleva eccezioni sui comandi sconosciuti', () => {
    expect(() => latexToOmml('\\comandoInesistente{x}')).not.toThrow();
  });

  it('tollera le formule troncate', () => {
    for (const latex of ['\\frac{a}', '\\begin{pmatrix} a', '\\left( x', '{{{']) {
      expect(() => latexToOmml(latex), latex).not.toThrow();
    }
  });

  it('gestisce una formula vuota', () => {
    expect(latexToOmml('')).toBe('<m:oMath></m:oMath>');
  });

  it('esegue l\u2019escaping dei caratteri riservati XML', () => {
    const xml = latexToOmml('a < b & c > d');

    expect(xml).toContain('&lt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&gt;');
  });

  it('converte le formule reali della suite scientifica', () => {
    // Campione tratto dal documento dell'utente.
    const formulas = [
      '\\frac{\\partial f}{\\partial x} = \\lim_{\\Delta x \\to 0} \\frac{f(x+\\Delta x) - f(x)}{\\Delta x}',
      '\\oint_{\\partial S} \\mathbf{F} \\cdot d\\mathbf{r} = \\iint_S (\\nabla \\times \\mathbf{F}) \\cdot d\\mathbf{S}',
      'i\\hbar \\frac{\\partial}{\\partial t} \\Psi(\\mathbf{r}, t) = \\left[ -\\frac{\\hbar^2}{2m} \\nabla^2 + V \\right] \\Psi',
      '\\begin{cases} 0 & x < 0 \\\\ 1 & \\text{altrimenti} \\end{cases}',
      'E = \\sqrt{(pc)^2 + (m_0 c^2)^2} = \\frac{m_0 c^2}{\\sqrt{1 - \\frac{v^2}{c^2}}}',
      '\\sigma_{ij} = C_{ijkl} \\varepsilon_{kl}',
    ];

    for (const latex of formulas) {
      const xml = latexToOmml(latex);
      expect(xml, latex).toContain('<m:oMath>');
      // Nessun comando LaTeX deve sopravvivere nel testo finale.
      expect(textOf(xml), latex).not.toContain('\\frac');
      expect(textOf(xml), latex).not.toContain('\\begin');
    }
  });
});

describe('albero sintattico', () => {
  it('rappresenta le frazioni con numeratore e denominatore', () => {
    const [node] = parseLatex('\\frac{a}{b}');

    expect(node.type).toBe('fraction');
    expect(node.numerator).toBeTruthy();
    expect(node.denominator).toBeTruthy();
  });

  it('riconosce le righe e le colonne di una matrice', () => {
    const [node] = parseLatex('\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}');

    expect(node.type).toBe('matrix');
    expect(node.rows).toHaveLength(2);
    expect(node.rows[0]).toHaveLength(2);
  });
});

describe('correzioni di resa segnalate sul documento reale', () => {
  it('conserva gli spazi dentro \u005ctext{}', () => {
    // Senza questo, "\text{se } x" produceva "sex".
    expect(textOf(latexToOmml('\\text{se } x'))).toBe('se x');
    expect(textOf(latexToOmml('\\text{(Legge di Gauss)}'))).toBe('(Legge di Gauss)');
  });

  it('continua a ignorare gli spazi nella matematica', () => {
    expect(textOf(latexToOmml('a  +  b'))).toBe('a+b');
  });

  it('non duplica i delimitatori dimensionati esplicitamente', () => {
    // `\Big[ ... \Big]` produceva due livelli di parentesi.
    const xml = latexToOmml('\\Big[ -\\cos(x) \\Big]_0^\\pi');

    expect(textOf(xml)).toContain('[');
    expect(textOf(xml)).toContain(']');
    expect((xml.match(/<m:d>/g) ?? []).length).toBe(0);
  });

  it('pone la notazione sopra e sotto le frecce di reazione', () => {
    // Le costanti cinetiche vanno sopra e sotto il simbolo, non di fianco.
    const xml = latexToOmml('\\underset{k_{-1}}{\\overset{k_1}{\\rightleftharpoons}}');

    expect(xml).toContain('<m:limUpp>');
    expect(xml).toContain('<m:limLow>');
    expect(textOf(xml)).toContain('⇌');
  });

  it('combina overset e underset senza annidarli erroneamente', () => {
    const xml = latexToOmml('\\overset{a}{\\underset{b}{X}}');

    expect((xml.match(/<m:limUpp>/g) ?? []).length).toBe(1);
    expect((xml.match(/<m:limLow>/g) ?? []).length).toBe(1);
  });

  it('converte l\u2019ambiente aligned delle equazioni di Maxwell', () => {
    // Questa sezione spariva del tutto dal documento.
    const xml = latexToOmml(
      '\\begin{aligned} \\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} && \\text{(Legge di Gauss)} \\\\' +
        ' \\nabla \\cdot \\mathbf{B} &= 0 && \\text{(Magnetismo)} \\end{aligned}'
    );

    // `aligned` non è una matrice: le `&` sono punti di allineamento.
    // Si usa <m:eqArr>, che impagina le righe una sotto l'altra.
    expect(xml).toContain('<m:eqArr>');
    expect((xml.match(/<m:e>/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(textOf(xml)).toContain('Legge di Gauss');
  });
});

describe('resa tipografica', () => {
  it('unisce i caratteri adiacenti in un solo run', () => {
    // Run separati per carattere inducono Word a trattare le parentesi come
    // delimitatori, ingrandendole fino all'altezza dell'espressione.
    const xml = latexToOmml('f(x, y)');

    expect((xml.match(/<m:r>/g) ?? []).length).toBe(1);
    expect(textOf(xml)).toBe('f(x,y)');
  });

  it('non altera il contenuto unendo i run', () => {
    for (const latex of ['\\frac{a}{b} + c', '\\sum_{i=1}^{n} x_i', '\\Psi(\\mathbf{r}, t)']) {
      expect(() => latexToOmml(latex), latex).not.toThrow();
      expect(latexToOmml(latex), latex).toContain('<m:oMath>');
    }
  });

  it('preserva la formattazione distinta fra run diversi', () => {
    // Il grassetto non deve essere assorbito dal testo circostante.
    const xml = latexToOmml('a\\mathbf{B}c');

    expect(xml).toContain('<m:sty m:val="b"/>');
    expect(textOf(xml)).toBe('aBc');
  });
});

describe('operatori grandi consecutivi', () => {
  it('annida le sommatorie multiple invece di lasciarle vuote', () => {
    // Operandi vuoti venivano resi come quadratini segnaposto.
    const xml = latexToOmml('\\sum_{i=1}^{n} \\sum_{j=1}^{m} \\sum_{k=1}^{p} x');

    expect((xml.match(/<m:nary>/g) ?? []).length).toBe(3);
    expect(xml).not.toContain('<m:e/>');
    expect(xml).not.toContain('<m:e></m:e>');
  });

  it('continua a fermare l\u2019operando alle relazioni', () => {
    // In `∑ x = y` l'operatore agisce su `x`, non sull'uguaglianza.
    const xml = latexToOmml('\\sum_{i} x_i = y');
    expect(xml.indexOf('</m:nary>')).toBeLessThan(xml.lastIndexOf('y'));
  });
});

describe('posizione degli estremi negli operatori grandi', () => {
  /** @param {string} latex */
  const limitLocationOf = (latex) => /m:limLoc m:val="(\w+)"/.exec(latexToOmml(latex))?.[1];

  it('scrive gli estremi degli integrali di lato', () => {
    // Convenzione tipografica: gli integrali portano gli estremi a fianco
    // del simbolo, non sopra e sotto.
    for (const latex of [
      '\\int_{0}^{\\pi} f',
      '\\iint_S B',
      '\\oint_{\\partial S} F',
      '\\iiint_V g',
    ]) {
      expect(limitLocationOf(latex), latex).toBe('subSup');
    }
  });

  it('scrive gli estremi di sommatorie e produttorie sopra e sotto', () => {
    for (const latex of ['\\sum_{i=1}^{n} x', '\\prod_{k} a', '\\bigcup_i A']) {
      expect(limitLocationOf(latex), latex).toBe('undOvr');
    }
  });
});

describe('conformità allo schema OMML', () => {
  /**
   * Word applica lo schema in modo rigoroso: un elemento strutturale vuoto
   * rende non valido l'intero blocco matematico, e Word lo scarta **insieme
   * al paragrafo che lo contiene**. LibreOffice invece lo tollera, quindi il
   * difetto non emerge dalle conversioni di controllo.
   * Vedi docs/BUGFIX-DOCX-CONTENUTO-MANCANTE.md.
   * @param {string} xml
   */
  const emptyElements = (xml) =>
    xml.match(/<m:(sub|sup|deg|e|num|den|lim)\/>|<m:(sub|sup|deg|e|num|den|lim)><\/m:\2>/g) ?? [];

  it('non produce mai elementi strutturali vuoti', () => {
    const formulas = [
      '\\oint_{\\partial S} \\mathbf{F} \\cdot d\\mathbf{r}',
      '\\iint_S B',
      '\\iiint_V (\\nabla \\cdot \\mathbf{F}) dV',
      '\\sum_{i} x_i',
      '\\sqrt{x}',
      '\\int_0^1 f',
      '\\frac{a}{b}',
      '\\lim_{x \\to 0} f',
      '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}',
      '\\begin{cases} 0 & x < 0 \\\\ 1 & \\text{altrimenti} \\end{cases}',
    ];

    for (const latex of formulas) {
      expect(emptyElements(latexToOmml(latex)), latex).toEqual([]);
    }
  });

  it('mantiene gli elementi obbligatori anche quando sono nascosti', () => {
    // `subHide`/`supHide` nascondono l'estremo, ma l'elemento deve esistere
    // e contenere almeno un run.
    const xml = latexToOmml('\\oint_{\\partial S} F');

    expect(xml).toContain('<m:supHide m:val="1"/>');
    expect(xml).toContain('<m:sup>');
    expect(xml).not.toContain('<m:sup/>');
  });

  it('rispetta l\u2019ordine dei figli in m:nary', () => {
    const inner = /<m:nary>([\s\S]*?)<m:e>/.exec(latexToOmml('\\sum_{i=1}^{n} x'))[1];
    const order = ['m:naryPr', 'm:sub', 'm:sup'].map((tag) => inner.indexOf(`<${tag}`));

    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((position) => position >= 0)).toBe(true);
  });

  it('produce frazioni e radici complete', () => {
    const fraction = latexToOmml('\\frac{a}{b}');
    expect(fraction).toContain('<m:num>');
    expect(fraction).toContain('<m:den>');

    const root = latexToOmml('\\sqrt{x}');
    expect(root).toContain('<m:deg>');
    expect(root).toContain('<m:e>');
  });
});
