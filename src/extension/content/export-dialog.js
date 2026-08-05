/**
 * Dialogo di scelta delle opzioni di esportazione.
 *
 * Responsabilità: raccogliere ambito e formato dall'utente e restituirli.
 * Non conosce Gemini, non esporta nulla, non decide cosa sia possibile: le voci
 * arrivano dai registry in `shared/`, così aggiungere un formato non richiede
 * di toccare questo file.
 *
 * Il contenuto vive in uno Shadow DOM: Gemini è un'applicazione Angular con
 * fogli di stile globali molto invasivi, e l'isolamento è l'unico modo per
 * garantire che il dialogo appaia identico nel tempo.
 * @module extension/content/export-dialog
 */

import { UI_CLASS } from '../../shared/config.js';
import { listScopes, DEFAULT_SCOPE_ID, isDeferredScope } from '../../shared/export-scopes.js';
import { listFormats, DEFAULT_FORMAT_ID, isFormatAvailable } from '../../shared/export-formats.js';
import { listDocumentOptions } from '../../shared/document-options.js';
import { DIALOG_STYLES } from './export-dialog.styles.js';

/**
 * @typedef {object} DialogResult
 * @property {string} scope Ambito scelto.
 * @property {string} format Formato scelto.
 * @property {string} documentTitle Titolo da stampare in testa al documento.
 * @property {Record<string, boolean>} options Opzioni di contenuto.
 */

/**
 * @param {object} [deps]
 * @param {Document} [deps.document]
 */
export function createExportDialog({ document: doc = globalThis.document } = {}) {
  /** @type {HTMLElement|null} Host attualmente montato. */
  let host = null;
  /** @type {(() => void)|null} Rimozione dei listener globali. */
  let detach = null;

  /**
   * Mostra il dialogo e risolve con la scelta dell'utente, o con null se
   * annullato.
   * @param {object} [options] Valori preselezionati.
   * @param {string} [options.scope]
   * @param {string} [options.format]
   * @param {string} [options.documentTitle]
   * @param {Record<string, boolean>} [options.options] Opzioni di contenuto.
   * @param {boolean} [options.canCapture] Permesso di cattura già concesso.
   * @param {() => Promise<boolean>} [options.requestPermission] Richiede il
   *   permesso di cattura. Invocata dal gestore del click, così il gesto
   *   dell'utente si propaga fino all'API che lo esige.
   * @param {() => Promise<boolean>} [options.revokePermission] Revoca il permesso.
   * @returns {Promise<DialogResult|null>}
   */
  function open({
    scope = DEFAULT_SCOPE_ID,
    format = DEFAULT_FORMAT_ID,
    documentTitle = '',
    options = {},
    canCapture = false,
    requestPermission = async () => false,
    revokePermission = async () => false,
  } = {}) {
    close();

    return new Promise((resolve) => {
      const selection = {
        scope,
        // Una preferenza salvata può puntare a un formato non più disponibile.
        format: isFormatAvailable(format) ? format : DEFAULT_FORMAT_ID,
        documentTitle,
        options: { ...options },
      };

      host = doc.createElement('div');
      host.className = UI_CLASS.dialogHost;
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = buildMarkup({ documentTitle, options, canCapture });
      shadow.prepend(createStyleElement(doc));
      doc.body.appendChild(host);

      /** @param {DialogResult|null} result */
      const finish = (result) => {
        close();
        resolve(result);
      };

      bindInteractions(shadow, selection, finish, { requestPermission, revokePermission });
      detach = bindGlobalKeys(doc, shadow, () => finish(null));

      // Il focus iniziale sul pulsante di conferma permette di esportare
      // premendo semplicemente Invio.
      /** @type {HTMLElement|null} */ (shadow.querySelector('[data-action="confirm"]'))?.focus();
    });
  }

  /** Rimuove il dialogo, se presente. */
  function close() {
    detach?.();
    detach = null;
    host?.remove();
    host = null;
  }

  return { open, close, isOpen: () => host !== null };
}

/**
 * @param {Document} doc
 * @returns {HTMLStyleElement}
 */
function createStyleElement(doc) {
  const style = doc.createElement('style');
  style.textContent = DIALOG_STYLES;
  return style;
}

/**
 * @param {object} state
 * @param {string} state.documentTitle
 * @param {Record<string, boolean>} state.options
 * @param {boolean} state.canCapture Permesso di cattura già concesso.
 * @returns {string}
 */
function buildMarkup({ documentTitle, options, canCapture }) {
  return `
<div class="overlay" part="overlay">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="gex-dialog-title">
    <header class="header">
      <h2 id="gex-dialog-title">Esporta conversazione</h2>
      <button class="icon-button" data-action="cancel" aria-label="Chiudi" type="button">✕</button>
    </header>

    <div class="body">
      <label class="field">
        <span class="field-label">Titolo del documento</span>
        <input type="text" data-field="documentTitle" maxlength="80"
               value="${escapeAttribute(documentTitle)}" placeholder="Gemini Chat">
      </label>

      <fieldset class="group">
        <legend>Contenuto</legend>
        ${listDocumentOptions()
          .map((option) => renderToggle(option, options[option.id], canCapture))
          .join('')}
      </fieldset>

      <fieldset class="group">
        <legend>Cosa esportare</legend>
        ${listScopes()
          .map((scope) => renderOption('scope', scope))
          .join('')}
      </fieldset>

      <fieldset class="group">
        <legend>Formato</legend>
        ${listFormats()
          .map((format) => renderOption('format', format))
          .join('')}
      </fieldset>
    </div>

    <footer class="footer">
      <button class="button secondary" data-action="cancel" type="button">Annulla</button>
      <button class="button primary" data-action="confirm" type="button">Esporta</button>
    </footer>
  </div>
</div>`;
}

/**
 * Una casella di contenuto.
 *
 * Le opzioni che dipendono da un permesso non ancora concesso restano visibili
 * ma inerti, con la ragione esplicitata: disattivarle in silenzio lascerebbe
 * l'utente a chiedersi perché la scelta non ha effetto.
 *
 * @param {import('../../shared/document-options.js').DocumentOption} option
 * @param {boolean|undefined} checked
 * @param {boolean} canCapture
 * @returns {string}
 */
function renderToggle(option, checked, canCapture) {
  // L'opzione resta cliccabile anche senza permesso: attivarla lo richiede.
  // Disabilitarla costringerebbe l'utente a cercare altrove un interruttore
  // che sta già guardando.
  const needsPermission = option.requiresPermission === true && !canCapture;

  return `
<label class="option">
  <input type="checkbox" data-option="${option.id}"
         ${checked && !needsPermission ? 'checked' : ''}
         ${option.requiresPermission ? 'data-needs-permission="true"' : ''}>
  <span class="option-text">
    <span class="option-label">${option.label}</span>
    ${option.hint ? `<span class="option-description">${option.hint}</span>` : ''}
  </span>
</label>`;
}

/**
 * @param {string} value
 * @returns {string} Valore utilizzabile dentro un attributo HTML.
 */
function escapeAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/**
 * Una voce selezionabile. Le voci non disponibili restano visibili ma inerti:
 * mostrano la direzione del prodotto senza promettere una funzione assente.
 * @param {'scope'|'format'} group
 * @param {{ id: string, label: string, description: string, available: boolean }} option
 * @returns {string}
 */
function renderOption(group, option) {
  const disabled = option.available ? '' : 'disabled';
  const badge = option.available ? '' : '<span class="badge">presto</span>';

  return `
<label class="option ${option.available ? '' : 'is-disabled'}">
  <input type="radio" name="${group}" value="${option.id}" ${disabled}>
  <span class="option-text">
    <span class="option-label">${option.label}${badge}</span>
    <span class="option-description">${option.description}</span>
  </span>
</label>`;
}

/**
 * Collega la selezione e i pulsanti.
 * @param {ShadowRoot} shadow
 * @param {DialogResult} selection
 * @param {(result: DialogResult|null) => void} finish
 * @param {{ requestPermission: () => Promise<boolean>, revokePermission: () => Promise<boolean> }} permissions
 */
function bindInteractions(shadow, selection, finish, permissions) {
  const confirm = /** @type {HTMLElement|null} */ (shadow.querySelector('[data-action="confirm"]'));

  /**
   * Alcuni ambiti non producono un documento alla conferma: aprono una fase di
   * selezione sulla pagina. L'etichetta del pulsante lo anticipa, così l'utente
   * sa cosa aspettarsi prima di premerlo.
   */
  const refreshConfirmLabel = () => {
    if (confirm) confirm.textContent = isDeferredScope(selection.scope) ? 'Seleziona' : 'Esporta';
  };

  for (const group of ['scope', 'format']) {
    const inputs = /** @type {NodeListOf<HTMLInputElement>} */ (
      shadow.querySelectorAll(`input[name="${group}"]`)
    );

    for (const input of inputs) {
      if (input.value === selection[group]) input.checked = true;
      input.addEventListener('change', () => {
        selection[group] = input.value;
        if (group === 'scope') refreshConfirmLabel();
      });
    }
  }

  refreshConfirmLabel();

  const title = /** @type {HTMLInputElement|null} */ (
    shadow.querySelector('[data-field="documentTitle"]')
  );
  title?.addEventListener('input', () => {
    selection.documentTitle = title.value;
  });

  for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (
    shadow.querySelectorAll('[data-option]')
  )) {
    const id = input.getAttribute('data-option');
    selection.options[id] = input.checked;

    input.addEventListener('change', async () => {
      if (input.getAttribute('data-needs-permission') !== 'true') {
        selection.options[id] = input.checked;
        return;
      }

      // Il permesso si chiede qui, dentro il gestore del click: è la
      // condizione che Chrome impone a `permissions.request`.
      const granted = input.checked
        ? await permissions.requestPermission()
        : !(await permissions.revokePermission());

      // La casella segue l'esito reale: mostrarla spuntata dopo un rifiuto
      // prometterebbe un contenuto che l'esportazione non può produrre.
      input.checked = granted;
      selection.options[id] = granted;
    });
  }

  shadow.querySelectorAll('[data-action="cancel"]').forEach((element) => {
    element.addEventListener('click', () => finish(null));
  });

  shadow.querySelector('[data-action="confirm"]')?.addEventListener('click', () => {
    finish({ ...selection, options: { ...selection.options } });
  });

  // Il clic sullo sfondo annulla, comportamento atteso in un dialogo modale.
  shadow.querySelector('.overlay')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) finish(null);
  });
}

/**
 * Gestisce Esc e mantiene il focus dentro il dialogo.
 * @param {Document} doc
 * @param {ShadowRoot} shadow
 * @param {() => void} onCancel
 * @returns {() => void} Funzione di rimozione dei listener.
 */
function bindGlobalKeys(doc, shadow, onCancel) {
  /** @param {KeyboardEvent} event */
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }

    if (event.key !== 'Tab') return;

    // Focus trap: senza di esso il tabulatore uscirebbe nel DOM di Gemini,
    // lasciando l'utente con un dialogo aperto e nessun controllo attivo.
    const focusables = /** @type {HTMLElement[]} */ ([
      ...shadow.querySelectorAll('button, input:not([disabled]), input[type="text"]'),
    ]);
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = /** @type {HTMLElement|null} */ (shadow.activeElement);

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  doc.addEventListener('keydown', onKeyDown, true);
  return () => doc.removeEventListener('keydown', onKeyDown, true);
}
