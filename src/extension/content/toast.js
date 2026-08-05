/**
 * Notifiche temporanee mostrate nella pagina di Gemini.
 * @module extension/content/toast
 */

import { UI_CLASS, TIMING } from '../../shared/config.js';

/** @typedef {'success'|'error'|'info'} ToastType */

/**
 * @param {object} [deps]
 * @param {Document} [deps.document]
 */
export function createToaster({ document: doc = globalThis.document } = {}) {
  /** @type {number|undefined} */
  let hideTimer;

  return {
    /**
     * @param {string} message
     * @param {ToastType} [type]
     */
    show(message, type = 'success') {
      doc.querySelector(`.${UI_CLASS.toast}`)?.remove();
      clearTimeout(hideTimer);

      const toast = doc.createElement('div');
      toast.className = `${UI_CLASS.toast} ${UI_CLASS.toast}-${type}`;
      toast.setAttribute('role', 'status');
      toast.textContent = message;
      doc.body.appendChild(toast);

      // Doppio rAF: garantisce che la transizione CSS parta dallo stato iniziale.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add(UI_CLASS.toastVisible));
      });

      hideTimer = setTimeout(() => {
        toast.classList.remove(UI_CLASS.toastVisible);
        setTimeout(() => toast.remove(), TIMING.toastFadeMs);
      }, TIMING.toastVisibleMs);
    },
  };
}
