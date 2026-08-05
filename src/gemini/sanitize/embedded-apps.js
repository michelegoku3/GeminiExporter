/**
 * Normalizzazione dei contenuti interattivi incorporati.
 *
 * Gemini rende grafici, simulazioni e anteprime web dentro un `<iframe>`
 * **cross-origin e sandboxed** (`<mini-app>`, `<web-preview>`). Questo esclude
 * per costruzione ogni forma di lettura del contenuto:
 *
 * - il DOM interno non è accessibile (same-origin policy);
 * - il canvas non è leggibile (`getImageData` è vietato cross-origin);
 * - rifare il rendering significherebbe reimplementare l'applicazione.
 *
 * L'unica trasposizione possibile è **visiva**: una cattura dell'area occupata
 * dall'iframe. La cattura richiede però API dell'estensione e misure sul DOM
 * vivo, entrambe non disponibili qui.
 *
 * Questo modulo si limita quindi a marcare il punto del documento in cui il
 * contenuto andrà inserito, con la stessa strategia già usata per le immagini
 * (vedi `sanitize/images.js`): lascia un segnaposto che una fase successiva,
 * asincrona, sostituirà con l'immagine catturata.
 *
 * @module gemini/sanitize/embedded-apps
 */

import { SELECTORS } from '../selectors.js';

/**
 * Attributo che marca il segnaposto di un contenuto interattivo.
 *
 * Il valore è l'identificatore assegnato durante l'estrazione: mette in
 * relazione il segnaposto — che vive nel clone sanificato — con l'elemento
 * corrispondente nel DOM vivo, di cui la fase di cattura deve misurare la
 * posizione. Un riferimento diretto all'elemento non sarebbe utilizzabile:
 * il modello attraversa una serializzazione in stringa.
 */
export const APP_ID_ATTRIBUTE = 'data-embedded-app';

/** Attributo con l'etichetta descrittiva, usata dal segnaposto di ripiego. */
export const APP_LABEL_ATTRIBUTE = 'data-embedded-app-label';

/**
 * Attributo temporaneo applicato al DOM vivo per ritrovare l'elemento.
 *
 * Viene rimosso al termine dell'esportazione: il DOM di Gemini non deve
 * conservare traccia del nostro passaggio.
 */
export const LIVE_MARKER_ATTRIBUTE = 'data-gex-app-id';

/** Etichetta usata quando il contenuto non espone un titolo. */
const DEFAULT_LABEL = 'Contenuto interattivo';

/**
 * Selettori da cui ricavare un'etichetta descrittiva, in ordine di preferenza.
 * Il titolo è l'unica informazione testuale disponibile: il resto è nell'iframe.
 */
const LABEL_SOURCES = ['[data-test-id="artifact-title"]', '.title', 'h1', 'h2', 'h3'];

/**
 * Sostituisce i contenuti interattivi con segnaposto.
 *
 * Opera in parallelo sul clone e sull'originale: nel clone inserisce il
 * segnaposto, nell'originale applica un marcatore che permetterà di ritrovare
 * l'elemento per misurarlo. È l'unico punto in cui si tocca il DOM vivo, e la
 * modifica è limitata a un attributo, rimosso da `clearLiveMarkers`.
 *
 * @param {Element} workingCopy Clone in corso di normalizzazione.
 * @param {Element} liveElement Elemento originale, ancora nella pagina.
 * @param {() => string} nextId Generatore di identificatori univoci.
 * @returns {number} Numero di contenuti marcati.
 */
export function markEmbeddedApps(workingCopy, liveElement, nextId) {
  const selector = appSelector();
  const clonedApps = Array.from(workingCopy.querySelectorAll(selector));
  const liveApps = Array.from(liveElement.querySelectorAll(selector));

  // Clone e originale hanno la stessa struttura: `cloneNode(true)` preserva
  // l'ordine dei nodi, quindi la corrispondenza per posizione è affidabile.
  // Se le lunghezze divergono qualcosa è cambiato sotto di noi: si rinuncia,
  // perché associare l'elemento sbagliato produrrebbe un'immagine sbagliata.
  if (clonedApps.length !== liveApps.length) return 0;

  let marked = 0;

  clonedApps.forEach((cloned, index) => {
    // Un contenitore annidato in un altro sarebbe catturato due volte: si
    // considera solo il più esterno.
    if (cloned.parentElement?.closest(selector)) return;

    const id = nextId();
    liveApps[index].setAttribute(LIVE_MARKER_ATTRIBUTE, id);
    cloned.replaceWith(createPlaceholder(cloned, id));
    marked += 1;
  });

  return marked;
}

/**
 * Rimuove i marcatori dal DOM vivo.
 *
 * Da invocare sempre al termine dell'esportazione, anche in caso di errore:
 * attributi lasciati sulla pagina si accumulerebbero a ogni export.
 *
 * @param {ParentNode} root
 */
export function clearLiveMarkers(root) {
  root
    .querySelectorAll(`[${LIVE_MARKER_ATTRIBUTE}]`)
    .forEach((element) => element.removeAttribute(LIVE_MARKER_ATTRIBUTE));
}

/**
 * Costruisce il segnaposto che prenderà il posto del contenuto interattivo.
 *
 * È un `<figure>` con dentro un `<img>` privo di sorgente: la fase di cattura
 * si limiterà a valorizzarne la `src`. Se la cattura non riesce, il renderer
 * troverà un'immagine vuota e mostrerà la didascalia — che resta comunque
 * un'informazione utile per chi legge il documento.
 *
 * @param {Element} source Elemento originale, da cui ricavare l'etichetta.
 * @param {string} id
 * @returns {Element}
 */
function createPlaceholder(source, id) {
  const doc = source.ownerDocument;
  const label = readLabel(source);

  const figure = doc.createElement('figure');
  figure.setAttribute(APP_ID_ATTRIBUTE, id);
  figure.setAttribute(APP_LABEL_ATTRIBUTE, label);

  const image = doc.createElement('img');
  image.setAttribute('alt', label);
  figure.appendChild(image);

  const caption = doc.createElement('figcaption');
  caption.textContent = label;
  figure.appendChild(caption);

  return figure;
}

/**
 * @param {Element} element
 * @returns {string}
 */
function readLabel(element) {
  for (const selector of LABEL_SOURCES) {
    const text = element.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  return DEFAULT_LABEL;
}

/** @returns {string} Selettore che individua i contenitori interattivi. */
function appSelector() {
  return SELECTORS.embeddedApp.candidates.join(', ');
}
