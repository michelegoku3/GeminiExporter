/**
 * Frammenti di markup del documento esportato.
 *
 * Ogni funzione produce una sezione indipendente e riceve solo dati del modello:
 * nessuna conoscenza di Gemini, nessun accesso al DOM.
 * @module render/templates/sections
 */

import { escapeHtml } from './escape.js';
import { APP } from '../../shared/config.js';

/** Icona della stampante nella toolbar. */
const PRINTER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 6 2 18 2 18 9"/>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
      <rect x="6" y="14" width="12" height="8"/>
    </svg>`;

/**
 * Barra superiore con il pulsante di stampa. Nascosta in fase di stampa.
 * @param {{ title: string, timestamp: string }} params
 * @returns {string}
 */
export function renderToolbar({ title, timestamp }) {
  return `<div class="print-toolbar">
  <div class="toolbar-left">
    <div>
      <div class="toolbar-title">📄 ${escapeHtml(title)}</div>
      <div class="toolbar-subtitle">${escapeHtml(timestamp)}</div>
    </div>
  </div>
  <button class="print-btn" id="gex-print-button" type="button">
    ${PRINTER_ICON}
    Salva come PDF
  </button>
</div>`;
}

/**
 * Intestazione del documento.
 * @param {{ title: string, timestamp: string }} params
 * @returns {string}
 */
export function renderHeader({ title, timestamp }) {
  return `<div class="pdf-header">
    <h1>${escapeHtml(title)}</h1>
    <div class="timestamp">Esportato il ${escapeHtml(timestamp)}</div>
  </div>`;
}

/**
 * Blocco del messaggio utente, con eventuali allegati.
 * @param {import('../../core/model/conversation.js').Message} message
 * @param {{ includeAttachments: boolean }} options
 * @returns {string}
 */
export function renderUserMessage(message, { includeAttachments }) {
  const attachments =
    includeAttachments && message.attachments.length > 0
      ? renderAttachments(message.attachments)
      : '';

  return `<div class="user-message">
    <div class="label">💬 Il tuo messaggio</div>
    <div class="text">${escapeHtml(message.text)}</div>
    ${attachments}
  </div>`;
}

/**
 * @param {readonly import('../../core/model/conversation.js').Attachment[]} attachments
 * @returns {string}
 */
function renderAttachments(attachments) {
  const items = attachments
    .map(
      (file) =>
        // Prima il nome, poi il formato: il nome è ciò che identifica il file,
        // l'estensione è un dettaglio secondario.
        `${escapeHtml(file.name)} <span class="file-badge">${escapeHtml(file.extension)}</span>`
    )
    .join('&nbsp;&nbsp;');

  return `<div class="user-files">${items}</div>`;
}

/**
 * Blocco della risposta del modello.
 * @param {import('../../core/model/conversation.js').Message} message
 * @returns {string}
 */
export function renderModelMessage(message, includeAttachments = true) {
  // `message.html` è di tipo SafeHtml: è già passato dal sanitizer con allowlist.
  const body = message.html ? message.html.value : escapeHtml(message.text);

  // I file generati da Gemini sono scaricabili solo dall'interfaccia: nel
  // documento ne resta la menzione, così chi legge sa che esistono.
  const files =
    includeAttachments && message.attachments.length > 0
      ? renderAttachments(message.attachments)
      : '';

  return `<div class="gemini-response">
    <div class="label">✨ Risposta di Gemini</div>
    <div class="markdown">
      ${body}
    </div>
    ${files}
  </div>`;
}

/**
 * Separatore fra i turni, usato solo nell'export dell'intera conversazione.
 * @param {number} index Indice del turno, a partire da 1.
 * @returns {string}
 */
export function renderTurnSeparator(index) {
  return `<div class="turn-separator"><span>Turno ${index}</span></div>`;
}

/** @returns {string} */
export function renderFooter() {
  return `<div class="pdf-footer">Esportato con ${escapeHtml(APP.name)}</div>`;
}
