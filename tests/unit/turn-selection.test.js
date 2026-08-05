/**
 * Test della modalità di selezione manuale dei turni.
 *
 * Il comportamento chiave è che un turno di Gemini è una **coppia**
 * domanda-risposta: cliccare l'una o l'altra deve selezionare entrambe, perché
 * una risposta senza la domanda che l'ha generata è incomprensibile.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTurnSelection } from '../../src/extension/content/turn-selection.js';
import { UI_CLASS } from '../../src/shared/config.js';

/** Due turni completi, con la struttura reale di Gemini. */
function buildPage() {
  document.body.innerHTML = `
    <div class="conversation-container" id="t1">
      <user-query><span class="query-text-line">Prima domanda</span></user-query>
      <model-response><div class="markdown">Prima risposta</div></model-response>
    </div>
    <div class="conversation-container" id="t2">
      <user-query><span class="query-text-line">Seconda domanda</span></user-query>
      <model-response><div class="markdown">Seconda risposta</div></model-response>
      <message-actions>
        <div class="${UI_CLASS.buttonWrapper}">
          <button class="${UI_CLASS.button}" id="export-btn"><svg></svg></button>
        </div>
      </message-actions>
    </div>`;
}

/** @param {string} selector */
function click(selector) {
  document
    .querySelector(selector)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.className = '';
  buildPage();
});

describe('attivazione della modalità', () => {
  it('marca il documento mentre la selezione è attiva', () => {
    const selection = createTurnSelection({ document });

    selection.enable();
    expect(document.body.classList.contains(UI_CLASS.selectionMode)).toBe(true);
    expect(selection.isActive()).toBe(true);

    selection.disable();
    expect(document.body.classList.contains(UI_CLASS.selectionMode)).toBe(false);
    expect(selection.isActive()).toBe(false);
  });

  it('ignora i clic finché non è attiva', () => {
    const selection = createTurnSelection({ document });

    click('#t1 model-response');

    expect(selection.count()).toBe(0);
  });
});

describe('selezione della coppia domanda-risposta', () => {
  it('seleziona l\u2019intero turno cliccando la risposta', () => {
    const selection = createTurnSelection({ document });
    selection.enable();

    click('#t1 .markdown');

    // È l'intero contenitore a essere marcato: l'evidenza verde si propaga
    // per ereditarietà a domanda e risposta insieme.
    expect(document.querySelector('#t1').classList.contains(UI_CLASS.turnSelected)).toBe(true);
    expect(selection.count()).toBe(1);
  });

  it('seleziona l\u2019intero turno cliccando la domanda', () => {
    const selection = createTurnSelection({ document });
    selection.enable();

    click('#t1 .query-text-line');

    expect(document.querySelector('#t1').classList.contains(UI_CLASS.turnSelected)).toBe(true);
    expect(selection.selected()).toEqual([document.querySelector('#t1')]);
  });

  it('deseleziona al secondo clic', () => {
    const selection = createTurnSelection({ document });
    selection.enable();

    click('#t1 .markdown');
    click('#t1 .markdown');

    expect(document.querySelector('#t1').classList.contains(UI_CLASS.turnSelected)).toBe(false);
    expect(selection.count()).toBe(0);
  });

  it('impedisce che il clic raggiunga Gemini', () => {
    // Senza questo, il clic attiverebbe i menu e i pulsanti dell'interfaccia.
    const selection = createTurnSelection({ document });
    selection.enable();

    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('#t1 .markdown').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('ignora i clic fuori dai turni', () => {
    const selection = createTurnSelection({ document });
    selection.enable();

    document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(selection.count()).toBe(0);
  });
});

describe('ordine e stato', () => {
  it('restituisce i turni in ordine di pagina, non di clic', () => {
    // Il documento deve rispettare la cronologia della conversazione.
    const selection = createTurnSelection({ document });
    selection.enable();

    click('#t2 .markdown');
    click('#t1 .markdown');

    expect(selection.selected().map((turn) => turn.id)).toEqual(['t1', 't2']);
  });

  it('notifica ogni cambio di selezione', () => {
    const onChange = vi.fn();
    const selection = createTurnSelection({ document, onChange });
    selection.enable();

    click('#t1 .markdown');
    click('#t2 .markdown');
    click('#t1 .markdown');

    expect(onChange.mock.calls.map(([count]) => count)).toEqual([1, 2, 1]);
  });

  it('rimuove ogni evidenza uscendo dalla modalità', () => {
    // Lasciare i messaggi colorati dopo l'uscita darebbe l'impressione che la
    // modalità sia ancora attiva.
    const selection = createTurnSelection({ document });
    selection.enable();
    click('#t1 .markdown');

    selection.disable();

    expect(document.querySelectorAll(`.${UI_CLASS.turnSelected}`)).toHaveLength(0);
    expect(selection.count()).toBe(0);
  });

  it('esce dalla modalità premendo Esc', () => {
    const selection = createTurnSelection({ document });
    selection.enable();
    click('#t1 .markdown');

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(selection.isActive()).toBe(false);
    expect(document.querySelectorAll(`.${UI_CLASS.turnSelected}`)).toHaveLength(0);
  });

  it('non lascia listener attivi dopo la disattivazione', () => {
    const selection = createTurnSelection({ document });
    selection.enable();
    selection.disable();

    click('#t1 .markdown');

    expect(selection.count()).toBe(0);
  });
});

describe('controlli dell\u2019estensione durante la selezione', () => {
  /**
   * Il pulsante di esportazione vive DENTRO il turno. Intercettarne il clic lo
   * rende irraggiungibile: l'utente resta chiuso nella modalità, potendo solo
   * selezionare e deselezionare. È il difetto descritto in
   * docs/BUGFIX-SELEZIONE-PULSANTE.md.
   */
  it('lascia cliccabile il pulsante di esportazione', () => {
    const selection = createTurnSelection({ document });
    selection.enable();

    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('#export-btn').dispatchEvent(event);

    // Il clic arriva al pulsante: non è annullato...
    expect(event.defaultPrevented).toBe(false);
    // ...e non ha selezionato il turno che lo contiene.
    expect(selection.count()).toBe(0);
  });

  it('lascia cliccabile anche l\u2019icona dentro il pulsante', () => {
    // Il bersaglio reale del clic è spesso l'SVG, non il <button>.
    const selection = createTurnSelection({ document });
    selection.enable();

    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('#export-btn svg').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(selection.count()).toBe(0);
  });

  it('continua a selezionare il resto del turno', () => {
    // L'eccezione riguarda i soli controlli dell'estensione: il contenuto del
    // turno resta selezionabile come prima.
    const selection = createTurnSelection({ document });
    selection.enable();

    click('#t2 .markdown');

    expect(selection.count()).toBe(1);
  });
});

describe('selezione vuota', () => {
  /**
   * Chi preme 📄 senza aver scelto nulla ha probabilmente sbagliato modalità.
   * Rimandarlo al dialogo è più utile di un rimprovero: `exportSelection`
   * segnala l'assenza di scelte con `false` e il chiamante decide.
   */
  it('la selezione parte vuota', () => {
    const selection = createTurnSelection({ document });
    selection.enable();

    expect(selection.selected()).toEqual([]);
    expect(selection.count()).toBe(0);
  });

  it('torna vuota dopo aver deselezionato tutto', () => {
    const selection = createTurnSelection({ document });
    selection.enable();

    click('#t1 .markdown');
    click('#t1 .markdown');

    expect(selection.selected()).toEqual([]);
  });
});
