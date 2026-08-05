/**
 * Normalizzazione dei blocchi di codice.
 *
 * La versione precedente conteneva sette euristiche sovrapposte ("Caso 1..7"),
 * fra cui una regola che rimuoveva qualunque elemento con `data-test-id`
 * contenente "button" — con il rischio di cancellare contenuto legittimo.
 *
 * Qui il problema è espresso in due regole, entrambe verificabili:
 *   R1. Dentro un `<pre>` sopravvivono solo testo e markup di codice.
 *   R2. Attorno a un `<pre>`, i fratelli che sono UI (toolbar con l'etichetta
 *       del linguaggio e il bottone "copia") vengono rimossi; se il wrapper
 *       resta con il solo `<pre>`, il wrapper viene eliminato.
 *
 * Nota: l'etichetta del linguaggio viene preservata come attributo `class`
 * `language-*` quando presente, così il rendering può mostrarla in futuro
 * senza reintrodurre la toolbar.
 * @module gemini/sanitize/code-blocks
 */

/** Selettori che identificano senza ambiguità la UI di un blocco di codice. */
const CODE_UI_SELECTORS = [
  'code-block-bar',
  '.code-block-bar',
  'code-bar',
  '.code-bar',
  '.code-block-header',
  '.code-block-copy-button',
  '.copy-code-button',
  'copy-button',
  'gem-icon-button',
  'button',
  '[role="button"]',
  '.mat-mdc-icon-button',
  '.mdc-icon-button',
];

/**
 * @param {Element} root
 */
export function normalizeCodeBlocks(root) {
  root.querySelectorAll('pre').forEach((pre) => {
    stripUiInsidePre(pre);
    stripUiAroundPre(pre);
  });
}

/**
 * R1 — dentro il `<pre>` resta solo il codice.
 * @param {Element} pre
 */
function stripUiInsidePre(pre) {
  pre.querySelectorAll(CODE_UI_SELECTORS.join(',')).forEach((element) => element.remove());

  // SVG residui (icone) che non fossero dentro un bottone.
  pre.querySelectorAll('svg').forEach((svg) => svg.remove());
}

/**
 * R2 — attorno al `<pre>`, rimuove la toolbar e appiattisce il wrapper.
 * @param {Element} pre
 */
function stripUiAroundPre(pre) {
  const wrapper = pre.parentElement;
  if (!wrapper) return;

  for (const sibling of Array.from(wrapper.children)) {
    if (sibling === pre || sibling.tagName === 'PRE') continue;
    if (isCodeBlockUi(sibling)) sibling.remove();
  }

  const onlyChildIsPre = wrapper.children.length === 1 && wrapper.children[0] === pre;
  const wrapperHasNoOwnText = (wrapper.textContent ?? '') === (pre.textContent ?? '');

  if (onlyChildIsPre && wrapperHasNoOwnText && wrapper.parentElement) {
    wrapper.replaceWith(pre);
  }
}

/**
 * Un elemento è UI del blocco di codice se corrisponde a un selettore noto,
 * oppure se è una barra che contiene esclusivamente controlli.
 * @param {Element} element
 * @returns {boolean}
 */
export function isCodeBlockUi(element) {
  if (element.matches(CODE_UI_SELECTORS.join(','))) return true;

  const ariaLabel = (element.getAttribute('aria-label') ?? '').toLowerCase();
  if (ariaLabel.includes('copy') || ariaLabel.includes('copia')) return true;

  // Contenitore i cui figli sono tutti controlli: è una toolbar.
  const children = Array.from(element.children);
  if (children.length > 0 && children.every((child) => isControl(child))) return true;

  return false;
}

/**
 * @param {Element} element
 * @returns {boolean}
 */
function isControl(element) {
  return (
    element.tagName === 'BUTTON' ||
    element.tagName === 'SVG' ||
    element.getAttribute('role') === 'button' ||
    element.classList.contains('mdc-icon-button') ||
    element.classList.contains('gem-icon-button')
  );
}
