/**
 * Cattura visiva dei contenuti interattivi incorporati.
 *
 * PERCHÉ UNA CATTURA
 * ------------------
 * I grafici di Gemini vivono in un `<iframe>` cross-origin e sandboxed: il loro
 * DOM non è leggibile (same-origin policy), il loro canvas non è estraibile
 * (`getImageData` è vietato cross-origin) e riprodurne il rendering
 * equivarrebbe a reimplementare l'applicazione. L'unica trasposizione
 * ottenibile è un'immagine di ciò che è visibile sullo schermo.
 *
 * COME
 * ----
 * `tabs.captureVisibleTab` fotografa la **porzione visibile** della scheda. Il
 * contenuto va quindi portato nel viewport prima dello scatto e l'immagine va
 * ritagliata sul rettangolo dell'elemento. Un contenuto più alto della finestra
 * viene catturato in più passaggi e ricucito.
 *
 * La cattura appartiene al livello `gemini` perché dipende dal DOM vivo della
 * pagina e dalla sua geometria: il core non ne sa nulla e riceve soltanto data
 * URI, esattamente come per le immagini.
 * @module gemini/app-capture
 */

import { CAPTURE } from '../shared/config.js';
import { LIVE_MARKER_ATTRIBUTE } from './sanitize/embedded-apps.js';
import { crop, stack, limitWidth } from './canvas-ops.js';
import { findScroller } from './scroll-container.js';
import { logger as defaultLogger } from '../shared/logger.js';

/**
 * @param {object} deps
 * @param {() => Promise<string>} deps.captureVisibleTab Restituisce un data URI
 *   PNG della porzione visibile della scheda.
 * @param {Document} [deps.document]
 * @param {Window} [deps.window]
 * @param {import('../shared/logger.js').Logger} [deps.logger]
 * @param {(ms: number) => Promise<void>} [deps.wait] Attesa iniettabile.
 * @param {() => Promise<boolean>} [deps.canCapture] Verifica preventiva della
 *   possibilità di catturare. Senza il permesso la cattura fallirebbe comunque:
 *   accertarlo prima evita di scorrere la cronologia per nulla, che è
 *   l'operazione visibile e fastidiosa per l'utente.
 */
export function createAppCapture({
  captureVisibleTab,
  document: doc = globalThis.document,
  window: win = globalThis.window,
  logger = defaultLogger,
  wait = defaultWait,
  canCapture = async () => true,
}) {
  /**
   * Cattura una singola fascia verticale dell'elemento.
   *
   * @param {Element} element
   * @param {number} index Indice della fascia, a partire da 0.
   * @param {number} ratio Pixel fisici per pixel CSS.
   * @param {import('./scroll-container.js').Scroller} scroller
   * @returns {Promise<HTMLCanvasElement|null>}
   */
  async function captureSlice(element, index, ratio, scroller) {
    const view = scroller.viewport();

    // Lo scorrimento è relativo al contenitore che lo possiede, non alla
    // finestra: `getBoundingClientRect` dà coordinate rispetto al viewport,
    // quindi la distanza dall'inizio dell'area visibile va sommata alla
    // posizione corrente del contenitore.
    const offsetInView = element.getBoundingClientRect().top - view.top;
    const target = scroller.position() + offsetInView + index * view.height;
    scroller.scrollTo(target - CAPTURE.topMarginPx);

    // Lo scatto deve avvenire a scorrimento concluso e layout stabilizzato:
    // senza attesa si fotografa la pagina a metà del movimento.
    await wait(CAPTURE.settleMs);

    const screenshot = await loadImage(win, await captureVisibleTab());

    // Il rettangolo va riletto **dopo** lo scorrimento: le sue coordinate sono
    // relative al viewport e sono cambiate.
    const box = element.getBoundingClientRect();

    // L'area utile è l'intersezione fra l'elemento e la parte visibile del
    // contenitore: fotografare oltre significherebbe includere ciò che sta
    // sotto la barra di composizione o sopra l'intestazione.
    const updated = scroller.viewport();
    const top = Math.max(box.top, updated.top);
    const bottom = Math.min(box.top + box.height, updated.top + updated.height);
    const height = bottom - top;

    if (box.width < 1 || height < 1) return null;

    // Le proprietà di un DOMRect stanno sul prototipo, non sull'istanza: lo
    // spread produce un oggetto vuoto e `width` diventerebbe undefined, quindi
    // `canvas.width` NaN e la cattura un'immagine vuota. Vanno lette una a una.
    // Vedi docs/BUGFIX-CATTURA-DOMRECT.md.
    return crop({
      document: doc,
      screenshot,
      box: { top, left: box.left, width: box.width },
      height,
      ratio,
    });
  }

  /**
   * Cattura il contenuto marcato con l'identificatore indicato.
   *
   * @param {string} id
   * @returns {Promise<string|null>} Data URI PNG, null se non catturabile.
   */
  async function capture(id) {
    const element = doc.querySelector(`[${LIVE_MARKER_ATTRIBUTE}="${cssEscape(id)}"]`);
    if (!element) {
      logger.warn(`Contenuto interattivo ${id} non più presente nella pagina.`);
      return null;
    }

    try {
      return await captureElement({ element, doc, win, logger, captureSlice });
    } catch (error) {
      // Un grafico mancante non deve impedire l'esportazione del resto. Il
      // messaggio riporta la causa esatta: senza, l'unico sintomo osservabile
      // sarebbe il segnaposto, identico per errori di natura molto diversa.
      logger.warn(`Cattura del contenuto interattivo ${id} non riuscita:`, error);
      return null;
    }
  }

  return {
    capture,

    /**
     * Cattura tutti i segnaposto presenti in un sottoalbero.
     *
     * @param {Element} root Elemento da elaborare, modificato in place.
     * @param {string} idAttribute Attributo che marca i segnaposto.
     * @returns {Promise<{ captured: number, failed: number }>}
     */
    captureAll: (root, idAttribute) =>
      captureAll({ root, idAttribute, capture, canCapture, logger }),
  };
}

/**
 * Sostituisce ogni segnaposto con l'immagine catturata.
 *
 * Le catture sono **sequenziali**, non parallele: ognuna richiede di scorrere
 * la cronologia, e due scorrimenti simultanei si annullerebbero a vicenda. È
 * anche il motivo per cui l'operazione è percettibilmente più lenta del resto
 * dell'esportazione. Il ripristino della posizione compete a `captureElement`,
 * che è l'unico a sapere quale contenitore ha mosso.
 *
 * @param {object} params
 * @param {Element} params.root
 * @param {string} params.idAttribute
 * @param {(id: string) => Promise<string|null>} params.capture
 * @param {() => Promise<boolean>} params.canCapture
 * @param {import('../shared/logger.js').Logger} params.logger
 * @returns {Promise<{ captured: number, failed: number }>}
 */
async function captureAll({ root, idAttribute, capture, canCapture, logger }) {
  const placeholders = Array.from(root.querySelectorAll(`[${idAttribute}]`));
  if (placeholders.length === 0) return { captured: 0, failed: 0 };

  // Il permesso si verifica una volta per documento, non per grafico: è
  // identico per tutti e la risposta non cambia durante l'esportazione.
  if (!(await canCapture())) {
    logger.warn(
      "Cattura dei grafici non autorizzata. Apri il popup dell'estensione e " +
        'attiva «Includi i grafici interattivi», poi ricarica questa pagina. ' +
        'I grafici restano come segnaposto.'
    );
    for (const placeholder of placeholders) markFailed(placeholder);
    return { captured: 0, failed: placeholders.length };
  }

  let captured = 0;
  let failed = 0;

  for (const placeholder of placeholders) {
    const dataUrl = await capture(placeholder.getAttribute(idAttribute));
    const image = placeholder.querySelector('img');

    if (dataUrl && image) {
      image.setAttribute('src', dataUrl);
      captured += 1;
    } else {
      markFailed(placeholder);
      failed += 1;
    }
  }

  return { captured, failed };
}

/**
 * Fotografa un elemento, a fasce se non entra in una schermata.
 *
 * @param {object} params
 * @param {Element} params.element
 * @param {Document} params.doc
 * @param {Window} params.win
 * @param {import('../shared/logger.js').Logger} params.logger
 * @param {(element: Element, index: number, ratio: number, scroller: any) => Promise<any>} params.captureSlice
 * @returns {Promise<string|null>}
 */
async function captureElement({ element, doc, win, logger, captureSlice }) {
  const ratio = win.devicePixelRatio || 1;
  const scroller = findScroller(element, win);
  const totalHeight = element.getBoundingClientRect().height;
  const needed = Math.max(1, Math.ceil(totalHeight / scroller.viewport().height));

  if (needed > CAPTURE.maxSlices) {
    logger.warn(
      `Contenuto interattivo troppo alto (${Math.round(totalHeight)} px): ` +
        `catturate le prime ${CAPTURE.maxSlices} schermate.`
    );
  }

  // La posizione va ripristinata sul contenitore effettivamente mosso.
  const originalScroll = scroller.position();
  const shots = [];

  try {
    for (let index = 0; index < Math.min(needed, CAPTURE.maxSlices); index += 1) {
      const shot = await captureSlice(element, index, ratio, scroller);
      if (shot) shots.push(shot);
    }
  } finally {
    scroller.scrollTo(originalScroll);
  }

  if (shots.length === 0) {
    // Nessuna fascia utilizzabile: quasi sempre significa che l'elemento non
    // è mai entrato nell'area visibile. Il dato serve a distinguere questo
    // caso da un errore di rete o di permesso, che si presenta come eccezione.
    logger.warn(
      'Nessuna porzione visibile del contenuto interattivo: ' +
        `rettangolo ${Math.round(totalHeight)} px, ` +
        `area utile ${Math.round(scroller.viewport().height)} px.`
    );
    return null;
  }
  return limitWidth(doc, stack(doc, shots), CAPTURE.maxWidthPx).toDataURL('image/png');
}

/**
 * Riduce il segnaposto alla sola didascalia.
 *
 * Senza immagine resta comunque l'informazione che lì c'era un contenuto
 * interattivo: chi legge non trova un salto inspiegabile nel discorso.
 *
 * @param {Element} placeholder
 */
function markFailed(placeholder) {
  placeholder.querySelector('img')?.remove();
  placeholder.setAttribute('data-capture-failed', 'true');
}

/**
 * @param {Window} win
 * @param {string} dataUrl
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(win, dataUrl) {
  return new Promise((resolve, reject) => {
    // `Image` è una proprietà del contesto globale della finestra: il tipo
    // standard di Window non la dichiara, ma esiste in ogni browser.
    const image = new /** @type {any} */ (win).Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('screenshot non decodificabile'));
    image.src = dataUrl;
  });
}

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Rende un valore utilizzabile dentro un selettore di attributo.
 * Gli identificatori sono generati internamente, ma la difesa costa poco e
 * protegge da un uso futuro con valori di altra provenienza.
 * @param {string} value
 * @returns {string}
 */
function cssEscape(value) {
  return value.replace(/["\\]/g, '\\$&');
}
