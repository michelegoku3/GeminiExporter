/**
 * Renderer del documento HTML autosufficiente.
 *
 * Non conosce Gemini: riceve una `Conversation` e restituisce una stringa HTML
 * completa, con tutti gli stili incorporati (nessuna richiesta di rete al
 * momento della stampa, nessun problema di CSP).
 * @module render/html-document.renderer
 */

import {
  renderToolbar,
  renderHeader,
  renderUserMessage,
  renderModelMessage,
  renderTurnSeparator,
  renderFooter,
} from './templates/sections.js';
import { renderInlineBehaviourScript } from './document-behaviour.js';
import { escapeHtml } from './templates/escape.js';
import { DEFAULT_PREFERENCES } from '../shared/config.js';
import { formatTimestamp } from '../shared/format.js';
import { logger as defaultLogger } from '../shared/logger.js';

/**
 * @typedef {object} RenderOptions
 * @property {string} [locale] Locale per il timestamp.
 * @property {boolean} [includeAttachments]
 * @property {boolean} [includeUserMessage]
 * @property {boolean} [inlineBehaviour] Incorpora lo script di comportamento.
 *   Necessario solo per il file scaricato e per il fallback `blob:`; nella
 *   pagina dell'estensione la CSP vieta gli script inline e il comportamento
 *   viene applicato da viewer.js. Default: true, così il documento resta
 *   funzionante anche se salvato su disco.
 */

/**
 * @param {object} deps
 * @param {{ loadStyles: () => Promise<any> }} deps.assetLoader
 */
export function createHtmlDocumentRenderer({ assetLoader }) {
  return {
    /**
     * @param {import('../core/model/conversation.js').Conversation} conversation
     * @param {RenderOptions} [options]
     * @returns {Promise<string>} Documento HTML completo.
     */
    async render(conversation, options = {}) {
      const settings = { ...DEFAULT_PREFERENCES, ...options };
      const styles = await assetLoader.loadStyles();

      // La diagnostica sugli asset mancanti resta nel log: è informazione per
      // chi sviluppa, non per chi legge il documento. Un riquadro giallo in
      // testa a ogni pagina esportata sarebbe rumore permanente per l'utente,
      // che di norma non può farci nulla.
      reportMissingAssets(styles.integrity?.missing ?? []);
      const timestamp = formatTimestamp(conversation.exportedAt, settings.locale);

      const body = [
        renderToolbar({ title: conversation.title, timestamp }),
        '<div class="content-wrapper">',
        renderHeader({ title: conversation.title, timestamp }),
        renderTurns(conversation, settings),
        renderFooter(),
        '</div>',
        // Lo script inline serve solo ai contesti senza moduli (file scaricato,
        // blob). Nella pagina dell'estensione è la CSP a vietarlo, e il
        // comportamento viene applicato da viewer.js importando il modulo.
        settings.inlineBehaviour ? renderInlineBehaviourScript() : '',
      ].join('\n');

      return buildDocument({ title: conversation.title, styles, body, locale: settings.locale });
    },
  };
}

/**
 * Segnala nel log gli asset che non è stato possibile caricare.
 *
 * @param {string[]} missing
 */
function reportMissingAssets(missing) {
  if (missing.length === 0) return;

  defaultLogger.warn(
    `Asset non caricati (${missing.join(', ')}): le formule matematiche ` +
      'potrebbero non essere rese correttamente.'
  );
}

/**
 * @param {import('../core/model/conversation.js').Conversation} conversation
 * @param {Required<RenderOptions>} settings
 * @returns {string}
 */
function renderTurns(conversation, settings) {
  const multipleTurns = conversation.turns.length > 1;

  return conversation.turns
    .map((turn, index) => {
      const parts = [];
      // Il separatore aiuta a orientarsi solo quando i turni sono più d'uno.
      if (multipleTurns && index > 0) parts.push(renderTurnSeparator(index + 1));
      if (settings.includeUserMessage) {
        parts.push(renderUserMessage(turn.userMessage, settings));
      }
      parts.push(renderModelMessage(turn.modelMessage, settings.includeAttachments));
      return parts.join('\n');
    })
    .join('\n');
}

/**
 * @param {{ title: string, styles: any, body: string, locale: string }} params
 * @returns {string}
 */
function buildDocument({ title, styles, body, locale }) {
  const language = locale.split('-')[0] || 'it';

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${styles.katexFonts}</style>
<style>${styles.katex}</style>
<style>${styles.document}</style>
<style>${styles.katexOverrides}</style>
<style>${styles.print}</style>
</head>
<body>
${body}
</body>
</html>`;
}
