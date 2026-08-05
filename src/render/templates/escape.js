/**
 * Escaping del testo destinato all'HTML.
 *
 * Implementazione pura (niente DOM), così i template sono utilizzabili anche
 * in un service worker o in un test Node senza jsdom.
 * @module render/templates/escape
 */

const ENTITIES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

/**
 * @param {unknown} value
 * @returns {string} Testo sicuro da interpolare nel markup.
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ENTITIES[character]);
}
