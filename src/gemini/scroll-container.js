/**
 * Individuazione del contenitore che scorre davvero.
 *
 * PERCHÉ SERVE
 * ------------
 * Gemini non scorre la finestra: la cronologia vive dentro un
 * `<infinite-scroller>` dichiarato `overflow: hidden scroll`. La finestra resta
 * ferma, e `window.scrollTo` non ha alcun effetto sul contenuto.
 *
 * Chi deve portare un elemento nel viewport per fotografarlo non può quindi
 * assumere che sia la finestra a muoversi: deve risalire gli antenati fino a
 * trovare quello che possiede la barra di scorrimento.
 *
 * L'astrazione `Scroller` uniforma i due casi — elemento o finestra — così il
 * chiamante scrive la stessa logica in entrambe le situazioni.
 * @module gemini/scroll-container
 */

/**
 * @typedef {object} Scroller
 * @property {() => number} position Scorrimento corrente, in pixel.
 * @property {(top: number) => void} scrollTo Porta lo scorrimento al valore dato.
 * @property {() => { top: number, height: number }} viewport Area visibile, in
 *   coordinate del viewport della finestra.
 */

/** Valori di `overflow-y` che producono una barra di scorrimento. */
const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);

/**
 * Risale gli antenati alla ricerca del contenitore che scorre.
 *
 * @param {Element} element
 * @param {Window} win
 * @returns {Scroller} Il contenitore trovato, o la finestra come ripiego.
 */
export function findScroller(element, win) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (isScrollable(node, win)) return elementScroller(node);
  }
  return windowScroller(win);
}

/**
 * Un elemento scorre se dichiara un overflow che lo consente **e** se il suo
 * contenuto eccede davvero l'altezza disponibile: la sola dichiarazione CSS non
 * basta, perché `overflow: auto` su un contenitore che sta tutto dentro non
 * produce alcuno scorrimento.
 *
 * @param {Element} node
 * @param {Window} win
 * @returns {boolean}
 */
function isScrollable(node, win) {
  const overflowY = win.getComputedStyle(node).overflowY;
  if (!SCROLLABLE_OVERFLOW.has(overflowY)) return false;

  // Un margine di tolleranza evita di scambiare per scorrevoli i contenitori
  // che eccedono di frazioni di pixel per effetto degli arrotondamenti.
  return node.scrollHeight - node.clientHeight > 2;
}

/**
 * @param {Element} node
 * @returns {Scroller}
 */
function elementScroller(node) {
  return {
    position: () => node.scrollTop,
    scrollTo: (top) => {
      node.scrollTop = top;
    },
    viewport: () => {
      const box = node.getBoundingClientRect();
      return { top: box.top, height: box.height };
    },
  };
}

/**
 * @param {Window} win
 * @returns {Scroller}
 */
function windowScroller(win) {
  return {
    position: () => win.scrollY,
    scrollTo: (top) => win.scrollTo({ top, behavior: 'instant' }),
    viewport: () => ({ top: 0, height: win.innerHeight }),
  };
}
