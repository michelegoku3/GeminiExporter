/**
 * Test del dialogo di esportazione.
 *
 * È il nuovo punto di ingresso dell'interazione: raccoglie ambito e formato e
 * li restituisce al chiamante. I test coprono la selezione, l'annullamento,
 * l'accessibilità da tastiera e il fatto che le opzioni non disponibili non
 * siano scegliibili.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listDocumentOptions } from '../../src/shared/document-options.js';
import { createExportDialog } from '../../src/extension/content/export-dialog.js';
import { UI_CLASS } from '../../src/shared/config.js';
import { EXPORT_SCOPES } from '../../src/shared/export-scopes.js';
import { EXPORT_FORMATS } from '../../src/shared/export-formats.js';

/** @returns {ShadowRoot} */
function shadow() {
  const host = document.querySelector(`.${UI_CLASS.dialogHost}`);
  if (!host) throw new Error('Dialogo non montato');
  return host.shadowRoot;
}

/**
 * @param {string} action
 */
function click(action) {
  shadow().querySelector(`[data-action="${action}"]`).click();
}

/**
 * @param {'scope'|'format'} group
 * @param {string} value
 */
function choose(group, value) {
  const input = shadow().querySelector(`input[name="${group}"][value="${value}"]`);
  input.checked = true;
  input.dispatchEvent(new Event('change'));
}

/** @param {string} key */
function pressKey(key, init = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

let dialog;

beforeEach(() => {
  document.body.innerHTML = '';
  dialog = createExportDialog();
});

afterEach(() => {
  dialog.close();
});

describe('apertura e struttura', () => {
  it('monta il dialogo in uno shadow root isolato dagli stili di Gemini', () => {
    dialog.open();

    const host = document.querySelector(`.${UI_CLASS.dialogHost}`);
    expect(host).not.toBeNull();
    expect(host.shadowRoot).not.toBeNull();
    // Gli stili viaggiano dentro lo shadow root, non nel documento ospite.
    expect(host.shadowRoot.querySelector('style')).not.toBeNull();
  });

  it('espone il ruolo dialog per le tecnologie assistive', () => {
    dialog.open();

    const box = shadow().querySelector('[role="dialog"]');
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(box.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('elenca tutti gli ambiti e tutti i formati del registry', () => {
    dialog.open();

    for (const scope of Object.values(EXPORT_SCOPES)) {
      expect(shadow().querySelector(`input[name="scope"][value="${scope.id}"]`)).not.toBeNull();
    }
    for (const format of Object.values(EXPORT_FORMATS)) {
      expect(shadow().querySelector(`input[name="format"][value="${format.id}"]`)).not.toBeNull();
    }
  });

  it('rende selezionabili tutti gli ambiti disponibili', () => {
    dialog.open();

    expect(shadow().querySelector('input[name="scope"][value="selection"]').disabled).toBe(false);
    expect(shadow().querySelector('input[name="format"][value="word"]').disabled).toBe(false);
  });

  it('etichetta il pulsante «Seleziona» per gli ambiti differiti', () => {
    // «Scegli i turni…» non esporta: apre la scelta sulla pagina. L'etichetta
    // lo anticipa, così l'utente sa cosa aspettarsi prima di premere.
    dialog.open({ scope: 'selection' });

    expect(shadow().querySelector('[data-action="confirm"]').textContent).toBe('Seleziona');
  });

  it('torna a «Esporta» cambiando ambito', () => {
    dialog.open({ scope: 'selection' });

    const turn = shadow().querySelector('input[name="scope"][value="turn"]');
    turn.checked = true;
    turn.dispatchEvent(new window.Event('change'));

    expect(shadow().querySelector('[data-action="confirm"]').textContent).toBe('Esporta');
  });

  it('rimuove ogni traccia dal DOM alla chiusura', () => {
    dialog.open();
    dialog.close();

    expect(document.querySelector(`.${UI_CLASS.dialogHost}`)).toBeNull();
    expect(dialog.isOpen()).toBe(false);
  });
});

describe('selezione', () => {
  it('restituisce le scelte dell\u2019utente alla conferma', async () => {
    const result = dialog.open();

    choose('scope', 'conversation');
    choose('format', 'pdf');
    click('confirm');

    await expect(result).resolves.toMatchObject({ scope: 'conversation', format: 'pdf' });
  });

  it('preseleziona i valori forniti dal chiamante', () => {
    dialog.open({ scope: 'conversation', format: 'pdf' });

    expect(shadow().querySelector('input[name="scope"][value="conversation"]').checked).toBe(true);
    expect(shadow().querySelector('input[name="format"][value="pdf"]').checked).toBe(true);
  });

  it('ignora un formato preferito non più disponibile', () => {
    // Scenario reale: una preferenza salvata da una versione futura o ritirata.
    dialog.open({ format: 'formato-inesistente' });

    expect(shadow().querySelector('input[name="format"][value="pdf"]').checked).toBe(true);
    // Nessun formato inesistente resta selezionato: si ricade sul predefinito.
    expect(shadow().querySelector('input[name="format"][value="pdf"]').checked).toBe(true);
  });

  it('usa i valori predefiniti quando non ne riceve', async () => {
    const result = dialog.open();
    click('confirm');

    await expect(result).resolves.toMatchObject({ scope: 'turn', format: 'pdf' });
  });
});

describe('annullamento', () => {
  it('restituisce null dal pulsante Annulla', async () => {
    const result = dialog.open();
    click('cancel');

    await expect(result).resolves.toBeNull();
  });

  it('restituisce null premendo Esc', async () => {
    const result = dialog.open();
    pressKey('Escape');

    await expect(result).resolves.toBeNull();
  });

  it('restituisce null al clic sullo sfondo', async () => {
    const result = dialog.open();

    const overlay = shadow().querySelector('.overlay');
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await expect(result).resolves.toBeNull();
  });

  it('non annulla se il clic parte dall\u2019interno del riquadro', () => {
    let settled = false;
    dialog.open().then(() => {
      settled = true;
    });

    shadow()
      .querySelector('.dialog')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(settled).toBe(false);
    expect(dialog.isOpen()).toBe(true);
  });

  it('smette di ascoltare la tastiera dopo la chiusura', async () => {
    const result = dialog.open();
    click('cancel');
    await result;

    // Senza la rimozione dei listener, Esc continuerebbe a intercettare i tasti
    // dell'applicazione ospite.
    expect(() => pressKey('Escape')).not.toThrow();
  });
});

describe('riapertura', () => {
  it('non lascia due dialoghi montati contemporaneamente', () => {
    dialog.open();
    dialog.open();

    expect(document.querySelectorAll(`.${UI_CLASS.dialogHost}`)).toHaveLength(1);
  });
});

describe('opzioni di contenuto nel dialogo', () => {
  it('mostra il campo del titolo con il valore corrente', () => {
    dialog.open({ documentTitle: 'Studio di funzione' });

    const input = shadow().querySelector('[data-field="documentTitle"]');
    expect(input.value).toBe('Studio di funzione');
  });

  it('espone una casella per ogni opzione dichiarata', () => {
    dialog.open();

    for (const option of listDocumentOptions()) {
      expect(
        shadow().querySelector(`[data-option="${option.id}"]`),
        `manca la casella ${option.id}`
      ).not.toBeNull();
    }
  });

  it('presenta le immagini prima dei grafici', () => {
    // Ordine richiesto: l'opzione sulle immagini sta sopra quella sui grafici.
    dialog.open();

    const ids = [...shadow().querySelectorAll('[data-option]')].map((input) =>
      input.getAttribute('data-option')
    );

    expect(ids.indexOf('includeImages')).toBeLessThan(ids.indexOf('includeCharts'));
  });

  it('riflette lo stato salvato delle opzioni', () => {
    dialog.open({
      options: { includeImages: true, includeAttachments: false },
      canCapture: true,
    });

    expect(shadow().querySelector('[data-option="includeImages"]').checked).toBe(true);
    expect(shadow().querySelector('[data-option="includeAttachments"]').checked).toBe(false);
  });

  it('lascia i grafici cliccabili anche senza permesso', () => {
    // Disabilitare la casella costringerebbe a cercare altrove un interruttore
    // che l'utente sta già guardando: cliccarla richiede il permesso.
    dialog.open({ options: { includeCharts: true }, canCapture: false });

    const charts = shadow().querySelector('[data-option="includeCharts"]');
    expect(charts.disabled).toBe(false);
    // Senza permesso non può risultare attiva: sarebbe una promessa vuota.
    expect(charts.checked).toBe(false);
  });

  it('richiede il permesso quando si attivano i grafici', async () => {
    const requestPermission = vi.fn(async () => true);
    dialog.open({ canCapture: false, requestPermission });

    const charts = shadow().querySelector('[data-option="includeCharts"]');
    charts.checked = true;
    charts.dispatchEvent(new window.Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(charts.checked).toBe(true);
  });

  it('riporta la casella a spenta se il permesso viene negato', async () => {
    const requestPermission = vi.fn(async () => false);
    dialog.open({ canCapture: false, requestPermission });

    const charts = shadow().querySelector('[data-option="includeCharts"]');
    charts.checked = true;
    charts.dispatchEvent(new window.Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    expect(charts.checked).toBe(false);
  });

  it('revoca il permesso quando si disattivano i grafici', async () => {
    const revokePermission = vi.fn(async () => true);
    dialog.open({ options: { includeCharts: true }, canCapture: true, revokePermission });

    const charts = shadow().querySelector('[data-option="includeCharts"]');
    charts.checked = false;
    charts.dispatchEvent(new window.Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    expect(revokePermission).toHaveBeenCalledOnce();
    expect(charts.checked).toBe(false);
  });

  it('non chiede permessi per le opzioni che non ne richiedono', async () => {
    const requestPermission = vi.fn(async () => true);
    dialog.open({ canCapture: false, requestPermission });

    const images = shadow().querySelector('[data-option="includeImages"]');
    images.checked = true;
    images.dispatchEvent(new window.Event('change'));
    await Promise.resolve();

    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('abilita i grafici quando il permesso è concesso', () => {
    dialog.open({ options: { includeCharts: true }, canCapture: true });

    expect(shadow().querySelector('[data-option="includeCharts"]').disabled).toBe(false);
    expect(shadow().querySelector('[data-option="includeCharts"]').checked).toBe(true);
  });

  it('restituisce titolo e opzioni alla conferma', async () => {
    const result = dialog.open({ documentTitle: 'Iniziale', canCapture: true });

    const title = shadow().querySelector('[data-field="documentTitle"]');
    title.value = 'Titolo scelto';
    title.dispatchEvent(new window.Event('input'));

    const images = shadow().querySelector('[data-option="includeImages"]');
    images.checked = false;
    images.dispatchEvent(new window.Event('change'));

    shadow().querySelector('[data-action="confirm"]').click();

    await expect(result).resolves.toMatchObject({
      documentTitle: 'Titolo scelto',
      options: expect.objectContaining({ includeImages: false }),
    });
  });

  it('non espone più il formato HTML', () => {
    // Rimosso dai formati: era un segnaposto mai realizzato.
    dialog.open();

    expect(shadow().querySelector('input[name="format"][value="html"]')).toBeNull();
  });
});
