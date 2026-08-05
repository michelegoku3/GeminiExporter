/**
 * Rimozione degli elementi di interfaccia dalla risposta clonata.
 *
 * Sono elementi che appartengono all'applicazione web (bottoni, citazioni
 * interattive, etichette per screen reader) e non al contenuto della risposta.
 * @module gemini/sanitize/noise-removal
 */

/**
 * Selettori di elementi da eliminare con tutto il loro contenuto.
 * Raggruppati per categoria: aggiungi nella categoria giusta quando Gemini
 * introduce nuovi elementi di UI.
 */
export const NOISE_SELECTORS = Object.freeze({
  citations: [
    'source-footnote',
    'sources-carousel-inline',
    'sources-carousel',
    'source-inline-chip',
    '.source-inline-chip-container',
  ],
  accessibility: [
    '.cdk-visually-hidden',
    '.screen-reader-user-query-label',
    '.screen-reader-model-response-label',
    '[aria-live]',
  ],
  interactiveUi: [
    '.luminous-actions-container',
    'thinking-overlay',
    '.tts',
    '.response-container-header-controls',
    'sensitive-memories-banner',
    'freemium-rag-disclaimer',
    '.restart-chat-button-scroll-placeholder',
    'overview-carousel',
    'message-actions',
    '.response-footer',
  ],
  tooltips: ['.mat-mdc-tooltip-trigger', '.tippy-box', '[role="tooltip"]'],
});

/** Tag Angular che vanno spacchettati preservandone il contenuto. */
const WRAPPER_TAGS = ['response-element', 'message-content'];

/**
 * @param {Element} root
 * @param {(element: Element) => void} unwrapFn Funzione di unwrap iniettata.
 */
export function removeNoise(root, unwrapFn) {
  removeBySelectors(root);
  removeEmptyFootnotes(root);
  unwrapWrappers(root, unwrapFn);
}

/** @param {Element} root */
function removeBySelectors(root) {
  const allSelectors = Object.values(NOISE_SELECTORS).flat();
  for (const selector of allSelectors) {
    root.querySelectorAll(selector).forEach((element) => element.remove());
  }
}

/**
 * I riferimenti alle fonti lasciano `<sup>` vuoti dopo la rimozione dei chip.
 * @param {Element} root
 */
function removeEmptyFootnotes(root) {
  root.querySelectorAll('sup').forEach((element) => {
    if (!element.textContent?.trim()) element.remove();
  });
}

/**
 * @param {Element} root
 * @param {(element: Element) => void} unwrapFn
 */
function unwrapWrappers(root, unwrapFn) {
  for (const tag of WRAPPER_TAGS) {
    root.querySelectorAll(tag).forEach((element) => unwrapFn(element));
  }
}
