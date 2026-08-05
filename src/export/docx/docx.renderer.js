/**
 * Renderer Word (.docx).
 *
 * Come il renderer HTML, riceve una `Conversation` e non conosce Gemini.
 * Restituisce però un `Uint8Array` — il pacchetto OOXML — invece di una
 * stringa: il sink distingue i due casi dal tipo di ritorno.
 *
 * Le formule matematiche sono rese come testo LaTeX corsivo. Word le
 * rappresenterebbe in OMML, un formato del tutto diverso da KaTeX: tradurre
 * fedelmente richiederebbe un convertitore LaTeX→OMML, complessità che non
 * trova giustificazione finché il PDF resta il formato di riferimento per la
 * matematica. Il sorgente LaTeX resta leggibile e riutilizzabile.
 * @module export/docx/docx.renderer
 */

import { createZip } from './zip-writer.js';
import {
  CONTENT_TYPES_XML,
  PACKAGE_RELS_XML,
  DOCUMENT_RELS_XML,
  NUMBERING_XML,
  STYLES_XML,
  SETTINGS_XML,
  FONT_TABLE_XML,
  W_NAMESPACE,
  buildCoreProperties,
  buildAppProperties,
  escapeXml,
} from './ooxml.js';
import { convertHtmlToOoxml, resetImageCounter } from './html-to-ooxml.js';
import { createImageCollector } from './images.js';
import { M_NAMESPACE } from './latex/omml.js';
import { APP, DEFAULT_PREFERENCES } from '../../shared/config.js';
import { formatTimestamp } from '../../shared/format.js';

/** Estensione e tipo MIME del formato. */
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOCX_EXTENSION = '.docx';

/**
 * @param {object} [deps]
 * @param {Document} [deps.document] Usato per il parsing dell'HTML sanificato.
 */
export function createDocxRenderer({ document: doc = globalThis.document } = {}) {
  return {
    /** Identificatore del formato prodotto. */
    format: 'word',

    /**
     * @param {import('../../core/model/conversation.js').Conversation} conversation
     * @param {Partial<import('../../shared/config.js').Preferences>} [options]
     * @returns {Promise<Uint8Array>} Pacchetto .docx.
     */
    async render(conversation, options = {}) {
      const settings = { ...DEFAULT_PREFERENCES, ...options };
      const timestamp = formatTimestamp(conversation.exportedAt, settings.locale);

      // Ogni documento ha la propria raccolta: gli identificatori di relazione
      // non devono sovrapporsi fra esportazioni successive.
      const images = createImageCollector();
      resetImageCounter();

      const body = [
        buildTitle(conversation.title, timestamp),
        ...conversation.turns.flatMap((turn, index) =>
          buildTurn({
            turn,
            index,
            total: conversation.turns.length,
            settings,
            document: doc,
            images,
          })
        ),
        buildFooter(),
        SECTION_PROPERTIES,
      ].join('\n');

      // I namespace vanno tutti dichiarati sull'elemento radice: `m` per la
      // matematica, `r`/`wp`/`a`/`pic` per le immagini. Word considera il
      // documento corrotto se incontra un elemento di namespace non dichiarato.
      const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NAMESPACE}" xmlns:m="${M_NAMESPACE}"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
${body}
  </w:body>
</w:document>`;

      return createZip(buildPackageParts({ documentXml, conversation, images }), {
        modifiedAt: conversation.exportedAt,
      });
    },
  };
}

/**
 * Elenca le parti che compongono il pacchetto `.docx`, **nell'ordine in cui
 * vanno scritte nell'archivio**.
 *
 * L'ordine non è indifferente: `[Content_Types].xml` deve essere la prima voce,
 * e Word raggruppa tutto ciò che sta sotto `word/` prima di `docProps`.
 * Esportata per rendere l'ordine verificabile senza ispezionare i byte.
 *
 * @param {object} params
 * @param {string} params.documentXml
 * @param {import('../../core/model/conversation.js').Conversation} params.conversation
 * @param {import('./images.js').ImageCollector} params.images
 * @returns {Array<{ path: string, content: string|Uint8Array }>}
 */
export function buildPackageParts({ documentXml, conversation, images }) {
  return [
    // `[Content_Types].xml` deve essere la prima voce dell'archivio.
    { path: '[Content_Types].xml', content: CONTENT_TYPES_XML },
    { path: '_rels/.rels', content: PACKAGE_RELS_XML },
    { path: 'word/document.xml', content: documentXml },
    {
      path: 'word/_rels/document.xml.rels',
      // Le relazioni delle immagini si aggiungono a quelle fisse.
      content: DOCUMENT_RELS_XML.replace(
        '</Relationships>',
        `${images.relationships()}</Relationships>`
      ),
    },
    { path: 'word/styles.xml', content: STYLES_XML },
    { path: 'word/numbering.xml', content: NUMBERING_XML },
    // settings.xml contiene <m:mathPr>: senza, Word non dispone dei
    // parametri di impaginazione della matematica, mostra il segnaposto
    // «EQUAZIONE» e ricalcola le altezze a documento già aperto,
    // riflowando il testo fuori pagina.
    { path: 'word/settings.xml', content: SETTINGS_XML },
    { path: 'word/fontTable.xml', content: FONT_TABLE_XML },
    // Le parti binarie precedono docProps: è l'ordine che Word stesso produce,
    // con tutto ciò che sta sotto `word/` raggruppato. Le implementazioni
    // tolleranti leggono l'archivio per nome, Word si appoggia all'ordine.
    ...images.parts(),
    {
      path: 'docProps/core.xml',
      content: buildCoreProperties({
        title: conversation.title,
        createdAt: conversation.exportedAt,
        generator: APP.name,
      }),
    },
    { path: 'docProps/app.xml', content: buildAppProperties({ generator: APP.name }) },
  ];
}

/** Formato A4 con margini di 2 cm (misure in twip). */
const SECTION_PROPERTIES = `<w:sectPr>
  <w:pgSz w:w="11906" w:h="16838"/>
  <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708"/>
</w:sectPr>`;

/**
 * @param {string} title
 * @param {string} timestamp
 * @returns {string}
 */
function buildTitle(title, timestamp) {
  return `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(title)}</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr><w:r><w:t xml:space="preserve">Esportato il ${escapeXml(timestamp)}</w:t></w:r></w:p>`;
}

/**
 * @param {object} params
 * @param {import('../../core/model/conversation.js').ConversationTurn} params.turn
 * @param {number} params.index Posizione del turno, a partire da 0.
 * @param {number} params.total Numero complessivo di turni.
 * @param {import('../../shared/config.js').Preferences} params.settings
 * @param {Document} params.document
 * @param {import('./images.js').ImageCollector} params.images Raccolta delle immagini.
 * @returns {string[]}
 */
function buildTurn({ turn, index, total, settings, document: doc, images }) {
  const parts = [];

  if (total > 1 && index > 0) {
    parts.push(
      `<w:p><w:pPr><w:pStyle w:val="Label"/><w:pBdr><w:top w:val="single" w:sz="4" w:space="8" w:color="DADCE0"/></w:pBdr></w:pPr><w:r><w:t>Turno ${index + 1}</w:t></w:r></w:p>`
    );
  }

  if (settings.includeUserMessage) {
    parts.push(buildLabel('Il tuo messaggio'));
    parts.push(buildUserMessage(turn.userMessage, settings));
  }

  parts.push(buildLabel('Risposta di Gemini'));
  parts.push(buildModelMessage(turn.modelMessage, doc, images));
  parts.push(buildAttachmentList(turn.modelMessage, settings, 'File generati'));

  return parts;
}

/**
 * @param {string} text
 * @returns {string}
 */
function buildLabel(text) {
  return `<w:p><w:pPr><w:pStyle w:val="Label"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/**
 * @param {import('../../core/model/conversation.js').Message} message
 * @param {import('../../shared/config.js').Preferences} settings
 * @returns {string}
 */
function buildUserMessage(message, settings) {
  const paragraphs = (message.text || '—')
    .split('\n')
    .map(
      (line) =>
        `<w:p><w:pPr><w:pStyle w:val="UserMessage"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
    );

  paragraphs.push(buildAttachmentList(message, settings, 'Allegati', 'UserMessage'));

  return paragraphs.join('');
}

/**
 * Elenco dei file associati a un messaggio.
 *
 * Vale sia per gli allegati dell'utente sia per i file generati da Gemini: la
 * forma è la stessa, cambia solo l'etichetta.
 *
 * @param {import('../../core/model/conversation.js').Message} message
 * @param {import('../../shared/config.js').Preferences} settings
 * @param {string} label
 * @param {string} [style] Stile di paragrafo da applicare.
 * @returns {string} Paragrafo, stringa vuota se non ci sono file.
 */
function buildAttachmentList(message, settings, label, style = '') {
  if (!settings.includeAttachments || message.attachments.length === 0) return '';

  // Prima il nome, poi il formato, coerentemente con il rendering HTML.
  const files = message.attachments
    .map((file) => `${file.name}${file.extension ? ` [${file.extension}]` : ''}`)
    .join('   ');

  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';

  return `<w:p>${properties}<w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escapeXml(label)}: ${escapeXml(files)}</w:t></w:r></w:p>`;
}

/**
 * @param {import('../../core/model/conversation.js').Message} message
 * @param {Document} doc
 * @param {import('./images.js').ImageCollector} images
 * @returns {string}
 */
function buildModelMessage(message, doc, images) {
  if (!message.html) {
    return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(message.text)}</w:t></w:r></w:p>`;
  }

  // `message.html` è di tipo SafeHtml: già passato dal sanitizer con allowlist.
  const container = doc.createElement('div');
  container.innerHTML = message.html.value;

  const converted = convertHtmlToOoxml(container, { images });
  // Un contenuto che non produce blocchi lascerebbe il documento vuoto.
  return converted.trim() === ''
    ? `<w:p><w:r><w:t xml:space="preserve">${escapeXml(message.text)}</w:t></w:r></w:p>`
    : converted;
}

/** @returns {string} */
function buildFooter() {
  return `<w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t xml:space="preserve">Esportato con ${escapeXml(APP.name)}</w:t></w:r></w:p>`;
}
