/**
 * Normalizzazione delle formule matematiche.
 *
 * KaTeX produce due rappresentazioni parallele della stessa formula:
 *  - `.katex-mathml`: MathML nascosto, destinato agli screen reader;
 *  - `.katex-html`: la resa visiva fatta di span posizionati.
 *
 * In stampa il MathML tornerebbe visibile come testo illeggibile accanto alla
 * formula: va rimosso. Se invece troviamo MathML *senza* la controparte KaTeX
 * (caso che si verifica quando Gemini cambia renderer), estraiamo il sorgente
 * LaTeX e lo mostriamo come testo monospaziato: meglio una formula leggibile
 * in LaTeX che un muro di simboli.
 * @module gemini/sanitize/katex
 */

/** Classe applicata al fallback testuale LaTeX (stilizzata in document.css). */
export const LATEX_FALLBACK_CLASS = 'gex-latex-fallback';

/**
 * Attributo in cui conserviamo il sorgente LaTeX della formula.
 *
 * Il MathML viene rimosso perché in stampa comparirebbe come testo illeggibile,
 * ma con esso sparirebbe anche l'unica rappresentazione testuale della formula.
 * I formati che non sanno rendere KaTeX (Word, e in futuro Markdown) leggono
 * il LaTeX da qui: la resa visiva di KaTeX, letta come testo, produce sequenze
 * di glifi prive di senso.
 */
export const LATEX_SOURCE_ATTRIBUTE = 'data-latex';

/**
 * @param {Element} root
 */
export function normalizeMath(root) {
  cleanRenderedFormulas(root);
  replaceOrphanMathML(root);
}

/**
 * Rimuove il MathML duplicato dalle formule già renderizzate da KaTeX.
 * @param {Element} root
 */
function cleanRenderedFormulas(root) {
  root.querySelectorAll('.katex').forEach((katex) => {
    // Si preserva il sorgente prima di eliminare il MathML che lo contiene.
    const latex = readLatexSource(katex);
    if (latex) katex.setAttribute(LATEX_SOURCE_ATTRIBUTE, latex);

    katex.querySelector('.katex-mathml')?.remove();

    const visual = katex.querySelector('.katex-html');
    if (visual) {
      // `aria-hidden` nasconderebbe la formula ai motori di stampa.
      visual.removeAttribute('aria-hidden');
      visual.removeAttribute('style');
    }
    katex.removeAttribute('style');
  });
}

/**
 * Cerca il sorgente LaTeX di una formula, nell'annotazione MathML o
 * nell'attributo `data-math` che Gemini applica al contenitore.
 * @param {Element} katex
 * @returns {string}
 */
function readLatexSource(katex) {
  const annotation = katex.querySelector('annotation[encoding="application/x-tex"]');
  if (annotation?.textContent?.trim()) return annotation.textContent.trim();

  return katex.closest('[data-math]')?.getAttribute('data-math')?.trim() ?? '';
}

/**
 * Converte il MathML orfano nel suo sorgente LaTeX.
 * @param {Element} root
 */
function replaceOrphanMathML(root) {
  root.querySelectorAll('math').forEach((math) => {
    if (math.closest('.katex')) return;

    const latex = extractLatexSource(math);
    const replacement = math.ownerDocument.createElement('span');
    replacement.className = LATEX_FALLBACK_CLASS;
    replacement.textContent = latex || (math.textContent ?? '').trim();
    math.replaceWith(replacement);
  });
}

/**
 * @param {Element} math
 * @returns {string} Sorgente LaTeX, stringa vuota se assente.
 */
function extractLatexSource(math) {
  const annotation = math.querySelector('annotation[encoding="application/x-tex"]');
  return annotation?.textContent?.trim() ?? '';
}
