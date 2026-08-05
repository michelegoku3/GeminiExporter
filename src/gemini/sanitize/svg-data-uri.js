/**
 * Sanitizzazione degli SVG trasportati come data URI.
 *
 * Perché serve un modulo dedicato
 * -------------------------------
 * KaTeX disegna i simboli estensibili (barra della radice, graffe orizzontali,
 * frecce) con un tracciato SVG. Gemini però non lo inserisce come `<svg>`
 * inline: lo incapsula in un'immagine
 *
 *   <img class="katex-svg" src="data:image/svg+xml;utf8,<svg …><path …/></svg>">
 *
 * Un data URI `image/svg+xml` non è un'immagine inerte come un PNG: è un
 * documento che può contenere `<script>`, `onload=` o riferimenti esterni.
 * Accettarlo senza controlli riaprirebbe la falla XSS che il sanitizer esiste
 * per chiudere; rifiutarlo del tutto — come faceva la versione precedente —
 * cancella le radici e le graffe dal PDF.
 *
 * La soluzione è decodificare il payload, applicargli la stessa allowlist usata
 * per il resto del documento e ricodificarlo. Il tracciato sopravvive, il
 * codice eseguibile no.
 * @module gemini/sanitize/svg-data-uri
 */

/**
 * Prefisso dei data URI che trasportano un SVG.
 *
 * Accetta qualunque sequenza di parametri prima della virgola, perché nella
 * pratica se ne incontrano diverse forme: KaTeX/Gemini emette `;utf8` (non
 * standard ma universalmente supportato), altri produttori usano
 * `;charset=utf-8` oppure nessun parametro. L'unico che cambia il trattamento
 * del payload è `base64`.
 */
const SVG_DATA_URI = /^data:image\/svg\+xml([^,]*),([\s\S]*)$/i;

/** Immagini raster: contenuto inerte, nessun rischio di esecuzione. */
const RASTER_DATA_URI = /^data:image\/(png|jpe?g|gif|webp|avif)\s*;\s*base64\s*,/i;

/** Elementi ammessi dentro un SVG. Solo primitive di disegno. */
const ALLOWED_SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'line',
  'rect',
  'circle',
  'ellipse',
  'polyline',
  'polygon',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'use',
  'symbol',
  'title',
  'desc',
  'tspan',
  'text',
]);

/**
 * Attributi ammessi dentro un SVG, in minuscolo.
 * Nessun `on*`, nessun `href`/`xlink:href` (che permetterebbe `javascript:`).
 */
const ALLOWED_SVG_ATTRIBUTES = new Set([
  'xmlns',
  'xmlns:xlink',
  'version',
  'class',
  'id',
  'style',
  'width',
  'height',
  'viewbox',
  'preserveaspectratio',
  'd',
  'points',
  'transform',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'dx',
  'dy',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientunits',
  'gradienttransform',
  'clippathunits',
  'maskunits',
  'text-anchor',
  'font-size',
  'font-family',
  'aria-hidden',
  'focusable',
]);

/**
 * Grafia canonica degli attributi SVG case-sensitive.
 * Il parser normalizza i nomi in minuscolo, ma l'SVG li distingue: un
 * `viewbox` minuscolo viene ignorato e il disegno risulta invisibile.
 */
const CANONICAL_CASE = Object.freeze({
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  clippathunits: 'clipPathUnits',
  maskunits: 'maskUnits',
  'xmlns:xlink': 'xmlns:xlink',
});

/**
 * @param {string} value Valore dell'attributo `src`.
 * @returns {boolean} true se è un data URI SVG.
 */
export function isSvgDataUri(value) {
  return SVG_DATA_URI.test(value.trim());
}

/**
 * @param {string} value
 * @returns {boolean} true se è un'immagine raster in base64 (sempre sicura).
 */
export function isRasterDataUri(value) {
  return RASTER_DATA_URI.test(value.trim());
}

/**
 * Decodifica, sanifica e ricodifica un data URI SVG.
 *
 * @param {string} value Data URI originale.
 * @returns {string|null} Data URI ripulito, oppure null se non recuperabile.
 */
export function sanitizeSvgDataUri(value) {
  const match = SVG_DATA_URI.exec(value.trim());
  if (!match) return null;

  const [, parameters, payload] = match;
  const isBase64 = /(^|;)\s*base64\s*$/i.test(parameters);

  const markup = decodePayload(payload, isBase64);
  if (!markup) return null;

  const cleanMarkup = sanitizeSvgMarkup(markup);
  if (!cleanMarkup) return null;

  // Si ricodifica sempre in percent-encoding: è compatto, non richiede base64
  // e non lascia caratteri che possano chiudere l'attributo HTML.
  return `data:image/svg+xml,${encodeURIComponent(cleanMarkup)}`;
}

/**
 * @param {string} payload
 * @param {boolean} isBase64
 * @returns {string} Markup SVG, stringa vuota se la decodifica fallisce.
 */
function decodePayload(payload, isBase64) {
  try {
    if (isBase64) return atob(payload);
    // I data URI non base64 possono essere percent-encoded, in tutto o in parte.
    return decodeURIComponent(payload);
  } catch {
    // Payload malformato: si prova comunque a usarlo come testo grezzo, perché
    // Gemini talvolta lascia caratteri non codificati (es. "<" letterale).
    return isBase64 ? '' : payload;
  }
}

/**
 * Applica l'allowlist al markup SVG decodificato.
 *
 * @param {string} markup
 * @returns {string|null} Markup ripulito, o null se non contiene un SVG valido.
 */
function sanitizeSvgMarkup(markup) {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');

  // `parsererror` indica markup non valido: meglio scartare che indovinare.
  if (parsed.querySelector('parsererror')) return null;

  const root = parsed.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;

  cleanNode(root);

  // Un SVG senza contenuto disegnabile non serve a nulla.
  if (!root.querySelector('path, line, rect, circle, ellipse, polyline, polygon, text, use')) {
    return null;
  }

  return new XMLSerializer().serializeToString(root);
}

/**
 * Ripulisce ricorsivamente un nodo SVG e i suoi discendenti.
 * @param {Element} element
 */
function cleanNode(element) {
  for (const child of Array.from(element.children)) {
    if (!ALLOWED_SVG_TAGS.has(child.tagName.toLowerCase())) {
      child.remove();
      continue;
    }
    cleanNode(child);
  }

  cleanAttributes(element);
}

/**
 * @param {Element} element
 */
function cleanAttributes(element) {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();

    // Qualunque gestore di eventi, qualunque riferimento navigabile.
    const isDangerous =
      name.startsWith('on') ||
      name === 'href' ||
      name === 'xlink:href' ||
      /(javascript|data):/i.test(attribute.value);

    if (isDangerous || !ALLOWED_SVG_ATTRIBUTES.has(name)) {
      element.removeAttribute(attribute.name);
      continue;
    }

    restoreCase(element, attribute.name, name);
  }
}

/**
 * @param {Element} element
 * @param {string} originalName
 * @param {string} lowercaseName
 */
function restoreCase(element, originalName, lowercaseName) {
  const canonical = CANONICAL_CASE[lowercaseName];
  if (!canonical || originalName === canonical) return;

  const value = element.getAttribute(originalName);
  element.removeAttribute(originalName);
  element.setAttribute(canonical, value);
}
