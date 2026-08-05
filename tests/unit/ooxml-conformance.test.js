/**
 * Conformità del documento Word allo schema OOXML.
 *
 * Contesto: per tre iterazioni consecutive Word ha scartato silenziosamente
 * parti del documento — sezioni intere, senza alcun messaggio d'errore —
 * mentre LibreOffice e `python-docx` lo mostravano completo. La causa era ogni
 * volta una violazione dello schema che i lettori tolleranti ignorano.
 *
 * Questi test applicano i vincoli in modo esplicito, sull'intero documento
 * generato dalle formule reali: sono la rete che impedisce a un difetto di
 * questa famiglia di arrivare di nuovo all'utente.
 * Vedi docs/BUGFIX-DOCX-OMATHPARA.md.
 */

import { describe, it, expect } from 'vitest';
import { validateOmml, validateDocumentXml } from '../helpers/ooxml-validator.js';
import { latexToOmml } from '../../src/export/docx/latex/omml.js';
import { convertHtmlToOoxml } from '../../src/export/docx/html-to-ooxml.js';
import { createDocxRenderer } from '../../src/export/docx/docx.renderer.js';
import {
  createConversation,
  createTurn,
  createMessage,
} from '../../src/core/model/conversation.js';
import { sanitizeElement } from '../../src/gemini/sanitize/html-sanitizer.js';

/** Campionario dei costrutti che Gemini genera in ambito scientifico. */
const FORMULAS = [
  '\\frac{\\partial f}{\\partial x} = \\lim_{\\Delta x \\to 0} \\frac{f(x+\\Delta x) - f(x)}{\\Delta x}',
  '\\oint_{\\partial S} \\mathbf{F} \\cdot d\\mathbf{r} = \\iint_S (\\nabla \\times \\mathbf{F}) \\cdot d\\mathbf{S}',
  '\\iiint_V (\\nabla \\cdot \\mathbf{F}) \\, dV',
  '\\mathbf{A} = \\begin{bmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{bmatrix}',
  '\\begin{aligned} \\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} && \\text{(Gauss)} \\end{aligned}',
  '\\begin{cases} 0 & x < 0 \\\\ 1 & \\text{altrimenti} \\end{cases}',
  'f(\\mathbf{x}) = \\frac{1}{(2\\pi)^{k/2}} \\exp\\left(-\\frac{1}{2}(\\mathbf{x}-\\boldsymbol{\\mu})^T\\right)',
  '\\sigma(\\mathbf{z})_i = \\frac{e^{z_i}}{\\sum_{j=1}^{K} e^{z_j}}',
  'X(s) = \\int_{0}^{\\infty} x(t) e^{-st} \\, dt',
  '\\underbrace{a+b}_{\\text{somma}} + \\overbrace{c}^{\\text{uno}}',
  'y = \\sqrt{1 + \\sqrt{2 + \\sqrt{3}}}',
  '\\underset{k_{-1}}{\\overset{k_1}{\\rightleftharpoons}}',
  '\\sum_{i=1}^{n} \\sum_{j=1}^{m} \\frac{i}{j}',
  '\\Vert{}\\mathbf{A}\\Vert{}_F',
];

/** @param {string} html */
function elementFrom(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

/**
 * Conversazione ridotta al minimo, per i test che riguardano le parti fisse del
 * pacchetto e non il contenuto.
 * @param {string} [html]
 */
function minimalConversation(html = '<p>Contenuto</p>') {
  return createConversation({
    title: 'Test',
    turns: [
      createTurn(
        createMessage({ role: 'user', text: 'D' }),
        createMessage({ role: 'model', text: 'R', html: sanitizeElement(elementFrom(html)) })
      ),
    ],
    source: { app: 'gemini', url: '' },
  });
}

describe('conformità delle singole formule', () => {
  it.each(FORMULAS)('produce OMML conforme: %s', (latex) => {
    expect(validateOmml(latexToOmml(latex))).toEqual([]);
  });

  it('produce OMML conforme anche in forma di blocco', () => {
    for (const latex of FORMULAS) {
      expect(validateOmml(latexToOmml(latex, { block: true })), latex).toEqual([]);
    }
  });
});

describe('conformità dei paragrafi', () => {
  it('avvolge in oMathPara la matematica che occupa un paragrafo', () => {
    // Un <m:oMath> come unico figlio di <w:p> fa scartare a Word l'intero
    // paragrafo: è la causa delle sezioni sparite.
    const xml = convertHtmlToOoxml(
      elementFrom('<div class="math-block"><span class="katex" data-latex="x = 1"></span></div>')
    );

    expect(xml).toContain('<m:oMathPara>');
    expect(validateDocumentXml(xml)).toEqual([]);
  });

  it('avvolge in oMathPara anche una formula inline isolata', () => {
    // Caso reale: un paragrafo che contiene solo una formula "inline".
    const xml = convertHtmlToOoxml(
      elementFrom('<p><span class="katex math-inline" data-latex="a \\cdot b"></span></p>')
    );

    expect(validateDocumentXml(xml)).toEqual([]);
  });

  it('lascia inline la matematica accanto al testo', () => {
    const xml = convertHtmlToOoxml(
      elementFrom('<p>Sia <span class="katex math-inline" data-latex="x"></span> un valore.</p>')
    );

    expect(xml).not.toContain('<m:oMathPara>');
    expect(validateDocumentXml(xml)).toEqual([]);
  });
});

describe('conformità del documento completo', () => {
  it('genera un word/document.xml interamente conforme', async () => {
    const html = FORMULAS.map(
      (latex) =>
        `<p>Testo introduttivo.</p><div class="math-block"><span class="katex" data-latex="${latex
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/"/g, '&quot;')}"></span></div>`
    ).join('');

    const conversation = createConversation({
      title: 'Verifica di conformità',
      turns: [
        createTurn(
          createMessage({ role: 'user', text: 'Domanda' }),
          createMessage({
            role: 'model',
            text: 'Risposta',
            html: sanitizeElement(elementFrom(html)),
          })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });

    const bytes = await createDocxRenderer({ document }).render(conversation, {});

    // I file sono archiviati senza compressione, quindi il documento è
    // leggibile nel flusso; si isola la sola parte word/document.xml.
    const archive = new TextDecoder().decode(bytes);
    const start = archive.indexOf('<w:document');
    const end = archive.indexOf('</w:document>') + '</w:document>'.length;
    const documentXml = archive.slice(start, end);

    expect(documentXml.length).toBeGreaterThan(1000);
    expect(validateDocumentXml(documentXml)).toEqual([]);
  });
});

describe('parti richieste per l\u2019impaginazione della matematica', () => {
  /** @returns {Promise<string>} L'archivio come testo (voci non compresse). */
  async function buildArchive() {
    const conversation = createConversation({
      title: 'Test',
      turns: [
        createTurn(
          createMessage({ role: 'user', text: 'D' }),
          createMessage({
            role: 'model',
            text: 'R',
            html: sanitizeElement(
              elementFrom(
                '<div class="math-block"><span class="katex" data-latex="\\frac{a}{b}"></span></div>'
              )
            ),
          })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });

    const bytes = await createDocxRenderer({ document }).render(conversation, {});
    return new TextDecoder().decode(bytes);
  }

  it('include settings.xml con le proprietà matematiche', async () => {
    // Senza <m:mathPr> Word non ha i parametri di impaginazione: mostra il
    // segnaposto «EQUAZIONE» e ricalcola le altezze a documento aperto,
    // riflowando il testo fuori pagina.
    const archive = await buildArchive();

    expect(archive).toContain('word/settings.xml');
    expect(archive).toContain('<m:mathPr>');
    expect(archive).toContain('<m:mathFont m:val="Cambria Math"/>');
  });

  it('include la tabella dei font con Cambria Math', async () => {
    const archive = await buildArchive();

    expect(archive).toContain('word/fontTable.xml');
    expect(archive).toContain('<w:font w:name="Cambria Math">');
  });

  it('dichiara i tipi di contenuto delle nuove parti', async () => {
    const archive = await buildArchive();

    expect(archive).toContain('wordprocessingml.settings+xml');
    expect(archive).toContain('wordprocessingml.fontTable+xml');
  });

  it('applica Cambria Math a ogni run matematico', () => {
    // È la dichiarazione che permette a Word di impaginare l'equazione
    // subito, invece di rimandare il calcolo.
    const xml = latexToOmml('\\frac{a}{b} + \\sqrt{x}');
    const runs = xml.match(/<m:r>/g) ?? [];
    const fonts = xml.match(/w:ascii="Cambria Math"/g) ?? [];

    expect(runs.length).toBeGreaterThan(0);
    expect(fonts.length).toBe(runs.length);
  });

  it('impedisce che una formula venga spezzata fra due pagine', async () => {
    const archive = await buildArchive();
    const style = /w:styleId="Formula"[\s\S]*?<\/w:style>/.exec(archive)[0];

    expect(style).toContain('<w:keepLines/>');
  });
});

describe('coerenza della forma dei paragrafi matematici', () => {
  it('ogni oMathPara dichiara l\u2019allineamento', async () => {
    // La forma è definita in un solo punto (asMathParagraph): costruirla a
    // mano altrove aveva prodotto un paragrafo privo di allineamento.
    const conversation = createConversation({
      title: 'Test',
      turns: [
        createTurn(
          createMessage({ role: 'user', text: 'D' }),
          createMessage({
            role: 'model',
            text: 'R',
            html: sanitizeElement(
              elementFrom(
                '<div class="math-block"><span class="katex" data-latex="x=1"></span></div>' +
                  '<p><span class="katex math-inline" data-latex="y=2"></span></p>'
              )
            ),
          })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });

    const archive = new TextDecoder().decode(
      await createDocxRenderer({ document }).render(conversation, {})
    );
    const start = archive.indexOf('<w:document');
    const documentXml = archive.slice(start, archive.indexOf('</w:document>'));

    const paragraphs = (documentXml.match(/<m:oMathPara>/g) ?? []).length;
    const aligned = (documentXml.match(/<m:jc m:val="left"\/>/g) ?? []).length;

    expect(paragraphs).toBeGreaterThan(0);
    expect(aligned).toBe(paragraphs);
  });
});

describe('modalità di visualizzazione iniziale', () => {
  it('apre il documento in layout web, come pagina continua', async () => {
    // In layout web non esistono margini di pagina, quindi il ricalcolo
    // dell'altezza delle equazioni non può spingere il contenuto fuori
    // pagina. È la modalità che l'utente doveva attivare manualmente.
    const conversation = createConversation({
      title: 'Test',
      turns: [
        createTurn(
          createMessage({ role: 'user', text: 'D' }),
          createMessage({
            role: 'model',
            text: 'R',
            html: sanitizeElement(elementFrom('<p>Contenuto</p>')),
          })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });

    const archive = new TextDecoder().decode(
      await createDocxRenderer({ document }).render(conversation, {})
    );

    expect(archive).toContain('<w:view w:val="web"/>');
  });

  it('disattiva la compressione della spaziatura CJK', async () => {
    // Senza questa dichiarazione il valore predefinito dipende dalla lingua di
    // installazione di Word: nelle build che comprimono, i paragrafi che
    // alternano testo e formule inline vedono collassare le larghezze di
    // avanzamento e i glifi si sovrappongono. Il difetto era intermittente
    // proprio perché legato alla configurazione della singola installazione.
    // Vedi docs/BUGFIX-DOCX-CARATTERI-COMPRESSI.md.
    const archive = new TextDecoder().decode(
      await createDocxRenderer({ document }).render(minimalConversation(), {})
    );

    expect(archive).toContain('<w:characterSpacingControl w:val="doNotCompress"/>');
  });

  it('non attribuisce il font matematico alla scrittura dell\u2019Asia orientale', async () => {
    // `eastAsia` non è un font di riserva: indica con quale font misurare i
    // caratteri classificati come CJK. Puntarlo a Cambria Math nei default
    // attivava la tipografia CJK su tutto il documento.
    const archive = new TextDecoder().decode(
      await createDocxRenderer({ document }).render(minimalConversation(), {})
    );

    expect(archive).not.toContain('w:eastAsia="Cambria Math"');
  });

  it('conserva il formato A4 per la stampa', async () => {
    // Il layout web riguarda solo la visualizzazione: la stampa e
    // l'esportazione in PDF usano sempre <w:sectPr>.
    const conversation = createConversation({
      title: 'Test',
      turns: [
        createTurn(
          createMessage({ role: 'user', text: 'D' }),
          createMessage({
            role: 'model',
            text: 'R',
            html: sanitizeElement(elementFrom('<p>Contenuto</p>')),
          })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });

    const archive = new TextDecoder().decode(
      await createDocxRenderer({ document }).render(conversation, {})
    );

    // A4: 11906 × 16838 twip.
    expect(archive).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(archive).toContain('<w:pgMar');
  });
});
