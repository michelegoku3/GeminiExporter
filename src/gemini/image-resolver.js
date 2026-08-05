/**
 * Risoluzione delle immagini in dati incorporabili.
 *
 * PERCHÉ SERVE
 * ------------
 * Le immagini generate da Gemini hanno `src="blob:https://gemini.google.com/…"`.
 * Un URL `blob:` è una referenza valida **solo nella sessione della pagina che
 * l'ha creata**: nel documento esportato — che vive in un'altra scheda, o in un
 * file `.docx` aperto giorni dopo — non punta più a nulla.
 *
 * Lo stesso vale, in misura minore, per le immagini servite da
 * `googleusercontent.com`: restano raggiungibili solo finché l'utente è
 * autenticato e la risorsa non scade.
 *
 * Le immagini vengono quindi **scaricate e convertite in data URI** durante
 * l'estrazione, così i dati viaggiano dentro il documento. È lo stesso
 * principio già applicato ai font KaTeX: un export deve restare leggibile
 * offline e a distanza di tempo.
 *
 * Questo modulo non conosce i formati di destinazione: produce data URI, che
 * il renderer HTML incorpora così come sono e quello Word converte in parti
 * del pacchetto OOXML.
 * @module gemini/image-resolver
 */

import { IMAGE, TIMING } from '../shared/config.js';
import { SOURCE_ATTRIBUTE } from './sanitize/images.js';
import { logger as defaultLogger } from '../shared/logger.js';

/** Schemi che non richiedono conversione: i dati sono già incorporati. */
const ALREADY_EMBEDDED = /^data:/i;

/**
 * Crea il risolutore di immagini.
 *
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchFn]
 * @param {import('../shared/logger.js').Logger} [deps.logger]
 * @param {(blob: Blob) => Promise<string>} [deps.readAsDataUrl] Conversione
 *   blob → data URI, iniettabile per i test.
 */
export function createImageResolver({
  fetchFn = globalThis.fetch?.bind(globalThis),
  logger = defaultLogger,
  readAsDataUrl = blobToDataUrl,
} = {}) {
  /**
   * Cache per URL: la stessa immagine può comparire più volte in una
   * conversazione, e riscaricarla sarebbe uno spreco.
   * @type {Map<string, Promise<string|null>>}
   */
  const cache = new Map();

  /**
   * Converte un URL in data URI.
   * @param {string} url
   * @returns {Promise<string|null>} null se l'immagine non è recuperabile.
   */
  async function resolve(url) {
    if (ALREADY_EMBEDDED.test(url)) return url;

    if (!cache.has(url)) cache.set(url, download(url));
    return cache.get(url);
  }

  /**
   * @param {string} url
   * @returns {Promise<string|null>}
   */
  async function download(url) {
    try {
      const response = await withTimeout(fetchFn(url), TIMING.imageFetchMs);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();

      if (blob.size > IMAGE.maxBytes) {
        logger.warn(
          `Immagine ignorata: ${Math.round(blob.size / 1024)} KB supera il limite di ` +
            `${Math.round(IMAGE.maxBytes / 1024)} KB.`
        );
        return null;
      }

      return await readAsDataUrl(blob);
    } catch (error) {
      // Un'immagine mancante non deve impedire l'esportazione del testo.
      logger.warn(`Immagine non recuperata (${url.slice(0, 60)}):`, error);
      return null;
    }
  }

  return {
    resolve,

    /**
     * Converte in data URI tutte le immagini di un sottoalbero.
     *
     * Le immagini non recuperabili vengono rimosse: un `<img>` con una
     * sorgente non valida produrrebbe un riquadro rotto nel documento.
     *
     * @param {Element} root Elemento da elaborare, modificato in place.
     * @returns {Promise<{ resolved: number, failed: number }>}
     */
    async embedAll(root) {
      // La sorgente originale è stata spostata in un attributo dedicato dal
      // normalizzatore: `src` è vuota proprio perché l'URL non è utilizzabile
      // fuori dalla sessione di Gemini.
      const images = Array.from(root.querySelectorAll(`img[${SOURCE_ATTRIBUTE}], img[src]`));
      let resolved = 0;
      let failed = 0;

      // Le immagini si scaricano in parallelo: sono indipendenti fra loro.
      await Promise.all(
        images.map(async (image) => {
          const source = image.getAttribute(SOURCE_ATTRIBUTE) ?? image.getAttribute('src');
          const dataUrl = source ? await resolve(source) : null;

          if (dataUrl) {
            image.setAttribute('src', dataUrl);
            image.removeAttribute(SOURCE_ATTRIBUTE);
            resolved += 1;
          } else {
            // Un'immagine senza dati produrrebbe un riquadro rotto.
            image.remove();
            failed += 1;
          }
        })
      );

      return { resolved, failed };
    },
  };
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>} Data URI con il contenuto in base64.
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('lettura fallita'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Interrompe un'attesa troppo lunga.
 *
 * Un'immagine che non risponde bloccherebbe l'intera esportazione: meglio
 * perdere quell'immagine che lasciare l'utente in attesa indefinita.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} milliseconds
 * @returns {Promise<T>}
 */
function withTimeout(promise, milliseconds) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('tempo scaduto')), milliseconds)),
  ]);
}
