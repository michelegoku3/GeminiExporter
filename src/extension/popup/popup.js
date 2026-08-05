/**
 * Logica del popup.
 *
 * Ospita le sole impostazioni che valgono per **tutte** le esportazioni. Titolo
 * del documento, contenuti da includere e permesso di cattura vivono nel
 * dialogo che compare premendo 📄 sotto una risposta: sono scelte legate alla
 * singola esportazione, e chiederle lì evita di doverle cercare altrove.
 * @module extension/popup/popup
 */

import { createPreferencesStore } from '../preferences.js';
import { APP } from '../../shared/config.js';

const preferences = createPreferencesStore();

/** Campi del form associati alle chiavi delle preferenze. */
const TEXT_FIELDS = ['locale', 'logLevel'];

/** @param {string} id */
const byId = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

/** @param {string} message */
function setStatus(message) {
  byId('status').textContent = message;
}

async function initialise() {
  byId('version').textContent = `v${APP.version}`;

  const values = await preferences.load();
  for (const field of TEXT_FIELDS) byId(field).value = values[field];

  bindPersistence();
}

/** Salva ogni modifica immediatamente: nessun pulsante "Salva" da ricordare. */
function bindPersistence() {
  for (const field of TEXT_FIELDS) {
    byId(field).addEventListener('change', async (event) => {
      await preferences.save({ [field]: /** @type {HTMLInputElement} */ (event.target).value });
      setStatus('Preferenze salvate.');
    });
  }
}

initialise();
