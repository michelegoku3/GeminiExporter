/**
 * Modalità di selezione manuale dei turni.
 *
 * L'utente indica cosa esportare cliccando direttamente i messaggi nella
 * pagina. Un turno di Gemini è però una **coppia** domanda-risposta: cliccare
 * l'una o l'altra seleziona entrambe, perché esportare una risposta senza la
 * domanda che l'ha generata produrrebbe un documento incomprensibile.
 *
 * Lo stato vive qui e non nelle preferenze: è legato alla pagina aperta e non
 * ha senso conservarlo fra una sessione e l'altra.
 * @module extension/content/turn-selection
 */

import { UI_CLASS } from '../../shared/config.js';
import { SELECTORS } from '../../gemini/selectors.js';

/**
 * @typedef {object} TurnSelection
 * @property {() => void} enable Attiva la modalità di selezione.
 * @property {() => void} disable Disattiva la modalità e rimuove le evidenze.
 * @property {() => boolean} isActive
 * @property {() => Element[]} selected Turni scelti, in ordine di pagina.
 * @property {() => number} count
 * @property {() => void} clear Azzera la selezione mantenendo la modalità.
 */

/**
 * @param {object} [deps]
 * @param {Document} [deps.document]
 * @param {(count: number) => void} [deps.onChange] Notifica il cambio di
 *   selezione, per aggiornare il messaggio mostrato all'utente.
 * @returns {TurnSelection}
 */
export function createTurnSelection({
  document: doc = globalThis.document,
  onChange = () => {},
} = {}) {
  /**
   * Turni scelti.
   *
   * Un `Set` di elementi e non di indici: la cronologia di Gemini è virtuale e
   * gli indici cambiano quando l'utente scorre, mentre il riferimento al nodo
   * resta valido finché il nodo esiste.
   * @type {Set<Element>}
   */
  const chosen = new Set();

  let active = false;

  /** @param {MouseEvent} event */
  function onClick(event) {
    // I controlli dell'estensione restano interattivi: il pulsante di export
    // vive DENTRO il turno, e intercettarlo qui lo renderebbe irraggiungibile
    // — l'utente resterebbe chiuso nella modalità, potendo solo selezionare e
    // deselezionare. Vedi docs/BUGFIX-SELEZIONE-PULSANTE.md.
    if (isOwnControl(event.target)) return;

    const turn = turnFrom(event.target);
    if (!turn) return;

    // In modalità selezione il clic non deve raggiungere Gemini: aprirebbe i
    // suoi menu contestuali o attiverebbe i pulsanti della barra azioni.
    event.preventDefault();
    event.stopPropagation();

    toggle(chosen, turn);
    onChange(chosen.size);
  }

  /**
   * Esc annulla la selezione: è la stessa scorciatoia del dialogo, e chi la
   * conosce non deve impararne un'altra.
   * @param {KeyboardEvent} event
   */
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    disable();
    onChange(0);
  };

  /**
   * Attiva o disattiva l'ascolto degli eventi.
   *
   * I gestori si registrano in **fase di cattura**: vedono l'evento prima di
   * Gemini e possono impedirne la propagazione.
   *
   * @param {boolean} listening
   */
  function listen(listening) {
    const apply = listening ? 'addEventListener' : 'removeEventListener';
    doc[apply]('click', onClick, true);
    doc[apply]('keydown', onKeyDown, true);
    doc.body.classList.toggle(UI_CLASS.selectionMode, listening);
  }

  function enable() {
    if (active) return;
    active = true;
    listen(true);
  }

  function disable() {
    if (!active) return;
    active = false;
    listen(false);
    clear();
  }

  function clear() {
    for (const turn of chosen) turn.classList.remove(UI_CLASS.turnSelected);
    chosen.clear();
  }

  return {
    enable,
    disable,
    clear,
    isActive: () => active,
    count: () => chosen.size,

    /**
     * I turni in ordine di pagina, non di selezione: il documento deve
     * rispettare la cronologia della conversazione, non l'ordine dei clic.
     * @returns {Element[]}
     */
    selected() {
      const all = Array.from(doc.querySelectorAll(turnSelector()));
      return all.filter((turn) => chosen.has(turn));
    },
  };
}

/** @returns {string} Selettore che individua un turno completo. */
function turnSelector() {
  return SELECTORS.conversationTurn.candidates.join(', ');
}

/**
 * Aggiunge o rimuove un turno dalla selezione, aggiornandone l'evidenza.
 *
 * @param {Set<Element>} chosen
 * @param {Element} turn
 */
function toggle(chosen, turn) {
  const wasChosen = chosen.has(turn);

  if (wasChosen) chosen.delete(turn);
  else chosen.add(turn);

  turn.classList.toggle(UI_CLASS.turnSelected, !wasChosen);
}

/**
 * Riconosce i controlli iniettati dall'estensione.
 *
 * Sono gli unici elementi che devono continuare a rispondere normalmente
 * durante la selezione: senza questa eccezione la modalità non avrebbe via
 * d'uscita, perché il comando che la conclude è esso stesso dentro un turno.
 *
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
function isOwnControl(target) {
  if (!(target instanceof Element)) return false;

  const ownControls = [UI_CLASS.buttonWrapper, UI_CLASS.dialogHost, UI_CLASS.toast]
    .map((className) => `.${className}`)
    .join(', ');

  return target.closest(ownControls) !== null;
}

/**
 * Il turno che contiene l'elemento indicato.
 * @param {EventTarget|null} target
 * @returns {Element|null}
 */
function turnFrom(target) {
  if (!(target instanceof Element)) return null;
  return target.closest(turnSelector());
}
