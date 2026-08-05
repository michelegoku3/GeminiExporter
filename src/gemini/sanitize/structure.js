/**
 * Correzioni strutturali del markup, applicate prima della sanitizzazione finale.
 * @module gemini/sanitize/structure
 */

/**
 * Gemini avvolge il testo delle voci di lista in un `<p>`, che in stampa
 * introduce margini verticali indesiderati.
 *
 * La vecchia implementazione usava `p.outerHTML = p.innerHTML` (bug P0-4):
 * un re-parsing di HTML non ancora sanificato, oltre che una perdita dei
 * riferimenti ai nodi. Qui spostiamo i nodi, senza mai riscrivere HTML.
 *
 * @param {Element} root
 * @param {(element: Element) => void} unwrapFn
 */
export function flattenSingleParagraphListItems(root, unwrapFn) {
  root.querySelectorAll('li > p:only-child').forEach((paragraph) => unwrapFn(paragraph));
}

/**
 * Sottoalberi in cui un elemento privo di testo NON è un elemento superfluo.
 *
 * KaTeX costruisce le formule con span vuoti che trasportano la geometria negli
 * attributi `style`: `strut` e `pstrut` impostano l'altezza della riga, `mspace`
 * le spaziature fra simboli, `frac-line` disegna la linea di frazione,
 * `vlist-s` allinea le pile verticali. Sono invisibili al `textContent` ma
 * indispensabili: eliminarli fa collassare frazioni, integrali e matrici.
 */
const STRUCTURAL_SUBTREES = '.katex, .katex-display, math, svg';

/**
 * Rimuove i contenitori rimasti completamente vuoti dopo le pulizie
 * (tipicamente i wrapper delle citazioni eliminate).
 *
 * ⚠️ Non tocca i sottoalberi elencati in STRUCTURAL_SUBTREES: al loro interno
 * gli elementi senza testo hanno una funzione di layout.
 *
 * @param {Element} root
 */
export function removeEmptyContainers(root) {
  const containers = Array.from(root.querySelectorAll('div, span, section, p'));

  // Dal più interno al più esterno: svuotare un figlio può svuotare il padre.
  for (const element of containers.reverse()) {
    if (isLayoutCritical(element)) continue;

    const hasText = (element.textContent ?? '').trim().length > 0;
    const hasMedia = element.querySelector('img, svg, table, pre, hr, br');
    if (!hasText && !hasMedia) element.remove();
  }
}

/**
 * @param {Element} element
 * @returns {boolean} true se l'elemento appartiene a una struttura di layout.
 */
function isLayoutCritical(element) {
  return element.closest(STRUCTURAL_SUBTREES) !== null;
}
