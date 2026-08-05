/**
 * Sanitizzazione HTML basata su ALLOWLIST.
 *
 * Perché è necessario (problema P0-1 dell'analisi): il contenuto della risposta
 * è generato da un modello linguistico e finisce in un documento `blob:` che il
 * browser esegue. Un prompt malevolo può indurre Gemini a emettere HTML
 * arbitrario. La vecchia implementazione usava una *denylist* di attributi
 * Angular, lasciando passare `on*`, `<script>`, `javascript:` e `<iframe>`.
 *
 * Qui invertiamo la logica: tutto ciò che non è esplicitamente permesso viene
 * rimosso. È l'unico approccio difendibile nel tempo.
 * @module gemini/sanitize/html-sanitizer
 */

import { createSafeHtml } from '../../core/model/safe-html.js';
import { isSvgDataUri, isRasterDataUri, sanitizeSvgDataUri } from './svg-data-uri.js';

/** Tag consentiti nel documento esportato: solo markup di contenuto. */
export const ALLOWED_TAGS = new Set([
  // Struttura testuale
  'p',
  'br',
  'hr',
  'div',
  'span',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'kbd',
  'samp',
  // Formattazione inline
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'ins',
  'mark',
  'sub',
  'sup',
  'small',
  'abbr',
  'cite',
  'q',
  // Liste
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  // Tabelle
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  // Link e immagini
  'a',
  'img',
  'figure',
  'figcaption',
  // Matematica (KaTeX genera markup annidato di span; MathML per completezza)
  'math',
  'semantics',
  'annotation',
  'mrow',
  'mi',
  'mo',
  'mn',
  'msup',
  'msub',
  'mfrac',
  'msqrt',
  'mroot',
  'mtable',
  'mtr',
  'mtd',
  'mspace',
  'mtext',
  // SVG usato da KaTeX per i delimitatori estensibili
  'svg',
  'path',
  'g',
  'line',
  'rect',
  'circle',
  'polyline',
  'polygon',
]);

/** Attributi consentiti su qualunque elemento. */
const GLOBAL_ATTRIBUTES = new Set([
  'class',
  'style',
  'title',
  'dir',
  'lang',
  // Attributi applicati dal normalizzatore delle immagini: la sorgente
  // originale, da scaricare più tardi, e la larghezza massima.
  'data-image-source',
  'data-max-width',
  // Segnaposto dei contenuti interattivi: la cattura avviene dopo la
  // sanitizzazione e ha bisogno di ritrovarli (vedi sanitize/embedded-apps.js).
  'data-embedded-app',
  'data-embedded-app-label',
  'data-capture-failed',
  // Sorgente LaTeX conservato dal normalizzatore delle formule: lo leggono i
  // formati che non sanno rendere KaTeX (vedi sanitize/katex.js).
  'data-latex',
]);

/**
 * Attributi consentiti per tag specifico.
 *
 * ⚠️ Le chiavi devono essere in MINUSCOLO: il parser HTML normalizza i nomi
 * degli attributi, quindi il confronto avviene sempre su `attributo.name`
 * minuscolizzato. Scrivere `viewBox` invece di `viewbox` significa che
 * l'attributo non verrà mai riconosciuto e finirà rimosso — con la conseguenza
 * che gli SVG perdono il sistema di coordinate e diventano invisibili
 * (vedi docs/BUGFIX-KATEX-FONTS.md). La costante SVG_CAMEL_CASE_ATTRIBUTES
 * ripristina la grafia corretta in uscita.
 */
const TAG_ATTRIBUTES = Object.freeze({
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td: new Set(['colspan', 'rowspan', 'align']),
  th: new Set(['colspan', 'rowspan', 'align', 'scope']),
  col: new Set(['span', 'width']),
  colgroup: new Set(['span']),
  ol: new Set(['start', 'type', 'reversed']),
  annotation: new Set(['encoding']),
  math: new Set(['xmlns', 'display']),
  svg: new Set([
    'xmlns',
    'width',
    'height',
    'viewbox',
    'preserveaspectratio',
    'style',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'focusable',
  ]),
  path: new Set(['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']),
  line: new Set(['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'stroke-linecap']),
  rect: new Set(['x', 'y', 'width', 'height', 'fill', 'stroke']),
  circle: new Set(['cx', 'cy', 'r', 'fill', 'stroke']),
  polyline: new Set(['points', 'fill', 'stroke', 'stroke-width']),
  polygon: new Set(['points', 'fill', 'stroke', 'stroke-width']),
  g: new Set(['transform', 'fill', 'stroke']),
});

/**
 * Attributi SVG la cui grafia camelCase è significativa.
 *
 * L'HTML normalizza i nomi in minuscolo, ma l'SVG è case-sensitive: un
 * `viewbox` tutto minuscolo viene ignorato dal motore di rendering esattamente
 * come se fosse assente. Dopo il filtro dell'allowlist ripristiniamo la grafia
 * corretta. Chiave: nome minuscolo · Valore: grafia da applicare.
 */
const SVG_CAMEL_CASE_ATTRIBUTES = Object.freeze({
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  patternunits: 'patternUnits',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  clippathunits: 'clipPathUnits',
  maskunits: 'maskUnits',
  markerwidth: 'markerWidth',
  markerheight: 'markerHeight',
});

/** Schemi URL accettati. `javascript:` e `data:` (tranne immagini) sono esclusi. */
const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:'];

/** Tag rimossi con tutto il loro contenuto (non solo "unwrapped"). */
const DANGEROUS_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'noscript',
]);

/**
 * Sanifica un elemento *in place* e restituisce il suo HTML come SafeHtml.
 *
 * @param {Element} root Elemento (tipicamente un clone) da sanificare.
 * @returns {import('../../core/model/safe-html.js').SafeHtml}
 */
export function sanitizeElement(root) {
  removeDangerousSubtrees(root);
  sanitizeTree(root);
  return createSafeHtml(root.innerHTML);
}

/**
 * Rimuove i sottoalberi pericolosi prima di qualunque altra elaborazione.
 * @param {Element} root
 */
function removeDangerousSubtrees(root) {
  const selector = Array.from(DANGEROUS_TAGS).join(',');
  root.querySelectorAll(selector).forEach((element) => element.remove());
}

/**
 * Percorre l'albero applicando l'allowlist.
 * I nodi con tag non consentito vengono "spacchettati" (i figli sopravvivono),
 * così non si perde testo legittimo dentro wrapper sconosciuti di Angular.
 * @param {Element} root
 */
function sanitizeTree(root) {
  // Snapshot: la lista viene modificata durante l'iterazione.
  const elements = Array.from(root.querySelectorAll('*'));

  for (const element of elements) {
    // Un nodo può essere stato rimosso da un'iterazione precedente (era figlio
    // di un elemento eliminato). Nota: non si può usare `isConnected`, perché
    // lavoriamo sempre su un clone staccato dal documento.
    if (!root.contains(element)) continue;

    const tag = element.tagName.toLowerCase();

    if (DANGEROUS_TAGS.has(tag)) {
      element.remove();
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(element);
      continue;
    }

    sanitizeAttributes(element, tag);
  }
}

/**
 * Applica l'allowlist degli attributi a un singolo elemento.
 * @param {Element} element
 * @param {string} tag
 */
function sanitizeAttributes(element, tag) {
  for (const attribute of Array.from(element.attributes)) {
    sanitizeAttribute(element, tag, attribute);
  }

  // I link esterni si aprono in sicurezza.
  if (tag === 'a' && element.hasAttribute('href')) {
    element.setAttribute('rel', 'noopener noreferrer');
  }
}

/**
 * Applica l'allowlist a un singolo attributo.
 *
 * Estratta da `sanitizeAttributes` per tenere ciascuna decisione isolata e
 * leggibile: le regole di sicurezza sono il punto in cui un errore costa di
 * più, e un ciclo con cinque rami annidati le rende difficili da verificare.
 *
 * @param {Element} element
 * @param {string} tag
 * @param {Attr} attribute
 */
function sanitizeAttribute(element, tag, attribute) {
  const name = attribute.name.toLowerCase();

  if (!isAttributeAllowed(tag, name)) {
    element.removeAttribute(attribute.name);
    return;
  }

  // KaTeX veicola i simboli estensibili (radici, graffe orizzontali) come
  // <img src="data:image/svg+xml,…">. Il payload viene sanificato e
  // reinserito: scartarlo cancellerebbe quei simboli dal documento.
  if (tag === 'img' && name === 'src' && isSvgDataUri(attribute.value)) {
    const cleaned = sanitizeSvgDataUri(attribute.value);
    if (cleaned) element.setAttribute('src', cleaned);
    else element.removeAttribute('src');
    return;
  }

  if (hasUnsafeValue(tag, name, attribute.value)) {
    element.removeAttribute(attribute.name);
    return;
  }

  restoreSvgAttributeCase(element, attribute.name, name);
}

/**
 * @param {string} tag
 * @param {string} name Nome dell'attributo, in minuscolo.
 * @returns {boolean}
 */
function isAttributeAllowed(tag, name) {
  return GLOBAL_ATTRIBUTES.has(name) || Boolean(TAG_ATTRIBUTES[tag]?.has(name));
}

/**
 * Valori pericolosi per attributi altrimenti consentiti: URL con schema non
 * sicuro e CSS con costrutti eseguibili.
 *
 * @param {string} tag
 * @param {string} name
 * @param {string} value
 * @returns {boolean}
 */
function hasUnsafeValue(tag, name, value) {
  if ((name === 'href' || name === 'src') && !isSafeUrl(value, tag)) return true;
  return name === 'style' && containsUnsafeCss(value);
}

/**
 * Ripristina la grafia camelCase degli attributi SVG normalizzati dal parser.
 *
 * `setAttribute` su un elemento HTML minuscolizza di nuovo il nome, quindi si
 * usa `setAttributeNS(null, …)`, che preserva la grafia richiesta dall'SVG.
 *
 * @param {Element} element
 * @param {string} originalName Nome così come appare nel DOM.
 * @param {string} lowercaseName Nome normalizzato in minuscolo.
 */
function restoreSvgAttributeCase(element, originalName, lowercaseName) {
  const canonical = SVG_CAMEL_CASE_ATTRIBUTES[lowercaseName];
  if (!canonical || originalName === canonical) return;

  const value = element.getAttribute(originalName);
  element.removeAttribute(originalName);
  element.setAttributeNS(null, canonical, value);
}

/**
 * @param {string} url
 * @param {string} tag
 * @returns {boolean}
 */
function isSafeUrl(url, tag) {
  const value = url.trim();
  if (value === '') return false;

  // Le immagini raster in base64 sono contenuto inerte: sempre accettate.
  // Gli SVG NON passano di qui: sono gestiti prima da sanitizeSvgDataUri,
  // perché possono contenere script e vanno ripuliti, non solo autorizzati.
  if (tag === 'img' && isRasterDataUri(value)) return true;
  // URL relativi o ancore: innocui.
  if (value.startsWith('#') || value.startsWith('/')) return true;

  try {
    const parsed = new URL(value, 'https://gemini.google.com');
    return SAFE_URL_SCHEMES.includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Blocca i vettori CSS noti (`expression()`, `url(javascript:)`, `behavior:`).
 * @param {string} css
 * @returns {boolean}
 */
function containsUnsafeCss(css) {
  const normalized = css.toLowerCase().replace(/\s+/g, '');
  return (
    normalized.includes('expression(') ||
    // eslint-disable-next-line no-script-url -- pattern da bloccare, non da eseguire
    normalized.includes('javascript:') ||
    normalized.includes('behavior:') ||
    normalized.includes('-moz-binding')
  );
}

/**
 * Sostituisce un elemento con i suoi figli, preservando il contenuto.
 * Implementazione corretta del vecchio `_unwrapResponseElements`, che
 * sostituiva erroneamente il nodo *genitore* (bug P0-3).
 * @param {Element} element
 */
export function unwrap(element) {
  const parent = element.parentNode;
  if (!parent) return;

  const fragment = element.ownerDocument.createDocumentFragment();
  while (element.firstChild) fragment.appendChild(element.firstChild);
  parent.replaceChild(fragment, element);
}
