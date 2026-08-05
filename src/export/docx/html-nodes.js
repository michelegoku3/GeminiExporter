/**
 * Classificazione dei nodi HTML per la conversione in WordprocessingML.
 *
 * Isola le domande «che tipo di nodo è questo?» dalla logica di conversione.
 * Sono le regole che cambiano quando Gemini modifica il proprio markup: tenerle
 * separate rende evidente dove intervenire.
 * @module export/docx/html-nodes
 */

/** Elementi che interrompono il flusso e aprono un nuovo paragrafo. */
const BLOCK_LEVEL_TAGS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'HR',
  'UL',
  'OL',
  'LI',
  'DL',
  'DT',
  'DD',
  'FIGURE',
  'FIGCAPTION',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);

/** Classi con cui Gemini marca le formule in blocco. */
const MATH_BLOCK_CLASSES = ['katex-display', 'math-block'];

/** Classi con cui Gemini marca le formule inline. */
const MATH_INLINE_CLASSES = ['katex', 'gex-latex-fallback', 'math-inline'];

/**
 * @param {string} tag Nome del tag in maiuscolo.
 * @returns {boolean}
 */
export function isBlockLevel(tag) {
  return BLOCK_LEVEL_TAGS.has(tag);
}

/**
 * @param {Element} node
 * @returns {boolean} true se la formula occupa un paragrafo proprio.
 */
export function isMathBlock(node) {
  return MATH_BLOCK_CLASSES.some((name) => node.classList?.contains(name));
}

/**
 * @param {Element} node
 * @returns {boolean} true se la formula è inserita nel flusso del testo.
 */
export function isMathInline(node) {
  return MATH_INLINE_CLASSES.some((name) => node.classList?.contains(name));
}

/**
 * Estrae la rappresentazione testuale di una formula.
 *
 * Il sorgente LaTeX, quando disponibile, è preferibile alla resa visiva di
 * KaTeX: quest'ultima è composta da glifi posizionati singolarmente e, letta
 * come testo, produce sequenze prive di senso.
 *
 * @param {Element} node
 * @returns {string} Sorgente LaTeX, o il testo del nodo se non disponibile.
 */
export function extractMathText(node) {
  for (const readSource of LATEX_SOURCES) {
    const latex = readSource(node)?.trim();
    if (latex) return latex;
  }

  // Nessun sorgente disponibile: resta il testo visibile, imperfetto ma
  // preferibile a una formula vuota.
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Sorgenti del LaTeX, in ordine di affidabilità decrescente.
 * @type {Array<(node: Element) => string|null|undefined>}
 */
const LATEX_SOURCES = [
  // Preservato dal normalizzatore prima della rimozione del MathML.
  (node) => node.getAttribute?.('data-latex'),
  (node) => node.querySelector?.('[data-latex]')?.getAttribute('data-latex'),
  (node) => node.querySelector?.('annotation[encoding="application/x-tex"]')?.textContent,
  // Attributo applicato da Gemini al contenitore della formula.
  (node) => node.closest?.('[data-math]')?.getAttribute('data-math'),
];
