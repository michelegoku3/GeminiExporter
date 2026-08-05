/**
 * Iniezione del pulsante di esportazione nella barra azioni di Gemini.
 *
 * Un solo pulsante per turno: al clic apre il dialogo che raccoglie ambito e
 * formato. Questo modulo si occupa solo di DOM e stati visivi; la scelta e
 * l'esportazione arrivano dall'esterno come callback.
 * @module extension/content/button-injector
 */

import { UI_CLASS, TIMING } from '../../shared/config.js';
import { queryFirst } from '../../gemini/dom-query.js';
import { DOCUMENT_ICON } from './icons.js';

/**
 * @param {object} deps
 * @param {(feedback: FeedbackHandle, turnElement: Element) => Promise<void>} deps.onActivate
 *   Invocata al clic. Riceve i comandi di feedback visivo e il turno di origine.
 * @param {Document} [deps.document]
 * @param {import('../../shared/logger.js').Logger} deps.logger
 */
export function createButtonInjector({ onActivate, document: doc = globalThis.document, logger }) {
  return {
    /**
     * Aggiunge il pulsante al turno indicato, se la barra azioni esiste.
     * @param {Element} turnElement
     * @returns {boolean} true se l'iniezione è avvenuta.
     */
    injectInto(turnElement) {
      const actionsBar = queryFirst(turnElement, 'actionsBar', { logger });
      if (!actionsBar) {
        logger.debug('Barra azioni non trovata per questo turno: pulsante non iniettato.');
        return false;
      }
      if (actionsBar.querySelector(`.${UI_CLASS.buttonWrapper}`)) return false;

      const wrapper = doc.createElement('div');
      wrapper.className = UI_CLASS.buttonWrapper;
      wrapper.appendChild(createButton(doc, (feedback) => onActivate(feedback, turnElement)));

      actionsBar.insertBefore(wrapper, actionsBar.firstChild);
      return true;
    },
  };
}

/**
 * @typedef {object} FeedbackHandle
 * @property {() => void} start Mostra l'animazione di attesa.
 * @property {() => void} succeed Mostra la conferma di riuscita.
 * @property {() => void} stop Ripristina lo stato iniziale.
 */

/**
 * @param {Document} doc
 * @param {(feedback: FeedbackHandle) => Promise<void>} onActivate
 * @returns {HTMLButtonElement}
 */
function createButton(doc, onActivate) {
  const label = 'Esporta conversazione';

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = UI_CLASS.button;
  button.title = label;
  button.setAttribute('aria-label', label);
  // Il pulsante apre un dialogo: lo dichiariamo alle tecnologie assistive.
  button.setAttribute('aria-haspopup', 'dialog');
  button.innerHTML = DOCUMENT_ICON;

  let busy = false;

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    busy = true;

    try {
      // Il chiamante controlla quando inizia il lavoro vero: mentre il dialogo
      // è aperto si attende l'utente, e un'animazione di caricamento
      // comunicherebbe il contrario.
      await onActivate(createFeedbackHandle(button));
    } finally {
      busy = false;
      button.classList.remove(UI_CLASS.loading);
      button.disabled = false;
    }
  });

  return button;
}

/**
 * Comandi di feedback visivo consegnati al chiamante.
 * @param {HTMLButtonElement} button
 */
function createFeedbackHandle(button) {
  return {
    /** L'esportazione è iniziata: mostra l'animazione di attesa. */
    start() {
      button.classList.add(UI_CLASS.loading);
      button.disabled = true;
    },

    /** L'esportazione è riuscita: conferma visiva temporanea. */
    succeed() {
      button.classList.remove(UI_CLASS.loading);
      button.disabled = false;
      button.classList.add(UI_CLASS.success);
      setTimeout(() => button.classList.remove(UI_CLASS.success), TIMING.buttonSuccessMs);
    },

    /** L'esportazione è fallita o è stata annullata: nessuna conferma. */
    stop() {
      button.classList.remove(UI_CLASS.loading);
      button.disabled = false;
    },
  };
}
