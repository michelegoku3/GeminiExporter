/**
 * Normalizzazione delle immagini presenti nella risposta.
 *
 * Distingue le immagini che fanno parte del contenuto — quelle generate da
 * Gemini o allegate dall'utente — da quelle decorative dell'interfaccia
 * (avatar, icone, spinner), che non devono comparire nel documento.
 *
 * Non scarica nulla: prepara soltanto il markup. Il recupero dei dati avviene
 * in una fase successiva, asincrona, perché l'estrazione dal DOM deve restare
 * sincrona (vedi `core/usecases/embed-images.js`).
 * @module gemini/sanitize/images
 */

import { IMAGE } from '../../shared/config.js';
import { APP_ID_ATTRIBUTE } from './embedded-apps.js';

/**
 * Selettori delle immagini decorative dell'interfaccia.
 * Aggiungere qui le nuove classi introdotte da Gemini.
 */
const DECORATIVE_SELECTORS = [
  '.mavatar-image',
  '.user-icon',
  '.gb_X',
  '[data-noaft]',
  'img[aria-hidden="true"]',
  'img[src*="gemini_sparkle"]',
  'img[alt=""]:not([src^="blob:"])',
];

/**
 * Attributo in cui si conserva la sorgente originale dell'immagine.
 *
 * La `src` viene svuotata perché un `blob:` o un URL di googleusercontent non
 * sono raggiungibili dal documento esportato, e il sanitizer li rimuoverebbe
 * comunque. L'URL resta però necessario alla fase di download, che avviene
 * più tardi: viene quindi spostato qui, dove nessun renderer lo userà mai
 * come sorgente.
 */
export const SOURCE_ATTRIBUTE = 'data-image-source';

/**
 * Marca le immagini di contenuto e rimuove quelle decorative.
 *
 * @param {Element} root Elemento da elaborare, modificato in place.
 */
export function normalizeImages(root) {
  liberateImagesFromControls(root);
  removeDecorativeImages(root);
  unwrapImageContainers(root);
  preserveSources(root);
  constrainDimensions(root);
}

/**
 * Estrae le immagini dai controlli interattivi che le racchiudono.
 *
 * Gemini rende l'immagine generata cliccabile avvolgendola in un `<button>`
 * (per aprirla a schermo intero). Il sanitizer elimina i pulsanti **con tutto
 * il loro contenuto**, essendo elementi interattivi: senza questo passaggio
 * l'immagine sparirebbe insieme al pulsante.
 *
 * L'immagine viene quindi spostata al posto del controllo, prima che la
 * sanitizzazione abbia luogo.
 *
 * @param {Element} root
 */
function liberateImagesFromControls(root) {
  const interactiveWrappers = 'button, a[role="button"], [role="button"]';

  for (const wrapper of Array.from(root.querySelectorAll(interactiveWrappers))) {
    const images = Array.from(wrapper.querySelectorAll('img'));
    if (images.length === 0) continue;

    // Il pulsante è sostituito dalle sole immagini che conteneva: etichette e
    // icone del controllo non appartengono al contenuto della risposta.
    const fragment = wrapper.ownerDocument.createDocumentFragment();
    images.forEach((image) => fragment.appendChild(image));
    wrapper.replaceWith(fragment);
  }
}

/**
 * Sposta la sorgente in un attributo dedicato.
 * @param {Element} root
 */
function preserveSources(root) {
  root.querySelectorAll('img[src]').forEach((image) => {
    const source = image.getAttribute('src');

    // I data URI sono già autosufficienti: restano dove sono.
    if (/^data:/i.test(source)) return;

    image.setAttribute(SOURCE_ATTRIBUTE, source);
    image.removeAttribute('src');
  });
}

/** @param {Element} root */
function removeDecorativeImages(root) {
  for (const selector of DECORATIVE_SELECTORS) {
    root.querySelectorAll(selector).forEach((element) => {
      if (element.tagName === 'IMG') element.remove();
    });
  }

  // Le immagini prive di qualunque sorgente non producono nulla di visibile.
  // Fanno eccezione i segnaposto dei contenuti interattivi: la loro sorgente
  // viene valorizzata più tardi, dalla fase di cattura, e rimuoverli qui li
  // farebbe sparire prima ancora che quella fase possa vederli.
  root
    .querySelectorAll(`img:not([src]):not([${SOURCE_ATTRIBUTE}]):not([${APP_ID_ATTRIBUTE}] img)`)
    .forEach((image) => image.remove());
}

/**
 * Rimuove i controlli sovrapposti all'immagine (scarica, condividi, ingrandisci).
 *
 * Gemini li inserisce dentro lo stesso contenitore dell'immagine: senza questa
 * pulizia comparirebbero nel documento come testo o riquadri vuoti.
 * @param {Element} root
 */
function unwrapImageContainers(root) {
  const controlSelectors = [
    '.generated-image-controls',
    '[hide-from-message-actions]',
    '[data-test-id="image-loading-overlay"]',
    '.shimmer-overlay',
    '.overlay-container',
    '.loader',
  ];

  for (const selector of controlSelectors) {
    root.querySelectorAll(selector).forEach((element) => {
      // Il contenitore va rimosso solo se non contiene l'immagine stessa.
      if (!element.querySelector('img')) element.remove();
    });
  }
}

/**
 * Impedisce che un'immagine ecceda la larghezza della pagina.
 *
 * Le immagini generate sono tipicamente 1024 px o più: senza un vincolo
 * sborderebbero dai margini sia nel PDF sia nel documento Word.
 * @param {Element} root
 */
function constrainDimensions(root) {
  root.querySelectorAll('img').forEach((image) => {
    // Gli attributi di dimensione del DOM riflettono il layout della pagina
    // web, non quello del documento: si rimuovono e si lascia decidere al
    // renderer, che conosce la larghezza utile.
    image.removeAttribute('width');
    image.removeAttribute('height');
    image.removeAttribute('style');
    image.setAttribute('data-max-width', String(IMAGE.maxWidthPx));
  });
}
